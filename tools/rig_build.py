"""Stage 1: import the static Meshy model, scale to metres, build the armature and compute skin weights.

Run inside Blender:  blender --background --python rig_build.py   (normally imported by rig_character.py)
"""
import os
import sys
import math
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, 'Meshy_AI_Crimson_Shadow_Knight_1025000543_texture.glb')

# ---- placement of the original model (original units are ~1.9 tall)
SCALE = 0.96          # -> character ~1.81 m tall (including hair)
XC = -0.005           # body centre line (orig x)
F0 = -0.03            # depth origin (orig forward coord)
FLOOR = -0.952        # orig z of the soles


def P(L, F, U):
    """orig-unit character coords (L left+, F forward+, U up) -> armature/blender metres"""
    return Vector((SCALE * L, -SCALE * (F - F0), SCALE * (U - FLOOR)))


def mirror(spec):
    out = {}
    for name, (parent, head, tail) in spec.items():
        pass
    return out


def build_spec(sword):
    """bone definitions in orig coordinates: name -> (parent, head(L,F,U), tail(L,F,U), deform)"""
    s = {}
    def add(name, parent, head, tail, deform=True):
        s[name] = (parent, head, tail, deform)
    add('Root', None, (0, F0, FLOOR), (0, F0 + 0.12, FLOOR), False)
    add('Hips', 'Root', (0, -0.015, 0.06), (0, -0.01, 0.17))
    add('Spine', 'Hips', (0, -0.01, 0.17), (0, -0.01, 0.31))
    add('Spine1', 'Spine', (0, -0.01, 0.31), (0, -0.01, 0.46))
    add('Chest', 'Spine1', (0, -0.01, 0.46), (0, -0.025, 0.62))
    add('Neck', 'Chest', (0, -0.025, 0.62), (0, -0.025, 0.70))
    add('Head', 'Neck', (0, -0.025, 0.70), (0, -0.025, 0.93))
    for sg, S in ((1, 'L'), (-1, 'R')):
        add('Shoulder_' + S, 'Chest', (sg * 0.03, -0.03, 0.60), (sg * 0.20, -0.035, 0.56))
        add('UpperArm_' + S, 'Shoulder_' + S, (sg * 0.20, -0.035, 0.56), (sg * 0.48, -0.03, 0.555))
        add('ForeArm_' + S, 'UpperArm_' + S, (sg * 0.48, -0.03, 0.555), (sg * 0.725, -0.015, 0.545))
        add('Hand_' + S, 'ForeArm_' + S, (sg * 0.725, -0.015, 0.545), (sg * 0.87, -0.01, 0.545))
        add('UpperLeg_' + S, 'Hips', (sg * 0.095, -0.015, 0.03), (sg * 0.165, -0.04, -0.44))
        add('LowerLeg_' + S, 'UpperLeg_' + S, (sg * 0.165, -0.04, -0.44), (sg * 0.175, -0.05, -0.835))
        add('Foot_' + S, 'LowerLeg_' + S, (sg * 0.175, -0.05, -0.835), (sg * 0.175, 0.085, -0.925))
        add('Toe_' + S, 'Foot_' + S, (sg * 0.175, 0.085, -0.925), (sg * 0.175, 0.175, -0.945))
    sx, sf = sword['L'], sword['F']
    add('SwordBase', 'Hand_R', (sx, sf, sword['base_u']), (sx, sf, sword['base_u'] - 0.08), False)
    add('SwordMid', 'Hand_R', (sx, sf, sword['mid_u']), (sx, sf, sword['mid_u'] - 0.08), False)
    add('SwordTip', 'Hand_R', (sx, sf, sword['tip_u'] + 0.08), (sx, sf, sword['tip_u']), False)
    add('HandR_FX', 'Hand_R', (-0.775, -0.005, 0.49), (-0.775, -0.005, 0.44), False)
    add('HandL_FX', 'Hand_L', (0.80, -0.01, 0.52), (0.80, -0.01, 0.47), False)
    return s


# capsule radius (m, scaled) per deform bone for the nearest-bone labelling
RADIUS = dict(Hips=.17, Spine=.17, Spine1=.17, Chest=.18, Neck=.05, Head=.12,
              Shoulder_L=.07, Shoulder_R=.07, UpperArm_L=.065, UpperArm_R=.065,
              ForeArm_L=.06, ForeArm_R=.06, Hand_L=.07, Hand_R=.07,
              UpperLeg_L=.11, UpperLeg_R=.11, LowerLeg_L=.07, LowerLeg_R=.07,
              Foot_L=.06, Foot_R=.06, Toe_L=.05, Toe_R=.05)
