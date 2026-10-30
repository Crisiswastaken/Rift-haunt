/* Synthetic hand-drawn strokes for the recogniser tests. */
import { SYMBOLS, type Pt, type SymbolId } from '../src/config';

/** a small seeded random generator, so failures reproduce */
export function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}

const P = (pts: number[][]): Pt[] => pts.map(([x, y]) => ({ x, y }));
const loop = (a0: number, turns: number, rx = 34, ry = 34) =>
  Array.from({ length: 49 }, (_, i) => { const a = a0 + i / 48 * turns * Math.PI * 2; return { x: 50 + Math.cos(a) * rx, y: 50 + Math.sin(a) * ry }; });

/** how people draw each shape when they aren't copying the glyph */
export const STYLES: Record<SymbolId, Pt[][]> = {
  dash: [P([[10, 52], [90, 46]])],
  pillar: [P([[48, 10], [53, 90]])],
  fang: [P([[20, 20], [50, 80], [80, 20]]), P([[18, 20], [26, 62], [50, 82], [74, 62], [82, 20]]), P([[25, 45], [42, 80], [85, 15]]),
    P([[30, 15], [50, 85], [70, 15]]), P([[10, 30], [50, 70], [90, 30]])],
  roof: [P([[20, 80], [50, 20], [80, 80]]), P([[18, 80], [26, 38], [50, 18], [74, 38], [82, 80]]), P([[30, 85], [50, 15], [70, 85]]),
    P([[10, 70], [50, 30], [90, 70]])],
  moon: [loop(0, 1), loop(1, .85), loop(2, 1.12), loop(0, 1, 44, 30), loop(3, .82, 30, 42)],
  bolt: [SYMBOLS.bolt.glyph, P([[22, 18], [78, 18], [22, 82], [78, 82]]), P([[62, 8], [34, 44], [66, 56], [38, 92]]),
    P([[36, 10], [68, 52], [34, 48], [64, 90]])],
  heart: [SYMBOLS.heart.glyph, P([[50, 32], [38, 16], [20, 18], [14, 36], [24, 56], [50, 86], [76, 56], [86, 36], [80, 18], [62, 16], [50, 30]])],
};

function densify(pts: Pt[], step = 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** `pts` as a person might draw it: random size, squash, tilt, slow wobble, jitter, direction and (loops) start point */
export function sloppy(src: Pt[], closed: boolean, r: () => number, wobble = .035, jitter = .012, maxTilt = 12): Pt[] {
  let pts = densify(src);
  if (closed) {
    pts = pts.slice(0, -1);
    const k = Math.floor(r() * pts.length);
    pts = [...pts.slice(k), ...pts.slice(0, k)];
    pts.push({ ...pts[0] });
    // people rarely close a loop exactly
    pts = pts.slice(0, pts.length - Math.floor(r() * pts.length * .06));
  }
  if (r() < .5) pts.reverse();
  const size = 80 + r() * 320, sx = .75 + r() * .5, sy = .75 + r() * .5;
  const rot = (r() - .5) * 2 * (maxTilt * Math.PI / 180);
  const f1 = 1 + r() * 2, f2 = 2 + r() * 3, p1 = r() * 6, p2 = r() * 6;
  return pts.map((p, i) => {
    const t = i / pts.length;
    let x = (p.x - 50) * sx, y = (p.y - 50) * sy;
    [x, y] = [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
    x += 100 * wobble * Math.sin(t * 6.28 * f1 + p1) + 100 * jitter * (r() - .5) * 2;
    y += 100 * wobble * Math.sin(t * 6.28 * f2 + p2) + 100 * jitter * (r() - .5) * 2;
    return { x: x * size / 100, y: y * size / 100 };
  });
}

const closed = (id: SymbolId) => id === 'moon' || id === 'heart';

/** the glyph itself, drawn sloppily */
export function drawn(id: SymbolId, r: () => number, wobble = .035, jitter = .012): Pt[] {
  return sloppy(SYMBOLS[id].glyph, closed(id), r, wobble, jitter);
}

/** one of the everyday ways of drawing `id`, drawn sloppily */
export function drawnStyle(id: SymbolId, r: () => number, wobble = .035, jitter = .012): Pt[] {
  const s = STYLES[id];
  return sloppy(s[Math.floor(r() * s.length)], closed(id), r, wobble, jitter);
}

export function scribble(r: () => number): Pt[] {
  const pts: Pt[] = [{ x: 0, y: 0 }];
  for (let k = 0; k < 60; k++) {
    const last = pts[pts.length - 1];
    pts.push({ x: last.x + (r() - .5) * 60, y: last.y + (r() - .5) * 60 });
  }
  return pts;
}
