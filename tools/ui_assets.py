"""Builds the HUD/UI assets from the concept-art PNGs in 'assets y personajes'.
python tools/ui_assets.py
Outputs -> public/ui/*.png (+ ui_meta.json with geometry used by the CSS)
"""
import json, os
import numpy as np
import cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(os.path.dirname(ROOT), 'assets y personajes')
OUT = os.path.join(ROOT, 'public', 'ui'); os.makedirs(OUT, exist_ok=True)
F = lambda s: os.path.join(SRC, 'Imagen de ChatGPT 25 oct 2026, %s.png' % s)
meta = {}

def load(name):
    return np.array(Image.open(F(name)).convert('RGBA'))

def save(arr, name, crop=None, scale=None):
    im = Image.fromarray(arr.astype(np.uint8), 'RGBA')
    if crop: im = im.crop(crop)
    if scale: im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    im.save(os.path.join(OUT, name), optimize=True)
    return im.size

def inpaint(rgba, mask, r=7):
    rgb = cv2.cvtColor(rgba[..., :3].astype(np.uint8), cv2.COLOR_RGB2BGR)
    res = cv2.inpaint(rgb, mask.astype(np.uint8) * 255, r, cv2.INPAINT_TELEA)
    out = rgba.copy(); out[..., :3] = cv2.cvtColor(res, cv2.COLOR_BGR2RGB)
    return out

def add_grain(rgba, mask, amount=10, seed=1):
    rng = np.random.default_rng(seed)
    n = rng.normal(0, amount, rgba.shape[:2])
    n = cv2.GaussianBlur(n, (0, 0), 1.2)
    out = rgba.astype(np.float32)
    out[..., :3] += (n * mask)[..., None]
    return np.clip(out, 0, 255)

def text_mask(rgba, box, thr=150, dil=7, red=False):
    x0, y0, x1, y1 = box
    sub = rgba[y0:y1, x0:x1, :3].astype(int)
    if red:  # white/pink glyphs over red: high G and B
        m = (sub[..., 1] > 120) & (sub[..., 2] > 120)
    else:
        m = sub.min(2) > thr
    m = m.astype(np.uint8)
    m = cv2.dilate(m, np.ones((3, 3), np.uint8), iterations=dil)
    full = np.zeros(rgba.shape[:2], np.uint8); full[y0:y1, x0:x1] = m
    return full

# ------------------------------------------------------------------ command menu plates
menu = load('01_47_45')
rows = {'header': (76, 282), 'selected': (282, 468), 'normal': (470, 630), 'normal2': (632, 795), 'normal3': (796, 954)}
# header: keep the star icon, remove "Comandos"
hm = text_mask(menu, (365, 120, 1060, 262), thr=140, dil=6)
m2 = inpaint(menu, hm, 9); m2 = add_grain(m2, hm.astype(np.float32), 9, 3)
meta['plate_header'] = save(m2, 'plate_header.png', (130, 70, 1330, 285), 0.5)
sm = text_mask(menu, (300, 318, 760, 440), red=True, dil=6)
m3 = inpaint(menu, sm, 9); m3 = add_grain(m3, sm.astype(np.float32), 12, 4)
meta['plate_selected'] = save(m3, 'plate_selected.png', (130, 280, 1405, 470), 0.5)
nm = text_mask(menu, (300, 490, 700, 615), thr=140, dil=6)
m4 = inpaint(menu, nm, 9); m4 = add_grain(m4, nm.astype(np.float32), 9, 5)
meta['plate_normal'] = save(m4, 'plate_normal.png', (140, 466, 1405, 632), 0.5)

