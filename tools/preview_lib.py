"""Preview helpers: render posed character (+ optional bone sticks) into contact sheets."""
import os, sys, math, subprocess
import bpy, bmesh
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_util as R

SHEET_PY = os.path.join(HERE, '_rig_work', 'sheet.py')
TMP = os.path.join(HERE, '_rig_work', 'frames')


def bone_viz(ao, name='BoneViz', skip=()):
    """(re)build a mesh with sticks for every bone in current pose (world space)"""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for pb in ao.pose.bones:
        if pb.name in skip:
            continue
        h = ao.matrix_world @ pb.head
        t = ao.matrix_world @ pb.tail
        d = t - h
        if d.length < 1e-5:
            continue
        a = d.normalized()
        s = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
        x = a.cross(s).normalized() * 0.012
        y = a.cross(x).normalized() * 0.012
        vs = [bm.verts.new(h + x), bm.verts.new(h + y), bm.verts.new(h - x), bm.verts.new(h - y), bm.verts.new(t)]
        bm.faces.new(vs[:4])
        for i in range(4):
            bm.faces.new((vs[i], vs[(i + 1) % 4], vs[4]))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.get('BoneMat') or bpy.data.materials.new('BoneMat')
    mat.diffuse_color = (1.0, 0.1, 0.1, 1)
    me.materials.append(mat)
    ob.show_in_front = True
    return ob


def render_sheet(ao, frames_fn, n, out_png, views=('front', 'side'), res=(300, 420), center=(0, 0, 0.9),
                 size=2.1, bones=False, cols=None, mesh_obj=None):
    """frames_fn(i) poses the rig for sample i. renders n samples x views into one PNG"""
    os.makedirs(TMP, exist_ok=True)
    sc = bpy.context.scene
    R.setup_scene(res)
    files = []
    for i in range(n):
        frames_fn(i)
        bpy.context.view_layer.update()
        if bones:
            bone_viz(ao)
        for v in views:
            f = os.path.join(TMP, 'f_%03d_%s.png' % (i, v))
            R.render_view(f, v, center, size)
            files.append(f)
    cols = cols or len(views)
    subprocess.run(['python', SHEET_PY, out_png, str(cols), str(len(views))] + files)
