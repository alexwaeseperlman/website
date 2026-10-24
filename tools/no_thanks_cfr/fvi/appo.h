// PPO with the anet + pass-chain layer as the policy (Alex's idea, 2026-10-24): one anet (afterstate win shares, any
// table size) for the whole game. At a decision the chain layer gives the mover's value of taking now (T0) and of
// passing (the chain from the next player on, everyone playing it greedily against the anet). The policy is
// P(take) = sigmoid(beta * (T0 - pass)) with beta learned, and the value is max(T0, pass). Gradients flow into the two
// afterstates that decide this: take-now and the one the pass chain picked.
//   ./fvi appo <iterations> <games per thread>   -> appo.json (+ appo-meta.txt: iteration, log beta); resumes from them
//   ./fvi avs <appo.json> <deals>               Alex's test: 1 copy + 2 live (3p, needs > 33.3%), 2 copies + 2 live (4p, > 50%)
// Env: LR (3e-4), EPOCHS (4), CLIP (0.2), ENT (0.01), LAMBDA (0.95), BETA (initial, 20), POOLP (0.5: chance a seat is
// the live bot), TABLES (e.g. "2" or "2,3,3,4"; default the ppo mix 2..7), BS (512), INIT=a<k>.json, TRAIN_THREADS.
#pragma once

