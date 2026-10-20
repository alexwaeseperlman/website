// The player network: a mix of structnet.js (cheap, explicit card costs) and setnet.js (every player through one
// shared encoder). Every player, the one to move included, is described the same way and goes through the same
// encoder; the opponents are pooled both by sum and by max (so "someone is about to run out of chips" stands out),
// and the mover and the next player (who sees the card first) are also kept apart.
//   player input: their cards in a +-6 window around the current card, chips (/11 and sinusoidal), points,
//                 seats from the mover (one-hot), what taking the card would cost them, how many cards they hold
//   table input:  cards not seen yet and off the end of the deck in the same window, the card, pot (/11 and
//                 sinusoidal), cards left, table size
//   trunk:        [mover, sum of opponents, max of opponents, next player, table] -> 64 -> 64 -> regrets (or P(take))
// Same interface as structnet.js: p (flat weights), forward(x), step(X, Y, W, B, loss, lr).
'use strict';
const G = require('./game');

const OFFS = []; for (let d = -6; d <= 6; d++) if (d) OFFS.push(d);
const NW = OFFS.length, MAXP = 7, PL = NW + 18, TB = 2 * NW + 8, F = 1 + MAXP * PL + TB;
const sinus = (v, x, o) => { [4, 8].forEach((per, i) => { x[o + 2 * i] = Math.sin(2 * Math.PI * v / per); x[o + 2 * i + 1] = Math.cos(2 * Math.PI * v / per); }); };

// x: n, then per player from the mover [window(12) chips/11 sin(4) pts/100 seats(7) cost/35 cards/12], then the table
// [unseen(12) offboard(12) card/35 pot/11 sin(4) left/23 (n-2)/5]
function features(g, x){
  x.fill(0);
  const p = g.turn, c = g.deck[g.idx], n = g.n;
  x[0] = n;
  for (let k = 0; k < n; k++){
    const q = (p + k) % n, o = 1 + k * PL;
    let cards = 0; for (let v = 3; v <= 35; v++) cards += g.has[q * 37 + v];
    for (let i = 0; i < NW; i++){ const v = c + OFFS[i]; if (v >= 3 && v <= 35 && g.has[q * 37 + v]) x[o + i] = 1; }
    x[o + NW] = g.chips[q] / 11; sinus(g.chips[q], x, o + NW + 1); x[o + NW + 5] = g.pts[q] / 100; x[o + NW + 6 + k] = 1;
    x[o + NW + 13] = (G.addPts(g, q, c) - g.pot) / 35; x[o + NW + 14] = cards / 12;
  }
  const t = 1 + MAXP * PL;
  for (let i = 0; i < NW; i++){
    const v = c + OFFS[i];
    if (v < 3 || v > 35){ x[t + NW + i] = 1; continue; }
    let held = false; for (let q = 0; q < n; q++) if (g.has[q * 37 + v]){ held = true; break; }
    if (!held) x[t + i] = 1;
  }
  x[t + 2 * NW] = c / 35; x[t + 2 * NW + 1] = g.pot / 11; sinus(g.pot, x, t + 2 * NW + 2);
  x[t + 2 * NW + 6] = G.left(g) / 23; x[t + 2 * NW + 7] = (n - 2) / 5;
  return x;
}

