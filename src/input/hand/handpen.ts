/* Drawing in the air, by speed: move your hand slowly and the firefly just follows it (aiming); swipe quickly and that
   swipe is a stroke, from where the quick move began to where you slowed down again, and it's cast. No hand shape to
   hold: a sudden quick move is the pen going down. This is RIFT-Desktop's Fruit Ninja blade (fruit_ninja.py), which
   presses above a speed and releases after a moment under a lower one, measured on real players.
   Where the hand is: your palm, from the hand model reading a close crop of your hand; when it misses a frame (a hand
   pointed at the camera, or blurred by a quick move), from your arm in the body model, moved by where the two were
   last seen apart, and blended back when the hand model finds it again, so neither switch jumps. Your hand moves in a
   box anchored to your shoulders, and that box is the whole screen (see body.ts), so an arm's reach covers every corner
   at any distance. The point is smoothed by RIFT's blade filter (filters.ts).
   It implements `Pen`, so the game draws and casts these strokes exactly like mouse strokes. */
import type { Pt } from '../../config';
import type { Pen } from '../pointer';
import { Body, type Arm, type BodyOpts, type Side } from './body';
import { Smoother, type SmoothOpts } from './filters';
import { pose, straightness, type Pose, type PoseOpts } from './gesture';
import type { HandData, Rect } from './vision';

export interface HandOpts {
  /** the hand's pose, for the debug panel (drawing doesn't depend on it) */
  pose: PoseOpts;
  body: BodyOpts;
  smooth: SmoothOpts;
  /** screens a second: a stroke starts when the hand goes faster than `downV`, and ends once it has been slower than
      `upV` for `up` seconds (long enough for the turn at the bottom of a V); it starts from where the hand was
      `preroll` seconds before it got quick */
  downV: number; upV: number; up: number; preroll: number;
  /** seconds with no hand at all: the stroke coasts this long, then the pen lifts, then the cursor hides */
  coast: number; lift: number; hide: number;
  /** seconds: the longest stroke; after it the pen lifts until the hand slows down */
  maxStroke: number;
  /** with no body to go on, S ~ the palm's width x this */
  palmS: number;
  /** S: the hand model's palm has to be this near the drawing arm's palm to be that hand (else it's the other one) */
  match: number;
  /** the hand crop's side: the hand's size x `hand` when we have it, else S x `arm` around the arm's palm; at least
      `min` camera pixels */
  crop: { hand: number; arm: number; min: number };
  /** screens a second: faster than this and the shoulders aren't measured (they twist as you draw) */
  freeze: number;
}

export interface Cursor { x: number; y: number; pose: Pose; visible: boolean; drawing: boolean }

/** what's going on, for the debug panel */
export interface PenStats {
  source: 'hand' | 'arm' | null; crop: 'hand' | 'arm' | 'whole'; side: Side | null; S: number;
  fingers: number[]; pose: Pose; rest: boolean; speed: number;
}

const PALM = [0, 5, 9, 13, 17];

export class HandPen implements Pen {
  live: Pt[] | null = null;
  onStroke: (pts: Pt[]) => void = () => {};
  enabled: () => boolean = () => true;
  cursor: Cursor = { x: 0, y: 0, pose: 'other', visible: false, drawing: false };
  stats: PenStats = { source: null, crop: 'whole', side: null, S: 0, fingers: [0, 0, 0, 0], pose: 'other', rest: false, speed: 0 };
  readonly body: Body;

