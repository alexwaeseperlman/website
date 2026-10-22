// The neural-net bot (deep-<arch>.json or deep-<arch>-adv.json) against the table bot (policy.json) and the old rule of thumb.
//   node eval-deep.js [games per table size] [weights file]
'use strict';
const G = require('./game'), { MLP } = require('./nn'), S = require('./structnet'), SN = require('./setnet'), PN = require('./pnet');
const file = process.argv[3] || __dirname + '/deep-struct.json', W = require(file);
const net = W.arch === 'set' ? new SN.SetNet() : W.arch === 'pnet' ? new PN.PNet(W.out) : W.arch === 'pnetw' ? new PN.PNet(W.out, 1, 64, 128) : W.arch === 'struct' ? new S.StructNet(W.out) : new MLP([G.NFEAT, 64, 64, W.out]); net.p.set(W.p);
const M = { set: SN, struct: S, pnet: PN, pnetw: PN }[W.arch], feat = M === PN ? PN.featuresWithout(W.drop) : M ? M.features : G.features, x = new Float32Array(M ? M.F : G.NFEAT);
const deep = W.out === 1
  ? (g, r) => r() < 1 / (1 + Math.exp(-net.forward(feat(g, x))[0]))
  : (g, r) => { const o = net.forward(feat(g, x)), a = Math.max(o[0], 0), b = Math.max(o[1], 0); return r() < (a + b > 0 ? a / (a + b) : o[0] > o[1] ? 1 : 0); };
const table = G.policyBrain(require('./policy.json').map(p => p < 0 ? -1 : p / 100)), old = G.heuristic;
const games = +process.argv[2] || 10000, r = G.rng(2024);
const rate = (n, brainOf) => { let w = 0; for (let i = 0; i < games; i++){ const g = G.newGame(n, r); G.play(g, Array.from({ length: n }, (_, q) => brainOf(q)), r); w += G.winShare(g, 0); } return w / games; };
const pct = v => (v * 100).toFixed(1).padStart(5) + '%';
console.log('players  fair   net vs old   net vs table   table vs net');
for (const n of [2, 3, 4, 5, 6, 7])
  console.log(`${n}       ${pct(1 / n)}   ${pct(rate(n, q => q ? old : deep))}       ${pct(rate(n, q => q ? table : deep))}         ${pct(rate(n, q => q ? deep : table))}`);
