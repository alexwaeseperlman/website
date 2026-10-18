// A tiny fully connected network (ReLU hidden layers) with Adam, in plain JS so the same forward pass runs in the
// trainer, the page and (ported) the database. Weights are a flat Float32Array: per layer W (out x in) then b.
'use strict';

class MLP {
  constructor(sizes, seed = 1){
    this.sizes = sizes; this.layers = [];
    let off = 0;
    for (let l = 0; l < sizes.length - 1; l++){ const i = sizes[l], o = sizes[l + 1]; this.layers.push({ i, o, w: off, b: off + i * o }); off += i * o + o; }
    this.n = off; this.p = new Float32Array(off);
    let s = seed >>> 0 || 1; const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (const L of this.layers){ const lim = Math.sqrt(6 / L.i); for (let k = 0; k < L.i * L.o; k++) this.p[L.w + k] = (r() * 2 - 1) * lim; }   // He init
    this.acts = this.layers.map(L => new Float32Array(L.o));
  }
  forward(x){   // returns the last layer's outputs (shared buffer)
    let a = x;
    for (let l = 0; l < this.layers.length; l++){
      const L = this.layers[l], out = this.acts[l], p = this.p, last = l === this.layers.length - 1;
      for (let j = 0; j < L.o; j++){
        let s = p[L.b + j]; const row = L.w + j * L.i;
        for (let k = 0; k < L.i; k++) s += p[row + k] * a[k];
        out[j] = last || s > 0 ? s : 0;
      }
      a = out;
    }
    return a;
  }
  // one Adam step on a batch. X: B*in, Y: B*out, W: B sample weights. loss 'mse' or 'bce' (single output, Y in [0,1])
  step(X, Y, W, B, loss, lr = 1e-3){
    if (!this.g){ this.g = new Float32Array(this.n); this.m = new Float32Array(this.n); this.v = new Float32Array(this.n); this.t = 0;
      this.bacts = this.layers.map(L => new Float32Array(L.o)); this.deltas = this.layers.map(L => new Float32Array(L.o)); }
    const g = this.g, p = this.p, Ls = this.layers, nL = Ls.length, inN = this.sizes[0], outN = this.sizes[nL];
    g.fill(0);
    let wsum = 0; for (let b = 0; b < B; b++) wsum += W[b];
    let total = 0;
    for (let b = 0; b < B; b++){
      const x = X.subarray(b * inN, (b + 1) * inN);
      // forward, keeping activations
      let a = x;
      for (let l = 0; l < nL; l++){
        const L = Ls[l], out = this.bacts[l], last = l === nL - 1;
        for (let j = 0; j < L.o; j++){ let s = p[L.b + j]; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++) s += p[row + k] * a[k]; out[j] = last || s > 0 ? s : 0; }
        a = out;
      }
      // output delta
      const d = this.deltas[nL - 1], o = this.bacts[nL - 1], w = W[b] / wsum;
      for (let j = 0; j < outN; j++){
        const y = Y[b * outN + j];
        if (loss === 'bce'){ const q = 1 / (1 + Math.exp(-o[j])); d[j] = w * (q - y); total += w * -(y * Math.log(q + 1e-7) + (1 - y) * Math.log(1 - q + 1e-7)); }
        else { const e = o[j] - y; d[j] = 2 * w * e; total += w * e * e; }
      }
      // backward
      for (let l = nL - 1; l >= 0; l--){
        const L = Ls[l], dl = this.deltas[l], ain = l === 0 ? x : this.bacts[l - 1];
        for (let j = 0; j < L.o; j++){ const dj = dl[j]; if (dj === 0) continue; g[L.b + j] += dj; const row = L.w + j * L.i; for (let k = 0; k < L.i; k++) g[row + k] += dj * ain[k]; }
        if (l > 0){
          const dp = this.deltas[l - 1], ap = this.bacts[l - 1];
          for (let k = 0; k < L.i; k++){ if (ap[k] <= 0){ dp[k] = 0; continue; } let s = 0; for (let j = 0; j < L.o; j++) s += p[L.w + j * L.i + k] * dl[j]; dp[k] = s; }
        }
      }
    }
    // Adam
    const b1 = 0.9, b2 = 0.999; this.t++;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (let k = 0; k < this.n; k++){
      const gk = g[k]; this.m[k] = b1 * this.m[k] + (1 - b1) * gk; this.v[k] = b2 * this.v[k] + (1 - b2) * gk * gk;
      p[k] -= lr * (this.m[k] / c1) / (Math.sqrt(this.v[k] / c2) + 1e-8);
    }
    return total;
  }
}
module.exports = { MLP };