struct Chain {   // what the chain layer decided at a decision of the mover p
  double T0[7], v1[7]; int kT, kS; bool termT, termS; vector<float> xT, xS;
};
// shares (absolute seats) after the mover of h takes now; exact when that ends the game. x gets the afterstate features.
static bool takeShares(const ANet& A, Work* w, float* x, const Game& h, double* out){
  Game a = h; if (step(a, true)){ for (int q = 0; q < a.n; q++) out[q] = winShare(a, q); return true; }
  afeatures(a, x); const float* s = A.forward(x, w); for (int k = 0; k < a.n; k++) out[(a.turn + k) % a.n] = s[k]; return false;
}
static void chainAtSlow(const ANet& A, Work* w, const Game& g, Chain& c){
  int n = g.n; vector<array<double, 7>> T; vector<int> mover; vector<char> term; vector<float> X; vector<float> x(AF);
  Game h = g;
  for (;;){
    array<double, 7> a{}; term.push_back(takeShares(A, w, x.data(), h, a.data())); T.push_back(a); mover.push_back(h.turn);
    X.insert(X.end(), x.begin(), x.end());
    if (h.chips[h.turn] == 0) break;
    step(h, false);
  }
  int L = (int)T.size() - 1, sel = L;   // L >= 1: the mover at g has chips
  for (int j = L - 1; j >= 1; j--) if (T[j][mover[j]] >= T[sel][mover[j]]) sel = j;
  for (int q = 0; q < n; q++){ c.T0[q] = T[0][q]; c.v1[q] = T[sel][q]; }
  int p = g.turn; c.kT = 0; c.kS = (p - mover[sel] + n) % n; c.termT = term[0]; c.termS = term[sel];
  c.xT.assign(X.begin(), X.begin() + AF); c.xS.assign(X.begin() + (long)sel * AF, X.begin() + (long)(sel + 1) * AF);
}
// The same, fast: along the chain only chips and the taker change, so each player's pooled conv features come in two
// versions (with and without the card in play), worked out once; each node is then just the head.
static void chainAt(const ANet& A, Work* w, const Game& g, Chain& c){
  (void)w; int n = g.n, cd = g.deck[g.idx], PS = 3 * A.C2; bool last = g.idx + 1 >= 24;
  float hold[7][ACL] = {}, seen[ACL] = {};
  for (int q = 0; q < n; q++) for (int v = 3; v <= 35; v++) if (g.has[q * 37 + v]){ hold[q][v - 3] = 1; seen[v - 3] = 1; }
  seen[cd - 3] = 1;
  vector<float> pl0((size_t)n * PS), pl1((size_t)n * PS);
  if (!last) for (int q = 0; q < n; q++){ A.pools(hold[q], seen, &pl0[q * PS]); hold[q][cd - 3] = 1; A.pools(hold[q], seen, &pl1[q * PS]); hold[q][cd - 3] = 0; }
  vector<array<double, 7>> T; vector<Game> nodes; Game h = g;
  for (;;){
    array<double, 7> a{}; int t = h.turn;
    if (last){ Game e = h; step(e, true); for (int q = 0; q < n; q++) a[q] = winShare(e, q); }
    else {
      const float* pl[7]; int cc[7]; float sh[7];
      for (int r = 0; r < n; r++){ int q = (t + r) % n; pl[r] = q == t ? &pl1[q * PS] : &pl0[q * PS]; cc[r] = h.chips[q] + (q == t ? h.pot : 0); }
      A.head(n, pl, cc, 24 - (g.idx + 1), sh); for (int r = 0; r < n; r++) a[(t + r) % n] = sh[r];
    }
    T.push_back(a); nodes.push_back(h);
    if (h.chips[t] == 0) break;
    step(h, false);
  }
  int L = (int)T.size() - 1, sel = L;
  for (int j = L - 1; j >= 1; j--) if (T[j][nodes[j].turn] >= T[sel][nodes[j].turn]) sel = j;
  for (int q = 0; q < n; q++){ c.T0[q] = T[0][q]; c.v1[q] = T[sel][q]; }
  int p = g.turn; c.kT = 0; c.kS = (p - nodes[sel].turn + n) % n; c.termT = c.termS = last;
  c.xT.resize(AF); c.xS.resize(AF);
  if (!last){ Game e = nodes[0]; step(e, true); afeatures(e, c.xT.data()); e = nodes[sel]; step(e, true); afeatures(e, c.xS.data()); }
}
// ./fvi achaintest <positions>: chainAt against chainAtSlow on positions from random games
static int achainTest(int npos){
  ANet A(11); unique_ptr<Work> w(A.work()); Rng r(3); double md = 0; int cnt = 0;
  for (int i = 0; i < npos; i++){
    Game g; newGame(g, 2 + i % 6, r); int steps = (int)(r() * 120);
    for (int s = 0; s < steps; s++){ if (step(g, g.chips[g.turn] == 0 || r() < 0.3)){ newGame(g, 2 + i % 6, r); } }
    if (g.chips[g.turn] == 0) continue;
    Chain a, b; chainAt(A, w.get(), g, a); chainAtSlow(A, w.get(), g, b); cnt++;
    double d = 0; for (int q = 0; q < g.n; q++){ d = max(d, fabs(a.T0[q] - b.T0[q])); d = max(d, fabs(a.v1[q] - b.v1[q])); }
    if (d > 1e-4) printf("pos %d n %d idx %d pot %d diff %.2e T0 %.4f/%.4f v1 %.4f/%.4f kS %d/%d\n", i, g.n, g.idx, g.pot, d, a.T0[g.turn], b.T0[g.turn], a.v1[g.turn], b.v1[g.turn], a.kS, b.kS);
    md = max(md, d);
    if (a.kS != b.kS) printf("kS differs at %d\n", i);
    for (int k = 0; k < AF; k++) if (!a.termT && (a.xT[k] != b.xT[k] || a.xS[k] != b.xS[k])){ printf("features differ at %d k %d: %g %g / %g %g\n", i, k, a.xT[k], b.xT[k], a.xS[k], b.xS[k]); break; }
  }
  printf("%d positions, max difference %.2e\n", cnt, md); return 0;
}

struct ASample { int a, kT, kS; bool termT, termS; float cT, cS, lp, v, adv, ret; };
static vector<int> tableMix(){
  vector<int> t; string s = getenv("TABLES") ? getenv("TABLES") : "2,3,3,3,4,4,4,5,5,5,6,7";
  for (size_t i = 0; i < s.size();){ size_t j = s.find(',', i); if (j == string::npos) j = s.size(); t.push_back(atoi(s.substr(i, j - i).c_str())); i = j + 1; }
  return t;
}

