// anet: a value net for *afterstates* (the position right after someone took a card, before the next card is turned),
// with every player's win share as output. Used inside the pass-chain layer (chainShares): on a card, the only thing
// to learn is what taking it at each pot leads to; who takes, when, and forced takes at 0 chips are worked out by the
// min/max recursion over the chain, which is exact.
//   per player (shared weights, seats only as the offset from the player to move next):
//     card line 3..35, 3 channels (holds, seen by anyone, value/35) -> conv 5 -> conv 3 -> mean, max and value-weighted
//     sum pools, + chips, seat offset -> e (H)
//   per player i: [e_i, sum of the others, max of the others, the next player's e, cards left, table size] -> T -> T -> logit
//   softmax over the players = win shares (they sum to 1 by construction; relabelling seats relabels the output)
// No hand-made scores: points have to come out of the convs and the value-weighted pool.
#pragma once

static const int ACL = 33, AP = ACL + 1, AF = 1 + MAXP * AP + ACL + 2;   // per player: holds line + chips; table: seen line, left, n
// x for the afterstate g (g.turn = who moves next, i.e. the taker; g.idx = cards dealt so far)
static void afeatures(const Game& g, float* x){
  memset(x, 0, AF * sizeof(float));
  int n = g.n, p = g.turn, t = 1 + MAXP * AP; x[0] = n;
  for (int k = 0; k < n; k++){
    int q = (p + k) % n, o = 1 + k * AP;
    for (int v = 3; v <= 35; v++) if (g.has[q * 37 + v]){ x[o + v - 3] = 1; x[t + v - 3] = 1; }
    x[o + ACL] = (float)(g.chips[q] / 11.0);
  }
  x[t + ACL] = (float)((24 - g.idx) / 23.0); x[t + ACL + 1] = (float)((n - 2) / 5.0);
}

