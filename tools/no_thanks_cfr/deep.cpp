// deep.js in C++: the same Deep CFR training of the player net (pnet.js), several times faster.
//   g++ -O3 -march=native -ffast-math -std=c++17 -pthread deep.cpp -o deep      (on an M1: clang++ -mcpu=native ...)
//   ./deep [iterations] [games per worker per iteration] [workers] [pnet|pnetw]   -> writes deep-<arch>-adv.json
// It reads and writes the same checkpoint as deep.js (deep-<arch>-ckpt/), so a run can move between the two.
// It skips deep.js's average-policy net: the regret net's strategy is what ships.
//   ./deep test <weights.json> <seed> <games>   prints game steps, features and net outputs (compare with check-cpp.js)
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
struct Cache { vector<float> e1, e2, tin, t1, t2, o; vector<int> arg; };
struct Grads { vector<float> g, t2, t1, tin, e2, e1; };
struct PNet {
  int out, H, T, n; Layer L[5]; vector<float> p, m, v; int at = 0;
  PNet(int out_, uint32_t seed, int H_, int T_) : out(out_), H(H_), T(T_){
    int dims[5][2] = { { PL, H }, { H, H }, { 4 * H + TB, T }, { T, T }, { T, out } }, off = 0;
    for (int l = 0; l < 5; l++){ L[l] = { dims[l][0], dims[l][1], off, off + dims[l][0] * dims[l][1] }; off += dims[l][0] * dims[l][1] + dims[l][1]; }
    n = off; p.assign(n, 0); m.assign(n, 0); v.assign(n, 0);
    Rng r(seed);
    for (auto& l : L){ double lim = sqrt(6.0 / l.i);
      for (int k = 0; k < l.i * l.o; k++) p[l.w + k] = (float)((r() * 2 - 1) * lim);
      for (int k = 0; k < l.o; k++) p[l.b + k] = 0.01f; }
  }
  Cache cache() const { Cache c; c.e1.assign(MAXP * H, 0); c.e2.assign(MAXP * H, 0); c.tin.assign(4 * H + TB, 0);
    c.t1.assign(T, 0); c.t2.assign(T, 0); c.o.assign(out, 0); c.arg.assign(H, 0); return c; }
  Grads grads() const { Grads d; d.g.assign(n, 0); d.t2.assign(T, 0); d.t1.assign(T, 0); d.tin.assign(4 * H + TB, 0);
    d.e2.assign(H, 0); d.e1.assign(H, 0); return d; }
  void dense(const Layer& l, const float* x, float* y, bool relu) const {
    const float* w = p.data() + l.w;
    for (int j = 0; j < l.o; j++){ const float* row = w + j * l.i; float s = 0; for (int k = 0; k < l.i; k++) s += row[k] * x[k];
      s += p[l.b + j]; y[j] = relu && s < 0 ? 0 : s; }
  }
  const float* forward(const float* x, Cache& c) const {
    int nn = (int)x[0];
    for (int k = 0; k < nn; k++){ dense(L[0], x + 1 + k * PL, &c.e1[k * H], true); dense(L[1], &c.e1[k * H], &c.e2[k * H], true); }
    float* tin = c.tin.data();
    for (int h = 0; h < H; h++){
      float sum = 0, mx = -1; int am = 1;
      for (int k = 1; k < nn; k++){ float v = c.e2[k * H + h]; sum += v; if (v > mx){ mx = v; am = k; } }
      tin[h] = c.e2[h]; tin[H + h] = sum; tin[2 * H + h] = mx; tin[3 * H + h] = c.e2[H + h]; c.arg[h] = am;
    }
    memcpy(tin + 4 * H, x + 1 + MAXP * PL, TB * sizeof(float));
    dense(L[2], tin, c.t1.data(), true); dense(L[3], c.t1.data(), c.t2.data(), true); dense(L[4], c.t2.data(), c.o.data(), false);
    return c.o.data();
  }
  void back(const Layer& l, const float* x, const float* dy, float* g, float* dx) const {
    const float* w = p.data() + l.w;
    for (int j = 0; j < l.o; j++){ float d = dy[j]; if (d == 0) continue; g[l.b + j] += d; float* gr = g + l.w + j * l.i; for (int k = 0; k < l.i; k++) gr[k] += d * x[k]; }
    if (dx){ for (int k = 0; k < l.i; k++) dx[k] = 0;
      for (int j = 0; j < l.o; j++){ float d = dy[j]; if (d == 0) continue; const float* row = w + j * l.i; for (int k = 0; k < l.i; k++) dx[k] += row[k] * d; } }
  }
  void backward(const float* x, const Cache& c, const float* dout, Grads& d) const {
    int nn = (int)x[0];
    back(L[4], c.t2.data(), dout, d.g.data(), d.t2.data()); for (int k = 0; k < T; k++) if (c.t2[k] <= 0) d.t2[k] = 0;
    back(L[3], c.t1.data(), d.t2.data(), d.g.data(), d.t1.data()); for (int k = 0; k < T; k++) if (c.t1[k] <= 0) d.t1[k] = 0;
    back(L[2], c.tin.data(), d.t1.data(), d.g.data(), d.tin.data());
    for (int k = 0; k < nn; k++){
      for (int h = 0; h < H; h++){
        float v;
        if (k == 0) v = d.tin[h];
        else { v = d.tin[H + h]; if (c.arg[h] == k) v += d.tin[2 * H + h]; if (k == 1) v += d.tin[3 * H + h]; }
        d.e2[h] = c.e2[k * H + h] > 0 ? v : 0;
      }
      back(L[1], &c.e1[k * H], d.e2.data(), d.g.data(), d.e1.data()); for (int h = 0; h < H; h++) if (c.e1[k * H + h] <= 0) d.e1[h] = 0;
      back(L[0], x + 1 + k * PL, d.e1.data(), d.g.data(), nullptr);
    }
  }
  void adam(const vector<float>& g, double lr){
    const double b1 = 0.9, b2 = 0.999; at++;
    double c1 = 1 - pow(b1, at), c2 = 1 - pow(b2, at);
    for (int k = 0; k < n; k++){ float gk = g[k]; m[k] = (float)(b1 * m[k] + (1 - b1) * gk); v[k] = (float)(b2 * v[k] + (1 - b2) * gk * gk);
      p[k] = (float)(p[k] - lr * (m[k] / c1) / (sqrt(v[k] / c2) + 1e-8)); }
  }
};
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
struct Buf { int k, rowLen; vector<float> X, Y, W; long size = 0, seen = 0; vector<char> dirty; FILE* fd = nullptr; };
static const long CAP = 1500000;
static uint32_t rs = 987654321;
static double rnd(){ rs ^= rs << 13; rs ^= rs >> 17; rs ^= rs << 5; return rs / 4294967296.0; }

