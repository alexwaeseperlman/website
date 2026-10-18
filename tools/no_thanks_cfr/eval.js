// How often a CFR bot wins at a table of the old rule-of-thumb bots, and vice versa.
//   node eval.js [games per table size]
'use strict';
const G = require('./game');
const pol = require('./policy.json').map(p => p < 0 ? -1 : p / 100);
const cfr = G.policyBrain(pol), old = G.heuristic, games = +process.argv[2] || 20000, r = G.rng(99);
const rate = (n, brainOf) => { let w = 0; for (let i = 0; i < games; i++){ const g = G.newGame(n, r); G.play(g, Array.from({ length: n }, (_, q) => brainOf(q)), r); w += G.winShare(g, 0); } return w / games; };
console.log('players  fair  1 CFR vs old bots  1 old vs CFR bots');
for (const n of [2, 3, 4, 5, 6, 7]){
  const a = rate(n, q => q === 0 ? cfr : old), b = rate(n, q => q === 0 ? old : cfr);
  console.log(`${n}        ${(100 / n).toFixed(0).padStart(3)}%  ${(a * 100).toFixed(1).padStart(10)}%  ${(b * 100).toFixed(1).padStart(15)}%`);
}
