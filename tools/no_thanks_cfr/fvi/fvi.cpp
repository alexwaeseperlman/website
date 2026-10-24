// Backward induction with a learned value function ("fitted value iteration"), 2 players.
// V_k(position) = win share of the player to move when k cards are still to be dealt after the one in play.
// Stage 0 targets are exact. Stage k targets come from the already trained V_(k-1): taking averages V_(k-1) over the
// cards that can come next (the taker moves again), and the chain of passes on the same card is searched exactly
// (each node: max(take, 1 - value of the opponent's node after a pass)). Every node of that chain is a stage-k example.
// With 2 players (zero-sum) this approximates the minimax = Nash strategy.
//   g++ -O3 -march=native -ffast-math -std=c++17 -pthread fvi.cpp -o fvi
//   ./fvi train <from stage> <to stage> <chains per stage> [epochs]   -> v<k>.json (cnet3, 1 output: logit of V)
//   ./fvi check <stage> <positions>       net vs the exact solver (../nash/solve.h), k <= 3
//   ./fvi play <games> <upto>             the V policy (one-step lookahead) for the last upto+1 cards vs the live bot
//   ./fvi errs <positions> / worst <positions> <show>   stage-0 errors by score lead / the worst positions written out
// HARD=0.5 [HARDT=0.1] draws that share of each batch from the examples currently off by more than HARDT (didn't help).
// The anet version (anet.h) learns afterstate values with the pass chain as an exact min/max layer instead:
//   ./fvi atrain <stage> <chains> <epochs>   -> a<k>.json (warm start and targets from a<k-1>.json)
//   ./fvi acheck <stage> <positions>         anet + chain vs the exact solver
//   ./fvi aplay <games>                      anet chain policy (every a<k>.json present) vs the live bot, 2 players
//   ./fvi atrain0 <chains> <epochs>          stage 0 only, with held-out decision RMSE in aloss0.csv;  ./fvi agrad: gradient check
// The live bot (LIVE, default ../nash/live.json) only picks the sample positions.
#define main deep_main
#include "../deep.cpp"
#undef main
#include "../nash/solve.h"
#include <map>
#include <set>
#include <unordered_map>
#include "anet.h"

static const char* ARCH = getenv("ARCH") ? getenv("ARCH") : "cnet3";
static string vfile(int k){ return "v" + to_string(k) + ".json"; }
static Model* liveNet = nullptr;
static Model* newV(){ return makeModel(ARCH, 1, 7); }

static double sig(double z){ return 1 / (1 + exp(-z)); }

struct VNet {   // a stage's value net plus per-thread scratch
  Model* m; unique_ptr<Work> w; vector<float> x;
  explicit VNet(Model* m_) : m(m_), w(m_->work()), x(MAXF){}
  double operator()(const Game& g){ m->features(g, x.data()); return sig(m->forward(x.data(), w.get())[0]); }
};

// value for the taker of taking the card in play (k = cards left after it); prev = V_(k-1)
static double takeValue(const Game& g0, int k, VNet* prev){
  Game g = g0; int t = g.turn; bool over = step(g, true);
  if (over) return winShare(g, t);
  // the next card is uniform over the cards not seen yet (deck order is unknown)
  bool seen[37] = {}; for (int q = 0; q < g.n; q++) for (int v = 3; v <= 35; v++) if (g.has[q * 37 + v]) seen[v] = true;
  double s = 0; int m = 0;
  for (int v = 3; v <= 35; v++) if (!seen[v]){ g.deck[g.idx] = v; s += (*prev)(g); m++; }
  (void)k; return s / m;
}
// the exact search over the chain of passes on this card: values (for the mover) of every node, from g0 on
static void chain(const Game& g0, int k, VNet* prev, vector<Game>& nodes, vector<double>& vals){
  nodes.clear(); vals.clear(); Game g = g0; vector<double> T;
  for (;;){
    nodes.push_back(g); T.push_back(takeValue(g, k, prev));
    if (g.chips[g.turn] == 0) break;
    step(g, false);
  }
  vals.assign(nodes.size(), 0);
  for (int j = (int)nodes.size() - 1; j >= 0; j--){
    const Game& h = nodes[j];
    vals[j] = h.chips[h.turn] == 0 || j + 1 == (int)nodes.size() ? T[j] : max(T[j], 1 - vals[j + 1]);
  }
}

// a position with k cards left at a fresh card (pot 0), reached by the live bot playing both seats with some random moves
static void sample(Game& g, int k, Rng& r, Work* lw, float* x, double eps){
  for (;;){
    newGame(g, 2, r);
    for (;;){
      if (leftOf(g) == k && g.pot == 0){
        if (r() < 0.5) return;   // sometimes start the chain later (pass a few times) for more varied chips
        int passes = (int)(r() * 6); bool ok = true;
        for (int i = 0; i < passes; i++){ if (g.chips[g.turn] == 0){ ok = false; break; } step(g, false); }
        if (ok) return; else break;
      }
      bool take;
      if (g.chips[g.turn] == 0) take = true;
      else if (r() < eps) take = r() < 0.5;
      else { liveNet->features(g, x); take = r() < takeProb(*liveNet, liveNet->forward(x, lw)); }
      if (step(g, take)) break;
    }
  }
}

static Model* loadV(int k){ return loadNet(vfile(k)); }

