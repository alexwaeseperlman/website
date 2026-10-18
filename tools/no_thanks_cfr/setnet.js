// The deep-set network: every player, the one to move included, goes through the same encoders, and a separate
// encoder reads the table.
//   card encoder (shared by all players):   their cards in a +-6 window around the current card + their full 33-card set -> 32
//   player encoder (shared by all players): card encoding, chips (sinusoidal + linear), seats from the mover (one-hot),
//                                           points, what taking the current card would cost them -> 32
//   table encoder:                          cards not seen yet (window + full set), the current card (one-hot), pot
//                                           (sinusoidal + linear), cards left, table size, the mover's cost -> 32
//   trunk:      [mover, sum of opponents, next player, table] -> 64 -> 64 -> regrets for take / pass
//   aux head:   each player [player, table] -> 32 -> 1, softmax over players = predicted share of the win for everyone
// The aux head is only a training signal (it makes the encoders learn who is winning); the bot reads the regrets.
// Gradients come from a small tape: each op records how to push gradients back through it.
'use strict';
const G = require('./game');

const MAXP = 7, PL = 35, F = 4 + 33 + MAXP * PL;   // flat input: c, pot, left, n, unseen set, then per player (from the mover): set, chips, points
const OFFS = []; for (let d = -6; d <= 6; d++) if (d) OFFS.push(d);
const sinus = (v, out, o) => { [4, 8, 16, 64].forEach((per, i) => { out[o + 2 * i] = Math.sin(2 * Math.PI * v / per); out[o + 2 * i + 1] = Math.cos(2 * Math.PI * v / per); }); };

function features(g, x){
  x.fill(0);
  const p = g.turn, c = g.deck[g.idx], n = g.n;
  x[0] = c; x[1] = g.pot; x[2] = G.left(g); x[3] = n;
  for (let v = 3; v <= 35; v++){
    let held = false;
    for (let q = 0; q < n; q++) if (g.has[q * 37 + v]){ held = true; break; }
    if (!held && v !== c) x[4 + v - 3] = 1;
  }
  for (let k = 0; k < n; k++){
    const q = (p + k) % n, o = 37 + k * PL;
    for (let v = 3; v <= 35; v++) if (g.has[q * 37 + v]) x[o + v - 3] = 1;
    x[o + 33] = g.chips[q]; x[o + 34] = g.pts[q];
  }
  return x;
}
// cost to player k of taking card c (from the flat input)
const costOf = (x, k) => { const o = 37 + k * PL, c = x[0]; const below = c > 3 && x[o + c - 4], above = c < 35 && x[o + c - 2]; return (below ? 0 : c) - (above ? c + 1 : 0) - x[1]; };

