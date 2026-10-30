import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestHand } from '../games/holdem/evaluator.js';
import {
  createGame, startHand, act, legalActions, viewFor, buildPots, blindsForHand, shuffledDeck,
} from '../games/holdem/engine.js';

const hand = s => bestHand(s.split(' '));

// Deck whose deal order (heads-up, seat 0 = dealer on hand 1) is:
// s0, s1, s0, s1, burn, flop x3, burn, turn, burn, river
function stacked(order) {
  const cards = order.split(' ');
  const rest = shuffledDeck().filter(c => !cards.includes(c));
  return [...rest, ...cards.reverse()];
}
const BURN = ['2c', '3c', '4c'];
function deal(p0, p1, board) {
  const [f1, f2, f3, t, r] = board.split(' ');
  const [a, b] = p0.split(' ');
  const [c, d] = p1.split(' ');
  return stacked([a, c, b, d, BURN[0], f1, f2, f3, BURN[1], t, BURN[2], r].join(' '));
}
const newGame = (chips) => createGame([{ name: 'A' }, { name: 'B' }], chips ? { startChips: chips } : {});
const chips = s => s.players.map(p => p.chips);

test('hand ranking order', () => {
  const order = [
    'As Ks Qs Js Ts', // royal
    '9h 8h 7h 6h 5h', // straight flush
    'Qd Qc Qh Qs 2d', // quads
    'Kd Kc Kh 2s 2d', // full house
    'Ad 9d 7d 4d 2d', // flush
    'Ts 9h 8d 7c 6s', // straight
    '5s 4h 3d 2c Ah', // wheel
    '7s 7h 7d Kc 2s', // trips
    'Js Jh 4d 4c As', // two pair
    'Js Jh 9d 4c 2s', // pair
    'As Qh 9d 4c 2s', // high card
  ].map(hand);
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1].score > order[i].score, `${order[i - 1].name} > ${order[i].name}`);
  assert.equal(order[0].name, 'Royal Flush');
  assert.equal(order[3].name, 'Kings full of Twos');
  assert.equal(order[6].name, 'Straight, Five high');
  assert.equal(order[8].name, 'Two Pair, Jacks & Fours');
});

test('best of seven picks the right five and kickers', () => {
  assert.equal(hand('Ah Kh 2c 2d 7h 9h 3h').name, 'Flush, Ace high');
  assert.equal(hand('As Kd Ah Ac 5s 5d 2c').score, hand('As Qd Ah Ac 5s 5d 2c').score);
  assert.ok(hand('Ks Kd Ah 9c 5s 3d 2c').score > hand('Ks Kd Qh 9c 5s 3d 2c').score);
});

test('blinds rise every 8 hands', () => {
  assert.deepEqual([blindsForHand(1).sb, blindsForHand(1).bb], [100, 200]);
  assert.equal(blindsForHand(8).level, 1);
  assert.equal(blindsForHand(9).level, 2);
  assert.equal(blindsForHand(9).bb, 300);
  assert.equal(blindsForHand(1).handsLeft, 8);
  assert.equal(blindsForHand(8).handsLeft, 1);
});

test('heads-up: dealer posts SB and acts first preflop, BB acts first after the flop', () => {
  const s = newGame();
  startHand(s, { deck: deal('Ah Kh', '7c 2d', 'Qs Jd 3h 8s 9c') });
  assert.equal(s.dealer, 0);
  assert.deepEqual(chips(s), [9900, 9800]);
  assert.equal(s.toAct, 0);
  assert.ok(act(s, 0, 'call'));
  assert.equal(s.toAct, 1, 'BB gets the option');
  assert.ok(act(s, 1, 'check'));
  assert.equal(s.phase, 'flop');
  assert.equal(s.toAct, 1, 'non-dealer acts first postflop');
});

test('fold gives the pot to the other player', () => {
  const s = newGame();
  startHand(s);
  act(s, 0, 'fold');
  assert.equal(s.phase, 'handover');
  assert.deepEqual(chips(s), [9900, 10100]);
  assert.ok(s.result.foldWin);
});

test('checked-down hand goes to showdown and best hand wins', () => {
  const s = newGame();
  startHand(s, { deck: deal('Ah Ad', 'Kc Kd', '2s 7h 9d Jc 4s') });
  act(s, 0, 'call');
  act(s, 1, 'check');
  for (const street of ['flop', 'turn', 'river']) {
    assert.equal(s.phase, street);
    act(s, 1, 'check');
    act(s, 0, 'check');
  }
  assert.equal(s.phase, 'handover');
  assert.deepEqual(chips(s), [10200, 9800]);
  assert.equal(s.result.hands[0].name, 'Pair of Aces');
});

