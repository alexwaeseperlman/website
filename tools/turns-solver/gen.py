from solver2 import *
from collections import deque, Counter
import random, math, itertools, json, sys
S3=math.sqrt(3)/2
def explore(pts, start, tools, links=()):
    L0=tuple(sorted(tuple(sorted(l)) for l in links))
    st=(tuple(start),L0); dist={st:0}; q=deque([st]); cache={}
    while q:
        cols,lk=q.popleft()
        if lk not in cache: cache[lk]=[m for m in gen_moves(pts,list(lk),tools,0)]
        for _,t,idx,p in cache[lk]:
            nc=list(cols)
            for i in idx: nc[p[i]]=cols[i]
            nl=tuple(sorted(tuple(sorted((p.get(a,a),p.get(b,b)))) for a,b in lk))
            ns=(tuple(nc),nl)
            if ns not in dist: dist[ns]=dist[(cols,lk)]+1; q.append(ns)
    best={}
    for (c,lk),d in dist.items(): best[c]=min(best.get(c,99),d)
    return best, len(cache[L0]) if L0 in cache else 0
def lattice(kind,n):
    if kind=='sq': return [(x,y) for x in range(n) for y in range(n)]
    return [(i+j*.5, j*S3) for j in range(n) for i in range(n-j)]
def search(kind,n,k,colors,tools,trials,seed,minmoves=1,maxmoves=12):
    rng=random.Random(seed); out=[]
    base=lattice(kind,n); seen=set()
    for _ in range(trials):
        pts=sorted(rng.sample(base,k))
        key_=tuple(pts)
        if key_ in seen: continue
        seen.add(key_)
        nm=len(gen_moves(pts,[],tools,0))
        if nm<minmoves or nm>maxmoves: continue
        start=[0]*k
        for c,i in zip(colors,rng.sample(range(k),len(colors))): start[i]=c
        best,_=explore(pts,start,tools)
        mx=max(best.values())
        out.append((mx,-nm,pts,start,[c for c,d in best.items() if d==mx][0]))
    out.sort(key=lambda x:(-x[0],-x[1]))
    return out[:5]
if __name__=='__main__':
    for kind,n,k,cols,tools in [('sq',3,5,['r'],['ccw','cw']),('sq',3,6,['r','g'],['ccw','cw']),
                                ('sq',4,6,['r','g'],['ccw','cw']),('tri',3,5,['r','g'],['ccw','cw']),
                                ('tri',4,6,['r','g'],['ccw','cw']),('sq',3,5,['r','g'],['cw']),('tri',3,5,['r','g'],['cw'])]:
        res=search(kind,n,k,cols,tools,400,1)
        print(kind,n,k,cols,tools)
        for mx,nm,pts,start,goal in res[:3]:
            print(f"   depth {mx} moves {-nm} pts {pts} start {start} goal {goal}")