static void trainStage(int k, int chains, int epochs){
  const int NT = thread::hardware_concurrency();
  unique_ptr<Model> prevM(k > 0 ? loadV(k - 1) : nullptr);
  unique_ptr<Model> net(k > 0 ? loadV(k - 1) : newV());   // warm start from the previous stage
  const int F = net->nf();
  // 1. targets
  vector<vector<float>> X(NT); vector<vector<float>> Y(NT); atomic<int> next{ 0 };
  auto t0 = chrono::steady_clock::now();
  { vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&, t]{
      unique_ptr<VNet> prev(prevM ? new VNet(prevM.get()) : nullptr); unique_ptr<Work> lw(liveNet->work()); vector<float> x(MAXF), f(MAXF);
      vector<Game> nodes; vector<double> vals;
      for (int i; (i = next++) < chains;){
        Rng r(77 + k * 1000003 + i * 7919); Game g; sample(g, k, r, lw.get(), x.data(), 0.1);
        chain(g, k, prev.get(), nodes, vals);
        for (size_t j = 0; j < nodes.size(); j++){ net->features(nodes[j], f.data()); X[t].insert(X[t].end(), f.begin(), f.begin() + F); Y[t].push_back((float)vals[j]); }
      }
    });
    for (auto& t : th) t.join(); }
  vector<float> AX, AY; for (int t = 0; t < NT; t++){ AX.insert(AX.end(), X[t].begin(), X[t].end()); AY.insert(AY.end(), Y[t].begin(), Y[t].end()); }
  long n = (long)AY.size(), nTest = n / 50, nTrain = n - nTest;   // the last 2% (whole chains from the last thread) held out
  double tg = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
  // 2. fit: cross-entropy against the soft target, Adam
  vector<vector<float>> G(NT, vector<float>(net->n)); vector<unique_ptr<Work>> C; for (int t = 0; t < NT; t++) C.emplace_back(net->work());
  auto evalSet = [&](long a, long b){ double se = 0; for (long i = a; i < b; i++){ double v = sig(net->forward(&AX[i * F], C[0].get())[0]); se += (v - AY[i]) * (v - AY[i]); } return sqrt(se / max(1L, b - a)); };
  const int bs = 512; long steps = (long)epochs * nTrain / bs; Rng r(5 + k);
  // HARD = share of each batch drawn from the training examples the net currently gets wrong by more than HARDT
  // (rescored over the whole training set at every log point); the rest of the batch is uniform. Same weights.
  const double hardFrac = getenv("HARD") ? atof(getenv("HARD")) : 0, hardT = getenv("HARDT") ? atof(getenv("HARDT")) : 0.1;
  vector<long> hard;
  auto rescore = [&]{
    vector<vector<long>> hs(NT); vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&, t]{ for (long i = t; i < nTrain; i += NT){
      if (fabs(sig(net->forward(&AX[i * F], C[t].get())[0]) - AY[i]) > hardT) hs[t].push_back(i); } });
    for (auto& t : th) t.join(); hard.clear(); for (auto& h : hs) hard.insert(hard.end(), h.begin(), h.end());
  };
  auto bigErr = [&](long a, long b){ long c = 0; for (long i = a; i < b; i++) if (fabs(sig(net->forward(&AX[i * F], C[0].get())[0]) - AY[i]) > 0.25) c++; return (double)c / max(1L, b - a); };
  FILE* lf = fopen(("loss" + to_string(k) + ".csv").c_str(), "w"); fprintf(lf, "step,examples_seen,train_rmse,heldout_rmse,heldout_err_over_0.25,hard_set\n");
  long every = max(1L, steps / 40);
  for (long s = 0; s <= steps; s++){
    if (s % every == 0 || s == steps){
      if (hardFrac > 0) rescore();
      fprintf(lf, "%ld,%ld,%.5f,%.5f,%.5f,%zu\n", s, s * bs, evalSet(0, min(nTrain, 5000L)), evalSet(nTrain, n), bigErr(nTrain, n), hard.size()); fflush(lf); }
    if (s == steps) break;
    double lr = 1e-3 * (s < steps / 2 ? 1 : s < steps * 3 / 4 ? 0.3 : 0.1);
    vector<long> idx(bs); for (auto& i : idx) i = !hard.empty() && r() < hardFrac ? hard[(size_t)(r() * hard.size())] : (long)(r() * nTrain);
    vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&, t]{
      fill(G[t].begin(), G[t].end(), 0.f);
      for (int b = t; b < bs; b += NT){ const float* x = &AX[idx[b] * F]; const float* o = net->forward(x, C[t].get());
        float d = (float)((sig(o[0]) - AY[idx[b]]) / bs); net->backward(x, C[t].get(), &d, G[t].data()); }
    });
    for (auto& t : th) t.join();
    for (int t = 1; t < NT; t++) for (int i = 0; i < net->n; i++) G[0][i] += G[t][i];
    net->adam(G[0], lr);
  }
  double base = 0, mean = 0; for (long i = nTrain; i < n; i++) mean += AY[i]; mean /= max(1L, nTest);
  for (long i = nTrain; i < n; i++) base += (AY[i] - mean) * (AY[i] - mean); base = sqrt(base / max(1L, nTest));
  printf("stage %2d: %ld examples (%.0fs to label), held-out RMSE %.4f (train %.4f; predicting the mean: %.4f), %.0fs total\n",
    k, n, tg, evalSet(nTrain, n), evalSet(0, min(nTrain, 20000L)), base, chrono::duration<double>(chrono::steady_clock::now() - t0).count());
  fflush(stdout);
  fclose(lf); saveJson(vfile(k), net->arch, *net);
}

