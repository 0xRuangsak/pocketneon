import { createGame, startHand, act, viewFor } from './engine.js';
import { bestHand } from './evaluator.js';
import { openRoom, makeCode, normalizeCode } from '../../shared/net.js';

const HOST = 0;
const GUEST = 1;
const NEXT_HAND_DELAY = { fold: 2200, showdown: 5500 };

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const app = {
  role: null,        // 'host' | 'guest'
  room: null,
  connected: false,
  game: null,        // host only: full game state
  rematch: [false, false],
  view: null,        // what this player sees
  nextHandTimer: 0,
  seen: new Set(),   // cards already shown, so only new ones animate
  raise: null,       // { to } while the raise panel is open
};

/* ---------- Storage ---------- */
const store = {
  get(k) { try { return localStorage.getItem(`pocketneon:${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`pocketneon:${k}`, v); } catch { /* private mode */ } },
};

/* ---------- Screens ---------- */
function show(screen) {
  for (const id of ['lobby', 'waiting', 'connecting', 'table']) $(id).hidden = id !== screen;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function modal(html, bind = {}) {
  $('modal-box').innerHTML = html;
  $('modal').hidden = !html;
  for (const [id, fn] of Object.entries(bind)) $(id)?.addEventListener('click', fn);
}

function myName() {
  const name = $('name').value.trim().slice(0, 14) || 'Player';
  store.set('name', name);
  return name;
}

function resetSession(message = '') {
  clearTimeout(app.nextHandTimer);
  app.room?.close();
  Object.assign(app, { role: null, room: null, connected: false, game: null, view: null, raise: null, rematch: [false, false] });
  app.seen.clear();
  document.title = "Texas Hold'em · Pocket Neon";
  modal('');
  $('lobby-msg').textContent = message;
  history.replaceState(null, '', location.pathname + location.search);
  show('lobby');
}

/* ---------- Host ---------- */
function createTable(retry = true) {
  const name = myName();
  const code = makeCode();
  app.role = 'host';
  app.room = openRoom({ game: 'holdem', role: 'host', code });
  $('wait-code').textContent = code;
  $('wait-status').textContent = 'Opening table…';
  show('waiting');

  app.room
    .on('ready', () => { $('wait-status').textContent = 'Waiting for your opponent…'; })
    .on('open', () => { app.connected = true; })
    .on('message', msg => onHostMessage(msg, name))
    .on('close', onOpponentLeft)
    .on('error', text => {
      if (app.connected) return;
      if (retry && /in use/.test(text)) { app.room.close(); createTable(false); return; }
      resetSession(text);
    });
}

function inviteLink() {
  return `${location.origin}${location.pathname}${location.search}#join=${$('wait-code').textContent}`;
}

function onHostMessage(msg, name) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello' && !app.game) {
    const guestName = String(msg.name || 'Guest').slice(0, 14);
    app.game = createGame([{ name }, { name: guestName }]);
    startHand(app.game);
    show('table');
    publish();
  } else if (msg.t === 'act') {
    hostAct(GUEST, msg.type, Number(msg.amount) || 0);
  } else if (msg.t === 'rematch') {
    requestRematch(GUEST);
  }
}

function hostAct(seat, type, amount) {
  if (act(app.game, seat, type, amount)) publish();
}

function publish() {
  const g = app.game;
  app.room.send({ t: 'state', view: viewFor(g, GUEST), rematch: app.rematch });
  render(viewFor(g, HOST), app.rematch);
  if (g.phase === 'handover') {
    clearTimeout(app.nextHandTimer);
    const delay = g.result.foldWin ? NEXT_HAND_DELAY.fold : NEXT_HAND_DELAY.showdown;
    app.nextHandTimer = setTimeout(() => { startHand(g); publish(); }, delay);
  }
}

function requestRematch(seat) {
  app.rematch[seat] = true;
  if (app.rematch.every(Boolean)) {
    const names = app.game.players.map(p => ({ name: p.name }));
    app.rematch = [false, false];
    app.seen.clear();
    app.game = createGame(names);
    startHand(app.game);
  }
  publish();
}

/* ---------- Guest ---------- */
function joinTable(code) {
  code = normalizeCode(code);
  if (code.length < 4) { $('lobby-msg').textContent = 'Enter the table code from your friend.'; return; }
  const name = myName();
  app.role = 'guest';
  app.room = openRoom({ game: 'holdem', role: 'guest', code });
  $('join-code').textContent = code;
  show('connecting');

  app.room
    .on('open', () => { app.connected = true; app.room.send({ t: 'hello', name }); })
    .on('message', msg => {
      if (msg?.t === 'state') {
        show('table');
        render(msg.view, msg.rematch);
      } else if (msg?.t === 'full') {
        resetSession('That table already has two players.');
      }
    })
    .on('close', () => (app.connected ? onOpponentLeft() : resetSession('Could not join that table.')))
    .on('error', text => { if (!app.connected) resetSession(text); });
}

/* ---------- Player input ---------- */
function sendAction(type, amount = 0) {
  app.raise = null;
  if (app.role === 'host') hostAct(HOST, type, amount);
  else app.room.send({ t: 'act', type, amount });
}

function sendRematch() {
  if (app.role === 'host') requestRematch(HOST);
  else app.room.send({ t: 'rematch' });
}

function onOpponentLeft() {
  clearTimeout(app.nextHandTimer);
  const opp = app.view ? app.view.players[1 - app.view.you].name : 'Your opponent';
  app.connected = false;
  modal(
    `<h2>Table closed</h2><p>${esc(opp)} left the table.</p><button id="m-lobby" class="btn block">Back to lobby</button>`,
    { 'm-lobby': () => resetSession() },
  );
}

/* ---------- Rendering ---------- */
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };

