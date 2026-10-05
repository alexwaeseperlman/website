import json, random, itertools, math, time, sys
from chal_layouts import LAY
import cpp
rng=random.Random(int(sys.argv[1])); out=open('chal_new.txt','a'); t0=time.time()
BOARDS=['oct','pentri','sqtri','tri10','star8','twopent','flower']
while time.time()-t0<float(sys.argv[2]):
    name=rng.choice(BOARDS); P=[list(p) for p in LAY[name]]; n=len(P)
    pcs=rng.sample(range(n),3); st=[None]*n
    for p,c in zip(pcs,'rgy'): st[p]=c
    links=[]; arrows=[]; used=set(pcs)
    for _ in range(rng.choice([1,2,2,3])):
        kind=rng.choice(['link','arrow','tether'])
        if kind=='tether':
            src=rng.choice(pcs); free=[j for j in range(n) if j not in used]
            if not free: continue
            k=rng.choice(free); used.add(k)
            if rng.random()<.5: links.append([src,k])
            else: arrows.append([k,src] if rng.random()<.5 else [src,k])
        else:
            u,v=rng.sample(pcs,2); (links if kind=='link' else arrows).append([u,v])
    lv=dict(pts=P,tools=['ccw','cw'],start=st,goal=[],links=links,arrows=arrows)
    try: o=cpp.run(lv,'explore',timeout=30).split('\n')
    except Exception: continue
    md=int(o[1].split()[1]); deep=[list(map(int,l.split()))[1:] for l in o[3:] if l and l[0].isdigit()]
    out.write(json.dumps(dict(board=name,depth=md,start=st,links=links,arrows=arrows,goal=deep[0] if deep else None,nmax=len(deep)))+'\n'); out.flush()
