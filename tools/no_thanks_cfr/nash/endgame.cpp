// Exact endgames of the real game (33 cards, 24 dealt) against the live bot.
//   g++ -O3 -march=native -ffast-math -std=c++17 -pthread endgame.cpp -o endgame
//   ./endgame nash <net.json> <L> <games>          2 players, live bot vs itself; at each decision with at most L cards
//                                                  left to deal, solve the position exactly (minimax) and score the bot's move
//   ./endgame br <net.json> <n> <L> <games> [nash]  one seat plays the live bot until L cards are left, then the exact best
//                                                  response to the live bots in the other seats (or, with "nash", the
//                                                  2-player minimax move); prints its win share against the fair 1/n
#define main deep_main
#include "../deep.cpp"
#undef main
#include "solve.h"

static Cfg fullCfg(int n){ Cfg c; c.n = n; c.K = 33; c.lo = 3; c.D = 24; c.C = chipsFor(n); return c; }
static Pos toPos(const Game& g){
  Pos p; memset(p.own, -1, sizeof p.own);
  for (int q = 0; q < g.n; q++) for (int v = 3; v <= 35; v++) if (g.has[q * 37 + v]) p.own[v - 3] = q;
  for (int q = 0; q < SMAXP; q++){ p.chips[q] = q < g.n ? g.chips[q] : 0; p.pts[q] = q < g.n ? g.pts[q] : 0; }
  p.pot = g.pot; p.turn = g.turn; p.cur = g.deck[g.idx] - 3; p.owned = g.idx; return p;
}
static void toGame(const Pos& p, int n, Game& g){
  g.n = n; g.idx = p.owned; g.pot = p.pot; g.turn = p.turn; g.deck[p.owned] = p.cur + 3;
  memset(g.has, 0, sizeof g.has);
  for (int i = 0; i < 33; i++) if (p.own[i] >= 0) g.has[p.own[i] * 37 + i + 3] = 1;
  for (int q = 0; q < 7; q++){ g.chips[q] = q < n ? p.chips[q] : 0; g.pts[q] = q < n ? p.pts[q] : 0; }
}

struct Bot {   // the live net, one per thread
  const Model* m; unique_ptr<Work> w; vector<float> x; long calls = 0;
  explicit Bot(const Model* m_) : m(m_), w(m_->work()), x(MAXF){}
  float take(const Game& g){ calls++; m->features(g, x.data()); return (float)takeProb(*m, m->forward(x.data(), w.get())); }
};

static int nashMain(int argc, char** argv){
  Model* net = loadNet(argv[2]); int L = atoi(argv[3]), games = atoi(argv[4]);
  const int NT = thread::hardware_concurrency();
  // per cards-left: decisions, decisions where the bot's likelier move isn't optimal, sum of win share lost, P(take) mass on the wrong move
  vector<double> cnt(24, 0), wrong(24, 0), loss(24, 0), mass(24, 0), forced(24, 0); mutex mu; atomic<int> next{ 0 };
  vector<thread> th;
  for (int t = 0; t < NT; t++) th.emplace_back([&]{
    Bot bot(net); vector<double> c(24, 0), w(24, 0), l(24, 0), ms(24, 0), f(24, 0);
    for (int i; (i = next++) < games;){
      Rng r(1000 + i * 7919); Game g; newGame(g, 2, r);
      Solver s(fullCfg(2), 16);
      for (;;){
        if (g.chips[g.turn] == 0){ if (step(g, true)) break; continue; }
        float pt = bot.take(g); int left = leftOf(g);
        if (left <= L){
          Pos p = toPos(g); int me = g.turn;
          float a = s.takeVal(p)[me], b = s.passVal(p)[me], best = max(a, b), got = pt * a + (1 - pt) * b;
          c[left]++; l[left] += best - got; ms[left] += a >= b ? 1 - pt : pt;
          if (fabs(a - b) > 1e-6f && ((pt > 0.5f) != (a > b))) w[left]++;
          if (fabs(a - b) <= 1e-6f) f[left]++;
        }
        if (step(g, r() < pt)) break;
      }
    }
    lock_guard<mutex> lk(mu); for (int k = 0; k < 24; k++){ cnt[k] += c[k]; wrong[k] += w[k]; loss[k] += l[k]; mass[k] += ms[k]; forced[k] += f[k]; }
  });
  for (auto& t : th) t.join();
  printf("2 players, %d games of the bot against itself; per decision with `left` cards still to deal after this one\n", games);
  printf("left  decisions  indifferent  bot's likelier move wrong  mean P(wrong move)  mean win share lost  per game\n");
  double tl = 0;
  for (int k = 0; k <= L; k++){
    printf("%4d  %9.0f  %10.1f%%  %24.2f%%  %18.3f%%  %19.4f%%  %7.3f%%\n", k, cnt[k], 100 * forced[k] / cnt[k], 100 * wrong[k] / cnt[k], 100 * mass[k] / cnt[k], 100 * loss[k] / cnt[k], 100 * loss[k] / games);
    tl += loss[k];
  }
  printf("total win share the bot gives away per game in these endgames (vs a minimax opponent): %.3f%%\n", 100 * tl / games);
  return 0;
}

