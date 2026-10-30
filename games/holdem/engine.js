// No-limit Texas Hold'em tournament rules. Pure game state, no DOM or network.
// The host owns the full state (including the deck) and sends each player
// only what they may see via viewFor().

import { bestHand, RANKS, SUITS } from './evaluator.js';

export const START_CHIPS = 10000;
export const HANDS_PER_LEVEL = 8;
export const BLIND_LEVELS = [
  [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [500, 1000],
  [700, 1400], [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000], [5000, 10000],
];

const BETTING = new Set(['preflop', 'flop', 'turn', 'river']);

export function blindsForHand(handNo) {
  const played = Math.max(handNo - 1, 0);
  const level = Math.min(Math.floor(played / HANDS_PER_LEVEL), BLIND_LEVELS.length - 1);
  const [sb, bb] = BLIND_LEVELS[level];
  const last = level === BLIND_LEVELS.length - 1;
  return { level: level + 1, sb, bb, handsLeft: last ? null : HANDS_PER_LEVEL - (played % HANDS_PER_LEVEL) };
}

export function shuffledDeck(rand = Math.random) {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createGame(seats, { startChips = START_CHIPS } = {}) {
  return {
    players: seats.map(({ name }) => ({
      name, chips: startChips, hole: [], bet: 0, total: 0, folded: false, allIn: false, out: false,
    })),
    handNo: 0,
    dealer: -1,
    sbSeat: -1,
    bbSeat: -1,
    phase: 'waiting', // preflop | flop | turn | river | handover | gameover
    blinds: null,
    deck: [],
    board: [],
    toAct: -1,
    currentBet: 0,
    minRaise: 0,
    acted: [],
    reveal: false,
    lastAction: null,
    result: null,
    winner: -1,
  };
}

const inHand = p => !p.out && !p.folded;
const canAct = p => inHand(p) && !p.allIn;

function nextSeat(s, from, pred) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (pred(s.players[i], i)) return i;
  }
  return -1;
}

function pay(p, amount) {
  const x = Math.min(amount, p.chips);
  p.chips -= x;
  p.bet += x;
  p.total += x;
  if (p.chips === 0) p.allIn = true;
}

// `deck` lets tests stack the deck; cards are dealt from the end.
export function startHand(s, { rand = Math.random, deck } = {}) {
  if (s.phase === 'gameover') return;
  s.handNo++;
  s.dealer = nextSeat(s, s.dealer < 0 ? s.players.length - 1 : s.dealer, p => !p.out);
  for (const p of s.players) Object.assign(p, { hole: [], bet: 0, total: 0, folded: p.out, allIn: false });
  Object.assign(s, {
    blinds: blindsForHand(s.handNo), deck: deck ? [...deck] : shuffledDeck(rand), board: [],
    reveal: false, lastAction: null, result: null,
  });

  const active = s.players.filter(p => !p.out).length;
  // Heads-up: the dealer posts the small blind and acts first preflop.
  s.sbSeat = active === 2 ? s.dealer : nextSeat(s, s.dealer, p => !p.out);
  s.bbSeat = nextSeat(s, s.sbSeat, p => !p.out);
  pay(s.players[s.sbSeat], s.blinds.sb);
  pay(s.players[s.bbSeat], s.blinds.bb);

  for (let round = 0; round < 2; round++) {
    let i = s.sbSeat;
    for (let k = 0; k < active; k++) {
      s.players[i].hole.push(s.deck.pop());
      i = nextSeat(s, i, p => !p.out);
    }
  }

  s.currentBet = Math.max(...s.players.map(p => p.bet));
  s.minRaise = s.blinds.bb;
  s.acted = s.players.map(() => false);
  s.phase = 'preflop';
  progress(s, s.bbSeat);
}

// What seat i may do right now, or null if it isn't their turn.
export function legalActions(s, i) {
  if (!BETTING.has(s.phase) || s.toAct !== i) return null;
  const p = s.players[i];
  const toCall = Math.min(s.currentBet - p.bet, p.chips);
  const maxTo = p.bet + p.chips;
  const opponentCanAct = s.players.some((q, j) => j !== i && canAct(q));
  // A player who already acted can't re-raise after a short all-in (not a full raise).
  const canRaise = !s.acted[i] && opponentCanAct && maxTo > s.currentBet;
  return {
    toCall,
    canCheck: toCall === 0,
    canRaise,
    minTo: Math.min(s.currentBet + s.minRaise, maxTo),
    maxTo,
    isBet: s.currentBet === 0,
  };
}

// type: fold | check | call | raise (amount = total bet this street, "raise to").
export function act(s, i, type, amount = 0) {
  const legal = legalActions(s, i);
  if (!legal) return false;
  const p = s.players[i];
  let label = type;

  switch (type) {
    case 'fold':
      p.folded = true;
      break;
    case 'check':
      if (!legal.canCheck) return false;
      break;
    case 'call':
      if (legal.toCall <= 0) return false;
      pay(p, legal.toCall);
      break;
    case 'raise': {
      const to = Math.round(amount);
      if (!legal.canRaise || !(to >= legal.minTo && to <= legal.maxTo)) return false;
      if (legal.isBet) label = 'bet';
      pay(p, to - p.bet);
      const increment = to - s.currentBet;
      if (increment >= s.minRaise) {
        s.minRaise = increment;
        s.acted = s.acted.map(() => false); // full raise reopens the action
      }
      s.currentBet = to;
      break;
    }
    default:
      return false;
  }

  if (p.allIn && type !== 'fold') label = 'allin';
  s.acted[i] = true;
  s.lastAction = { seat: i, type: label, amount: p.bet };
  progress(s, i);
  return true;
}

