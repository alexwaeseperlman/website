// deep.js in C++: the same Deep CFR training of the player net (pnet.js), several times faster.
//   g++ -O3 -march=native -ffast-math -std=c++17 -pthread deep.cpp -o deep      (on an M1: clang++ -mcpu=native ...)
//   ./deep [iterations] [games per worker per iteration] [workers] [pnet|pnetw|cnet]   -> writes deep-<arch>-adv.json
// It reads and writes the same checkpoint as deep.js (deep-<arch>-ckpt/), so a run can move between the two.
// At the end it also trains the average-strategy net (deep-<name>.json, P(take)) from the recorded strategies;
// running it again with the same iteration count after a finished run retrains just that. TAG=x names the run
// <arch>-x (its checkpoint and output files). POOL (see loadPool) seats older bots at some of the learner's games.
// DROP (see setDrop) trains without some of the inputs; SEED=k varies the random start.
//   ./deep test <weights.json> <seed> <games>   prints game steps, features and net outputs (compare with check-cpp.js)
//   ./deep eval a.json b [games]                 head to head, like h2h.js (b can also be table or rule)
//   ./deep gradcheck <arch>                      checks a net's backward pass against finite differences
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <thread>
#include <chrono>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <sys/stat.h>
#include <unistd.h>
#include <memory>
using namespace std;

// ---- game.js ----
struct Rng { uint32_t s; explicit Rng(uint32_t seed){ s = seed ? seed : 1; }
  double operator()(){ s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s / 4294967296.0; } };
static int chipsFor(int n){ return n <= 5 ? 11 : n == 6 ? 9 : 7; }
struct Game { int n, idx, pot, turn; int deck[24]; int chips[7], pts[7]; uint8_t has[7 * 37]; };
static void newGame(Game& g, int n, Rng& r){
  int all[33]; for (int c = 3; c <= 35; c++) all[c - 3] = c;
  for (int i = 32; i > 0; i--){ int j = (int)floor(r() * (i + 1)); swap(all[i], all[j]); }
  memcpy(g.deck, all, sizeof g.deck); g.n = n; g.idx = 0; g.pot = 0;
  for (int q = 0; q < 7; q++){ g.chips[q] = q < n ? chipsFor(n) : 0; g.pts[q] = 0; }
  memset(g.has, 0, sizeof g.has); g.turn = (int)floor(r() * n);
}
static int addPts(const Game& g, int p, int c){ return (g.has[p * 37 + c - 1] ? 0 : c) - (g.has[p * 37 + c + 1] ? c + 1 : 0); }
static int leftOf(const Game& g){ return 24 - g.idx - 1; }
static bool step(Game& g, bool take){
  int p = g.turn, c = g.deck[g.idx];
  if (!take){ g.chips[p]--; g.pot++; g.turn = (p + 1) % g.n; return false; }
  g.pts[p] += addPts(g, p, c); g.has[p * 37 + c] = 1; g.chips[p] += g.pot; g.pot = 0; g.idx++;
  return g.idx >= 24;
}
static double winShare(const Game& g, int p){
  int best = 1 << 30, k = 0;
  for (int q = 0; q < g.n; q++){ int s = g.pts[q] - g.chips[q]; if (s < best){ best = s; k = 1; } else if (s == best) k++; }
  return g.pts[p] - g.chips[p] == best ? 1.0 / k : 0;
}

// ---- pnet.js ----
static const int OFFS[12] = { -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6 };
static const int NW = 12, MAXP = 7, PL = NW + 18, TB = 2 * NW + 8, F = 1 + MAXP * PL + TB;
static void sinus(double v, float* x, int o){ const double per[2] = { 4, 8 };
  for (int i = 0; i < 2; i++){ x[o + 2 * i] = (float)sin(2 * M_PI * v / per[i]); x[o + 2 * i + 1] = (float)cos(2 * M_PI * v / per[i]); } }
// feature ablations: DROP=cost,pts,... zeroes those inputs (for every player where it's a per-player input), which
// is the same as removing them. The groups are pnet.js's DROP_GROUPS.
static vector<int> dropIdx; static string dropSpec;   // the net being trained
static vector<int> dropList(const string& spec){
  vector<int> dropIdx; const int t = 1 + MAXP * PL;
  auto per = [&](int a, int len){ for (int k = 0; k < MAXP; k++) for (int i = 0; i < len; i++) dropIdx.push_back(1 + k * PL + a + i); };
  auto tab = [&](int a, int len){ for (int i = 0; i < len; i++) dropIdx.push_back(t + a + i); };
  size_t a = 0;
  while (a <= spec.size()){
    size_t b = spec.find(',', a); if (b == string::npos) b = spec.size(); string g = spec.substr(a, b - a); a = b + 1;
    if (g.empty()) continue;
    if (g == "window") per(0, NW); else if (g == "chips") per(NW, 1); else if (g == "chipsin") per(NW + 1, 4); else if (g == "pts") per(NW + 5, 1);
    else if (g == "seat") per(NW + 6, 7); else if (g == "cost") per(NW + 13, 1); else if (g == "ncards") per(NW + 14, 1);
    else if (g == "unseen") tab(0, NW); else if (g == "offboard") tab(NW, NW); else if (g == "card") tab(2 * NW, 1); else if (g == "pot") tab(2 * NW + 1, 1);
    else if (g == "potsin") tab(2 * NW + 2, 4); else if (g == "left") tab(2 * NW + 6, 1); else if (g == "n") tab(2 * NW + 7, 1);
    else { fprintf(stderr, "unknown feature group %s\n", g.c_str()); exit(1); }
  }
  return dropIdx;
}
static void dropOut(float* x, const vector<int>& d){ for (int k : d) x[k] = 0; }
static void features(const Game& g, float* x){
  memset(x, 0, F * sizeof(float));
  int p = g.turn, c = g.deck[g.idx], n = g.n;
  x[0] = n;
  for (int k = 0; k < n; k++){
    int q = (p + k) % n, o = 1 + k * PL, cards = 0;
    for (int v = 3; v <= 35; v++) cards += g.has[q * 37 + v];
    for (int i = 0; i < NW; i++){ int v = c + OFFS[i]; if (v >= 3 && v <= 35 && g.has[q * 37 + v]) x[o + i] = 1; }
    x[o + NW] = (float)(g.chips[q] / 11.0); sinus(g.chips[q], x, o + NW + 1); x[o + NW + 5] = (float)(g.pts[q] / 100.0); x[o + NW + 6 + k] = 1;
    x[o + NW + 13] = (float)((addPts(g, q, c) - g.pot) / 35.0); x[o + NW + 14] = (float)(cards / 12.0);
  }
  int t = 1 + MAXP * PL;
  for (int i = 0; i < NW; i++){
    int v = c + OFFS[i];
    if (v < 3 || v > 35){ x[t + NW + i] = 1; continue; }
    bool held = false; for (int q = 0; q < n; q++) if (g.has[q * 37 + v]){ held = true; break; }
    if (!held) x[t + i] = 1;
  }
  x[t + 2 * NW] = (float)(c / 35.0); x[t + 2 * NW + 1] = (float)(g.pot / 11.0); sinus(g.pot, x, t + 2 * NW + 2);
  x[t + 2 * NW + 6] = (float)(leftOf(g) / 23.0); x[t + 2 * NW + 7] = (float)((n - 2) / 5.0);
}

