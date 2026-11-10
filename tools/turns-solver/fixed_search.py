# Random search for levels built around fixed links/arrows (the ones that stay on the board).
# usage: python3 fixed_search.py <seed> <seconds>   -> appends JSON lines to results_fixed.jsonl
import json, random, sys, time
from chal_layouts import LAY
import cpp
HOUSE=[(0,0),(1,0),(1,1),(0,1),(.5,1.866)]
HINGE=[(0,0),(1,0),(1,1),(0,1),(1.866,1.5),(1.366,2.366),(.5,1.866)]
G3=[(x,y) for y in range(3) for x in range(3)]
PENT=[(0.0,-1.0),(0.9511,-0.309),(0.5878,0.809),(-0.5878,0.809),(-0.9511,-0.309),(-0.5,-1.866),(0.5,-1.866)]
B=dict(LAY, house=HOUSE, hinge=HINGE, g3=G3, pent=PENT); B.pop('flower',None)
rng=random.Random(int(sys.argv[1])); out=open('results_fixed.jsonl','a'); t0=time.time()
while time.time()-t0<float(sys.argv[2]):
    name=rng.choice(list(B)); P=[list(p) for p in B[name]]; n=len(P)
    k=rng.choice([1,2,2,3,3]); pcs=rng.sample(range(n),k); st=[None]*n
    for p,c in zip(pcs,'rgy'): st[p]=c
    fl=[]; fa=[]; seen=set()
    for _ in range(rng.choice([1,1,2,2,3])):
        a,b=rng.sample(range(n),2)
        if (min(a,b),max(a,b)) in seen: continue
        seen.add((min(a,b),max(a,b))); (fl if rng.random()<.35 else fa).append([a,b])
    links=[]; arrows=[]
    if k>1 and rng.random()<.2:
        u,v=rng.sample(pcs,2); (links if rng.random()<.5 else arrows).append([u,v])
    tools=['cw'] if rng.random()<.2 else ['ccw','cw']
    lv=dict(pts=P,tools=tools,start=st,goal=[],links=links,arrows=arrows,flinks=fl,farrows=fa)
    try:
        o=cpp.run(lv,'explore',timeout=20).split('\n'); md=int(o[1].split()[1])
        deep=[list(map(int,l.split()))[1:] for l in o[3:] if l and l[0].isdigit()]
        if md<2 or not deep: continue
        lv['goal']=[[p,c] for p,c in zip(rng.choice(deep),'rgy')]
        par,_=cpp.solve(lv,timeout=20)
        free=dict(lv,flinks=[],farrows=[]); pf,_=cpp.solve(free,timeout=20)
    except Exception: continue
    out.write(json.dumps(dict(board=name,par=par,free=pf,states=int(o[2].split()[1]),nmax=len(deep),lv=lv))+'\n'); out.flush()
