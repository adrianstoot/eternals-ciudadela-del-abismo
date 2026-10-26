import json, sys, numpy as np
from collections import deque
from PIL import Image
D = 'public/data/'
m = json.load(open(D + 'collision.json')); w, h = m['w'], m['h']
raw = open(D + 'collision.bin', 'rb').read()
H = np.frombuffer(raw[:w * h * 4], '<f4').reshape(h, w); Fl = np.frombuffer(raw[w * h * 4:], np.uint8).reshape(h, w)
x0, z0, c = m['x0'], m['z0'], m['cell']
walk = (H > -9000) & (Fl == 0)
def cell(x, z): return int((z - z0) / c), int((x - x0) / c)
STEP = float(sys.argv[1]) if len(sys.argv) > 1 else 0.6
def flood(sz, sx):
    seen = np.zeros_like(walk); q = deque([(sz, sx)]); seen[sz, sx] = 1
    while q:
        i, j = q.popleft()
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = i + di, j + dj
            if 0 <= a < h and 0 <= b < w and walk[a, b] and not seen[a, b] and abs(H[a, b] - H[i, j]) < STEP:
                seen[a, b] = 1; q.append((a, b))
    return seen
sz, sx = cell(0, 79.8)
seen = flood(sz, sx)
print('walk', int(walk.sum()), 'reached', int(seen.sum()))
W = json.load(open(D + 'world.json'))
out = []
for d in W['districts']:
    i, j = cell(d['c'][0], d['c'][2]); r = 8
    ok = bool(seen[max(0, i - r):i + r, max(0, j - r):j + r].any())
    out.append((d['name'], ok)); print(('OK ' if ok else '-- ') + d['name'], round(d['c'][1], 1))
img = np.zeros((h, w, 3), np.uint8); img[walk] = (90, 90, 110); img[seen] = (200, 200, 230); img[(H > -9000) & (Fl == 1)] = (200, 40, 60)
Image.fromarray(img).resize((w * 2, h * 2), Image.NEAREST).save(sys.argv[2] if len(sys.argv) > 2 else '_work/reach.png')