struct Out { vector<float> X, Y; };
static void play(const PNet& net, Rng& r, int games, Out& out){
  static const int tables[12] = { 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 7 };
  Cache c = net.cache(); vector<float> x(F), feats(F);
  auto sigma = [&](const Game& g){ features(g, x.data()); return sigmaOf(net.forward(x.data(), c)); };
  auto rollout = [&](Game g, bool take, uint32_t seed){
    Rng rr(seed); bool over = step(g, take);
    while (!over) over = step(g, g.chips[g.turn] == 0 || rr() < sigma(g));
    return g;
  };
  for (int i = 0; i < games; i++){
    int n = tables[(int)floor(r() * 12)]; Game g; newGame(g, n, r); int me = (int)floor(r() * n);
    for (;;){
      if (g.chips[g.turn] == 0){ if (step(g, true)) break; continue; }
      double s = sigma(g);
      r();   // deep.js draws here to sample the policy net's examples
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

static void add(Buf& B, const Out& o, float w){
  long cnt = (long)(o.X.size() / F);
  for (long i = 0; i < cnt; i++){
    long j = B.size < CAP ? B.size++ : (long)floor(rnd() * (B.seen + 1)); B.seen++;
    if (j < CAP){ memcpy(&B.X[j * F], &o.X[i * F], F * 4); memcpy(&B.Y[j * B.k], &o.Y[i * B.k], B.k * 4); B.W[j] = w; B.dirty[j] = 1; }
  }
}
static void flush(Buf& B){
  vector<float> row(B.rowLen);
  for (long j = 0; j < B.size; j++) if (B.dirty[j]){
    memcpy(row.data(), &B.X[j * F], F * 4); memcpy(row.data() + F, &B.Y[j * B.k], B.k * 4); row[F + B.k] = B.W[j];
    fseek(B.fd, j * B.rowLen * 4, SEEK_SET); fwrite(row.data(), 4, B.rowLen, B.fd); B.dirty[j] = 0;
  }
  fflush(B.fd); fsync(fileno(B.fd));
}
static void load(Buf& B){
  vector<float> row(B.rowLen); fseek(B.fd, 0, SEEK_SET);
  for (long j = 0; j < B.size; j++){
    if (fread(row.data(), 4, B.rowLen, B.fd) != (size_t)B.rowLen){ fprintf(stderr, "short checkpoint\n"); exit(1); }
    memcpy(&B.X[j * F], row.data(), F * 4); memcpy(&B.Y[j * B.k], row.data() + F, B.k * 4); B.W[j] = row[F + B.k];
  }
}

// one Adam step on a batch of bs examples (mse on the regrets), the gradient split across the threads
static double trainStep(PNet& net, const Buf& B, int bs, double lr, int nt, vector<Grads>& G, vector<Cache>& C){
  vector<long> idx(bs); double wsum = 0;
  for (int b = 0; b < bs; b++){ idx[b] = (long)floor(rnd() * B.size); wsum += B.W[idx[b]]; }
  vector<double> tot(nt, 0); vector<thread> th;
  for (int t = 0; t < nt; t++) th.emplace_back([&, t]{
    Grads& d = G[t]; fill(d.g.begin(), d.g.end(), 0.f); float dout[2];
    for (int b = t; b < bs; b += nt){
      long j = idx[b]; const float* x = &B.X[j * F]; const float* o = net.forward(x, C[t]); double w = B.W[j] / wsum;
      for (int k = 0; k < 2; k++){ double e = o[k] - B.Y[j * 2 + k]; dout[k] = (float)(2 * w * e); tot[t] += w * e * e; }
      net.backward(x, C[t], dout, d);
    }
  });
  for (auto& t : th) t.join();
  double L = 0; for (int t = 1; t < nt; t++){ auto& g0 = G[0].g; auto& gt = G[t].g; for (int k = 0; k < net.n; k++) g0[k] += gt[k]; }
  for (double v : tot) L += v;
  net.adam(G[0].g, lr);
  return L;
}

static void saveJson(const string& file, const string& arch, const PNet& net){
  FILE* f = fopen((file + ".tmp").c_str(), "w");
  fprintf(f, "{\"arch\":\"%s\",\"out\":2,\"p\":[", arch.c_str());
  for (int k = 0; k < net.n; k++) fprintf(f, k ? ",%.5g" : "%.5g", net.p[k]);
  fprintf(f, "]}"); fclose(f); rename((file + ".tmp").c_str(), file.c_str());
}

static int test(const char* wfile, uint32_t seed, int games){
  string j = readFile(wfile); vector<float> w = jsonFloats(j, "p");
  PNet net(2, 1, 32, 64); if ((int)w.size() != net.n){ fprintf(stderr, "weights: %zu, want %d\n", w.size(), net.n); return 1; }
  net.p = w; Cache c = net.cache(); vector<float> x(F); Rng r(seed);
  for (int i = 0; i < games; i++){
    int n = 2 + (int)floor(r() * 6); Game g; newGame(g, n, r);
    for (;;){
      features(g, x.data()); const float* o = net.forward(x.data(), c);
      double fs = 0; for (int k = 0; k < F; k++) fs += x[k] * (k % 7 + 1);
      printf("%d %d %d %d %.6f %.6f %.6f\n", g.turn, g.deck[g.idx], g.pot, g.chips[g.turn], fs, o[0], o[1]);
      if (step(g, g.chips[g.turn] == 0 || r() < 0.4)) break;
    }
    for (int q = 0; q < n; q++) printf("end %d %d %.4f\n", g.pts[q], g.chips[q], winShare(g, q));
  }
  // gradient of out0 + 0.5 out1 summed over the last game's first 5 states (compare with check-cpp.js)
  Grads d = net.grads(); Rng r2(seed + 1); Game g; newGame(g, 5, r2); float dout[2] = { 1, 0.5f };
  for (int s = 0; s < 5; s++){ features(g, x.data()); net.forward(x.data(), c); net.backward(x.data(), c, dout, d); step(g, r2() < 0.5); }
  double a = 0, b = 0; for (int k = 0; k < net.n; k++){ a += d.g[k]; b += fabs(d.g[k]) * (k % 13 + 1); }
  printf("grad %.6f %.6f\n", a, b);
  return 0;
}

int main(int argc, char** argv){
  if (argc > 1 && !strcmp(argv[1], "test")) return test(argv[2], atoi(argv[3]), atoi(argv[4]));
  int T = argc > 1 ? atoi(argv[1]) : 40, games = argc > 2 ? atoi(argv[2]) : 2500;
  int nw = argc > 3 ? atoi(argv[3]) : (int)thread::hardware_concurrency();
  string arch = argc > 4 ? argv[4] : "pnet";
  int H = arch == "pnetw" ? 64 : 32, TT = arch == "pnetw" ? 128 : 64;
  PNet net(2, 11, H, TT); int start = 1;
  Buf adv{ 2, F + 3 }; adv.X.resize(CAP * F); adv.Y.resize(CAP * 2); adv.W.resize(CAP); adv.dirty.assign(CAP, 0);
  string CK = "deep-" + arch + "-ckpt"; mkdir(CK.c_str(), 0755);
  string af = CK + "/adv.bin"; adv.fd = fopen(af.c_str(), "r+b"); if (!adv.fd) adv.fd = fopen(af.c_str(), "w+b");
  string polMeta = "{\"size\":0,\"seen\":0}";
  string meta = readFile(CK + "/meta.json");
  if (!meta.empty()){
    start = atoi(jsonVal(meta, "t").c_str()) + 1; rs = (uint32_t)strtoul(jsonVal(meta, "rs").c_str(), nullptr, 10);
    size_t a = meta.find("\"adv\":"), pp = meta.find("\"pol\":");
    adv.size = atol(jsonVal(meta, "size", a).c_str()); adv.seen = atol(jsonVal(meta, "seen", a).c_str());
    polMeta = meta.substr(pp + 6, meta.find('}', pp) - pp - 5);
    net.p = unb64(jsonVal(meta, "p"));
    if (meta.find("\"m\":") != string::npos){ net.m = unb64(jsonVal(meta, "m")); net.v = unb64(jsonVal(meta, "v")); net.at = atoi(jsonVal(meta, "at").c_str()); }
    if ((int)net.p.size() != net.n){ fprintf(stderr, "checkpoint has %zu weights, want %d\n", net.p.size(), net.n); return 1; }
    load(adv); printf("resuming after iteration %d (%ld regret examples)\n", start - 1, adv.size); fflush(stdout);
  }
  vector<Rng> rngs; for (int w = 0; w < nw; w++) rngs.emplace_back(4242 + w * 7919 + (start - 1) * 104729);
  vector<Grads> G; vector<Cache> C; for (int t = 0; t < nw; t++){ G.push_back(net.grads()); C.push_back(net.cache()); }
  int steps = getenv("STEPS") ? atoi(getenv("STEPS")) : 1500;
  auto t0 = chrono::steady_clock::now(); auto secs = [&]{ return chrono::duration<double>(chrono::steady_clock::now() - t0).count(); };
  for (int t = start; t <= T; t++){
    double tp = secs(); vector<Out> outs(nw); vector<thread> th;
    for (int w = 0; w < nw; w++) th.emplace_back([&, w]{ play(net, rngs[w], games, outs[w]); });
    for (auto& x : th) x.join();
    tp = secs() - tp;
    for (auto& o : outs) add(adv, o, (float)t);
    double L = 0; for (int s = 0; s < steps; s++) L = 0.98 * L + 0.02 * trainStep(net, adv, 512, 1e-3, nw, G, C);
    printf("iter %d/%d: %ld regret examples, loss %.4f, %.0fs (play %.0fs)\n", t, T, adv.size, L, secs(), tp); fflush(stdout);
    saveJson("deep-" + arch + "-adv.json", arch, net);
    flush(adv);
    FILE* f = fopen((CK + "/meta.tmp").c_str(), "w");
    fprintf(f, "{\"t\":%d,\"rs\":%u,\"adv\":{\"size\":%ld,\"seen\":%ld},\"pol\":%s,\"p\":\"%s\",\"m\":\"%s\",\"v\":\"%s\",\"at\":%d}",
      t, rs, adv.size, adv.seen, polMeta.c_str(), b64(net.p.data(), net.n).c_str(), b64(net.m.data(), net.n).c_str(), b64(net.v.data(), net.n).c_str(), net.at);
    fclose(f); rename((CK + "/meta.tmp").c_str(), (CK + "/meta.json").c_str());
  }
  printf("done, %.0fs\n", secs());
}
