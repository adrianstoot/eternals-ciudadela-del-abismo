"""Pose solver for the Aeren rig (runs inside Blender).

Character space convention used when AUTHORING poses: (L, F, U) =
  L = towards the character's LEFT, F = forward, U = up   (metres)
Armature/Blender axes: x = L, y = -F, z = U   (character faces -Y, exported as +Z in glTF).
"""
import math
import bpy
from mathutils import Matrix, Vector, Quaternion, Euler

# ----------------------------------------------------------------- helpers

def cv(L, F, U):
    """character (L,F,U) -> armature vector"""
    return Vector((L, -F, U))


def cvv(t):
    return cv(*t)


def rot_x(d):
    return Matrix.Rotation(math.radians(d), 3, 'X')


def rot_y(d):
    return Matrix.Rotation(math.radians(d), 3, 'Y')


def rot_z(d):
    return Matrix.Rotation(math.radians(d), 3, 'Z')


def rot_euler(p, y, r):
    """pitch (lean forward +), yaw (turn left +), roll (tilt to the right +), degrees,
    expressed about armature axes. pitch about +X, yaw about +Z, roll about forward (-Y)."""
    return rot_z(y) @ Matrix.Rotation(math.radians(r), 3, Vector((0, -1, 0))) @ rot_x(p)


def frame3(a, b):
    """orthonormal frame matrix (columns) from primary axis a and secondary hint b"""
    a = Vector(a).normalized()
    b = Vector(b)
    b = b - a * b.dot(a)
    if b.length < 1e-6:
        t = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 1, 0))
        b = t - a * t.dot(a)
    b.normalize()
    c = a.cross(b)
    return Matrix((a, b, c)).transposed()


def align(u1, u2, v1, v2):
    """rotation R with R u1 = v1 (exactly) and R u2 ~ v2 (in plane)"""
    return frame3(v1, v2) @ frame3(u1, u2).inverted()


def blade_quat(az, el, roll):
    """sword world-orientation delta (relative to T-pose where blade hangs down, edge along X) such that
    the blade tip points at (azimuth az from forward towards left, elevation el) in character space.
    roll=0 -> flat of the blade horizontal (edge sideways); roll=90 -> edge up/down. Returns Quaternion."""
    a, e = math.radians(az), math.radians(el)
    b = cv(math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e))
    up = Vector((0, 0, 1))
    w = up.cross(b)
    if w.length < 0.15:
        w = Vector((1, 0, 0))
    w.normalize()
    w = Matrix.Rotation(math.radians(roll), 3, b) @ w
    R = align(Vector((0, 0, -1)), Vector((1, 0, 0)), b, w)
    return R.to_quaternion()


def hand_quat_fp(fing, palm):
    """left-hand orientation delta from finger direction & palm-normal direction (character space tuples).
    Rest (T-pose): fingers -> +X (L), palm normal -> -Z (down)."""
    R = align(Vector((1, 0, 0)), Vector((0, 0, -1)), cvv(fing), cvv(palm))
    return R.to_quaternion()


def smoothstep(t):
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------- rig

CHAIN_ORDER = None


