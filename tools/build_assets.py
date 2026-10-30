"""Builds the game's art from reference/generated into public/assets, plus the scene manifest the code reads.

- The v6b misty graveyard, layer by layer, with each layer's depth of field, haze and brightness baked in (the
  numbers come from reference/generated/v6b_layers/manifest.json), cropped to what it actually covers.
- Its four lanterns (blur baked), the warm glow sprite and the firefly sprite.
- The felt ghost rig (body, five faces, four wisp puffs) and a pre-blurred halo of its silhouette.
- The felt symbols, a full-strength felt heart for the HUD, and the favicon.

Run from anywhere: python tools/build_assets.py
"""
import json, math, os, shutil
import numpy as np, cv2
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, 'reference', 'generated')
V6B = os.path.join(REF, 'v6b_layers')
GHOST = os.path.join(REF, 'ghost')
OUT = os.path.join(ROOT, 'public', 'assets')
MANIFEST = os.path.join(ROOT, 'src', 'scene', 'manifest.json')


def load(path):
    a = np.array(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    a[..., 3][a[..., 3] < 1.5 / 255] = 0
    return a


def save(a, path, quality=90):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray((a * 255).round().clip(0, 255).astype(np.uint8)).save(path, 'WEBP', quality=quality, method=6)


def blur(a, sigma):
    """gaussian blur on premultiplied colour, so soft edges don't pick up dark fringes"""
    if not sigma:
        return a
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:]
    pm = cv2.GaussianBlur(pm, (0, 0), sigma)
    al = pm[..., 3:]
    pm[..., :3] = np.where(al > 1e-4, pm[..., :3] / np.maximum(al, 1e-4), 0)
    return pm


def bake(a, sigma=0, brightness=1.0, haze=0.0, haze_rgb=None):
    """what the layer preview did with canvas filters: blur and brightness, then the haze colour laid over (source-atop)"""
    pad = math.ceil(sigma * 3)
    a = np.pad(a, ((pad, pad), (pad, pad), (0, 0)))
    a = blur(a, sigma)
    a[..., :3] = np.clip(a[..., :3] * brightness, 0, 1)
    if haze and haze_rgb:
        tint = np.clip(np.array(haze_rgb, np.float32) * brightness, 0, 255).astype(np.int32) / 255
        a[..., :3] = a[..., :3] * (1 - haze) + tint * haze
    return a, pad


def crop(a):
    """the alpha bounding box, so mostly-empty layers don't cost a full 2048x1152 texture"""
    ys, xs = np.nonzero(a[..., 3] > 1 / 255)
    if not len(xs):
        return a[:1, :1], 0, 0
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return a[y0:y1, x0:x1], int(x0), int(y0)


def build_scene():
    src = json.load(open(os.path.join(V6B, 'manifest.json')))
    items = []
    for L in src['layers']:
        if L.get('lanterns'):
            for lan in src['lanterns']:
                a, pad = bake(load(os.path.join(V6B, lan['file'])), lan.get('blur', 0))
                name = os.path.splitext(os.path.basename(lan['file']))[0]
                save(a, os.path.join(OUT, 'scene', name + '.webp'))
                items.append({
                    'name': lan['name'], 'file': f'scene/{name}.webp',
                    'x': lan['x'] - pad, 'y': lan['y'] - pad, 'w': a.shape[1], 'h': a.shape[0],
                    'depth': lan['depth'], 'opacity': 1, 'blend': 'normal',
                    'lantern': {'x': lan['glow_x'], 'y': lan['glow_y'], 'r': lan['glow_radius']},
                })
            continue
        a, pad = bake(load(os.path.join(V6B, L['file'])), L.get('blur', 0), L.get('brightness', 1),
                      L.get('haze', 0), L.get('haze_rgb'))
        a, x, y = crop(a)
        name = os.path.splitext(os.path.basename(L['file']))[0]
        save(a, os.path.join(OUT, 'scene', name + '.webp'), 88 if name == '00_sky' else 90)
        items.append({
            'name': name, 'file': f'scene/{name}.webp', 'x': x - pad, 'y': y - pad, 'w': a.shape[1], 'h': a.shape[0],
            'depth': L.get('depth', 0), 'opacity': L.get('opacity', 1), 'blend': L.get('blend', 'normal'),
        })
        print(f'{name:16s} {a.shape[1]:5d}x{a.shape[0]:<5d} at {x - pad},{y - pad}')

    for f in ('glow', 'firefly'):
        save(load(os.path.join(V6B, 'lanterns', f + '.png')), os.path.join(OUT, 'scene', f + '.webp'), 95)

    ff = src['fireflies']
    flies = [{k: q[k] for k in ('lantern', 'ax', 'ay', 'amp_x', 'amp_y', 'speed', 'phase', 'blink_period',
                                'blink_phase', 'size', 'peak', 'blur')} for q in ff['list']]
    manifest = {
        'source': 'reference/generated/v6b_layers (built by tools/build_assets.py)',
        'canvas': src['canvas'],
        'items': items,
        'fireflies': flies,
    }
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    json.dump(manifest, open(MANIFEST, 'w'), indent=1)


