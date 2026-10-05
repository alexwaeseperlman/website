import json, random, time, math, sys
from lattices import BOARDS
import lat
rng=random.Random(int(sys.argv[1])); budget=float(sys.argv[2]); out=open('free_res.txt','a')
POOL=['sq5','sq6','sq6','sq7','hex2','hex3','hex3','tri7']
def near(P,i,R): return [j for j in range(len(P)) if j!=i and math.dist(P[i],P[j])<=R+1e-6]
t0=time.time()
while time.time()-t0<budget:
    name=rng.choice(POOL); P=BOARDS[name]; n=len(P); tri=name[0] in 'ht'
    fixed=rng.random()<.6
    tools=(['r120','r-120'] if tri else ['r90','r-90']) if fixed else ['ccw','cw']
    npc=3 if rng.random()<.8 else 2
    R=rng.choice([1.5,2.5,99])
    a=rng.randrange(n); pcs=[a]
    while len(pcs)<npc:
        c=[j for j in near(P,pcs[-1],R) if j not in pcs]
        if not c: break
        pcs.append(rng.choice(c))
    if len(pcs)<npc: continue
    st=[None]*n
    for p,c in zip(pcs,'rgy'): st[p]=c
    links=[]; arrows=[]
    ndeco = rng.choice([0,0,1,2]) if fixed else rng.choice([1,2,2,3])
    used=set(pcs)
    for _ in range(ndeco):
        kind=rng.choice(['link','arrow','tether','tether'])
        if kind=='tether':
            src=rng.choice(pcs); far=sorted([j for j in range(n) if j not in used],key=lambda j:-math.dist(P[src],P[j]))[:6]
            k=rng.choice(far); used.add(k)
            if rng.random()<.5: links.append([src,k])
            else: arrows.append([k,src] if rng.random()<.5 else [src,k])
        else:
            u,v=rng.sample(pcs,2)
            (links if kind=='link' else arrows).append([u,v])
    lv=dict(pts=P,tools=tools,start=st,goal=[],links=links,arrows=arrows)
    T=len(used); rec=dict(board=name,start=st,links=links,arrows=arrows,tools=tools,T=T)
    try:
        lat.TILT=0
        if n**T<=6000000:
            d=lat.explore(lv,tl=50)
            if not d.get('complete'): continue
            goals=d.get('deep',[])[:6]; rec.update(method='exact',depth=d['maxdepth'])
        else:
            best=(-1,None)
            for g in lat.walks(lv,length=30,n=8,seed=rng.randrange(10**6)):
                if len(g)<npc: continue
                lv['goal']=[[p,c] for p,c in zip(g,'rgy')]; p,_=lat.solve(lv,tl=15)
                if p>best[0]: best=(p,g)
            goals=[best[1]]; rec.update(method='sampled',depth=best[0])
        # tilt necessity for fixed-angle tools, on the best goal
        if fixed and goals and goals[0]:
            lv['goal']=[[p,c] for p,c in zip(goals[0],'rgy')]
            lat.TILT=60 if tri else 90; a,_=lat.solve(lv,tl=20); lat.TILT=0
            rec['aligned']=a
        rec['goals']=goals[:3]
        out.write(json.dumps(rec)+'\n'); out.flush()
    except Exception as e: pass
