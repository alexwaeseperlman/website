import json, random, time, sys, math
from lattices import BOARDS
import lat
rng=random.Random(int(sys.argv[1])); budget=float(sys.argv[2]); out=open('hole_res.txt','a')
SQ=['sq5','sq6']; TR=['hex2','hex3','tri6','tri7']
t0=time.time()
while time.time()-t0<budget:
    tri = rng.random()<.4
    name=rng.choice(TR if tri else SQ); full=BOARDS[name]
    nh=rng.choice([1,1,2,2,3,4]); holes=sorted(rng.sample(range(len(full)),nh))
    P=[p for i,p in enumerate(full) if i not in holes]; n=len(P)
    npc=rng.choice([1,2,2,3]); pos=rng.sample(range(n),npc)
    st=[None]*n
    for p,c in zip(pos,'rgy'): st[p]=c
    both=rng.random()<.6
    tools=(['r120','r-120'] if both else ['r120']) if tri else (['r90','r-90'] if both else ['r90'])
    lv=dict(pts=P,tools=tools,start=st,goal=[])
    try:
        lat.TILT=0; d=lat.explore(lv,tl=20)
        if not d.get('complete') or d['maxdepth']<1: continue
        best=None
        for g in d.get('deep',[])[:8]:
            lv['goal']=[[p,c] for p,c in zip(g,'rgy')]
            lat.TILT=60 if tri else 90; pa,_=lat.solve(lv,tl=10)
            lat.TILT=0; pt,_=lat.solve(lv,tl=10)
            score=(100 if pa<0 else pa-pt)
            if best is None or score>best[0]: best=(score,g,pt,pa)
        if best and (best[0]>=2):
            out.write(json.dumps(dict(board=name,holes=holes,pts=P,start=st,tools=tools,goal=best[1],par=best[2],aligned=best[3],hist=d['hist']))+'\n'); out.flush()
    except Exception as e: pass
