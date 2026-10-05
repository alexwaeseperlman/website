from gen import *
def poly_on_edge(a,b,n,side=1):
    """regular n-gon with edge a->b, built on the left side (side=1) of a->b"""
    pts=[a,b]; ang=math.atan2(b[1]-a[1],b[0]-a[0]); L=math.hypot(b[0]-a[0],b[1]-a[1])
    ext=2*math.pi/n*side; cur=b
    for _ in range(n-2):
        ang+=ext; cur=(cur[0]+L*math.cos(ang),cur[1]+L*math.sin(ang)); pts.append(cur)
    return pts
def merge(*groups):
    out=[]
    for g in groups:
        for p in g:
            if not any(abs(p[0]-q[0])<1e-6 and abs(p[1]-q[1])<1e-6 for q in out): out.append((round(p[0],6)+0.,round(p[1],6)+0.))
    return out
def rot_about(pts,c,deg):
    return [rot(p,c,math.radians(deg)) for p in pts]
SQ=[(0,0),(1,0),(1,1),(0,1)]
layouts={
 'house': merge(SQ, poly_on_edge((0,1),(1,1),3)),
 'sq+tri corner': merge(SQ, poly_on_edge((1,1),(2,1),3)),
 'rhombus': merge(poly_on_edge((0,0),(1,0),3), poly_on_edge((1,0),(0,0),3)),
 'sq+sq corner30': merge(SQ, rot_about([(1,1),(2,1),(2,2),(1,2)],(1,1),30)),
 'hex+tri': merge(poly_on_edge((0,0),(1,0),6), poly_on_edge((1,0),(0,0),3)),
 'sq+pent': merge(SQ, poly_on_edge((1,1),(0,1),5)),
 'tri+sq+tri': merge(SQ, poly_on_edge((1,1),(0,1),3), poly_on_edge((0,0),(1,0),3,)),
 'two tri corner': merge(poly_on_edge((0,0),(1,0),3), rot_about(poly_on_edge((1,0),(2,0),3),(1,0),-20)),
 'sq row3': merge(SQ, poly_on_edge((1,0),(2,0),4,1), poly_on_edge((2,0),(3,0),4,1)),
 'sq+hex': merge(SQ, poly_on_edge((1,1),(0,1),6)),
}
if __name__=='__main__':
    for name,pts in layouts.items():
        for tools in (['ccw','cw'],['cw']):
            nm=len(gen_moves(pts,[],tools,0))
            for cols in (['r','g'],['r','g','y']):
                if len(cols)>len(pts): continue
                start=[0]*len(pts)
                for i,c in enumerate(cols): start[i]=c
                best,_=explore(pts,start,tools)
                c=Counter(best.values()); mx=max(c)
                print(f"{name:16s} n={len(pts)} {'+'.join(tools):7s} {len(cols)}col moves={nm:2d} reach={len(best):4d} max={mx} dist={sorted(c.items())}")
