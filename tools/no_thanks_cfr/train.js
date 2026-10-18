// Trains the No Thanks! bots with Monte Carlo counterfactual regret minimization (CFR) by self-play.
//   node train.js [games per worker] [workers]   -> writes policy.json next to this file
// Every game, one seat is the learner. At each of its decisions it plays the game out both ways (take / no thanks)
// with the same luck, and the difference in how often it then wins is its regret for not having done that.
// Regret matching turns regrets into the current strategy; the average strategy over all games is the policy.
// Decisions are grouped into buckets (game.js) so the table stays small enough to ship.
'use strict';
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const G = require('./game');

if (isMainThread){
  const games = +process.argv[2] || 200000, workers = +process.argv[3] || require('os').cpus().length;
  const regret = new SharedArrayBuffer(G.KEYS * 2 * 8), avg = new SharedArrayBuffer(G.KEYS * 2 * 8);
  let done = 0; const t0 = Date.now();
  for (let w = 0; w < workers; w++){
    const wk = new Worker(__filename, { workerData: { games, seed: 12345 + w * 7919, regret, avg } });
    wk.on('message', m => { if (m === 'done'){ if (++done === workers) finish(); } else if (w === 0) console.log(`${m} games/worker, ${((Date.now() - t0) / 1000).toFixed(0)}s`); });
  }
  function finish(){
    const A = new Float64Array(avg), pol = [];
    let seen = 0;
    for (let k = 0; k < G.KEYS; k++){
      const take = A[k * 2], all = A[k * 2] + A[k * 2 + 1];
      if (all > 0){ seen++; pol.push(Math.round(take / all * 100)); } else pol.push(-1);
    }
    require('fs').writeFileSync(__dirname + '/policy.json', JSON.stringify(pol));
    console.log(`buckets seen ${seen}/${G.KEYS}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
} else {
  const { games, seed } = workerData, R = new Float64Array(workerData.regret), A = new Float64Array(workerData.avg);
  const r = G.rng(seed);
  const sigma = k => { const a = R[k * 2], b = R[k * 2 + 1]; return a + b > 0 ? a / (a + b) : 0.5; };   // P(take)
  const cur = (g, rr) => rr() < sigma(G.keyOf(g));
  const rollout = (g, take, seed) => {
    const rr = G.rng(seed); let over = G.step(g, take);
    while (!over) over = G.step(g, g.chips[g.turn] === 0 || cur(g, rr));
    return g;
  };
  const tables = [2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7];   // mostly the 3-5 player games people play
  for (let t = 1; t <= games; t++){
    const n = tables[Math.floor(r() * tables.length)], g = G.newGame(n, r), me = Math.floor(r() * n);
    for (;;){
      const p = g.turn;
      if (g.chips[p] === 0){ if (G.step(g, true)) break; continue; }
      const k = G.keyOf(g), s = sigma(k);
      if (p === me){
        const sd = (r() * 4294967296) >>> 0;
        const vt = G.winShare(rollout(G.clone(g), true, sd), me), vp = G.winShare(rollout(G.clone(g), false, sd), me);
        const v = s * vt + (1 - s) * vp;
        R[k * 2] = Math.max(0, R[k * 2] + vt - v); R[k * 2 + 1] = Math.max(0, R[k * 2 + 1] + vp - v);   // regret matching+
        A[k * 2] += t * s; A[k * 2 + 1] += t * (1 - s);                                                 // linear averaging
      }
      if (G.step(g, r() < s)) break;
    }
    if (t % 20000 === 0) parentPort.postMessage(t);
  }
  parentPort.postMessage('done');
}