static int brMain(int argc, char** argv){
  Model* net = loadNet(argv[2]); int n = atoi(argv[3]), L = atoi(argv[4]), games = atoi(argv[5]);
  bool nash = argc > 6 && string(argv[6]) == "nash";
  const int NT = thread::hardware_concurrency();
  double tot = 0, base = 0, sq = 0, dsq = 0; long calls = 0; mutex mu; atomic<int> next{ 0 };
  vector<thread> th;
  for (int t = 0; t < NT; t++) th.emplace_back([&]{
    Bot bot(net); double s1 = 0, s0 = 0, q1 = 0, dq = 0;
    for (int i; (i = next++) < games;){
      // the same deal twice: once with the searcher in seat 0, once with the live bot there (common random numbers)
      double v[2];
      for (int arm = 0; arm < 2; arm++){
        Rng r(5000 + i * 104729); Game g; newGame(g, n, r);
        unique_ptr<Solver> s;
        for (;;){
          if (g.chips[g.turn] == 0){ if (step(g, true)) break; continue; }
          bool take;
          if (arm == 0 && g.turn == 0 && leftOf(g) <= L){
            if (!s){ s.reset(new Solver(fullCfg(n), 16));
              if (!nash){ s->exact = true; for (int q = 1; q < n; q++) s->bot[q] = [&](const Pos& p){ Game h; toGame(p, n, h); return bot.take(h); }; } }
            Pos p = toPos(g); take = s->takeVal(p)[0] > s->passVal(p)[0] + 1e-6f;
          }
          else take = r() < bot.take(g);
          if (step(g, take)) break;
        }
        v[arm] = winShare(g, 0);
      }
      s1 += v[0]; s0 += v[1]; q1 += v[0] * v[0]; dq += (v[0] - v[1]) * (v[0] - v[1]);
    }
    lock_guard<mutex> lk(mu); tot += s1; base += s0; sq += q1; dsq += dq; calls += bot.calls;
  });
  for (auto& t : th) t.join();
  double m = tot / games, b = base / games, d = m - b, sd = sqrt(max(0.0, dsq / games - d * d) / games);
  printf("%d players, %d deals, searcher (%s for the last %d cards) in seat 0 vs live bots: %.2f%% (live bot in that seat: %.2f%%, fair %.2f%%); gain %+.2f +- %.2f points; %.1f net calls/deal\n",
    n, games, nash ? "2p minimax" : "exact best response", L + 1, 100 * m, 100 * b, 100.0 / n, 100 * d, 100 * sd, (double)calls / games);
  return 0;
}

int main(int argc, char** argv){
  if (argc > 1 && string(argv[1]) == "nash") return nashMain(argc, argv);
  if (argc > 1 && string(argv[1]) == "br") return brMain(argc, argv);
  fprintf(stderr, "usage: see the top of endgame.cpp\n"); return 1;
}
