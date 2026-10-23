# bot-net.json (int16 + per-segment scales) -> live.json with float weights, for deep.cpp's loadNet
import json, base64, struct, sys
d = json.load(open(sys.argv[1]))
q = base64.b64decode(d['q']); n = len(q) // 2
ints = struct.unpack('<%dh' % n, q)
LAYERS = [[20, 12], [36, 12], [106, 32], [131, 64], [64, 64], [64, 2]]
p, o, si = [], 0, 0
for i, k in LAYERS:
    for ln in (i * k, k):
        s = d['scales'][si]; si += 1
        p += [x * s for x in ints[o:o + ln]]; o += ln
assert o == n
json.dump({'arch': 'cnet3', 'out': 2, 'drop': '', 'head': 'logit', 'p': p}, open(sys.argv[2], 'w'), separators=(',', ':'))
print(n, 'weights')