struct Layer { int i, o, w, b; };
// a per-thread scratch area for a model's forward and backward passes
struct Work { virtual ~Work(){} };
// what the trainer needs from a net: its inputs (features) and forward / backward passes over them
struct Model {
  string arch; int out, n = 0; vector<float> p, m, v; int at = 0;
  virtual ~Model(){}
  virtual int nf() const = 0;                                   // inputs per position
  virtual void features(const Game& g, float* x) const = 0;
  virtual Work* work() const = 0;
  virtual const float* forward(const float* x, Work* w) const = 0;
  virtual void backward(const float* x, Work* w, const float* dout, float* g) const = 0;   // adds d loss / d p to g
  void alloc(){ p.assign(n, 0); m.assign(n, 0); v.assign(n, 0); }
  void init(const Layer& l, Rng& r, int fanIn){ double lim = sqrt(6.0 / fanIn);
    for (int k = 0; k < l.i * l.o; k++) p[l.w + k] = (float)((r() * 2 - 1) * lim);
    for (int k = 0; k < l.o; k++) p[l.b + k] = 0.01f; }
  void dense(const Layer& l, const float* x, float* y, bool relu) const {
    const float* w = p.data() + l.w;
    for (int j = 0; j < l.o; j++){ const float* row = w + j * l.i; float s = 0; for (int k = 0; k < l.i; k++) s += row[k] * x[k];
      s += p[l.b + j]; y[j] = relu && s < 0 ? 0 : s; }
  }
  void back(const Layer& l, const float* x, const float* dy, float* g, float* dx) const {
    const float* w = p.data() + l.w;
    for (int j = 0; j < l.o; j++){ float d = dy[j]; if (d == 0) continue; g[l.b + j] += d; float* gr = g + l.w + j * l.i; for (int k = 0; k < l.i; k++) gr[k] += d * x[k]; }
    if (dx){ for (int k = 0; k < l.i; k++) dx[k] = 0;
      for (int j = 0; j < l.o; j++){ float d = dy[j]; if (d == 0) continue; const float* row = w + j * l.i; for (int k = 0; k < l.i; k++) dx[k] += row[k] * d; } }
  }
  void adam(const vector<float>& g, double lr){
    const double b1 = 0.9, b2 = 0.999; at++;
    double c1 = 1 - pow(b1, at), c2 = 1 - pow(b2, at);
    for (int k = 0; k < n; k++){ float gk = g[k]; m[k] = (float)(b1 * m[k] + (1 - b1) * gk); v[k] = (float)(b2 * v[k] + (1 - b2) * gk * gk);
      p[k] = (float)(p[k] - lr * (m[k] / c1) / (sqrt(v[k] / c2) + 1e-8)); }
  }
};

// pooling shared by both nets: [mover, sum of opponents, max of opponents, next player] from the per-player encodings e
static void poolPlayers(const float* e, int nn, int H, float* tin, int* arg){
  for (int h = 0; h < H; h++){
    float sum = 0, mx = -1; int am = 1;
    for (int k = 1; k < nn; k++){ float v = e[k * H + h]; sum += v; if (v > mx){ mx = v; am = k; } }
    tin[h] = e[h]; tin[H + h] = sum; tin[2 * H + h] = mx; tin[3 * H + h] = e[H + h]; arg[h] = am;
  }
}
// d loss / d (player k's encoding) from d loss / d tin
static void unpoolPlayers(const float* dtin, int k, int H, const int* arg, float* de){
  for (int h = 0; h < H; h++){
    float v;
    if (k == 0) v = dtin[h];
    else { v = dtin[H + h]; if (arg[h] == k) v += dtin[2 * H + h]; if (k == 1) v += dtin[3 * H + h]; }
    de[h] = v;
  }
}