static Pos toPos(const Game& g){
  Pos p; memset(p.own, -1, sizeof p.own);
  for (int q = 0; q < g.n; q++) for (int v = 3; v <= 35; v++) if (g.has[q * 37 + v]) p.own[v - 3] = q;
  for (int q = 0; q < SMAXP; q++){ p.chips[q] = q < g.n ? g.chips[q] : 0; p.pts[q] = q < g.n ? g.pts[q] : 0; }
  p.pot = g.pot; p.turn = g.turn; p.cur = g.deck[g.idx] - 3; p.owned = g.idx; return p;
}
static int checkMain(int k, int positions){
  unique_ptr<Model> m(loadV(k)); unique_ptr<Model> pm(k > 0 ? loadV(k - 1) : nullptr);
  const int NT = thread::hardware_concurrency(); atomic<int> next{ 0 }; mutex mu;
  double seNet = 0, seTarget = 0, agree = 0, decisions = 0; long cnt = 0;
  vector<thread> th;
  for (int t = 0; t < NT; t++) th.emplace_back([&]{
    VNet v(m.get()); unique_ptr<VNet> pv(pm ? new VNet(pm.get()) : nullptr); unique_ptr<Work> lw(liveNet->work()); vector<float> x(MAXF);
    double a = 0, b = 0, ag = 0, dc = 0; long c = 0;
    for (int i; (i = next++) < positions;){
      Rng r(999331 + i * 31); Game g; sample(g, k, r, lw.get(), x.data(), 0.1);
      Cfg cf; cf.n = 2; Solver s(cf, 16); Pos p = toPos(g);
      double exact = s.solve(p)[g.turn];
      double net = v(g);
      vector<Game> nodes; vector<double> vals; chain(g, k, pv.get(), nodes, vals);
      a += (net - exact) * (net - exact); b += (vals[0] - exact) * (vals[0] - exact); c++;
      if (g.chips[g.turn] > 0){   // does the V policy pick the minimax move?
        float et = s.takeVal(p)[g.turn], ep = s.passVal(p)[g.turn];
        if (fabs(et - ep) > 1e-6f){ Game h = g; step(h, false); bool vt = takeValue(g, k, pv.get()) > 1 - v(h); ag += vt == (et > ep); dc++; }
      }
    }
    lock_guard<mutex> lk(mu); seNet += a; seTarget += b; cnt += c; agree += ag; decisions += dc;
  });
  for (auto& t : th) t.join();
  printf("stage %d, %ld positions: RMSE vs exact: net %.4f, one-step target %.4f; V policy picks the minimax move in %.1f%% of %0.f non-tied decisions\n",
    k, cnt, sqrt(seNet / cnt), sqrt(seTarget / cnt), 100 * agree / decisions, decisions);
  return 0;
}

static int playMain(int games, int upto){
  vector<unique_ptr<Model>> V; for (int k = 0; k <= upto; k++) V.emplace_back(loadV(k));
  const int NT = thread::hardware_concurrency(); atomic<int> next{ 0 }; mutex mu; double tot = 0, base = 0, dsq = 0;
  vector<thread> th;
  for (int t = 0; t < NT; t++) th.emplace_back([&]{
    vector<unique_ptr<VNet>> v; for (auto& m : V) v.emplace_back(new VNet(m.get()));
    unique_ptr<Work> lw(liveNet->work()); vector<float> x(MAXF); double s1 = 0, s0 = 0, dq = 0;
    for (int i; (i = next++) < games;){
      double res[2];
      for (int arm = 0; arm < 2; arm++){
        Rng r(4242 + i * 104729); Game g; newGame(g, 2, r);
        for (;;){
          bool take; int k = leftOf(g);
          if (g.chips[g.turn] == 0) take = true;
          else if (arm == 0 && g.turn == 0 && k <= upto){
            Game h = g; step(h, false); take = takeValue(g, k, k > 0 ? v[k - 1].get() : nullptr) > 1 - (*v[k])(h);
          }
          else { liveNet->features(g, x.data()); take = r() < takeProb(*liveNet, liveNet->forward(x.data(), lw.get())); }
          if (step(g, take)) break;
        }
        res[arm] = winShare(g, 0);
      }
      s1 += res[0]; s0 += res[1]; dq += (res[0] - res[1]) * (res[0] - res[1]);
    }
    lock_guard<mutex> lk(mu); tot += s1; base += s0; dsq += dq;
  });
  for (auto& t : th) t.join();
  double d = (tot - base) / games, sd = sqrt(max(0.0, dsq / games - d * d) / games);
  printf("V policy for the last %d cards in seat 0 vs live bot, %d paired deals: %.2f%% (live bot there: %.2f%%), gain %+.2f +- %.2f\n",
    upto + 1, games, 100 * tot / games, 100 * base / games, 100 * d, 100 * sd);
  return 0;
}