function cardHTML(card, { key, cls = '', delay = 0 } = {}) {
  let anim = '';
  if (key && !app.seen.has(key)) {
    app.seen.add(key);
    anim = ` deal" style="animation-delay:${delay}ms`;
  }
  if (!card) return `<div class="card back ${cls}${anim}"></div>`;
  const rank = card[0] === 'T' ? '10' : card[0];
  return `<div class="card suit-${card[1]} ${cls}${anim}" aria-label="${rank}${SUIT[card[1]]}"><b>${rank}</b><i>${SUIT[card[1]]}</i></div>`;
}

const ACTION_LABEL = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allin: 'All-in' };

const contestedPots = v => v.result.pots.filter(p => p.contested);

function winningCards(v) {
  if (!v.result || v.result.foldWin) return null;
  const cards = new Set();
  for (const pot of contestedPots(v)) for (const w of pot.winners) v.result.hands[w]?.cards.forEach(c => cards.add(c));
  return cards;
}

function seatHTML(v, seat, win) {
  const p = v.players[seat];
  const me = seat === v.you;
  const handOver = v.phase === 'handover' || v.phase === 'gameover';
  let status = '';
  let statusCls = '';
  if (p.folded) status = 'Folded';
  else if (p.allIn) [status, statusCls] = ['All-in', 'allin'];
  else if (v.lastAction?.seat === seat && !handOver) {
    statusCls = v.lastAction.type;
    status = ACTION_LABEL[v.lastAction.type];
  }
  if (handOver && v.result?.hands?.[seat]) [status, statusCls] = [v.result.hands[seat].name, ''];

  const hole = p.hole.map((c, k) => cardHTML(c, {
    key: `${v.handNo}:h${seat}:${k}:${c ? 'up' : 'down'}`,
    delay: (k * 2 + (seat === v.dealer ? 0 : 1)) * 120,
    cls: win ? (win.has(c) ? 'win' : 'dim') : '',
  })).join('');

  let hint = '';
  if (me && !p.folded && p.hole[0] && v.board.length >= 3 && !handOver) {
    hint = bestHand([...p.hole, ...v.board]).name;
  }

  const who = `
    <div class="who">
      <div class="avatar ${v.toAct === seat ? 'turn' : ''}">${esc(p.name[0].toUpperCase())}${seat === v.dealer ? '<i class="dealer">D</i>' : ''}</div>
      <div class="meta"><span class="name">${esc(p.name)}${me ? ' (you)' : ''}</span><span class="stack">${fmt(p.chips)}</span></div>
    </div>`;
  const statusEl = `<span class="status ${statusCls}">${esc(status)}</span>`;

  return me
    ? `<div class="hole">${hole}</div><div class="hint">${esc(hint)}</div>${who}${statusEl}`
    : `${who}<div class="hole">${hole}</div>${statusEl}`;
}