static int appoMain(int T, int games){
  auto env = [](const char* k, double d){ return getenv(k) ? atof(getenv(k)) : d; };
  double lr = env("LR", 3e-4), clipE = env("CLIP", 0.2), ent = env("ENT", 0.01), lam = env("LAMBDA", 0.95), vc = env("VC", 0.5), pg = env("PG", 1), poolP = env("POOLP", 0.5);
  int epochs = (int)env("EPOCHS", 4), bs = (int)env("BS", 512); vector<int> tables = tableMix();
  const int NT = thread::hardware_concurrency(), TT = min(NT, (int)env("TRAIN_THREADS", 16));
  unique_ptr<ANet> Ap(getenv("INIT") ? loadA(getenv("INIT")) : new ANet(11)); 
  double lb = log(env("BETA", 20)), lbm = 0, lbv = 0; int start = 1;
  { ifstream f("appo-meta.txt"); int t; double b; if (f >> t >> b){ Ap.reset(loadA("appo.json")); start = t + 1; lb = b; printf("resuming after iteration %d\n", t); } }
  ANet& net = *Ap;
  const int F = AF; Pool pool(TT);
  vector<vector<float>> G(TT, vector<float>(net.n)); vector<unique_ptr<Work>> C1, C2; vector<double> GB(TT);
  for (int t = 0; t < TT; t++){ C1.emplace_back(net.work()); C2.emplace_back(net.work()); }
  auto t0 = chrono::steady_clock::now(); auto secs = [&]{ return chrono::duration<double>(chrono::steady_clock::now() - t0).count(); };
  for (int it = start; it <= T; it++){
    double tp = secs(), beta = exp(lb);
    vector<vector<float>> WX(NT); vector<vector<ASample>> WS(NT); vector<double> mixW(NT, 0), mixN(NT, 0); vector<long> chainN(NT, 0);
    { vector<thread> th;
      for (int w = 0; w < NT; w++) th.emplace_back([&, w]{
        Rng r(991 + w * 7919 + it * 104729); unique_ptr<Work> c(net.work()), lw(liveNet->work()); vector<float> x(MAXF); Chain ch;
        for (int i = 0; i < games; i++){
          int n = tables[(int)floor(r() * tables.size())]; Game g; newGame(g, n, r); bool live[7], any = false, learner = false;
          for (int q = 0; q < n; q++){ live[q] = r() < poolP; any |= live[q]; learner |= !live[q]; }
          if (!learner) live[(int)floor(r() * n)] = false;
          vector<vector<int>> traj(n);
          for (;;){
            int p = g.turn; bool take;
            if (g.chips[p] == 0) take = true;
            else if (live[p]){ liveNet->features(g, x.data()); take = r() < takeProb(*liveNet, liveNet->forward(x.data(), lw.get())); }
            else {
              chainAt(net, c.get(), g, ch); chainN[w]++;
              double sT = ch.T0[p], sS = ch.v1[p], pt = 1 / (1 + exp(-beta * (sT - sS))); take = r() < pt;
              ASample s{ take, (p - g.turn + n) % n, ch.kS, ch.termT, ch.termS, (float)sT, (float)sS, (float)log(max(1e-8, take ? pt : 1 - pt)), (float)max(sT, sS), 0, 0 };
              s.kT = 0;   // take-now afterstate: the taker is p, so p is output 0
              WX[w].insert(WX[w].end(), ch.xT.begin(), ch.xT.end()); WX[w].insert(WX[w].end(), ch.xS.begin(), ch.xS.end());
              WS[w].push_back(s); traj[p].push_back((int)WS[w].size() - 1);
            }
            if (step(g, take)) break;
          }
          for (int q = 0; q < n; q++){
            double R = winShare(g, q), Aa = 0, next = R;
            for (int k = (int)traj[q].size() - 1; k >= 0; k--){ ASample& s = WS[w][traj[q][k]]; double d = next - s.v; Aa = d + lam * Aa; s.adv = (float)Aa; s.ret = (float)(Aa + s.v); next = s.v; }
            if (any && !live[q]){ mixW[w] += R * n - 1; mixN[w]++; }
          }
        }
      });
      for (auto& x : th) x.join(); }
    tp = secs() - tp;
    vector<float> X; vector<ASample> S;
    for (int w = 0; w < NT; w++){ X.insert(X.end(), WX[w].begin(), WX[w].end()); S.insert(S.end(), WS[w].begin(), WS[w].end()); }
    long N = (long)S.size();
    if (getenv("ADEBUG")){ double mT = 0, mS = 0, mR = 0, mA = 0, tt = 0, ts = 0; for (auto& s : S){ mT += s.cT; mS += s.cS; mR += s.ret; mA += s.a; tt += s.termT; ts += s.termS; }
      printf("  mean take-now %.3f, pass %.3f, return %.3f, took %.3f, terminal %.3f/%.3f\n", mT / N, mS / N, mR / N, mA / N, tt / N, ts / N); }
    double am = 0, av = 0; for (auto& s : S) am += s.adv; am /= N; for (auto& s : S) av += (s.adv - am) * (s.adv - am); av = sqrt(av / N) + 1e-8;
    for (auto& s : S) s.adv = (float)((s.adv - am) / av);
    vector<long> order(N); for (long i = 0; i < N; i++) order[i] = i;
    double sumH = 0, sumV = 0, sumClip = 0; long cntS = 0;
    for (int e = 0; e < epochs; e++){
      for (long i = N - 1; i > 0; i--){ long j = (long)floor(rnd() * (i + 1)); swap(order[i], order[j]); }
      for (long b0 = 0; b0 + bs <= N; b0 += bs){
        vector<double> tH(TT, 0), tV(TT, 0), tC(TT, 0); double beta = exp(lb);
        pool.run([&](int w){
          fill(G[w].begin(), G[w].end(), 0.f); GB[w] = 0; float d[7];
          for (long b = b0 + w; b < b0 + bs; b += TT){
            long j = order[b]; const ASample& s = S[j]; const float* xT = &X[j * 2 * F]; const float* xS = xT + F;
            int nT = (int)xT[0], nS = (int)xS[0]; float pT[7], pS[7];
            if (!s.termT){ const float* o = net.forward(xT, C1[w].get()); copy(o, o + nT, pT); }
            if (!s.termS){ const float* o = net.forward(xS, C2[w].get()); copy(o, o + nS, pS); }
            double sT = s.termT ? s.cT : pT[s.kT], sS = s.termS ? s.cS : pS[s.kS];
            double l = beta * (sT - sS), p = 1 / (1 + exp(-l)), lp = log(max(1e-8, s.a ? p : 1 - p)), ratio = exp(lp - s.lp);
            bool clipped = (s.adv > 0 && ratio > 1 + clipE) || (s.adv < 0 && ratio < 1 - clipE);
            double dl = clipped ? 0 : -ratio * s.adv * (s.a - p);
            dl += ent * l * p * (1 - p); dl *= pg;
            double V = max(sT, sS), dv = 2 * vc * (V - s.ret);
            double gT = dl * beta + (sT >= sS ? dv : 0), gS = -dl * beta + (sT >= sS ? 0 : dv);
            GB[w] += dl * l;   // d/d log beta
            // backward takes d loss / d logit: through the softmax, d share_k / d logit_i = s_k (delta_ik - s_i)
            if (!s.termT){ for (int i = 0; i < nT; i++) d[i] = (float)(gT / bs * pT[s.kT] * ((i == s.kT) - pT[i])); net.backward(xT, C1[w].get(), d, G[w].data()); }
            if (!s.termS){ for (int i = 0; i < nS; i++) d[i] = (float)(gS / bs * pS[s.kS] * ((i == s.kS) - pS[i])); net.backward(xS, C2[w].get(), d, G[w].data()); }
            tH[w] += -(p * log(p + 1e-8) + (1 - p) * log(1 - p + 1e-8)); tV[w] += (V - s.ret) * (V - s.ret); tC[w] += clipped;
          }
        });
        pool.run([&](int t){
          for (int i = (int)((long)net.n * t / TT), e = (int)((long)net.n * (t + 1) / TT); i < e; i++) for (int u = 1; u < TT; u++) G[0][i] += G[u][i]; });
        double gn = 0; for (int k = 0; k < net.n; k++) gn += G[0][k] * G[0][k]; gn = sqrt(gn);
        if (gn > 1) for (int k = 0; k < net.n; k++) G[0][k] /= gn;
        net.adam(G[0], lr);
        double gb = 0; for (int w = 0; w < TT; w++) gb += GB[w]; gb /= bs;   // Adam on log beta
        lbm = 0.9 * lbm + 0.1 * gb; lbv = 0.999 * lbv + 0.001 * gb * gb; lb -= 1e-3 * lbm / (sqrt(lbv) + 1e-8);
        for (int w = 0; w < TT; w++){ sumH += tH[w]; sumV += tV[w]; sumClip += tC[w]; } cntS += bs;
      }
    }
    double mw = 0, mn = 0; long cn = 0; for (int w = 0; w < NT; w++){ mw += mixW[w]; mn += mixN[w]; cn += chainN[w]; }
    printf("iter %d/%d: %ld decisions, edge vs live %+.1f%%, entropy %.3f, value mse %.4f, clipped %.1f%%, beta %.1f, %.0fs (play %.0fs)\n",
      it, T, N, mn ? 100 * mw / mn : 0.0, sumH / max(1L, cntS), sumV / max(1L, cntS), 100 * sumClip / max(1L, cntS), exp(lb), secs(), tp); fflush(stdout);
    saveJson("appo.json", "anet", net);
    { FILE* f = fopen("appo-meta.txt.tmp", "w"); fprintf(f, "%d %.9f\n", it, lb); fclose(f); rename("appo-meta.txt.tmp", "appo-meta.txt"); }
    if (getenv("SAVEEVERY") && it % atoi(getenv("SAVEEVERY")) == 0){ saveJson("appo-" + to_string(it) + ".json", "anet", net);
      FILE* f = fopen(("appo-" + to_string(it) + "-beta.txt").c_str(), "w"); fprintf(f, "%.9f\n", lb); fclose(f); }
  }
  return 0;
}

