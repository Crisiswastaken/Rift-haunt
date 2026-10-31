/* Reads a stroke as one of the symbols, forgivingly.
   Straight strokes are read by their angle: within 35° of level is a line across, within 35° of upright a line down,
   so the two can never be mixed up. Everything else is matched against a family of templates per shape (the neat
   glyph plus the ways people really draw it: a U or a tick for V, a Z for the bolt, a loop left open) with a $P
   point-cloud match (Vatavu, Anthony & Wobbrock 2012), which doesn't care where the stroke starts or which way it
   goes. That also suits drawing in the air with a hand, later.
   The game passes in the shapes on screen; on a close call, a shape on screen gets the benefit of the doubt. */
import { SYMBOLS, type Pt, type SymbolId } from '../config';

const N = 32;
type Cloud = Pt[];

export interface Reading {
  id: SymbolId;
  /** 0..1, higher is a cleaner match */
  confidence: number;
}

/** Beyond this $P distance a stroke is a scribble, not a symbol. Tuned with tests/recognizer.test.ts. */
export const MAX_DISTANCE = 1.85;
/** Ink length over size (a loop is about 2.3, a bolt under 2.8); a tangle well past that is a scribble. */
const MAX_TANGLE = 3.4;
/** a shape on screen still wins if its match is within this factor of the best one */
const BENEFIT = 1.22;

const LINES = new Set<SymbolId>(['dash', 'pillar']);
const CLOSED = new Set<SymbolId>(['moon', 'heart']);

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function bounds(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, diag: Math.hypot(x1 - x0, y1 - y0) };
}

/** n points evenly spaced along the path */
function resample(src: Pt[], n: number): Pt[] {
  let len = 0;
  for (let i = 1; i < src.length; i++) len += dist(src[i - 1], src[i]);
  const step = len / (n - 1), out: Pt[] = [{ ...src[0] }];
  let acc = 0, prev = src[0];
  for (let i = 1; i < src.length && out.length < n; i++) {
    let cur = src[i], d = dist(prev, cur);
    while (acc + d >= step && d > 0 && out.length < n) {
      const k = (step - acc) / d, q = { x: prev.x + k * (cur.x - prev.x), y: prev.y + k * (cur.y - prev.y) };
      out.push(q);
      prev = q; d = dist(prev, cur); acc = 0;
    }
    acc += d; prev = cur;
  }
  while (out.length < n) out.push({ ...src[src.length - 1] });
  return out;
}

/** resampled, scaled into a unit box keeping its proportions, centred on its centroid */
function cloud(stroke: Pt[]): Cloud {
  const pts = resample(stroke, N), b = bounds(pts), size = Math.max(b.w, b.h) || 1;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= N; cy /= N;
  return pts.map(p => ({ x: (p.x - cx) / size, y: (p.y - cy) / size }));
}

function cloudDistance(a: Cloud, b: Cloud, start: number, bound: number): number {
  const used = new Array<boolean>(N).fill(false);
  let sum = 0, i = start;
  do {
    if (sum >= bound) return sum;
    // squared distances in the inner loop (Math.hypot is slow), one square root per point
    const ax = a[i].x, ay = a[i].y;
    let best = 0, min = Infinity;
    for (let j = 0; j < N; j++) {
      if (used[j]) continue;
      const dx = ax - b[j].x, dy = ay - b[j].y, d = dx * dx + dy * dy;
      if (d < min) { min = d; best = j; }
    }
    used[best] = true;
    sum += (1 - ((i - start + N) % N) / N) * Math.sqrt(min);
    i = (i + 1) % N;
  } while (i !== start);
  return sum;
}

/** $P greedy match both ways round, giving up early once it can't beat `bound` */
function match(a: Cloud, b: Cloud, bound: number): number {
  const step = Math.floor(Math.sqrt(N));
  let min = bound;
  for (let i = 0; i < N; i += step) min = Math.min(min, cloudDistance(a, b, i, min), cloudDistance(b, a, i, min));
  return min;
}

/* ---------- templates: each glyph plus the ways people actually draw it (100x100 box) ---------- */

const P = (pts: number[][]): Pt[] => pts.map(([x, y]) => ({ x, y }));
const stretch = (pts: Pt[], sx: number, sy: number) => pts.map(p => ({ x: 50 + (p.x - 50) * sx, y: 50 + (p.y - 50) * sy }));
const flipX = (pts: Pt[]) => pts.map(p => ({ x: 100 - p.x, y: p.y }));
const flipY = (pts: Pt[]) => pts.map(p => ({ x: p.x, y: 100 - p.y }));
const tilt = (pts: Pt[], deg: number) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return pts.map(p => ({ x: 50 + (p.x - 50) * c - (p.y - 50) * s, y: 50 + (p.x - 50) * s + (p.y - 50) * c }));
};
/** part of an ellipse, from angle a0 for `turns` of a full turn */
const arc = (a0: number, turns: number, rx = 34, ry = 34, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (i / n) * turns * Math.PI * 2;
    return { x: 50 + Math.cos(a) * rx, y: 50 + Math.sin(a) * ry };
  });

