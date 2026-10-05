from shapes import poly_on_edge, merge, layouts
from lv2 import ngon, S3
import math
SQ=[(0,0),(1,0),(1,1),(0,1)]
def outward(poly,n):
    """regular n-gons built outward on every edge of a ccw polygon"""
    out=[poly]
    for i in range(len(poly)):
        p,q=poly[i],poly[(i+1)%len(poly)]
        out.append(poly_on_edge(q,p,n))
    return merge(*out)
def tri(i,j): return (i+j*0.5, j*S3)
HEX=[tuple(p) for p in ngon(6,1,0,0,0)]
P5=[tuple(p) for p in ngon(5,1,0,0,-math.pi/2)]
LAY={
 'star8':  outward(SQ,3),                                   # square with a triangle on each side
 'flower': merge([(0.0,0.0)],HEX, *[poly_on_edge(HEX[(i+1)%6],HEX[i],3) for i in range(6)]),  # hexagram-ish
 'twopent':merge(P5, poly_on_edge(P5[1],P5[0],5)),          # two pentagons sharing an edge
 'oct':    merge([(0.0,0.0)],[tuple(p) for p in ngon(8,1,0,0,math.pi/8)]),
 'tri10':  [tri(i,j) for j in range(4) for i in range(4-j)],
 'g4':     [(x,y) for y in range(4) for x in range(4)],
 'hexc':   [(0.0,0.0)]+HEX,
 'pentri': P5+[(P5[0][0]-.5,P5[0][1]-S3),(P5[0][0]+.5,P5[0][1]-S3)],
 'sqtri':  merge(SQ, poly_on_edge((0,1),(1,1),3), poly_on_edge((1,0),(0,0),3)),   # square, roof and keel
 'cross':  [(1,0),(0,1),(1,1),(2,1),(1,2),(1,3)],
}
