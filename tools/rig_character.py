"""Generate all animations on the rigged Aeren model and export game/public/models/aeren.glb + aeren_meta.json.
Run:
  blender --background tools/_rig_work/aeren_rig_base.blend --python tools/rig_character.py
"""
import os, sys, math, json
import bpy
from mathutils import Vector, Quaternion

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
GAME_DIR = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, TOOLS_DIR)

import rig_lib as RL

OUT_GLB = os.path.join(GAME_DIR, 'public', 'models', 'aeren.glb')
OUT_META = os.path.join(GAME_DIR, 'public', 'models', 'aeren_meta.json')
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_tup(a, b, t):
    return tuple(lerp(x, y, t) for x, y in zip(a, b))


def blend_pose(p0, p1, t, ease=True):
    s = RL.smoothstep(t) if ease else t
    out = {}
    keys = set(p0.keys()) | set(p1.keys())
    defaults = {
        'hips_off': (0, 0, 0), 'hips_rot': (0, 0, 0),
        'spine': (0, 0, 0), 'spine1': (0, 0, 0), 'chest': (0, 0, 0),
        'neck': (0, 0, 0), 'head': (0, 0, 0),
        'clav_L': (0, 0, 0), 'clav_R': (0, 0, 0),
        'hand_L': (0.22, 0.08, -0.46), 'hand_R': (-0.22, 0.04, -0.46),
        'elbow_L': (0.42, -0.7, -0.25), 'elbow_R': (-0.42, -0.7, -0.25),
        'foot_L': (0, 0, 0), 'foot_R': (0, 0, 0),
        'footrot_L': (0, 0, 0), 'footrot_R': (0, 0, 0),
        'knee_L': (0.16, 1.0, 0.0), 'knee_R': (-0.16, 1.0, 0.0),
        'toe_L': 0.0, 'toe_R': 0.0,
    }
    for k in keys:
        if k in ('hand_world', 'twist_k'):
            out[k] = p1.get(k, p0.get(k))
            continue
        if k.startswith('handrot_'):
            q0 = Quaternion(p0.get(k, (1, 0, 0, 0)))
            q1 = Quaternion(p1.get(k, (1, 0, 0, 0)))
            if q0.dot(q1) < 0:
                q1 = Quaternion((-q1.w, -q1.x, -q1.y, -q1.z))
            out[k] = tuple(q0.slerp(q1, s))
            continue
        v0 = p0.get(k, defaults.get(k, (0, 0, 0)))
        v1 = p1.get(k, defaults.get(k, (0, 0, 0)))
        if isinstance(v0, (int, float)):
            out[k] = lerp(float(v0), float(v1), s)
        else:
            out[k] = lerp_tup(v0, v1, s)
    return out


def eval_keyframes(kfs, t):
    """kfs: list of (time_norm_0_to_1, pose_dict[, ease_bool])"""
    if t <= kfs[0][0]:
        return kfs[0][1]
    if t >= kfs[-1][0]:
        return kfs[-1][1]
    for i in range(len(kfs) - 1):
        t0, p0 = kfs[i][0], kfs[i][1]
        t1, p1 = kfs[i + 1][0], kfs[i + 1][1]
        ease = kfs[i + 1][2] if len(kfs[i + 1]) > 2 else True
        if t0 <= t <= t1:
            u = (t - t0) / max(1e-6, t1 - t0)
            return blend_pose(p0, p1, u, ease=ease)
    return kfs[-1][1]


# Base combat ready stance (KH / Persona 5 style: slight turn, sword held low-back at right side)
BASE_IDLE = dict(
    hips_off=(0.0, 0.0, -0.04),
    hips_rot=(3, -12, 0),
    spine=(3, 4, 0),
    spine1=(2, 4, 0),
    chest=(2, 5, 0),
    neck=(-2, 0, 0),
    head=(-2, 3, 0),
    clav_L=(0, 4, -4),
    clav_R=(0, -6, -5),
    hand_L=(0.24, 0.14, -0.42),
    hand_R=(-0.25, -0.06, -0.46),
    elbow_L=(0.45, -0.65, -0.25),
    elbow_R=(-0.48, -0.68, -0.22),
    handrot_R=tuple(RL.blade_quat(-28, -22, 18)),
    handrot_L=tuple(RL.hand_quat_fp((0.15, 0.45, -0.88), (-0.9, 0.2, -0.2))),
    foot_L=(0.03, 0.08, 0.0),
    foot_R=(-0.03, -0.09, 0.0),
    footrot_L=(0, 8, 0),
    footrot_R=(0, -14, 0),
)


