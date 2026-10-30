/* Smoothing a tracked hand into a steady, quick cursor: RIFT-Desktop's Fruit Ninja blade filter
   (rift/games/fruit_ninja.py, Slicer._step and friends), tuned there on recordings of real players.
   - A glitch gate: a point implausibly far from where the hand was heading is a dropped frame, unless the next one
     carries on further the same way (the start of a quick move) or a few agree on the new place (a real relocation).
   - A light One Euro track gives the speed; a heavy "aim" filter gives the position. Its cutoff opens with the speed
     above a jitter floor (a One Euro fed its own jittery speed opens up at rest: the vibrating cursor), and across
     the direction of motion it stays heavy, since sideways wobble is never what the player meant.
   - A still hand holds its spot inside a small deadzone; once moving it follows with no trailing offset.
   - A small forward lead at drawing speed, none when aiming or turning, so the cursor doesn't trail a quick stroke.
   Positions are fractions of the screen (0..1 across and down), times in seconds. */

const TAU = Math.PI * 2;
const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (TAU * cutoff * dt));

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(private minCutoff: number, private beta: number, private dCutoff = 1) {}

  filter(value: number, t: number): number {
    if (this.x === null) { this.x = value; this.dx = 0; this.t = t; return value; }
    const dt = t - this.t;
    if (dt <= 0) return this.x;
    this.t = t;
    this.dx += alpha(this.dCutoff, dt) * ((value - this.x) / dt - this.dx);
    this.x += alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (value - this.x);
    return this.x;
  }

  reset() { this.x = null; this.dx = 0; }
}

export interface SmoothOpts {
  /** the aim filter: Hz at rest, opening by `beta` per unit of speed over `vFloor` (screens a second) */
  minCutoff: number; beta: number; vFloor: number;
  /** across the direction of motion: Hz, plus this per unit of speed */
  perpCutoff: number; perpBeta: number;
  /** the speed track: a light One Euro, its slope over `velWindow` seconds */
  trackCutoff: number; trackBeta: number; velWindow: number;
  /** moving once it has gone `moveDisp` in `dispWindow` s or faster than `moveV`; still again under both `still*` */
  moveDisp: number; moveV: number; stillDisp: number; stillV: number; dispWindow: number;
  /** a still cursor holds its spot until the hand drifts this far */
  deadzone: number;
  /** forward lead: up to `lead` s of the smoothed velocity, none under `leadV0`, all from `leadV1`, at most `leadMax` */
  lead: number; leadV0: number; leadV1: number; leadMax: number; leadTau: number;
  /** the glitch gate: tolerance off the prediction at rest, growing by `jumpK` x speed x gap; `agree` frames relocate */
  jump0: number; jumpK: number; agree: number;
  /** screens a second: the gate's tolerance at rest is at least this times the gap between frames */
  jumpGap: number;
}

export type Pt2 = { x: number; y: number };
export type Push = 'ok' | 'skip' | 'jump';

export class Smoother {
  /** the steady point (what a stroke is drawn from) and the cursor (with the lead), or null before the first frame */
  point: Pt2 | null = null;
  cursor: Pt2 | null = null;
  /** screens a second, from the light track; and still / moving */
  speed = 0;
  moving = false;
  vel = { x: 0, y: 0 };
  /** the last accepted frame, and how many have been accepted since the last restart (the speed means something from
      the third) */
  lastT = -1;
  n = 0;

  private tx: OneEuro;
  private ty: OneEuro;
  private aim: Pt2 | null = null;
  private rest: Pt2 | null = null;
  private last: Pt2 | null = null;
  private track: { t: number; x: number; y: number }[] = [];
  private raw: { t: number; x: number; y: number }[] = [];
  private hist: { t: number; x: number; y: number }[] = [];
  private leadV = { x: 0, y: 0 };
  private glitch: Pt2 | null = null;
  private glitchN = 0;

  constructor(private o: SmoothOpts) {
    this.tx = new OneEuro(o.trackCutoff, o.trackBeta, 1);
    this.ty = new OneEuro(o.trackCutoff, o.trackBeta, 1);
  }

