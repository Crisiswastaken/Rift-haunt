/* Where you are and which hand you're drawing with, from the body model, and where your hand is on the screen:
   RIFT-Desktop's Fruit Ninja slicer (rift/games/fruit_ninja.py, Slicer._arm, _unswap, _body, _box, _to_screen and its
   hand choice), which was tuned on recordings of real players.
   - Size: S is your shoulder width in camera pixels (the 75th percentile over a few seconds, not taken while the hand
     is flying about). Up close, with the shoulders out of the picture, it comes from the width of your head.
   - The box: your hand moves in a box anchored to your body, box.w x box.h shoulder widths, centred on the drawing
     hand's shoulder a little below the shoulder line, and that box is the whole screen (a little more, so the edges
     are easy to reach). In shoulder widths it doesn't matter how far away you stand, and anchored to the shoulder it
     follows you when you step. Up close it's shrunk to fit the picture.
   - Which hand: the raised one; the other takes over only when it's clearly higher for a moment, or when the first
     has been gone a while.
   Positions are camera pixels; the landmarks are the body model's, normalised to the frame and not mirrored. */

export type Side = 'L' | 'R';

const NOSE = 0, LEAR = 7, REAR = 8, LSH = 11, RSH = 12, LELB = 13, RELB = 14, LWRI = 15, RWRI = 16;
/** every left / right pair, for undoing the model's occasional swap of all its labels */
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

export interface BodyOpts {
  /** a landmark this visible counts; a wrist down to `wristLo` still counts when its elbow is solid */
  vis: number; wristLo: number;
  /** the palm is this far past the wrist along the forearm (a fraction of the forearm) */
  palm: number;
  box: { w: number; h: number; dy: number; fit: number; overX: number; overTop: number; overBottom: number };
  /** seconds for the box's anchor to follow the shoulders; seconds of shoulder widths kept for S */
  anchorTau: number; sizeWindow: number;
  /** S: the other wrist must be this much higher than the drawing one, for `switchTime` s, to take over */
  raiseMargin: number; switchTime: number;
  /** S above the shoulders: a hand becomes the drawing hand only once its wrist is above this (above the hips) */
  raised: number;
  /** the drawing hand gone this long lets the other one take over */
  holdTime: number;
  /** S under the shoulders: a hand hanging this low is resting (until it comes back above `restBack`) */
  restY: number; restBack: number;
  /** a hand this far under the box (of its height) is resting too */
  below: number;
  /** a wrist this near the picture's edge (a fraction of it) is a guess, not a hand */
  edge: number;
  /** S: a wrist further than this from its elbow is another keypoint wearing its label */
  reach: number;
  /** S from the head when the shoulders are out of the picture: S = ear-to-ear x earS */
  earS: number;
}

export interface Arm {
  /** the palm, in camera pixels */
  x: number; y: number;
  /** how far the wrist is above its shoulder, in S */
  lift: number;
  score: number;
}

export class Body {
  /** the camera picture's size */
  w = 1280; h = 720;
  /** shoulder width in camera pixels (0 until we know) */
  S = 0;
  /** when the body was last seen (seconds), and the landmarks then (labels un-swapped) */
  t = -9;
  lm: Float32Array | null = null;
  /** the drawing hand (the person's own left or right), and both arms as last seen */
  side: Side | null = null;
  arms: Record<Side, Arm | null> = { L: null, R: null };
  /** the shoulders were seen (not guessed from the head) */
  shoulders = false;
  /** while true the reach box (centre and size) is frozen: set by the pen while it's down */
  holdBox = false;

  private held: { x: number; y: number; w: number; h: number } | null = null;
  private anchor: number[] | null = null;
  private anchorT = 0;
  private sizes: { t: number; s: number }[] = [];
  private order = 0;
  private disagreeSince = -1;
  private otherSince = -1;
  private lostSince = -1;
  /** since when the shoulders have looked much narrower than S (stepping back, or a bad frame) */
  private smallSince = -1;

  constructor(private o: BodyOpts) {}

