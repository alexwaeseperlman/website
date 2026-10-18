// Deep CFR for No Thanks!: the same self-play regret idea as train.js, but a neural net (nn.js) reads the raw table
// (game.js features) instead of a table of hand-made buckets.
//   node deep.js [iterations] [games per worker per iteration] [workers] [mlp|struct]   -> writes deep-<arch>.json
// (mlp: nn.js over game.js's flat features; struct: structnet.js, a card window and a shared opponent encoder)
// Each iteration: every seat plays from the advantage net's current strategy (regret matching on its predicted
// regrets). Some of one learner seat's decisions are played out both ways with the same luck, and the regrets
// (how much better each choice did than the mix) become training examples, weighted by the iteration number.
// The advantage net is then trained on all examples so far (a reservoir sample). Every seat's decisions are also
// recorded with the strategy used there; at the end a policy net learns that average strategy, and it's what ships.
'use strict';
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const G = require('./game'), { MLP } = require('./nn'), S = require('./structnet'), SN = require('./setnet');
const ARCHS = {
  mlp: { F: G.NFEAT, feat: G.features, make: (out, seed) => new MLP([G.NFEAT, 64, 64, out], seed) },
  struct: { F: S.F, feat: S.features, make: (out, seed) => new S.StructNet(out, seed) },
  // set: setnet.js. Its examples also carry every seat's expected win share (for the aux head), and it ships the
  // final regret net's strategy, so there's no separate average-policy net.
  set: { F: SN.F, feat: SN.features, make: (out, seed) => new SN.SetNet(seed), aux: true },
};

// regret matching on predicted regrets: P(take)
const sigmaOf = o => { const a = Math.max(o[0], 0), b = Math.max(o[1], 0); return a + b > 0 ? a / (a + b) : o[0] > o[1] ? 1 : 0; };

if (isMainThread){
  const T = +process.argv[2] || 40, games = +process.argv[3] || 2500, nw = +process.argv[4] || require('os').cpus().length;
  const arch = process.argv[5] || 'struct', A = ARCHS[arch], CAP = 1500000, F = A.F;
  const save = (name, net, out) => require('fs').writeFileSync(`${__dirname}/${name}`, JSON.stringify({ arch, out, p: Array.from(net.p, v => +v.toPrecision(5)) }));
  const sh = n => new Float32Array(new SharedArrayBuffer(n * 4));
  const buf = (k, cap = CAP) => ({ X: sh(cap * F), Y: sh(cap * k), W: sh(cap), size: 0, seen: 0, k });
  const adv = buf(A.aux ? 9 : 2), pol = buf(1, A.aux ? 1 : CAP);
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
  const workers = Array.from({ length: nw }, (_, w) => new Worker(__filename, { workerData: { seed: 4242 + w * 7919, arch, X: adv.X, Y: adv.Y, W: adv.W } }));
  const run = (wk, msg) => new Promise(res => { wk.once('message', res); wk.postMessage(msg); });
  // the shared-encoder net is slow to train, so each batch is split across the worker threads (they read the
  // examples straight from the shared buffer and send back gradients)
  const trainPar = async (net, B, steps, bs, lr) => {
    let L = 0; const g = new Float32Array(net.n);
    for (let s = 0; s < steps; s++){
      const idx = Int32Array.from({ length: bs }, () => Math.floor(rnd() * B.size));
      let wsum = 0; for (const j of idx) wsum += B.W[j];
      const parts = await Promise.all(workers.map((wk, i) => run(wk, { type: 'grad', p: net.p, idx: idx.filter((_, k) => k % nw === i), wsum })));
      g.fill(0); let tot = 0;
      for (const pr of parts){ for (let k = 0; k < g.length; k++) g[k] += pr.g[k]; tot += pr.total; }
      net.apply(g, lr); L = 0.98 * L + 0.02 * tot;
    }
    return L;
  };
  (async () => {
    const net = A.make(2, 11), t0 = Date.now();
    for (let t = 1; t <= T; t++){
      const outs = await Promise.all(workers.map(wk => run(wk, { type: 'play', p: net.p, games })));
      for (const o of outs){ add(adv, o.advX, o.advY, o.nAdv, t); add(pol, o.polX, o.polY, o.nPol, t); }
      const L = A.aux ? await trainPar(net, adv, +process.env.STEPS || 1500, 512, 1e-3) : train(net, adv, +process.env.STEPS || 1500, 512, 'mse', 1e-3);
      console.log(`iter ${t}/${T}: ${adv.size} regret examples, loss ${L.toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      save(`deep-${arch}-adv.json`, net, 2);
    }
    workers.forEach(w => w.terminate());
    if (A.aux){ console.log(`done, ${((Date.now() - t0) / 1000).toFixed(0)}s`); return; }
    const pnet = A.make(1, 12);
    for (let r = 0; r < 10; r++){ const L = train(pnet, pol, 2000, 512, 'bce', r < 7 ? 1e-3 : 3e-4); console.log(`policy net ${r + 1}/10: loss ${L.toFixed(4)}`); }
    save(`deep-${arch}.json`, pnet, 1);
    console.log(`done, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  })();
} else {
  const A = ARCHS[workerData.arch], r = G.rng(workerData.seed), net = A.make(2), F = A.F, x = new Float32Array(F);
  const tables = [2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7];
  const sigma = g => sigmaOf(net.forward(A.feat(g, x)));
  const rollout = (g, take, seed) => {
    const rr = G.rng(seed); let over = G.step(g, take);
    while (!over) over = G.step(g, g.chips[g.turn] === 0 || rr() < sigma(g));
    return g;
  };
  parentPort.on('message', ({ type, p, games, idx, wsum }) => {
    net.p.set(p);
    if (type === 'grad'){
      net.g = new Float32Array(net.n);
      const total = net.accum(workerData.X, workerData.Y, workerData.W, idx, wsum);
      parentPort.postMessage({ g: net.g, total }, [net.g.buffer]);
      return;
    }
    const advX = [], advY = [], polX = [], polY = [];
    for (let i = 0; i < games; i++){
      const n = tables[Math.floor(r() * tables.length)], g = G.newGame(n, r), me = Math.floor(r() * n);
      for (;;){
        if (g.chips[g.turn] === 0){ if (G.step(g, true)) break; continue; }
        const s = sigma(g);
        if (!A.aux && r() < 0.1){ polX.push(Float32Array.from(x)); polY.push(s); }
        if (g.turn === me && r() < 0.25){
          const feats = Float32Array.from(x), sd = (r() * 4294967296) >>> 0;
          const gt = rollout(G.clone(g), true, sd), gp = rollout(G.clone(g), false, sd);
          const vt = G.winShare(gt, me), vp = G.winShare(gp, me), v = s * vt + (1 - s) * vp;
          advX.push(feats); advY.push(vt - v, vp - v);
          if (A.aux) for (let k = 0; k < 7; k++){ const q = (me + k) % g.n; advY.push(k < g.n ? s * G.winShare(gt, q) + (1 - s) * G.winShare(gp, q) : 0); }
        }
        if (G.step(g, r() < s)) break;
      }
    }
    const flat = (rows) => { const out = new Float32Array(rows.length * F); rows.forEach((row, i) => out.set(row, i * F)); return out; };
    parentPort.postMessage({ advX: flat(advX), advY: Float32Array.from(advY), nAdv: advX.length, polX: flat(polX), polY: Float32Array.from(polY), nPol: polX.length });
  });
}