// stage 0 errors by how close the game is: d = opponent's score - mine (points minus chips), before this card
static int errsMain(int positions){
  unique_ptr<Model> m(loadV(0)); VNet v(m.get()); unique_ptr<Work> lw(liveNet->work()); vector<float> x(MAXF);
  map<int, pair<double, int>> byD; map<int, pair<double, int>> byV; double tot = 0; int big = 0, cnt = 0;
  for (int i = 0; i < positions; i++){
    Rng r(31337 + i * 17); Game g; sample(g, 0, r, lw.get(), x.data(), 0.1);
    vector<Game> nodes; vector<double> vals; chain(g, 0, nullptr, nodes, vals);
    for (size_t j = 0; j < nodes.size(); j++){
      const Game& h = nodes[j]; int me = h.turn, op = 1 - me;
      int d = (h.pts[op] - h.chips[op]) - (h.pts[me] - h.chips[me]); double e = v(h) - vals[j];
      int b = max(-40, min(40, d / 5 * 5)); byD[b].first += e * e; byD[b].second++;
      int vb = (int)round(vals[j] * 4); byV[vb].first += e * e; byV[vb].second++;
      tot += e * e; cnt++; if (fabs(e) > 0.25) big++;
    }
  }
  printf("%d nodes, RMSE %.4f, |error| > 0.25 on %.2f%%\nby score lead d (bucket of 5): ", cnt, sqrt(tot / cnt), 100.0 * big / cnt);
  for (auto& kv : byD) printf("%d:%.3f(%d) ", kv.first, sqrt(kv.second.first / kv.second.second), kv.second.second);
  printf("\nby true value x4: "); for (auto& kv : byV) printf("%d:%.3f(%d) ", kv.first, sqrt(kv.second.first / kv.second.second), kv.second.second);
  printf("\n"); return 0;
}

// the stage-0 positions the net gets most wrong, written out
static string runs(const Game& g, int q){
  string s; int v = 3;
  while (v <= 35){ if (!g.has[q * 37 + v]){ v++; continue; } int a = v; while (v + 1 <= 35 && g.has[q * 37 + v + 1]) v++;
    s += (s.empty() ? "" : " ") + (a == v ? to_string(a) : to_string(a) + "-" + to_string(v)); v++; }
  return s.empty() ? "-" : s;
}
static int worstMain(int positions, int show){
  unique_ptr<Model> m(loadV(0)); VNet v(m.get()); unique_ptr<Work> lw(liveNet->work()); vector<float> x(MAXF);
  struct E { double err, net, truth; Game g; vector<Game> nodes; vector<double> vals; size_t j; int id; };
  vector<E> all;
  for (int i = 0; i < positions; i++){
    Rng r(4711 + i * 13); Game g; sample(g, 0, r, lw.get(), x.data(), 0.1);
    vector<Game> nodes; vector<double> vals; chain(g, 0, nullptr, nodes, vals);
    for (size_t j = 0; j < nodes.size(); j++){ double p = v(nodes[j]); all.push_back({ fabs(p - vals[j]), p, vals[j], nodes[j], nodes, vals, j, i }); }
  }
  sort(all.begin(), all.end(), [](const E& a, const E& b){ return a.err > b.err; });
  { set<int> seen; vector<E> one; for (auto& e : all) if (seen.insert(e.id).second) one.push_back(e); all.swap(one); }   // worst node of each position
  printf("worst %d of %zu positions (one node each)\n", show, all.size());
  for (int i = 0; i < show && i < (int)all.size(); i++){
    const E& e = all[i]; const Game& g = e.g; int me = g.turn, c = g.deck[g.idx];
    printf("\n#%d  card %d, pot %d, to move: P%d.  true value for P%d %.2f, net %.2f\n", i + 1, c, g.pot, me, me, e.truth, e.net);
    for (int q = 0; q < 2; q++) printf("  P%d: cards %-28s points %3d chips %2d score %3d  (taking now: %+d points)\n", q, runs(g, q).c_str(), g.pts[q], g.chips[q], g.pts[q] - g.chips[q], addPts(g, q, c));
    printf("  minimax line:");
    for (size_t j = e.j; j < e.nodes.size(); j++){ const Game& h = e.nodes[j]; bool take = h.chips[h.turn] == 0 || j + 1 == e.nodes.size() || e.vals[j] > 1 - e.vals[j + 1] + 1e-9;
      Game t = h; double tv = takeValue(h, 0, nullptr); (void)t;
      printf(" P%d %s (pot %d)", h.turn, take ? "takes" : "passes", h.pot); if (take){ (void)tv; break; } printf(","); }
    printf("\n");
  }
  return 0;
}


// ---- anet with the pass-chain layer, stage 0 (afterstates are final positions, so targets are exact) ----
static int agradMain(){
  ANet A(3); unique_ptr<Work> w(A.work()); vector<float> x(AF); Rng r(5);
  for (int n : { 2, 3 }){
    Game g; newGame(g, n, r); for (int i = 0; i < 30; i++) step(g, r() < 0.4);
    afeatures(g, x.data()); float y[7] = { 0.2f, 0.5f, 0.3f };
    if (n == 2){ y[0] = 0.7f; y[1] = 0.3f; }
    auto loss = [&]{ const float* s = A.forward(x.data(), w.get()); double L = 0; for (int i = 0; i < n; i++) L -= y[i] * log(s[i]); return L; };
    loss(); vector<float> G(A.n, 0); float d[7]; const float* s = A.forward(x.data(), w.get()); for (int i = 0; i < n; i++) d[i] = s[i] - y[i];
    A.backward(x.data(), w.get(), d, G.data());
    int bad = 0, tried = 0;
    for (int k = 0; k < A.n; k += 37){ float o = A.p[k]; double e = 1e-3; A.p[k] = o + e; double a = loss(); A.p[k] = o - e; double b = loss(); A.p[k] = o;
      double fd = (a - b) / (2 * e); tried++; if (fabs(fd - G[k]) > 1e-3 + 0.05 * fabs(fd)) bad++; }
    printf("anet gradcheck n=%d: %d of %d params off\n", n, bad, tried);
  }
  return 0;
}

