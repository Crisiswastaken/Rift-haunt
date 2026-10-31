# felt ghost rig: faceless body + face layers on one canvas (same contract as public/assets/ghost), plus wisp puffs
import os, json
import numpy as np, cv2
from PIL import Image

# writes next to this script
OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
TARGET_W, PAD = 600, 24
FACES = {'idle': 'ghost_felt.png', 'blink': 'st/blink.png', 'hit': 'st/hit.png', 'ouch': 'st/ouch.png', 'boo': 'st/boo.png'}

def rgba(p):
    a = np.array(Image.open(p).convert('RGBA')).astype(np.float32)
    a[..., 3][a[..., 3] < 6] = 0
    return a

body = rgba('st/body.png')
H, W = body.shape[:2]
ba = cv2.GaussianBlur(body[..., 3] / 255, (0, 0), 3)

def align(img):
    """affine ECC on the blurred silhouettes: warp img onto the body canvas"""
    ia = cv2.GaussianBlur(img[..., 3] / 255, (0, 0), 3)
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    cc, warp = cv2.findTransformECC(ba.astype(np.float32), ia.astype(np.float32), warp, cv2.MOTION_AFFINE, crit, None, 5)
    out = cv2.warpAffine(img, warp, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=0)
    return out, cc, warp

lum = lambda a: a[..., :3] @ np.array([.299, .587, .114], np.float32)
inside = cv2.erode((body[..., 3] > 200).astype(np.uint8), np.ones((51, 51), np.uint8)) > 0
ys, xs = np.nonzero(inside)
INK = np.array([24, 20, 30], np.float32)
faces, report = {}, {}
for name, p in FACES.items():
    img, cc, warp = align(rgba(p))
    L, Lb = lum(img), lum(body)
    # face = what is much darker than the blank felt underneath it, inside the body
    a = np.clip((Lb - L - 40) / 90, 0, 1) * inside
    a = cv2.morphologyEx((a * 255).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)).astype(np.float32) / 255
    # drop specks: keep components with real area
    n, lab, st, _ = cv2.connectedComponentsWithStats((a > .35).astype(np.uint8))
    keep = np.zeros_like(a, bool)
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] > 300: keep |= lab == i
    keep = cv2.dilate(keep.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    a *= keep
    face = np.dstack([np.broadcast_to(INK, a.shape + (3,)), a * 255])
    faces[name] = face
    report[name] = {'ecc': round(float(cc), 4), 'dx': round(float(warp[0, 2]), 1), 'dy': round(float(warp[1, 2]), 1),
                    'scale': round(float(np.sqrt(abs(np.linalg.det(warp[:, :2])))), 4), 'face_px': int((a > .5).sum())}

# shared crop: body bbox + pad, scaled to TARGET_W
y0, y1 = np.nonzero(body[..., 3].max(1) > 0)[0][[0, -1]]
x0, x1 = np.nonzero(body[..., 3].max(0) > 0)[0][[0, -1]]
k = (TARGET_W - 2 * PAD) / (x1 - x0 + 1)
Hc = round((y1 - y0 + 1) * k) + 2 * PAD
def export(arr, path):
    c = arr[y0:y1 + 1, x0:x1 + 1]
    # resize premultiplied so edges don't pick up dark fringes
    pm = c.copy(); pm[..., :3] *= c[..., 3:] / 255
    r = cv2.resize(pm, (TARGET_W - 2 * PAD, Hc - 2 * PAD), interpolation=cv2.INTER_AREA)
    al = r[..., 3:]; r[..., :3] = np.where(al > 0, r[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    out = np.zeros((Hc, TARGET_W, 4), np.float32); out[PAD:PAD + r.shape[0], PAD:PAD + r.shape[1]] = r
    im = Image.fromarray(out.round().clip(0, 255).astype(np.uint8))
    im.save(path + '.png'); im.save(path + '.webp', quality=92, method=6)
export(body, f'{OUT}/body')
for name, f in faces.items(): export(f, f'{OUT}/face-{name}')

# puffs: split the sheet into its four blobs
pf = rgba('st/puffs.png')
n, lab, st, _ = cv2.connectedComponentsWithStats((pf[..., 3] > 20).astype(np.uint8))
blobs = sorted([i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 2000], key=lambda i: -st[i, cv2.CC_STAT_AREA])
for j, i in enumerate(blobs):
    x, y, w, h = st[i, :4]; m = 12
    reg = cv2.dilate((lab == i).astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
    c = pf.copy(); c[..., 3] *= reg
    c = c[max(y - m, 0):y + h + m, max(x - m, 0):x + w + m]
    s = 220 / max(c.shape[:2])
    pm = c.copy(); pm[..., :3] *= c[..., 3:] / 255
    r = cv2.resize(pm, (round(c.shape[1] * s), round(c.shape[0] * s)), interpolation=cv2.INTER_AREA)
    al = r[..., 3:]; r[..., :3] = np.where(al > 0, r[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    im = Image.fromarray(r.round().clip(0, 255).astype(np.uint8)); im.save(f'{OUT}/puff-{j + 1}.png'); im.save(f'{OUT}/puff-{j + 1}.webp', quality=92, method=6)

json.dump({'size': [TARGET_W, Hc], 'pad': PAD, 'faces': list(FACES), 'puffs': len(blobs), 'align': report}, open(f'{OUT}/rig.json', 'w'), indent=1)
print(json.dumps(report, indent=1), TARGET_W, Hc, 'puffs', len(blobs))