def make_idle(t):
    ph = t * math.tau
    s = math.sin(ph)
    c = math.cos(ph)
    p = dict(BASE_IDLE)
    p['hips_off'] = (0.008 * s, 0.0, -0.045 + 0.012 * c)
    p['spine'] = (3 + 1.5 * s, 4, 0)
    p['chest'] = (2 + 2.0 * s, 5 + 1.5 * c, 0)
    p['head'] = (-2 - 1.5 * s, 3 - 1.2 * c, 0)
    p['hand_L'] = (0.24 + 0.01 * s, 0.14 + 0.012 * c, -0.42 + 0.018 * s)
    p['hand_R'] = (-0.25 - 0.008 * s, -0.06 - 0.01 * c, -0.46 + 0.015 * s)
    p['handrot_R'] = tuple(RL.blade_quat(-28 + 3 * s, -22 + 2 * c, 18))
    return p


def make_walk(t):
    ph = t * math.tau
    s = math.sin(ph)
    c = math.cos(ph)
    s2 = math.sin(2 * ph)
    stride = 0.28
    liftL = max(0.0, math.sin(ph)) * 0.11
    liftR = max(0.0, math.sin(ph + math.pi)) * 0.11
    return dict(
        hips_off=(0.025 * c, 0.0, -0.055 + 0.022 * s2),
        hips_rot=(6, -8 * s, 2.5 * c),
        spine=(5, 4 * s, -1.5 * c),
        spine1=(4, 5 * s, 0),
        chest=(4, 6 * s, -2 * c),
        neck=(-3, -3 * s, 0),
        head=(-3, -4 * s, 0),
        clav_L=(0, 0, -4),
        clav_R=(0, -4, -5),
        hand_L=(0.24, 0.10 - 0.18 * s, -0.42 + 0.04 * abs(c)),
        hand_R=(-0.26, -0.08 + 0.10 * s, -0.45 + 0.03 * s2),
        elbow_L=(0.45, -0.7, -0.25),
        elbow_R=(-0.50, -0.7, -0.20),
        handrot_R=tuple(RL.blade_quat(-25, -26 + 5 * s, 20)),
        handrot_L=tuple(RL.hand_quat_fp((0.1, 0.4 - 0.3 * s, -0.88), (-0.95, 0.1, -0.2))),
        foot_L=(0.01, stride * s, liftL),
        foot_R=(-0.01, -stride * s, liftR),
        footrot_L=(-22 * max(0.0, -c) + 12 * max(0.0, c), 4, 0),
        footrot_R=(-22 * max(0.0, c) + 12 * max(0.0, -c), -4, 0),
    )


def make_run(t):
    ph = t * math.tau
    s = math.sin(ph)
    c = math.cos(ph)
    s2 = math.sin(2 * ph)
    stride = 0.44
    liftL = max(0.0, math.sin(ph + 0.25)) ** 1.2 * 0.22
    liftR = max(0.0, math.sin(ph + math.pi + 0.25)) ** 1.2 * 0.22
    return dict(
        hips_off=(0.03 * c, 0.03, -0.09 + 0.04 * s2),
        hips_rot=(15, -14 * s, 4 * c),
        spine=(10, 7 * s, -2 * c),
        spine1=(8, 8 * s, 0),
        chest=(8, 10 * s, -3 * c),
        neck=(-8, -6 * s, 0),
        head=(-10, -8 * s, 0),
        clav_L=(0, -6 * s, -3),
        clav_R=(0, -8, -5),
        hand_L=(0.22, 0.16 - 0.30 * s, -0.30 + 0.08 * abs(s)),
        hand_R=(-0.28, -0.18 + 0.12 * s, -0.40 + 0.04 * s2),
        elbow_L=(0.50, -0.75, -0.15),
        elbow_R=(-0.52, -0.75, -0.18),
        handrot_R=tuple(RL.blade_quat(-35, -32 + 6 * s, 28)),
        handrot_L=tuple(RL.hand_quat_fp((0.05, 0.75, -0.65), (-0.95, 0.1, -0.2))),
        foot_L=(0.01, stride * s, liftL),
        foot_R=(-0.01, -stride * s, liftR),
        footrot_L=(-36 * max(0.0, -s) + 14 * max(0.0, s), 3, 0),
        footrot_R=(-36 * max(0.0, s) + 14 * max(0.0, -s), -3, 0),
    )