function render(v, rematch = [false, false]) {
  app.view = v;
  const me = v.you;
  const opp = 1 - me;
  const win = winningCards(v);

  $('level').textContent = `Level ${v.blinds.level}`;
  $('blinds').textContent = `Blinds ${fmt(v.blinds.sb)} / ${fmt(v.blinds.bb)}`;
  $('next-level').textContent = v.blinds.handsLeft == null
    ? 'Max blinds'
    : v.blinds.handsLeft === 1 ? 'Blinds up next hand' : `Blinds up in ${v.blinds.handsLeft} hands`;

  for (const [seat, el] of [[me, 'seat-me'], [opp, 'seat-opp']]) {
    $(el).className = `seat ${seat === me ? 'me' : 'opp'} ${v.players[seat].folded ? 'folded' : ''}`;
    $(el).innerHTML = seatHTML(v, seat, win);
  }
  // The table lights up once there's money on it.
  document.querySelector('.felt-area').classList.toggle('on', v.pot + v.players.reduce((a, p) => a + p.bet, 0) > 0);
  $('bet-me').textContent = v.players[me].bet ? fmt(v.players[me].bet) : '';
  $('bet-opp').textContent = v.players[opp].bet ? fmt(v.players[opp].bet) : '';

  // Board: newly revealed cards deal in one after another.
  let fresh = 0;
  $('board').innerHTML = Array.from({ length: 5 }, (_, k) => {
    const c = v.board[k];
    if (!c) return '<div class="card empty"></div>';
    const key = `${v.handNo}:b${k}`;
    const delay = app.seen.has(key) ? 0 : fresh++ * 380;
    return cardHTML(c, { key, delay, cls: win ? (win.has(c) ? 'win' : 'dim') : '' });
  }).join('');

  $('pot').textContent = v.phase === 'handover' || v.phase === 'gameover' ? '' : v.pot ? `Pot ${fmt(v.pot)}` : '';
  $('banner').innerHTML = bannerHTML(v);
  renderActions(v);

  document.title = v.toAct === me ? "● Your turn · Texas Hold'em" : "Texas Hold'em · Pocket Neon";
  if (v.toAct === me && document.hidden) navigator.vibrate?.(120);

  if (v.phase === 'gameover') {
    setTimeout(() => app.view === v && gameOverModal(v, rematch), win ? 2400 : 900);
  } else if ($('modal').hidden === false && app.connected) {
    modal('');
  }
}

function bannerHTML(v) {
  if (!v.result || (v.phase !== 'handover' && v.phase !== 'gameover')) return '';
  const name = seat => (seat === v.you ? 'You' : esc(v.players[seat].name));
  const won = new Map();
  for (const pot of contestedPots(v)) {
    const share = Math.floor(pot.amount / pot.winners.length);
    for (const w of pot.winners) won.set(w, (won.get(w) || 0) + share);
  }
  const winners = [...won.keys()];
  if (winners.length > 1) return `Split pot<small>${esc(v.result.hands[winners[0]]?.name || '')}</small>`;
  const w = winners[0];
  const verb = w === v.you ? 'win' : 'wins';
  const hand = v.result.foldWin ? '' : `<small>${esc(v.result.hands[w].name)}</small>`;
  return `${name(w)} ${verb} ${fmt(won.get(w))}${hand}`;
}

function renderActions(v) {
  const el = $('actions');
  const l = v.legal;
  const opp = v.players[1 - v.you];

  if (!l) {
    app.raise = null;
    let text = '';
    if (v.phase === 'handover') text = 'Next hand coming up…';
    else if (v.phase !== 'gameover' && v.toAct >= 0) text = `${esc(opp.name)} is thinking…`;
    el.innerHTML = `<div class="waiting ${v.toAct >= 0 ? 'pulse' : ''}">${text}</div>`;
    return;
  }

  const callAll = l.toCall >= v.players[v.you].chips;
  const middle = l.canCheck
    ? '<button class="btn" data-act="check">Check</button>'
    : `<button class="btn" data-act="call">${callAll ? 'All-in' : 'Call'} ${fmt(l.toCall)}</button>`;
  const raiseBtn = l.canRaise
    ? `<button class="btn primary" data-act="open-raise">${l.isBet ? 'Bet' : 'Raise'}</button>`
    : '<button class="btn primary" disabled>Raise</button>';

  let raiseBox = '';
  if (app.raise && l.canRaise) {
    const to = app.raise.to;
    const allIn = to === l.maxTo;
    raiseBox = `
      <div class="panel raise-box">
        <div class="raise-top"><span class="muted">${l.isBet ? 'Bet' : 'Raise to'}</span><b id="raise-val">${allIn ? 'ALL-IN ' : ''}${fmt(to)}</b></div>
        <input id="raise-range" type="range" min="0" max="1000" step="1" value="${toSlider(to, l)}" aria-label="Raise amount">
        <div class="presets">
          <button class="btn ghost" data-preset="min">Min</button>
          <button class="btn ghost" data-preset="half">½ Pot</button>
          <button class="btn ghost" data-preset="pot">Pot</button>
          <button class="btn ghost" data-preset="max">All-in</button>
        </div>
      </div>`;
  }

  const row = app.raise
    ? `<div class="row"><button class="btn ghost" data-act="close-raise">Back</button>
         <button class="btn primary" data-act="raise" style="grid-column: span 2">${l.isBet ? 'Bet' : 'Raise to'} ${fmt(app.raise.to)}</button></div>`
    : `<div class="row"><button class="btn" data-act="fold">Fold</button>${middle}${raiseBtn}</div>`;

  el.innerHTML = raiseBox + row;
}

