// Checks deep.cpp against game.js and pnet.js: the same games, table-bot buckets, features, net outputs and gradients.
//   g++ -O3 -march=native -ffast-math -std=c++17 -pthread deep.cpp -o deep && node check-cpp.js deep-pnet-adv.json
'use strict';
const G = require('./game'), PN = require('./pnet'), { execFileSync } = require('child_process');
const wf = process.argv[2] || 'deep-pnet-adv.json', seed = 12345, games = 300;
const net = new PN.PNet(2); net.p.set(JSON.parse(require('fs').readFileSync(wf)).p);
const x = new Float32Array(PN.F), lines = [], r = G.rng(seed);
for (let i = 0; i < games; i++){
  const n = 2 + Math.floor(r() * 6), g = G.newGame(n, r);
  for (;;){
    PN.features(g, x); const o = net.forward(x);
    let fs = 0; for (let k = 0; k < PN.F; k++) fs += x[k] * (k % 7 + 1);
    lines.push([g.turn, g.deck[g.idx], g.pot, g.chips[g.turn], fs, o[0], o[1], G.keyOf(g)]);
    if (G.step(g, g.chips[g.turn] === 0 || r() < 0.4)) break;
  }
  for (let q = 0; q < n; q++) lines.push(['end', g.pts[q], g.chips[q], G.winShare(g, q)]);
}
net.d = { o: new Float32Array(2), t2: new Float32Array(64), t1: new Float32Array(64), tin: new Float32Array(4 * 32 + PN.TB), e2: new Float32Array(32), e1: new Float32Array(32) };
const gr = new Float64Array(net.n), r2 = G.rng(seed + 1), g = G.newGame(5, r2), c = net.cache();
for (let s = 0; s < 5; s++){ PN.features(g, x); net.forward(x, c); net.backward(x, c, [1, 0.5], gr); G.step(g, r2() < 0.5); }
let a = 0, b = 0; for (let k = 0; k < net.n; k++){ a += gr[k]; b += Math.abs(gr[k]) * (k % 13 + 1); }
const cpp = execFileSync(process.env.BIN || './deep', ['test', wf, String(seed), String(games)], { maxBuffer: 1 << 28 }).toString().trim().split('\n').map(l => l.split(' '));
let bad = 0, maxd = 0, steps = 0;
for (let i = 0; i < lines.length; i++){
  const J = lines[i], C = cpp[i];
  if (!C || J[0] === 'end' !== (C[0] === 'end')){ bad++; break; }
  if (J[0] === 'end'){ if (+C[1] !== J[1] || +C[2] !== J[2] || Math.abs(+C[3] - J[3]) > 1e-4) bad++; continue; }
  steps++;
  for (let k = 0; k < 4; k++) if (+C[k] !== J[k]) bad++;
  if (Math.abs(+C[4] - J[4]) > 1e-3 || +C[7] !== J[7]) bad++;
  for (let k = 5; k < 7; k++) maxd = Math.max(maxd, Math.abs(+C[k] - J[k]));
}
const cg = cpp[cpp.length - 1];
console.log(`${steps} states, ${bad} mismatches in the game or features, max output difference ${maxd.toExponential(2)}`);
console.log(`gradient: js ${a.toFixed(4)} ${b.toFixed(4)}, c++ ${(+cg[1]).toFixed(4)} ${(+cg[2]).toFixed(4)}`);