static int atrain0Main(int chains, int epochs){
  const int NT = thread::hardware_concurrency();
  ANet A(7); const int F = AF;
  vector<vector<float>> X(NT), Y(NT); vector<vector<Game>> HG(NT); vector<vector<double>> HV(NT); atomic<int> next{ 0 };
  int hold = chains / 50;   // the last 2% of chains: held-out decisions (and their afterstates)
  { vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&, t]{
      unique_ptr<Work> lw(liveNet->work()); vector<float> x(MAXF), f(AF); vector<Game> nodes; vector<double> vals;
      for (int i; (i = next++) < chains;){
        Rng r(77 + i * 7919); Game g; sample(g, 0, r, lw.get(), x.data(), 0.1);
        chain(g, 0, nullptr, nodes, vals);
        if (i >= chains - hold){ for (size_t j = 0; j < nodes.size(); j++){ HG[t].push_back(nodes[j]); HV[t].push_back(vals[j]); } continue; }
        for (auto& nd : nodes){ Game h = nd; step(h, true); afeatures(h, f.data()); X[t].insert(X[t].end(), f.begin(), f.end());
          for (int k = 0; k < MAXP; k++) Y[t].push_back(k < h.n ? (float)winShare(h, (h.turn + k) % h.n) : 0.f); }
      }
    });
    for (auto& t : th) t.join(); }
  vector<float> AX, AY; vector<Game> hg; vector<double> hv;
  for (int t = 0; t < NT; t++){ AX.insert(AX.end(), X[t].begin(), X[t].end()); AY.insert(AY.end(), Y[t].begin(), Y[t].end()); hg.insert(hg.end(), HG[t].begin(), HG[t].end()); hv.insert(hv.end(), HV[t].begin(), HV[t].end()); }
  long nTrain = (long)(AX.size() / F);
  vector<vector<float>> G(NT, vector<float>(A.n)); vector<unique_ptr<Work>> C; for (int t = 0; t < NT; t++) C.emplace_back(A.work());
  auto afterRmse = [&](long cnt){ double se = 0; for (long i = 0; i < cnt; i++){ const float* s = A.forward(&AX[i * F], C[0].get()); double e = s[0] - AY[i * MAXP]; se += e * e; } return sqrt(se / cnt); };
  auto decision = [&](double& big){ double se = 0; long b = 0; vector<float> x(AF);
    for (size_t i = 0; i < hg.size(); i++){ double o[7]; chainShares(A, C[0].get(), x.data(), hg[i], o); double e = o[hg[i].turn] - hv[i]; se += e * e; if (fabs(e) > 0.25) b++; }
    big = (double)b / hg.size(); return sqrt(se / hg.size()); };
  const int bs = 512; long steps = (long)epochs * nTrain / bs; Rng r(5); long every = max(1L, steps / 40);
  FILE* lf = fopen("aloss0.csv", "w"); fprintf(lf, "step,examples_seen,train_after_rmse,heldout_decision_rmse,heldout_err_over_0.25\n");
  auto t0 = chrono::steady_clock::now();
  for (long s = 0; s <= steps; s++){
    if (s % every == 0 || s == steps){ double big; double dr = decision(big); fprintf(lf, "%ld,%ld,%.5f,%.5f,%.5f\n", s, s * bs, afterRmse(min(nTrain, 5000L)), dr, big); fflush(lf); }
    if (s == steps) break;
    double lr = 1e-3 * (s < steps / 2 ? 1 : s < steps * 3 / 4 ? 0.3 : 0.1);
    vector<long> idx(bs); for (auto& i : idx) i = (long)(r() * nTrain);
    vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&, t]{
      fill(G[t].begin(), G[t].end(), 0.f); float d[7];
      for (int b = t; b < bs; b += NT){ const float* x = &AX[idx[b] * F]; const float* sh = A.forward(x, C[t].get()); int nn = (int)x[0];
        for (int k = 0; k < nn; k++) d[k] = (sh[k] - AY[idx[b] * MAXP + k]) / bs; A.backward(x, C[t].get(), d, G[t].data()); }
    });
    for (auto& t : th) t.join();
    for (int t = 1; t < NT; t++) for (int i = 0; i < A.n; i++) G[0][i] += G[t][i];
    A.adam(G[0], lr);
  }
  double big; double dr = decision(big);
  printf("anet stage 0: %ld afterstates, %zu held-out decisions: decision RMSE %.4f (|err| > 0.25 on %.2f%%), afterstate train RMSE %.4f, %.0fs\n",
    nTrain, hg.size(), dr, 100 * big, afterRmse(min(nTrain, 20000L)), chrono::duration<double>(chrono::steady_clock::now() - t0).count());
  saveJson("a0.json", "anet", A);
  return 0;
}


static string afile(int k){ return "a" + to_string(k) + ".json"; }
static ANet* loadA(const string& f){ string j = readFile(f); vector<float> w = jsonFloats(j, "p"); ANet* a = new ANet(7);
  if ((int)w.size() != a->n){ fprintf(stderr, "%s: %zu weights, want %d\n", f.c_str(), w.size(), a->n); exit(1); } a->p = w; return a; }