struct ANet : Model {
  static const int C0 = 3, K1 = 5, K2 = 3;
  int C1, C2, H, T, FL, TI; Layer cv1, cv2, L[4];
  static const int P1 = K1 / 2, P2 = K2 / 2;
  // The convs follow deep.cpp's fast cnet code (#24): activations position-major ([pos][channel]), a1 padded by P2
  // zero rows at each end, weights transposed once per pass, and conv1 = the value channel's convolution (the same for
  // every player, worked out once) plus a weight row per nonzero holds / seen bit.
  struct W : Work {
    vector<float> W1T, W2T, W2r, gW2r, dwin, vconv, gW1T, gb1, gb2, dvs;
    vector<float> a1, a2, flat, e, tin, h1, h2, z, s;        // per player
    vector<int> amax, arg, nz, nzn;                          // conv max positions; which other player gave each max; nonzero input bits
    vector<float> de, dtin, dh1, dh2, dflat, da1, da2;
  };
  ANet(uint32_t seed, int C1_ = 12, int C2_ = 12, int H_ = 32, int T_ = 64) : C1(C1_), C2(C2_), H(H_), T(T_){
    arch = "anet"; out = MAXP; FL = 3 * C2 + 1 + MAXP; TI = 4 * H + 2;
    int off = 0;
    cv1 = { C0 * K1, C1, off, off + C1 * C0 * K1 }; off += C1 * C0 * K1 + C1;
    cv2 = { C1 * K2, C2, off, off + C2 * C1 * K2 }; off += C2 * C1 * K2 + C2;
    int dims[4][2] = { { FL, H }, { TI, T }, { T, T }, { T, 1 } };
    for (int l = 0; l < 4; l++){ L[l] = { dims[l][0], dims[l][1], off, off + dims[l][0] * dims[l][1] }; off += dims[l][0] * dims[l][1] + dims[l][1]; }
    n = off; alloc(); Rng r(seed);
    init(cv1, r, C0 * K1); init(cv2, r, C1 * K2); for (auto& l : L) init(l, r, l.i);
  }
  int nf() const override { return AF; }
  void features(const Game& g, float* x) const override { afeatures(g, x); }
  Work* work() const override { W* c = new W;
    c->W1T.assign(C0 * K1 * C1, 0); c->W2T.assign(K2 * C1 * C2, 0); c->W2r.assign(K2 * C1 * C2, 0); c->gW2r.assign(K2 * C1 * C2, 0);
    c->dwin.assign(ACL * K2 * C1, 0); c->vconv.assign(ACL * C1, 0); c->gW1T.assign(C0 * K1 * C1, 0); c->gb1.assign(C1, 0); c->gb2.assign(C2, 0); c->dvs.assign(ACL * C1, 0);
    c->nz.assign(MAXP * 2 * ACL, 0); c->nzn.assign(MAXP, 0);
    c->a1.assign(MAXP * (ACL + 2 * P2) * C1, 0); c->a2.assign(MAXP * ACL * C2, 0); c->flat.assign(MAXP * FL, 0);
    c->e.assign(MAXP * H, 0); c->tin.assign(MAXP * TI, 0); c->h1.assign(MAXP * T, 0); c->h2.assign(MAXP * T, 0); c->z.assign(MAXP, 0); c->s.assign(MAXP, 0);
    c->amax.assign(MAXP * C2, 0); c->arg.assign(MAXP * H, 0);
    c->de.assign(MAXP * H, 0); c->dtin.assign(TI, 0); c->dh1.assign(T, 0); c->dh2.assign(T, 0); c->dflat.assign(FL, 0); c->da1.assign((ACL + 2 * P2) * C1, 0); c->da2.assign(ACL * C2, 0);
    return c; }
  // the plain channel-major conv, for pools()
  void conv(const Layer& l, int ci_n, int K, const float* x, float* y) const {
    const float* w = p.data() + l.w;
    for (int co = 0; co < l.o; co++){
      float* yr = y + co * ACL; for (int pos = 0; pos < ACL; pos++) yr[pos] = p[l.b + co];
      for (int ci = 0; ci < ci_n; ci++) for (int j = 0; j < K; j++){
        float wv = w[(co * ci_n + ci) * K + j]; const float* xr = x + ci * ACL; int d = j - K / 2;
        int lo = max(0, -d), hi = min(ACL, ACL - d); for (int pos = lo; pos < hi; pos++) yr[pos] += wv * xr[pos + d];
      }
      for (int pos = 0; pos < ACL; pos++) if (yr[pos] < 0) yr[pos] = 0;
    }
  }
  // The forward pass in two halves, for labelling (no backward): a player's pooled conv features depend only on their
  // cards and the seen cards, so they can be cached while only chips and who-moves-next change.
  void pools(const float* holds, const float* seen, float* out) const {
    float in[C0 * ACL], a1[64 * ACL], a2[64 * ACL];
    for (int pos = 0; pos < ACL; pos++){ in[pos] = holds[pos]; in[ACL + pos] = seen[pos]; in[2 * ACL + pos] = (pos + 3) / 35.0f; }
    conv(cv1, C0, K1, in, a1); conv(cv2, C1, K2, a1, a2);
    for (int co = 0; co < C2; co++){
      const float* r = a2 + co * ACL; float sum = 0, mx = -1, vs = 0;
      for (int pos = 0; pos < ACL; pos++){ sum += r[pos]; vs += (pos + 3) * r[pos]; if (r[pos] > mx) mx = r[pos]; }
      out[co] = sum / ACL; out[C2 + co] = mx; out[2 * C2 + co] = vs / 10;
    }
  }
  // pl[k]: pooled features of the player k seats after the one to move next; chips likewise; s: their win shares
  void head(int nn, const float* const* pl, const int* chips, int left, float* s) const {
    float e[MAXP * 64], fl[128], ti[4 * 64 + 2], h1[256], h2[256];
    for (int k = 0; k < nn; k++){
      for (int i = 0; i < 3 * C2; i++) fl[i] = pl[k][i];
      fl[3 * C2] = (float)(chips[k] / 11.0); for (int q = 0; q < MAXP; q++) fl[3 * C2 + 1 + q] = q == k ? 1 : 0;
      dense(L[0], fl, &e[k * H], true);
    }
    float zmax = -1e30f, z[MAXP];
    for (int i = 0; i < nn; i++){
      const float* en = &e[((i + 1) % nn) * H];
      for (int h = 0; h < H; h++){
        float sum = 0, mx = -1; for (int j = 0; j < nn; j++) if (j != i){ float v = e[j * H + h]; sum += v; if (v > mx) mx = v; }
        ti[h] = e[i * H + h]; ti[H + h] = sum; ti[2 * H + h] = mx; ti[3 * H + h] = en[h];
      }
      ti[4 * H] = (float)(left / 23.0); ti[4 * H + 1] = (float)((nn - 2) / 5.0);
      dense(L[1], ti, h1, true); dense(L[2], h1, h2, true); dense(L[3], h2, &z[i], false); zmax = max(zmax, z[i]);
    }
    float zs = 0; for (int i = 0; i < nn; i++){ s[i] = exp(z[i] - zmax); zs += s[i]; }
    for (int i = 0; i < nn; i++) s[i] /= zs;
  }
  // returns the win shares (softmax), in seat order from the player to move next
  static float val(int q){ return q >= 0 && q < ACL ? (q + 3) / 35.0f : 0; }   // the value channel at position q (0 outside)
  const float* forward(const float* x, Work* w) const override {
    W& c = *(W*)w; int nn = (int)x[0], t = 1 + MAXP * AP; const float* P = p.data();
    for (int co = 0; co < C1; co++) for (int ci = 0; ci < C0; ci++) for (int j = 0; j < K1; j++) c.W1T[(ci * K1 + j) * C1 + co] = P[cv1.w + (co * C0 + ci) * K1 + j];
    for (int co = 0; co < C2; co++) for (int ci = 0; ci < C1; ci++) for (int j = 0; j < K2; j++){ float v = P[cv2.w + (co * C1 + ci) * K2 + j];
      c.W2T[(j * C1 + ci) * C2 + co] = v; c.W2r[co * K2 * C1 + j * C1 + ci] = v; }
    for (int pos = 0; pos < ACL; pos++){ float* v = &c.vconv[pos * C1];
      for (int co = 0; co < C1; co++) v[co] = P[cv1.b + co];
      for (int j = 0; j < K1; j++){ float sv = val(pos + j - P1); if (sv == 0) continue; axpy(v, &c.W1T[(2 * K1 + j) * C1], sv, C1); } }
    for (int k = 0; k < nn; k++){
      const float* px = x + 1 + k * AP; float* A1 = &c.a1[k * (ACL + 2 * P2) * C1]; float* A2 = &c.a2[k * ACL * C2]; float* fl = &c.flat[k * FL];
      int* nz = &c.nz[k * 2 * ACL]; int m = 0;   // nonzero bits as ci * ACL + q
      for (int pos = 0; pos < ACL; pos++){ if (px[pos] != 0) nz[m++] = pos; if (x[t + pos] != 0) nz[m++] = ACL + pos; }
      c.nzn[k] = m;
      memcpy(A1 + P2 * C1, c.vconv.data(), ACL * C1 * sizeof(float));
      for (int i = 0; i < m; i++){ int ci = nz[i] / ACL, q = nz[i] % ACL;
        for (int j = 0; j < K1; j++){ int pos = q - j + P1; if (pos < 0 || pos >= ACL) continue;
          axpy(A1 + (pos + P2) * C1, &c.W1T[(ci * K1 + j) * C1], 1, C1); } }
      for (int i = P2 * C1; i < (ACL + P2) * C1; i++) if (A1[i] < 0) A1[i] = 0;
      if (C1 == 12 && C2 == 12) conv2Rows<K2 * 12, 12>(A1, c.W2T.data(), P + cv2.b, A2, C1);
      else for (int pos = 0; pos < ACL; pos++){
        float* yr = A2 + pos * C2; for (int co = 0; co < C2; co++) yr[co] = P[cv2.b + co];
        const float* win = A1 + pos * C1;
        for (int e = 0; e < K2 * C1; e++) axpy(yr, &c.W2T[e * C2], win[e], C2);
        for (int co = 0; co < C2; co++) if (yr[co] < 0) yr[co] = 0;
      }
      for (int co = 0; co < C2; co++){ fl[co] = 0; fl[C2 + co] = -1; fl[2 * C2 + co] = 0; c.amax[k * C2 + co] = 0; }
      for (int pos = 0; pos < ACL; pos++){ const float* r = A2 + pos * C2;
        for (int co = 0; co < C2; co++){ fl[co] += r[co]; fl[2 * C2 + co] += (pos + 3) * r[co]; if (r[co] > fl[C2 + co]){ fl[C2 + co] = r[co]; c.amax[k * C2 + co] = pos; } } }
      for (int co = 0; co < C2; co++){ fl[co] /= ACL; fl[2 * C2 + co] /= 10; }
      fl[3 * C2] = px[ACL]; for (int q = 0; q < MAXP; q++) fl[3 * C2 + 1 + q] = q == k ? 1 : 0;
      dense(L[0], fl, &c.e[k * H], true);
    }
    float zmax = -1e30f;
    for (int i = 0; i < nn; i++){
      float* ti = &c.tin[i * TI]; const float* ei = &c.e[i * H]; const float* en = &c.e[((i + 1) % nn) * H];
      for (int h = 0; h < H; h++){
        float sum = 0, mx = -1; int am = (i + 1) % nn;
        for (int j = 0; j < nn; j++) if (j != i){ float v = c.e[j * H + h]; sum += v; if (v > mx){ mx = v; am = j; } }
        ti[h] = ei[h]; ti[H + h] = sum; ti[2 * H + h] = mx; ti[3 * H + h] = en[h]; c.arg[i * H + h] = am;
      }
      ti[4 * H] = x[t + ACL]; ti[4 * H + 1] = x[t + ACL + 1];
      dense(L[1], ti, &c.h1[i * T], true); dense(L[2], &c.h1[i * T], &c.h2[i * T], true); dense(L[3], &c.h2[i * T], &c.z[i], false);
      zmax = max(zmax, c.z[i]);
    }
    float zs = 0; for (int i = 0; i < nn; i++){ c.s[i] = exp(c.z[i] - zmax); zs += c.s[i]; }
    for (int i = 0; i < nn; i++) c.s[i] /= zs;
    for (int i = nn; i < MAXP; i++) c.s[i] = 0;
    return c.s.data();
  }
  // dout = d loss / d logit, per player (for cross-entropy against target shares y: s - y)
  void backward(const float* x, Work* w, const float* dout, float* g) const override {
    W& c = *(W*)w; int nn = (int)x[0];
    fill(c.de.begin(), c.de.end(), 0.f);
    for (int i = 0; i < nn; i++){
      float dz = dout[i]; if (dz == 0) continue;
      back(L[3], &c.h2[i * T], &dz, g, c.dh2.data()); for (int k = 0; k < T; k++) if (c.h2[i * T + k] <= 0) c.dh2[k] = 0;
      back(L[2], &c.h1[i * T], c.dh2.data(), g, c.dh1.data()); for (int k = 0; k < T; k++) if (c.h1[i * T + k] <= 0) c.dh1[k] = 0;
      back(L[1], &c.tin[i * TI], c.dh1.data(), g, c.dtin.data());
      int nx = (i + 1) % nn;
      for (int h = 0; h < H; h++){
        c.de[i * H + h] += c.dtin[h];
        for (int j = 0; j < nn; j++) if (j != i) c.de[j * H + h] += c.dtin[H + h];
        c.de[c.arg[i * H + h] * H + h] += c.dtin[2 * H + h];
        c.de[nx * H + h] += c.dtin[3 * H + h];
      }
    }
    const float* P = c.W2r.data();
    fill(c.gW1T.begin(), c.gW1T.end(), 0.f); fill(c.gW2r.begin(), c.gW2r.end(), 0.f); fill(c.gb1.begin(), c.gb1.end(), 0.f); fill(c.gb2.begin(), c.gb2.end(), 0.f);
    fill(c.dvs.begin(), c.dvs.end(), 0.f);
    for (int k = 0; k < nn; k++){
      float* de = &c.de[k * H]; for (int h = 0; h < H; h++) if (c.e[k * H + h] <= 0) de[h] = 0;
      back(L[0], &c.flat[k * FL], de, g, c.dflat.data());
      const float* A1 = &c.a1[k * (ACL + 2 * P2) * C1]; const float* A2 = &c.a2[k * ACL * C2]; float* da2 = c.da2.data(); float* da1 = c.da1.data();
      for (int pos = 0; pos < ACL; pos++) for (int co = 0; co < C2; co++) da2[pos * C2 + co] = c.dflat[co] / ACL + c.dflat[2 * C2 + co] / 10 * (pos + 3);
      for (int co = 0; co < C2; co++) da2[c.amax[k * C2 + co] * C2 + co] += c.dflat[C2 + co];
      for (int i = 0; i < ACL * C2; i++) if (A2[i] <= 0) da2[i] = 0;
      const int E = K2 * C1; float* dwin = c.dwin.data();
      for (int pos = 0; pos < ACL; pos++) for (int co = 0; co < C2; co++) c.gb2[co] += da2[pos * C2 + co];
      if (C1 == 12 && C2 == 12) conv2Back<K2 * 12, 12>(A1, da2, P, c.gW2r.data(), dwin, C1);
      else { memset(dwin, 0, ACL * E * sizeof(float));
        for (int pos = 0; pos < ACL; pos++){ const float* d = da2 + pos * C2; const float* win = A1 + pos * C1;
          for (int co = 0; co < C2; co++){ float dc = d[co]; if (dc == 0) continue; axpy(&c.gW2r[co * E], win, dc, E); axpy(dwin + pos * E, &P[co * E], dc, E); } } }
      memset(da1, 0, (ACL + 2 * P2) * C1 * sizeof(float));
      for (int pos = 0; pos < ACL; pos++) axpy(da1 + pos * C1, dwin + pos * E, 1, E);
      for (int pos = 0; pos < ACL; pos++){ float* dr = da1 + (pos + P2) * C1; const float* ar = A1 + (pos + P2) * C1; float* vs = &c.dvs[pos * C1];
        for (int co = 0; co < C1; co++){ if (ar[co] <= 0) dr[co] = 0; c.gb1[co] += dr[co]; vs[co] += dr[co]; } }
      const int* nz = &c.nz[k * 2 * ACL];
      for (int i = 0; i < c.nzn[k]; i++){ int ci = nz[i] / ACL, q = nz[i] % ACL;
        for (int j = 0; j < K1; j++){ int pos = q - j + P1; if (pos < 0 || pos >= ACL) continue;
          axpy(&c.gW1T[(ci * K1 + j) * C1], da1 + (pos + P2) * C1, 1, C1); } }
    }
    for (int j = 0; j < K1; j++){ float* gr = &c.gW1T[(2 * K1 + j) * C1];
      for (int pos = 0; pos < ACL; pos++){ float sv = val(pos + j - P1); if (sv == 0) continue; axpy(gr, &c.dvs[pos * C1], sv, C1); } }
    for (int co = 0; co < C1; co++){ g[cv1.b + co] += c.gb1[co];
      for (int ci = 0; ci < C0; ci++) for (int j = 0; j < K1; j++) g[cv1.w + (co * C0 + ci) * K1 + j] += c.gW1T[(ci * K1 + j) * C1 + co]; }
    for (int co = 0; co < C2; co++){ g[cv2.b + co] += c.gb2[co];
      for (int ci = 0; ci < C1; ci++) for (int j = 0; j < K2; j++) g[cv2.w + (co * C1 + ci) * K2 + j] += c.gW2r[co * K2 * C1 + j * C1 + ci]; }
  }
};

