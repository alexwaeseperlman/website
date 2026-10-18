// Deep CFR for No Thanks!: the same self-play regret idea as train.js, but a neural net (nn.js) reads the raw table
// (game.js features) instead of a table of hand-made buckets.
//   node deep.js [iterations] [games per worker per iteration] [workers]   -> writes deep.json next to this file
// Each iteration: every seat plays from the advantage net's current strategy (regret matching on its predicted
// regrets). Some of one learner seat's decisions are played out both ways with the same luck, and the regrets
// (how much better each choice did than the mix) become training examples, weighted by the iteration number.
// The advantage net is then trained on all examples so far (a reservoir sample). Every seat's decisions are also
// recorded with the strategy used there; at the end a policy net learns that average strategy, and it's what ships.
'use strict';
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const G = require('./game'), { MLP } = require('./nn');
const SIZES_ADV = [G.NFEAT, 64, 64, 2], SIZES_POL = [G.NFEAT, 64, 64, 1];

// regret matching on predicted regrets: P(take)
const sigmaOf = o => { const a = Math.max(o[0], 0), b = Math.max(o[1], 0); return a + b > 0 ? a / (a + b) : o[0] > o[1] ? 1 : 0; };

if (isMainThread){
  const T = +process.argv[2] || 40, games = +process.argv[3] || 2500, nw = +process.argv[4] || require('os').cpus().length;
  const CAP = 1500000, F = G.NFEAT;
  const buf = (k) => ({ X: new Float32Array(CAP * F), Y: new Float32Array(CAP * k), W: new Float32Array(CAP), size: 0, seen: 0, k });
  const adv = buf(2), pol = buf(1);
  let rs = 987654321; const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
  const add = (B, X, Y, n, w) => { for (let i = 0; i < n; i++){
    const j = B.size < CAP ? B.size++ : Math.floor(rnd() * (B.seen + 1)); B.seen++;
    if (j < CAP){ B.X.set(X.subarray(i * F, (i + 1) * F), j * F); B.Y.set(Y.subarray(i * B.k, (i + 1) * B.k), j * B.k); B.W[j] = w; } } };
  const train = (net, B, steps, bs, loss, lr) => {
    const X = new Float32Array(bs * F), Y = new Float32Array(bs * B.k), W = new Float32Array(bs); let L = 0;
    for (let s = 0; s < steps; s++){
      for (let b = 0; b < bs; b++){ const j = Math.floor(rnd() * B.size); X.set(B.X.subarray(j * F, (j + 1) * F), b * F); Y.set(B.Y.subarray(j * B.k, (j + 1) * B.k), b * B.k); W[b] = B.W[j]; }
      L = 0.98 * L + 0.02 * net.step(X, Y, W, bs, loss, lr);
    }
    return L;
  };
  const workers = Array.from({ length: nw }, (_, w) => new Worker(__filename, { workerData: { seed: 4242 + w * 7919 } }));
  const run = (wk, msg) => new Promise(res => { wk.once('message', res); wk.postMessage(msg); });
  (async () => {
    const net = new MLP(SIZES_ADV, 11), t0 = Date.now();
    for (let t = 1; t <= T; t++){
      const outs = await Promise.all(workers.map(wk => run(wk, { p: net.p, games })));
      for (const o of outs){ add(adv, o.advX, o.advY, o.nAdv, t); add(pol, o.polX, o.polY, o.nPol, t); }
      const L = train(net, adv, 1500, 512, 'mse', 1e-3);
      console.log(`iter ${t}/${T}: ${adv.size} regret examples, loss ${L.toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      require('fs').writeFileSync(__dirname + '/deep-adv.json', JSON.stringify({ sizes: SIZES_ADV, p: Array.from(net.p) }));
    }
    workers.forEach(w => w.terminate());
    const pnet = new MLP(SIZES_POL, 12);
    for (let r = 0; r < 10; r++){ const L = train(pnet, pol, 2000, 512, 'bce', r < 7 ? 1e-3 : 3e-4); console.log(`policy net ${r + 1}/10: loss ${L.toFixed(4)}`); }
    require('fs').writeFileSync(__dirname + '/deep.json', JSON.stringify({ sizes: SIZES_POL, p: Array.from(pnet.p, v => +v.toPrecision(5)) }));
    console.log(`done, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  })();
} else {
  const r = G.rng(workerData.seed), net = new MLP(SIZES_ADV), F = G.NFEAT, x = new Float32Array(F);
  const tables = [2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7];
  const sigma = g => sigmaOf(net.forward(G.features(g, x)));
  const rollout = (g, take, seed) => {
    const rr = G.rng(seed); let over = G.step(g, take);
    while (!over) over = G.step(g, g.chips[g.turn] === 0 || rr() < sigma(g));
    return g;
  };
  parentPort.on('message', ({ p, games }) => {
    net.p.set(p);
    const advX = [], advY = [], polX = [], polY = [];
    for (let i = 0; i < games; i++){
      const n = tables[Math.floor(r() * tables.length)], g = G.newGame(n, r), me = Math.floor(r() * n);
      for (;;){
        if (g.chips[g.turn] === 0){ if (G.step(g, true)) break; continue; }
        const s = sigma(g);
        if (r() < 0.1){ polX.push(Float32Array.from(x)); polY.push(s); }
        if (g.turn === me && r() < 0.25){
          const feats = Float32Array.from(x), sd = (r() * 4294967296) >>> 0;
          const vt = G.winShare(rollout(G.clone(g), true, sd), me), vp = G.winShare(rollout(G.clone(g), false, sd), me), v = s * vt + (1 - s) * vp;
          advX.push(feats); advY.push(vt - v, vp - v);
        }
        if (G.step(g, r() < s)) break;
      }
    }
    const flat = (rows) => { const out = new Float32Array(rows.length * F); rows.forEach((row, i) => out.set(row, i * F)); return out; };
    parentPort.postMessage({ advX: flat(advX), advY: Float32Array.from(advY), nAdv: advX.length, polX: flat(polX), polY: Float32Array.from(polY), nPol: polX.length });
  });
}