  private sm: Smoother;
  /** the hand model's hand as last seen (camera pixels) */
  private seen: { t: number; lm: ArrayLike<number>; vw: number; vh: number } | null = null;
  private label: Pose = 'other';
  /** the hand model's palm minus the arm's, learned while both are seen, so falling back on the arm doesn't jump; and
      how far the place has blended over to the hand model's (0..1) */
  private off: { x: number; y: number } | null = null;
  private blend = 0;
  private frameT = -9;
  /** when the last hand result arrived (the camera picture is older than that by the tracking's lag) */
  private arriveT = -9;
  /** seconds between hand frames, smoothed: a slow camera (15 a second in a dim room) or slow tracking spaces them
      out, and a gap only counts as the hand being lost when it's well over that */
  private every = 1 / 30;
  private seenEvery = false;
  private strokeT = 0;
  /** since when the hand has been slow in this stroke, and how long the stroke was then (the slow tail is dropped) */
  private slowSince = -1;
  private slowAt = 0;
  /** the hand has to slow down once before a quick move counts: when it's just come into view or been raised, and
      after a stroke that ran too long */
  private needSlow = true;
  private rest = false;
  /** how far down the box the hand is, unclamped (over 1: under it, on its way down to your side) */
  private v = 0;
  private cropSide = 0;

  constructor(private o: HandOpts, private stage: () => { W: number; H: number }) {
    this.body = new Body(o.body);
    this.sm = new Smoother(o.smooth);
  }

  /** the body model's latest frame */
  pose(t: number, lm: Float32Array | null, w: number, h: number) {
    const switched = this.body.update(lm, w, h, t, this.sm.moving, this.sm.speed > this.o.freeze);
    // the other hand took over: it's somewhere else entirely, never a line from the old one
    if (switched) { this.drop(); this.sm.reset(); this.off = null; this.blend = 0; this.seen = null; this.needSlow = true; }
  }

  /** the hand model's latest frame: the hand in the crop (landmarks already in the whole frame), or null; `arrived`:
      when the result came in, on the clock `tick` is given */
  hand(t: number, h: HandData | null, vw: number, vh: number, arrived = t) {
    const b = this.body;
    if (this.frameT > 0 && t > this.frameT) {
      const d = Math.min(.3, t - this.frameT);
      this.every = this.seenEvery ? this.every + (d - this.every) * .2 : d;
      this.seenEvery = true;
    }
    this.frameT = t;
    this.arriveT = arrived;
    b.w = vw; b.h = vh;
    const arm = b.side && b.fresh(t) ? b.arms[b.side] : null;
    let palm: { x: number; y: number } | null = null;

    if (h) {
      let x = 0, y = 0;
      for (const i of PALM) { x += h.lm[i * 3] * vw; y += h.lm[i * 3 + 1] * vh; }
      x /= PALM.length; y /= PALM.length;
      // with the body to go on, it has to be the drawing hand (the crop can catch the other one, or a face); the body
      // frame can be a little older than this one, so allow for how far the hand has moved since
      const S = Math.max(b.S, 1), age = Math.max(0, t - b.t);
      if (!arm || Math.hypot(x - arm.x, y - arm.y) < this.o.match * S + this.sm.speed * age * b.box(b.side).w) {
        palm = { x, y };
        this.seen = { t, lm: h.lm, vw, vh };
        this.label = pose(h.world, this.o.pose, this.label);
        this.stats.fingers = straightness(h.world);
        if (!b.fresh(t, 1)) {
          const pw = Math.hypot((h.lm[5 * 3] - h.lm[17 * 3]) * vw, (h.lm[5 * 3 + 1] - h.lm[17 * 3 + 1]) * vh);
          b.sizeFromHand(pw, this.o.palmS);
        }
        if (arm && this.sm.speed < 1) {
          const ox = x - arm.x, oy = y - arm.y;
          this.off = this.off ? { x: this.off.x + .15 * (ox - this.off.x), y: this.off.y + .15 * (oy - this.off.y) } : { x: ox, y: oy };
        }
      }
    }
    // the place: the hand model's palm, blended in from the arm's over a few frames when it comes back
    const base = arm && { x: arm.x + (this.off?.x ?? 0), y: arm.y + (this.off?.y ?? 0) };
    this.blend = palm ? Math.min(1, this.blend + .34) : Math.max(0, this.blend - .34);
    const at = palm && base ? { x: base.x + this.blend * (palm.x - base.x), y: base.y + this.blend * (palm.y - base.y) } : palm ?? base;
    const source = palm ? 'hand' : base ? 'arm' : null;
    if (!palm) this.label = 'other';
    Object.assign(this.stats, { source, side: b.side, S: b.S, pose: this.label });
    if (!at) { this.missing(t); return; }

    // a long gap: start afresh rather than draw a line across it
    if (this.sm.lastT >= 0 && t - this.sm.lastT > this.gap('lift')) { this.lift(); this.sm.restart(); this.needSlow = true; }
    const s = b.toScreen(at.x, at.y, b.side);
    this.v = s.v;
    // a hand hanging by your side, or under the box, is resting: no cursor, and a stroke that ends by dropping your hand
    // there was you putting your arm down, not a shape
    const lift = arm?.lift, bo = this.o.body;
    this.rest = (lift !== undefined && -lift > (this.rest ? bo.restBack : bo.restY)) || s.v > 1 + (this.rest ? bo.below / 3 : bo.below);
    this.stats.rest = this.rest;
    if (this.rest) {
      this.drop();
      this.sm.reset();
      this.needSlow = true;
      this.cursor = { ...this.cursor, visible: false, drawing: false };
      return;
    }
    const r = this.sm.push(s.x, s.y, t, source === 'hand');
    if (r === 'skip') { this.missing(t); return; }
    if (r === 'jump') { this.lift(); this.needSlow = true; }
    this.step(t);
  }