// pnet.js's player net
struct PNet : Model {
  int H, T; Layer L[5];
  struct W : Work { vector<float> e1, e2, tin, t1, t2, o, d2, d1, dtin, de2, de1; vector<int> arg; };
  PNet(int out_, uint32_t seed, int H_, int T_) : H(H_), T(T_){
    out = out_; arch = H == 64 ? "pnetw" : "pnet";
    int dims[5][2] = { { PL, H }, { H, H }, { 4 * H + TB, T }, { T, T }, { T, out } }, off = 0;
    for (int l = 0; l < 5; l++){ L[l] = { dims[l][0], dims[l][1], off, off + dims[l][0] * dims[l][1] }; off += dims[l][0] * dims[l][1] + dims[l][1]; }
    n = off; alloc(); Rng r(seed);
    for (auto& l : L) init(l, r, l.i);
  }
  int nf() const override { return F; }
  void features(const Game& g, float* x) const override { ::features(g, x); }
  Work* work() const override { W* c = new W; c->e1.assign(MAXP * H, 0); c->e2.assign(MAXP * H, 0); c->tin.assign(4 * H + TB, 0);
    c->t1.assign(T, 0); c->t2.assign(T, 0); c->o.assign(out, 0); c->arg.assign(H, 0);
    c->d2.assign(T, 0); c->d1.assign(T, 0); c->dtin.assign(4 * H + TB, 0); c->de2.assign(H, 0); c->de1.assign(H, 0); return c; }
  const float* forward(const float* x, Work* w) const override {
    W& c = *(W*)w; int nn = (int)x[0];
    for (int k = 0; k < nn; k++){ dense(L[0], x + 1 + k * PL, &c.e1[k * H], true); dense(L[1], &c.e1[k * H], &c.e2[k * H], true); }
    poolPlayers(c.e2.data(), nn, H, c.tin.data(), c.arg.data());
    memcpy(c.tin.data() + 4 * H, x + 1 + MAXP * PL, TB * sizeof(float));
    dense(L[2], c.tin.data(), c.t1.data(), true); dense(L[3], c.t1.data(), c.t2.data(), true); dense(L[4], c.t2.data(), c.o.data(), false);
    return c.o.data();
  }
  void backward(const float* x, Work* w, const float* dout, float* g) const override {
    W& c = *(W*)w; int nn = (int)x[0];
    back(L[4], c.t2.data(), dout, g, c.d2.data()); for (int k = 0; k < T; k++) if (c.t2[k] <= 0) c.d2[k] = 0;
    back(L[3], c.t1.data(), c.d2.data(), g, c.d1.data()); for (int k = 0; k < T; k++) if (c.t1[k] <= 0) c.d1[k] = 0;
    back(L[2], c.tin.data(), c.d1.data(), g, c.dtin.data());
    for (int k = 0; k < nn; k++){
      unpoolPlayers(c.dtin.data(), k, H, c.arg.data(), c.de2.data());
      for (int h = 0; h < H; h++) if (c.e2[k * H + h] <= 0) c.de2[h] = 0;
      back(L[1], &c.e1[k * H], c.de2.data(), g, c.de1.data()); for (int h = 0; h < H; h++) if (c.e1[k * H + h] <= 0) c.de1[h] = 0;
      back(L[0], x + 1 + k * PL, c.de1.data(), g, nullptr);
    }
  }
};