  /** one frame's point; `sure`: the tracker is confident in it (only confident frames can agree on a relocation) */
  push(sx: number, sy: number, t: number, sure = true): Push {
    const o = this.o;
    let result: Push = 'ok';
    if (this.last && this.lastT >= 0) {
      const gap = t - this.lastT;
      const px = this.last.x + this.vel.x * gap, py = this.last.y + this.vel.y * gap;
      // tight at rest, open at speed; and with frames far apart (a slow camera), a quick move covers more between them
      const tol = Math.max(o.jump0, o.jumpGap * gap) + o.jumpK * Math.hypot(this.vel.x, this.vel.y) * gap;
      if (Math.hypot(sx - px, sy - py) > tol) {
        const g = this.glitch, L = this.last;
        const onward = !!g && Math.hypot(g.x - L.x, g.y - L.y) < .3
          && Math.hypot(sx - L.x, sy - L.y) > Math.hypot(g.x - L.x, g.y - L.y) + .02
          && (sx - g.x) * (g.x - L.x) + (sy - g.y) * (g.y - L.y) > 0;
        if (g && Math.hypot(sx - g.x, sy - g.y) <= 2 * o.jump0) this.glitchN += sure ? 1 : 0;
        else { this.glitch = { x: sx, y: sy }; this.glitchN = sure ? 1 : 0; }
        if (this.glitchN < o.agree && !(onward && sure)) return 'skip';
        if (!onward) { this.restart(); result = 'jump'; }
      }
    }
    this.glitch = null; this.glitchN = 0;

    // speed from the light track (slope over the window)
    const kx = this.tx.filter(sx, t), ky = this.ty.filter(sy, t);
    this.track.push({ t, x: kx, y: ky });
    while (this.track.length > 2 && t - this.track[1].t >= o.velWindow) this.track.shift();
    const old = this.track[0], dt = t - old.t;
    this.vel = dt >= .02 ? { x: (kx - old.x) / dt, y: (ky - old.y) / dt } : { x: 0, y: 0 };
    const speed = this.speed = Math.hypot(this.vel.x, this.vel.y);

    // still or moving: a real move shows as distance over a short window (jitter averages out), or clear speed
    this.raw.push({ t, x: sx, y: sy });
    while (this.raw.length > 1 && t - this.raw[0].t > o.dispWindow) this.raw.shift();
    const r0 = this.raw[0], disp = t - r0.t >= o.dispWindow * .6 ? Math.hypot(sx - r0.x, sy - r0.y) : 0;
    this.moving = this.moving ? !(disp < o.stillDisp && speed < o.stillV) : disp > o.moveDisp || speed > o.moveV;

    // the aim: heavy at rest, opening with speed; along the motion light, across it heavy
    if (!this.aim || this.lastT < 0) this.aim = { x: sx, y: sy };
    else {
      const dts = Math.max(t - this.lastT, 1e-3);
      let fc = o.minCutoff + o.beta * Math.max(0, speed - o.vFloor);
      if (this.moving) fc = Math.max(fc, 1.5);
      const fp = Math.min(fc, o.perpCutoff + o.perpBeta * speed), a = alpha(fc, dts), ap = alpha(fp, dts);
      const ex = sx - this.aim.x, ey = sy - this.aim.y;
      if (speed > o.vFloor) {
        const ux = this.vel.x / speed, uy = this.vel.y / speed, along = ex * ux + ey * uy;
        const qx = ex - along * ux, qy = ey - along * uy;
        this.aim = { x: this.aim.x + a * along * ux + ap * qx, y: this.aim.y + a * along * uy + ap * qy };
      } else this.aim = { x: this.aim.x + a * ex, y: this.aim.y + a * ey };
    }
    const p = this.point = this.hold(this.aim);
    this.hist.push({ t, x: p.x, y: p.y });
    while (this.hist.length && t - this.hist[0].t > .5) this.hist.shift();
    this.last = { x: kx, y: ky };
    const prevT = this.lastT;
    this.lastT = t;
    this.n++;

    // forward lead: only at drawing speed, from a smoothed velocity, fading as the direction turns
    const al = Math.min(1, (prevT >= 0 ? t - prevT : 1 / 30) / o.leadTau);
    this.leadV = { x: this.leadV.x + al * (this.vel.x - this.leadV.x), y: this.leadV.y + al * (this.vel.y - this.leadV.y) };
    const lv = Math.hypot(this.leadV.x, this.leadV.y);
    let lead = o.lead * Math.min(1, Math.max(0, (lv - o.leadV0) / (o.leadV1 - o.leadV0)));
    if (lead > 0 && lv > 0 && speed > 0) lead *= Math.max(0, (this.leadV.x * this.vel.x + this.leadV.y * this.vel.y) / (lv * speed));
    let ox = this.leadV.x * lead, oy = this.leadV.y * lead;
    const n = Math.hypot(ox, oy);
    if (n > o.leadMax) { ox *= o.leadMax / n; oy *= o.leadMax / n; }
    this.cursor = { x: clamp01(p.x + ox), y: clamp01(p.y + oy) };
    return result;
  }

  /** a short gap with no frame: carry on along the last velocity, slowing (null once there's nothing to go on) */
  coast(t: number): Pt2 | null {
    if (!this.point || this.lastT < 0) return null;
    const gap = t - this.lastT, k = .5 ** (gap / .033);
    return { x: clamp01(this.point.x + this.vel.x * gap * k), y: clamp01(this.point.y + this.vel.y * gap * k) };
  }

  /** the steady points since time t (the start of a stroke, before the pen was put down) */
  since(t: number): Pt2[] { return this.hist.filter(h => h.t >= t).map(h => ({ x: h.x, y: h.y })); }

  /** start afresh: the next point is taken as it comes, with no line from the last */
  restart() {
    this.aim = this.rest = this.last = null;
    this.tx.reset(); this.ty.reset();
    this.track = []; this.raw = []; this.hist = [];
    this.moving = false;
    this.vel = { x: 0, y: 0 }; this.leadV = { x: 0, y: 0 };
    this.lastT = -1;
    this.n = 0;
  }

  reset() {
    this.restart();
    this.point = this.cursor = null;
    this.glitch = null; this.glitchN = 0;
    this.speed = 0;
  }

  /** the still-hand deadzone: a still cursor keeps its spot until the hand moves or drifts out of it; once moving it
      catches up within a couple of frames and then sits on the hand */
  private hold(p: Pt2): Pt2 {
    const r = this.rest, dz = this.o.deadzone;
    if (!r) return this.rest = { ...p };
    const d = Math.hypot(p.x - r.x, p.y - r.y);
    if (!this.moving && d <= dz) return r;
    if (this.moving) {
      let q = { x: r.x + .8 * (p.x - r.x), y: r.y + .8 * (p.y - r.y) };
      if (Math.hypot(p.x - q.x, p.y - q.y) < .004) q = { ...p };
      return this.rest = q;
    }
    const k = d > 0 ? Math.min(1, dz / d) * .8 : 0;
    return this.rest = { x: p.x - (p.x - r.x) * k, y: p.y - (p.y - r.y) * k };
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
