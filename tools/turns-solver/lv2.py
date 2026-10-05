from solver2 import *
import math, json, sys
S3=math.sqrt(3)/2
def tri(i,j): return [i+j*0.5, j*S3]
def ngon(n,r=1,cx=0,cy=0,rot=math.pi/2): return [[cx+r*math.cos(rot+2*math.pi*k/n), cy+r*math.sin(rot+2*math.pi*k/n)] for k in range(n)]
Q=['r90','r-90']
def T(name,**lv):
    lv['name']=name
    d,p=solve(lv,maxd=lv.pop('maxd',10))
    desc=[]
    for m in (p or []):
        desc.append((m[1] if m[0]=='perm' else 'add', m[2]))
    print(f"{name}: par={d}  {desc}")
    return lv,d
_=None
if __name__=='__main__':
    # quarter turns
    T("Square",pts=[[0,0],[1,0],[1,1],[0,1]],tools=Q,start=['r',_,_,_],goal=[[1,'r']])
    T("Square2",pts=[[0,0],[1,0],[1,1],[0,1]],tools=Q,start=['r','g',_,_],goal=[[2,'r'],[3,'g']])
    two=[[0,0],[1,0],[1,1],[0,1],[2,1],[2,2],[1,2]]
    T("Two squares",pts=two,tools=Q,start=['r',_,_,_,_,_,_],goal=[[5,'r']])
    T("Two squares b",pts=two,tools=Q,start=['r','g',_,_,_,_,_],goal=[[5,'r'],[4,'g']])
    plus=[[0,0],[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,-1]]
    T("plus",pts=plus,tools=Q,start=['r','g',_,_,_,_,_],goal=[[0,'g'],[1,'r']])
    G=[[x,y] for y in range(3) for x in range(3)]
    T("grid swap",pts=G,tools=Q,start=['r','g',_,_,_,_,_,_,_],goal=[[0,'g'],[1,'r']])
    T("grid swap center",pts=G,tools=Q,start=[_,_,_,_,'r','g',_,_,_],goal=[[4,'g'],[5,'r']])
