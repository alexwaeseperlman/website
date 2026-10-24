// PPO with the anet + pass-chain layer as the policy (Alex's idea, 2026-10-24): one anet (afterstate win shares, any
// table size) for the whole game. At a decision the chain layer gives the mover's value of taking now (T0) and of
// passing (the chain from the next player on, everyone playing it greedily against the anet). The policy is
// P(take) = sigmoid(beta * (T0 - pass)) with beta learned, and the value is max(T0, pass). Gradients flow into the two
// afterstates that decide this: take-now and the one the pass chain picked.
//   ./fvi appo <iterations> <games per thread>   -> appo.json (+ appo-meta.txt: iteration, log beta); resumes from them
//   ./fvi avs <appo.json> <deals>               Alex's test: 1 copy + 2 live (3p, needs > 33.3%), 2 copies + 2 live (4p, > 50%)
// Env: LR (3e-4), EPOCHS (4), CLIP (0.2), ENT (0.01), LAMBDA (0.95), BETA (initial, 20), POOLP (0.5: chance a seat is
// the live bot), TABLES (e.g. "2" or "2,3,3,4"; default the ppo mix 2..7), BS (512), INIT=a<k>.json, TRAIN_THREADS.
// SOFT=1 (soft pass chain under the policy), VT=1 (value of the move played, not the max), ADV=1 [ALR] (auxiliary
// advantage head, see AdvHead): see appoMain.
#pragma once

// Auxiliary advantage head (ADV=1, Alex 2026-10-24): the chain's take/pass values are two separate absolute win-share
// predictions whose errors are much bigger than most take-pass margins. This small MLP reads the decision directly and
// adds a learned correction r to the logit: P(take) = sigmoid(beta * (T0 - pass) + r). Its inputs are the anet's own
// pooled conv features (no gradient into the anet: the chain stays a pure value net), a raw window of the lines
// around the card, chips, and T0 / pass. Trained by the policy-gradient loss only. Output weights start at 0, so a
// warm start plays exactly like the net it came from. Saved next to the net as <name>-adv.json.
static const int ADV_LOC = 12, ADV_SC = 10;
struct AdvHead {
  int I, H1, H2; vector<float> p, m, v; long at = 0;
  int w1, b1, w2, b2, w3, b3, n;
  AdvHead(int pooled, uint32_t seed, int h1 = 64, int h2 = 32) : I(4 * pooled + ADV_LOC + ADV_SC), H1(h1), H2(h2){
    w1 = 0; b1 = w1 + I * H1; w2 = b1 + H1; b2 = w2 + H1 * H2; w3 = b2 + H2; b3 = w3 + H2; n = b3 + 1;
    p.assign(n, 0); m.assign(n, 0); v.assign(n, 0); Rng r(seed);
    auto init = [&](int o, int fan, int cnt){ double sd = sqrt(2.0 / fan); for (int k = 0; k < cnt; k++){ double u1 = max(1e-12, r()), u2 = r(); p[o + k] = (float)(sd * sqrt(-2 * log(u1)) * cos(6.283185307 * u2)); } };
    init(w1, I, I * H1); init(w2, H1, H1 * H2);   // w3, b3 stay 0
  }
  // h: scratch of H1 + H2 floats
  double forward(const float* x, float* h) const {
    float* a = h; float* b = h + H1;
    for (int j = 0; j < H1; j++){ double z = p[b1 + j]; const float* w = &p[w1 + j * I]; for (int i = 0; i < I; i++) z += w[i] * x[i]; a[j] = z > 0 ? (float)z : 0; }
    for (int j = 0; j < H2; j++){ double z = p[b2 + j]; const float* w = &p[w2 + j * H1]; for (int i = 0; i < H1; i++) z += w[i] * a[i]; b[j] = z > 0 ? (float)z : 0; }
    double z = p[b3]; for (int i = 0; i < H2; i++) z += p[w3 + i] * b[i]; return z;
  }
  void backward(const float* x, const float* h, double d, float* g) const {   // h from forward; adds d * dr/dp into g
    const float* a = h; const float* b = h + H1; float db[256], da[256] = {};
    g[b3] += (float)d; for (int i = 0; i < H2; i++){ g[w3 + i] += (float)(d * b[i]); db[i] = b[i] > 0 ? (float)(d * p[w3 + i]) : 0; }
    for (int j = 0; j < H2; j++){ if (db[j] == 0) continue; g[b2 + j] += db[j]; float* gw = &g[w2 + j * H1]; const float* w = &p[w2 + j * H1];
      for (int i = 0; i < H1; i++){ gw[i] += db[j] * a[i]; da[i] += db[j] * w[i]; } }
    for (int j = 0; j < H1; j++){ if (a[j] <= 0 || da[j] == 0) continue; g[b1 + j] += da[j]; float* gw = &g[w1 + j * I]; for (int i = 0; i < I; i++) gw[i] += da[j] * x[i]; }
  }
  void adam(const vector<float>& g, double lr){
    const double c1b = 0.9, c2b = 0.999; at++; double c1 = 1 - pow(c1b, at), c2 = 1 - pow(c2b, at);
    for (int k = 0; k < n; k++){ m[k] = (float)(c1b * m[k] + (1 - c1b) * g[k]); v[k] = (float)(c2b * v[k] + (1 - c2b) * g[k] * g[k]);
      p[k] = (float)(p[k] - lr * (m[k] / c1) / (sqrt(v[k] / c2) + 1e-8)); }
  }
  void save(const string& f) const { FILE* o = fopen((f + ".tmp").c_str(), "w"); fprintf(o, "{\"arch\":\"advhead\",\"I\":%d,\"H1\":%d,\"H2\":%d,\"p\":[", I, H1, H2);
    for (int k = 0; k < n; k++) fprintf(o, "%s%.7g", k ? "," : "", p[k]); fprintf(o, "]}\n"); fclose(o); rename((f + ".tmp").c_str(), f.c_str()); }
  bool load(const string& f){ ifstream in(f); if (!in) return false; vector<float> w = jsonFloats(readFile(f), "p"); if ((int)w.size() != n) return false; p = w; return true; }
};
static AdvHead* advHead = nullptr;
static string advFile(const string& net){ return net.substr(0, net.size() - 5) + "-adv.json"; }

