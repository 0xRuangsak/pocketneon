// Poker hand evaluation: best 5-card hand out of 5–7 cards.
// Cards are 2-char strings: rank ("23456789TJQKA") + suit ("shdc"), e.g. "As", "Td".

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export const rankValue = card => RANKS.indexOf(card[0]) + 2;

const RANK_NAMES = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
  9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const plural = v => (v === 6 ? 'Sixes' : `${RANK_NAMES[v]}s`);

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

// Scores exactly five cards. Higher `score` wins; equal scores tie.
export function scoreFive(cards) {
  const vals = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every(c => c[1] === cards[0][1]);

  let straightHigh = 0;
  if (new Set(vals).size === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) straightHigh = 5; // wheel: A-2-3-4-5
  }

  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  // Groups ordered by size, then rank: [[value, count], ...]
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map(g => g[0]);

  let cat, kick;
  if (straightHigh && flush) [cat, kick] = [8, [straightHigh]];
  else if (groups[0][1] === 4) [cat, kick] = [7, byGroup];
  else if (groups[0][1] === 3 && groups[1][1] === 2) [cat, kick] = [6, byGroup];
  else if (flush) [cat, kick] = [5, vals];
  else if (straightHigh) [cat, kick] = [4, [straightHigh]];
  else if (groups[0][1] === 3) [cat, kick] = [3, byGroup];
  else if (groups[0][1] === 2 && groups[1][1] === 2) [cat, kick] = [2, byGroup];
  else if (groups[0][1] === 2) [cat, kick] = [1, byGroup];
  else [cat, kick] = [0, vals];

  let score = cat;
  for (let k = 0; k < 5; k++) score = score * 15 + (kick[k] || 0);
  return { score, cat, kick };
}

export function describe(cat, kick) {
  const [a, b] = kick;
  switch (cat) {
    case 8: return a === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[a]} high`;
    case 7: return `Four ${plural(a)}`;
    case 6: return `${plural(a)} full of ${plural(b)}`;
    case 5: return `Flush, ${RANK_NAMES[a]} high`;
    case 4: return `Straight, ${RANK_NAMES[a]} high`;
    case 3: return `Three ${plural(a)}`;
    case 2: return `Two Pair, ${plural(a)} & ${plural(b)}`;
    case 1: return `Pair of ${plural(a)}`;
    default: return `${RANK_NAMES[a]} high`;
  }
}

function* combos(cards, k, start = 0, picked = []) {
  if (picked.length === k) { yield picked; return; }
  for (let i = start; i <= cards.length - (k - picked.length); i++) {
    yield* combos(cards, k, i + 1, [...picked, cards[i]]);
  }
}

// Best hand from 5–7 cards: { score, cat, name, cards }.
export function bestHand(cards) {
  let best = null;
  for (const five of combos(cards, 5)) {
    const s = scoreFive(five);
    if (!best || s.score > best.score) best = { ...s, cards: five };
  }
  best.name = describe(best.cat, best.kick);
  return best;
}