# ------------------------------------------------------------------ status panel (portrait + HP/MP)
hud = load('01_47_05').astype(np.float32)
H, W = hud.shape[:2]
# bar fill masks: saturated, opaque pixels inside the bar bands
sat = hud[..., :3].max(2) - hud[..., :3].min(2)
yy, xx = np.mgrid[0:H, 0:W]
hp_band = (yy >= 426) & (yy <= 481) & (xx >= 745) & (xx <= 2045)
mp_band = (yy >= 516) & (yy <= 561) & (xx >= 760) & (xx <= 1990)
hp_fill = hp_band & (sat > 70) & (hud[..., 3] > 150)
mp_fill = mp_band & (sat > 70) & (hud[..., 3] > 150)
hp_fill = cv2.morphologyEx(hp_fill.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)
mp_fill = cv2.morphologyEx(mp_fill.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool)
# frame: empty tracks
frame = hud.copy()
track = np.array([16, 14, 18], np.float32)
for m in (hp_fill, mp_fill):
    md = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2).astype(bool)
    md &= (hp_band | mp_band) & (sat > 25)
    frame[md, :3] = track
# erase baked stats row ("Nv. 41 | HT | VIT 3560 | MP 240") but keep separators/frame
st = text_mask(hud.astype(np.uint8), (735, 300, 2030, 392), thr=150, dil=5)
frame = inpaint(frame.astype(np.uint8), st, 7).astype(np.float32)
frame = add_grain(frame, st.astype(np.float32) * .6, 6, 7)
# HP fill layer = original gradient
hpl = np.zeros_like(hud); hpl[hp_fill] = hud[hp_fill]
# MP fill layer: stretch the existing (partial) gradient to the full track length
mpl = np.zeros_like(hud)
mxs = np.where(mp_fill[:, :1640].any(0))[0]; fx0, fx1 = mxs.min() + 6, min(mxs.max(), 1625)
track_x1 = 1985
src = hud[516:562].copy()
srcm = mp_fill[516:562]
# fill colours by column (median per column), then remap columns
cols = []
for x in range(fx0, fx1 + 1):
    c = src[:, x - 0][srcm[:, x]]
    cols.append(np.median(c[:, :3], 0) if len(c) else np.array([0, 0, 0]))
cols = np.array(cols)
# full track shape: parallelogram same slant as HP track (top-left x ~ 804, slant ~ -1px/row)
for y in range(516, 562):
    row_x0 = int(804 - (y - 522) * 1.0)
    row_x1 = int(1980 - (y - 530) * 0.55)
    if y < 520 or y > 558: continue
    for x in range(row_x0, row_x1):
        t = (x - row_x0) / max(1, row_x1 - row_x0)
        c = cols[min(len(cols) - 1, int(t * (len(cols) - 1)))]
        shade = 1.0 + 0.25 * np.exp(-((y - 530) / 5.0) ** 2)  # glossy highlight
        mpl[y, x, :3] = np.clip(c * shade, 0, 255); mpl[y, x, 3] = 255
    frame[y, row_x0:row_x1, :3] = track
# soften alpha edges of the MP layer
mpl[..., 3] = cv2.GaussianBlur(mpl[..., 3], (3, 3), 0)
crop = (20, 5, 2145, 712)
meta['hud_frame'] = save(frame, 'hud_frame.png', crop, 0.5)
save(hpl, 'hud_hp.png', crop, 0.5); save(mpl, 'hud_mp.png', crop, 0.5)
# bar geometry (in cropped+scaled px) for CSS clipping
def bx(xa, xb): return [round((xa - crop[0]) * .5, 1), round((xb - crop[0]) * .5, 1)]
hx = np.where(hp_fill.any(0))[0]
meta['hp_x'] = bx(hx.min(), hx.max()); meta['mp_x'] = bx(800, 1985)
meta['stats_box'] = [round((735 - crop[0]) * .5), round((300 - crop[1]) * .5), round((2030 - crop[0]) * .5), round((392 - crop[1]) * .5)]

# ------------------------------------------------------------------ party portraits
party = load('01_48_18')
# three circular medallions of equal width
for i, name in enumerate(['party_lyra', 'party_nix', 'party_aeren']):
    x0 = int(i * 2181 / 3); x1 = int((i + 1) * 2181 / 3)
    sub = party[:, x0:x1]
    al = sub[..., 3] > 20
    ys, xs = np.where(al)
    meta[name] = save(party, name + '.png', (x0 + xs.min(), ys.min(), x0 + xs.max() + 1, ys.max() + 1), 0.35)