# gaussian blur sigma (m) of each label field = width of the skin transition
SIGMA = dict(Hips=.05, Spine=.06, Spine1=.06, Chest=.06, Neck=.035, Head=.03,
             Shoulder_L=.04, Shoulder_R=.04, UpperArm_L=.045, UpperArm_R=.045,
             ForeArm_L=.05, ForeArm_R=.05, Hand_L=.02, Hand_R=.02,
             UpperLeg_L=.06, UpperLeg_R=.06, LowerLeg_L=.05, LowerLeg_R=.05,
             Foot_L=.03, Foot_R=.03, Toe_L=.02, Toe_R=.02)


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    c = a + t[:, None] * ab
    return np.linalg.norm(p - c, axis=1)


def gauss_blur(vol, sigma_cells):
    pad = int(math.ceil(3 * sigma_cells)) + 1
    shp = [s + 2 * pad for s in vol.shape]
    shp = [int(2 ** math.ceil(math.log2(s))) if s > 64 else s + (s % 2) for s in shp]
    fv = np.fft.rfftn(vol, s=shp, axes=(0, 1, 2))
    ks = [np.fft.fftfreq(shp[0]), np.fft.fftfreq(shp[1]), np.fft.rfftfreq(shp[2])]
    k2 = (ks[0][:, None, None] ** 2 + ks[1][None, :, None] ** 2 + ks[2][None, None, :] ** 2)
    g = np.exp(-2 * (math.pi ** 2) * (sigma_cells ** 2) * k2)
    out = np.fft.irfftn(fv * g, s=shp, axes=(0, 1, 2))
    return out[:vol.shape[0], :vol.shape[1], :vol.shape[2]]


def compute_weights(co, spec, orig):
    """co: Nx3 scaled coords (armature space). orig: Nx3 orig (L,F,U). returns (N,4 idx),(N,4 w), names"""
    names = [n for n, v in spec.items() if v[3]]
    nb = len(names)
    N = len(co)
    # ---- 1. labels by nearest normalised capsule distance
    dn = np.zeros((N, nb), np.float32)
    for i, n in enumerate(names):
        par, h, t, _ = spec[n]
        a, b = np.array(P(*h)), np.array(P(*t))
        dn[:, i] = seg_dist(co, a, b) / RADIUS[n]
    lab = dn.argmin(1)
    idx = {n: i for i, n in enumerate(names)}
    L, F, U = orig[:, 0], orig[:, 1], orig[:, 2]
    lab[U > 0.715] = idx['Head']
    sword = (L < -0.6) & (U < 0.43)
    fistR = (L < -0.745) & (U >= 0.43)
    handL = L > 0.745
    rigidR = sword | (L < -0.76)
    rigidL = L > 0.76
    lab[sword | fistR] = idx['Hand_R']
    lab[handL] = idx['Hand_L']
    # ---- 2. voxel label fields
    cell = 0.01
    mn = co.min(0) - 0.05
    mx = co.max(0) + 0.05
    dims = np.ceil((mx - mn) / cell).astype(int)
    vi = np.clip(((co - mn) / cell).astype(int), 0, dims - 1)
    cx = mn[0] + (np.arange(dims[0]) + 0.5) * cell
    fields = np.zeros((nb, N), np.float32)
    for i, n in enumerate(names):
        vol = np.zeros(dims, np.float32)
        m = lab == i
        if m.sum() == 0:
            continue
        vol[vi[m, 0], vi[m, 1], vi[m, 2]] = 1.0
        vol = gauss_blur(vol, SIGMA[n] / cell)
        if n.endswith('_L') and n.split('_')[0] in ('UpperLeg', 'LowerLeg', 'Foot', 'Toe'):
            vol *= (cx > 0.0)[:, None, None]
        if n.endswith('_R') and n.split('_')[0] in ('UpperLeg', 'LowerLeg', 'Foot', 'Toe'):
            vol *= (cx < 0.0)[:, None, None]
        fields[i] = vol[vi[:, 0], vi[:, 1], vi[:, 2]]
        print('  field', n, int(m.sum()))
    fields = fields.T
    # a vertex must be influenced by something
    s = fields.sum(1)
    bad = s < 1e-4
    if bad.any():
        print('  vertices without field (use label):', int(bad.sum()))
        fields[bad, lab[bad]] = 1.0
    # ---- 3. top-4, prune, normalise
    top = np.argsort(-fields, axis=1)[:, :4]
    w = np.take_along_axis(fields, top, 1)
    tot = w.sum(1, keepdims=True)
    bad = (tot[:, 0] < 1e-6)
    w = w / np.maximum(tot, 1e-9)
    w[w < 0.02] = 0
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-9)
    top[bad, 0] = lab[bad]
    w[bad] = 0
    w[bad, 0] = 1.0
    # rigid overrides
    for m, nm in ((rigidR, 'Hand_R'), (rigidL, 'Hand_L')):
        top[m, 0] = idx[nm]
        w[m] = 0
        w[m, 0] = 1.0
        top[m, 1:] = 0
    return top, w, names


