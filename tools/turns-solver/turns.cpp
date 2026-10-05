// Fast solver for Turns: minimal rotations (ccw/cw), mirrors with optional flip budget, links and arrows.
// Input (stdin):
//   mode            "explore" | "solve"
//   n  then n lines "x y"
//   ccw cw m mbudget          (mbudget -1 = unlimited)
//   T  then T lines "pos color"   (tracked pieces; color 0 = black piece that carries a link/arrow)
//   nl then nl lines "i j"        (links between tracked pieces i,j)
//   na then na lines "i j"        (arrow i -> j)
//   [solve] ng then ng lines "pos color"
// Output: explore -> "moves M\nmaxdepth D\nstates S\n" then lines "depth pos_r pos_g pos_y" for configs at max depth (up to 50)
//         solve   -> "par D" then one line per move "size type" (type 0 turn, 1 flip)
#include <bits/stdc++.h>
using namespace std;
typedef unsigned long long u64;
int n; vector<double> X, Y;
const double EPS = 2e-3;
unordered_map<long long,int> where;
long long kq(double x, double y){ return (long long)llround(x*1000)*1000003LL + llround(y*1000); }
int at(double x, double y){
  for (int dx=-1;dx<=1;dx++) for (int dy=-1;dy<=1;dy++){
    auto it = where.find(kq(x+dx*0.001, y+dy*0.001));
    if (it != where.end() && fabs(X[it->second]-x)<EPS && fabs(Y[it->second]-y)<EPS) return it->second;
  }
  return -1;
}
struct Move { u64 mask; vector<unsigned char> perm; int type; double phi=0; int dir=1; };   // type 0 rotation, 1 flip
vector<Move> moves;

