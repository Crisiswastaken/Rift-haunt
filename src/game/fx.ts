/* Effects on the top layer. Everything here moves, scales and fades image assets (the felt symbols, the felt
   heart); nothing is a code-drawn particle. The exceptions are text (score pops) and your stroke, which is drawn as
   a felt ribbon: the ghost's own felt as a pattern, tinted the symbol's colour when it casts. Both are drawn with
   canvas 2D into small sprites of their own, then go on screen through the WebGL painter like everything else. */
import type { Pt } from '../config';
import type { Painter } from '../render/gl';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const outCubic = (q: number) => 1 - (1 - q) ** 3;
const outBack = (q: number) => 1 + 2.4 * (q - 1) ** 3 + 1.4 * (q - 1) ** 2;
const inOut = (q: number) => q < .5 ? 2 * q * q : 1 - (-2 * q + 2) ** 2 / 2;

export const FONT = 'Fredoka, "Baloo 2", "Nunito", system-ui, sans-serif';
/** text sprites are drawn at this many pixels per CSS pixel, so they stay sharp on dense screens */
const TEXT_RES = 2;

type Img = HTMLImageElement | HTMLCanvasElement;
interface Pop { img: Img; x: number; y: number; size: number; age: number; life: number; rise: number }
interface Text { c: HTMLCanvasElement; x: number; y: number; w: number; h: number; age: number }
interface Strike { img: Img; x: number; y: number; size: number; age: number; delay: number }
interface Flight { img: Img; x0: number; y0: number; to: () => { x: number; y: number; size: number }; size: number; age: number; land: () => void; landed: boolean }

export class Fx {
  private pops: Pop[] = [];
  private texts: Text[] = [];
  private strikes: Strike[] = [];
  private flights: Flight[] = [];
  private gone: HTMLCanvasElement[] = [];

  /** a knocked-off symbol swells and fades where it was */
  knock(img: Img, x: number, y: number, size: number) {
    this.pops.push({ img, x, y, size, age: 0, life: .3, rise: 0 });
  }

  /** the shape you drew, shown faintly where you drew it, when it matched nothing on screen */
  mark(img: Img, x: number, y: number, size: number) {
    this.pops.push({ img, x, y, size, age: 0, life: .55, rise: size * .4 });
  }

  /** "+30" rising off a ghost in the colour of the symbol that hit it */
  score(text: string, color: string, x: number, y: number, size: number) {
    const c = document.createElement('canvas'), g = c.getContext('2d')!, font = `700 ${size * TEXT_RES}px ${FONT}`;
    g.font = font;
    const pad = size * .3 * TEXT_RES, tw = g.measureText(text).width;
    c.width = Math.ceil(tw + pad * 2); c.height = Math.ceil(size * 1.5 * TEXT_RES);
    g.font = font;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = Math.max(3, size * .16) * TEXT_RES;
    g.strokeStyle = 'rgba(22, 14, 54, .72)';
    g.strokeText(text, c.width / 2, c.height / 2);
    g.fillStyle = color;
    g.fillText(text, c.width / 2, c.height / 2);
    this.texts.push({ c, x, y, w: c.width / TEXT_RES, h: c.height / TEXT_RES, age: 0 });
  }

  /** a felt bolt slams down onto a ghost, `delay` seconds from now */
  strike(img: Img, x: number, y: number, size: number, delay: number) {
    this.strikes.push({ img, x, y, size, age: 0, delay });
  }

  /** the felt heart flies from a banished heart ghost up to its slot in the HUD */
  heart(img: Img, x: number, y: number, size: number, to: Flight['to'], land: () => void) {
    this.flights.push({ img, x0: x, y0: y, to, size, age: 0, land, landed: false });
  }

  clear() {
    this.gone.push(...this.texts.map(t => t.c));
    this.pops = []; this.texts = []; this.strikes = []; this.flights = [];
  }

  update(dt: number) {
    for (const p of this.pops) p.age += dt;
    for (const p of this.texts) p.age += dt;
    for (const p of this.strikes) p.age += dt;
    for (const f of this.flights) {
      f.age += dt;
      if (!f.landed && f.age >= .75) { f.landed = true; f.land(); }
    }
    this.pops = this.pops.filter(p => p.age < p.life);
    this.gone.push(...this.texts.filter(p => p.age >= .95).map(p => p.c));
    this.texts = this.texts.filter(p => p.age < .95);
    this.strikes = this.strikes.filter(p => p.age < p.delay + .5);
    this.flights = this.flights.filter(f => !f.landed);
  }

