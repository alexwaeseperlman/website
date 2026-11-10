# Builds the ten "Fixed" chapter levels (links/arrows that stay on the board): solves each with turns.cpp,
# checks every fixed link/arrow matters, and writes fixed_pack.json (levels in the game's format).
import json
from chal_layouts import LAY
import cpp
HINGE=[(0,0),(1,0),(1,1),(0,1),(1.866,1.5),(1.366,2.366),(.5,1.866)]
G3=[(x,y) for y in range(3) for x in range(3)]
B=dict(LAY, hinge=HINGE, g3=G3)
def st(n,**k):
    s=[None]*n
    for c,i in k.items(): s[i]=c
    return s
# name, board, hint, start (colour=dot), goal, tools, flinks, farrows, links, arrows
PACK=[
 ('Painted link','hexc','This link is painted on the board. Whatever sits on its two spots is selected together, and it stays put when the dots turn.',
  dict(r=5),dict(r=1),2,[[4,5]],[],[],[]),
 ('Stays put','star8','A painted link doesn\'t follow the dots. Once a dot leaves it, the dot is free.',
  dict(r=2,g=5),dict(r=1,g=5),2,[[5,1]],[],[],[]),
 ('One way','cross','A painted arrow. Selecting the spot at its tail selects the spot at its head too, and the arrow never moves.',
  dict(r=0,g=3),dict(r=4,g=3),2,[],[[2,1]],[],[]),
 ('Spoke','oct','One painted arrow, from the center to the rim.',
  dict(r=1,g=3,y=8),dict(r=1,g=7,y=6),2,[],[[8,1]],[],[]),
 ('Relay','tri10','Two painted arrows, one feeding the other.',
  dict(g=2,y=5,r=6),dict(r=7,g=9,y=3),2,[],[[5,1],[6,5]],[],[]),
 ('Diagonal','g3','A painted link and a painted arrow meet in the middle.',
  dict(g=2,y=7,r=8),dict(r=1,g=2,y=7),2,[[8,4]],[[4,0]],[],[]),
 ('Passenger','twopent','One arrow rides on its dot. The other is painted on the board.',
  dict(r=0,y=1,g=2),dict(r=4,g=0,y=1),2,[],[[4,0]],[],[[1,0]]),
 ('One-way street','hinge','Clockwise only, and one painted link.',
  dict(g=3,r=4),dict(r=6,g=4),1,[[4,6]],[],[],[]),
 ('Loose end','hexc','A link that travels, and two painted rules that don\'t.',
  dict(g=3,r=4),dict(r=3,g=4),2,[[1,0]],[[0,5]],[[4,3]],[]),
 ('Gridlock','sqtri','Six spots, two painted rules, and a long way round.',
  dict(g=1,r=3,y=5),dict(r=4,g=5,y=1),2,[[5,1]],[[1,3]],[],[]),
]
out=[]
for name,b,hint,s,g,nt,fl,fa,lk,ar in PACK:
    P=[[round(x,4),round(y,4)] for x,y in B[b]]
    lv=dict(chapter='Fixed',name=name,hint=hint,pts=P,tools=['ccw','cw'] if nt==2 else ['cw'],start=st(len(P),**s),
            goal=[[i,c] for c,i in g.items()])
    if lk: lv['links']=lk
    if ar: lv['arrows']=ar
    if fl: lv['flinks']=fl
    if fa: lv['farrows']=fa
    par,pm=cpp.solve(lv); moves=cpp.solve.last; free=cpp.solve(dict(lv,flinks=[],farrows=[]))[0]
    for key in ('flinks','farrows'):
        for i in range(len(lv.get(key,[]))):
            l2=dict(lv); l2[key]=lv[key][:i]+lv[key][i+1:]
            assert cpp.solve(l2)[0]<par, (name,key,i)
    lv['par']=par; lv['parMoves']=pm
    lv['sol']=[{'s':[i for i in range(len(P)) if (m['mask']>>i)&1],'t':'ccw' if m['dir']>0 else 'cw'} for m in moves]
    assert len(lv['sol'])==par
    out.append(lv); print(f"{name:16s} {b:8s} {len(P)} dots  par {par}  (without the fixed parts: {free})")
json.dump(out,open('fixed_pack.json','w'),separators=(',',':'))