// cnet: each player's encoder reads the whole card line 3..35 with a small 1D CNN, over 4 channels: this player holds
// the card, someone holds it (it's been seen), it's the card in play, and the card's value (/35, a position signal).
// Besides that only chips and seat; the table adds pot, cards left and table size. No hand-made costs or scores.
static const int CL = 33, CPL = CL + 1 + MAXP, CTB = 2 * CL + 3, CF = 1 + MAXP * CPL + CTB;
static void cfeatures(const Game& g, float* x){
  memset(x, 0, CF * sizeof(float));
  int p = g.turn, c = g.deck[g.idx], n = g.n, t = 1 + MAXP * CPL;
  x[0] = n;
  for (int k = 0; k < n; k++){
    int q = (p + k) % n, o = 1 + k * CPL;
    for (int v = 3; v <= 35; v++) if (g.has[q * 37 + v]){ x[o + v - 3] = 1; x[t + v - 3] = 1; }
    x[o + CL] = (float)(g.chips[q] / 11.0); x[o + CL + 1 + k] = 1;
  }
  x[t + CL + c - 3] = 1;
  x[t + 2 * CL] = (float)(g.pot / 11.0); x[t + 2 * CL + 1] = (float)(leftOf(g) / 23.0); x[t + 2 * CL + 2] = (float)((n - 2) / 5.0);
}
struct CNet : Model {
  static const int C0 = 4, K1 = 5, K2 = 3;
  int C1, C2, H, T, FL; Layer cv1, cv2, L[4];
  struct W : Work { vector<float> in, a1, a2, flat, e, tin, t1, t2, o, d2, d1, dtin, de, dflat, da1; vector<int> arg; };
  CNet(int out_, uint32_t seed, int C1_ = 8, int C2_ = 8, int H_ = 32, int T_ = 64) : C1(C1_), C2(C2_), H(H_), T(T_){
    out = out_; arch = "cnet"; FL = C2 * CL + 1 + MAXP;
    int off = 0;
    cv1 = { C0 * K1, C1, off, off + C1 * C0 * K1 }; off += C1 * C0 * K1 + C1;
    cv2 = { C1 * K2, C2, off, off + C2 * C1 * K2 }; off += C2 * C1 * K2 + C2;
    int dims[4][2] = { { FL, H }, { 4 * H + 3, T }, { T, T }, { T, out } };
    for (int l = 0; l < 4; l++){ L[l] = { dims[l][0], dims[l][1], off, off + dims[l][0] * dims[l][1] }; off += dims[l][0] * dims[l][1] + dims[l][1]; }
    n = off; alloc(); Rng r(seed);
    init(cv1, r, C0 * K1); init(cv2, r, C1 * K2); for (auto& l : L) init(l, r, l.i);
  }
  int nf() const override { return CF; }
  void features(const Game& g, float* x) const override { cfeatures(g, x); }
  Work* work() const override { W* c = new W; c->in.assign(MAXP * C0 * CL, 0); c->a1.assign(MAXP * C1 * CL, 0); c->flat.assign(MAXP * FL, 0);
    c->e.assign(MAXP * H, 0); c->tin.assign(4 * H + 3, 0); c->t1.assign(T, 0); c->t2.assign(T, 0); c->o.assign(out, 0); c->arg.assign(H, 0);
    c->d2.assign(T, 0); c->d1.assign(T, 0); c->dtin.assign(4 * H + 3, 0); c->de.assign(H, 0); c->dflat.assign(FL, 0); c->da1.assign(C1 * CL, 0); return c; }
  // y[co][pos] = b[co] + sum over ci, j of w[co][ci][j] * x[ci][pos + j - K/2], zero padded
  void conv(const Layer& l, int ci_n, int K, const float* x, float* y, bool relu) const {
    const float* w = p.data() + l.w;
    for (int co = 0; co < l.o; co++){
      float* yr = y + co * CL; for (int pos = 0; pos < CL; pos++) yr[pos] = p[l.b + co];
      for (int ci = 0; ci < ci_n; ci++) for (int j = 0; j < K; j++){
        float wv = w[(co * ci_n + ci) * K + j]; const float* xr = x + ci * CL; int d = j - K / 2;
        int lo = max(0, -d), hi = min(CL, CL - d); for (int pos = lo; pos < hi; pos++) yr[pos] += wv * xr[pos + d];
      }
      if (relu) for (int pos = 0; pos < CL; pos++) if (yr[pos] < 0) yr[pos] = 0;
    }
  }
  void convBack(const Layer& l, int ci_n, int K, const float* x, const float* dy, float* g, float* dx) const {
    const float* w = p.data() + l.w;
    if (dx) memset(dx, 0, ci_n * CL * sizeof(float));
    for (int co = 0; co < l.o; co++){
      const float* dr = dy + co * CL; float bs = 0; for (int pos = 0; pos < CL; pos++) bs += dr[pos]; g[l.b + co] += bs;
      for (int ci = 0; ci < ci_n; ci++) for (int j = 0; j < K; j++){
        int d = j - K / 2, lo = max(0, -d), hi = min(CL, CL - d); const float* xr = x + ci * CL; float s = 0;
        for (int pos = lo; pos < hi; pos++) s += dr[pos] * xr[pos + d];
        g[l.w + (co * ci_n + ci) * K + j] += s;
        if (dx){ float wv = w[(co * ci_n + ci) * K + j]; float* dxr = dx + ci * CL; for (int pos = lo; pos < hi; pos++) dxr[pos + d] += wv * dr[pos]; }
      }
    }
  }
  const float* forward(const float* x, Work* w) const override {
    W& c = *(W*)w; int nn = (int)x[0], t = 1 + MAXP * CPL;
    for (int k = 0; k < nn; k++){
      float* in = &c.in[k * C0 * CL]; const float* px = x + 1 + k * CPL;
      for (int pos = 0; pos < CL; pos++){ in[pos] = px[pos]; in[CL + pos] = x[t + pos]; in[2 * CL + pos] = x[t + CL + pos]; in[3 * CL + pos] = (pos + 3) / 35.0f; }
      float* a1 = &c.a1[k * C1 * CL]; float* fl = &c.flat[k * FL];
      conv(cv1, C0, K1, in, a1, true); conv(cv2, C1, K2, a1, fl, true);
      memcpy(fl + C2 * CL, px + CL, (1 + MAXP) * sizeof(float));
      dense(L[0], fl, &c.e[k * H], true);
    }
    poolPlayers(c.e.data(), nn, H, c.tin.data(), c.arg.data());
    memcpy(c.tin.data() + 4 * H, x + t + 2 * CL, 3 * sizeof(float));
    dense(L[1], c.tin.data(), c.t1.data(), true); dense(L[2], c.t1.data(), c.t2.data(), true); dense(L[3], c.t2.data(), c.o.data(), false);
    return c.o.data();
  }
  void backward(const float* x, Work* w, const float* dout, float* g) const override {
    W& c = *(W*)w; int nn = (int)x[0];
    back(L[3], c.t2.data(), dout, g, c.d2.data()); for (int k = 0; k < T; k++) if (c.t2[k] <= 0) c.d2[k] = 0;
    back(L[2], c.t1.data(), c.d2.data(), g, c.d1.data()); for (int k = 0; k < T; k++) if (c.t1[k] <= 0) c.d1[k] = 0;
    back(L[1], c.tin.data(), c.d1.data(), g, c.dtin.data());
    for (int k = 0; k < nn; k++){
      unpoolPlayers(c.dtin.data(), k, H, c.arg.data(), c.de.data());
      for (int h = 0; h < H; h++) if (c.e[k * H + h] <= 0) c.de[h] = 0;
      const float* fl = &c.flat[k * FL];
      back(L[0], fl, c.de.data(), g, c.dflat.data());
      for (int i = 0; i < C2 * CL; i++) if (fl[i] <= 0) c.dflat[i] = 0;
      const float* a1 = &c.a1[k * C1 * CL];
      convBack(cv2, C1, K2, a1, c.dflat.data(), g, c.da1.data());
      for (int i = 0; i < C1 * CL; i++) if (a1[i] <= 0) c.da1[i] = 0;
      convBack(cv1, C0, K1, &c.in[k * C0 * CL], c.da1.data(), g, nullptr);
    }
  }
};
static Model* makeModel(const string& arch, int out, uint32_t seed){
  if (arch == "pnet") return new PNet(out, seed, 32, 64);
  if (arch == "pnetw") return new PNet(out, seed, 64, 128);
  if (arch == "cnet") return new CNet(out, seed);
  fprintf(stderr, "unknown arch %s\n", arch.c_str()); exit(1);
}
static double sigmaOf(const float* o){ double a = max<double>(o[0], 0), b = max<double>(o[1], 0); return a + b > 0 ? a / (a + b) : o[0] > o[1] ? 1 : 0; }

// ---- files ----
static string readFile(const string& f){ ifstream in(f, ios::binary); stringstream ss; ss << in.rdbuf(); return ss.str(); }
static const char* B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static string b64(const float* a, size_t n){
  const unsigned char* s = (const unsigned char*)a; size_t len = n * 4; string o; o.reserve((len + 2) / 3 * 4);
  for (size_t i = 0; i < len; i += 3){ uint32_t v = s[i] << 16 | (i + 1 < len ? s[i + 1] << 8 : 0) | (i + 2 < len ? s[i + 2] : 0);
    o += B64[v >> 18 & 63]; o += B64[v >> 12 & 63]; o += i + 1 < len ? B64[v >> 6 & 63] : '='; o += i + 2 < len ? B64[v & 63] : '='; }
  return o;
}
static vector<float> unb64(const string& s){
  int map[256]; fill(map, map + 256, -1); for (int i = 0; i < 64; i++) map[(unsigned char)B64[i]] = i;
  vector<unsigned char> b; uint32_t v = 0; int bits = 0;
  for (char ch : s){ int d = map[(unsigned char)ch]; if (d < 0) continue; v = v << 6 | d; bits += 6; if (bits >= 8){ bits -= 8; b.push_back(v >> bits & 255); } }
  vector<float> f(b.size() / 4); memcpy(f.data(), b.data(), f.size() * 4); return f;
}
// the value after "key": in a flat-enough JSON text (strings and numbers only)
static string jsonVal(const string& j, const string& key, size_t from = 0){
  size_t k = j.find("\"" + key + "\":", from); if (k == string::npos) return "";
  k += key.size() + 3;
  if (j[k] == '"'){ size_t e = j.find('"', k + 1); return j.substr(k + 1, e - k - 1); }
  size_t e = j.find_first_of(",}", k); return j.substr(k, e - k);
}
static vector<float> jsonFloats(const string& j, const string& key){
  size_t k = j.find("\"" + key + "\":["); vector<float> out; if (k == string::npos) return out;
  const char* s = j.c_str() + k + key.size() + 4; char* e;
  for (;;){ out.push_back(strtof(s, &e)); s = e; while (*s == ' ') s++; if (*s != ',') break; s++; }
  return out;
}

