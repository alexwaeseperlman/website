import subprocess
BIN='./lat2'
TILT=0
CODE={'r':1,'g':2,'y':3}
def to_input(lv, mode, tl, extra=''):
    pts=lv['pts']; tools=lv['tools']
    tracked=[i for i,c in enumerate(lv['start']) if c]
    for a,b in list(lv.get('links',[]))+list(lv.get('arrows',[])):
        for x in (a,b):
            if x not in tracked: tracked.append(x)
    tid={p:k for k,p in enumerate(tracked)}
    out=[f"{mode} {tl}",str(len(pts))]+[f"{x} {y}" for x,y in pts]
    fk={'r90':4,'r-90':4,'r120':3,'r-120':3}
    fixk=max([fk.get(t,0) for t in tools]+[0])
    ccw=int('ccw' in tools or 'r90' in tools or 'r120' in tools); cw=int('cw' in tools or 'r-90' in tools or 'r-120' in tools)
    out.append(f"{ccw} {cw} {TILT} {fixk}")
    out.append(str(len(tracked))); out+=[f"{p} {CODE[lv['start'][p]] if lv['start'][p] else 0}" for p in tracked]
    L=lv.get('links',[]); A=lv.get('arrows',[])
    out.append(str(len(L))); out+=[f"{tid[a]} {tid[b]}" for a,b in L]
    out.append(str(len(A))); out+=[f"{tid[a]} {tid[b]}" for a,b in A]
    if mode.startswith('walk'): out.append(extra)
    if mode=='solve': out.append(str(len(lv['goal']))); out+=[f"{p} {CODE[c]}" for p,c in lv['goal']]
    return "\n".join(out)+"\n"
def run(lv, mode, tl=60, extra='', to=None):
    r=subprocess.run([BIN],input=to_input(lv,mode,tl,extra),capture_output=True,text=True,timeout=to or tl+30)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout
def explore(lv, tl=60):
    o=run(lv,'explore',tl).split('\n'); d={}
    for l in o:
        p=l.split()
        if not p: continue
        if p[0] in ('maxdepth','states','complete','centres'): d[p[0]]=int(p[1])
        elif p[0]=='hist': d['hist']=list(map(int,p[1:]))
        else: d.setdefault('deep',[]).append(list(map(int,p[1:])))
    return d
def solve(lv, tl=60):
    o=[l.split() for l in run(lv,'solve',tl).split('\n') if l.strip()]
    par=int(o[0][1]); moves=[dict(size=int(r[0]),mask=r[2],dir=int(r[3])) for r in o[1:]]
    return par, moves

def walks(lv, length=25, n=20, seed=1):
    o=run(lv,'walk',length,extra=f"{seed} {n}",to=120)
    return [list(map(int,x.split())) for x in o.strip().split('\n') if x.strip()]
