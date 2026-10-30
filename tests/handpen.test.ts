import { describe, expect, it } from 'vitest';
import { HANDS, type Pt } from '../src/config';
import { pose } from '../src/input/hand/gesture';
import { HandPen } from '../src/input/hand/handpen';
import type { HandData } from '../src/input/hand/vision';
import { Recognizer } from '../src/input/recognizer';
import { rng } from './strokes';

/* A synthetic player in a 1280x720 camera picture: shoulders 200 px apart (S), the body model's arms and the hand
   model's hand placed so the palm is where we want it on screen, through the box the pen maps from. Fingers point
   up the image; a curled finger folds back toward the palm. */
type Shape = 'point' | 'open' | 'fist';
const VW = 1280, VH = 720, S = 200, SH_Y = 400, RSH_X = 540, LSH_X = 740;
const KNUCKLES: [number, number][] = [[-.025, 0], [0, 0], [.02, .003], [.038, .01]]; // index, middle, ring, little

function world(shape: Shape): Float32Array {
  const w = new Float32Array(63);
  const set = (i: number, x: number, y: number, z = 0) => { w[i * 3] = x; w[i * 3 + 1] = y; w[i * 3 + 2] = z; };
  set(0, 0, .09);
  [[.03, .07], [.045, .045], [.05, .025], [.055, .005]].forEach(([x, y], k) => set(1 + k, -x, y));
  KNUCKLES.forEach(([x, y], f) => {
    const out = shape === 'open' || (shape === 'point' && f === 0), base = 5 + f * 4;
    set(base, x, y);
    if (out) { set(base + 1, x, y - .04); set(base + 2, x, y - .065); set(base + 3, x, y - .087); }
    else { set(base + 1, x, y - .03, .01); set(base + 2, x, y - .012, .032); set(base + 3, x, y + .01, .022); }
  });
  return w;
}

/** the hand model's hand with its palm centre at (px, py) camera pixels */
function hand(shape: Shape, px: number, py: number): HandData {
  const wl = world(shape), lm = new Float32Array(63), PX_PER_M = 526;
  let cx = 0, cy = 0;
  for (const i of [0, 5, 9, 13, 17]) { cx += wl[i * 3] / 5; cy += wl[i * 3 + 1] / 5; }
  for (let i = 0; i < 21; i++) {
    lm[i * 3] = (px + (wl[i * 3] - cx) * PX_PER_M) / VW;
    lm[i * 3 + 1] = (py + (wl[i * 3 + 1] - cy) * PX_PER_M) / VH;
  }
  return { lm, world: wl, score: 1 };
}

/** the body model's 33 landmarks; each palm (camera pixels) is held up on a forearm pointing up, or hangs down */
function body(right: [number, number] | null, left: [number, number] | null = null): Float32Array {
  const lm = new Float32Array(33 * 4);
  const set = (i: number, x: number, y: number, vis = .99) => { lm[i * 4] = x / VW; lm[i * 4 + 1] = y / VH; lm[i * 4 + 3] = vis; };
  set(0, 640, 300); set(7, 680, 300); set(8, 600, 300);
  set(11, LSH_X, SH_Y); set(12, RSH_X, SH_Y);
  const arm = (palm: [number, number] | null, sx: number, elb: number, wri: number) => {
    if (!palm) { set(elb, sx, SH_Y + .7 * S); set(wri, sx, SH_Y + 1.3 * S); return; }
    // palm = wrist + .35 (wrist - elbow), with the elbow .6 S under the wrist
    const wy = palm[1] + .35 * .6 * S;
    set(wri, palm[0], wy); set(elb, palm[0], wy + .6 * S);
  };
  arm(right, RSH_X, 14, 16);
  arm(left, LSH_X, 13, 15);
  return lm;
}

/** a screen point (fractions) back to the camera pixels the right hand's palm has to be at, through the box */
function cam(x: number, y: number): [number, number] {
  const b = HANDS.body.box, bw = b.w * S, bh = b.h * S, ax = RSH_X, ay = SH_Y + b.dy * S;
  const u = (x + b.overX) / (1 + 2 * b.overX), v = (y + b.overTop) / (1 + b.overTop + b.overBottom);
  return [ax - bw / 2 + (1 - u) * bw, ay - bh / 2 + v * bh];
}

