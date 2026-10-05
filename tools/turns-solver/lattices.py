import math
S3=math.sqrt(3)/2
def r3(v): return round(v,4)
def square(w,h): return [[x,y] for y in range(h) for x in range(w)]
def hexpatch(R):   # triangular lattice, hexagon shape
    return [[r3(a+b/2), r3(b*S3)] for b in range(-R,R+1) for a in range(-R,R+1) if abs(a+b)<=R]
def tripatch(s):   # triangular lattice, triangle shape with s points per side
    return [[r3(a+b/2), r3(b*S3)] for b in range(s) for a in range(s-b)]
def honeycomb(R):  # hexagonal (honeycomb) lattice: triangular lattice minus a sublattice, centred on a hole
    return [[r3(a+b/2), r3(b*S3)] for b in range(-R,R+1) for a in range(-R,R+1) if abs(a+b)<=R and (a-b)%3!=0]
def rhombus(s):
    return [[r3(a+b/2), r3(b*S3)] for b in range(s) for a in range(s)]
BOARDS={'tri7':tripatch(7),'rh5':rhombus(5),'sq5':square(5,5),'sq6':square(6,6),'sq7':square(7,7),'sq8':square(8,8),'rect58':square(8,5),
        'hex2':hexpatch(2),'hex3':hexpatch(3),'tri6':tripatch(6),'tri8':tripatch(8),'honey3':honeycomb(3),'honey4':honeycomb(4),'rh6':rhombus(6)}