def build_ghost():
    rig = os.path.join(GHOST, 'rig')
    dst = os.path.join(OUT, 'ghost')
    os.makedirs(dst, exist_ok=True)
    names = ['body'] + [f'face-{f}' for f in ('idle', 'blink', 'hit', 'ouch', 'boo')] + [f'puff-{i}' for i in range(1, 5)]
    for n in names:
        shutil.copyfile(os.path.join(rig, n + '.webp'), os.path.join(dst, n + '.webp'))
    shutil.copyfile(os.path.join(rig, 'rig.json'), os.path.join(dst, 'rig.json'))

    # the halo: the body's silhouette in white, blurred wide, padded by .35 of the width each side
    body = load(os.path.join(rig, 'body.png'))
    h, w = body.shape[:2]
    p = round(w * .35)
    sil = np.zeros((h + 2 * p, w + 2 * p, 4), np.float32)
    sil[p:p + h, p:p + w, 3] = body[..., 3]
    sil[..., :3] = 1
    sil = blur(sil, w * .1)
    sil[..., :3] = 1
    small = cv2.resize(sil, (sil.shape[1] // 2, sil.shape[0] // 2), interpolation=cv2.INTER_AREA)
    save(small, os.path.join(dst, 'halo.webp'), 92)

    # favicon: the idle ghost
    face = load(os.path.join(rig, 'face-idle.png'))
    comp = body.copy()
    fa = face[..., 3:]
    comp[..., :3] = comp[..., :3] * (1 - fa) + face[..., :3] * fa
    s = 64 / max(h, w)
    ico = cv2.resize(comp, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((64, 64, 4), np.float32)
    oy, ox = (64 - ico.shape[0]) // 2, (64 - ico.shape[1]) // 2
    canvas[oy:oy + ico.shape[0], ox:ox + ico.shape[1]] = ico
    Image.fromarray((canvas * 255).round().astype(np.uint8)).save(os.path.join(ROOT, 'public', 'favicon.png'))


def build_symbols():
    sym = os.path.join(GHOST, 'symbols')
    dst = os.path.join(OUT, 'symbols')
    os.makedirs(dst, exist_ok=True)
    ids = ['dash', 'pillar', 'fang', 'roof', 'moon', 'bolt', 'heart']
    for i in ids:
        shutil.copyfile(os.path.join(sym, i + '.webp'), os.path.join(dst, i + '.webp'))

    # the HUD heart: the sheet's felt heart at full strength, no dark backing (sheet order as in build_symbols.py)
    sheet = load(os.path.join(sym, 'sheet.png'))
    n, lab, st, cen = cv2.connectedComponentsWithStats((sheet[..., 3] > 20 / 255).astype(np.uint8))
    blobs = sorted([i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 3000], key=lambda i: (cen[i][1] > sheet.shape[0] / 2, cen[i][0]))
    assert len(blobs) == len(ids), f'expected {len(ids)} symbols, found {len(blobs)}'
    i = blobs[ids.index('heart')]
    x, y, w, h = st[i, :4]
    m = 14
    keep = cv2.dilate((lab == i).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    c = sheet[y - m:y + h + m, x - m:x + w + m].copy()
    c[..., 3] *= keep[y - m:y + h + m, x - m:x + w + m]
    k = 112 / max(c.shape[:2])
    pm = c.copy(); pm[..., :3] *= pm[..., 3:]
    r = cv2.resize(pm, (round(c.shape[1] * k), round(c.shape[0] * k)), interpolation=cv2.INTER_AREA)
    al = r[..., 3:]
    r[..., :3] = np.where(al > 1e-4, r[..., :3] / np.maximum(al, 1e-4), 0)
    save(r, os.path.join(OUT, 'hud', 'heart.webp'), 94)


if __name__ == '__main__':
    build_scene()
    build_ghost()
    build_symbols()
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print(f'public/assets: {total / 1e6:.2f} MB')