  /** time passing (now, on the same clock as `arrived`): if the hand results have stopped coming, lift the pen and
      then hide the cursor */
  tick(now: number) {
    const gap = now - this.arriveT;
    if (gap > this.gap('lift') + .1) this.lift();
    if (gap > this.gap('hide') + .1) this.cursor = { ...this.cursor, visible: false, drawing: false };
  }

  /** where to look for the hand in the next frame (camera pixels). With a body: around the drawing arm's palm, moved by
      where the hand model has been finding the hand relative to it, so the crop glides along with the arm (the hand
      model follows the hand from frame to frame, and a crop that jumps throws it). Without one (too close for the
      body model): around the hand as last seen; else the whole picture. */
  crop(vw: number, vh: number, t: number): Rect {
    const b = this.body, o = this.o.crop, S = b.S;
    let cx = 0, cy = 0, side = 0;
    const arm = b.fresh(t, .5) && S > 0 ? (b.side && b.arms[b.side]) || higher(b.arms) : null;
    const h = this.seen && t - this.seen.t < Math.max(.5, 4 * this.every) ? this.seen : null;
    if (arm) {
      const off = b.side && arm === b.arms[b.side] ? this.off : null;
      cx = arm.x + (off?.x ?? 0); cy = arm.y + (off?.y ?? 0); side = S * o.arm;
      this.stats.crop = 'arm';
    } else if (h) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (let i = 0; i < 21; i++) { const x = h.lm[i * 3], y = h.lm[i * 3 + 1]; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      cx = (x0 + x1) / 2 * vw; cy = (y0 + y1) / 2 * vh;
      side = Math.max((x1 - x0) * vw, (y1 - y0) * vh) * o.hand;
      this.stats.crop = 'hand';
    }
    if (!side) { this.cropSide = 0; this.stats.crop = 'whole'; return { x: 0, y: 0, w: vw, h: vh }; }
    // the size eases (the model follows the hand between frames, and a jumping crop throws it), the place doesn't
    this.cropSide = this.cropSide ? this.cropSide + (side - this.cropSide) * .5 : side;
    const d = Math.min(Math.max(this.cropSide, o.min), vw, vh);
    return { x: Math.min(Math.max(cx - d / 2, 0), vw - d), y: Math.min(Math.max(cy - d / 2, 0), vh - d), w: d, h: d };
  }