  /** the body model's latest frame (null: nobody). `moving`: the hand is moving (the box mustn't move under it), `fast`:
      it's moving quickly (shoulders twist, so S isn't measured). Returns true when the drawing hand changed. */
  update(lmIn: Float32Array | null, w: number, h: number, t: number, moving: boolean, fast: boolean): boolean {
    this.w = w; this.h = h;
    if (!lmIn) return false;
    const lm = this.unswap(lmIn, t);
    if (!this.measure(lm, t, moving, fast)) return false;
    this.lm = lm;
    this.t = t;
    const o = this.o;
    this.arms = { L: this.arm(lm, LWRI, LELB, LSH), R: this.arm(lm, RWRI, RELB, RSH) };
    const A = this.arms;
    let changed = false;
    if (!this.side || !A[this.side]) {
      // no drawing hand, or it vanished: wait for it a moment; the other takes over when it's clearly up, or after a while
      let up = (['L', 'R'] as Side[]).filter(s => A[s] && A[s]!.lift > o.raised);
      if (this.side) {
        if (this.lostSince < 0) this.lostSince = t;
        up = up.filter(s => A[s]!.lift > .1 || t - this.lostSince >= o.holdTime);
      }
      if (!up.length) return false;
      const best = up.reduce((a, b) => (A[b]!.lift > A[a]!.lift ? b : a));
      changed = !!this.side && best !== this.side;
      this.side = best;
      this.otherSince = this.lostSince = -1;
    } else {
      this.lostSince = -1;
      const other: Side = this.side === 'L' ? 'R' : 'L', a = A[other], me = A[this.side]!;
      if (a && a.lift > o.raised + .2 && a.lift > me.lift + o.raiseMargin) {
        if (this.otherSince < 0) this.otherSince = t;
        if (t - this.otherSince >= o.switchTime) { this.side = other; this.otherSince = -1; changed = true; }
      } else this.otherSince = -1;
    }
    return changed;
  }

  /** seen in the last moment */
  fresh(t: number, within = .25) { return t - this.t < within; }

  /** where the drawing hand's box is, in camera pixels (centre and size): shrunk and shifted to stay in the picture */
  box(side: Side | null) {
    if (this.holdBox && this.held) return this.held;
    const o = this.o, b = o.box, S = this.S;
    const a = this.anchor ?? [this.w * .6, this.h * .55, this.w * .4, this.h * .55];
    let ax = side === 'L' ? a[0] : side === 'R' ? a[2] : (a[0] + a[2]) / 2, ay = (a[1] + a[3]) / 2 + b.dy * S;
    let bw = b.w * S, bh = b.h * S;
    const k = Math.min(1, b.fit * this.w / bw, b.fit * this.h / bh);
    bw *= k; bh *= k;
    const mx = (1 - b.fit) / 2 * this.w, my = (1 - b.fit) / 2 * this.h;
    ax = Math.min(Math.max(ax, bw / 2 + mx), this.w - bw / 2 - mx);
    ay = Math.min(Math.max(ay, bh / 2 + my), this.h - bh / 2 - my);
    return this.held = { x: ax, y: ay, w: bw, h: bh };
  }