const round10 = n => Math.round(n / 10) * 10;
function fromSlider(x, l) {
  if (x <= 0) return l.minTo;
  if (x >= 1000) return l.maxTo;
  return Math.min(l.maxTo, Math.max(l.minTo, round10(l.minTo + ((l.maxTo - l.minTo) * x) / 1000)));
}
const toSlider = (to, l) => (l.maxTo === l.minTo ? 1000 : Math.round(((to - l.minTo) / (l.maxTo - l.minTo)) * 1000));

function presetAmount(kind, v) {
  const l = v.legal;
  // Pot-sized raise: call first, then raise by the whole pot.
  const potAfterCall = v.pot + v.players.reduce((a, p) => a + p.bet, 0) + l.toCall;
  const target = { min: l.minTo, max: l.maxTo, half: v.currentBet + potAfterCall / 2, pot: v.currentBet + potAfterCall }[kind];
  return Math.min(l.maxTo, Math.max(l.minTo, kind === 'max' ? target : round10(target)));
}

/* ---------- Game over ---------- */
function gameOverModal(v, rematch) {
  const youWon = v.winner === v.you;
  const opp = v.players[1 - v.you].name;
  const waitingOnOpp = rematch[v.you] && !rematch[1 - v.you];
  const oppWants = rematch[1 - v.you] && !rematch[v.you];
  modal(`
    <h2 class="${youWon ? 'win' : 'lose'}">${youWon ? 'You win!' : `${esc(opp)} wins`}</h2>
    <p>${youWon ? `You took all the chips in ${v.handNo} hands.` : `Knocked out after ${v.handNo} hands.`}</p>
    ${oppWants ? `<p class="lit">${esc(opp)} wants a rematch!</p>` : ''}
    <button id="m-rematch" class="btn primary block" ${waitingOnOpp ? 'disabled' : ''}>${waitingOnOpp ? `Waiting for ${esc(opp)}…` : 'Rematch'}</button>
    <button id="m-leave" class="btn ghost block">Leave table</button>`,
  { 'm-rematch': sendRematch, 'm-leave': () => resetSession() });
}

/* ---------- Events ---------- */
$('actions').addEventListener('click', e => {
  const btn = e.target.closest('button');
  const v = app.view;
  if (!btn || !v?.legal) return;
  const l = v.legal;
  const { act: a, preset } = btn.dataset;
  if (preset) {
    app.raise = { to: presetAmount(preset, v) };
    renderActions(v);
  } else if (a === 'open-raise') {
    app.raise = { to: l.minTo };
    renderActions(v);
  } else if (a === 'close-raise') {
    app.raise = null;
    renderActions(v);
  } else if (a === 'raise') {
    sendAction('raise', app.raise.to);
  } else if (a) {
    sendAction(a);
  }
});

$('actions').addEventListener('input', e => {
  if (e.target.id !== 'raise-range' || !app.raise) return;
  const l = app.view.legal;
  app.raise.to = fromSlider(Number(e.target.value), l);
  const label = `${app.raise.to === l.maxTo ? 'ALL-IN ' : ''}${fmt(app.raise.to)}`;
  $('raise-val').textContent = label;
  $('actions').querySelector('[data-act="raise"]').textContent = `${l.isBet ? 'Bet' : 'Raise to'} ${fmt(app.raise.to)}`;
});

$('create').addEventListener('click', () => createTable());
$('join').addEventListener('click', () => joinTable($('code').value));
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') joinTable($('code').value); });
$('code').addEventListener('input', e => { e.target.value = normalizeCode(e.target.value); });
$('cancel').addEventListener('click', () => resetSession());
$('cancel-join').addEventListener('click', () => resetSession());
$('leave').addEventListener('click', () => {
  if (confirm('Leave the table? The game will end for both players.')) resetSession();
});

$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('wait-code').textContent); toast('Code copied'); } catch { toast('Copy failed'); }
});
$('share').addEventListener('click', async () => {
  const url = inviteLink();
  if (navigator.share) {
    try { await navigator.share({ title: "Texas Hold'em · Pocket Neon", text: "Play Texas Hold'em with me!", url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); } catch { prompt('Copy this link:', url); }
});

addEventListener('pagehide', () => app.room?.close());

/* ---------- Start ---------- */
$('name').value = store.get('name') || '';
const joinCode = normalizeCode(new URLSearchParams(location.hash.slice(1)).get('join'));
if (joinCode) {
  $('code').value = joinCode;
  if ($('name').value) joinTable(joinCode);
  else { $('lobby-msg').textContent = ''; $('name').focus(); $('join').classList.add("primary"); }
}