JUMP_KFS = [
    (0.0, BASE_IDLE),
    (0.28, dict(
        hips_off=(0, -0.03, -0.22), hips_rot=(16, -10, 0),
        spine=(14, 4, 0), spine1=(10, 4, 0), chest=(8, 4, 0), head=(-14, 3, 0),
        hand_L=(0.26, -0.10, -0.46), hand_R=(-0.28, -0.16, -0.48),
        handrot_R=tuple(RL.blade_quat(-32, -30, 22)),
        foot_L=(0.02, 0.10, 0.0), foot_R=(-0.02, -0.12, 0.0),
    )),
    (0.75, dict(
        hips_off=(0, 0.04, 0.18), hips_rot=(-6, -8, 0),
        spine=(-4, 3, 0), spine1=(-3, 3, 0), chest=(-2, 3, 0), head=(4, 2, 0),
        hand_L=(0.28, 0.24, -0.12), hand_R=(-0.28, 0.02, -0.34),
        handrot_R=tuple(RL.blade_quat(-24, -18, 16)),
        handrot_L=tuple(RL.hand_quat_fp((0.2, 0.6, -0.7), (-0.9, 0.2, -0.2))),
        foot_L=(0.03, 0.14, 0.26), foot_R=(-0.03, -0.16, 0.14),
        footrot_L=(-24, 6, 0), footrot_R=(-35, -8, 0),
    )),
    (1.0, dict(
        hips_off=(0, 0.02, 0.14), hips_rot=(2, -8, 0),
        spine=(2, 3, 0), spine1=(2, 3, 0), chest=(2, 3, 0), head=(2, 2, 0),
        hand_L=(0.30, 0.18, -0.18), hand_R=(-0.28, -0.04, -0.38),
        handrot_R=tuple(RL.blade_quat(-26, -24, 18)),
        foot_L=(0.03, 0.12, 0.22), foot_R=(-0.03, -0.14, 0.12),
        footrot_L=(-18, 6, 0), footrot_R=(-28, -8, 0),
    )),
]


def make_fall(t):
    ph = t * math.tau
    s = math.sin(ph)
    return dict(
        hips_off=(0, 0.01, 0.10 + 0.02 * s),
        hips_rot=(6, -8, 0),
        spine=(4, 3, 0), spine1=(3, 3, 0), chest=(3, 3, 0), head=(6, 2, 0),
        hand_L=(0.32, 0.14 + 0.03 * s, -0.16 + 0.03 * s),
        hand_R=(-0.28, -0.05, -0.36 + 0.02 * s),
        handrot_R=tuple(RL.blade_quat(-28, -26 + 4 * s, 20)),
        handrot_L=tuple(RL.hand_quat_fp((0.25, 0.5, -0.8), (-0.9, 0.2, -0.2))),
        foot_L=(0.03, 0.14, 0.18 + 0.02 * s),
        foot_R=(-0.03, -0.12, 0.10 - 0.02 * s),
        footrot_L=(-16, 6, 0), footrot_R=(-26, -8, 0),
    )


LAND_KFS = [
    (0.0, make_fall(0.0)),
    (0.38, dict(
        hips_off=(0, -0.02, -0.24), hips_rot=(18, -10, 0),
        spine=(14, 4, 0), spine1=(10, 4, 0), chest=(8, 4, 0), head=(-12, 3, 0),
        hand_L=(0.28, 0.22, -0.38), hand_R=(-0.28, -0.08, -0.46),
        handrot_R=tuple(RL.blade_quat(-30, -28, 22)),
        foot_L=(0.03, 0.12, 0.0), foot_R=(-0.03, -0.12, 0.0),
    )),
    (1.0, BASE_IDLE),
]

