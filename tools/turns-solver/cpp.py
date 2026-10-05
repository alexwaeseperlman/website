import subprocess, json
CODE={'r':1,'g':2,'y':3}
def to_input(lv, mode, mbudget=None):
    pts=lv['pts']; n=len(pts)
    tools=lv['tools']; mb = lv.get('flips', -1) if mbudget is None else mbudget
    tracked=[i for i,c in enumerate(lv['start']) if c]
    for a,b in list(lv.get('links',[]))+list(lv.get('arrows',[])):
        for x in (a,b):
            if x not in tracked: tracked.append(x)
    tid={p:k for k,p in enumerate(tracked)}
    out=[mode,str(n)]+[f"{x} {y}" for x,y in pts]
    out.append(f"{int('ccw' in tools)} {int('cw' in tools)} {int('m' in tools)} {mb}")
    out.append(str(len(tracked)))
    out+= [f"{p} {CODE.get(lv['start'][p],0) if lv['start'][p] else 0}" for p in tracked]
    L=lv.get('links',[]); A=lv.get('arrows',[])
    out.append(str(len(L))); out+=[f"{tid[a]} {tid[b]}" for a,b in L]
    out.append(str(len(A))); out+=[f"{tid[a]} {tid[b]}" for a,b in A]
    if mode=='solve':
        out.append(str(len(lv['goal']))); out+=[f"{p} {CODE[c]}" for p,c in lv['goal']]
    return "\n".join(out)+"\n"
def run(lv, mode, mbudget=None, timeout=300):
    r=subprocess.run(['./turns'],input=to_input(lv,mode,mbudget),capture_output=True,text=True,timeout=timeout)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout
def solve(lv, mbudget=None, timeout=300):
    o=run(lv,'solve',mbudget,timeout).split('\n')
    par=int(o[0].split()[1]); rows=[l.split() for l in o[1:] if l.strip()]
    pm=[[int(r[0]),0] for r in rows]
    solve.last=[dict(type=int(r[1]),mask=int(r[2]),dir=int(r[3]),phi=float(r[4])) for r in rows]
    return par, pm