  /** a camera point to the screen (0..1 across and down, mirrored like a mirror, clamped), and how far down the box it
      is unclamped (over 1: under the box) */
  toScreen(px: number, py: number, side: Side | null) {
    const b = this.o.box, bx = this.box(side);
    const u = 1 - (px - (bx.x - bx.w / 2)) / bx.w, v = (py - (bx.y - bx.h / 2)) / bx.h;
    const x = -b.overX + u * (1 + 2 * b.overX), y = -b.overTop + v * (1 + b.overTop + b.overBottom);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), v };
  }

  /** with no body to go on (up close the model can lose you), the size from the hand: S ~ palm width x k */
  sizeFromHand(palmPx: number, k: number) {
    if (!this.lm || this.S <= 0) this.S = this.S > 0 ? this.S + (palmPx * k - this.S) * .1 : palmPx * k;
  }

  /** a landmark in camera pixels, and how visible it is */
  at(i: number) {
    const lm = this.lm!;
    return { x: lm[i * 4] * this.w, y: lm[i * 4 + 1] * this.h, vis: lm[i * 4 + 3] };
  }

  reset() {
    this.S = 0; this.t = -9; this.lm = null; this.side = null; this.arms = { L: null, R: null };
    this.anchor = null; this.sizes = []; this.order = 0; this.disagreeSince = this.otherSince = this.lostSince = this.smallSince = -1;
    this.shoulders = false; this.held = null;
  }

  /** the model now and then swaps every left / right label at once. Facing the camera the shoulders keep their order
      in the picture, so a frame whose order disagrees is read with the labels swapped back (one that lasts is the new
      normal) */
  private unswap(lm: Float32Array, t: number): Float32Array {
    const o = lm[LSH * 4] > lm[RSH * 4] ? 1 : -1;
    if (Math.abs(this.order) >= .5 && o * this.order < 0) {
      if (this.disagreeSince < 0) this.disagreeSince = t;
      if (t - this.disagreeSince < 1.5) {
        const s = lm.slice();
        for (const [a, b] of PAIRS) for (let k = 0; k < 4; k++) { s[a * 4 + k] = lm[b * 4 + k]; s[b * 4 + k] = lm[a * 4 + k]; }
        return s;
      }
      this.order = o; this.disagreeSince = -1;
      return lm;
    }
    this.disagreeSince = -1;
    this.order += .1 * (o - this.order);
    return lm;
  }

  /** the shoulder anchor and S; false when there's nothing to go on */
  private measure(lm: Float32Array, t: number, moving: boolean, fast: boolean): boolean {
    const o = this.o, w = this.w, h = this.h;
    // a joint below or beside the picture still reports high visibility (the model guesses it): it has to be in frame
    const v = (i: number) => lm[i * 4 + 1] <= .95 && lm[i * 4] >= .02 && lm[i * 4] <= .98 ? lm[i * 4 + 3] : 0;
    let sh: number[], sw: number;
    if (v(LSH) >= o.vis && v(RSH) >= o.vis) {
      sh = [lm[LSH * 4] * w, lm[LSH * 4 + 1] * h, lm[RSH * 4] * w, lm[RSH * 4 + 1] * h];
      sw = Math.hypot(sh[0] - sh[2], sh[1] - sh[3]);
      this.shoulders = true;
    } else if (v(LEAR) >= o.vis && v(REAR) >= o.vis) {
      // up close: the shoulders are out of the picture; guess them from the head
      const ex = (lm[LEAR * 4] + lm[REAR * 4]) / 2 * w, ey = (lm[LEAR * 4 + 1] + lm[REAR * 4 + 1]) / 2 * h;
      sw = Math.hypot((lm[LEAR * 4] - lm[REAR * 4]) * w, (lm[LEAR * 4 + 1] - lm[REAR * 4 + 1]) * h) * o.earS;
      // measured with both in frame: the shoulder line is .59 S under the ears
      sh = [ex + sw / 2, ey + .59 * sw, ex - sw / 2, ey + .59 * sw];
      this.shoulders = false;
    } else return false;
    // a glimpse of something that isn't shoulders
    if (sw < 30 || sw > .9 * w) return false;
    if (!this.anchor) { this.anchor = sh; this.S = sw; }
    else if (!moving) {
      // the shoulders bob and twist while you draw: the box mustn't move under the cursor
      const a = Math.min(1, (t - this.anchorT) / o.anchorTau);
      this.anchor = this.anchor.map((p, i) => p + a * (sh[i] - p));
    }
    this.anchorT = t;
    if (!fast && sw >= .85 * this.S) {
      this.sizes.push({ t, s: sw });
      while (this.sizes.length && t - this.sizes[0].t > o.sizeWindow) this.sizes.shift();
      const s = this.sizes.map(x => x.s).sort((a, b) => a - b);
      this.S = s[Math.floor((s.length - 1) * .75)];
    }
    // stepped well back (narrower for a whole second, not a frame or two): S has to be able to come down too
    if (sw < .6 * this.S) {
      if (this.smallSince < 0) this.smallSince = t;
      else if (t - this.smallSince > 1) { this.sizes = []; this.S = sw; this.smallSince = -1; }
    } else this.smallSince = -1;
    return true;
  }

  /** one arm: the palm (camera pixels) and how raised it is, or null when it isn't usable */
  private arm(lm: Float32Array, wri: number, elb: number, sh: number): Arm | null {
    const o = this.o, w = this.w, h = this.h, S = Math.max(this.S, 1);
    const ws = lm[wri * 4 + 3], es = lm[elb * 4 + 3];
    if (ws < o.wristLo || (ws < o.vis && es < .5)) return null;
    const wx = lm[wri * 4] * w, wy = lm[wri * 4 + 1] * h;
    if (wx < o.edge * w || wx > (1 - o.edge) * w || wy < o.edge * h || wy > (1 - 2 * o.edge) * h) return null;
    const shx = this.anchorPt(sh, lm, 0), shy = this.anchorPt(sh, lm, 1);
    let x = wx, y = wy;
    if (es >= o.vis) {
      const ex = lm[elb * 4] * w, ey = lm[elb * 4 + 1] * h;
      // the arm has to hold together: a wrist far from its elbow is another keypoint wearing its label
      if (Math.hypot(wx - ex, wy - ey) > o.reach * S || (this.shoulders && Math.hypot(ex - shx, ey - shy) > 1.2 * S)) return null;
      x = wx + o.palm * (wx - ex); y = wy + o.palm * (wy - ey);
    } else if (Math.hypot(wx - shx, wy - shy) > 2 * S) return null;
    return { x, y, lift: (shy - wy) / S, score: ws };
  }

  /** a shoulder's position: the model's, or the one guessed from the head up close */
  private anchorPt(sh: number, lm: Float32Array, k: 0 | 1) {
    if (this.shoulders || !this.anchor) return lm[sh * 4 + k] * (k ? this.h : this.w);
    return this.anchor[(sh === LSH ? 0 : 2) + k];
  }
}

export { NOSE, LEAR, REAR, LSH, RSH };