test('split pot', () => {
  const s = newGame();
  startHand(s, { deck: deal('2h 3d', '2c 3s', 'As Ks Qd Jh Tc') });
  act(s, 0, 'call');
  act(s, 1, 'check');
  for (let k = 0; k < 3; k++) { act(s, 1, 'check'); act(s, 0, 'check'); }
  assert.deepEqual(chips(s), [10000, 10000]);
  assert.deepEqual(s.result.pots[0].winners.sort(), [0, 1]);
});

test('raise rules: min raise, re-raise, and illegal amounts rejected', () => {
  const s = newGame();
  startHand(s);
  const l = legalActions(s, 0);
  assert.equal(l.toCall, 100);
  assert.equal(l.minTo, 400);
  assert.equal(l.maxTo, 10000);
  assert.equal(act(s, 0, 'raise', 300), false, 'below min raise');
  assert.ok(act(s, 0, 'raise', 600));
  assert.equal(legalActions(s, 1).minTo, 1000, 'min re-raise = previous raise size');
  assert.ok(act(s, 1, 'raise', 1000));
  assert.equal(act(s, 1, 'check'), false, 'not your turn');
  assert.equal(act(s, 0, 'check'), false, 'cannot check facing a bet');
  assert.ok(act(s, 0, 'call'));
  assert.equal(s.phase, 'flop');
  assert.equal(viewFor(s, 0).pot, 2000);
});

test('all-in and call runs out the board; elimination ends the game', () => {
  const s = newGame();
  startHand(s, { deck: deal('Ah Ad', 'Kc Kd', '2s 7h 9d Jc 4s') });
  act(s, 0, 'raise', 10000);
  assert.ok(s.players[0].allIn);
  act(s, 1, 'call');
  assert.equal(s.board.length, 5);
  assert.equal(s.phase, 'gameover');
  assert.equal(s.winner, 0);
  assert.deepEqual(chips(s), [20000, 0]);
});

test('uncalled part of a bigger all-in is returned (side pot)', () => {
  const s = newGame();
  s.players[1].chips = 3000;
  startHand(s, { deck: deal('Kc Kd', 'Ah Ad', '2s 7h 9d Jc 4s') });
  act(s, 0, 'raise', 10000);
  act(s, 1, 'call'); // all-in for 3000 total
  assert.deepEqual(chips(s), [7000, 6000]);
  assert.equal(s.phase, 'handover');
});

test('short all-in does not reopen raising', () => {
  const s = newGame();
  s.players[1].chips = 700;
  startHand(s);
  act(s, 0, 'raise', 600);
  // B can only go all-in to 700: increment 100 < min raise 400
  assert.ok(act(s, 1, 'raise', 700));
  const l = legalActions(s, 0);
  assert.equal(l.toCall, 100);
  assert.equal(l.canRaise, false);
});

test('buildPots splits main and side pots', () => {
  const players = [
    { total: 100, folded: false, out: false },
    { total: 300, folded: false, out: false },
    { total: 300, folded: true, out: false },
    { total: 500, folded: false, out: false },
  ];
  assert.deepEqual(buildPots(players), [
    { amount: 400, eligible: [0, 1, 3] },
    { amount: 600, eligible: [1, 3] },
    { amount: 200, eligible: [3] },
  ]);
});

test('view hides the opponent cards and the deck', () => {
  const s = newGame();
  startHand(s);
  const v = viewFor(s, 1);
  assert.equal(v.players[1].hole.length, 2);
  assert.ok(v.players[1].hole.every(Boolean));
  assert.deepEqual(v.players[0].hole, [null, null]);
  assert.equal(v.deck, undefined);
  assert.equal(v.legal, null);
  assert.ok(viewFor(s, 0).legal);
});

test('chips are conserved over many random hands', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let g = 0; g < 30; g++) {
    const s = newGame();
    while (s.phase !== 'gameover' && s.handNo < 500) {
      startHand(s, { rand });
      while (s.toAct >= 0) {
        const l = legalActions(s, s.toAct);
        const r = rand();
        if (r < 0.15 && !l.canCheck) act(s, s.toAct, 'fold');
        else if (r < 0.35 && l.canRaise) act(s, s.toAct, 'raise', r < 0.2 ? l.maxTo : l.minTo);
        else act(s, s.toAct, l.canCheck ? 'check' : 'call');
      }
      assert.equal(chips(s).reduce((a, b) => a + b), 20000);
    }
  }
});
