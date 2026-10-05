import json, math, time, sys
import cpp, lat, solver2
L=json.load(open('levels6.json')); out={}
FIX={'r90','r-90','r120','r-120'}
def phi_of(pts, idx, p):
    for phi,q in solver2.mirror_axes(pts, idx):
        if all(q.get(i,i)==p.get(i,i) for i in idx): return phi
    return None
for lv in L:
    nm=lv['name']; t0=time.time(); sol=[]
    try:
        if 'add' in lv['tools']:
            par,path=solver2.solve(lv, maxd=lv['par'])
            pts=[tuple(p) for p in lv['pts']]
            for mv in path:
                if mv[0]=='perm':
                    _,t,idx,p=mv; m={'s':sorted(idx),'t':t}
                    if t=='m': m['phi']=phi_of(pts,idx,p)
                    sol.append(m)
                else:
                    _,info,idx,new=mv; sol.append({'s':sorted(idx),'t':'add','add':[list(q) for q in new]})
                    pts=pts+[tuple(q) for q in new]
        elif lv['chapter']=='Lattices' or any(t in FIX for t in lv['tools']):
            lat.TILT=0; par,moves=lat.solve(lv,tl=120)
            fixed=next((t for t in lv['tools'] if t in FIX),None)
            for mv in moves:
                s=[i for i in range(len(lv['pts'])) if (int(mv['mask'])>>i)&1]
                if fixed: t=('r120' if '120' in fixed else 'r90') if mv['dir']>0 else ('r-120' if '120' in fixed else 'r-90')
                else: t='ccw' if mv['dir']>0 else 'cw'
                sol.append({'s':s,'t':t})
        else:
            par,_=cpp.solve(lv,timeout=120)
            for mv in cpp.solve.last:
                s=[i for i in range(len(lv['pts'])) if (mv['mask']>>i)&1]
                if mv['type']==1: sol.append({'s':s,'t':'m','phi':mv['phi']})
                else: sol.append({'s':s,'t':'ccw' if mv['dir']>0 else 'cw'})
        ok = par==lv['par'] and len(sol)==par
        out[nm]=sol if ok else None
        print(f"{nm:22s} par {lv['par']} got {par} {'OK' if ok else 'MISMATCH'} {time.time()-t0:.1f}s", flush=True)
    except Exception as e:
        print(f"{nm:22s} ERROR {e}", flush=True); out[nm]=None
    json.dump(out,open('sols.json','w'))