def load_and_scale():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
    me = obj.data
    co = np.array([v.co[:] for v in me.vertices])
    orig = np.stack([co[:, 0] - XC, -co[:, 1], co[:, 2]], 1)      # (L, F, U) in orig units
    M = (Matrix.Scale(SCALE, 4) @ Matrix.Translation((-XC, 0, 0)) @ Matrix.Identity(4))
    # y: -(F - F0)*S with F=-y  ->  y' = (y - F0*(-1)... ) compute explicitly
    verts = np.zeros_like(co)
    verts[:, 0] = SCALE * orig[:, 0]
    verts[:, 1] = -SCALE * (orig[:, 1] - F0)
    verts[:, 2] = SCALE * (orig[:, 2] - FLOOR)
    # remove any parenting/transform of the imported object
    obj.parent = None
    for o in list(bpy.data.objects):
        if o is not obj:
            bpy.data.objects.remove(o)
    obj.matrix_world = Matrix.Identity(4)
    me.vertices.foreach_set('co', verts.ravel())
    me.update()
    obj.name = 'Aeren'
    me.name = 'AerenMesh'
    return obj, verts, orig


def measure_sword(orig):
    L, F, U = orig[:, 0], orig[:, 1], orig[:, 2]
    tipm = (L < -0.6) & (U < -0.85)
    return dict(L=float(np.median(L[tipm])), F=float(np.median(F[tipm])), tip_u=float(U[tipm].min()),
                base_u=0.23, mid_u=(0.23 + float(U[tipm].min())) / 2)


def create_armature(spec):
    arm = bpy.data.armatures.new('AerenArmature')
    ao = bpy.data.objects.new('Armature', arm)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    ao.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, (par, h, t, dfm) in spec.items():
        b = arm.edit_bones.new(n)
        b.head = P(*h)
        b.tail = P(*t)
        b.roll = 0
        b.use_deform = dfm
        eb[n] = b
    for n, (par, h, t, dfm) in spec.items():
        if par:
            eb[n].parent = eb[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ao


def assign_weights(obj, ao, top, w, names):
    me = obj.data
    for vg in list(obj.vertex_groups):
        obj.vertex_groups.remove(vg)
    groups = [obj.vertex_groups.new(name=n) for n in names]
    bm = bmesh.new()
    bm.from_mesh(me)
    lay = bm.verts.layers.deform.verify()
    bm.verts.ensure_lookup_table()
    for i, v in enumerate(bm.verts):
        d = v[lay]
        for k in range(4):
            if w[i, k] > 0:
                d[groups[top[i, k]].index] = float(w[i, k])
    bm.to_mesh(me)
    bm.free()
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = ao
    obj.parent = ao
    obj.matrix_parent_inverse = Matrix.Identity(4)


def build(save_path=None):
    obj, verts, orig = load_and_scale()
    sword = measure_sword(orig)
    print('sword', sword)
    spec = build_spec(sword)
    ao = create_armature(spec)
    top, w, names = compute_weights(verts, spec, orig)
    assign_weights(obj, ao, top, w, names)
    ao.name = 'Armature'
    if save_path:
        bpy.ops.wm.save_as_mainfile(filepath=save_path)
    return obj, ao, sword


if __name__ == '__main__':
    out = os.path.join(HERE, '_rig_work', 'aeren_rig_base.blend')
    build(out)
    print('saved', out)