// Alex's test against the live bot: 3 players, 1 copy + 2 live (fair 33.3%); 4 players, 2 copies + 2 live (fair 50%).
// The copies' seats rotate over the deals. GREEDY=1 plays the chain argmax instead of sampling.
static int avsMain(const string& file, int deals){
  unique_ptr<ANet> Ap(loadA(file)); const ANet& net = *Ap; double beta = 20;
  { string bf = file.substr(0, file.size() - 5) + "-beta.txt"; ifstream f(bf); double b; if (f >> b) beta = exp(b);
    else { ifstream m("appo-meta.txt"); int t; if (m >> t >> b) beta = exp(b); } }
  bool greedy = getenv("GREEDY") && atoi(getenv("GREEDY"));
  const int NT = thread::hardware_concurrency();
  for (int cfg = 0; cfg < 2; cfg++){
    int n = cfg == 0 ? 3 : 4, copies = cfg == 0 ? 1 : 2; atomic<int> next{ 0 }; mutex mu; double tot = 0, sq = 0;
    vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&]{
      unique_ptr<Work> c(net.work()), lw(liveNet->work()); vector<float> x(MAXF); Chain ch; double s1 = 0, s2 = 0;
      for (int i; (i = next++) < deals;){
        Rng r(31337 + i * 104729); Game g; newGame(g, n, r); bool mine[7] = {};
        for (int k = 0; k < copies; k++) mine[(i + k * (n / copies)) % n] = true;
        for (;;){
          int p = g.turn; bool take;
          if (g.chips[p] == 0) take = true;
          else if (mine[p]){ chainAt(net, c.get(), g, ch); double d = ch.T0[p] - ch.v1[p];
            take = greedy ? d >= 0 : r() < 1 / (1 + exp(-beta * d)); }
          else { liveNet->features(g, x.data()); take = r() < takeProb(*liveNet, liveNet->forward(x.data(), lw.get())); }
          if (step(g, take)) break;
        }
        double v = 0; for (int q = 0; q < n; q++) if (mine[q]) v += winShare(g, q); s1 += v; s2 += v * v;
      }
      lock_guard<mutex> lk(mu); tot += s1; sq += s2;
    });
    for (auto& t : th) t.join();
    double m = tot / deals, sd = sqrt(max(0.0, sq / deals - m * m) / deals);
    printf("%d players, %d cop%s + %d live, %d deals: %.2f%% +- %.2f (fair %.1f%%)\n", n, copies, copies > 1 ? "ies" : "y", n - copies, deals, 100 * m, 100 * sd, 100.0 * copies / n);
  }
  return 0;
}
