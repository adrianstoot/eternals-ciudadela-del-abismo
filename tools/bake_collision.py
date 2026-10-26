"""Bake a walk/collision heightfield + world landmarks from the Blender map.
blender --background ciudadela_abismo.blend --python bake_collision.py -- <outdir>
Output (three.js coordinates, Y up; Blender (x,y,z) -> (x, z, -y)):
  collision.json  {x0,z0,cell,w,h,...}  and  collision.bin = float32 heights[w*h] + uint8 flags[w*h]
  world.json      landmarks (districts, altar, lights...)
"""
import bpy, sys, os, json, time, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1]); os.makedirs(OUT, exist_ok=True)
CELL = 0.25
t0 = time.time()
dg = bpy.context.evaluated_depsgraph_get()

def world_tris(obj):
    eo = obj.evaluated_get(dg); me = eo.to_mesh(); me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    vi = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('vertices', vi)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    M = np.array(obj.matrix_world, dtype=np.float32)
    W = co @ M[:3, :3].T + M[:3, 3]
    tri = W[vi].reshape(nt, 3, 3)
    eo.to_mesh_clear()
    return tri

def collect(coll, pred):
    out = []
    for o in bpy.data.collections[coll].objects:
        if o.type == 'MESH' and pred(o.name): out.append(world_tris(o))
    return np.concatenate(out) if out else np.zeros((0, 3, 3), np.float32)

# --- walkable: pavements (+ medallions)
floor = collect('02_PAVIMENTO_VORONOI', lambda n: 'Pavimento' in n)
print('floor tris', len(floor))
verts = floor.reshape(-1, 3)
tris = np.arange(len(verts)).reshape(-1, 3)
bvh = BVHTree.FromPolygons([tuple(v) for v in verts], [tuple(t) for t in tris], epsilon=0.0)
mn = floor.reshape(-1, 3).min(0); mx = floor.reshape(-1, 3).max(0)
print('floor bbox', mn, mx)
M = 3.0
x0 = math.floor((mn[0] - M) / CELL) * CELL; x1 = math.ceil((mx[0] + M) / CELL) * CELL
y0 = math.floor((mn[1] - M) / CELL) * CELL; y1 = math.ceil((mx[1] + M) / CELL) * CELL
W_ = int(round((x1 - x0) / CELL)); H_ = int(round((y1 - y0) / CELL))
print('grid', W_, H_)
# raycast down; grid in blender coords [iy][ix], later converted
heights = np.full((H_, W_), -9999.0, np.float32)
top = float(mx[2]) + 10
down = Vector((0, 0, -1))
for iy in range(H_):
    y = y0 + (iy + 0.5) * CELL
    for ix in range(W_):
        x = x0 + (ix + 0.5) * CELL
        hit = bvh.ray_cast(Vector((x, y, top)), down)
        if hit[0] is not None: heights[iy, ix] = hit[0].z
print('raycast done', round(time.time() - t0, 1), 's; ground cells', int((heights > -9000).sum()))

