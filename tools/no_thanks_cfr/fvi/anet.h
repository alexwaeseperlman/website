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
  struct W : Work {
    vector<float> in, a1, a2, flat, e, tin, h1, h2, z, s;   // per player
    vector<int> amax, arg;                                   // conv max positions; for each i, which other player gave the max
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
    c->in.assign(MAXP * C0 * ACL, 0); c->a1.assign(MAXP * C1 * ACL, 0); c->a2.assign(MAXP * C2 * ACL, 0); c->flat.assign(MAXP * FL, 0);
    c->e.assign(MAXP * H, 0); c->tin.assign(MAXP * TI, 0); c->h1.assign(MAXP * T, 0); c->h2.assign(MAXP * T, 0); c->z.assign(MAXP, 0); c->s.assign(MAXP, 0);
    c->amax.assign(MAXP * C2, 0); c->arg.assign(MAXP * H, 0);
    c->de.assign(MAXP * H, 0); c->dtin.assign(TI, 0); c->dh1.assign(T, 0); c->dh2.assign(T, 0); c->dflat.assign(FL, 0); c->da1.assign(C1 * ACL, 0); c->da2.assign(C2 * ACL, 0);
    return c; }
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
  void convBack(const Layer& l, int ci_n, int K, const float* x, const float* dy, float* g, float* dx) const {
    const float* w = p.data() + l.w;
    if (dx) memset(dx, 0, ci_n * ACL * sizeof(float));
    for (int co = 0; co < l.o; co++){
      const float* dr = dy + co * ACL; float bs = 0; for (int pos = 0; pos < ACL; pos++) bs += dr[pos]; g[l.b + co] += bs;
      for (int ci = 0; ci < ci_n; ci++) for (int j = 0; j < K; j++){
        int d = j - K / 2, lo = max(0, -d), hi = min(ACL, ACL - d); const float* xr = x + ci * ACL; float s = 0;
        for (int pos = lo; pos < hi; pos++) s += dr[pos] * xr[pos + d];
        g[l.w + (co * ci_n + ci) * K + j] += s;
        if (dx){ float wv = w[(co * ci_n + ci) * K + j]; float* dxr = dx + ci * ACL; for (int pos = lo; pos < hi; pos++) dxr[pos + d] += wv * dr[pos]; }
      }
    }
  }
  // returns the win shares (softmax), in seat order from the player to move next
  const float* forward(const float* x, Work* w) const override {
    W& c = *(W*)w; int nn = (int)x[0], t = 1 + MAXP * AP;
    for (int k = 0; k < nn; k++){
      float* in = &c.in[k * C0 * ACL]; const float* px = x + 1 + k * AP;
      for (int pos = 0; pos < ACL; pos++){ in[pos] = px[pos]; in[ACL + pos] = x[t + pos]; in[2 * ACL + pos] = (pos + 3) / 35.0f; }
      float* a1 = &c.a1[k * C1 * ACL]; float* a2 = &c.a2[k * C2 * ACL]; float* fl = &c.flat[k * FL];
      conv(cv1, C0, K1, in, a1); conv(cv2, C1, K2, a1, a2);
      for (int co = 0; co < C2; co++){
        const float* r = a2 + co * ACL; float sum = 0, mx = -1, vs = 0; int am = 0;
        for (int pos = 0; pos < ACL; pos++){ sum += r[pos]; vs += (pos + 3) * r[pos]; if (r[pos] > mx){ mx = r[pos]; am = pos; } }
        fl[co] = sum / ACL; fl[C2 + co] = mx; fl[2 * C2 + co] = vs / 10; c.amax[k * C2 + co] = am;
      }
      fl[3 * C2] = px[ACL]; for (int s = 0; s < MAXP; s++) fl[3 * C2 + 1 + s] = s == k ? 1 : 0;
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
    for (int k = 0; k < nn; k++){
      float* de = &c.de[k * H]; for (int h = 0; h < H; h++) if (c.e[k * H + h] <= 0) de[h] = 0;
      back(L[0], &c.flat[k * FL], de, g, c.dflat.data());
      const float* a2 = &c.a2[k * C2 * ACL]; float* da2 = c.da2.data();
      for (int co = 0; co < C2; co++){
        float dm = c.dflat[co] / ACL, dv = c.dflat[2 * C2 + co] / 10;
        for (int pos = 0; pos < ACL; pos++) da2[co * ACL + pos] = dm + dv * (pos + 3);
        da2[co * ACL + c.amax[k * C2 + co]] += c.dflat[C2 + co];
      }
      for (int i = 0; i < C2 * ACL; i++) if (a2[i] <= 0) da2[i] = 0;
      const float* a1 = &c.a1[k * C1 * ACL];
      convBack(cv2, C1, K2, a1, da2, g, c.da1.data());
      for (int i = 0; i < C1 * ACL; i++) if (a1[i] <= 0) c.da1[i] = 0;
      convBack(cv1, C0, K1, &c.in[k * C0 * ACL], c.da1.data(), g, nullptr);
    }
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
