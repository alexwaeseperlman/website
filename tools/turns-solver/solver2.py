import math, itertools
from collections import deque
EPS=2e-3
def key(p): return (round(p[0],3)+0.0, round(p[1],3)+0.0)
def rot(p,c,th):
    x,y=p[0]-c[0],p[1]-c[1]; cs,sn=math.cos(th),math.sin(th)
    return (x*cs-y*sn+c[0], x*sn+y*cs+c[1])
def refl(p,c,phi):  # axis through c with direction angle phi
    x,y=p[0]-c[0],p[1]-c[1]; cs,sn=math.cos(2*phi),math.sin(2*phi)
    return (x*cs+y*sn+c[0], x*sn-y*cs+c[1])
def find(pts,idx,q):
    for j in idx:
        if abs(pts[j][0]-q[0])<EPS and abs(pts[j][1]-q[1])<EPS: return j
    return None
def centroid(pts,idx):
    return (sum(pts[i][0] for i in idx)/len(idx), sum(pts[i][1] for i in idx)/len(idx))

ROT={'r90':90,'r-90':-90,'r180':180,'r120':120,'r-120':-120,'r72':72,'r-72':-72,'r60':60,'r-60':-60}

def rot_perm(pts,idx,deg):
    c=centroid(pts,idx); th=math.radians(deg); perm={}
    for i in idx:
        j=find(pts,idx,rot(pts[i],c,th))
        if j is None: return None
        perm[i]=j
    if all(perm[i]==i for i in idx): return None
    return perm
def rot_order(pts,idx):
    c=centroid(pts,idx)
    off=sum(1 for i in idx if math.hypot(pts[i][0]-c[0],pts[i][1]-c[1])>EPS)
    for n in range(off,1,-1):
        if off%n: continue
        if rot_perm(pts,idx,360/n): return n
    return 0
def min_rot(pts,idx,sign):
    n=rot_order(pts,idx)
    return rot_perm(pts,idx,sign*360/n) if n else None
MINROT={'ccw':1,'cw':-1}
ADD_ORDERS=(2,3,4,5,6)
def mirror_axes(pts,idx):
    c=centroid(pts,idx); cands=[]
    for i in idx:
        dx,dy=pts[i][0]-c[0],pts[i][1]-c[1]
        if math.hypot(dx,dy)>EPS: cands.append(math.atan2(dy,dx)%math.pi)
    for a,b in itertools.combinations(idx,2):
        dx,dy=pts[b][0]-pts[a][0],pts[b][1]-pts[a][1]
        cands.append((math.atan2(dy,dx)+math.pi/2)%math.pi)
    out=[]
    for phi in sorted(cands):
        if any(abs(phi-o)<1e-3 or abs(abs(phi-o)-math.pi)<1e-3 for o,_ in out): continue
        perm={}
        ok=True
        for i in idx:
            j=find(pts,idx,refl(pts[i],c,phi))
            if j is None: ok=False;break
            perm[i]=j
        if ok and not all(perm[i]==i for i in idx): out.append((phi,perm))
    return out

def completions(pts,idx,tools,budget):
    """ways to add <=budget new points so selection gains a symmetry usable by a tool"""
    S=[pts[i] for i in idx]; allk=set(key(p) for p in pts); Sk=set(key(p) for p in S)
    res={}
    def closure(gen):
        cur=list(S); seen=set(Sk); changed=True
        while changed:
            changed=False
            for p in list(cur):
                q=gen(p); k=key(q)
                if k not in seen:
                    seen.add(k); cur.append(q); changed=True
                    if len(cur)-len(S)>budget: return None
        return [p for p in cur if key(p) not in Sk]
    rot_angles=[]
    for t in tools:
        if t in ROT: rot_angles.append(ROT[t])
        if t in MINROT: rot_angles+= [360/n for n in ADD_ORDERS]
    rot_angles=list(dict.fromkeys(rot_angles))
    for t in rot_angles+[x for x in tools if x=='m']:
        if t!='m':
            base_th=math.radians(t); order=round(360/abs(t))
            for (kk,(a,b)) in itertools.product(range(1,order),itertools.permutations(range(len(S)),2)):
                th=base_th*kk; c_,s_=math.cos(th),math.sin(th)
                # c = (I-R)^-1 (b - R a)
                A,B=S[a],S[b]
                rx,ry=A[0]*c_-A[1]*s_, A[0]*s_+A[1]*c_
                vx,vy=B[0]-rx,B[1]-ry
                m00,m01,m10,m11=1-c_,s_,-s_,1-c_
                det=m00*m11-m01*m10
                if abs(det)<1e-9: continue
                cx=( m11*vx-m01*vy)/det; cy=(-m10*vx+m00*vy)/det
                new=closure(lambda p:rot(p,(cx,cy),base_th))
                if new: _add(res,new,allk,('rot',t,(cx,cy)))
        if t=='m':
            for a,b in itertools.combinations(range(len(S)),2):
                A,B=S[a],S[b]
                mid=((A[0]+B[0])/2,(A[1]+B[1])/2)
                phi_perp=(math.atan2(B[1]-A[1],B[0]-A[0])+math.pi/2)
                phi_line=math.atan2(B[1]-A[1],B[0]-A[0])
                for (c,phi) in [(mid,phi_perp),(A,phi_line)]:
                    new=closure(lambda p:refl(p,c,phi))
                    if new: _add(res,new,allk,('m',c,phi))
    return list(res.values())
