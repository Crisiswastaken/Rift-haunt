/* The felt ghost: how it moves, its state machine, and how it draws.

     spawn ──► approach ⇄ hit          (blinks now and then while it drifts)
                  │  last symbol off ──► banish: X eyes freeze, squash, POOF into felt wisps
                  └─ reaches you ──────► boo, then gone

   One rig rather than swapped frames:
   - the body is redrawn each frame in horizontal slices, so the hem ripples and trails behind as it moves;
   - a damped spring drives squash and stretch, so a hit wobbles and settles;
   - the face is its own layer: it blinks, glances toward you and changes expression without the body moving;
   - it faces the way it travels, turning with a quick squash through side-on rather than flipping.
   The banish is made from image assets only: the body springs up and dims out while the four felt wisps burst
   from behind it. Positions are a function of time, so a paused frame looks the same as a live one. */
import { GHOST, type Pt, type SymbolId } from '../config';
import type { Art, Face } from '../assets';
import type { Painter } from '../render/gl';

export type GhostState = 'live' | 'dying' | 'boo' | 'gone';
export type GhostEvent = 'reached' | 'remove' | null;
/** plain; a heart ghost (banish it to win a heart back, and it never hurts you); a storm ghost (its bolt clears
    the screen); the big one */
export type Kind = 'plain' | 'heart' | 'storm' | 'big';

export interface World {
  W: number; H: number;
  /** width of the 16:9 frame that fits the screen: the unit for sizes and speeds */
  U: number;
  /** where the ghosts are heading: you */
  tx: number; ty: number;
  t: number; dt: number;
  /** a global approach speed multiplier (each ghost's own pace carries its wave's speed) */
  speed: number;
  ghosts: Ghost[];
}