const W = 1600, H = 900;
function rig() {
  const p = new HandPen(HANDS, () => ({ W, H })), strokes: Pt[][] = [];
  p.onStroke = s => strokes.push(s);
  let t = 0;
  /** one 30 fps frame: the right palm at a screen point (or null: no hand at all), in a pose; `seen: false`: the hand
      model missed it but the body model still has the arm */
  const frame = (at: [number, number] | null, shape: Shape, o: { seen?: boolean; left?: [number, number] | null; hang?: boolean } = {}) => {
    const c = at && cam(at[0], at[1]);
    p.pose(t, body(o.hang ? null : c, o.left ? cam(o.left[0], o.left[1]) : null), VW, VH);
    p.hand(t, c && o.seen !== false ? hand(shape, c[0], c[1]) : null, VW, VH);
    p.tick(t);
    t += 1 / 30;
  };
  const path = (pts: [number, number][], shape: Shape, n: number, o: { noise?: () => number; miss?: [number, number] } = {}) => {
    let i = 0;
    for (let k = 1; k < pts.length; k++) for (let j = 0; j < n; j++, i++) {
      const a = pts[k - 1], b = pts[k], q = j / n, e = o.noise ? (o.noise() - .5) * .006 : 0;
      frame([a[0] + (b[0] - a[0]) * q + e, a[1] + (b[1] - a[1]) * q + e], shape, { seen: !(o.miss && i >= o.miss[0] && i < o.miss[1]) });
    }
    frame(pts[pts.length - 1], shape);
  };
  const hold = (at: [number, number], shape: Shape, n: number) => { for (let i = 0; i < n; i++) frame(at, shape); };
  return { p, strokes, frame, path, hold, get t() { return t; } };
}

describe('hand pose', () => {
  it('tells pointing from an open hand and a fist', () => {
    expect(pose(world('point'), HANDS.pose)).toBe('point');
    expect(pose(world('open'), HANDS.pose)).toBe('open');
    expect(pose(world('fist'), HANDS.pose)).toBe('fist');
  });

  it('keeps pointing through a finger that loosens a little, but needs a clear point to start', () => {
    // the middle finger half-uncurled: not enough to start pointing, enough to carry on
    const w = world('point'), m = world('open');
    for (const i of [10, 11, 12]) for (let k = 0; k < 3; k++) w[i * 3 + k] = w[i * 3 + k] * .48 + m[i * 3 + k] * .52;
    expect(pose(w, HANDS.pose, 'other')).not.toBe('point');
    expect(pose(w, HANDS.pose, 'point')).toBe('point');
  });
});

