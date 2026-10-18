// No Thanks! simulator, the bots' situation buckets, and the two bot brains (the old rule of thumb and the
// CFR policy). The bucket function here is copied into public/no_thanks/index.html and, in SQL, into
// tools/supabase/nothanks_schema.sql (nothanks_bot_key); check.js makes sure all three agree.
'use strict';

// a fast seeded RNG, so two rollouts can share the same luck
function rng(seed){
  let s = seed >>> 0 || 1;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  r.state = () => s; r.set = v => { s = v; };
  return r;
}

const chipsFor = n => n <= 5 ? 11 : n === 6 ? 9 : 7;

// ---- the situation a bot sees, squeezed into one of KEYS buckets ----
// cost: points the card adds minus the chips on it; my chips; chips on the card; whether the card fits one of my
// runs; whether it fits an opponent's; the poorest opponent's chips; cards left in the deck; table size.
const KEYS = 8 * 6 * 3 * 2 * 2 * 3 * 3 * 3;
function bucket(cost, chips, pot, fitsMine, fitsOpp, minOppChips, left, n){
  const cb = cost <= -4 ? 0 : cost <= -1 ? 1 : cost <= 2 ? 2 : cost <= 5 ? 3 : cost <= 9 ? 4 : cost <= 14 ? 5 : cost <= 20 ? 6 : 7;
  const mb = chips <= 1 ? 0 : chips === 2 ? 1 : chips <= 4 ? 2 : chips <= 7 ? 3 : chips <= 11 ? 4 : 5;
  const pb = pot <= 1 ? 0 : pot <= 4 ? 1 : 2;
  const ob = minOppChips === 0 ? 0 : minOppChips <= 3 ? 1 : 2;
  const lb = left >= 16 ? 0 : left >= 8 ? 1 : 2;
  const nb = n <= 3 ? 0 : n <= 5 ? 1 : 2;
  return ((((((cb * 6 + mb) * 3 + pb) * 2 + (fitsMine ? 1 : 0)) * 2 + (fitsOpp ? 1 : 0)) * 3 + ob) * 3 + lb) * 3 + nb;
}

// ---- game state: has[p*37 + card] = 1 when player p holds card ----
function newGame(n, r){
  const all = []; for (let c = 3; c <= 35; c++) all.push(c);
  for (let i = all.length - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const deck = all.slice(0, 24);
  const chips = new Int32Array(n).fill(chipsFor(n));
  return { n, deck, idx: 0, pot: 0, turn: Math.floor(r() * n), chips, has: new Uint8Array(n * 37), pts: new Int32Array(n) };
}
const clone = g => ({ n: g.n, deck: g.deck, idx: g.idx, pot: g.pot, turn: g.turn, chips: g.chips.slice(), has: g.has.slice(), pts: g.pts.slice() });
const addPts = (g, p, c) => (g.has[p * 37 + c - 1] ? 0 : c) - (g.has[p * 37 + c + 1] ? c + 1 : 0);
const left = g => g.deck.length - g.idx - 1;

function keyOf(g){
  const p = g.turn, c = g.deck[g.idx], o = p * 37;
  let fitsOpp = false, minOpp = 99;
  for (let q = 0; q < g.n; q++) if (q !== p){
    if (g.has[q * 37 + c - 1] || g.has[q * 37 + c + 1]) fitsOpp = true;
    if (g.chips[q] < minOpp) minOpp = g.chips[q];
  }
  return bucket(addPts(g, p, c) - g.pot, g.chips[p], g.pot, g.has[o + c - 1] || g.has[o + c + 1], fitsOpp, minOpp, left(g), g.n);
}

function step(g, take){   // returns true when the game is over
  const p = g.turn, c = g.deck[g.idx];
  if (!take){ g.chips[p]--; g.pot++; g.turn = (p + 1) % g.n; return false; }
  g.pts[p] += addPts(g, p, c); g.has[p * 37 + c] = 1; g.chips[p] += g.pot; g.pot = 0; g.idx++;
  return g.idx >= g.deck.length;
}

// share of the win for player p (ties split)
function winShare(g, p){
  let best = Infinity, k = 0;
  for (let q = 0; q < g.n; q++){ const s = g.pts[q] - g.chips[q]; if (s < best){ best = s; k = 1; } else if (s === best) k++; }
  return g.pts[p] - g.chips[p] === best ? 1 / k : 0;
}

// ---- brains: (g, r) => take? ----
// the old rule of thumb (same as the site's bots before CFR)
function heuristic(g, r){
  const p = g.turn, c = g.deck[g.idx], chips = g.chips[p], o = p * 37;
  if (chips === 0) return true;
  const cost = addPts(g, p, c) - g.pot, fits = g.has[o + c - 1] || g.has[o + c + 1];
  if (fits && cost <= 0 && g.pot < g.n && r() < 0.5) return false;
  const limit = chips <= 2 ? 12 : chips <= 4 ? 7 : chips <= 7 ? 3 : 0;
  return cost <= limit + (r() < 0.2 ? 2 : 0);
}
// a policy table: probability of taking per bucket (NaN or negative = never seen, fall back to the rule of thumb)
const policyBrain = pol => (g, r) => {
  if (g.chips[g.turn] === 0) return true;
  const p = pol[keyOf(g)];
  return p >= 0 ? r() < p : heuristic(g, r);
};

function play(g, brains, r){ while (!step(g, g.chips[g.turn] === 0 || brains[g.turn](g, r))); return g; }

module.exports = { rng, chipsFor, KEYS, bucket, newGame, clone, keyOf, step, winShare, heuristic, policyBrain, play, addPts, left };