def _add(res,new,allk,info):
    ks=tuple(sorted(key(p) for p in new))
    if any(k in allk for k in ks): return   # would land on an existing unselected dot
    if ks not in res: res[ks]=([ (k[0],k[1]) for k in ks],info)

def components(n,links):
    par=list(range(n))
    def f(x):
        while par[x]!=x: par[x]=par[par[x]]; x=par[x]
        return x
    for a,b in links: par[f(a)]=f(b)
    comps={}
    for i in range(n): comps.setdefault(f(i),[]).append(i)
    return list(comps.values())

def selections(n,links,arrows):
    """all selections closed under links (both ways) and arrows (tail -> head)"""
    if not arrows:
        comps=components(n,links)
        for m in range(1,1<<len(comps)):
            yield sorted(i for c in range(len(comps)) if m>>c&1 for i in comps[c])
        return
    out=[[] for _ in range(n)]
    for a,b in links: out[a].append(b); out[b].append(a)
    for a,b in arrows: out[a].append(b)
    fwd=[]
    for i in range(n):
        seen={i}; st=[i]
        while st:
            x=st.pop()
            for y in out[x]:
                if y not in seen: seen.add(y); st.append(y)
        fwd.append(sum(1<<y for y in seen))
    for m in range(1,1<<n):
        ok=True; mm=m
        while mm:
            i=(mm&-mm).bit_length()-1; mm&=mm-1
            if fwd[i]&~m: ok=False; break
        if ok: yield [i for i in range(n) if m>>i&1]
def gen_moves(pts,links,tools,budget_left,arrows=()):
    # FASTPATH: rotation-only levels use the orbit-based generator (validated equal)
    if all(t in MINROT for t in tools):
        import fast
        return fast.fast_moves(pts,list(links),tools,tuple(arrows))
    moves=[]
    for idx in selections(len(pts),links,arrows):
        if len(idx)<3:
            if 'add' in tools and budget_left>0 and len(idx)>=2:
                pass
            else: continue
        if len(idx)>=3:
            for t in tools:
                if t in MINROT:
                    p=min_rot(pts,idx,MINROT[t])
                    if p: moves.append(('perm',t,idx,p))
                elif t in ROT:
                    p=rot_perm(pts,idx,ROT[t])
                    if p: moves.append(('perm',t,idx,p))
                elif t=='m':
                    for phi,p in mirror_axes(pts,idx): moves.append(('perm','m',idx,p))
        if 'add' in tools and budget_left>0 and len(idx)>=2:
            for new,info in completions(pts,idx,[t for t in tools if t!='add'],budget_left):
                moves.append(('add',info,idx,new))
    return moves

def solve(level,maxd=12,verbose=False):
    """links belong to the pieces: a move carries each link along with its endpoints"""
    base=[tuple(p) for p in level['pts']]
    tools=level['tools']; budget=level.get('budget',0)
    goal={i:c for i,c in level['goal']}
    L0=tuple(sorted(tuple(sorted(l)) for l in level.get('links',[])))
    A0=tuple(sorted(tuple(a) for a in level.get('arrows',[])))
    start=((),tuple(x or 0 for x in level['start']),(L0,A0))
    def done(s): return all(s[1][i]==c for i,c in goal.items())
    cache={}
    prev={start:None}; q=deque([start]); dep={start:0}
    if done(start): return 0,[]
    while q:
        s=q.popleft()
        if dep[s]>=maxd: continue
        extra,cols,(links,arrows)=s
        pts=base+list(extra)
        ck=(extra,links,arrows)
        if ck not in cache: cache[ck]=gen_moves(pts,list(links),tools,budget-len(extra),arrows)
        for mv in cache[ck]:
            if mv[0]=='perm':
                _,t,idx,p=mv; nc=list(cols)
                for i in idx: nc[p[i]]=cols[i]
                nl=tuple(sorted(tuple(sorted((p.get(a,a),p.get(b,b)))) for a,b in links))
                na=tuple(sorted((p.get(a,a),p.get(b,b)) for a,b in arrows))
                ns=(extra,tuple(nc),(nl,na))
            else:
                _,info,idx,new=mv
                ns=(extra+tuple(key(p) for p in new), cols+tuple(0 for _ in new), (links,arrows))
            if ns in prev: continue
            prev[ns]=(s,mv); dep[ns]=dep[s]+1
            if done(ns):
                path=[];cur=ns
                while prev[cur]: path.append(prev[cur][1]); cur=prev[cur][0]
                return dep[ns],path[::-1]
            q.append(ns)
    return None,None