class Rig:
    def __init__(self, obj):
        self.obj = obj
        arm = obj.data
        self.rest = {}
        for b in arm.bones:
            m = b.matrix_local.copy()
            self.rest[b.name] = dict(
                M=m, R3=m.to_3x3(), head=m.translation.copy(),
                tail=(m @ Vector((0, b.length, 0))), length=b.length,
                parent=b.parent.name if b.parent else None)
        # parent-first order
        order = []
        def visit(b):
            order.append(b.name)
            for c in b.children:
                visit(c)
        for b in arm.bones:
            if b.parent is None:
                visit(b)
        self.order = order
        r = self.rest
        self.l_upper = {s: r['UpperArm_' + s]['length'] for s in 'LR'}
        self.l_fore = {s: r['ForeArm_' + s]['length'] for s in 'LR'}
        self.l_thigh = {s: r['UpperLeg_' + s]['length'] for s in 'LR'}
        self.l_shin = {s: r['LowerLeg_' + s]['length'] for s in 'LR'}

    # ---- two bone IK
    @staticmethod
    def ik2(S, T, l1, l2, pole):
        d = T - S
        dist = d.length
        dist = max(min(dist, (l1 + l2) * 0.9995), abs(l1 - l2) + 1e-4)
        u = d.normalized()
        a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
        h = math.sqrt(max(l1 * l1 - a * a, 0.0))
        pv = pole - u * pole.dot(u)
        if pv.length < 1e-5:
            pv = Vector((0, 1, 0)) - u * u.y
        pv.normalize()
        E = S + u * a + pv * h
        Tc = S + u * dist
        return E, Tc, pv

    def solve(self, pp):
        """pp: dict of pose params -> dict bone -> (loc Vector, rot Quaternion) in LOCAL pose basis"""
        r = self.rest
        P = {}   # name -> dict(rot3 (posed orientation), head, D)

        def setb(name, rot3, head=None):
            ro = r[name]
            if head is None:
                par = r[name]['parent']
                pp_ = P[par]
                head = pp_['head'] + pp_['D'] @ (ro['head'] - r[par]['head'])
            P[name] = dict(rot3=rot3, head=head, D=rot3 @ ro['R3'].inverted())

        def fk(name, d=None, parent_D=None):
            """rotate by delta d (armature axes, before parent deformation)"""
            par = r[name]['parent']
            D = P[par]['D'] @ (rot_euler(*d) if d else Matrix.Identity(3))
            setb(name, D @ r[name]['R3'])

        g = pp.get
        setb('Root', r['Root']['R3'], r['Root']['head'].copy())
        # hips
        ho = cvv(g('hips_off', (0, 0, 0)))
        Dh = rot_euler(*g('hips_rot', (0, 0, 0)))
        setb('Hips', Dh @ r['Hips']['R3'], r['Hips']['head'] + ho)
        for n, k in (('Spine', 'spine'), ('Spine1', 'spine1'), ('Chest', 'chest'),
                     ('Neck', 'neck'), ('Head', 'head')):
            fk(n, g(k, (0, 0, 0)))
        Dchest = P['Chest']['D']
        # extra roots for twist-limiting? none
        for s, sg in (('L', 1), ('R', -1)):
            cl = g('clav_' + s, (0, 0, 0))
            fk('Shoulder_' + s, cl)
            # ---------------- arm IK
            Sh = P['Shoulder_' + s]
            # UpperArm head position by parent offset
            rU = r['UpperArm_' + s]
            S = Sh['head'] + Sh['D'] @ (rU['head'] - r['Shoulder_' + s]['head'])
            off = cvv(g('hand_' + s, (sg * 0.25, 0.0, -0.45)))
            T = S + Dchest @ off
            pole = Dchest @ cvv(g('elbow_' + s, (sg * 0.4, -0.8, -0.3)))
            E, Tc, pv = self.ik2(S, T, self.l_upper[s], self.l_fore[s], pole)
            d1 = (E - S).normalized()
            d2 = (Tc - E).normalized()
            restpole = Vector((0, 1, 0))
            # upper arm: bone-local pole axis from rest frame
            for nm, dd in (('UpperArm_' + s, d1), ('ForeArm_' + s, d2)):
                R3 = r[nm]['R3']
                pl = R3.inverted() @ restpole
                pl = pl - Vector((0, 1, 0)) * pl.y
                if pl.length < 1e-5:
                    pl = Vector((0, 0, 1))
                tgt = align(Vector((0, 1, 0)), pl, dd, pv) @ Matrix.Identity(3)
                # tgt maps local -> armature; local = identity => rotation in armature = tgt (relative to rest bone frame)
                rot3 = align(R3 @ Vector((0, 1, 0)), restpole, dd, pv) @ R3
                setb(nm, rot3, S if nm.startswith('Upper') else E)
            # hand orientation
            hq = g('handrot_' + s)
            Rh0 = r['Hand_' + s]['R3']
            if hq is None:
                hD = Matrix.Identity(3)
            else:
                hD = (Dchest @ Quaternion(hq).to_matrix()) if not g('hand_world', False) else Quaternion(hq).to_matrix()
            hrot = hD @ Rh0
            # swing-twist: move 50% of forearm-axis twist onto forearm
            Rf = P['ForeArm_' + s]['rot3']
            rel = Rf.inverted() @ hrot
            q = rel.to_quaternion()
            tw = 2 * math.atan2(q.y, q.w)
            if tw > math.pi:
                tw -= 2 * math.pi
            if tw < -math.pi:
                tw += 2 * math.pi
            k = g('twist_k', 0.5)
            Rf2 = Rf @ Matrix.Rotation(tw * k, 3, 'Y')
            setb('ForeArm_' + s, Rf2, E)
            setb('Hand_' + s, hrot, Tc)
        # ---------------- legs
        for s, sg in (('L', 1), ('R', -1)):
            rU = r['UpperLeg_' + s]
            Hp = P['Hips']
            Hh = Hp['head'] + Hp['D'] @ (rU['head'] - r['Hips']['head'])
            ank_rest = r['LowerLeg_' + s]['tail']
            fo = cvv(g('foot_' + s, (0, 0, 0)))
            A = ank_rest + fo
            fr = g('footrot_' + s, (0, 0, 0))
            kp = cvv(g('knee_' + s, (sg * 0.15, 1.0, 0.0)))
            pole = Hp['D'] @ kp
            E, Tc, pv = self.ik2(Hh, A, self.l_thigh[s], self.l_shin[s], pole)
            d1 = (E - Hh).normalized()
            d2 = (Tc - E).normalized()
            restpole = Vector((0, -1, 0))
            for nm, dd in (('UpperLeg_' + s, d1), ('LowerLeg_' + s, d2)):
                R3 = r[nm]['R3']
                rot3 = align(R3 @ Vector((0, 1, 0)), restpole, dd, pv) @ R3
                setb(nm, rot3, Hh if nm.startswith('Upper') else E)
            Rfoot = rot_euler(*fr) @ r['Foot_' + s]['R3']
            setb('Foot_' + s, Rfoot, Tc)
            tp = g('toe_' + s, 0.0)
            setb('Toe_' + s, P['Foot_' + s]['D'] @ rot_x(tp) @ r['Toe_' + s]['R3'])
        # ---------------- remaining (fx / sword / other) bones: follow parents
        for n in self.order:
            if n not in P:
                par = r[n]['parent']
                setb(n, P[par]['D'] @ r[n]['R3'])
        self.P = P
        # ---------------- convert to local basis
        out = {}
        for n in self.order:
            par = r[n]['parent']
            ro = r[n]
            if par is None:
                parent_M = Matrix.Identity(4)
                restrel = ro['M']
                # root: Pose = Rest @ basis
                Pm = Matrix.Translation(P[n]['head']) @ P[n]['rot3'].to_4x4()
                basis = ro['M'].inverted() @ Pm
            else:
                pm = Matrix.Translation(P[par]['head']) @ P[par]['rot3'].to_4x4()
                Rp = r[par]['M']
                Pm_par = pm
                base = Pm_par @ Rp.inverted() @ ro['M']
                Pm = Matrix.Translation(P[n]['head']) @ P[n]['rot3'].to_4x4()
                basis = base.inverted() @ Pm
            out[n] = (basis.to_translation(), basis.to_quaternion())
        return out


def apply_pose(obj, out, frame=None, keys=None, prev=None):
    """write local basis to pose bones; optionally key them"""
    for n, (loc, q) in out.items():
        pb = obj.pose.bones[n]
        pb.rotation_mode = 'QUATERNION'
        if prev is not None and n in prev:
            if q.dot(prev[n]) < 0:
                q = Quaternion((-q.w, -q.x, -q.y, -q.z))
        pb.rotation_quaternion = q
        pb.location = loc
        out[n] = (loc, q)
        if frame is not None:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            if keys is None or n in keys:
                pb.keyframe_insert('location', frame=frame)
