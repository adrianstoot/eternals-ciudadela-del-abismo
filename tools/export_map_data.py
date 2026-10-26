"""Export the Blender map to raw chunked arrays (Y-up, metres) for the web build.
Run:  blender --background ciudadela_abismo.blend --python export_map_data.py -- <outdir>
Output: <outdir>/index.json + <outdir>/data.bin  (consumed by build_map_glb.mjs)
Also extracts the packed textures to <outdir>/tex/*.png
"""
import bpy, sys, json, os, math, time
import numpy as np
from mathutils import Matrix

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
os.makedirs(OUT, exist_ok=True); os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
CHUNK = 24.0
COLLECTIONS = ['01_MASAS_TRAZADAS', '02_PAVIMENTO_VORONOI', '03_RUINAS_GOTICAS', '04_ANCLAJES_CADENAS', '05_ROCAS_PROFUNDAS']
ROLE = {
    'M_BASALTO_OBSIDIANA_2K': 'basalt', 'M_PAVIMENTO_MALVA_4K': 'stone', 'M_CANTOS_CLAROS_4K': 'stone_light',
    'M_MOLDURAS_GOTICAS_4K': 'trim', 'M_ESCOMBRO_FACETADO_2K': 'rubble', 'M_HIERRO_ENNEGRECIDO': 'metal',
    'M_CRISTAL_VIOLETA': 'crystal', 'M_FUCHSIA_PURO_V2': 'fuchsia', 'M_FUCHSIA_ENVOLVENTE_TRANSLUCIDA_V2': 'fuchsia',
    'M_CORAZON_BLANCO_V2': 'heart', 'M_SIMBOLO_VIOLETA_V2': 'symbol', 'M_RAIL_CAP_AZUL_V2': 'railcap',
}
t0 = time.time()
# ---- textures
for im in bpy.data.images:
    if im.name.endswith('_v2.png') and im.size[0] > 0:
        p = os.path.join(OUT, 'tex', im.name)
        im.filepath_raw = p; im.file_format = 'PNG'; im.save()
        print('tex', im.name)

dg = bpy.context.evaluated_depsgraph_get()
buckets = {}   # (role, cx, cz) -> list of (pos, nrm, uv) arrays of corners
def add(role, P, N, UV):
    # P: (T*3,3) Y-up world. chunk by triangle centroid
    T = P.shape[0] // 3
    cen = P.reshape(T, 3, 3).mean(1)
    cx = np.floor(cen[:, 0] / CHUNK).astype(np.int32); cz = np.floor(cen[:, 2] / CHUNK).astype(np.int32)
    key = (cx + 500) * 1000 + (cz + 500)
    for k in np.unique(key):
        m = key == k
        idx = np.repeat(m, 3)
        c = (role, int(cx[m][0]), int(cz[m][0]))
        buckets.setdefault(c, []).append((P[idx], N[idx], UV[idx]))

total_tris = 0
for cname in COLLECTIONS:
    col = bpy.data.collections[cname]
    for obj in col.objects:
        if obj.type != 'MESH': continue
        eo = obj.evaluated_get(dg); me = eo.to_mesh()
        me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        if nt == 0: eo.to_mesh_clear(); continue
        vi = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('vertices', vi)
        li = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get('loops', li)
        pi = np.empty(nt, np.int32); me.loop_triangles.foreach_get('polygon_index', pi)
        pmat = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', pmat)
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        cn = np.empty(len(me.loops) * 3, np.float32); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
        uvl = me.uv_layers.active
        if uvl:
            uv = np.empty(len(me.loops) * 2, np.float32); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        else:
            uv = None
        M = np.array(obj.matrix_world, dtype=np.float32)
        R = M[:3, :3]
        Rn = np.linalg.inv(R).T
        W = co[vi] @ R.T + M[:3, 3]
        Nw = cn[li] @ Rn.T
        l = np.linalg.norm(Nw, axis=1, keepdims=True); l[l == 0] = 1; Nw = Nw / l
        # Z-up -> Y-up
        Pw = np.stack([W[:, 0], W[:, 2], -W[:, 1]], 1)
        Nw = np.stack([Nw[:, 0], Nw[:, 2], -Nw[:, 1]], 1)
        if uv is None:
            ax = np.argmax(np.abs(Nw), axis=1)
            UVc = np.where((ax == 1)[:, None], np.stack([Pw[:, 0], Pw[:, 2]], 1), np.where((ax == 0)[:, None], np.stack([Pw[:, 2], Pw[:, 1]], 1), np.stack([Pw[:, 0], Pw[:, 1]], 1))) / 8.0
        else:
            UVc = uv[li]
        # mirrored transforms flip winding
        if np.linalg.det(R) < 0:
            flip = np.arange(nt * 3).reshape(nt, 3)[:, [0, 2, 1]].ravel()
            Pw, Nw, UVc = Pw[flip], Nw[flip], UVc[flip]; tri_mat = pmat[pi]
        else:
            tri_mat = pmat[pi]
        slots = [s.material.name if s.material else '' for s in obj.material_slots]
        for si in np.unique(tri_mat):
            name = slots[si] if si < len(slots) else ''
            role = ROLE.get(name)
            if not role: continue
            m = np.repeat(tri_mat == si, 3)
            add(role, Pw[m].astype(np.float32), Nw[m].astype(np.float32), UVc[m].astype(np.float32))
            total_tris += int((tri_mat == si).sum())
        eo.to_mesh_clear()
print('collected tris', total_tris, 'buckets', len(buckets), round(time.time() - t0, 1), 's')

# ---- weld + write
index = []
binf = open(os.path.join(OUT, 'data.bin'), 'wb'); offset = 0
def wr(a):
    global offset
    b = a.tobytes(); binf.write(b); o = offset; offset += len(b); return o, len(b)
out_tris = 0
for (role, cx, cz), parts in sorted(buckets.items()):
    P = np.concatenate([p[0] for p in parts]); N = np.concatenate([p[1] for p in parts]); UV = np.concatenate([p[2] for p in parts])
    q = np.concatenate([np.round(P * 500).astype(np.int32), np.round(N * 60).astype(np.int32), np.round(UV * 256).astype(np.int32)], axis=1)
    q = np.ascontiguousarray(q)
    v = q.view(np.dtype((np.void, q.dtype.itemsize * q.shape[1]))).ravel()
    _, first, inv = np.unique(v, return_index=True, return_inverse=True)
    P2 = P[first]; N2 = N[first]; UV2 = UV[first]; I = inv.astype(np.uint32).reshape(-1)
    # drop degenerate triangles
    I3 = I.reshape(-1, 3)
    ok = (I3[:, 0] != I3[:, 1]) & (I3[:, 1] != I3[:, 2]) & (I3[:, 0] != I3[:, 2])
    I3 = I3[ok]
    out_tris += len(I3)
    e = dict(role=role, cx=cx, cz=cz, nv=int(len(P2)), nt=int(len(I3)))
    e['pos'] = wr(P2.astype(np.float32)); e['nrm'] = wr(N2.astype(np.float32)); e['uv'] = wr(UV2.astype(np.float32)); e['idx'] = wr(I3.astype(np.uint32).ravel())
    index.append(e)
binf.close()
json.dump(dict(chunk=CHUNK, chunks=index), open(os.path.join(OUT, 'index.json'), 'w'))
print('DONE tris', out_tris, 'chunks', len(index), round(time.time() - t0, 1), 's')