DODGE_KFS = [
    (0.0, BASE_IDLE),
    (0.25, dict(
        hips_off=(0.0, 0.12, -0.28), hips_rot=(28, -18, 6),
        spine=(22, 6, 0), spine1=(16, 6, 0), chest=(14, 8, 0), head=(-22, 6, 0),
        hand_L=(0.30, -0.16, -0.36), hand_R=(-0.30, -0.22, -0.42),
        handrot_R=tuple(RL.blade_quat(-42, -35, 32)),
        foot_L=(0.04, 0.28, 0.04), foot_R=(-0.04, -0.28, 0.12),
        footrot_R=(-35, -10, 0),
    )),
    (0.62, dict(
        hips_off=(0.0, 0.18, -0.20), hips_rot=(20, 8, -4),
        spine=(16, -4, 0), spine1=(12, -4, 0), chest=(10, -4, 0), head=(-16, -4, 0),
        hand_L=(0.24, 0.26, -0.32), hand_R=(-0.26, -0.12, -0.40),
        handrot_R=tuple(RL.blade_quat(-30, -25, 24)),
        foot_L=(0.03, -0.18, 0.08), foot_R=(-0.03, 0.26, 0.0),
    )),
    (1.0, BASE_IDLE),
]

# Attack 1: Wide right-to-left diagonal slash
ATK1_KFS = [
    (0.0, BASE_IDLE),
    # Wind-up: torso twists right, sword raised high on right
    (0.28, dict(
        hips_off=(0.02, -0.04, -0.08), hips_rot=(6, -28, -4),
        spine=(4, -14, 0), spine1=(2, -14, 0), chest=(0, -18, -4), head=(2, 22, 0),
        clav_R=(0, -12, 10),
        hand_R=(-0.34, 0.08, 0.22), elbow_R=(-0.55, -0.45, -0.05),
        handrot_R=tuple(RL.blade_quat(-55, 48, 35)),
        hand_L=(0.26, 0.22, -0.30),
        foot_L=(0.04, 0.18, 0.0), foot_R=(-0.05, -0.16, 0.0),
    )),
    # Mid-slash impact: torso whips left, arm sweeps across chest
    (0.50, dict(
        hips_off=(-0.02, 0.10, -0.12), hips_rot=(12, 18, 4),
        spine=(8, 14, 0), spine1=(6, 14, 0), chest=(6, 18, 4), head=(-8, -16, 0),
        clav_R=(0, 14, -4),
        hand_R=(0.08, 0.48, -0.08), elbow_R=(-0.25, 0.15, -0.22),
        handrot_R=tuple(RL.blade_quat(25, 5, -25)),
        hand_L=(0.30, -0.12, -0.36),
        foot_L=(0.04, 0.24, 0.0), foot_R=(-0.04, -0.18, 0.04),
    ), False),
    # Follow-through: blade finishes low-left
    (0.70, dict(
        hips_off=(-0.03, 0.12, -0.14), hips_rot=(14, 26, 5),
        spine=(10, 18, 0), spine1=(8, 16, 0), chest=(8, 20, 5), head=(-10, -22, 0),
        clav_R=(0, 18, -8),
        hand_R=(0.22, 0.34, -0.28), elbow_R=(-0.10, 0.10, -0.30),
        handrot_R=tuple(RL.blade_quat(72, -22, -35)),
        hand_L=(0.32, -0.18, -0.38),
        foot_L=(0.04, 0.26, 0.0), foot_R=(-0.04, -0.20, 0.05),
    )),
    (1.0, BASE_IDLE),
]

# Attack 2: Reverse backhand sweep left-to-right with step
ATK2_KFS = [
    (0.0, BASE_IDLE),
    # Chamber across body to the left
    (0.26, dict(
        hips_off=(-0.03, 0.04, -0.10), hips_rot=(10, 24, 4),
        spine=(6, 16, 0), spine1=(6, 16, 0), chest=(4, 18, 4), head=(-6, -18, 0),
        clav_R=(0, 16, -4),
        hand_R=(0.18, 0.36, -0.12), elbow_R=(-0.12, 0.12, -0.25),
        handrot_R=tuple(RL.blade_quat(65, -8, -145)),
        hand_L=(0.28, -0.14, -0.36),
        foot_L=(0.04, 0.20, 0.0), foot_R=(-0.04, -0.16, 0.0),
    )),
    # Impact: wide sweep forward-right
    (0.50, dict(
        hips_off=(0.02, 0.12, -0.12), hips_rot=(12, -16, -4),
        spine=(8, -12, 0), spine1=(6, -14, 0), chest=(6, -18, -4), head=(-6, 14, 0),
        clav_R=(0, -8, 4),
        hand_R=(-0.26, 0.46, -0.02), elbow_R=(-0.48, -0.10, -0.18),
        handrot_R=tuple(RL.blade_quat(-20, 8, 155)),
        hand_L=(0.26, 0.16, -0.34),
        foot_L=(0.04, -0.14, 0.04), foot_R=(-0.04, 0.24, 0.0),
    ), False),
    # Follow-through out to the right
    (0.72, dict(
        hips_off=(0.03, 0.14, -0.13), hips_rot=(12, -28, -5),
        spine=(8, -18, 0), spine1=(6, -18, 0), chest=(6, -22, -5), head=(-6, 22, 0),
        clav_R=(0, -14, 4),
        hand_R=(-0.38, 0.18, -0.08), elbow_R=(-0.56, -0.35, -0.18),
        handrot_R=tuple(RL.blade_quat(-68, 4, 160)),
        hand_L=(0.26, 0.22, -0.34),
        foot_L=(0.04, -0.16, 0.05), foot_R=(-0.04, 0.26, 0.0),
    )),
    (1.0, BASE_IDLE),
]