struct Chain {   // what the chain layer decided at a decision of the mover p
  double T0[7], v1[7]; int kT, kS; bool termT, termS; vector<float> xT, xS;
  int m; int kSs[3]; double wS[3];   // pass value = sum of wS[i] * share kSs[i] of the afterstate xS[i*AF ...] (m of them)
  vector<float> xa;   // advantage head input (empty on the last card: the chain is exact there and the head is skipped)
  double logit(double beta, float* h) const { int p = turn; double l = beta * (T0[p] - v1[p]); if (advHead && !xa.empty()) l += advHead->forward(xa.data(), h); return l; }
  int turn;
};
// SOFT chain (chainSoftBeta > 0): instead of everyone after the mover taking greedily, each takes with the policy's own
// P(take) = sigmoid(beta * (take - rest of the chain)), so the pass value is the expected outcome under the policy, not
// the max over noisy estimates. Gradients go to the 3 most likely ends of the chain (weights renormalised).
static double chainSoftBeta = 0;
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
  c.m = 1; c.kSs[0] = c.kS; c.wS[0] = 1; c.turn = g.turn; c.xa.clear();
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
  int L = (int)T.size() - 1, sel = L, p = g.turn;
  int js[3]; double ws[3]; int m = 1;
  if (chainSoftBeta <= 0){
    for (int j = L - 1; j >= 1; j--) if (T[j][nodes[j].turn] >= T[sel][nodes[j].turn]) sel = j;
    js[0] = sel; ws[0] = 1;
  } else {
    array<double, 7> W = T[L]; vector<double> dist(L + 1, 0); dist[L] = 1;
    for (int j = L - 1; j >= 1; j--){
      int t = nodes[j].turn; double pj = 1 / (1 + exp(-chainSoftBeta * (T[j][t] - W[t])));
      for (int q = 0; q < n; q++) W[q] = pj * T[j][q] + (1 - pj) * W[q];
      for (int i = j + 1; i <= L; i++) dist[i] *= 1 - pj; dist[j] = pj;
    }
    m = 0; double tot = 0;
    for (int k = 0; k < 3; k++){ int b = -1; for (int j = 1; j <= L; j++){ bool used = false; for (int i = 0; i < m; i++) used |= js[i] == j;
        if (!used && (b < 0 || dist[j] > dist[b])) b = j; }
      if (b < 0 || (m > 0 && dist[b] < 1e-3)) break; js[m] = b; ws[m] = dist[b]; tot += dist[b]; m++; }
    for (int i = 0; i < m; i++) ws[i] /= tot;
    sel = js[0];
  }
  for (int q = 0; q < n; q++){ c.T0[q] = T[0][q]; c.v1[q] = 0; for (int i = 0; i < m; i++) c.v1[q] += ws[i] * T[js[i]][q]; }
  c.kT = 0; c.kS = (p - nodes[sel].turn + n) % n; c.termT = c.termS = last; c.m = m;
  for (int i = 0; i < m; i++){ c.kSs[i] = (p - nodes[js[i]].turn + n) % n; c.wS[i] = ws[i]; }
  c.xT.resize(AF); c.xS.resize((size_t)m * AF);
  if (!last){ Game e = nodes[0]; step(e, true); afeatures(e, c.xT.data());
    for (int i = 0; i < m; i++){ e = nodes[js[i]]; step(e, true); afeatures(e, &c.xS[(size_t)i * AF]); } }
  c.turn = p; c.xa.clear();
  if (advHead && !last){
    c.xa.assign(advHead->I, 0); float* x = c.xa.data(); int o = 0;
    for (int i = 0; i < PS; i++){ x[i] = pl1[p * PS + i] - pl0[p * PS + i]; x[PS + i] = pl0[p * PS + i]; x[2 * PS + i] = 0; x[3 * PS + i] = -1e9f; }
    for (int q = 0; q < n; q++) if (q != p) for (int i = 0; i < PS; i++){ float d = pl1[q * PS + i] - pl0[q * PS + i]; x[2 * PS + i] += d / (n - 1); x[3 * PS + i] = max(x[3 * PS + i], d); }
    o = 4 * PS;
    for (int dv = -2; dv <= 2; dv++){ int u = cd + dv; x[o++] = u >= 3 && u <= 35 && g.has[p * 37 + u]; }
    for (int dv = -2; dv <= 2; dv++){ int u = cd + dv; x[o++] = u >= 3 && u <= 35 && dv != 0 ? seen[u - 3] : 0; }
    for (int dv : { -1, 1 }){ int u = cd + dv; bool any = false; for (int q = 0; q < n; q++) if (q != p && u >= 3 && u <= 35 && g.has[q * 37 + u]) any = true; x[o++] = any; }
    double oc = 0, om = 99; for (int q = 0; q < n; q++) if (q != p){ oc += g.chips[q]; om = min(om, (double)g.chips[q]); }
    x[o++] = cd / 35.f; x[o++] = g.pot / 11.f; x[o++] = g.chips[p] / 11.f; x[o++] = (float)(oc / (n - 1) / 11); x[o++] = (float)(om / 11);
    x[o++] = (24 - (g.idx + 1)) / 23.f; x[o++] = (n - 2) / 5.f; x[o++] = (float)(10 * (c.T0[p] - c.v1[p])); x[o++] = (float)c.T0[p]; x[o++] = (float)c.v1[p];
  }
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