// target shares (relative to the afterstate's next mover) for afterstate h with k cards still to deal
static void aTarget(const Game& h, int k, const ANet* prev, Work* w, float* x, float* y){
  if (k == 0){ for (int q = 0; q < MAXP; q++) y[q] = q < h.n ? (float)winShare(h, (h.turn + q) % h.n) : 0.f; return; }
  bool seen[37] = {}; for (int q = 0; q < h.n; q++) for (int v = 3; v <= 35; v++) if (h.has[q * 37 + v]) seen[v] = true;
  double acc[7] = {}; int m = 0; Game g = h;
  for (int v = 3; v <= 35; v++) if (!seen[v]){ g.deck[g.idx] = v; double o[7]; chainShares(*prev, w, x, g, o); for (int q = 0; q < h.n; q++) acc[q] += o[q]; m++; }
  for (int q = 0; q < MAXP; q++) y[q] = q < h.n ? (float)(acc[(h.turn + q) % h.n] / m) : 0.f;
}

// Targets for every afterstate along the chain of passes on g's card (stage k, the same as aTarget on each of them),
// with the conv features cached per player/card combination and the head memoised per (outer taker, next card,
// inner taker, chips after the take). y gets MAXP floats per node, relative to that afterstate's next mover.
static void labelChain(const Game& g0, int k, const ANet& P, vector<Game>& after, vector<float>& y){
  after.clear(); y.clear();
  Game g = g0; int n = g.n, c = g.deck[g.idx];
  for (;;){ Game h = g; step(h, true); after.push_back(h); if (g.chips[g.turn] == 0) break; step(g, false); }
  if (k == 0){ for (auto& h : after) for (int q = 0; q < MAXP; q++) y.push_back(q < n ? (float)winShare(h, (h.turn + q) % n) : 0.f); return; }
  const int PS = 3 * P.C2;
  float hold[7][ACL] = {}, seen[ACL] = {};
  for (int q = 0; q < n; q++) for (int v = 3; v <= 35; v++) if (g0.has[q * 37 + v]){ hold[q][v - 3] = 1; seen[v - 3] = 1; }
  seen[c - 3] = 1;
  vector<int> unseen; for (int v = 3; v <= 35; v++) if (!seen[v - 3]) unseen.push_back(v);
  int U = (int)unseen.size(), left = 24 - g0.idx - 2;   // cards still to deal after the inner card
  // pools[(outer taker o, card index ui, player q, q takes the inner card?)]
  vector<float> pool((size_t)n * U * n * 2 * PS); vector<char> have((size_t)n * U * n * 2, 0);
  auto poolOf = [&](int o, int ui, int q, int inner) -> const float* {
    size_t id = (((size_t)o * U + ui) * n + q) * 2 + inner; float* out = &pool[id * PS];
    if (!have[id]){ float hl[ACL], sn[ACL]; memcpy(hl, hold[q], sizeof hl); memcpy(sn, seen, sizeof sn);
      if (q == o) hl[c - 3] = 1; int u = unseen[ui]; sn[u - 3] = 1; if (inner) hl[u - 3] = 1;
      P.pools(hl, sn, out); have[id] = 1; }
    return out;
  };
  unordered_map<uint64_t, array<float, 7>> memo;
  for (auto& h : after){
    int o = h.turn; double acc[7] = {};
    for (int ui = 0; ui < U; ui++){
      // inner chain: o moves first on card unseen[ui] with pot 0
      int ch[7]; for (int q = 0; q < n; q++) ch[q] = h.chips[q];
      vector<array<float, 7>> T; vector<int> mv;
      for (int m = 0;; m++){
        int t = (o + m) % n;
        // the afterstate only depends on who took which card and the chips after the take
        uint64_t key = 0; for (int q = 0; q < n; q++) key = key << 6 | (uint64_t)(ch[q] + (q == t ? m : 0));
        key = ((key << 3 | (uint64_t)t) << 3 | (uint64_t)o) << 6 | (uint64_t)ui;
        auto it = memo.find(key); array<float, 7> v{};
        if (it != memo.end()) v = it->second;
        else {
          const float* pl[7]; int cc[7]; float s[7];
          for (int r = 0; r < n; r++){ int q = (t + r) % n; pl[r] = poolOf(o, ui, q, q == t); cc[r] = ch[q] + (q == t ? m : 0); }
          P.head(n, pl, cc, left, s); for (int r = 0; r < n; r++) v[(t + r) % n] = s[r];
          memo.emplace(key, v);
        }
        T.push_back(v); mv.push_back(t);
        if (ch[t] == 0) break;
        ch[t]--;
      }
      array<float, 7> v = T.back();
      for (int j = (int)T.size() - 2; j >= 0; j--) if (T[j][mv[j]] >= v[mv[j]]) v = T[j];
      for (int q = 0; q < n; q++) acc[q] += v[q];
    }
    for (int q = 0; q < MAXP; q++) y.push_back(q < n ? (float)(acc[(o + q) % n] / U) : 0.f);
  }
}
static int alabelTest(int k){
  unique_ptr<ANet> P(loadA(afile(k - 1))); unique_ptr<Work> w(P->work()), lw(liveNet->work()); vector<float> x(MAXF), y(MAXP);
  double maxd = 0; long cnt = 0; double tOld = 0, tNew = 0;
  for (int i = 0; i < 40; i++){
    Rng r(123 + i); Game g; sample(g, k, r, lw.get(), x.data(), 0.1);
    auto t0 = chrono::steady_clock::now(); vector<Game> after; vector<float> ys; labelChain(g, k, *P, after, ys);
    auto t1 = chrono::steady_clock::now();
    for (size_t j = 0; j < after.size(); j++){ aTarget(after[j], k, P.get(), w.get(), x.data(), y.data());
      for (int q = 0; q < MAXP; q++) maxd = max(maxd, (double)fabs(y[q] - ys[j * MAXP + q])); cnt++; }
    auto t2 = chrono::steady_clock::now();
    tNew += chrono::duration<double>(t1 - t0).count(); tOld += chrono::duration<double>(t2 - t1).count();
  }
  printf("stage %d: %ld afterstates, max label difference %.2e; old %.3fs, new %.3fs (%.1fx)\n", k, cnt, maxd, tOld, tNew, tOld / tNew);
  return 0;
}