# Attack 3: Heavy leaping overhead crimson cleave
ATK3_KFS = [
    (0.0, BASE_IDLE),
    # Deep crouch & raise blade high overhead
    (0.24, dict(
        hips_off=(0.0, -0.04, -0.20), hips_rot=(14, -14, 0),
        spine=(8, -6, 0), spine1=(4, -6, 0), chest=(-6, -8, 0), head=(8, 8, 0),
        clav_R=(0, -8, 14),
        hand_R=(-0.18, 0.14, 0.36), elbow_R=(-0.45, -0.25, 0.08),
        handrot_R=tuple(RL.blade_quat(-15, 72, 85)),
        hand_L=(0.24, 0.22, 0.05),
        foot_L=(0.04, 0.14, 0.0), foot_R=(-0.04, -0.18, 0.0),
    )),
    # Leap apex with blade cocked back overhead
    (0.44, dict(
        hips_off=(0.0, 0.06, 0.22), hips_rot=(-6, -10, 0),
        spine=(-6, -4, 0), spine1=(-6, -4, 0), chest=(-8, -6, 0), head=(10, 6, 0),
        clav_R=(0, -6, 16),
        hand_R=(-0.14, 0.10, 0.42), elbow_R=(-0.42, -0.20, 0.12),
        handrot_R=tuple(RL.blade_quat(-10, 82, 88)),
        hand_L=(0.28, 0.20, 0.12),
        foot_L=(0.04, 0.18, 0.24), foot_R=(-0.04, -0.20, 0.16),
        footrot_L=(-20, 6, 0), footrot_R=(-32, -8, 0),
    )),
    # Crashing downward cleave impact
    (0.62, dict(
        hips_off=(0.0, 0.18, -0.22), hips_rot=(22, 12, 0),
        spine=(16, 8, 0), spine1=(14, 8, 0), chest=(14, 10, 0), head=(-18, -8, 0),
        clav_R=(0, 12, -8),
        hand_R=(-0.08, 0.48, -0.34), elbow_R=(-0.32, 0.08, -0.26),
        handrot_R=tuple(RL.blade_quat(4, -28, 86)),
        hand_L=(0.30, -0.18, -0.34),
        foot_L=(0.04, 0.30, 0.0), foot_R=(-0.04, -0.24, 0.04),
    ), False),
    # Hold impact & recover
    (0.78, dict(
        hips_off=(0.0, 0.16, -0.20), hips_rot=(18, 10, 0),
        spine=(14, 6, 0), spine1=(10, 6, 0), chest=(10, 8, 0), head=(-14, -6, 0),
        clav_R=(0, 8, -6),
        hand_R=(-0.12, 0.42, -0.38), elbow_R=(-0.35, 0.02, -0.28),
        handrot_R=tuple(RL.blade_quat(2, -34, 82)),
        hand_L=(0.28, -0.12, -0.36),
        foot_L=(0.04, 0.26, 0.0), foot_R=(-0.04, -0.20, 0.02),
    )),
    (1.0, BASE_IDLE),
]