# --- fill tiny cracks between adjacent pavement pieces (seams between routes / plazas)
def box3(a):
    p = np.pad(a, 1)
    return sum(p[1 + dy:1 + dy + a.shape[0], 1 + dx:1 + dx + a.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
ground = heights > -9000
for it in range(3):
    hole = ~ground
    hv = np.where(ground, heights, 0.0); cnt = ground.astype(np.float32)
    s = box3(hv); n = box3(cnt)
    # only fill cells that are sandwiched (opposite neighbours both ground)
    g = ground
    sand = np.zeros_like(g)
    sand[1:-1, :] |= g[:-2, :] & g[2:, :]
    sand[:, 1:-1] |= g[:, :-2] & g[:, 2:]
    sand[1:-1, 1:-1] |= (g[:-2, :-2] & g[2:, 2:]) | (g[:-2, 2:] & g[2:, :-2])
    fill = hole & sand & (n >= 3)
    heights[fill] = (s / np.maximum(n, 1))[fill]
    ground = heights > -9000
print('ground after fill', int(ground.sum()))

# --- obstacles: precise ray casts from head height down onto obstacle geometry
def bvh_of(tri_set):
    v = tri_set.reshape(-1, 3); t = np.arange(len(v)).reshape(-1, 3)
    return BVHTree.FromPolygons([tuple(p) for p in v], [tuple(x) for x in t], epsilon=0.0)
flags = np.zeros((H_, W_), np.uint8)
rails = collect('02_PAVIMENTO_VORONOI', lambda n: 'Pretiles' in n)
ruins = collect('03_RUINAS_GOTICAS', lambda n: ('Masonry' in n) or ('Crown' in n) or ('Crystal_Remnants' in n) or ('Fragments' in n))
cols = collect('01_MASAS_TRAZADAS', lambda n: 'ColumnasPlacas' in n or 'Masa' in n)
chains = collect('04_ANCLAJES_CADENAS', lambda n: 'ANCHOR' in n)
obs = np.concatenate([rails, ruins, chains])
print('obstacle tris', len(obs))
ob = bvh_of(obs)
iy_, ix_ = np.where(ground)
for iy, ix in zip(iy_, ix_):
    g = heights[iy, ix]
    x = x0 + (ix + 0.5) * CELL; y = y0 + (iy + 0.5) * CELL
    hit = ob.ray_cast(Vector((x, y, g + 2.0)), down, 1.65)
    if hit[0] is not None and hit[0].z > g + 0.35:
        flags[iy, ix] = 1
        continue
    # also catch thin vertical walls: short horizontal probe at knee height in 4 dirs
    for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)):
        h2 = ob.ray_cast(Vector((x, y, g + 0.7)), Vector(d), CELL * 0.5)
        if h2[0] is not None:
            flags[iy, ix] = 1; break
print('blocked cells', int(flags.sum()), round(time.time() - t0, 1), 's')

# convert to three coords: x=bx, z=-by. Rows along z increasing => flip y.
hz = heights[::-1].copy(); fz = flags[::-1].copy()
z0 = -y1
with open(os.path.join(OUT, 'collision.bin'), 'wb') as f:
    f.write(hz.astype('<f4').tobytes()); f.write(fz.tobytes())
json.dump(dict(x0=x0, z0=z0, cell=CELL, w=W_, h=H_), open(os.path.join(OUT, 'collision.json'), 'w'))

# --- landmarks
def bbox_of(objs):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector(min(mn[i], w[i]) for i in range(3)); mx = Vector(max(mx[i], w[i]) for i in range(3))
    return mn, mx
districts = []
for o in bpy.data.collections['02_PAVIMENTO_VORONOI'].objects:
    if o.name.endswith('_PavimentoV2') and 'Medallon' not in o.name:
        a, b = bbox_of([o]); c = (a + b) / 2
        districts.append(dict(name=o.name.replace('_PavimentoV2', ''), c=[c.x, c.z, -c.y], size=[b.x - a.x, b.z - a.z, b.y - a.y], top=b.z))
medallions = []
for o in bpy.data.collections['02_PAVIMENTO_VORONOI'].objects:
    if 'Medallon' in o.name:
        a, b = bbox_of([o]); c = (a + b) / 2
        medallions.append(dict(name=o.name, c=[c.x, b.z, -c.y], r=(b.x - a.x) / 2))
lights = [dict(n=o.name, t=o.data.type, c=list(o.data.color), e=o.data.energy, p=[o.location.x, o.location.z, -o.location.y]) for o in bpy.data.objects if o.type == 'LIGHT']
fx = {o.name: [o.location.x, o.location.z, -o.location.y] for o in bpy.data.objects if o.name.startswith('FX_Semilla') or o.name.startswith('FX_Aletas')}
json.dump(dict(districts=districts, medallions=medallions, lights=lights, fx=fx, bounds=dict(min=[float(mn[0]), float(mn[2]), float(-mx[1])], max=[float(mx[0]), float(mx[2]), float(-mn[1])])), open(os.path.join(OUT, 'world.json'), 'w'), indent=1)
print('DONE', round(time.time() - t0, 1), 's')