describe('hand pen: aim slowly, swipe quickly to draw', () => {
  const rec = new Recognizer();
  const read = (s: Pt[]) => rec.read(s, 24)?.id ?? null;

  it('maps the box to the whole screen: a comfortable reach covers every corner', () => {
    const r = rig();
    for (const [x, y] of [[.02, .05], [.98, .05], [.02, .7], [.98, .7]] as [number, number][]) {
      r.hold([x, y], 'open', 12);
      expect(Math.abs(r.p.cursor.x - x * W)).toBeLessThan(W * .03);
      expect(Math.abs(r.p.cursor.y - y * H)).toBeLessThan(H * .04);
    }
  });

  it('a slowly moving hand only aims: nothing is drawn', () => {
    const r = rig(), n = rng(3);
    r.hold([.3, .5], 'point', 10);
    r.path([[.3, .5], [.6, .3], [.7, .6], [.4, .65]], 'point', 45, { noise: n }); // ~.2 screens a second
    r.hold([.4, .65], 'point', 10);
    expect(r.strokes.length).toBe(0);
    expect(r.p.cursor.visible).toBe(true);
  });

  it('a quick V after slow aiming is one stroke, read as a V, without the aiming in it', () => {
    const r = rig();
    r.hold([.2, .6], 'open', 10);
    r.path([[.2, .6], [.4, .3]], 'open', 40); // aim, slowly
    r.hold([.4, .3], 'open', 8);
    r.path([[.4, .3], [.5, .6], [.6, .3]], 'point', 8, { noise: rng(4) }); // swipe
    r.hold([.6, .3], 'open', 10);
    expect(r.strokes.length).toBe(1);
    expect(read(r.strokes[0])).toBe('fang');
    expect(Math.hypot(r.strokes[0][0].x - .4 * W, r.strokes[0][0].y - .3 * H)).toBeLessThan(W * .05);
  });

  it('two quick strokes with slow travel between: two strokes, the travel not drawn', () => {
    const r = rig();
    r.hold([.3, .4], 'open', 10);
    r.path([[.3, .4], [.7, .4]], 'open', 8);
    r.hold([.7, .4], 'open', 6);
    r.path([[.7, .4], [.5, .15]], 'open', 40);
    r.hold([.5, .15], 'open', 6);
    r.path([[.5, .15], [.5, .6]], 'open', 8);
    r.hold([.5, .6], 'open', 10);
    expect(r.strokes.map(read)).toEqual(['dash', 'pillar']);
    expect(Math.hypot(r.strokes[1][0].x - .5 * W, r.strokes[1][0].y - .15 * H)).toBeLessThan(W * .05);
  });

  it('keeps a quick circle going round, and carries a swipe along the arm when the hand model misses frames', () => {
    const r = rig();
    r.hold([.5, .15], 'open', 10);
    const ring = Array.from({ length: 13 }, (_, i) => [.5 + .14 * Math.sin(i / 12 * Math.PI * 2), .35 - .2 * Math.cos(i / 12 * Math.PI * 2)] as [number, number]);
    r.path(ring, 'open', 3);
    r.hold(ring[12], 'open', 10);
    r.path([[.3, .6], [.3, .6]], 'open', 10);
    r.path([[.3, .6], [.75, .6]], 'open', 10, { miss: [3, 8] }); // the hand model misses five of ten frames
    r.hold([.75, .6], 'open', 10);
    expect(r.strokes.map(read)).toEqual(['moon', 'dash']);
  });

  it('putting your arm down quickly casts nothing, nor does raising it', () => {
    const r = rig();
    r.hold([.5, .4], 'open', 10);
    r.path([[.5, .4], [.5, 1.4]], 'open', 6); // down to your side, quickly
    for (let i = 0; i < 8; i++) r.frame(null, 'open', { hang: true });
    r.path([[.5, 1.4], [.5, .4]], 'open', 6); // and back up
    r.hold([.5, .4], 'open', 10);
    expect(r.strokes.length).toBe(0);
  });

  it('draws with a slow camera and slow tracking: 8 frames a second, each arriving 100 ms late', () => {
    // what broke on a real laptop: the game ticks the pen 60 times a second on the arrival clock, and must not take
    // the gaps between slow, late frames for a lost hand
    const p = new HandPen(HANDS, () => ({ W, H })), strokes: Pt[][] = [];
    p.onStroke = s => strokes.push(s);
    let t = 0, now = 0;
    const frame = (at: [number, number], seen = true) => {
      const c = cam(at[0], at[1]);
      while (now < t + .1) { p.tick(now); now += 1 / 60; }
      p.pose(t, body(c), VW, VH);
      p.hand(t, seen ? hand('open', c[0], c[1]) : null, VW, VH, t + .1);
      t += 1 / 8;
    };
    for (let i = 0; i < 8; i++) frame([.25, .4]);
    for (let i = 0; i <= 3; i++) frame([.25 + .5 * i / 3, .4], i !== 2); // a swipe in under half a second, a frame missed
    for (let i = 0; i < 6; i++) frame([.75, .4]);
    expect(strokes.map(s => rec.read(s, 24)?.id)).toEqual(['dash']);
  });

  it('the other hand only takes over once it is clearly higher for a moment', () => {
    const r = rig();
    r.hold([.6, .5], 'open', 10);
    const side = () => r.p.stats.side;
    expect(side()).toBe('R');
    r.frame([.6, .5], 'open', { left: [.4, -.3] });
    r.frame([.6, .5], 'open', { left: [.4, -.3] });
    expect(side()).toBe('R');
    for (let i = 0; i < 6; i++) r.frame([.6, .5], 'open', { left: [.4, -.3] });
    expect(side()).toBe('L');
  });
});