# Cast: Crimson spell charge in left hand -> hurl forward at t=0.50
CAST_KFS = [
    (0.0, BASE_IDLE),
    # Charge: left hand drawn back & up gathering crimson energy, sword swept back-right
    (0.32, dict(
        hips_off=(0.02, -0.06, -0.10), hips_rot=(6, 22, 0),
        spine=(4, 14, 0), spine1=(2, 14, 0), chest=(0, 18, 0), head=(2, -18, 0),
        clav_L=(0, -12, 8), clav_R=(0, -10, -6),
        hand_L=(0.34, -0.06, 0.08), elbow_L=(0.52, -0.55, -0.12),
        handrot_L=tuple(RL.hand_quat_fp((0.2, 0.85, 0.45), (0.0, 0.45, -0.88))),
        hand_R=(-0.30, -0.18, -0.44),
        handrot_R=tuple(RL.blade_quat(-45, -28, 25)),
        foot_L=(0.04, -0.14, 0.0), foot_R=(-0.04, 0.18, 0.0),
    )),
    # Release: left arm thrusts straight forward with open palm, torso drives into the cast
    (0.52, dict(
        hips_off=(-0.02, 0.14, -0.12), hips_rot=(12, -14, 0),
        spine=(8, -8, 0), spine1=(6, -10, 0), chest=(6, -12, 0), head=(-8, 12, 0),
        clav_L=(0, 14, 2), clav_R=(0, -10, -6),
        hand_L=(-0.08, 0.62, -0.02), elbow_L=(0.26, 0.22, -0.18),
        handrot_L=tuple(RL.hand_quat_fp((-0.1, 0.35, 0.93), (-0.2, 0.92, -0.34))),
        hand_R=(-0.28, -0.18, -0.44),
        handrot_R=tuple(RL.blade_quat(-38, -28, 22)),
        foot_L=(0.04, 0.26, 0.0), foot_R=(-0.04, -0.20, 0.04),
    ), False),
    # Hold heroic cast pose
    (0.74, dict(
        hips_off=(-0.02, 0.12, -0.10), hips_rot=(10, -12, 0),
        spine=(6, -8, 0), spine1=(5, -8, 0), chest=(5, -10, 0), head=(-6, 10, 0),
        clav_L=(0, 12, 2),
        hand_L=(-0.06, 0.58, -0.04), elbow_L=(0.28, 0.18, -0.20),
        handrot_L=tuple(RL.hand_quat_fp((-0.1, 0.35, 0.93), (-0.2, 0.92, -0.34))),
        hand_R=(-0.28, -0.16, -0.44),
        handrot_R=tuple(RL.blade_quat(-35, -26, 20)),
        foot_L=(0.04, 0.22, 0.0), foot_R=(-0.04, -0.18, 0.02),
    )),
    (1.0, BASE_IDLE),
]

HIT_KFS = [
    (0.0, BASE_IDLE),
    (0.28, dict(
        hips_off=(0.0, -0.10, -0.10), hips_rot=(-12, -18, -4),
        spine=(-10, -8, 0), spine1=(-8, -6, 0), chest=(-10, -8, 0), head=(16, 10, 0),
        hand_L=(0.32, 0.18, -0.22), hand_R=(-0.32, 0.04, -0.36),
        handrot_R=tuple(RL.blade_quat(-38, -12, 24)),
        foot_L=(0.04, 0.12, 0.04), foot_R=(-0.04, -0.16, 0.0),
    ), False),
    (1.0, BASE_IDLE),
]

DEATH_KFS = [
    (0.0, BASE_IDLE),
    (0.25, HIT_KFS[1][1]),
    (0.60, dict(
        hips_off=(0.0, -0.12, -0.46), hips_rot=(24, -10, 0),
        spine=(18, 0, 0), spine1=(14, 0, 0), chest=(12, 0, 0), head=(20, 0, 0),
        hand_L=(0.26, 0.24, -0.38), hand_R=(-0.28, 0.12, -0.42),
        handrot_R=tuple(RL.blade_quat(-20, -5, 80)),
        foot_L=(0.04, -0.10, 0.0), foot_R=(-0.04, -0.22, 0.0),
    )),
    (1.0, dict(
        hips_off=(0.0, -0.18, -0.58), hips_rot=(42, -8, 6),
        spine=(26, 0, 0), spine1=(20, 0, 0), chest=(18, 0, 0), head=(26, 8, 0),
        hand_L=(0.24, 0.32, -0.42), hand_R=(-0.30, 0.18, -0.44),
        handrot_R=tuple(RL.blade_quat(-15, 0, 88)),
        foot_L=(0.04, -0.18, 0.0), foot_R=(-0.04, -0.28, 0.0),
    )),
]

