import bpy, json, sys
from mathutils import Vector
out = {}
def bbox(objs):
    mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn[i], w[i]) for i in range(3))); mx = Vector((max(mx[i], w[i]) for i in range(3)))
    return [list(mn), list(mx)]
cols = {}
for c in bpy.data.collections:
    objs = [o for o in c.objects]
    meshes = [o for o in objs if o.type == 'MESH']
    tris = 0
    types = {}
    for o in objs:
        types[o.type] = types.get(o.type, 0) + 1
    for o in meshes:
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    mats = sorted({s.material.name for o in meshes for s in o.material_slots if s.material})
    cols[c.name] = dict(objects=len(objs), types=types, tris=tris, bbox=bbox(meshes) if meshes else None, mats=mats,
                        hidden=sum(1 for o in objs if o.hide_render or o.hide_viewport))
out['collections'] = cols
mats = {}
for m in bpy.data.materials:
    info = dict(users=m.users, nodes=[])
    if m.use_nodes:
        for n in m.node_tree.nodes:
            d = dict(t=n.bl_idname)
            if n.type == 'BSDF_PRINCIPLED':
                for k in ('Base Color', 'Roughness', 'Metallic', 'Emission Color', 'Emission Strength'):
                    try:
                        v = n.inputs[k].default_value
                        d[k] = list(v) if hasattr(v, '__len__') else v
                    except Exception: pass
            if n.type == 'TEX_IMAGE' and n.image: d['img'] = n.image.name; d['size'] = list(n.image.size)
            if n.type == 'EMISSION':
                d['c'] = list(n.inputs['Color'].default_value); d['s'] = n.inputs['Strength'].default_value
            info['nodes'].append(d)
    mats[m.name] = info
out['materials'] = mats
out['lights'] = [dict(n=o.name, t=o.data.type, e=o.data.energy, c=list(o.data.color), loc=list(o.location)) for o in bpy.data.objects if o.type == 'LIGHT']
out['empties'] = [dict(n=o.name, loc=list(o.location)) for o in bpy.data.objects if o.type == 'EMPTY'][:60]
out['cameras'] = [dict(n=o.name, loc=list(o.location), rot=list(o.rotation_euler)) for o in bpy.data.objects if o.type == 'CAMERA']
out['images'] = [dict(n=i.name, size=list(i.size), packed=bool(i.packed_file), fp=i.filepath) for i in bpy.data.images]
out['scene'] = dict(frame=[bpy.context.scene.frame_start, bpy.context.scene.frame_end], fps=bpy.context.scene.render.fps)
# biggest meshes
big = sorted([o for o in bpy.data.objects if o.type == 'MESH'], key=lambda o: -len(o.data.polygons))[:15]
out['biggest'] = [dict(n=o.name, f=len(o.data.polygons), col=[c.name for c in o.users_collection]) for o in big]
json.dump(out, open(sys.argv[sys.argv.index('--') + 1], 'w'), indent=1)
print('DONE')