# ------------------------------------------------------------------ limit gauge
lim = load('01_49_01').astype(np.float32)
Hh, Ww = lim.shape[:2]
r, g, b = lim[..., 0], lim[..., 1], lim[..., 2]
yellow = (r > 170) & (g > 40) & (b < 120) & (r - b > 110) & (r - g < 170) & (lim[..., 3] > 150)
yy, xx = np.mgrid[0:Hh, 0:Ww]
# exclude the gold "Límite" lettering (gold text sits in y 430-540, x 360-760)
yellow &= ~((yy > 420) & (yy < 545) & (xx > 340) & (xx < 780))
yellow = cv2.morphologyEx(yellow.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(bool)
lin = yellow & (yy > 548)
arc = yellow & (yy <= 548)
lframe = lim.copy()
lframe[yellow, :3] = lframe[yellow, :3] * np.array([.10, .07, .06])
lframe[yellow, :3] += 12
lin_l = np.zeros_like(lim); lin_l[lin] = lim[lin]
arc_l = np.zeros_like(lim); arc_l[arc] = lim[arc]
al = lim[..., 3] > 20; ys, xs = np.where(al)
lcrop = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
meta['limit_frame'] = save(lframe, 'limit_frame.png', lcrop, 0.4)
save(lin_l, 'limit_bar.png', lcrop, 0.4); save(arc_l, 'limit_arc.png', lcrop, 0.4)
lx = np.where(lin.any(0))[0]
ay, ax = np.where(arc)
# arc centre: fit circle to the arc pixels (algebraic least squares)
A = np.c_[2 * ax, 2 * ay, np.ones(len(ax))]; bb = ax ** 2 + ay ** 2
cx, cy, c = np.linalg.lstsq(A, bb, rcond=None)[0]
dd = np.hypot(xx - cx, yy - cy); dmed = np.median(np.hypot(ax - cx, ay - cy))
bad = arc & (np.abs(dd - dmed) > 60)
arc_l[bad] = 0; arc &= ~bad; ay, ax = np.where(arc)
save(arc_l, 'limit_arc.png', lcrop, 0.4)
meta['limit_bar_x'] = [round((lx.min() - lcrop[0]) * .4, 1), round((lx.max() - lcrop[0]) * .4, 1)]
meta['limit_arc_c'] = [round((cx - lcrop[0]) * .4, 1), round((cy - lcrop[1]) * .4, 1)]
ang = np.degrees(np.arctan2(ay - cy, ax - cx))
meta['limit_arc_ang'] = [float(ang.min()), float(ang.max())]

# ------------------------------------------------------------------ minimap frame
mm = load('01_47_17')
Hm, Wm = mm.shape[:2]
gray = mm[..., :3].astype(int).mean(2)
# inner disc = dark map area; find the ring: centre from alpha bbox of the ring
cxm, cym = 639, 614
yy, xx = np.mgrid[0:Hm, 0:Wm]
d = np.hypot(xx - cxm, yy - cym)
# estimate inner radius: the ring is bright (grey metal) – scan along horizontal line
rowv = gray[cym, cxm:]
inner = None
for i in range(300, len(rowv)):
    if rowv[i] > 120: inner = i; break
meta['mm_inner_r_src'] = int(inner)
mframe = mm.copy()
mframe[d < inner - 3, 3] = 0
edge = (d >= inner - 3) & (d < inner + 1)
mframe[edge, 3] = (mframe[edge, 3] * ((d[edge] - (inner - 3)) / 4)).astype(np.uint8)
al = mm[..., 3] > 20; ys, xs = np.where(al)
mcrop = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
meta['minimap_frame'] = save(mframe, 'minimap_frame.png', mcrop, 0.25)
meta['mm_center'] = [round((cxm - mcrop[0]) * .25, 1), round((cym - mcrop[1]) * .25, 1)]
meta['mm_inner_r'] = round(inner * .25, 1)
# keep the original painted map texture as a style sample
save(mm, 'minimap_sample.png', mcrop, 0.25)

json.dump(meta, open(os.path.join(OUT, 'ui_meta.json'), 'w'), indent=1)
print(json.dumps(meta, indent=1))