  /** drop everything (pausing, a new run, the camera stopping): no stroke, no hand */
  reset() {
    this.live = null;
    this.sm.reset();
    this.body.reset();
    this.seen = null; this.off = null; this.blend = 0; this.label = 'other';
    this.frameT = this.arriveT = -9;
    this.every = 1 / 30;
    this.seenEvery = false;
    this.slowSince = -1;
    this.needSlow = true; this.rest = false; this.cropSide = 0;
    this.cursor = { ...this.cursor, visible: false, drawing: false };
  }

  /** a gap in seconds, never less than a few of the frame gaps we're actually getting */
  private gap(k: 'lift' | 'hide' | 'coast' | 'up' | 'preroll') {
    const n = { lift: 2.5, hide: 4, coast: 1.5, up: 2, preroll: 1.2 }[k];
    return Math.max(this.o[k], n * this.every);
  }

  /** the pen, from the hand's speed: down when it gets quick (from where the quick move began), up once it has been
      slow for a moment (without the slow tail) */
  private step(t: number) {
    const { W, H } = this.stage(), o = this.o, sp = this.sm.speed, p = this.sm.point!, c = this.sm.cursor!;
    this.stats.speed = sp;
    // (the speed means something once a few frames have been tracked)
    const known = this.sm.n >= 3;
    if (known && sp < o.upV) this.needSlow = false;
    if (!this.live) {
      if (known && sp > o.downV && !this.needSlow && this.enabled()) {
        this.live = this.sm.since(t - this.gap('preroll')).map(q => ({ x: q.x * W, y: q.y * H }));
        if (!this.live.length) this.live.push({ x: p.x * W, y: p.y * H });
        this.strokeT = t;
        this.slowSince = -1;
      }
    } else {
      this.add({ x: p.x * W, y: p.y * H });
      if (sp < o.upV) { if (this.slowSince < 0) { this.slowSince = t; this.slowAt = this.live.length; } }
      else this.slowSince = -1;
      // stopping under the box is the hand on its way down to your side, not the end of a shape
      if (this.slowSince >= 0 && t - this.slowSince >= this.gap('up')) { if (this.v > 1) this.drop(); else this.lift(this.slowAt); }
      else if (t - this.strokeT > o.maxStroke) { this.lift(); this.needSlow = true; }
    }
    this.cursor = { x: c.x * W, y: c.y * H, pose: this.label, visible: true, drawing: !!this.live };
  }

  /** no usable point this frame: coast a stroke for a moment, then lift; the cursor hides a little later */
  private missing(t: number) {
    const sm = this.sm;
    if (sm.lastT < 0) { this.cursor = { ...this.cursor, visible: false, drawing: false }; return; }
    const gap = t - sm.lastT;
    if (gap <= this.gap('coast')) {
      const q = sm.coast(t);
      if (q && this.live) {
        const { W, H } = this.stage();
        this.add({ x: q.x * W, y: q.y * H });
        this.cursor = { ...this.cursor, x: q.x * W, y: q.y * H };
      }
      return;
    }
    this.lift();
    if (gap > this.gap('hide')) this.cursor = { ...this.cursor, visible: false, drawing: false };
  }

  private add(q: Pt) {
    const l = this.live!, last = l[l.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= 1.5) l.push(q);
  }

  /** end the stroke and cast it (up to `keep` points: the slow tail after the hand stopped isn't part of the shape) */
  private lift(keep?: number) {
    const pts = this.live;
    this.live = null;
    this.slowSince = -1;
    if (pts && keep !== undefined && pts.length > keep) pts.length = Math.max(2, keep);
    if (pts && pts.length > 1) this.onStroke(pts);
  }

  /** end the stroke without casting it */
  private drop() {
    this.live = null;
    this.slowSince = -1;
  }
}

function higher(a: Record<Side, Arm | null>) {
  return a.L && a.R ? (a.L.y < a.R.y ? a.L : a.R) : a.L ?? a.R;
}