// win shares (indexed by absolute seat) of the afterstate after the player to move in g takes the card now
static void afterShares(const ANet& A, Work* w, float* x, const Game& g0, double* out){
  Game g = g0; int t = g.turn; bool over = step(g, true); (void)over; (void)t;
  afeatures(g, x); const float* s = A.forward(x, w);
  for (int k = 0; k < g.n; k++) out[(g.turn + k) % g.n] = s[k];
}
// the pass-chain layer: shares (absolute seats) at decision g, everyone playing the chain optimally against the
// afterstate values; also the afterstates and choices along the chain if asked
static void chainShares(const ANet& A, Work* w, float* x, const Game& g0, double* out){
  Game g = g0; vector<array<double, 7>> T;
  vector<int> mover, forced;
  for (;;){
    array<double, 7> a{}; afterShares(A, w, x, g, a.data()); T.push_back(a); mover.push_back(g.turn);
    bool f = g.chips[g.turn] == 0; forced.push_back(f);
    if (f) break;
    step(g, false);
  }
  array<double, 7> v = T.back();
  for (int j = (int)T.size() - 2; j >= 0; j--){ if (T[j][mover[j]] >= v[mover[j]]) v = T[j]; }   // pass only when strictly better
  for (int q = 0; q < g0.n; q++) out[q] = v[q];
}