CLIPS = [
    dict(name='Idle', frames=90, loop=True, fn=make_idle, events={}),
    dict(name='Walk', frames=30, loop=True, fn=make_walk, events={'step': [0.25, 0.75]}),
    dict(name='Run', frames=20, loop=True, fn=make_run, events={'step': [0.22, 0.72]}),
    dict(name='Jump', frames=16, loop=False, fn=lambda t: eval_keyframes(JUMP_KFS, t), events={}),
    dict(name='Fall', frames=24, loop=True, fn=make_fall, events={}),
    dict(name='Land', frames=12, loop=False, fn=lambda t: eval_keyframes(LAND_KFS, t), events={'land': [0.10]}),
    dict(name='Dodge', frames=18, loop=False, fn=lambda t: eval_keyframes(DODGE_KFS, t), events={'whoosh': [0.12]}),
    dict(name='Attack1', frames=18, loop=False, fn=lambda t: eval_keyframes(ATK1_KFS, t),
         events={'hit': [0.26], 'slash_window': [0.16, 0.42]}),
    dict(name='Attack2', frames=18, loop=False, fn=lambda t: eval_keyframes(ATK2_KFS, t),
         events={'hit': [0.26], 'slash_window': [0.15, 0.42]}),
    dict(name='Attack3', frames=26, loop=False, fn=lambda t: eval_keyframes(ATK3_KFS, t),
         events={'hit': [0.50], 'slash_window': [0.36, 0.66]}),
    dict(name='Cast', frames=32, loop=False, fn=lambda t: eval_keyframes(CAST_KFS, t),
         events={'charge': [0.10], 'release': [0.52]}),
    dict(name='Hit', frames=15, loop=False, fn=lambda t: eval_keyframes(HIT_KFS, t), events={}),
    dict(name='Death', frames=45, loop=False, fn=lambda t: eval_keyframes(DEATH_KFS, t), events={}),
]


def main():
    sc = bpy.context.scene
    sc.render.fps = 30
    ao = bpy.data.objects['Armature']
    rig = RL.Rig(ao)

    # Clear old actions & NLA tracks
    if ao.animation_data:
        ao.animation_data_clear()
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)

    ao.animation_data_create()
    loc_keys = {'Root', 'Hips'}
    meta_clips = {}

    for c in CLIPS:
        name = c['name']
        nf = c['frames']
        loop = c['loop']
        fn = c['fn']
        act = bpy.data.actions.new(name=name)
        act.use_fake_user = True
        ao.animation_data.action = act
        prev = {}
        for f in range(nf + 1):
            t = (f / nf) if not loop else ((f % nf) / nf)
            pose_dict = fn(t)
            out = rig.solve(pose_dict)
            RL.apply_pose(ao, out, frame=f + 1, keys=loc_keys, prev=prev)
            for bn, (_, q) in out.items():
                prev[bn] = q

        # Push to NLA track so glTF exporter writes every clip cleanly
        trk = ao.animation_data.nla_tracks.new()
        trk.name = name
        strip = trk.strips.new(name, 1, act)
        strip.name = name
        trk.mute = False

        meta_clips[name] = dict(
            duration=round(nf / 30.0, 4),
            frames=nf,
            loop=loop,
            events=c['events'],
        )
        print(f'[RIG] Baked clip {name}: {nf}f ({nf/30:.2f}s)')

    ao.animation_data.action = bpy.data.actions.get('Idle')

    # Downscale character textures to 2048 max so GLB stays fast to load
    for img in bpy.data.images:
        if img.size[0] > 2048 or img.size[1] > 2048:
            img.scale(2048, 2048)

    # Export GLB
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_skins=True,
        export_all_influences=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_nla_strips=True,
        export_optimize_animation_size=False,
        export_frame_range=False,
        export_image_format='JPEG',
        export_jpeg_quality=90,
    )

    meta = dict(
        bones=dict(
            root='Root', hips='Hips', spine='Spine', spine1='Spine1', chest='Chest',
            neck='Neck', head='Head',
            hand_R='Hand_R', hand_L='Hand_L',
            foot_L='Foot_L', foot_R='Foot_R',
        ),
        fx_nodes=dict(
            SwordBase='SwordBase',
            SwordMid='SwordMid',
            SwordTip='SwordTip',
            HandL_FX='HandL_FX',
            HandR_FX='HandR_FX',
        ),
        clips=meta_clips,
    )
    with open(OUT_META, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
    print('[RIG] Exported:', OUT_GLB, round(os.path.getsize(OUT_GLB) / 1048576, 2), 'MB')


if __name__ == '__main__':
    main()