// ---- training ----
struct Buf { int k, F, rowLen; vector<float> X, Y, W; long size = 0, seen = 0; vector<char> dirty; FILE* fd = nullptr; };
static const long CAP = 1500000;
static uint32_t rs = 987654321;
static double rnd(){ rs ^= rs << 13; rs ^= rs >> 17; rs ^= rs << 5; return rs / 4294967296.0; }

struct Out { vector<float> X, Y, PX, PY; };
// ---- the opponent pool (POOL=a.json,b.json,table,rule; POOLP = chance a seat other than the learner's is from it) ----
// game.js's bucket, keyOf and heuristic, for the table bot (policy.json) and the old rule of thumb
static int bucket(int cost, int chips, int pot, bool fitsMine, bool fitsOpp, int minOpp, int left, int n){
  int cb = cost <= -4 ? 0 : cost <= -1 ? 1 : cost <= 2 ? 2 : cost <= 5 ? 3 : cost <= 9 ? 4 : cost <= 14 ? 5 : cost <= 20 ? 6 : 7;
  int mb = chips <= 1 ? 0 : chips == 2 ? 1 : chips <= 4 ? 2 : chips <= 7 ? 3 : chips <= 11 ? 4 : 5;
  int pb = pot <= 1 ? 0 : pot <= 4 ? 1 : 2, ob = minOpp == 0 ? 0 : minOpp <= 3 ? 1 : 2, lb = left >= 16 ? 0 : left >= 8 ? 1 : 2, nb = n <= 3 ? 0 : n <= 5 ? 1 : 2;
  return ((((((cb * 6 + mb) * 3 + pb) * 2 + fitsMine) * 2 + fitsOpp) * 3 + ob) * 3 + lb) * 3 + nb;
}
static int keyOf(const Game& g){
  int p = g.turn, c = g.deck[g.idx], o = p * 37; bool fitsOpp = false; int minOpp = 99;
  for (int q = 0; q < g.n; q++) if (q != p){ if (g.has[q * 37 + c - 1] || g.has[q * 37 + c + 1]) fitsOpp = true; minOpp = min(minOpp, g.chips[q]); }
  return bucket(addPts(g, p, c) - g.pot, g.chips[p], g.pot, g.has[o + c - 1] || g.has[o + c + 1], fitsOpp, minOpp, leftOf(g), g.n);
}
static bool heuristic(const Game& g, Rng& r){
  int p = g.turn, c = g.deck[g.idx], chips = g.chips[p], o = p * 37;
  int cost = addPts(g, p, c) - g.pot; bool fits = g.has[o + c - 1] || g.has[o + c + 1];
  if (fits && cost <= 0 && g.pot < g.n && r() < 0.5) return false;
  int limit = chips <= 2 ? 12 : chips <= 4 ? 7 : chips <= 7 ? 3 : 0;
  return cost <= limit + (r() < 0.2 ? 2 : 0);
}
struct Opp { int kind; const Model* net; vector<int> drop; };   // kind 0: the net being trained, 1: a saved net, 2: the table bot, 3: the rule of thumb
static vector<Opp> pool; static vector<float> table; static double poolP = 0.5;
static void loadPool(const char* spec){
  string s = spec; size_t a = 0;
  while (a <= s.size()){
    size_t b = s.find(',', a); if (b == string::npos) b = s.size(); string it = s.substr(a, b - a); a = b + 1;
    if (it.empty()) continue;
    if (it == "rule"){ pool.push_back({ 3, nullptr, {} }); continue; }
    if (it == "table"){ string j = readFile("policy.json"); const char* q = j.c_str() + 1; char* e;
      for (;;){ double v = strtod(q, &e); table.push_back(v < 0 ? -1 : (float)(v / 100)); q = e; if (*q != ',') break; q++; }
      pool.push_back({ 2, nullptr, {} }); continue; }
    string j = readFile(it); vector<float> w = jsonFloats(j, "p"); int out = atoi(jsonVal(j, "out").c_str());
    string arch = jsonVal(j, "arch"); Model* net = makeModel(arch.empty() ? "pnet" : arch, out, 1);
    if ((int)w.size() != net->n){ fprintf(stderr, "%s: %zu weights, want %d\n", it.c_str(), w.size(), net->n); exit(1); }
    net->p = w; pool.push_back({ 1, net, net->arch == "cnet" ? vector<int>() : dropList(jsonVal(j, "drop")) });
  }
  if (getenv("POOL")) fprintf(stderr, "opponent pool: %zu\n", pool.size());
}