  draw(p: Painter) {
    for (const c of this.gone) p.forget(c);
    this.gone = [];
    for (const q of this.pops) {
      const k = q.age / q.life, s = q.size * (1 + .8 * outCubic(k));
      p.image(q.img, q.x - s / 2, q.y - s / 2 - q.rise * outCubic(k), s, s, (1 - k) ** 1.5 * (q.rise ? .8 : 1));
    }
    for (const q of this.strikes) {
      const a = q.age - q.delay;
      if (a < 0) continue;
      // falls in big from above, lands, then swells away
      const fall = clamp(a / .12, 0, 1), land = clamp((a - .12) / .38, 0, 1);
      const s = q.size * (fall < 1 ? 2.6 - 1.4 * outCubic(fall) : 1.2 + .9 * outCubic(land));
      const y = q.y - q.size * 1.6 * (1 - outCubic(fall));
      p.image(q.img, q.x - s / 2, y - s / 2, s, s, fall < 1 ? .4 + .6 * fall : (1 - land) ** 1.4);
    }
    for (const q of this.texts) {
      const k = q.age / .95, s = q.age < .18 ? .6 + .4 * outBack(q.age / .18) : 1;
      const w = q.w * s, h = q.h * s, y = q.y - q.h * 1.05 * outCubic(k);
      p.image(q.c, q.x - w / 2, y - h / 2, w, h, k < .6 ? 1 : 1 - (k - .6) / .4);
    }
    for (const f of this.flights) {
      const q = clamp(f.age / .75, 0, 1), e = inOut(q), to = f.to();
      // an arc up and over to the slot, shrinking to the HUD heart's size
      const x = f.x0 + (to.x - f.x0) * e, y = f.y0 + (to.y - f.y0) * e - Math.sin(Math.PI * q) * f.size * 1.2;
      const s = f.size * (q < .15 ? .7 + .6 * outBack(q / .15) : 1.3) + (to.size - f.size * 1.3) * e;
      p.image(f.img, x - s / 2, y - s / 2, s, s);
    }
  }
}

/* ---------- your stroke ---------- */

interface Trail { pts: Pt[]; age: number; color: string | null }

function path(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  // through the midpoints, so a mouse's straight segments read as one soft line
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

export class Ink {
  private trails: Trail[] = [];
  private felt: CanvasPattern | null = null;
  private tile: HTMLCanvasElement;
  /** the ribbons are drawn here, just big enough to hold them, then put on screen in one go */
  private c = document.createElement('canvas');
  private g = this.c.getContext('2d')!;

  /** body: the felt ghost's body, whose middle is cut into the ribbon's texture */
  constructor(body: HTMLCanvasElement) {
    const t = document.createElement('canvas'), n = 96, src = body.width * .34;
    t.width = t.height = n;
    t.getContext('2d')!.drawImage(body, body.width * .33, body.height * .45, src, src, 0, 0, n, n);
    this.tile = t;
  }

  /** the stroke you just finished: tinted the colour of what it cast, or grey when it read as nothing */
  finish(pts: Pt[], color: string | null) {
    if (pts.length > 1) this.trails.push({ pts, age: 0, color });
  }

  clear() { this.trails = []; }

  update(dt: number) {
    for (const t of this.trails) t.age += dt;
    this.trails = this.trails.filter(t => t.age < (t.color ? .5 : .3));
  }

  draw(p: Painter, live: Pt[] | null, U: number) {
    const all = live && live.length > 1 ? [...this.trails.map(t => t.pts), live] : this.trails.map(t => t.pts);
    if (!all.length) return;
    const width = Math.max(7, U * .0085), m = width * 4, d = p.dpr;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pts of all) for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    x0 -= m; y0 -= m; x1 += m; y1 += m;
    const cw = Math.ceil((x1 - x0) * d), ch = Math.ceil((y1 - y0) * d), c = this.c, g = this.g;
    if (c.width < cw || c.height < ch) { c.width = Math.max(c.width, cw); c.height = Math.max(c.height, ch); this.felt = null; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.setTransform(d, 0, 0, d, -x0 * d, -y0 * d);
    this.felt ??= g.createPattern(this.tile, 'repeat');
    for (const t of this.trails) {
      const q = t.age / (t.color ? .5 : .3);
      this.ribbon(g, t.pts, width * (1 + (t.color ? .25 * outCubic(Math.min(1, q * 3)) : 0)), (1 - q) ** 1.3, t.color);
    }
    if (live && live.length > 1) this.ribbon(g, live, width, 1, null);
    p.image(c, x0, y0, cw / d, ch / d, 1, { fresh: true, sub: [0, 0, cw, ch] });
  }

  private ribbon(ctx: CanvasRenderingContext2D, pts: Pt[], width: number, alpha: number, color: string | null) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    path(ctx, pts);
    // a soft glow in the mist under it, coloured once it has cast
    ctx.globalAlpha = alpha * (color ? .5 : .3);
    ctx.strokeStyle = color ?? '#d9d0ff';
    ctx.lineWidth = width * 3;
    ctx.shadowColor = color ?? 'rgba(200, 190, 255, .8)';
    ctx.shadowBlur = width * 2;
    ctx.stroke();
    // the felt core, with a dark edge so it reads over the bright fog
    ctx.shadowColor = 'rgba(18, 12, 52, .55)';
    ctx.shadowBlur = width * .9;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.felt ?? '#f1ecff';
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (color) {
      // tint the felt core, keeping its texture
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  }
}
