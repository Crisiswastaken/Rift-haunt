/* You, in the graveyard: the camera picture cut out by the body model's person mask, mirrored like a mirror, standing
   at the bottom centre where the scene leaves room for you (the doodle's cat's place). Sized from your shoulders so
   your face is about 13% of the screen tall wherever you stand, your nose in the middle about halfway down, and never
   floating: if the picture would end above the bottom of the screen (standing close), it's enlarged a little and
   then lowered until it reaches it. The framing follows you slowly, so leaning about doesn't throw the picture
   around. It also gives the ghosts your chin to fly at. */
import type { Pt } from '../config';
import type { Body } from '../input/hand/body';
import type { PoseFrame, ViewReq } from '../input/hand/vision';
import type { Gl, Tex } from './gl';

/** your face's height on screen, and where your nose goes (fractions of the screen) */
const FACE_H = .13, NOSE_AT = { x: .5, y: .53 };
/** a face is about this many shoulder widths tall */
const FACE_PER_S = .5;
/** standing close, the picture may be enlarged this much to reach the bottom of the screen before it's lowered */
const MAX_ZOOM = 1.6;
/** seconds for the framing to settle on a new place */
const FOLLOW = .8;
const NOSE = 0;

export class Player {
  /** the picture's size (pixels of the frames we get) and its place on the stage: x = ox + (1 - u) * iw * s */
  iw = 640; ih = 360; s = 1; ox = 0; oy = 0;
  private seenT = -9;
  private maskT = -9;
  private img: Tex | null = null;
  private mask: Tex | null = null;
  private shown = 0;
  private framed = false;
  /** the part of the frame the picture is of (x, y, w, h fractions): all of it, or the sharper on-screen part */
  private part: [number, number, number, number] = [0, 0, 1, 1];
  private W = 0; private H = 0; private dpr = 1;

  constructor(private gl: Gl, private body: Body) {}

  /** a new camera frame from the body model, with the mask */
  take(r: PoseFrame, now: number) {
    this.iw = r.bitmap.width; this.ih = r.bitmap.height;
    this.img = this.gl.update(this.img, r.view?.bitmap ?? r.bitmap);
    this.part = r.view?.part ?? [0, 0, 1, 1];
    r.bitmap.close();
    r.view?.bitmap.close();
    if (r.mask) {
      this.mask = this.gl.maskTexture(this.mask, r.mask.data, r.mask.w, r.mask.h);
      // is anyone there? a few percent of the picture being a person is enough
      let on = 0;
      for (let i = 0; i < r.mask.data.length; i += 16) if (r.mask.data[i] > 128) on++;
      if (on * 16 > r.mask.data.length * .03) this.maskT = now;
    }
    if (r.lm) this.seenT = now;
  }

  /** someone's in front of the camera */
  present(now: number) { return now - this.seenT < 1.5 || now - this.maskT < .6; }

  /** ease the framing toward where it should be */
  frame(W: number, H: number, dt: number) {
    const b = this.body, iw = this.iw, ih = this.ih;
    this.W = W; this.H = H;
    // until we've seen you: the picture across the bottom of the screen
    let s = W / iw, ox = 0, oy = H - ih * s;
    if (b.lm && b.S > 0) {
      const nx = b.lm[NOSE * 4] * iw, ny = b.lm[NOSE * 4 + 1] * ih;
      const face = FACE_PER_S * b.S / b.w * iw;
      s = FACE_H * H / face;
      // never floating: enlarge (up to MAX_ZOOM) until the picture reaches the bottom, then lower it
      const reach = (1 - NOSE_AT.y) * H / Math.max(1, ih - ny);
      s = Math.max(s, Math.min(s * MAX_ZOOM, reach));
      ox = NOSE_AT.x * W - (iw - nx) * s;
      oy = Math.max(NOSE_AT.y * H - ny * s, H - ih * s);
    }
    const k = this.framed ? 1 - Math.exp(-dt / FOLLOW) : 1;
    this.framed = true;
    this.s += (s - this.s) * k; this.ox += (ox - this.ox) * k; this.oy += (oy - this.oy) * k;
  }

  /** the part of the camera picture (vw x vh pixels) that's on screen, and the size worth keeping it at (no more pixels
      than it covers on screen, nor than the camera has): the picture of you is taken from this, sharp however far
      back you stand */
  view(vw: number, vh: number): ViewReq | null {
    if (!this.framed || !vw) return null;
    const fw = this.iw * this.s, fh = this.ih * this.s;
    const u0 = Math.max(0, 1 - (this.W - this.ox) / fw), u1 = Math.min(1, 1 + this.ox / fw);
    const v0 = Math.max(0, -this.oy / fh), v1 = Math.min(1, (this.H - this.oy) / fh);
    if (u1 - u0 < .02 || v1 - v0 < .02) return null;
    const rect = { x: u0 * vw, y: v0 * vh, w: (u1 - u0) * vw, h: (v1 - v0) * vh };
    const k = Math.min(1, (u1 - u0) * fw * this.dpr / rect.w);
    return { rect, w: Math.max(2, Math.round(rect.w * k)), h: Math.max(2, Math.round(rect.h * k)) };
  }

  /** camera coordinates (0..1, not mirrored) to stage pixels */
  toScreen = (u: number, v: number): Pt => ({ x: this.ox + (1 - u) * this.iw * this.s, y: this.oy + v * this.ih * this.s });

  /** what the ghosts fly at: your chin, or null if we haven't seen you lately */
  target(now: number): Pt | null {
    const b = this.body;
    if (!b.lm || b.S <= 0 || now - this.seenT > 1.5) return null;
    const p = this.toScreen(b.lm[NOSE * 4], b.lm[NOSE * 4 + 1]), face = FACE_PER_S * b.S / b.w * this.iw * this.s;
    return { x: p.x, y: p.y + face * .6 };
  }

  /** draw you; fades in when the camera starts and out when you leave */
  draw(dpr: number, now: number, dt: number) {
    if (!this.img || !this.mask) return;
    this.dpr = dpr;
    this.shown += ((this.present(now) ? 1 : 0) - this.shown) * Math.min(1, dt * 3);
    const [px, py, pw, ph] = this.part, fw = this.iw * this.s, fh = this.ih * this.s;
    // the part's place on screen (mirrored: its right edge in the frame is its left on screen)
    const x = this.ox + (1 - px - pw) * fw, y = this.oy + py * fh;
    this.gl.drawCutout(this.img, this.mask, x * dpr, y * dpr, pw * fw * dpr, ph * fh * dpr, this.shown, .06, this.part);
  }

  get ready() { return !!this.img && !!this.mask; }

  /** forget the textures (the camera has stopped) */
  clear() {
    if (this.img) this.gl.free(this.img);
    if (this.mask) this.gl.free(this.mask);
    this.img = this.mask = null;
    this.seenT = this.maskT = -9; this.shown = 0; this.framed = false;
  }
}