static const int MAXF = 512;   // room for any model's inputs
static vector<unique_ptr<Work>> poolWork(){ vector<unique_ptr<Work>> pc; for (auto& o : pool) pc.emplace_back(o.net ? o.net->work() : nullptr); return pc; }
static void play(const Model& net, Rng& r, int games, Out& out){
  static const int tables[12] = { 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7 };
  unique_ptr<Work> c(net.work()); int F = net.nf(); vector<float> x(F), feats(F), ox(MAXF);
  auto pc = poolWork();
  int seat[7];   // which pool member sits in each seat (-1: the net being trained)
  auto sigma = [&](const Game& g){ net.features(g, x.data()); dropOut(x.data(), dropIdx); return sigmaOf(net.forward(x.data(), c.get())); };
  auto other = [&](const Game& g, Rng& rr){   // a pool member's move
    int k = seat[g.turn]; const Opp& o = pool[k];
    if (o.kind == 3) return heuristic(g, rr);
    if (o.kind == 2){ float pt = table[keyOf(g)]; return pt >= 0 ? rr() < pt : heuristic(g, rr); }
    o.net->features(g, ox.data()); dropOut(ox.data(), o.drop); const float* y = o.net->forward(ox.data(), pc[k].get());
    return rr() < (o.net->out == 1 ? 1 / (1 + exp(-y[0])) : sigmaOf(y));
  };
  auto rollout = [&](Game g, bool take, uint32_t seed){
    Rng rr(seed); bool over = step(g, take);
    while (!over) over = step(g, g.chips[g.turn] == 0 || (seat[g.turn] >= 0 ? other(g, rr) : rr() < sigma(g)));
    return g;
  };
  for (int i = 0; i < games; i++){
    int n = tables[(int)floor(r() * 12)]; Game g; newGame(g, n, r); int me = (int)floor(r() * n);
    for (int q = 0; q < 7; q++) seat[q] = -1;
    if (!pool.empty()) for (int q = 0; q < n; q++) if (q != me && r() < poolP) seat[q] = (int)floor(r() * pool.size());
    for (;;){
      if (g.chips[g.turn] == 0){ if (step(g, true)) break; continue; }
      if (seat[g.turn] >= 0){ if (step(g, other(g, r))) break; continue; }
      double s = sigma(g);
      if (r() < 0.1){ out.PX.insert(out.PX.end(), x.begin(), x.end()); out.PY.push_back((float)s); }
      if (g.turn == me && r() < 0.25){
        feats = x; uint32_t sd = (uint32_t)(r() * 4294967296.0);
        Game gt = rollout(g, true, sd), gp = rollout(g, false, sd);
        double vt = winShare(gt, me), vp = winShare(gp, me), v = s * vt + (1 - s) * vp;
        out.X.insert(out.X.end(), feats.begin(), feats.end()); out.Y.push_back((float)(vt - v)); out.Y.push_back((float)(vp - v));
      }
      if (step(g, r() < s)) break;
    }
  }
}

static void add(Buf& B, const vector<float>& X, const vector<float>& Y, float w){
  const int F = B.F; long cnt = (long)(X.size() / F);
  for (long i = 0; i < cnt; i++){
    long j = B.size < CAP ? B.size++ : (long)floor(rnd() * (B.seen + 1)); B.seen++;
    if (j < CAP){ memcpy(&B.X[j * F], &X[i * F], F * 4); memcpy(&B.Y[j * B.k], &Y[i * B.k], B.k * 4); B.W[j] = w; B.dirty[j] = 1; }
  }
}
static void flush(Buf& B){
  const int F = B.F; vector<float> row(B.rowLen);
  for (long j = 0; j < B.size; j++) if (B.dirty[j]){
    memcpy(row.data(), &B.X[j * F], F * 4); memcpy(row.data() + F, &B.Y[j * B.k], B.k * 4); row[F + B.k] = B.W[j];
    fseek(B.fd, j * B.rowLen * 4, SEEK_SET); fwrite(row.data(), 4, B.rowLen, B.fd); B.dirty[j] = 0;
  }
  fflush(B.fd); fsync(fileno(B.fd));
}
static void load(Buf& B){
  const int F = B.F; vector<float> row(B.rowLen); fseek(B.fd, 0, SEEK_SET);
  for (long j = 0; j < B.size; j++){
    if (fread(row.data(), 4, B.rowLen, B.fd) != (size_t)B.rowLen){ fprintf(stderr, "short checkpoint\n"); exit(1); }
    memcpy(&B.X[j * F], row.data(), F * 4); memcpy(&B.Y[j * B.k], row.data() + F, B.k * 4); B.W[j] = row[F + B.k];
  }
}

// one Adam step on a batch of bs examples (mse on the regrets, or cross-entropy on P(take)), split across the threads
static double trainStep(Model& net, const Buf& B, int bs, double lr, int nt, vector<vector<float>>& G, vector<unique_ptr<Work>>& C, bool bce = false){
  const int F = B.F; vector<long> idx(bs); double wsum = 0;
  for (int b = 0; b < bs; b++){ idx[b] = (long)floor(rnd() * B.size); wsum += B.W[idx[b]]; }
  vector<double> tot(nt, 0); vector<thread> th;
  for (int t = 0; t < nt; t++) th.emplace_back([&, t]{
    fill(G[t].begin(), G[t].end(), 0.f); float dout[2];
    for (int b = t; b < bs; b += nt){
      long j = idx[b]; const float* x = &B.X[j * F]; const float* o = net.forward(x, C[t].get()); double w = B.W[j] / wsum;
      for (int k = 0; k < B.k; k++){
        double y = B.Y[j * B.k + k];
        if (bce){ double q = 1 / (1 + exp(-o[k])); dout[k] = (float)(w * (q - y)); tot[t] += w * -(y * log(q + 1e-7) + (1 - y) * log(1 - q + 1e-7)); }
        else { double e = o[k] - y; dout[k] = (float)(2 * w * e); tot[t] += w * e * e; }
      }
      net.backward(x, C[t].get(), dout, G[t].data());
    }
  });
  for (auto& t : th) t.join();
  double L = 0; for (int t = 1; t < nt; t++){ auto& g0 = G[0]; auto& gt = G[t]; for (int k = 0; k < net.n; k++) g0[k] += gt[k]; }
  for (double v : tot) L += v;
  net.adam(G[0], lr);
  return L;
}

static void saveJson(const string& file, const string& arch, const Model& net){
  FILE* f = fopen((file + ".tmp").c_str(), "w");
  fprintf(f, "{\"arch\":\"%s\",\"out\":%d,\"drop\":\"%s\",\"p\":[", arch.c_str(), net.out, dropSpec.c_str());
  for (int k = 0; k < net.n; k++) fprintf(f, k ? ",%.5g" : "%.5g", net.p[k]);
  fprintf(f, "]}"); fclose(f); rename((file + ".tmp").c_str(), file.c_str());
}

