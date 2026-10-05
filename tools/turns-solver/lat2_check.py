import json, time, lat
from lattices import BOARDS
L=json.load(open('levels6.json')); bad=[]; n=0
lat.BIN="./lat2"; t=time.time()
for lv in L:
    if any(x not in ('ccw','cw') for x in lv['tools']): continue
    p,_=lat.solve(lv,tl=30); n+=1
    if p!=lv['par']: bad.append((lv['name'],lv['par'],p))
print(n,'levels, bidirectional solve %.1fs, mismatches:'%(time.time()-t),bad)
P=BOARDS['sq7']; st=[None]*49; st[0]='r'; st[1]='g'; st[2]='y'
import os
for b in [x for x in ('./lat','./lat2') if os.path.exists(x)]:   # ./lat is the older solver, if you still have it
    lat.BIN=b; t=time.time(); d=lat.explore(dict(pts=P,tools=['ccw','cw'],start=st,goal=[]),tl=60); print(b,'explore 7x7: %.1fs'%(time.time()-t), d['states'])