const SLICES = 30;
const SPAWN = .6, HIT = .38, BLINK = .12, BOO = .5, LEAVE = .7;
/** banish timings: hold the X eyes, squash, then the poof and its wisps */
export const DIE = { freeze: .12, squash: .08, fade: .32, puff: .6 };
const POP = DIE.freeze + DIE.squash;
const DIE_T = POP + DIE.puff;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => { const q = clamp((v - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
const lerp = (a: number, b: number, q: number) => a + (b - a) * q;
const outBack = (q: number) => 1 + 2.4 * (q - 1) ** 3 + 1.4 * (q - 1) ** 2;
const outCubic = (q: number) => 1 - (1 - q) ** 3;

// One scratch canvas for every ghost: the sliced body is put together here at full opacity and then drawn once,
// so slice edges never double up where the felt is see-through.
let scratch: HTMLCanvasElement | null = null;
function scratchFor(w: number, h: number) {
  scratch ??= document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) { scratch.width = Math.max(scratch.width, w); scratch.height = Math.max(scratch.height, h); }
  return scratch;
}

interface Slot { id: SymbolId; x: number }
interface Puff { img: HTMLImageElement; a: number; dist: number; size: number; rot: number; vr: number; flip: number; life: number }

export interface GhostOpts {
  scale?: number;
  at?: Pt;
  kind?: Kind;
  /** hover around here instead of approaching (the title screen, heart ghosts) */
  home?: Pt;
  /** pin how near it looks (0 far .. 1 near) instead of working it out from the approach */
  depth?: number;
}

export class Ghost {
  x = 0; y = 0; vx = 0; vy = 0;
  lean = 0;
  /** squash spring: positive is wide and short */
  sq = 0; sqv = 0;
  ph = rnd(0, 6.28); ph2 = rnd(0, 6.28);
  pace = rnd(.88, 1.12);
  born: number; hitT = -9; deadT = 0;
  /** how far away it started, for how near it is now */
  d0 = 1;
  blinkT = -9; nextBlink: number;
  /** when it started to leave without a fight (heart ghosts nobody caught) */
  leaveT = Infinity;
  state: GhostState = 'live';
  slots: Slot[];
  /** the row's centre, eased so the row slides along when a symbol comes off */
  rowC: number;
  readonly max: number;
  readonly scale: number;
  readonly kind: Kind;
  home: Pt | null;
  depth: number | null;
  /** a heart ghost's home slides across the screen at this many frame widths a second */
  drift = 0;
  /** 1 as drawn (tail trailing right, so heading left), -1 mirrored; eases through 0 to turn */
  facing = 1;
  private faceTo = 1;
  private puffs: Puff[] | null = null;

  constructor(queue: SymbolId[], w: World, o: GhostOpts = {}) {
    this.slots = queue.map((id, i) => ({ id, x: i }));
    this.rowC = (queue.length - 1) / 2;
    this.max = queue.length;
    this.scale = o.scale ?? 1;
    this.kind = o.kind ?? 'plain';
    this.home = o.home ?? null;
    this.depth = o.depth ?? null;
    this.born = w.t;
    this.nextBlink = w.t + rnd(1, 3.5);
    const at = o.at ?? o.home ?? { x: w.W * .5, y: w.H * .2 };
    this.x = at.x; this.y = at.y;
    this.d0 = Math.max(w.U * .3, Math.hypot(this.x - w.tx, this.y - w.ty));
    this.facing = this.faceTo = this.x < w.tx ? -1 : 1;
  }

  get live() { return this.state === 'live'; }
  get front(): SymbolId | undefined { return this.slots[0]?.id; }
  /** 0 where it started, 1 at you */
  progress(w: World) { return this.depth ?? clamp(1 - Math.hypot(this.x - w.tx, this.y - w.ty) / this.d0, 0, 1); }

  /** stop approaching and hover where it is, looking as near as it does now */
  hover(w: World) {
    this.depth = this.progress(w);
    this.home = { x: this.x, y: this.y };
  }

  /** Take the front symbol off. Returns where it was drawn, so the effect can pick it up from there. */
  strip(w: World, art: Art): { id: SymbolId; x: number; y: number; size: number } | null {
    if (!this.slots.length) return null;
    const at = this.glyphAt(w, art, 0), s = this.slots.shift()!;
    for (const o of this.slots) o.x -= 1;
    this.rowC -= 1;
    return { id: s.id, ...at };
  }

  /** lost a symbol but still here: flinch back, squash, flash */
  flinch(w: World) {
    this.hitT = w.t;
    this.sqv += 5.5;
    const dx = this.x - w.tx, dy = this.y - w.ty, d = Math.hypot(dx, dy) || 1;
    this.vx += dx / d * w.U * GHOST.knockback; this.vy += dy / d * w.U * GHOST.knockback;
  }

  banish(w: World) {
    if (!this.live) return;
    this.state = 'dying'; this.deadT = w.t; this.hitT = w.t; this.slots = [];
  }

  /** drift off without a fight */
  leave(w: World) { if (this.live && this.leaveT === Infinity) this.leaveT = w.t; }

  update(w: World): GhostEvent {
    const t = w.t, dt = w.dt, U = w.U, age = t - this.born, since = t - this.deadT;
    let event: GhostEvent = null;

    if (this.state === 'live') {
      // face the way it's heading; only turn once it's clearly crossed over, so the weave never flips it
      const dx = this.drift ? this.drift * U : w.tx - this.x, m = this.box(w).w * .4;
      if (dx > m) this.faceTo = -1; else if (dx < -m) this.faceTo = 1;
      if (this.drift && this.home) {
        this.home.x += this.drift * U * dt;
        if (this.drift > 0 ? this.home.x > w.W - U * .06 : this.home.x < U * .06) this.leave(w);
      }

      let vx: number, vy: number;
      if (this.home) {
        const hx = this.home.x + Math.sin(t * .55 + this.ph) * U * .012, hy = this.home.y + Math.sin(t * .8 + this.ph2) * U * .006;
        vx = (hx - this.x) * 2.4; vy = (hy - this.y) * 2.4;
      } else {
        let ux = w.tx - this.x, uy = w.ty - this.y;
        const d = Math.hypot(ux, uy) || 1; ux /= d; uy /= d;
        // it floats in on gusts rather than at a crawl: a slow swell in its speed, its own rhythm
        const gust = 1 + .28 * Math.sin(t * 1.25 + this.ph2) + .1 * Math.sin(t * 2.9 + this.ph);
        const sp = GHOST.speed * U * w.speed * this.pace * gust * smooth(0, 1.2, age) / Math.sqrt(this.scale);
        // a slow sideways weave so paths curve; it eases off on the final approach
        const lat = U * .03 * Math.sin(t * .62 + this.ph) * Math.min(1, d / (U * .3));
        vx = ux * sp - uy * lat; vy = uy * sp + ux * lat;
        if (d < U * GHOST.reach * Math.sqrt(this.scale)) { this.state = 'boo'; this.deadT = t; this.sqv -= 3; event = 'reached'; }
      }
      // keep clear of the others by their real sizes, so one body never hides another
      const mine = this.box(w).w;
      for (const o of w.ghosts) {
        if (o === this || !o.live) continue;
        const ox = this.x - o.x, oy = (this.y - o.y) * .75, od = Math.hypot(ox, oy), min = (mine + o.box(w).w) * .62;
        if (od < min && od > 0) {
          const f = (min - od) / min * U * (o.scale > this.scale ? 1.1 : .6);
          vx += ox / od * f; vy += oy / od * f;
        }
      }
      if (!this.home) {
        // jostled, it still stays in the open: below the score and hearts (where its row would cover its face),
        // above the front gravestones, inside the edges
        const top = w.H * .27, bottom = w.H * .62, side = U * .05;
        if (this.y < top) vy += (top - this.y) * 4;
        if (this.y > bottom) vy -= (this.y - bottom) * 4;
        if (this.x < side) vx += (side - this.x) * 4;
        if (this.x > w.W - side) vx -= (this.x - (w.W - side)) * 4;
      }
      const k = Math.min(1, (this.home ? 3 : 1.6) * dt);
      this.vx += (vx - this.vx) * k; this.vy += (vy - this.vy) * k;
      if (t > this.nextBlink) { this.blinkT = t; this.nextBlink = t + rnd(2, 5); }
      if (t - this.leaveT > LEAVE) { this.state = 'gone'; return 'remove'; }
    } else if (this.state === 'dying') {
      const k = Math.max(0, 1 - dt * 14);
      this.vx *= k; this.vy *= k;
      if (since > DIE_T) { this.state = 'gone'; return 'remove'; }
    } else if (this.state === 'boo') {
      const k = Math.max(0, 1 - dt * 6);
      this.vx *= k; this.vy *= k;
      if (since > BOO) { this.state = 'gone'; return 'remove'; }
    }

    this.facing += (this.faceTo - this.facing) * Math.min(1, dt * 9);
    this.x += this.vx * dt; this.y += this.vy * dt;
    // lean into the direction of travel; the squash spring
    const leanT = clamp(this.vx / U * 2.4, -.24, .24) + Math.sin(t * .8 + this.ph) * .025;
    this.lean += (leanT - this.lean) * Math.min(1, dt * 5);
    const h = Math.min(dt, .033);
    this.sqv += (-this.sq * 150 - this.sqv * 10) * h;
    this.sq += this.sqv * h;
    for (const [i, s] of this.slots.entries()) s.x += (i - s.x) * Math.min(1, dt * 14);
    this.rowC += ((this.slots.length - 1) / 2 - this.rowC) * Math.min(1, dt * 14);
    return event;
  }

  /** on-screen body width and centre; it grows a little as it nears you */
  box(w: World) {
    const near = this.progress(w), n = Math.min(this.max, 3);
    const size = GHOST.size * w.U * this.scale * (1 + GHOST.perSymbol * (n - 1)) * (.8 + .36 * near);
    return { x: this.x, y: this.y, w: size };
  }

  /** everything that shapes the drawn body this frame */
  private pose(w: World) {
    const t = w.t, age = t - this.born, since = t - this.deadT;
    let alpha = 1, s = 1, flash = 0, face: Face = 'idle';
    const bob = Math.sin(t * 1.7 + this.ph) * w.U * .006 * this.scale;
    const sx = 1 + this.sq - Math.cos(t * 1.7 + this.ph) * .018, sy = 1 - this.sq * .9 + Math.cos(t * 1.7 + this.ph) * .022;
    // spawn: fades and swells in, its symbols a beat ahead of it
    if (age < SPAWN) { const q = age / SPAWN; alpha = Math.min(1, q * 1.6); s *= .5 + .5 * outBack(q); }
    if (this.state === 'live') {
      const ht = t - this.hitT;
      face = ht < HIT ? 'hit' : t - this.blinkT < BLINK ? 'blink' : 'idle';
      flash = Math.max(0, 1 - ht / .2) * .8;
      if (this.leaveT < Infinity) alpha *= 1 - clamp((t - this.leaveT) / LEAVE, 0, 1);
    } else if (this.state === 'boo') {
      const q = Math.min(1, since / BOO);
      face = 'boo'; s *= 1 + .6 * outCubic(q); alpha = q < .45 ? 1 : 1 - (q - .45) / .55;
    }
    return { alpha, s, sx, sy, bob, flash, face };
  }

  /** the hem's sideways offset at height v (0 top, 1 bottom), as a fraction of the body width */
  private wave(v: number, t: number, U: number, vx: number) {
    const tail = smooth(.42, 1, v), drift = clamp(vx / U, -.35, .35);
    return tail * (.026 * Math.sin(t * 3 + this.ph - v * 5.5) + .01 * Math.sin(t * 5.1 + this.ph2 - v * 9)) - tail * tail * drift * .5;
  }

  draw(ctx: CanvasRenderingContext2D, w: World, art: Art, dpr: number) {
    if (this.state === 'gone') return;
    // drawn mirrored about its own x when heading right; the hem drift, lean and glance are mirrored with it
    const f = this.facing, dir = f < 0 ? -1 : 1;
    ctx.save();
    ctx.translate(this.x, 0);
    ctx.scale(dir < 0 ? Math.min(-.04, f) : Math.max(.04, f), 1);
    ctx.translate(-this.x, 0);
    if (this.state === 'dying') this.drawDeath(ctx, w, art, dpr, dir);
    else this.drawBody(ctx, w, art, dpr, dir);
    ctx.restore();
  }

  private drawBody(ctx: CanvasRenderingContext2D, w: World, art: Art, dpr: number, dir: number) {
    const r = art.rig, p = this.pose(w);
    if (p.alpha <= 0) return;
    const W0 = this.box(w).w * p.s, H0 = W0 * r.aspect, vx = this.vx * dir;

    // put the body together at about its on-screen resolution
    const k = Math.min(1, W0 * dpr * Math.max(p.sx, 1) / r.body.width);
    const sw = Math.ceil(r.body.width * k), sh = Math.ceil(r.body.height * k), m = Math.ceil(sw * .12);
    const c = scratchFor(sw + m * 2, sh), g = c.getContext('2d')!;
    // clear all of it: scaling samples a row past the region used, which may still hold a bigger ghost
    g.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < SLICES; i++) {
      const y0 = Math.round(i / SLICES * sh), y1 = Math.round((i + 1) / SLICES * sh);
      const off = m + this.wave((y0 + y1) / 2 / sh, w.t, w.U, vx) * sw;
      const sy0 = y0 / sh * r.body.height, sy1 = y1 / sh * r.body.height;
      g.drawImage(r.body, 0, sy0, r.body.width, sy1 - sy0, off, y0, sw, y1 - y0);
      if (p.flash > .02) {
        g.globalAlpha = p.flash;
        g.drawImage(r.flash, 0, sy0, r.body.width, sy1 - sy0, off, y0, sw, y1 - y0);
        g.globalAlpha = 1;
      }
    }
    // the face rides the upper body and glances toward you
    const tx = dir < 0 ? 2 * this.x - w.tx : w.tx, dx = tx - this.x, dy = w.ty - this.y, d = Math.hypot(dx, dy) || 1;
    g.drawImage(r.faces[p.face], m + this.wave(.32, w.t, w.U, vx) * sw + dx / d * sw * .028, dy / d * sw * .016, sw, sh);

    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(this.x, this.y + p.bob);
    ctx.rotate(this.lean * dir);
    ctx.scale(p.sx, p.sy);
    const mw = m / sw * W0;
    ctx.drawImage(c, 0, 0, sw + m * 2, sh, -W0 / 2 - mw, -H0 / 2, W0 + mw * 2, H0);
    ctx.restore();
  }

  /** a fan of wisps thrown mostly upward; each one's tail trails behind its flight */
  private makePuffs(imgs: HTMLImageElement[]): Puff[] {
    return imgs.map((img, i) => {
      const a = -Math.PI / 2 + (i - 1.5) * .8 + rnd(-.2, .2);
      return {
        img, a, dist: rnd(.55, .8), size: i === 0 ? .7 : rnd(.48, .58), rot: rnd(-.5, .5), vr: rnd(-1.2, 1.2),
        flip: Math.cos(a) > 0 ? -1 : 1, life: rnd(.48, DIE.puff),
      };
    });
  }

  /** freeze on the X eyes (a punch and a shake), squash down, then pop: the body springs up and dims out while the
      felt wisps burst from behind it, drift up, shrink and fade */
  private drawDeath(ctx: CanvasRenderingContext2D, w: World, art: Art, dpr: number, dir: number) {
    const since = w.t - this.deadT, W0 = this.box(w).w, H0 = W0 * art.rig.aspect;
    const cx = this.x, cy = this.y + Math.sin(this.deadT * 1.7 + this.ph) * w.U * .006 * this.scale;
    let sx = 1, sy = 1, jx = 0, rise = 0, alpha = 1, blur = 0, bright = 1;
    if (since < DIE.freeze) {
      const q = since / DIE.freeze;
      jx = Math.sin(since * 120) * W0 * .025 * (1 - q);
      sx = sy = 1 + .07 * Math.sin(Math.PI * q);
      bright = 1 + .3 * (1 - q);
    } else if (since < POP) {
      const e = smooth(0, 1, (since - DIE.freeze) / DIE.squash);
      sx = 1 + .2 * e; sy = 1 - .2 * e;
    } else {
      const q = Math.min(1, (since - POP) / DIE.fade), k = outCubic(Math.min(1, q / .3));
      sx = lerp(1.2, .86, k); sy = lerp(.8, 1.2, k);
      rise = H0 * .12 * outCubic(q);
      alpha = 1 - smooth(0, 1, q);
      blur = W0 * .03 * q;
    }
    // the wisps come out from behind the body, so the X eyes stay readable while it bursts
    const tp = since - POP;
    if (tp > 0) for (const p of this.puffs ??= this.makePuffs(art.rig.puffs)) {
      const q = tp / p.life;
      if (q >= 1) continue;
      const e = outCubic(q), d = W0 * (.28 + p.dist * e);
      const x = cx + Math.cos(p.a) * d, y = cy + Math.sin(p.a) * d - W0 * .35 * q * q;
      const s = W0 * p.size * lerp(.55, 1, outCubic(Math.min(1, q / .12))) * (1 - .7 * q), ar = p.img.height / p.img.width;
      ctx.save();
      ctx.globalAlpha = 1 - q * q;
      ctx.translate(x, y); ctx.rotate(p.rot + p.vr * q); ctx.scale(p.flip, 1);
      ctx.drawImage(p.img, -s / 2, -s * ar / 2, s, s * ar);
      ctx.restore();
    }
    if (alpha > .01) {
      // squash and stretch from the base, so it pushes off before it rises
      ctx.save();
      ctx.translate(cx + jx, cy + H0 * (1 - sy) / 2 - rise);
      ctx.rotate(this.lean * dir);
      ctx.scale(sx, sy);
      ctx.globalAlpha = alpha;
      const f = [blur > .3 ? `blur(${blur * dpr}px)` : '', bright !== 1 ? `brightness(${bright})` : ''].join(' ').trim();
      if (f) ctx.filter = f;
      ctx.drawImage(art.rig.ouch, -W0 / 2, -H0 / 2, W0, H0);
      ctx.restore();
    }
  }

  /** where symbol i of the row sits on screen, and its size */
  glyphAt(w: World, art: Art, i: number) {
    const p = this.pose(w), W0 = this.box(w).w * p.s, H0 = W0 * art.rig.aspect;
    const g = w.U * .058 * clamp(W0 / (GHOST.size * w.U), .9, 1.2) * (this.scale > 1 ? 1.1 : 1);
    const top = this.y + p.bob - H0 / 2 * p.sy + art.rig.pad * W0;
    const slot = this.slots[i], step = g * .62;
    // the row stays on screen, even for a long one on a ghost still coming in from the edge
    const half = Math.max(0, this.slots.length - 1) / 2 * step + g * .3;
    const cx = clamp(this.x, Math.min(half, w.W / 2), Math.max(w.W - half, w.W / 2));
    // the felt symbols fill less of their square than a printed glyph would, so the row sits tight and low
    const x = cx + ((slot?.x ?? i) - this.rowC) * step;
    // never up under the score and hearts, so a ghost that's still coming in can be read
    const y = Math.max(Math.max(w.U * .045, 72) + g * .5, top - g * .5) + g * .2;
    return { x, y, size: i === 0 ? g * 1.12 : g };
  }

  /** the symbol row; drawn on the top layer so nothing ever covers it */
  drawSymbols(p: Painter, w: World, art: Art) {
    if (!this.live || !this.slots.length) return;
    const age = w.t - this.born;
    let alpha = Math.min(1, age / .35);
    if (this.leaveT < Infinity) alpha *= 1 - clamp((w.t - this.leaveT) / LEAVE, 0, 1);
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const at = this.glyphAt(w, art, i), s = at.size * (age < .45 ? .6 + .4 * outBack(age / .45) : 1);
      p.image(art.glyphs[this.slots[i].id], at.x - s / 2, at.y - s / 2, s, s, alpha * (i === 0 ? 1 : .9));
    }
  }
}
