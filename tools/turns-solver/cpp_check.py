import json, time
from cpp import solve
L=json.load(open('levels6.json')); bad=[]
t=time.time()
for lv in L:
    if 'add' in lv['tools'] or any(t not in ('ccw','cw','m') for t in lv['tools']): continue
    p,_=solve(lv, timeout=60)
    if p!=lv['par']: bad.append((lv['name'],lv['par'],p))
print('checked in %.1fs, mismatches:'%(time.time()-t), bad)