static int atrainMain(int k, int chains, int epochs){
  const int NT = thread::hardware_concurrency();
  unique_ptr<ANet> prev(k > 0 ? loadA(afile(k - 1)) : nullptr);
  unique_ptr<ANet> Ap(k > 0 ? loadA(afile(k - 1)) : new ANet(7)); ANet& A = *Ap; const int F = AF;
  vector<vector<float>> X(NT), Y(NT); atomic<int> next{ 0 }; auto t0 = chrono::steady_clock::now();
  { vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&, t]{
      unique_ptr<Work> lw(liveNet->work()), pw(prev ? prev->work() : nullptr); vector<float> x(MAXF), f(AF), y(MAXP);
      for (int i; (i = next++) < chains;){
        Rng r(77 + k * 1000003 + i * 7919); Game g; sample(g, k, r, lw.get(), x.data(), 0.1);
        vector<Game> after; vector<float> ys;   // every node of the chain on this card
        if (k > 0) labelChain(g, k, *prev, after, ys); else labelChain(g, 0, A, after, ys);
        for (auto& h : after){ afeatures(h, f.data()); X[t].insert(X[t].end(), f.begin(), f.end()); }
        Y[t].insert(Y[t].end(), ys.begin(), ys.end());
      }
    });
    for (auto& t : th) t.join(); }
  vector<float> AX, AY; for (int t = 0; t < NT; t++){ AX.insert(AX.end(), X[t].begin(), X[t].end()); AY.insert(AY.end(), Y[t].begin(), Y[t].end()); }
  long n = (long)(AX.size() / F), nTest = n / 50, nTrain = n - nTest;
  double tg = chrono::duration<double>(chrono::steady_clock::now() - t0).count();
  // training threads: a batch of 512 split over hundreds of threads would be all thread start-up, so cap it (TRAIN_THREADS)
  const int TT = min(NT, getenv("TRAIN_THREADS") ? atoi(getenv("TRAIN_THREADS")) : 16);
  vector<vector<float>> G(TT, vector<float>(A.n)); vector<unique_ptr<Work>> C; for (int t = 0; t < NT; t++) C.emplace_back(A.work());
  auto rmse = [&](long a, long b){ vector<double> se(NT, 0); vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&, t]{ for (long i = a + t; i < b; i += NT){ const float* s = A.forward(&AX[i * F], C[t].get()); double e = s[0] - AY[i * MAXP]; se[t] += e * e; } });
    for (auto& t : th) t.join(); double s = 0; for (double v : se) s += v; return sqrt(s / max(1L, b - a)); };
  const int bs = 512; long steps = (long)epochs * nTrain / bs; Rng r(5 + k); long every = max(1L, steps / 40);
  FILE* lf = fopen(("aloss" + to_string(k) + ".csv").c_str(), "w"); fprintf(lf, "step,examples_seen,train_rmse,heldout_rmse\n");
  for (long s = 0; s <= steps; s++){
    if (s % every == 0 || s == steps){ fprintf(lf, "%ld,%ld,%.5f,%.5f\n", s, s * bs, rmse(0, min(nTrain, 5000L)), rmse(nTrain, n)); fflush(lf); }
    if (s == steps) break;
    double lr = 1e-3 * (s < steps / 2 ? 1 : s < steps * 3 / 4 ? 0.3 : 0.1);
    vector<long> idx(bs); for (auto& i : idx) i = (long)(r() * nTrain);
    vector<thread> th;
    for (int t = 0; t < TT; t++) th.emplace_back([&, t]{
      fill(G[t].begin(), G[t].end(), 0.f); float d[7];
      for (int b = t; b < bs; b += TT){ const float* x = &AX[idx[b] * F]; const float* sh = A.forward(x, C[t].get()); int nn = (int)x[0];
        for (int q = 0; q < nn; q++) d[q] = (sh[q] - AY[idx[b] * MAXP + q]) / bs; A.backward(x, C[t].get(), d, G[t].data()); }
    });
    for (auto& t : th) t.join();
    for (int t = 1; t < TT; t++) for (int i = 0; i < A.n; i++) G[0][i] += G[t][i];
    A.adam(G[0], lr);
  }
  printf("anet stage %d: %ld afterstates (%.0fs to label), held-out RMSE %.4f, train %.4f, %.0fs total\n", k, n, tg, rmse(nTrain, n),
    rmse(0, min(nTrain, 20000L)), chrono::duration<double>(chrono::steady_clock::now() - t0).count());
  fflush(stdout); saveJson(afile(k), "anet", A);
  return 0;
}
// stage-k decisions: anet + chain vs the exact solver
static int acheckMain(int k, int positions){
  unique_ptr<ANet> A(loadA(afile(k)));
  const int NT = thread::hardware_concurrency(); atomic<int> next{ 0 }; mutex mu; double se = 0, agree = 0, dec = 0; long cnt = 0;
  vector<thread> th;
  for (int t = 0; t < NT; t++) th.emplace_back([&]{
    unique_ptr<Work> w(A->work()), lw(liveNet->work()); vector<float> x(MAXF); double a = 0, ag = 0, dc = 0; long c = 0;
    for (int i; (i = next++) < positions;){
      Rng r(999331 + i * 31); Game g; sample(g, k, r, lw.get(), x.data(), 0.1);
      Cfg cf; cf.n = 2; Solver s(cf, 16); Pos p = toPos(g); double exact = s.solve(p)[g.turn];
      double o[7]; chainShares(*A, w.get(), x.data(), g, o); a += (o[g.turn] - exact) * (o[g.turn] - exact); c++;
      if (g.chips[g.turn] > 0){
        float et = s.takeVal(p)[g.turn], ep = s.passVal(p)[g.turn];
        if (fabs(et - ep) > 1e-6f){ double tv[7], pv[7]; afterShares(*A, w.get(), x.data(), g, tv); Game h = g; step(h, false); chainShares(*A, w.get(), x.data(), h, pv);
          ag += (tv[g.turn] >= pv[g.turn]) == (et > ep); dc++; }
      }
    }
    lock_guard<mutex> lk(mu); se += a; cnt += c; agree += ag; dec += dc;
  });
  for (auto& t : th) t.join();
  printf("anet stage %d, %ld positions: RMSE vs exact %.4f; picks the minimax move in %.1f%% of %.0f non-tied decisions\n", k, cnt, sqrt(se / cnt), 100 * agree / dec, dec);
  return 0;
}


