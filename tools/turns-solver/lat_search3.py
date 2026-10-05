import json, random, time, math, sys
from lattices import BOARDS
import lat; lat.BIN='./lat2'
rng=random.Random(int(sys.argv[1])); budget=float(sys.argv[2]); out=open('lat_res3.txt','a')
POOL=['sq5']*2+['sq6']*3+['sq7']*2+['hex2']*2+['hex3']*3+['tri6','tri7']*2+['honey3']*2+['honey4']*2+['rh5','rh6']
def near(P,i,maxd): return [j for j in range(len(P)) if j!=i and math.dist(P[i],P[j])<=maxd+1e-6]
t0=time.time()
while time.time()-t0<budget:
    name=rng.choice(POOL); P=BOARDS[name]; n=len(P); md=min(math.dist(P[0],q) for q in P[1:])
    R=rng.choice([1.8,3.0,99])*md
    a=rng.randrange(n); nb=near(P,a,R); b=rng.choice(nb); nc=[j for j in near(P,b,R) if j!=a] or [j for j in nb if j!=b]
    if not nc: continue
    c=rng.choice(nc); st=[None]*n; st[a]='r'; st[b]='g'; st[c]='y'
    links=[]; arrows=[]; deco=[rng.choice([0,1,2,3,2,3]) for _ in range(3)]
    if not any(deco): deco[0]=2
    for (u,v),d in zip([(a,b),(b,c),(a,c)],deco):
        if d==1: links.append([u,v])
        elif d==2: arrows.append([u,v])
        elif d==3: arrows.append([v,u])
    nt=rng.choice([0,1,1,2]); used={a,b,c}
    for _ in range(nt):
        src=rng.choice([a,b,c]); far=sorted([j for j in range(n) if j not in used], key=lambda j:-math.dist(P[src],P[j]))
        cand=far[:max(3,len(far)//4)] if rng.random()<.7 else [j for j in near(P,src,1.8*md) if j not in used]
        if not cand: continue
        k=rng.choice(cand); used.add(k); kind=rng.choice(['link','in','out'])
        if kind=='link': links.append([src,k])
        elif kind=='in': arrows.append([k,src])
        else: arrows.append([src,k])
    tools=['cw'] if rng.random()<.35 else ['ccw','cw']
    lv=dict(pts=P,tools=tools,start=st,goal=[],links=links,arrows=arrows)
    T=len(used); rec=dict(board=name,start=st,links=links,arrows=arrows,tools=tools,T=T)
    try:
        if T<=4 and n**T<=40000000:
            d=lat.explore(lv,tl=40)
            if d.get('complete'):
                rec.update(method='exact',depth=d['maxdepth'],nmax=d['hist'][-1],goals=d.get('deep',[])[:5])
                out.write(json.dumps(rec)+'\n'); out.flush(); continue
        best=(-1,None)
        for g in lat.walks(lv,length=30,n=10,seed=rng.randrange(10**6)):
            if len(g)<3: continue
            lv['goal']=[[g[0],'r'],[g[1],'g'],[g[2],'y']]
            p,_=lat.solve(lv,tl=15)
            if p>best[0]: best=(p,g)
        rec.update(method='sampled',depth=best[0],goals=[best[1]])
        out.write(json.dumps(rec)+'\n'); out.flush()
    except Exception as e:
        pass