static int test(const char* wfile, uint32_t seed, int games){
  string j = readFile(wfile); vector<float> w = jsonFloats(j, "p");
  PNet net(2, 1, 32, 64); if ((int)w.size() != net.n){ fprintf(stderr, "weights: %zu, want %d\n", w.size(), net.n); return 1; }
  net.p = w; unique_ptr<Work> cw(net.work()); Work* c = cw.get(); vector<float> x(F); Rng r(seed);
  for (int i = 0; i < games; i++){
    int n = 2 + (int)floor(r() * 6); Game g; newGame(g, n, r);
    for (;;){
      features(g, x.data()); dropOut(x.data(), dropIdx); const float* o = net.forward(x.data(), c);
      double fs = 0; for (int k = 0; k < F; k++) fs += x[k] * (k % 7 + 1);
      printf("%d %d %d %d %.6f %.6f %.6f %d\n", g.turn, g.deck[g.idx], g.pot, g.chips[g.turn], fs, o[0], o[1], keyOf(g));
      if (step(g, g.chips[g.turn] == 0 || r() < 0.4)) break;
    }
    for (int q = 0; q < n; q++) printf("end %d %d %.4f\n", g.pts[q], g.chips[q], winShare(g, q));
  }
  // gradient of out0 + 0.5 out1 summed over the last game's first 5 states (compare with check-cpp.js)
  vector<float> d(net.n, 0); Rng r2(seed + 1); Game g; newGame(g, 5, r2); float dout[2] = { 1, 0.5f };
  for (int s = 0; s < 5; s++){ features(g, x.data()); dropOut(x.data(), dropIdx); net.forward(x.data(), c); net.backward(x.data(), c, dout, d.data()); step(g, r2() < 0.5); }
  double a = 0, b = 0; for (int k = 0; k < net.n; k++){ a += d[k]; b += fabs(d[k]) * (k % 13 + 1); }
  printf("grad %.6f %.6f\n", a, b);
  return 0;
}

// ./deep eval a.json b [games per table size]: one A among B's and one B among A's at 2-7 players, as h2h.js does.
// a and b are weight files, or "table" (the CFR table bot, policy.json) or "rule" (the old rule of thumb).
static int evalMain(int argc, char** argv){
  loadPool((string(argv[2]) + "," + argv[3]).c_str()); int games = argc > 4 ? atoi(argv[4]) : 4000;
  double res[6][2];
  vector<thread> th;
  for (int n = 2; n <= 7; n++) for (int side = 0; side < 2; side++) th.emplace_back([&, n, side]{
    auto pc = poolWork(); vector<float> x(MAXF); Rng r(77 + n * 31 + side * 7);
    auto move = [&](const Game& g, int who){
      const Opp& o = pool[who];
      if (o.kind == 3) return heuristic(g, r);
      if (o.kind == 2){ float pt = table[keyOf(g)]; return pt >= 0 ? r() < pt : heuristic(g, r); }
      o.net->features(g, x.data()); dropOut(x.data(), o.drop); const float* y = o.net->forward(x.data(), pc[who].get());
      return r() < (o.net->out == 1 ? 1 / (1 + exp(-y[0])) : sigmaOf(y));
    };
    double w = 0;
    for (int i = 0; i < games; i++){
      Game g; newGame(g, n, r);
      while (!step(g, g.chips[g.turn] == 0 || move(g, g.turn == 0 ? side : 1 - side)));
      w += winShare(g, 0);
    }
    res[n - 2][side] = w / games;
  });
  for (auto& t : th) t.join();
  printf("players  fair   1 A among B   1 B among A\n");
  for (int n = 2; n <= 7; n++) printf("%d       %5.1f%%   %5.1f%%        %5.1f%%\n", n, 100.0 / n, 100 * res[n - 2][0], 100 * res[n - 2][1]);
  return 0;
}

// ./deep gradcheck <arch>: backward against finite differences, on a few positions from random games
static int gradcheck(const string& arch){
  unique_ptr<Model> m(makeModel(arch, 2, 5)); unique_ptr<Work> w(m->work()); Rng r(9);
  vector<vector<float>> xs; vector<float> x(m->nf());
  for (int i = 0; i < 6; i++){ Game g; newGame(g, 2 + i, r); for (int s = 0; s < 20 + 7 * i; s++) if (step(g, g.chips[g.turn] == 0 || r() < 0.3)) break; m->features(g, x.data()); xs.push_back(x); }
  auto loss = [&]{ double L = 0; for (auto& x : xs){ const float* o = m->forward(x.data(), w.get()); L += o[0] + 0.5 * o[1]; } return L; };
  vector<float> g(m->n, 0); float dout[2] = { 1, 0.5f };
  for (auto& x : xs){ m->forward(x.data(), w.get()); m->backward(x.data(), w.get(), dout, g.data()); }
  int bad = 0, tried = 0; double maxrel = 0;
  for (int t = 0; t < 400; t++){
    int k = t < 200 ? t : (int)(r() * m->n); float p0 = m->p[k], e = 1e-3f;   // the first layer, then anywhere
    m->p[k] = p0 + e; double a = loss(); m->p[k] = p0 - e; double b = loss(); m->p[k] = p0;
    double num = (a - b) / (2 * e), rel = fabs(num - g[k]) / max(1e-2, fabs(num) + fabs(g[k]));
    tried++; if (rel > 0.05){ bad++; } maxrel = max(maxrel, rel);
  }
  printf("%s: %d params, %d of %d differ by more than 5%%\n", arch.c_str(), m->n, bad, tried);
  return 0;
}

