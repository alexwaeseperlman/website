// The structured network: what matters about a card is mostly what's next to it, and opponents are interchangeable
// apart from where they sit. So:
//   - cards are seen through a window of +-6 around the current card (mine / an opponent's / not seen yet / off the
//     end of the deck), with the card's own value as a separate number
//   - every opponent goes through the same small encoder (their window, chips, points, seats away, what the card
//     would cost them); the encodings are summed, and the next player's (who sees the card first) is also kept apart
//   - a trunk reads my own features + the summed opponents + the next player and outputs the regrets (or P(take))
// Same interface as nn.js's MLP: p (flat weights), forward(x), step(X, Y, W, B, loss, lr).
'use strict';
const G = require('./game');

const WIN = 6, OFFS = [];   // window offsets -6..-1, 1..6
for (let d = -WIN; d <= WIN; d++) if (d) OFFS.push(d);
const NW = OFFS.length, SELF = 3 * NW + 8, OPP = NW + 4, MAXO = 6, F = SELF + 1 + MAXO * OPP;

// x: self [mine(12) unseen(12) offboard(12) card/35 chips/11 pot/11 left/23 (n-2)/5 cost/35 pts/100 minOppChips/11],
// count of opponents, then per opponent by seat distance: [their window(12) chips/11 pts/100 seats/6 theirCost/35]
function features(g, x){
  x.fill(0);
  const p = g.turn, c = g.deck[g.idx], n = g.n;
  let minOpp = 99;
  for (let i = 0; i < NW; i++){
    const v = c + OFFS[i];
    if (v < 3 || v > 35){ x[2 * NW + i] = 1; continue; }
    let held = false;
    for (let q = 0; q < n; q++) if (g.has[q * 37 + v]){ held = true; if (q === p) x[i] = 1; }
    if (!held) x[NW + i] = 1;
  }
  for (let q = 0; q < n; q++) if (q !== p && g.chips[q] < minOpp) minOpp = g.chips[q];
  const s = 3 * NW;
  x[s] = c / 35; x[s + 1] = g.chips[p] / 11; x[s + 2] = g.pot / 11; x[s + 3] = G.left(g) / 23; x[s + 4] = (n - 2) / 5;
  x[s + 5] = (G.addPts(g, p, c) - g.pot) / 35; x[s + 6] = g.pts[p] / 100; x[s + 7] = minOpp / 11;
  x[SELF] = n - 1;
  for (let k = 1; k < n; k++){
    const q = (p + k) % n, o = SELF + 1 + (k - 1) * OPP;
    for (let i = 0; i < NW; i++){ const v = c + OFFS[i]; if (v >= 3 && v <= 35 && g.has[q * 37 + v]) x[o + i] = 1; }
    x[o + NW] = g.chips[q] / 11; x[o + NW + 1] = g.pts[q] / 100; x[o + NW + 2] = k / 6; x[o + NW + 3] = (G.addPts(g, q, c) - g.pot) / 35;
  }
  return x;
}

