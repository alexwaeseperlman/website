// Piece-centric solver for big boards (turns only). A move = (centre, order k, direction, which tracked
// pieces' orbits turn). Black orbits are padding, chosen so the selection's minimal turn is exactly 360/k.
// Input: mode(explore|solve) timelimit_s | n | n lines x y | ccw cw | T + T lines "pos color" | nl links | na arrows | [ng goal]
// Output solve:   "par D" then per move "size 0 mask dir 0"
// Output explore: "maxdepth D", "states S", "complete 0|1", up to 50 lines "depth r g y", "hist ..."
#include <bits/stdc++.h>
using namespace std;
typedef unsigned long long u64;
int n; vector<double> X, Y; const double EPS=2e-3;
unordered_map<long long,int> where;
long long kq(double x,double y){ return llround(x*1000)*1000003LL+llround(y*1000); }
int at(double x,double y){ for(int dx=-1;dx<=1;dx++) for(int dy=-1;dy<=1;dy++){ auto it=where.find(kq(x+dx*1e-3,y+dy*1e-3));
  if(it!=where.end()&&fabs(X[it->second]-x)<EPS&&fabs(Y[it->second]-y)<EPS) return it->second; } return -1; }
bool rotOK(u64 m,double cx,double cy,double th){ double cs=cos(th),sn=sin(th);
  for(int i=0;i<n;i++) if(m>>i&1){ double x=X[i]-cx,y=Y[i]-cy; int j=at(x*cs-y*sn+cx,x*sn+y*cs+cy); if(j<0||!(m>>j&1)) return false; } return true; }
int rotOrder(u64 m){ int c=__builtin_popcountll(m); if(c<3) return 0; double cx=0,cy=0; for(int i=0;i<n;i++) if(m>>i&1){cx+=X[i];cy+=Y[i];} cx/=c; cy/=c;
  int off=0; for(int i=0;i<n;i++) if(m>>i&1) if(hypot(X[i]-cx,Y[i]-cy)>EPS) off++;
  for(int k=off;k>=2;k--){ if(off%k) continue; if(rotOK(m,cx,cy,2*M_PI/k)) return k; } return 0; }