class PNet {
  constructor(out, seed = 1, H = 32, T = 64){
    this.out = out; this.H = H; this.T = T;
    const dims = [[PL, H], [H, H], [4 * H + TB, T], [T, T], [T, out]];
    let off = 0; this.L = dims.map(([i, o]) => { const L = { i, o, w: off, b: off + i * o }; off += i * o + o; return L; });
    this.n = off; this.p = new Float32Array(off);
    let s = seed >>> 0 || 1; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (const L of this.L){ const lim = Math.sqrt(6 / L.i);
      for (let k = 0; k < L.i * L.o; k++) this.p[L.w + k] = (r() * 2 - 1) * lim;
      for (let k = 0; k < L.o; k++) this.p[L.b + k] = 0.01; }   // so all-zero inputs don't start with dead ReLUs
    this.c = this.cache();
  }
  cache(){ const H = this.H, T = this.T;
    return { e1: new Float32Array(MAXP * H), e2: new Float32Array(MAXP * H), arg: new Int32Array(H), tin: new Float32Array(4 * H + TB),
      t1: new Float32Array(T), t2: new Float32Array(T), o: new Float32Array(this.out) }; }
  dense(L, x, xo, y, yo, relu){
    const p = this.p;
    for (let j = 0; j < L.o; j++){ let s = p[L.b + j]; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++) s += p[row + k] * x[xo + k]; y[yo + j] = relu && s < 0 ? 0 : s; }
  }
  forward(x, c = this.c){
    const H = this.H, [E1, E2, T1, T2, O] = this.L, n = x[0], tin = c.tin;
    for (let k = 0; k < n; k++){ this.dense(E1, x, 1 + k * PL, c.e1, k * H, true); this.dense(E2, c.e1, k * H, c.e2, k * H, true); }
    for (let h = 0; h < H; h++){
      let sum = 0, mx = -1, am = 1;
      for (let k = 1; k < n; k++){ const v = c.e2[k * H + h]; sum += v; if (v > mx){ mx = v; am = k; } }
      tin[h] = c.e2[h]; tin[H + h] = sum; tin[2 * H + h] = mx; tin[3 * H + h] = c.e2[H + h]; c.arg[h] = am;
    }
    for (let k = 0; k < TB; k++) tin[4 * H + k] = x[1 + MAXP * PL + k];
    this.dense(T1, tin, 0, c.t1, 0, true); this.dense(T2, c.t1, 0, c.t2, 0, true); this.dense(O, c.t2, 0, c.o, 0, false);
    return c.o;
  }
  back(L, x, xo, dy, g, dx){
    const p = this.p;
    for (let j = 0; j < L.o; j++){ const d = dy[j]; if (d === 0) continue; g[L.b + j] += d; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++) g[row + k] += d * x[xo + k]; }
    if (dx) for (let k = 0; k < L.i; k++){ let s = 0; for (let j = 0; j < L.o; j++) s += p[L.w + j * L.i + k] * dy[j]; dx[k] = s; }
  }
  // gradients of one example into g (dout: d loss / d output)
  backward(x, c, dout, g){
    const H = this.H, T = this.T, [E1, E2, T1, T2, O] = this.L, d = this.d, n = x[0];
    this.back(O, c.t2, 0, dout, g, d.t2); for (let k = 0; k < T; k++) if (c.t2[k] <= 0) d.t2[k] = 0;
    this.back(T2, c.t1, 0, d.t2, g, d.t1); for (let k = 0; k < T; k++) if (c.t1[k] <= 0) d.t1[k] = 0;
    this.back(T1, c.tin, 0, d.t1, g, d.tin);
    for (let k = 0; k < n; k++){
      for (let h = 0; h < H; h++){
        let v = 0;
        if (k === 0) v = d.tin[h];
        else { v = d.tin[H + h]; if (c.arg[h] === k) v += d.tin[2 * H + h]; if (k === 1) v += d.tin[3 * H + h]; }
        d.e2[h] = c.e2[k * H + h] > 0 ? v : 0;
      }
      this.back(E2, c.e1, k * H, d.e2, g, d.e1); for (let h = 0; h < H; h++) if (c.e1[k * H + h] <= 0) d.e1[h] = 0;
      this.back(E1, x, 1 + k * PL, d.e1, g, null);
    }
  }
  step(X, Y, Wt, B, loss, lr = 1e-3){
    const H = this.H, T = this.T, out = this.out;
    if (!this.g){ this.g = new Float32Array(this.n); this.m = new Float32Array(this.n); this.v = new Float32Array(this.n); this.t = 0; }
    if (!this.bc){ this.bc = this.cache(); this.d = { o: new Float32Array(out), t2: new Float32Array(T), t1: new Float32Array(T), tin: new Float32Array(4 * H + TB), e2: new Float32Array(H), e1: new Float32Array(H) }; }
    const g = this.g, c = this.bc, d = this.d; g.fill(0);
    let wsum = 0; for (let b = 0; b < B; b++) wsum += Wt[b];
    let total = 0;
    for (let b = 0; b < B; b++){
      const x = X.subarray(b * F, (b + 1) * F), o = this.forward(x, c), w = Wt[b] / wsum;
      for (let j = 0; j < out; j++){
        const y = Y[b * out + j];
        if (loss === 'bce'){ const q = 1 / (1 + Math.exp(-o[j])); d.o[j] = w * (q - y); total += w * -(y * Math.log(q + 1e-7) + (1 - y) * Math.log(1 - q + 1e-7)); }
        else { const e = o[j] - y; d.o[j] = 2 * w * e; total += w * e * e; }
      }
      this.backward(x, c, d.o, g);
    }
    const b1 = 0.9, b2 = 0.999; this.t++;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t), p = this.p;
    for (let k = 0; k < this.n; k++){ const gk = g[k]; this.m[k] = b1 * this.m[k] + (1 - b1) * gk; this.v[k] = b2 * this.v[k] + (1 - b2) * gk * gk; p[k] -= lr * (this.m[k] / c1) / (Math.sqrt(this.v[k] / c2) + 1e-8); }
    return total;
  }
}
module.exports = { PNet, features, F, PL, TB, NW, OFFS, MAXP };