// ./fvi aplay <games>: 2 players, seat 0 plays the anet chain policy (a<k>.json for every stage present) vs the live bot,
// stages without a net fall back to the live bot; paired deals (the live bot in seat 0 on the same deal)
static int aplayMain(int games){
  vector<unique_ptr<ANet>> A(24); int have = 0; for (int k = 0; k < 24; k++){ ifstream f(afile(k)); if (f.good()){ A[k].reset(loadA(afile(k))); have++; } }
  const int NT = thread::hardware_concurrency(); atomic<int> next{ 0 }; mutex mu; double tot = 0, base = 0, dsq = 0;
  vector<thread> th;
  for (int t = 0; t < NT; t++) th.emplace_back([&]{
    vector<unique_ptr<Work>> w(24); for (int k = 0; k < 24; k++) if (A[k]) w[k].reset(A[k]->work());
    unique_ptr<Work> lw(liveNet->work()); vector<float> x(MAXF); double s1 = 0, s0 = 0, dq = 0;
    for (int i; (i = next++) < games;){
      double res[2];
      for (int arm = 0; arm < 2; arm++){
        Rng r(4242 + i * 104729); Game g; newGame(g, 2, r);
        for (;;){
          bool take; int k = leftOf(g);
          if (g.chips[g.turn] == 0) take = true;
          else if (arm == 0 && g.turn == 0 && A[k]){
            double tv[7], pv[7]; afterShares(*A[k], w[k].get(), x.data(), g, tv); Game h = g; step(h, false); chainShares(*A[k], w[k].get(), x.data(), h, pv);
            take = tv[0] >= pv[0];
          }
          else { liveNet->features(g, x.data()); take = r() < takeProb(*liveNet, liveNet->forward(x.data(), lw.get())); }
          if (step(g, take)) break;
        }
        res[arm] = winShare(g, 0);
      }
      s1 += res[0]; s0 += res[1]; dq += (res[0] - res[1]) * (res[0] - res[1]);
    }
    lock_guard<mutex> lk(mu); tot += s1; base += s0; dsq += dq;
  });
  for (auto& t : th) t.join();
  double d = (tot - base) / games, sd = sqrt(max(0.0, dsq / games - d * d) / games);
  printf("anet (%d stages) in seat 0 vs live bot, 2 players, %d paired deals: %.2f%% (live bot there: %.2f%%), gain %+.2f +- %.2f\n",
    have, games, 100 * tot / games, 100 * base / games, 100 * d, 100 * sd);
  return 0;
}

int main(int argc, char** argv){
  string live = getenv("LIVE") ? getenv("LIVE") : "../nash/live.json"; liveNet = loadNet(live);
  string mode = argc > 1 ? argv[1] : "";
  if (mode == "train"){ int a = atoi(argv[2]), b = atoi(argv[3]), n = atoi(argv[4]), e = argc > 5 ? atoi(argv[5]) : 4;
    for (int k = a; k <= b; k++) trainStage(k, n, e); return 0; }
  if (mode == "atrain") return atrainMain(atoi(argv[2]), atoi(argv[3]), atoi(argv[4]));
  if (mode == "aplay") return aplayMain(atoi(argv[2]));
  if (mode == "alabeltest") return alabelTest(atoi(argv[2]));
  if (mode == "acheck") return acheckMain(atoi(argv[2]), atoi(argv[3]));
  if (mode == "agrad") return agradMain();
  if (mode == "atrain0") return atrain0Main(atoi(argv[2]), atoi(argv[3]));
  if (mode == "worst") return worstMain(atoi(argv[2]), atoi(argv[3]));
  if (mode == "errs") return errsMain(atoi(argv[2]));
  if (mode == "check") return checkMain(atoi(argv[2]), atoi(argv[3]));
  if (mode == "play") return playMain(atoi(argv[2]), atoi(argv[3]));
  fprintf(stderr, "usage: see the top of fvi.cpp\n"); return 1;
}