class SetNet {
  constructor(seed = 1){
    const dims = { c1: [45, 32], c2: [32, 32], p1: [32 + 8 + 1 + 7 + 3, 32], t1: [12 + 12 + 33 + 33 + 8 + 5, 32],
      h1: [128, 64], h2: [64, 64], h3: [64, 2], a1: [64, 32], a2: [32, 1] };
    let off = 0; this.L = {};
    for (const k in dims){ const [i, o] = dims[k]; this.L[k] = { i, o, w: off, b: off + i * o }; off += i * o + o; }
    this.n = off; this.p = new Float32Array(off); this.out = 2;
    let s = seed >>> 0 || 1; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (const k in this.L){ const L = this.L[k], lim = Math.sqrt(6 / L.i);
      for (let j = 0; j < L.i * L.o; j++) this.p[L.w + j] = (r() * 2 - 1) * lim;
      for (let j = 0; j < L.o; j++) this.p[L.b + j] = 0.01; }   // a small positive bias so empty hands (all-zero input) don't start dead
  }
  // ---- ops: values are Float32Arrays; with a tape, each op also records its backward step ----
  dense(L, x, relu){
    const p = this.p, y = new Float32Array(L.o);
    for (let j = 0; j < L.o; j++){ let s = p[L.b + j]; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++) s += p[row + k] * x[k]; y[j] = relu && s < 0 ? 0 : s; }
    if (this.tape){ const g = this.g; this.tape.push(() => {
      const dy = this.grad(y), dx = this.grad(x, true);
      for (let j = 0; j < L.o; j++){ let d = dy[j]; if (relu && y[j] <= 0) d = 0; if (d === 0) continue;
        g[L.b + j] += d; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++){ g[row + k] += d * x[k]; if (dx) dx[k] += p[row + k] * d; } }
    }); }
    return y;
  }
  concat(parts){
    let n = 0; for (const a of parts) n += a.length;
    const y = new Float32Array(n); let o = 0; const offs = [];
    for (const a of parts){ y.set(a, o); offs.push(o); o += a.length; }
    if (this.tape) this.tape.push(() => { const dy = this.grad(y); parts.forEach((a, i) => { const da = this.grad(a, true); if (da) for (let k = 0; k < a.length; k++) da[k] += dy[offs[i] + k]; }); });
    return y;
  }
  sum(parts, n){
    const y = new Float32Array(n); for (const a of parts) for (let k = 0; k < n; k++) y[k] += a[k];
    if (this.tape) this.tape.push(() => { const dy = this.grad(y); for (const a of parts){ const da = this.grad(a, true); if (da) for (let k = 0; k < n; k++) da[k] += dy[k]; } });
    return y;
  }
  grad(a, onlyIfTracked){ let d = this.grads.get(a); if (!d){ if (onlyIfTracked && !this.tracked.has(a)) return null; d = new Float32Array(a.length); this.grads.set(a, d); } return d; }
  track(a){ if (this.tape) this.tracked.add(a); return a; }

  // returns { reg: [take, pass], logits: per-player win logits }
  run(x){
    const c = x[0], pot = x[1], n = x[3], L = this.L;
    const emb = [];
    for (let k = 0; k < n; k++){
      const o = 37 + k * PL, ci = new Float32Array(45);
      OFFS.forEach((d, i) => { const v = c + d; if (v >= 3 && v <= 35) ci[i] = x[o + v - 3]; });
      for (let v = 0; v < 33; v++) ci[12 + v] = x[o + v];
      const ce = this.track(this.dense(L.c2, this.track(this.dense(L.c1, ci, true)), true));
      const side = new Float32Array(19);
      sinus(x[o + 33], side, 0); side[8] = x[o + 33] / 11; side[9 + k] = 1; side[16] = x[o + 34] / 100; side[17] = costOf(x, k) / 35; side[18] = 1;
      emb.push(this.track(this.dense(L.p1, this.track(this.concat([ce, side])), true)));
    }
    const ti = new Float32Array(L.t1.i);
    OFFS.forEach((d, i) => { const v = c + d; if (v >= 3 && v <= 35) ti[i] = x[4 + v - 3]; else ti[12 + i] = 1; });
    for (let v = 0; v < 33; v++) ti[24 + v] = x[4 + v];
    ti[57 + c - 3] = 1; sinus(pot, ti, 90); ti[98] = pot / 11; ti[99] = x[2] / 23; ti[100] = (n - 2) / 5; ti[101] = costOf(x, 0) / 35; ti[102] = 1;
    const tab = this.track(this.dense(L.t1, ti, true));
    const others = this.track(this.sum(emb.slice(1), 32));
    const h = this.track(this.concat([emb[0], others, emb[1], tab]));
    const reg = this.dense(L.h3, this.track(this.dense(L.h2, this.track(this.dense(L.h1, h, true)), true)), false);
    let logits = null;
    if (this.withAux) logits = emb.map(e => this.dense(L.a2, this.track(this.dense(L.a1, this.track(this.concat([e, tab])), true)), false));
    return { reg, logits };
  }
  forward(x){ this.tape = null; this.withAux = false; return this.run(x).reg; }
  // Y per sample: [regret take, regret pass, win share of player 0..6 (from the mover)]
  step(X, Y, Wt, B, _loss, lr = 1e-3, auxW = 0.3){
    if (!this.g) this.g = new Float32Array(this.n);
    this.g.fill(0);
    let wsum = 0; for (let b = 0; b < B; b++) wsum += Wt[b];
    const idx = Array.from({ length: B }, (_, b) => b);
    const total = this.accum(X, Y, Wt, idx, wsum, auxW);
    this.apply(this.g, lr);
    return total;
  }
  // add the gradients of examples idx (weights normalized by wsum) into this.g; returns their share of the loss.
  // Split from step() so several threads can each do part of a batch.
  accum(X, Y, Wt, idx, wsum, auxW = 0.3){
    if (!this.g) this.g = new Float32Array(this.n);
    let total = 0;
    for (const b of idx){
      const x = X.subarray(b * F, (b + 1) * F), y = Y.subarray(b * 9, (b + 1) * 9), w = Wt[b] / wsum, n = x[3];
      this.tape = []; this.grads = new Map(); this.tracked = new Set(); this.withAux = true;
      const { reg, logits } = this.run(x);
      this.tracked.add(reg); const dr = this.grad(reg);
      for (let j = 0; j < 2; j++){ const e = reg[j] - y[j]; dr[j] = 2 * w * e; total += w * e * e; }
      let mx = -Infinity; for (const l of logits) mx = Math.max(mx, l[0]);
      let z = 0; const ex = logits.map(l => { const e = Math.exp(l[0] - mx); z += e; return e; });
      for (let k = 0; k < n; k++){ const q = ex[k] / z; this.tracked.add(logits[k]); this.grad(logits[k])[0] = auxW * w * (q - y[2 + k]); }
      for (let i = this.tape.length - 1; i >= 0; i--) this.tape[i]();
    }
    this.tape = null;
    return total;
  }
  apply(g, lr){   // one Adam step with gradients g
    if (!this.m){ this.m = new Float32Array(this.n); this.v = new Float32Array(this.n); this.t = 0; }
    const b1 = 0.9, b2 = 0.999; this.t++;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t), p = this.p;
    for (let k = 0; k < this.n; k++){ const gk = g[k]; this.m[k] = b1 * this.m[k] + (1 - b1) * gk; this.v[k] = b2 * this.v[k] + (1 - b2) * gk * gk; p[k] -= lr * (this.m[k] / c1) / (Math.sqrt(this.v[k] / c2) + 1e-8); }
  }
}
module.exports = { SetNet, features, F, MAXP };