void centroid(u64 m, double&cx, double&cy){ cx=cy=0; int c=0; for(int i=0;i<n;i++) if(m>>i&1){cx+=X[i];cy+=Y[i];c++;} cx/=c; cy/=c; }
bool rotperm(u64 m, double cx, double cy, double th, vector<unsigned char>&p){
  p.assign(n,0); for(int i=0;i<n;i++) p[i]=i;
  double cs=cos(th), sn=sin(th); bool moved=false;
  for(int i=0;i<n;i++) if(m>>i&1){
    double x=X[i]-cx, y=Y[i]-cy; int j=at(x*cs-y*sn+cx, x*sn+y*cs+cy);
    if(j<0 || !(m>>j&1)) return false; p[i]=j; if(j!=i) moved=true;
  }
  return moved;
}
int rotOrder(u64 m){
  int cnt=__builtin_popcountll(m); if(cnt<3) return 0;
  double cx,cy; centroid(m,cx,cy); int off=0;
  for(int i=0;i<n;i++) if(m>>i&1) if(hypot(X[i]-cx,Y[i]-cy)>EPS) off++;
  vector<unsigned char> p;
  for(int k=off;k>=2;k--){ if(off%k) continue; if(rotperm(m,cx,cy,2*M_PI/k,p)) return k; }
  return 0;
}
bool reflperm(u64 m, double cx, double cy, double phi, vector<unsigned char>&p){
  p.assign(n,0); for(int i=0;i<n;i++) p[i]=i;
  double cs=cos(2*phi), sn=sin(2*phi); bool moved=false;
  for(int i=0;i<n;i++) if(m>>i&1){
    double x=X[i]-cx, y=Y[i]-cy; int j=at(x*cs+y*sn+cx, x*sn-y*cs+cy);
    if(j<0 || !(m>>j&1)) return false; p[i]=j; if(j!=i) moved=true;
  }
  return moved;
}
int main(){
  ios::sync_with_stdio(false);
  string mode; cin>>mode; cin>>n; X.resize(n); Y.resize(n);
  for(int i=0;i<n;i++){ cin>>X[i]>>Y[i]; where[kq(X[i],Y[i])]=i; }
  int ccw,cw,mm,mb; cin>>ccw>>cw>>mm>>mb;
  int T; cin>>T; vector<int> tpos(T), tcol(T); for(int i=0;i<T;i++) cin>>tpos[i]>>tcol[i];
  int nl; cin>>nl; vector<pair<int,int>> links(nl); for(auto&l:links) cin>>l.first>>l.second;
  int na; cin>>na; vector<pair<int,int>> arrows(na); for(auto&a:arrows) cin>>a.first>>a.second;
  vector<pair<int,int>> goal; if(mode=="solve"){ int ng; cin>>ng; goal.resize(ng); for(auto&g:goal) cin>>g.first>>g.second; }

  // ---- rotation moves: unions of full orbits about candidate centres
  set<u64> rotMasks;
  if(ccw||cw) for(int k=2;k<=8;k++){
    double th=2*M_PI/k, cs=cos(th), sn=sin(th);
    set<pair<long long,long long>> seenC;
    for(int a=0;a<n;a++) for(int b=0;b<n;b++){ if(a==b) continue;
      double rx=X[b]-(cs*X[a]-sn*Y[a]), ry=Y[b]-(sn*X[a]+cs*Y[a]);
      double m00=1-cs,m01=sn,m10=-sn,m11=1-cs,det=m00*m11-m01*m10;
      double cx=(m11*rx-m01*ry)/det, cy=(-m10*rx+m00*ry)/det;
      if(!seenC.insert({llround(cx*1000),llround(cy*1000)}).second) continue;
      int ci=at(cx,cy); vector<u64> orb; u64 used=0;
      for(int i=0;i<n;i++){ if(i==ci||(used>>i&1)) continue; u64 o=1ULL<<i; double x=X[i],y=Y[i]; bool ok=true;
        for(int t=1;t<k;t++){ double dx=x-cx,dy=y-cy; x=cx+dx*cs-dy*sn; y=cy+dx*sn+dy*cs; int j=at(x,y); if(j<0){ok=false;break;} o|=1ULL<<j; }
        if(ok){ used|=o; orb.push_back(o); } }
      int m=orb.size(); if(m>20) { fprintf(stderr,"too many orbits\n"); return 1; }
      for(int s=1;s<(1<<m);s++){ u64 u=0; for(int t=0;t<m;t++) if(s>>t&1) u|=orb[t];
        for(int wc=0;wc<=(ci>=0);wc++){ u64 v=u|(wc?(1ULL<<ci):0); if(__builtin_popcountll(v)>=3) rotMasks.insert(v); } }
    }
  }
  for(u64 m:rotMasks){ int k=rotOrder(m); if(!k) continue; double cx,cy; centroid(m,cx,cy);
    Move mv; mv.mask=m; mv.type=0;
    if(ccw && rotperm(m,cx,cy, 2*M_PI/k, mv.perm)) moves.push_back(mv);
    if(cw && k>2 && rotperm(m,cx,cy,-2*M_PI/k, mv.perm)){ mv.dir=-1; moves.push_back(mv); }
    else if(cw && k==2 && !ccw && rotperm(m,cx,cy,-2*M_PI/k, mv.perm)){ mv.dir=-1; moves.push_back(mv); } }
  // ---- mirror moves: unions of swapped pairs and fixed points for each axis
  if(mm){
    set<tuple<long long,long long>> seenAx; set<pair<u64,long long>> seenMv;
    for(int a=0;a<n;a++) for(int b=a+1;b<n;b++){
      double mx=(X[a]+X[b])/2, my=(Y[a]+Y[b])/2, phi=fmod(atan2(Y[b]-Y[a],X[b]-X[a])+M_PI/2+2*M_PI, M_PI);
      if(fabs(phi-M_PI)<1e-6) phi=0;
      double nx=-sin(phi), ny=cos(phi), off=nx*mx+ny*my;       // axis: points with n.p = off
      if(!seenAx.insert({llround(phi*1e4), llround(off*1e3)}).second) continue;
      double cs=cos(2*phi), sn=sin(2*phi); vector<u64> pairs, fixedp; u64 used=0;
      for(int i=0;i<n;i++){ if(used>>i&1) continue; double x=X[i]-mx,y=Y[i]-my; int j=at(x*cs+y*sn+mx, x*sn-y*cs+my);
        if(j<0) continue; used|=(1ULL<<i)|(1ULL<<j); if(j==i) fixedp.push_back(1ULL<<i); else pairs.push_back((1ULL<<i)|(1ULL<<j)); }
      int P=pairs.size(), F=fixedp.size(); if(P+F>22){ fprintf(stderr,"too many mirror orbits\n"); return 1; }
      for(int s=1;s<(1<<P);s++){ u64 u=0; for(int t=0;t<P;t++) if(s>>t&1) u|=pairs[t];
        for(int f=0;f<(1<<F);f++){ u64 v=u; for(int t=0;t<F;t++) if(f>>t&1) v|=fixedp[t];
          if(__builtin_popcountll(v)<3) continue;
          if(!seenMv.insert({v,llround(phi*1e4)}).second) continue;
          double cx,cy; centroid(v,cx,cy); Move mv; mv.mask=v; mv.type=1; mv.phi=phi;
          if(reflperm(v,cx,cy,phi,mv.perm)) moves.push_back(mv); } }
    }
  }
  int M=moves.size();
  // ---- BFS over tracked positions (+ flips used)
  int FB = mb<0 ? 1 : mb+1;
  long long S=FB; for(int i=0;i<T;i++) S*=n;
  bool dense = S <= 200000000LL;
  vector<signed char> dv; unordered_map<long long,signed char> dm;
  if(dense) dv.assign(S,-1);
  auto getd=[&](long long s)->int{ if(dense) return dv[s]; auto it=dm.find(s); return it==dm.end()?-1:it->second; };
  auto setd=[&](long long s,int d){ if(dense) dv[s]=d; else dm[s]=d; };
  // solve: back[s] = (previous state, move, total dots so far). Ties on move count go to fewer total dots:
  // BFS finishes a whole layer before the next, so a state's cost is final before it is expanded.
  struct Back{ long long prev; int mi; int cost; };
  unordered_map<long long,Back> back; bool solve=(mode=="solve");
  auto enc=[&](const int*p,int f){ long long s=0; for(int i=0;i<T;i++) s=s*n+p[i]; return s*FB+f; };
  auto dec=[&](long long s,int*p,int&f){ f=s%FB; s/=FB; for(int i=T-1;i>=0;i--){ p[i]=s%n; s/=n; } };
  int cur[16], nxt[16]; long long s0=enc(tpos.data(),0); setd(s0,0);
  vector<long long> q{s0}; size_t h=0; long long found=-1; int goalDepth=-1; vector<long long> goals;
  if(solve) back[s0]={-1,-1,0};
  auto isGoal=[&](const int*p){ for(auto&g:goal){ bool ok=false; for(int i=0;i<T;i++) if(tcol[i]==g.second && p[i]==g.first) ok=true; if(!ok) return false; } return true; };
  if(solve && isGoal(tpos.data())) found=s0;
  while(h<q.size() && found<0){
    long long s=q[h]; int f; dec(s,cur,f); int d=getd(s);
    if(goalDepth>=0 && d>=goalDepth) break;     // the goal layer is complete
    h++;
    int cs = solve ? back[s].cost : 0;
    u64 occ=0; for(int i=0;i<T;i++) occ|=1ULL<<cur[i];
    for(int mi=0;mi<M;mi++){ const Move&mv=moves[mi]; u64 m=mv.mask;
      if(!(m&occ)) continue;
      if(mv.type==1 && mb>=0 && f>=mb) continue;
      bool ok=true;
      for(auto&l:links) if(((m>>cur[l.first])&1)!=((m>>cur[l.second])&1)){ok=false;break;}
      if(!ok) continue;
      for(auto&a:arrows) if(((m>>cur[a.first])&1) && !((m>>cur[a.second])&1)){ok=false;break;}
      if(!ok) continue;
      for(int i=0;i<T;i++) nxt[i]=mv.perm[cur[i]];
      int nf=f+(mv.type==1 && mb>=0); long long ns=enc(nxt,nf);
      int nc = cs + __builtin_popcountll(m), dn = getd(ns);
      if(dn>=0){ if(solve && dn==d+1 && nc<back[ns].cost) back[ns]={s,mi,nc}; continue; }
      setd(ns,d+1); q.push_back(ns);
      if(solve){ back[ns]={s,mi,nc}; if(isGoal(nxt)){ goals.push_back(ns); goalDepth=d+1; } }
    }
  }
  if(solve && found<0 && !goals.empty()){
    found=goals[0]; for(long long g:goals) if(back[g].cost<back[found].cost) found=g;
  }
  if(solve){
    if(found<0){ printf("par -1\n"); return 0; }
    vector<int> path; for(long long s=found;s!=s0;s=back[s].prev) path.push_back(back[s].mi);
    reverse(path.begin(),path.end()); printf("par %d\n",(int)path.size());
    for(int mi:path) printf("%d %d %llu %d %.6f\n",__builtin_popcountll(moves[mi].mask),moves[mi].type,(unsigned long long)moves[mi].mask,moves[mi].dir,moves[mi].phi);
    return 0;
  }
  // explore: best depth per colored configuration (r,g,y positions)
  map<vector<int>,int> best; int mx=0;
  for(long long s:q){ int f; dec(s,cur,f); vector<int> key; for(int c=1;c<=3;c++) for(int i=0;i<T;i++) if(tcol[i]==c) key.push_back(cur[i]);
    auto it=best.find(key); int d=getd(s); if(it==best.end()||d<it->second) best[key]=d; }
  for(auto&kv:best) mx=max(mx,kv.second);
  printf("moves %d\nmaxdepth %d\nstates %zu\n",M,mx,q.size()); int shown=0;
  for(auto&kv:best) if(kv.second==mx && shown<50){ printf("%d",kv.second); for(int x:kv.first) printf(" %d",x); printf("\n"); shown++; }
  vector<int> hist(mx+1,0); for(auto&kv:best) hist[kv.second]++; printf("hist"); for(int x:hist) printf(" %d",x); printf("\n");
}
