import bpy, json, sys, re, collections
res = {}
for c in bpy.data.collections:
    if not c.name[:2].isdigit(): continue
    permat = collections.Counter()
    groups = collections.defaultdict(lambda: [0, 0, set()])
    for o in c.objects:
        if o.type != 'MESH':
            g = groups[re.sub(r'[\._]?\d+', '#', o.name) + ':' + o.type]; g[0] += 1; continue
        me = o.data
        for p in me.polygons:
            m = o.material_slots[p.material_index].material.name if p.material_index < len(o.material_slots) and o.material_slots[p.material_index].material else 'NONE'
            permat[m] += len(p.vertices) - 2
        key = re.sub(r'[\._]?\d+', '#', o.name)
        g = groups[key]; g[0] += 1; g[1] += len(me.polygons)
        g[2].update(s.material.name for s in o.material_slots if s.material and any(True for _ in [0]))
    res[c.name] = dict(permat=dict(permat), groups={k: [v[0], v[1]] for k, v in groups.items()})
# modifiers/particles/instances
mods = collections.Counter()
for o in bpy.data.objects:
    for m in o.modifiers: mods[m.type + ':' + m.name[:20]] += 1
    if o.instance_type != 'NONE': mods['INST:' + o.instance_type] += 1
    if o.animation_data and o.animation_data.drivers: mods['DRV'] += 1
res['mods'] = dict(mods)
res['fx_objs'] = [dict(n=o.name, t=o.type, loc=[round(x, 1) for x in o.location], dim=[round(x, 1) for x in o.dimensions], hide=o.hide_render, mats=[s.material.name for s in o.material_slots if s.material][:3]) for o in bpy.data.collections['06_ABISMO_NIEBLA_ENERGIA'].objects]
json.dump(res, open(sys.argv[sys.argv.index('--') + 1], 'w'), indent=1)
print('DONE')