function vees(): Pt[][] {
  const g = SYMBOLS.fang.glyph;
  return [
    g, stretch(g, .55, 1), stretch(g, 1.35, .7), tilt(g, 12), tilt(g, -12),
    P([[18, 20], [28, 60], [50, 80], [72, 60], [82, 20]]),                     // rounded
    P([[20, 20], [22, 55], [35, 76], [50, 80], [65, 76], [78, 55], [80, 20]]),  // a U
    P([[22, 48], [40, 80], [82, 18]]), P([[78, 48], [60, 80], [18, 18]]),       // ticks, short arm first or last
  ];
}

function bolts(): Pt[][] {
  const g = SYMBOLS.bolt.glyph;
  const z = P([[22, 18], [78, 18], [22, 82], [78, 82]]);
  const zig = P([[62, 8], [34, 42], [66, 58], [38, 92]]);
  return [g, flipX(g), stretch(g, 1.4, 1), stretch(flipX(g), 1.4, 1), z, flipX(z), stretch(z, .7, 1), zig, flipX(zig),
    P([[60, 10], [36, 50], [64, 50], [40, 90]]), tilt(g, 12), tilt(g, -12)];
}

function family(id: SymbolId): Pt[][] {
  const g = SYMBOLS[id].glyph, up = -Math.PI / 2;
  switch (id) {
    case 'dash': case 'pillar': return [g, tilt(g, 12), tilt(g, -12)];
    case 'fang': return vees();
    case 'roof': return vees().map(flipY);
    case 'moon': return [g, arc(up, 1, 42, 30), arc(up, 1, 30, 42), arc(up, 1.15), tilt(arc(up, 1, 42, 30), 30), tilt(arc(up, 1, 42, 30), -30),
      // left open: a gap of 15-25% of the loop, wherever the pen started
      ...[0, .5, 1, 1.5].map(k => arc(up + k * Math.PI, .8)), arc(up, .86, 40, 32), arc(Math.PI / 2, .86, 32, 40)];
    case 'bolt': return bolts();
    case 'heart': {
      const poly = P([[50, 32], [38, 16], [20, 18], [14, 36], [24, 56], [50, 86], [76, 56], [86, 36], [80, 18], [62, 16], [50, 32]]);
      return [g, stretch(g, 1.2, .9), stretch(g, .88, 1.12), poly, stretch(poly, 1.15, .9), tilt(g, 10), tilt(g, -10),
        g.slice(0, Math.round(g.length * .9))];
    }
  }
}

/** extra points along long straight runs, so a 2-point template resamples like a drawn line */
function densify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(dist(a, b) / 3));
    for (let k = 0; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** ink length over size, measured in steps of 8% of the size so jitter doesn't count */
function tangle(stroke: Pt[], diag: number): number {
  const step = diag * .08;
  let len = 0, last = stroke[0];
  for (const p of stroke) {
    const d = dist(p, last);
    if (d >= step) { len += d; last = p; }
  }
  return len / diag;
}

const turnAt = (p: Pt[], i: number, k = 2) => {
  const ax = p[i].x - p[i - k].x, ay = p[i].y - p[i - k].y, bx = p[i + k].x - p[i].x, by = p[i + k].y - p[i].y;
  const c = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
};
/** sharp corners along an evenly resampled path (so an index is a fraction of the ink): local peaks over `min` deg */
function corners(p: Pt[], min: number, k = 2): { i: number; turn: number }[] {
  const t = p.map((_, i) => (i >= k && i < p.length - k ? turnAt(p, i, k) : 0)), out: { i: number; turn: number }[] = [];
  for (let i = k; i < p.length - k; i++) if (t[i] > min && t[i] >= t[i - 1] && t[i] >= t[i + 1]) out.push({ i, turn: t[i] });
  return out;
}

function distToPath(q: Pt, path: Pt[]): number {
  let m = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const k = L ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L)) : 0;
    m = Math.min(m, Math.hypot(q.x - a.x - k * dx, q.y - a.y - k * dy));
  }
  return m;
}

/** a swipe and the hand coming back the same way: keep the longer side of a sharp reversal (over 140 deg) when the
    shorter side runs back over it (no shape here goes back over its own path). Cuts the original points. */
