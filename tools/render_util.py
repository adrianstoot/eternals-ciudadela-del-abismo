"""Rendering helpers (run inside Blender, background). Workbench + texture."""
import bpy, math
from mathutils import Vector, Matrix


def setup_scene(res=(600, 800)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'TEXTURE'
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_shadows = False
    sh.studio_light = 'studio.sl' if 'studio.sl' in [l.name for l in bpy.context.preferences.studio_lights] else sh.studio_light
    sc.display.render_aa = '8'
    w = bpy.data.worlds.get('W') or bpy.data.worlds.new('W')
    sc.world = w
    w.use_nodes = False
    w.color = (0.32, 0.34, 0.38)
    sc.view_settings.view_transform = 'Standard'
    return sc


def get_cam():
    cam = bpy.data.objects.get('RCam')
    if cam is None:
        cd = bpy.data.cameras.new('RCam')
        cam = bpy.data.objects.new('RCam', cd)
        bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.data.type = 'ORTHO'
    return cam


# view dirs in blender coords: character faces -Y, right of char = -X
VIEWS = {
    'front': (0, -1, 0),   # camera located at -Y looking +Y: sees character's front
    'back': (0, 1, 0),
    'side': (-1, 0, 0),    # camera at -X : sees character's right side
    'sideL': (1, 0, 0),
    'q34': (-0.6, -0.8, 0.15),
    'q34b': (0.7, -0.7, 0.2),
    'top': (0, -0.001, 1),
}


def render_view(path, view='front', center=(0, 0, 0.9), size=2.0, res=None):
    sc = bpy.context.scene
    if res:
        sc.render.resolution_x, sc.render.resolution_y = res
    cam = get_cam()
    d = Vector(VIEWS[view]).normalized()
    cam.location = Vector(center) + d * 10
    look = (Vector(center) - cam.location).normalized()
    up = Vector((0, 0, 1))
    if abs(look.dot(up)) > 0.99:
        up = Vector((0, 1, 0))
    rot = look.to_track_quat('-Z', 'Y')
    # to_track_quat doesn't use 'up' arg; build matrix manually
    right = look.cross(up).normalized()
    up2 = right.cross(look).normalized()
    m = Matrix((right, up2, -look)).transposed()
    cam.rotation_euler = m.to_euler()
    cam.data.ortho_scale = size
    cam.data.clip_start = 0.1
    cam.data.clip_end = 50
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