struct ASample { int a, kT, kS; bool termT, termS; float cT, cS, lp, v, adv, ret; int m, kSs[3]; float wS[3]; long off, aoff; };
static vector<int> tableMix(){
  vector<int> t; string s = getenv("TABLES") ? getenv("TABLES") : "2,3,3,3,4,4,4,5,5,5,6,7";
  for (size_t i = 0; i < s.size();){ size_t j = s.find(',', i); if (j == string::npos) j = s.size(); t.push_back(atoi(s.substr(i, j - i).c_str())); i = j + 1; }
  return t;
}

static int appoMain(int T, int games){
  auto env = [](const char* k, double d){ return getenv(k) ? atof(getenv(k)) : d; };
  double lr = env("LR", 3e-4), clipE = env("CLIP", 0.2), ent = env("ENT", 0.01), lam = env("LAMBDA", 0.95), vc = env("VC", 0.5), pg = env("PG", 1), poolP = env("POOLP", 0.5);
  int epochs = (int)env("EPOCHS", 4), bs = (int)env("BS", 512); vector<int> tables = tableMix();
  // SOFT=1: soft pass chain (see chainSoftBeta). VT=1: the state value is the policy's expectation p*take + (1-p)*pass,
  // and only the afterstate of the move actually played is regressed to the return (instead of max(take, pass), which
  // never corrects an underestimated take once passing looks better).
  const bool soft = env("SOFT", 0) > 0, vt = env("VT", 0) > 0;
  const int NT = thread::hardware_concurrency(), TT = min(NT, (int)env("TRAIN_THREADS", 16));
  unique_ptr<ANet> Ap(getenv("INIT") ? loadA(getenv("INIT")) : new ANet(11)); 
  double lb = log(env("BETA", 20)), lbm = 0, lbv = 0; int start = 1;
  { ifstream f("appo-meta.txt"); int t; double b; if (f >> t >> b){ Ap.reset(loadA("appo.json")); start = t + 1; lb = b; printf("resuming after iteration %d\n", t); } }
  ANet& net = *Ap;
  // ADV=1: auxiliary advantage head (see AdvHead), own Adam at ALR. Resumes from appo-adv.json, or INIT's -adv.json.
  const double alr = env("ALR", 1e-3); unique_ptr<AdvHead> AH;
  if (env("ADV", 0) > 0){ AH.reset(new AdvHead(3 * net.C2, 13)); advHead = AH.get();
    if (start > 1 ? AH->load("appo-adv.json") : getenv("INIT") && AH->load(advFile(getenv("INIT")))) printf("advantage head loaded\n"); }
  vector<vector<float>> GA(TT, vector<float>(AH ? AH->n : 0));
  const int F = AF; Pool pool(TT);
  vector<vector<float>> G(TT, vector<float>(net.n)); vector<unique_ptr<Work>> C1, C2; vector<double> GB(TT);
  for (int t = 0; t < TT; t++){ C1.emplace_back(net.work()); for (int i = 0; i < 3; i++) C2.emplace_back(net.work()); }
  auto t0 = chrono::steady_clock::now(); auto secs = [&]{ return chrono::duration<double>(chrono::steady_clock::now() - t0).count(); };
  for (int it = start; it <= T; it++){
    double tp = secs(), beta = exp(lb); chainSoftBeta = soft ? beta : 0;
    vector<vector<float>> WX(NT); vector<vector<ASample>> WS(NT); vector<double> mixW(NT, 0), mixN(NT, 0); vector<long> chainN(NT, 0);
    { vector<thread> th;
      for (int w = 0; w < NT; w++) th.emplace_back([&, w]{
        Rng r(991 + w * 7919 + it * 104729); unique_ptr<Work> c(net.work()), lw(liveNet->work()); vector<float> x(MAXF); Chain ch; float hb[512];
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
              double sT = ch.T0[p], sS = ch.v1[p], pt = 1 / (1 + exp(-ch.logit(beta, hb))); take = r() < pt;
              ASample s{ take, (p - g.turn + n) % n, ch.kS, ch.termT, ch.termS, (float)sT, (float)sS, (float)log(max(1e-8, take ? pt : 1 - pt)), (float)(vt ? pt * sT + (1 - pt) * sS : max(sT, sS)), 0, 0,
                ch.m, { ch.kSs[0], ch.kSs[1], ch.kSs[2] }, { (float)ch.wS[0], (float)ch.wS[1], (float)ch.wS[2] }, (long)WX[w].size(), -1 };
              s.kT = 0;   // take-now afterstate: the taker is p, so p is output 0
              WX[w].insert(WX[w].end(), ch.xT.begin(), ch.xT.end()); WX[w].insert(WX[w].end(), ch.xS.begin(), ch.xS.end());
              if (!ch.xa.empty()){ s.aoff = (long)WX[w].size() - s.off; WX[w].insert(WX[w].end(), ch.xa.begin(), ch.xa.end()); }
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
    for (int w = 0; w < NT; w++){ long base = (long)X.size(); X.insert(X.end(), WX[w].begin(), WX[w].end());
      for (auto s : WS[w]){ s.off += base; S.push_back(s); } }
    long N = (long)S.size();
    if (getenv("ADEBUG")){ double mT = 0, mS = 0, mR = 0, mA = 0, tt = 0, ts = 0; for (auto& s : S){ mT += s.cT; mS += s.cS; mR += s.ret; mA += s.a; tt += s.termT; ts += s.termS; }
      printf("  mean take-now %.3f, pass %.3f, return %.3f, took %.3f, terminal %.3f/%.3f\n", mT / N, mS / N, mR / N, mA / N, tt / N, ts / N); }
    double am = 0, av = 0; for (auto& s : S) am += s.adv; am /= N; for (auto& s : S) av += (s.adv - am) * (s.adv - am); av = sqrt(av / N) + 1e-8;
    for (auto& s : S) s.adv = (float)((s.adv - am) / av);
    vector<long> order(N); for (long i = 0; i < N; i++) order[i] = i;
    double sumH = 0, sumV = 0, sumClip = 0, sumR = 0; long cntS = 0, cntR = 0; vector<double> tR(TT, 0); vector<long> nR(TT, 0);
    for (int e = 0; e < epochs; e++){
      for (long i = N - 1; i > 0; i--){ long j = (long)floor(rnd() * (i + 1)); swap(order[i], order[j]); }
      for (long b0 = 0; b0 + bs <= N; b0 += bs){
        vector<double> tH(TT, 0), tV(TT, 0), tC(TT, 0); double beta = exp(lb);
        pool.run([&](int w){
          fill(G[w].begin(), G[w].end(), 0.f); fill(GA[w].begin(), GA[w].end(), 0.f); GB[w] = 0; float d[7], hb[512];
          for (long b = b0 + w; b < b0 + bs; b += TT){
            long j = order[b]; const ASample& s = S[j]; const float* xT = &X[s.off]; const float* xS = xT + F;
            int nT = (int)xT[0], nS = (int)xS[0]; float pT[7], pS[3][7];
            if (!s.termT){ const float* o = net.forward(xT, C1[w].get()); copy(o, o + nT, pT); }
            double sT = s.termT ? s.cT : pT[s.kT], sS = 0;
            if (s.termS) sS = s.cS;
            else for (int i = 0; i < s.m; i++){ const float* o = net.forward(xS + (long)i * F, C2[w * 3 + i].get()); copy(o, o + nS, pS[i]); sS += s.wS[i] * pS[i][s.kSs[i]]; }
            const float* xa = s.aoff >= 0 && AH ? xT + s.aoff : nullptr; double rA = xa ? AH->forward(xa, hb) : 0;
            double l = beta * (sT - sS) + rA, p = 1 / (1 + exp(-l)), lp = log(max(1e-8, s.a ? p : 1 - p)), ratio = exp(lp - s.lp);
            bool clipped = (s.adv > 0 && ratio > 1 + clipE) || (s.adv < 0 && ratio < 1 - clipE);
            double dl = clipped ? 0 : -ratio * s.adv * (s.a - p);
            dl += ent * l * p * (1 - p); dl *= pg;
            double V = vt ? (s.a ? sT : sS) : max(sT, sS), dv = 2 * vc * (V - s.ret); bool vOnT = vt ? s.a : sT >= sS;
            double gT = dl * beta + (vOnT ? dv : 0), gS = -dl * beta + (vOnT ? 0 : dv);
            GB[w] += dl * (l - rA);   // d/d log beta
            if (xa){ AH->backward(xa, hb, dl / bs, GA[w].data()); tR[w] += fabs(rA); nR[w]++; }
            // backward takes d loss / d logit: through the softmax, d share_k / d logit_i = s_k (delta_ik - s_i)
            if (!s.termT){ for (int i = 0; i < nT; i++) d[i] = (float)(gT / bs * pT[s.kT] * ((i == s.kT) - pT[i])); net.backward(xT, C1[w].get(), d, G[w].data()); }
            if (!s.termS) for (int k = 0; k < s.m; k++){ int kk = s.kSs[k]; double gk = gS * s.wS[k];
              for (int i = 0; i < nS; i++) d[i] = (float)(gk / bs * pS[k][kk] * ((i == kk) - pS[k][i])); net.backward(xS + (long)k * F, C2[w * 3 + k].get(), d, G[w].data()); }
            tH[w] += -(p * log(p + 1e-8) + (1 - p) * log(1 - p + 1e-8)); tV[w] += (V - s.ret) * (V - s.ret); tC[w] += clipped;
          }
        });
        pool.run([&](int t){
          for (int i = (int)((long)net.n * t / TT), e = (int)((long)net.n * (t + 1) / TT); i < e; i++) for (int u = 1; u < TT; u++) G[0][i] += G[u][i]; });
        double gn = 0; for (int k = 0; k < net.n; k++) gn += G[0][k] * G[0][k]; gn = sqrt(gn);
        if (gn > 1) for (int k = 0; k < net.n; k++) G[0][k] /= gn;
        net.adam(G[0], lr);
        if (AH){ for (int u = 1; u < TT; u++) for (int k = 0; k < AH->n; k++) GA[0][k] += GA[u][k];
          double ga = 0; for (int k = 0; k < AH->n; k++) ga += GA[0][k] * GA[0][k]; ga = sqrt(ga);
          if (ga > 1) for (int k = 0; k < AH->n; k++) GA[0][k] /= ga;
          AH->adam(GA[0], alr); }
        double gb = 0; for (int w = 0; w < TT; w++) gb += GB[w]; gb /= bs;   // Adam on log beta
        lbm = 0.9 * lbm + 0.1 * gb; lbv = 0.999 * lbv + 0.001 * gb * gb; lb -= 1e-3 * lbm / (sqrt(lbv) + 1e-8);
        for (int w = 0; w < TT; w++){ sumH += tH[w]; sumV += tV[w]; sumClip += tC[w]; sumR += tR[w]; cntR += nR[w]; tR[w] = 0; nR[w] = 0; } cntS += bs;
      }
    }
    double mw = 0, mn = 0; long cn = 0; for (int w = 0; w < NT; w++){ mw += mixW[w]; mn += mixN[w]; cn += chainN[w]; }
    printf("iter %d/%d: %ld decisions, edge vs live %+.1f%%, entropy %.3f, value mse %.4f, clipped %.1f%%, beta %.1f, %.0fs (play %.0fs)\n",
      it, T, N, mn ? 100 * mw / mn : 0.0, sumH / max(1L, cntS), sumV / max(1L, cntS), 100 * sumClip / max(1L, cntS), exp(lb), secs(), tp); fflush(stdout);
    if (AH) printf("  advantage head: mean |r| %.3f (logit units)\n", sumR / max(1L, cntR));
    saveJson("appo.json", "anet", net); if (AH) AH->save("appo-adv.json");
    { FILE* f = fopen("appo-meta.txt.tmp", "w"); fprintf(f, "%d %.9f\n", it, lb); fclose(f); rename("appo-meta.txt.tmp", "appo-meta.txt"); }
    if (getenv("SAVEEVERY") && it % atoi(getenv("SAVEEVERY")) == 0){ saveJson("appo-" + to_string(it) + ".json", "anet", net); if (AH) AH->save("appo-" + to_string(it) + "-adv.json");
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
  bool greedy = getenv("GREEDY") && atoi(getenv("GREEDY")); if (getenv("SOFT") && atoi(getenv("SOFT"))) chainSoftBeta = beta;
  unique_ptr<AdvHead> AH(new AdvHead(3 * net.C2, 13)); if (AH->load(advFile(file))){ advHead = AH.get(); fprintf(stderr, "with advantage head\n"); }
  const int NT = thread::hardware_concurrency();
  for (int cfg = 0; cfg < 2; cfg++){
    int n = cfg == 0 ? 3 : 4, copies = cfg == 0 ? 1 : 2; atomic<int> next{ 0 }; mutex mu; double tot = 0, sq = 0;
    vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&]{
      unique_ptr<Work> c(net.work()), lw(liveNet->work()); vector<float> x(MAXF); Chain ch; double s1 = 0, s2 = 0; float hb[512];
      for (int i; (i = next++) < deals;){
        Rng r(31337 + i * 104729); Game g; newGame(g, n, r); bool mine[7] = {};
        for (int k = 0; k < copies; k++) mine[(i + k * (n / copies)) % n] = true;
        for (;;){
          int p = g.turn; bool take;
          if (g.chips[p] == 0) take = true;
          else if (mine[p]){ chainAt(net, c.get(), g, ch); double l = ch.logit(beta, hb);
            take = greedy ? l >= 0 : r() < 1 / (1 + exp(-l)); }
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

// ./fvi aheat <a.json> [n=2]: the first card of the game, card x chips on it (from the others passing, nobody holds a
// card yet): the chain policy's take-now and pass values for the mover, and the live bot's P(take). CSV on stdout.
static int aheatMain(const string& file, int n){
  unique_ptr<ANet> A(loadA(file)); unique_ptr<Work> w(A->work()), lw(liveNet->work()); vector<float> x(MAXF); Chain ch;
  printf("card,pot,mover_chips,take_value,pass_value,nash_take,live_ptake\n");
  for (int v = 3; v <= 35; v++) for (int pot = 0; pot <= 30; pot++){
    Rng r(1); Game g; newGame(g, n, r); g.deck[0] = v;
    bool ok = true; for (int i = 0; i < pot; i++){ if (g.chips[g.turn] == 0){ ok = false; break; } step(g, false); }
    if (!ok || g.chips[g.turn] == 0) continue;
    int p = g.turn; chainAt(*A, w.get(), g, ch);
    liveNet->features(g, x.data()); double lt = takeProb(*liveNet, liveNet->forward(x.data(), lw.get()));
    printf("%d,%d,%d,%.5f,%.5f,%d,%.4f\n", v, pot, g.chips[p], ch.T0[p], ch.v1[p], ch.T0[p] >= ch.v1[p], lt);
  }
  return 0;
}

// ./fvi abias <a.json> <k> <positions>: 2-player positions with k cards left after the one in play (live-bot play to get
// there), the chain layer's take-now and pass values for the mover against the exact (minimax) solver. Is pass biased?
static int abiasMain(const string& file, int k, int positions){
  unique_ptr<ANet> A(loadA(file)); const int NT = thread::hardware_concurrency(); atomic<int> next{ 0 }; mutex mu;
  double sT = 0, sP = 0, sD = 0, qT = 0, qP = 0, ag = 0, dc = 0; long cnt = 0;
  vector<thread> th;
  for (int t = 0; t < NT; t++) th.emplace_back([&]{
    unique_ptr<Work> w(A->work()), lw(liveNet->work()); vector<float> x(MAXF); Chain ch;
    double a1 = 0, a2 = 0, a3 = 0, b1 = 0, b2 = 0, g1 = 0, d1 = 0; long c = 0;
    for (int i; (i = next++) < positions;){
      Rng r(999331 + i * 31); Game g; sample(g, k, r, lw.get(), x.data(), 0.1);
      if (g.chips[g.turn] == 0) continue;
      Cfg cf; cf.n = 2; Solver s(cf, 16); Pos p = toPos(g); s.solve(p);
      double et = s.takeVal(p)[g.turn], ep = s.passVal(p)[g.turn];
      chainAt(*A, w.get(), g, ch); double nt = ch.T0[g.turn], np = ch.v1[g.turn];
      a1 += nt - et; a2 += np - ep; a3 += (nt - np) - (et - ep); b1 += (nt - et) * (nt - et); b2 += (np - ep) * (np - ep); c++;
      if (fabs(et - ep) > 1e-6){ g1 += (nt >= np) == (et > ep); d1++; }
    }
    lock_guard<mutex> lk(mu); sT += a1; sP += a2; sD += a3; qT += b1; qP += b2; ag += g1; dc += d1; cnt += c;
  });
  for (auto& t : th) t.join();
  printf("k %d, %ld positions: take-now bias %+.4f (rmse %.4f), pass bias %+.4f (rmse %.4f), (take - pass) bias %+.4f; minimax move %.1f%% of %.0f\n",
    k, cnt, sT / cnt, sqrt(qT / cnt), sP / cnt, sqrt(qP / cnt), sD / cnt, 100 * ag / dc, dc);
  return 0;
}

// ./fvi aroll <a.json> <n> <rollouts>: first card of an n-player game (card x chips from the others passing), the chain
// layer's take-now and pass values for the mover against Monte Carlo: force take / pass, then play the game out (the
// mover plays the chain policy at its beta, the others are the live bot, or copies of the net with SELFOPP=1).
// Same random numbers for both arms. Prints per position and the mean bias of each value.
static int arollMain(const string& file, int n, int R){
  unique_ptr<ANet> A(loadA(file)); double beta = 20;
  { string bf = file.substr(0, file.size() - 5) + "-beta.txt"; ifstream f(bf); double b; if (f >> b) beta = exp(b); }
  if (getenv("BETA")) beta = atof(getenv("BETA"));
  if (getenv("SOFT") && atoi(getenv("SOFT"))) chainSoftBeta = beta;
  bool self = getenv("SELFOPP") && atoi(getenv("SELFOPP")); const int NT = thread::hardware_concurrency();
  struct P { int v, pot; double nt, np, mt, mp, st, sp; }; vector<P> ps;
  for (int v : { 4, 8, 12, 16, 20, 24, 28, 32, 34 }) for (int pot = 0; pot <= 6; pot++) ps.push_back({ v, pot });
  printf("card,pot,net_take,net_pass,mc_take,mc_pass,mc_take_se,mc_pass_se\n");
  double bt = 0, bp = 0, bd = 0, wbd = 0, wsum = 0; int cnt = 0;
  for (auto& P0 : ps){
    Game g0; Rng r0(1); newGame(g0, n, r0);
    { int at = -1; for (int i = 0; i < 24; i++) if (g0.deck[i] == P0.v) at = i; if (at >= 0) swap(g0.deck[0], g0.deck[at]); else g0.deck[0] = P0.v; }
    bool ok = true; for (int i = 0; i < P0.pot; i++){ if (g0.chips[g0.turn] == 0){ ok = false; break; } step(g0, false); }
    if (!ok || g0.chips[g0.turn] == 0) continue;
    int me = g0.turn; Chain ch; { unique_ptr<Work> w(A->work()); chainAt(*A, w.get(), g0, ch); }
    P0.nt = ch.T0[me]; P0.np = ch.v1[me];
    atomic<int> next{ 0 }; mutex mu; double s[2] = {}, q[2] = {};
    vector<thread> th;
    for (int t = 0; t < NT; t++) th.emplace_back([&]{
      unique_ptr<Work> c(A->work()), lw(liveNet->work()); vector<float> x(MAXF); Chain cc; double a[2] = {}, b[2] = {};
      for (int i; (i = next++) < R;){
        // the rest of the deck is re-dealt for every rollout (the card in play stays)
        Rng rd(555 + i * 7919); Game base = g0; { bool used[37] = {}; used[P0.v] = true; int rest[33], m = 0;
          for (int u = 3; u <= 35; u++) if (!used[u]) rest[m++] = u;
          for (int k = m - 1; k > 0; k--){ int j = (int)floor(rd() * (k + 1)); swap(rest[k], rest[j]); }
          for (int k = 1; k < 24; k++) base.deck[k] = rest[k - 1]; }
        for (int arm = 0; arm < 2; arm++){
          Rng r(777 + i * 104729); Game g = base; bool over = step(g, arm == 0);
          while (!over){
            int p = g.turn; bool take;
            if (g.chips[p] == 0) take = true;
            else if (p == me || self){ chainAt(*A, c.get(), g, cc); take = r() < 1 / (1 + exp(-beta * (cc.T0[p] - cc.v1[p]))); }
            else { liveNet->features(g, x.data()); take = r() < takeProb(*liveNet, liveNet->forward(x.data(), lw.get())); }
            over = step(g, take);
          }
          double v = winShare(g, me); a[arm] += v; b[arm] += v * v;
        }
      }
      lock_guard<mutex> lk(mu); for (int k = 0; k < 2; k++){ s[k] += a[k]; q[k] += b[k]; }
    });
    for (auto& t : th) t.join();
    P0.mt = s[0] / R; P0.mp = s[1] / R; P0.st = sqrt(max(0.0, q[0] / R - P0.mt * P0.mt) / R); P0.sp = sqrt(max(0.0, q[1] / R - P0.mp * P0.mp) / R);
    printf("%d,%d,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f\n", P0.v, P0.pot, P0.nt, P0.np, P0.mt, P0.mp, P0.st, P0.sp); fflush(stdout);
    bt += P0.nt - P0.mt; bp += P0.np - P0.mp; bd += (P0.nt - P0.np) - (P0.mt - P0.mp); cnt++;
    double wgt = exp(-fabs(P0.mt - P0.mp) / 0.03); wbd += wgt * ((P0.nt - P0.np) - (P0.mt - P0.mp)); wsum += wgt;
  }
  fprintf(stderr, "n %d, %d positions: take-now bias %+.4f, pass bias %+.4f, (take - pass) bias %+.4f (near the boundary: %+.4f)\n", n, cnt, bt / cnt, bp / cnt, bd / cnt, wbd / wsum);
  return 0;
}

// ./fvi advgrad: numerical gradient check of AdvHead::backward
static int advGradMain(){
  AdvHead A(36, 5); Rng r(9); for (auto& w : A.p) w = (float)(r() - 0.5) * 0.4f;
  vector<float> x(A.I); for (auto& v : x) v = (float)(r() * 2 - 1);
  float h[512]; A.forward(x.data(), h); vector<float> g(A.n, 0); A.backward(x.data(), h, 1.0, g.data());
  double md = 0;
  for (int k = 0; k < A.n; k += 37){ float o = A.p[k]; A.p[k] = o + 1e-3f; double a = A.forward(x.data(), h); A.p[k] = o - 1e-3f; double b = A.forward(x.data(), h); A.p[k] = o;
    md = max(md, fabs((a - b) / 2e-3 - g[k])); }
  printf("advgrad: max |numeric - analytic| %.2e\n", md); return 0;
}