function unreturn(stroke: Pt[]): Pt[] {
  let src = stroke;
  for (let pass = 0; pass < 2; pass++) {
    const p = resample(src, N), c = corners(p, 140).sort((x, y) => y.turn - x.turn)[0];
    if (!c) break;
    const A = p.slice(0, c.i + 1), B = p.slice(c.i), [long, short] = A.length >= B.length ? [A, B] : [B, A];
    // it has to run back along the part it just drew (a loop's end coming round to its start isn't a return)
    const m = Math.min(long.length, Math.ceil(short.length * 1.5)), near = long === A ? A.slice(A.length - m) : B.slice(0, m);
    if (short.some(q => distToPath(q, near) > bounds(long).diag * .15)) break;
    // the original points, cut at the same fraction of the ink
    let total = 0, len = 0, k = 0;
    for (let i = 1; i < src.length; i++) total += dist(src[i - 1], src[i]);
    const at = c.i / (N - 1) * total;
    while (k < src.length - 1 && len + dist(src[k], src[k + 1]) <= at) { len += dist(src[k], src[k + 1]); k++; }
    src = long === A ? src.slice(0, k + 1) : src.slice(k);
  }
  return src;
}

/** the stroke without a hook at its start and/or end (a turn over 45 deg in the first or last 40% of the ink), longest first */
function trims(stroke: Pt[]): Pt[][] {
  const p = resample(stroke, N), c = corners(p, 45), lim = Math.round(N * .4);
  const s = c.filter(k => k.i <= lim).map(k => k.i), e = c.filter(k => k.i >= N - 1 - lim).map(k => k.i);
  const out: Pt[][] = [...s.map(i => p.slice(i)), ...e.map(i => p.slice(0, i + 1))];
  if (s.length && e.length) out.push(p.slice(Math.max(...s), Math.min(...e) + 1));
  return out.sort((x, y) => y.length - x.length);
}

export class Recognizer {
  private templates: { id: SymbolId; cloud: Cloud }[] = [];

  constructor(private maxDistance = MAX_DISTANCE) {
    for (const id of Object.keys(SYMBOLS) as SymbolId[]) {
      for (const pts of family(id)) this.templates.push({ id, cloud: cloud(densify(pts)) });
    }
  }

  /**
   * minSize: the smallest stroke (bounding-box diagonal, in the stroke's own units) that counts.
   * wanted: the shapes on screen right now, which win close calls.
   */
  read(stroke: Pt[], minSize: number, wanted?: ReadonlySet<SymbolId>): Reading | null {
    if (stroke.length < 2 || bounds(stroke).diag < minSize) return null;
    const s = unreturn(stroke), full = this.readOne(s, wanted);
    // a clean line has no hook to trim
    if (!wanted || (full && (wanted.has(full.id) || LINES.has(full.id)))) return full;
    // not a shape on screen as a whole: maybe it is without a hook at one end
    const vee = (id?: SymbolId) => id === 'fang' || id === 'roof';
    for (const t of trims(s)) {
      const r = this.readOne(t, wanted);
      // a V is never trimmed into a roof or a roof into a V (one arm of either reads as both)
      if (r && wanted.has(r.id) && !(vee(full?.id) && vee(r.id))) return r;
    }
    return full;
  }

  private readOne(stroke: Pt[], wanted?: ReadonlySet<SymbolId>): Reading | null {
    if (stroke.length < 2) return null;
    const { diag } = bounds(stroke);

    // straight: nothing strays far from the line between the ends (path length is a poor test: jitter inflates it)
    const a = stroke[0], b = stroke[stroke.length - 1], ends = dist(a, b);
    let dev = 1;
    // measured whatever the ends, so a line with a small hook can still match the line templates below
    if (ends > 0) {
      dev = 0;
      for (const p of stroke) dev = Math.max(dev, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / ends);
      dev /= ends;
      if (ends > diag * .8 && dev < .12) return this.line(Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180 / Math.PI, dev / .12);
    }

    if (tangle(stroke, diag) > MAX_TANGLE) return null;
    const closure = ends / diag, c = cloud(stroke), cap = this.maxDistance * 1.5;
    const best = new Map<SymbolId, number>();
    for (const t of this.templates) {
      // a bent stroke is never a line, and a stroke whose ends are far apart is never a loop
      if (LINES.has(t.id) && dev > .3) continue;
      if (CLOSED.has(t.id) && closure > .9) continue;
      const bound = best.get(t.id) ?? cap, d = match(c, t.cloud, bound);
      if (d < bound) best.set(t.id, d);
    }
    const ranked = [...best].sort((p, q) => p[1] - q[1]);
    if (!ranked.length || ranked[0][1] > this.maxDistance) return null;
    let [id, d] = ranked[0];
    if (wanted && !wanted.has(id)) {
      // lean toward a shape on screen, but never across the line / shape divide
      const alt = ranked.find(([k]) => wanted.has(k));
      if (alt && alt[1] <= d * BENEFIT && alt[1] <= this.maxDistance && LINES.has(alt[0]) === LINES.has(id)) [id, d] = alt;
    }
    return { id, confidence: Math.max(0, 1 - d / this.maxDistance) };
  }

  /** within 35 deg of level or upright; a diagonal is neither, whatever is on screen */
  private line(angle: number, wobble: number): Reading | null {
    const confidence = 1 - wobble * .5;
    return angle < 35 ? { id: 'dash', confidence } : angle > 55 ? { id: 'pillar', confidence } : null;
  }
}