int main(int argc, char** argv){
  if (argc > 2 && !strcmp(argv[1], "gradcheck")) return gradcheck(argv[2]);
  if (getenv("DROP")){ dropSpec = getenv("DROP"); dropIdx = dropList(dropSpec); }
  if (argc > 1 && !strcmp(argv[1], "eval")) return evalMain(argc, argv);
  if (argc > 1 && !strcmp(argv[1], "test")) return test(argv[2], atoi(argv[3]), atoi(argv[4]));
  int T = argc > 1 ? atoi(argv[1]) : 40, games = argc > 2 ? atoi(argv[2]) : 2500;
  int nw = argc > 3 ? atoi(argv[3]) : (int)thread::hardware_concurrency();
  string arch = argc > 4 ? argv[4] : "pnet";
  if (getenv("POOL")) loadPool(getenv("POOL"));
  if (getenv("POOLP")) poolP = atof(getenv("POOLP"));
  uint32_t seedOff = getenv("SEED") ? (uint32_t)atoi(getenv("SEED")) : 0;   // SEED=k: a different run of the same setup
  if (!dropIdx.empty() && arch == "cnet"){ fprintf(stderr, "DROP is for pnet\n"); return 1; }
  unique_ptr<Model> netp(makeModel(arch, 2, 11 + seedOff)); Model& net = *netp; int start = 1; const int F = net.nf();
  Buf adv{ 2, F, F + 3 }; adv.X.resize(CAP * F); adv.Y.resize(CAP * 2); adv.W.resize(CAP); adv.dirty.assign(CAP, 0);
  Buf pol{ 1, F, F + 2 }; pol.X.resize(CAP * F); pol.Y.resize(CAP); pol.W.resize(CAP); pol.dirty.assign(CAP, 0);
  string name = arch + (getenv("TAG") ? string("-") + getenv("TAG") : ""), CK = "deep-" + name + "-ckpt"; mkdir(CK.c_str(), 0755);
  for (auto [B, f] : { pair<Buf*, string>{ &adv, "adv" }, { &pol, "pol" } }){
    string fn = CK + "/" + f + ".bin"; B->fd = fopen(fn.c_str(), "r+b"); if (!B->fd) B->fd = fopen(fn.c_str(), "w+b"); }
  string meta = readFile(CK + "/meta.json");
  if (!meta.empty()){
    start = atoi(jsonVal(meta, "t").c_str()) + 1; rs = (uint32_t)strtoul(jsonVal(meta, "rs").c_str(), nullptr, 10);
    size_t a = meta.find("\"adv\":"), pp = meta.find("\"pol\":");
    adv.size = atol(jsonVal(meta, "size", a).c_str()); adv.seen = atol(jsonVal(meta, "seen", a).c_str());
    pol.size = atol(jsonVal(meta, "size", pp).c_str()); pol.seen = atol(jsonVal(meta, "seen", pp).c_str());
    net.p = unb64(jsonVal(meta, "p"));
    if (meta.find("\"m\":") != string::npos){ net.m = unb64(jsonVal(meta, "m")); net.v = unb64(jsonVal(meta, "v")); net.at = atoi(jsonVal(meta, "at").c_str()); }
    if ((int)net.p.size() != net.n){ fprintf(stderr, "checkpoint has %zu weights, want %d\n", net.p.size(), net.n); return 1; }
    load(adv); load(pol); printf("resuming after iteration %d (%ld regret examples)\n", start - 1, adv.size); fflush(stdout);
  }
  vector<Rng> rngs; for (int w = 0; w < nw; w++) rngs.emplace_back(4242 + w * 7919 + (start - 1) * 104729 + seedOff * 1000003);
  vector<vector<float>> G(nw, vector<float>(net.n)); vector<unique_ptr<Work>> C; for (int t = 0; t < nw; t++) C.emplace_back(net.work());
  int steps = getenv("STEPS") ? atoi(getenv("STEPS")) : 1500;
  auto t0 = chrono::steady_clock::now(); auto secs = [&]{ return chrono::duration<double>(chrono::steady_clock::now() - t0).count(); };
  for (int t = start; t <= T; t++){
    double tp = secs(); vector<Out> outs(nw); vector<thread> th;
    for (int w = 0; w < nw; w++) th.emplace_back([&, w]{ play(net, rngs[w], games, outs[w]); });
    for (auto& x : th) x.join();
    tp = secs() - tp;
    for (auto& o : outs){ add(adv, o.X, o.Y, (float)t); add(pol, o.PX, o.PY, (float)t); }
    double L = 0; for (int s = 0; s < steps; s++) L = 0.98 * L + 0.02 * trainStep(net, adv, 512, 1e-3, nw, G, C);
    printf("iter %d/%d: %ld regret examples, loss %.4f, %.0fs (play %.0fs)\n", t, T, adv.size, L, secs(), tp); fflush(stdout);
    saveJson("deep-" + name + "-adv.json", arch, net);
    flush(adv); flush(pol);
    FILE* f = fopen((CK + "/meta.tmp").c_str(), "w");
    fprintf(f, "{\"t\":%d,\"rs\":%u,\"adv\":{\"size\":%ld,\"seen\":%ld},\"pol\":{\"size\":%ld,\"seen\":%ld},\"p\":\"%s\",\"m\":\"%s\",\"v\":\"%s\",\"at\":%d}",
      t, rs, adv.size, adv.seen, pol.size, pol.seen, b64(net.p.data(), net.n).c_str(), b64(net.m.data(), net.n).c_str(), b64(net.v.data(), net.n).c_str(), net.at);
    fclose(f); rename((CK + "/meta.tmp").c_str(), (CK + "/meta.json").c_str());
  }
  // the average strategy: P(take) over every recorded decision, weighted by iteration
  unique_ptr<Model> avgp(makeModel(arch, 1, 12)); Model& avg = *avgp;
  vector<vector<float>> PG(nw, vector<float>(avg.n)); vector<unique_ptr<Work>> PC; for (int t = 0; t < nw; t++) PC.emplace_back(avg.work());
  int ps = getenv("PSTEPS") ? atoi(getenv("PSTEPS")) : 20000; double L = 0;
  printf("average-strategy net on %ld decisions\n", pol.size); fflush(stdout);
  for (int s = 0; s < ps; s++){
    L = 0.98 * L + 0.02 * trainStep(avg, pol, 512, s < ps * 0.7 ? 1e-3 : 3e-4, nw, PG, PC, true);
    if (ps >= 10 && (s + 1) % (ps / 10) == 0){ printf("  step %d/%d: loss %.4f\n", s + 1, ps, L); fflush(stdout); }
  }
  saveJson("deep-" + name + ".json", arch, avg);
  printf("done, %.0fs\n", secs());
}