class StructNet {
  constructor(out, seed = 1, H = 32, T = 64){
    this.out = out; this.H = H; this.T = T;
    const dims = [[OPP, H], [H, H], [SELF + 2 * H, T], [T, T], [T, out]];
    let off = 0; this.L = dims.map(([i, o]) => { const L = { i, o, w: off, b: off + i * o }; off += i * o + o; return L; });
    this.n = off; this.p = new Float32Array(off);
    let s = seed >>> 0 || 1; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (const L of this.L){ const lim = Math.sqrt(6 / L.i); for (let k = 0; k < L.i * L.o; k++) this.p[L.w + k] = (r() * 2 - 1) * lim; }
    this.c = this.cache();
  }
  cache(){ const H = this.H, T = this.T;
    return { e1: new Float32Array(MAXO * H), e2: new Float32Array(MAXO * H), tin: new Float32Array(SELF + 2 * H), t1: new Float32Array(T), t2: new Float32Array(T), o: new Float32Array(this.out) }; }
  dense(L, x, xo, y, yo, relu){
    const p = this.p;
    for (let j = 0; j < L.o; j++){ let s = p[L.b + j]; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++) s += p[row + k] * x[xo + k]; y[yo + j] = relu && s < 0 ? 0 : s; }
  }
  forward(x, c = this.c){
    const H = this.H, [E1, E2, T1, T2, O] = this.L, nO = x[SELF];
    c.tin.fill(0);
    for (let k = 0; k < SELF; k++) c.tin[k] = x[k];
    for (let j = 0; j < nO; j++){
      this.dense(E1, x, SELF + 1 + j * OPP, c.e1, j * H, true);
      this.dense(E2, c.e1, j * H, c.e2, j * H, true);
      for (let h = 0; h < H; h++){ c.tin[SELF + h] += c.e2[j * H + h]; if (j === 0) c.tin[SELF + H + h] = c.e2[h]; }
    }
    this.dense(T1, c.tin, 0, c.t1, 0, true); this.dense(T2, c.t1, 0, c.t2, 0, true); this.dense(O, c.t2, 0, c.o, 0, false);
    return c.o;
  }
  // backprop through one dense layer: dy (already masked for ReLU) -> grads, and dx if wanted
  back(L, x, xo, dy, g, dx){
    const p = this.p;
    for (let j = 0; j < L.o; j++){ const d = dy[j]; if (d === 0) continue; g[L.b + j] += d; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++) g[row + k] += d * x[xo + k]; }
    if (dx) for (let k = 0; k < L.i; k++){ let s = 0; for (let j = 0; j < L.o; j++) s += p[L.w + j * L.i + k] * dy[j]; dx[k] = s; }
  }
  step(X, Y, Wt, B, loss, lr = 1e-3){
    const H = this.H, T = this.T, [E1, E2, T1, T2, O] = this.L, out = this.out;
    if (!this.g){ this.g = new Float32Array(this.n); this.m = new Float32Array(this.n); this.v = new Float32Array(this.n); this.t = 0;
      this.bc = this.cache(); this.d = { o: new Float32Array(out), t2: new Float32Array(T), t1: new Float32Array(T), tin: new Float32Array(SELF + 2 * H), e2: new Float32Array(H), e1: new Float32Array(H) }; }
    const g = this.g, c = this.bc, d = this.d; g.fill(0);
    let wsum = 0; for (let b = 0; b < B; b++) wsum += Wt[b];
    let total = 0;
    for (let b = 0; b < B; b++){
      const xo = b * F, x = X.subarray(xo, xo + F), o = this.forward(x, c), w = Wt[b] / wsum;
      for (let j = 0; j < out; j++){
        const y = Y[b * out + j];
        if (loss === 'bce'){ const q = 1 / (1 + Math.exp(-o[j])); d.o[j] = w * (q - y); total += w * -(y * Math.log(q + 1e-7) + (1 - y) * Math.log(1 - q + 1e-7)); }
        else { const e = o[j] - y; d.o[j] = 2 * w * e; total += w * e * e; }
      }
      this.back(O, c.t2, 0, d.o, g, d.t2); for (let k = 0; k < T; k++) if (c.t2[k] <= 0) d.t2[k] = 0;
      this.back(T2, c.t1, 0, d.t2, g, d.t1); for (let k = 0; k < T; k++) if (c.t1[k] <= 0) d.t1[k] = 0;
      this.back(T1, c.tin, 0, d.t1, g, d.tin);
      const nO = x[SELF];
      for (let j = 0; j < nO; j++){
        for (let h = 0; h < H; h++){ d.e2[h] = d.tin[SELF + h] + (j === 0 ? d.tin[SELF + H + h] : 0); if (c.e2[j * H + h] <= 0) d.e2[h] = 0; }
        this.back(E2, c.e1, j * H, d.e2, g, d.e1); for (let h = 0; h < H; h++) if (c.e1[j * H + h] <= 0) d.e1[h] = 0;
        this.back(E1, x, SELF + 1 + j * OPP, d.e1, g, null);
      }
    }
    const b1 = 0.9, b2 = 0.999; this.t++;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t), p = this.p;
    for (let k = 0; k < this.n; k++){ const gk = g[k]; this.m[k] = b1 * this.m[k] + (1 - b1) * gk; this.v[k] = b2 * this.v[k] + (1 - b2) * gk * gk; p[k] -= lr * (this.m[k] / c1) / (Math.sqrt(this.v[k] / c2) + 1e-8); }
    return total;
  }
}
module.exports = { StructNet, features, F, SELF, OPP, NW, OFFS };