struct Cen{ double cx,cy; int k,ci; vector<int> orb; vector<u64> om; vector<int> fwd,bwd; vector<int> padOrder; };
vector<Cen> C; int fixK=0;
struct KeyH{ size_t operator()(const array<u64,3>&a)const{ return a[0]*1000003ULL^a[1]*998244353ULL^a[2]*0x9E3779B97F4A7C15ULL; } };
unordered_map<array<u64,3>,u64,KeyH> cache;
// chosen: orbit bitset; forb: forbidden orbit bitset; cflag: 0 centre must be out, 1 must be in, 2 free
u64 feasible(int c,u64 chosen,u64 forb,int cflag){
  array<u64,3> key{(u64)c,chosen,forb*4+cflag}; auto it=cache.find(key); if(it!=cache.end()) return it->second;
  Cen&Z=C[c]; u64 base=0; for(size_t o=0;o<Z.om.size();o++) if(chosen>>o&1) base|=Z.om[o];
  vector<u64> pads; for(int o:Z.padOrder){ if((chosen>>o&1)||(forb>>o&1)) continue; pads.push_back(Z.om[o]); if(pads.size()>=8) break; }
  vector<u64> cvar; if(cflag!=1) cvar.push_back(0); if(cflag!=0 && Z.ci>=0) cvar.push_back(1ULL<<Z.ci); if(cflag==1 && Z.ci<0){ cache[key]=0; return 0; }
  u64 best=0; int bestc=999;
  auto tryS=[&](u64 S){ int pc=__builtin_popcountll(S); if(pc<3||pc>=bestc) return; if(fixK ? rotOK(S,Z.cx,Z.cy,2*M_PI/Z.k) : rotOrder(S)==Z.k){ best=S; bestc=pc; } };
  for(u64 cv:cvar){ tryS(base|cv); }
  if(!best) for(u64 cv:cvar) for(size_t a=0;a<pads.size();a++) tryS(base|cv|pads[a]);
  if(!best) for(u64 cv:cvar) for(size_t a=0;a<pads.size();a++) for(size_t b=a+1;b<pads.size();b++) tryS(base|cv|pads[a]|pads[b]);
  cache[key]=best; return best;
}
int main(){
  string mode; double tl; cin>>mode>>tl; cin>>n; X.resize(n); Y.resize(n);
  if(n>64){ fprintf(stderr,"n>64\n"); return 1; }
  for(int i=0;i<n;i++){ cin>>X[i]>>Y[i]; where[kq(X[i],Y[i])]=i; }
  int ccw,cw; cin>>ccw>>cw; double tiltStep; cin>>tiltStep; cin>>fixK; int T; cin>>T; vector<int> tp(T),tc(T); for(int i=0;i<T;i++) cin>>tp[i]>>tc[i];
  int nl; cin>>nl; vector<pair<int,int>> L(nl); for(auto&l:L) cin>>l.first>>l.second;
  int na; cin>>na; vector<pair<int,int>> A(na); for(auto&a:A) cin>>a.first>>a.second;
  vector<pair<int,int>> goal; if(mode=="solve"){ int ng; cin>>ng; goal.resize(ng); for(auto&g:goal) cin>>g.first>>g.second; }
  // centres
  set<tuple<int,long long,long long>> seen;
  for(int k=2;k<=8;k++){ if(fixK && k!=fixK) continue; double th=2*M_PI/k,cs=cos(th),sn=sin(th);
    for(int a=0;a<n;a++) for(int b=0;b<n;b++){ if(a==b) continue;
      double rx=X[b]-(cs*X[a]-sn*Y[a]), ry=Y[b]-(sn*X[a]+cs*Y[a]); double m00=1-cs,m01=sn,m10=-sn,m11=1-cs,det=m00*m11-m01*m10;
      double cx=(m11*rx-m01*ry)/det, cy=(-m10*rx+m00*ry)/det;
      if(!seen.insert({k,llround(cx*1000),llround(cy*1000)}).second) continue;
      Cen Z; Z.cx=cx; Z.cy=cy; Z.k=k; Z.ci=at(cx,cy); Z.orb.assign(n,-1); Z.fwd.resize(n); Z.bwd.resize(n);
      for(int i=0;i<n;i++){ Z.fwd[i]=Z.bwd[i]=i; }
      for(int i=0;i<n;i++){ if(i==Z.ci||Z.orb[i]>=0) continue; vector<int> o{i}; double x=X[i],y=Y[i]; bool ok=true;
        for(int t=1;t<k;t++){ double dx=x-cx,dy=y-cy; x=cx+dx*cs-dy*sn; y=cy+dx*sn+dy*cs; int j=at(x,y); if(j<0){ok=false;break;} o.push_back(j); }
        if(!ok) continue; if(Z.om.size()>=63) break;
        if(tiltStep>0 && k>=3){ double ang=atan2(Y[o[1]]-Y[o[0]],X[o[1]]-X[o[0]])*180/M_PI; double r=fmod(fmod(ang,tiltStep)+tiltStep,tiltStep);
          if(min(r,tiltStep-r)>0.5) continue; }
        int id=Z.om.size(); u64 m=0;
        for(size_t t=0;t<o.size();t++){ Z.orb[o[t]]=id; m|=1ULL<<o[t]; Z.fwd[o[t]]=o[(t+1)%k]; Z.bwd[o[t]]=o[(t+k-1)%k]; }
        Z.om.push_back(m); }
      if(Z.om.empty()) continue; if((int)Z.om.size()*k+(Z.ci>=0)<3) continue;
      vector<pair<double,int>> dd; for(size_t o=0;o<Z.om.size();o++){ int p=__builtin_ctzll(Z.om[o]); dd.push_back({hypot(X[p]-cx,Y[p]-cy),(int)o}); }
      sort(dd.begin(),dd.end()); for(auto&d:dd) Z.padOrder.push_back(d.second);
      C.push_back(Z); } }
  // ---- centre index: which centres give each dot a complete orbit
  vector<vector<int>> ptC(n); for(int c=0;c<(int)C.size();c++) for(int i=0;i<n;i++) if(C[c].orb[i]>=0) ptC[i].push_back(c);
  vector<int> stamp(C.size(),-1); int stampv=0;
  auto enc=[&](const int*p){ long long s=0; for(int i=0;i<T;i++) s=s*n+p[i]; return s; };
  auto dec=[&](long long s,int*p){ for(int i=T-1;i>=0;i--){ p[i]=s%n; s/=n; } };
  // expand(state, dirSign, cb(next, mask, dir)): dirSign=+1 forward moves, -1 their inverses (for backward search)
  auto expand=[&](long long s,int dsign,auto&&cb){
    int cur[64],nxt[64]; dec(s,cur); stampv++;
    for(int t=0;t<T;t++) for(int c:ptC[cur[t]]){ if(stamp[c]==stampv) continue; stamp[c]=stampv; Cen&Z=C[c];
      int oid[64]; bool atc[64]; u64 U=0;
      for(int i=0;i<T;i++){ atc[i]=(cur[i]==Z.ci); oid[i]=atc[i]?-2:Z.orb[cur[i]]; if(oid[i]>=0) U|=1ULL<<oid[i]; }
      int ids[64],m=0; for(u64 u=U;u;u&=u-1) ids[m++]=__builtin_ctzll(u);
      if(m>20) m=20;
      for(int sub=1;sub<(1<<m);sub++){ u64 chosen=0; for(int t2=0;t2<m;t2++) if(sub>>t2&1) chosen|=1ULL<<ids[t2];
        u64 forb=U&~chosen; bool in[64];
        for(int cflag=0;cflag<2;cflag++){
          bool anyC=false; for(int i=0;i<T;i++){ if(atc[i]){ in[i]=cflag; anyC=true; } else in[i]=oid[i]>=0&&(chosen>>oid[i]&1); }
          if(cflag==1&&!anyC) break;
          bool ok=true; for(auto&l:L) if(in[l.first]!=in[l.second]){ok=false;break;}
          if(ok) for(auto&a:A) if(in[a.first]&&!in[a.second]){ok=false;break;}
          if(ok){ u64 Sm=feasible(c,chosen,forb,anyC?cflag:2);
            if(Sm) for(int dir=1;dir>=-1;dir-=2){
              if(dir==1&&!ccw) continue; if(dir==-1&&(!cw||(Z.k==2&&ccw))) continue;
              int d2=dir*dsign;   // actual rotation applied to this state
              for(int i=0;i<T;i++) nxt[i]= in[i]&&!atc[i] ? (d2==1?Z.fwd[cur[i]]:Z.bwd[cur[i]]) : cur[i];
              if(cb(enc(nxt),Sm,dir)) return true; } }
          if(!anyC) break; } } }
    return false; };
  auto isGoal=[&](const int*p){ for(auto&g:goal){ bool ok=false; for(int i=0;i<T;i++) if(tc[i]==g.second&&p[i]==g.first) ok=true; if(!ok) return false; } return true; };
  auto t0=chrono::steady_clock::now(); auto el=[&]{ return chrono::duration<double>(chrono::steady_clock::now()-t0).count(); };
  long long s0=enc(tp.data());
  if(mode=="walk"){   // tl = walk length; next input token = seed, then number of walks
    unsigned seed; int nw; cin>>seed>>nw; mt19937 rng(seed); int len=(int)tl;
    for(int w=0;w<nw;w++){ long long s=s0; unordered_set<long long> vis{s0};
      for(int st=0;st<len;st++){ vector<long long> nb; expand(s,1,[&](long long ns,u64,int){ if(!vis.count(ns)) nb.push_back(ns); return false; });
        if(nb.empty()) break; s=nb[rng()%nb.size()]; vis.insert(s); }
      int cur[64]; dec(s,cur); for(int c=1;c<=3;c++) for(int j=0;j<T;j++) if(tc[j]==c) printf("%d ",cur[j]); printf("\n"); }
    return 0; }
  if(mode=="solve"){
    // bidirectional BFS: forward from start, backward from every state that satisfies the goal
    // state -> (neighbour toward root, move, depth, total dots from root). Within a layer, ties on depth go to
    // fewer dots; whole layers are expanded at once, so each state's cost is final before it is expanded.
    struct NV{ long long par; u64 m; int dir; int dep; int cost; }; unordered_map<long long,NV> F,B;
    F[s0]={-1,0,0,0,0}; vector<long long> fq{s0}, bq;
    { // goal states: coloured pieces fixed, uncoloured tracked pieces anywhere free
      vector<int> p(T,-1); u64 used=0; bool ok=true;
      for(int i=0;i<T;i++) if(tc[i]){ int pos=-1; for(auto&g:goal) if(g.second==tc[i]) pos=g.first;
        if(pos<0){ fprintf(stderr,"coloured piece without goal\n"); return 1; } p[i]=pos; used|=1ULL<<pos; }
      vector<int> fr; for(int i=0;i<T;i++) if(p[i]<0) fr.push_back(i);
      function<void(int,u64)> rec=[&](int k,u64 us){ if(k==(int)fr.size()){ long long e=enc(p.data()); B[e]={-1,0,0,0,0}; bq.push_back(e); return; }
        for(int q=0;q<n;q++) if(!(us>>q&1)){ p[fr[k]]=q; rec(k+1,us|1ULL<<q); } p[fr[k]]=-1; };
      rec(0,used); (void)ok; }
    long long meet=-1; if(B.count(s0)) meet=s0;
    int fd=0,bd=0;
    while(meet<0 && !fq.empty() && !bq.empty()){
      if(el()>tl){ printf("par -1\ntimeout\n"); return 0; }
      bool fwd = fq.size()<=bq.size(); vector<long long> nq;
      auto&M = fwd?F:B; auto&O = fwd?B:F;
      int bestLen=INT_MAX;
      for(long long s:(fwd?fq:bq)){
        int dep=M[s].dep, cs=M[s].cost;
        expand(s, fwd?1:-1, [&](long long ns,u64 Sm,int dir){
          int nc=cs+__builtin_popcountll(Sm);
          auto mt=M.find(ns);
          if(mt!=M.end()){ if(mt->second.dep==dep+1 && nc<mt->second.cost) mt->second={s,Sm,dir,dep+1,nc}; return false; }
          M[ns]={s,Sm,dir,dep+1,nc}; nq.push_back(ns);
          auto it=O.find(ns); if(it!=O.end() && dep+1+it->second.dep<bestLen){ bestLen=dep+1+it->second.dep; meet=ns; } return false; }); }
      if(fwd){ fq.swap(nq); fd++; } else { bq.swap(nq); bd++; } }
    if(meet<0){ printf("par -1\n"); return 0; }
    { // every shortest path crosses some state seen from both sides with depths summing to par: take the cheapest
      int D=F[meet].dep+B[meet].dep, bestC=F[meet].cost+B[meet].cost;
      auto&Sm = F.size()<B.size()?F:B; auto&Lg = F.size()<B.size()?B:F;
      for(auto&kv:Sm){ auto it=Lg.find(kv.first); if(it==Lg.end()) continue;
        if(kv.second.dep+it->second.dep==D && kv.second.cost+it->second.cost<bestC){ bestC=kv.second.cost+it->second.cost; meet=kv.first; } } }
    vector<pair<u64,int>> path; for(long long s=meet; F[s].par!=-1; s=F[s].par) path.push_back({F[s].m,F[s].dir});
    reverse(path.begin(),path.end());
    for(long long s=meet; B[s].par!=-1; s=B[s].par) path.push_back({B[s].m,B[s].dir});
    printf("par %d\n",(int)path.size());
    for(auto&p:path) printf("%d 0 %llu %d 0\n",__builtin_popcountll(p.first),(unsigned long long)p.first,p.second);
    return 0; }
  // ---- explore: plain BFS from the start (dense table when it fits)
  long long S=1; for(int i=0;i<T;i++){ S*=n; if(S>4000000000LL) break; } bool dense=S<=200000000LL;
  vector<signed char> dv; unordered_map<long long,signed char> dm; if(dense) dv.assign(S,-1);
  auto getd=[&](long long s)->int{ if(dense) return dv[s]; auto it=dm.find(s); return it==dm.end()?-1:it->second; };
  auto setd=[&](long long s,int d){ if(dense) dv[s]=d; else dm[s]=d; };
  setd(s0,0); vector<long long> q{s0}; size_t h=0; bool complete=true;
  while(h<q.size()){
    if((h&255)==0 && el()>tl){ complete=false; break; }
    long long s=q[h++]; int d=getd(s);
    expand(s,1,[&](long long ns,u64,int){ if(getd(ns)<0){ setd(ns,d+1); q.push_back(ns); } return false; }); }
  int cur[64]; map<vector<int>,int> best; int mx=0;
  for(size_t i=0;i<h;i++){ long long s=q[i]; dec(s,cur); vector<int> key; for(int c=1;c<=3;c++) for(int j=0;j<T;j++) if(tc[j]==c) key.push_back(cur[j]);
    int d=getd(s); auto it=best.find(key); if(it==best.end()||d<it->second) best[key]=d; }
  for(auto&kv:best) mx=max(mx,kv.second);
  printf("maxdepth %d\nstates %zu\ncomplete %d\ncentres %zu\n",mx,q.size(),(int)complete,C.size()); int shown=0;
  for(auto&kv:best) if(kv.second==mx&&shown<50){ printf("%d",kv.second); for(int x:kv.first) printf(" %d",x); printf("\n"); shown++; }
  vector<int> hist(mx+1,0); for(auto&kv:best) hist[kv.second]++; printf("hist"); for(int x:hist) printf(" %d",x); printf("\n");
}
