// Exact solver for No Thanks! positions by backward induction.
// Everything in the game is public (cards taken, chips, pot) except the order of the deck, so the game is one of
// perfect information with chance moves. With 2 players (win share is zero-sum) backward induction gives the minimax
// value and a pure optimal strategy: that *is* the Nash equilibrium, no CFR needed. With 3+ players it gives a
// subgame-perfect equilibrium (each player maximises its own win share; ties go to "pass").
#pragma once
#include <cstdint>
#include <cstring>
#include <vector>
#include <array>
#include <cstdio>
#include <cstdlib>

typedef unsigned __int128 u128;
static const int SMAXP = 3, SMAXK = 33;

struct Cfg {
  int n = 2;            // players
  int K = 33;           // cards, values lo .. lo+K-1
  int lo = 3;
  int D = 24;           // cards dealt (the rest are removed unseen)
  int C = 11;           // starting chips
};

struct Pos {             // a decision: card `cur` (index 0..K-1) is up with `pot` chips on it, `turn` to move
  int8_t own[SMAXK];     // -1: not seen yet (in the deck or removed), else the player holding it
  int chips[SMAXP];
  int pts[SMAXP];         // points so far
  int pot, turn, cur, owned;   // owned: cards taken so far (the game ends when owned == D)
};

typedef std::array<float, SMAXP> Val;

struct Table {           // open addressing, u128 keys (0 = empty; keys always have a set marker bit)
  std::vector<u128> k; std::vector<Val> v; size_t mask, used = 0;
  explicit Table(int bits = 20){ k.assign((size_t)1 << bits, 0); v.resize(k.size()); mask = k.size() - 1; }
  static size_t h(u128 x){ uint64_t a = (uint64_t)x, b = (uint64_t)(x >> 64); a ^= b * 0x9E3779B97F4A7C15ull; a ^= a >> 29; a *= 0xBF58476D1CE4E5B9ull; a ^= a >> 32; return a; }
  Val* find(u128 x){ for (size_t i = h(x) & mask;; i = (i + 1) & mask){ if (k[i] == x) return &v[i]; if (!k[i]) return nullptr; } }
  void put(u128 x, const Val& val){
    if ((used + 1) * 10 > k.size() * 7) grow();
    for (size_t i = h(x) & mask;; i = (i + 1) & mask){ if (!k[i]){ k[i] = x; v[i] = val; used++; return; } if (k[i] == x){ v[i] = val; return; } }
  }
  void grow(){ std::vector<u128> ok; std::vector<Val> ov; ok.swap(k); ov.swap(v);
    k.assign(ok.size() * 2, 0); v.resize(k.size()); mask = k.size() - 1; used = 0;
    for (size_t i = 0; i < ok.size(); i++) if (ok[i]) put(ok[i], ov[i]); }
};

#include <functional>
struct Solver {
  Cfg c; Table T; long nodes = 0;
  // bot[q], when set, gives P(take) for player q, who then plays that fixed policy instead of maximising. Bots may look
  // at the whole history, so positions are then keyed exactly (exact = true).
  std::function<float(const Pos&)> bot[SMAXP]; bool exact = false;
  explicit Solver(const Cfg& cfg, int bits = 20) : c(cfg), T(bits){}

  // Only the owners of cards next to a card still to come matter for the future (plus everyone's points so far), so a
  // taken card with no unseen neighbour is keyed as if player 0 held it, and points enter as differences from player 0.
  u128 key(const Pos& p) const {
    u128 x = 1;   // marker
    for (int i = 0; i < c.K; i++){
      int o = p.own[i];
      if (!exact && o > 0 && !(i > 0 && p.own[i - 1] < 0) && !(i + 1 < c.K && p.own[i + 1] < 0)) o = 0;
      x = x << 2 | (u128)(o + 1);
    }
    if (!exact) for (int q = 1; q < c.n; q++) x = x << 10 | (u128)(p.pts[q] - p.pts[0] + 512);   // (points follow from the cards when exact)
    for (int q = 0; q < c.n - 1; q++) x = x << 7 | (u128)p.chips[q];   // the last player's chips follow from the total
    x = x << 7 | (u128)p.pot; x = x << 2 | (u128)p.turn; x = x << 6 | (u128)p.cur;
    return x;
  }
  int value(int i) const { return c.lo + i; }
  // points player q gains by taking card i: its value unless q holds the card below, minus the card above if q holds it
  int gain(const Pos& p, int q, int i) const {
    return (i > 0 && p.own[i - 1] == q ? 0 : value(i)) - (i + 1 < c.K && p.own[i + 1] == q ? value(i + 1) : 0);
  }
  Val terminal(const Pos& p) const {
    Val r{}; int sc[SMAXP], best = 1 << 30, k = 0;
    for (int q = 0; q < c.n; q++){ sc[q] = p.pts[q] - p.chips[q]; if (sc[q] < best){ best = sc[q]; k = 1; } else if (sc[q] == best) k++; }
    for (int q = 0; q < c.n; q++) r[q] = sc[q] == best ? 1.0f / k : 0;
    return r;
  }
  // value after the card is taken: next card drawn uniformly from the unseen ones (or game over)
  Val chance(Pos& p){
    if (p.owned == c.D) return terminal(p);
    Val r{}; int m = 0;
    for (int i = 0; i < c.K; i++) if (p.own[i] < 0){
      p.cur = i; p.pot = 0; Val v = solve(p); for (int q = 0; q < c.n; q++) r[q] += v[q]; m++;
    }
    for (int q = 0; q < c.n; q++) r[q] /= m;
    return r;
  }
  Val takeVal(Pos p){ int t = p.turn; p.pts[t] += gain(p, t, p.cur); p.own[p.cur] = t; p.chips[t] += p.pot; p.owned++; return chance(p); }
  Val passVal(Pos p){ p.chips[p.turn]--; p.pot++; p.turn = (p.turn + 1) % c.n; return solve(p); }
  Val solve(const Pos& p){
    u128 k = key(p); if (Val* v = T.find(k)) return *v;
    nodes++;
    Val r;
    if (p.chips[p.turn] == 0) r = takeVal(p);
    else if (bot[p.turn]){
      float t = bot[p.turn](p); Val a{}, b{};
      if (t > 1e-4f) a = takeVal(p);
      if (t < 1 - 1e-4f) b = passVal(p);
      for (int q = 0; q < c.n; q++) r[q] = t * a[q] + (1 - t) * b[q];
    }
    else { Val a = takeVal(p), b = passVal(p); r = a[p.turn] > b[p.turn] + 1e-6f ? a : b; }
    T.put(k, r);
    return r;
  }
  // the start of a game: player 0 moves first, first card random
  Pos start() const { Pos p; memset(p.own, -1, sizeof p.own); for (int q = 0; q < SMAXP; q++) { p.chips[q] = q < c.n ? c.C : 0; p.pts[q] = 0; }
    p.pot = 0; p.turn = 0; p.cur = 0; p.owned = 0; return p; }
  Val root(){ Pos p = start(); return chance(p); }
};
