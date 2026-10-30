# cuts the felt symbol sheet into one square sprite per symbol, in the game's glyph contract (centred, same size),
# with a soft dark backing baked in so each reads over the bright fog
import os
import numpy as np, cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
IDS = ['dash', 'pillar', 'fang', 'roof', 'moon', 'bolt', 'heart']   # sheet order: row 1 then row 2, left to right
SIZE, FILL = 256, .45          # canvas px, and how much of it the symbol's longer side takes
OPACITY = .75                  # so they sit in the scene rather than on top of it
INK = (13, 11, 43)             # the old glyphs' dark plate colour

sheet = np.array(Image.open(os.path.join(HERE, 'sheet.png')).convert('RGBA')).astype(np.float32)
sheet[..., 3][sheet[..., 3] < 6] = 0
n, lab, st, cen = cv2.connectedComponentsWithStats((sheet[..., 3] > 20).astype(np.uint8))
blobs = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 3000]
assert len(blobs) == len(IDS), f'expected {len(IDS)} symbols, found {len(blobs)}'
H = sheet.shape[0]
blobs.sort(key=lambda i: (cen[i][1] > H / 2, cen[i][0]))

for sid, i in zip(IDS, blobs):
    x, y, w, h = st[i, :4]
    keep = cv2.dilate((lab == i).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    m = 10
    c = sheet[max(y - m, 0):y + h + m, max(x - m, 0):x + w + m].copy()
    c[..., 3] *= keep[max(y - m, 0):y + h + m, max(x - m, 0):x + w + m]
    k = SIZE * FILL / max(w, h)
    pm = c.copy(); pm[..., :3] *= c[..., 3:] / 255
    r = cv2.resize(pm, (round(c.shape[1] * k), round(c.shape[0] * k)), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((SIZE, SIZE, 4), np.float32)
    ox, oy = (SIZE - r.shape[1]) // 2, (SIZE - r.shape[0]) // 2
    canvas[oy:oy + r.shape[0], ox:ox + r.shape[1]] = r
    # soft dark backing: the symbol's own shape, grown and blurred, under it
    a = canvas[..., 3] / 255
    back = cv2.GaussianBlur(cv2.dilate(a, np.ones((7, 7), np.uint8)), (0, 0), 7) * .3
    out_a = a + back * (1 - a)
    rgb = canvas[..., :3] + np.array(INK, np.float32) * (back * (1 - a))[..., None]
    rgb = np.where(out_a[..., None] > 0, rgb / np.maximum(out_a[..., None], 1e-4), 0)
    im = Image.fromarray(np.dstack([rgb, out_a * OPACITY * 255]).round().clip(0, 255).astype(np.uint8))
    im.save(os.path.join(HERE, f'{sid}.png')); im.save(os.path.join(HERE, f'{sid}.webp'), quality=92, method=6)
    print(sid, w, h)