function progress(s, from) {
  if (s.players.filter(inHand).length === 1) return awardFoldWin(s);

  const pending = (p, j) => canAct(p) && (!s.acted[j] || p.bet < s.currentBet);
  const actors = s.players.filter(canAct);
  let done = !s.players.some(pending);
  // Last player with chips facing no bet: nobody left to bet against.
  if (!done && actors.length === 1 && actors[0].bet >= s.currentBet) done = true;

  if (!done) {
    s.toAct = nextSeat(s, from, pending);
    return;
  }

  for (const p of s.players) p.bet = 0;
  s.currentBet = 0;
  s.minRaise = s.blinds.bb;
  s.acted = s.players.map(() => false);
  s.toAct = -1;

  if (s.players.filter(canAct).length < 2) {
    // All-in: show hands and run out the board.
    s.reveal = true;
    while (s.board.length < 5) dealStreet(s);
    return showdown(s);
  }
  if (s.board.length === 5) return showdown(s);
  dealStreet(s);
  s.toAct = nextSeat(s, s.dealer, canAct);
}

function dealStreet(s) {
  s.deck.pop(); // burn
  const n = s.board.length === 0 ? 3 : 1;
  for (let k = 0; k < n; k++) s.board.push(s.deck.pop());
  s.phase = { 3: 'flop', 4: 'turn', 5: 'river' }[s.board.length];
}

const potTotal = s => s.players.reduce((a, p) => a + p.total, 0);

function awardFoldWin(s) {
  const seat = s.players.findIndex(inHand);
  const amount = potTotal(s);
  s.players[seat].chips += amount;
  s.result = { foldWin: true, pots: [{ amount, winners: [seat], contested: true }], hands: {} };
  endHand(s);
}

// Main pot + side pots from each player's total contribution.
export function buildPots(players) {
  const levels = [...new Set(players.filter(inHand).map(p => p.total))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.total, level) - prev);
    const eligible = players.flatMap((p, j) => (inHand(p) && p.total >= level ? [j] : []));
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  const extra = players.reduce((a, p) => a + Math.max(0, p.total - prev), 0);
  if (extra && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}

function showdown(s) {
  s.reveal = true;
  const hands = {};
  s.players.forEach((p, j) => {
    if (inHand(p)) hands[j] = bestHand([...p.hole, ...s.board]);
  });

  const pots = buildPots(s.players).map(({ amount, eligible }) => {
    const top = Math.max(...eligible.map(j => hands[j].score));
    // Seat order starting left of the dealer, so odd chips go there first.
    const n = s.players.length;
    const fromDealer = j => (((j - s.dealer - 1) % n) + n) % n;
    const winners = eligible
      .filter(j => hands[j].score === top)
      .sort((a, b) => fromDealer(a) - fromDealer(b));
    const share = Math.floor(amount / winners.length);
    let odd = amount - share * winners.length;
    for (const j of winners) s.players[j].chips += share + (odd-- > 0 ? 1 : 0);
    // A pot only one player could win is an uncalled bet being returned.
    return { amount, winners, contested: eligible.length > 1 };
  });

  s.result = {
    foldWin: false,
    pots,
    hands: Object.fromEntries(Object.entries(hands).map(([j, h]) => [j, { name: h.name, cards: h.cards }])),
  };
  endHand(s);
}

function endHand(s) {
  for (const p of s.players) p.bet = 0;
  s.toAct = -1;
  s.phase = 'handover';
  for (const p of s.players) if (p.chips === 0) p.out = true;
  const left = s.players.flatMap((p, j) => (p.out ? [] : [j]));
  if (left.length <= 1) {
    s.phase = 'gameover';
    s.winner = left[0] ?? -1;
  }
}

// Everything seat `i` is allowed to see.
export function viewFor(s, i) {
  return {
    you: i,
    handNo: s.handNo,
    phase: s.phase,
    dealer: s.dealer,
    sbSeat: s.sbSeat,
    bbSeat: s.bbSeat,
    blinds: s.blinds,
    board: [...s.board],
    pot: potTotal(s) - s.players.reduce((a, p) => a + p.bet, 0),
    currentBet: s.currentBet,
    toAct: s.toAct,
    lastAction: s.lastAction,
    result: s.result,
    winner: s.winner,
    players: s.players.map((p, j) => ({
      name: p.name,
      chips: p.chips,
      bet: p.bet,
      folded: p.folded,
      allIn: p.allIn,
      out: p.out,
      hole: j === i || (s.reveal && inHand(p)) ? [...p.hole] : p.hole.map(() => null),
    })),
    legal: legalActions(s, i),
  };
}
