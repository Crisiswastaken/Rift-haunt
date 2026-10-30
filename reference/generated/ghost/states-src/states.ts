/* Felt ghost state machine preview. The game's own Ghost (src/game/ghost.ts) drives the felt rig over the layered
   v6b graveyard. FeltGhost below adds what's the felt ghost's own: it faces the way it travels, and its banish.
   Ghosts are drawn in between the scene's layers by depth (see "ghosts in the scene"). Live runs the loop (spawn, approach,
   hit, banish, or reach you and boo); Lineup holds one ghost in each state. Built into ../states.html by build.mjs. */
import manifest from '../../v6b_layers/manifest.json';
import { GHOST, SYMBOLS, type Pt, type SymbolId } from '../../../../src/config';
import { Ghost, type Art, type GhostEvent, type World } from '../../../../src/game/ghost';
import { FACES, loadImage, type Face, type Rig } from '../../../../src/render/sprites';

interface Layer {
  file: string; depth?: number; blur?: number; haze?: number; haze_rgb?: number[]; brightness?: number;
  opacity?: number; blend?: string; lanterns?: boolean;
  name?: string; x?: number; y?: number; glow_x?: number; glow_y?: number; glow_radius?: number;
}
interface Fly {
  lantern: string; ax: number; ay: number; amp_x: number; amp_y: number; speed: number; phase: number[];
  blink_period: number; blink_phase: number; size: number; peak: number; blur: number;
}
const M = manifest as unknown as { canvas: [number, number]; layers: Layer[]; lanterns: Layer[]; fireflies: { file: string; list: Fly[] } };

const BG = '../v6b_layers/', RIG = 'rig/', SYM = 'symbols/';
const SYMBOL_IDS = Object.keys(SYMBOLS) as SymbolId[];
/** padding around the body in the rig canvas (rig/rig.json) */
const RIG_PAD = 24;
const CAST: SymbolId[] = ['dash', 'pillar', 'fang', 'roof'];
/** how long ghost.ts holds the hit face */
const HIT_FACE = .38;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => { const q = clamp((v - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };
const outCubic = (q: number) => 1 - (1 - q) ** 3;
const lerp = (a: number, b: number, q: number) => a + (b - a) * q;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- the scene: v6b layers with blur and haze baked once, lantern glow and fireflies live ---------- */

interface Item extends Layer { sprite?: boolean; c?: HTMLCanvasElement; pad?: number }
const items: Item[] = [];
for (const L of M.layers) {
  if (L.lanterns) M.lanterns.forEach(l => items.push({ ...l, sprite: true }));
  else items.push({ ...L });
}

function bake(it: Item, img: HTMLImageElement) {
  const pad = Math.ceil((it.blur ?? 0) * 3), br = it.brightness ?? 1;
  const c = document.createElement('canvas');
  c.width = img.width + pad * 2; c.height = img.height + pad * 2;
  const g = c.getContext('2d')!;
  g.filter = `${it.blur ? `blur(${it.blur}px) ` : ''}brightness(${br})`;
  g.drawImage(img, pad, pad);
  g.filter = 'none';
  if (it.haze && it.haze_rgb) {
    const [r, gg, b] = it.haze_rgb;
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(${r * br | 0},${gg * br | 0},${b * br | 0},${it.haze})`;
    g.fillRect(0, 0, c.width, c.height);
  }
  it.c = c; it.pad = pad;
}

function flicker(t: number, seed: number) {
  return .82 + .1 * Math.sin(t * 7.1 + seed) + .05 * Math.sin(t * 13.7 + seed * 2.3) + .03 * Math.sin(t * 31.3 + seed * 5.1);
}

/** the v6b canvas cover-fitted to the screen, with a little overscan for the drift */
interface Fit { s: number; ox: number; oy: number }
function sceneFit(W: number, H: number): Fit {
  const [CW, CH] = M.canvas, s = Math.max(W / CW, H / CH) * 1.05;
  return { s, ox: (W - CW * s) / 2, oy: (H - CH * s) / 2 };
}

/** draws the scene back to front, calling `after(i)` once item i is down so ghosts can go in between */
function drawScene(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, t: number, glow: HTMLImageElement, fly: HTMLImageElement, after: (i: number) => void) {
  const { s, ox, oy } = sceneFit(W, H);
  items.forEach((it, i) => {
    const px = Math.sin(t * .15) * 8 * (it.depth ?? 0);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, (ox + px * s) * dpr, oy * dpr);
    ctx.globalAlpha = it.opacity ?? 1;
    ctx.globalCompositeOperation = it.blend === 'screen' ? 'screen' : 'source-over';
    ctx.drawImage(it.c!, (it.x ?? 0) - it.pad!, (it.y ?? 0) - it.pad!);
    if (it.sprite) {
      const f = flicker(t, it.x! * .013), r = it.glow_radius! * (.95 + .08 * f);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = .55 * f; ctx.drawImage(glow, it.glow_x! - r, it.glow_y! - r, r * 2, r * 2);
      ctx.globalAlpha = .35 * f; ctx.drawImage(glow, it.glow_x! - r * 2.2, it.glow_y! - r * 2.2, r * 4.4, r * 4.4);
      for (const q of M.fireflies.list) {
        if (q.lantern !== it.name) continue;
        const c = ((t / q.blink_period + q.blink_phase) % 1 + 1) % 1;
        if (c >= .4) continue;
        const p = q.phase, w = q.speed, soft = 1 + q.blur * .12, sz = q.size * soft;
        const x = q.ax + q.amp_x * (.65 * Math.sin(w * t + p[0]) + .35 * Math.sin(2.3 * w * t + p[1])) + 1.2 * Math.sin(5.1 * t + p[2]);
        const y = q.ay + q.amp_y * (.6 * Math.sin(.8 * w * t + p[3]) + .4 * Math.sin(1.9 * w * t + p[4])) + Math.sin(4.3 * t + p[5]);
        ctx.globalAlpha = q.peak * Math.sin(Math.PI * c / .4) ** 2 / soft;
        ctx.drawImage(fly, x - sz / 2, y - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    after(i);
  });
}

/* ---------- banish: freeze, squash, poof. Image assets only, nothing drawn with code ----------
   freeze on the X eyes (a punch and a shake), squash down, then pop: the body springs up and fades out while the
   four felt wisps (rig/puff-*.webp) burst out from behind it, drift up, shrink and fade. Positions are a function of time,
   so a held frame looks the same as the live one. Replaces ghost.ts's fade + burst for the felt ghost; fold it
   into ghost.ts when the felt rig goes into the game. */

const DIE = { freeze: .12, squash: .08, fade: .32, puff: .6 };
const POP = DIE.freeze + DIE.squash;
const DIE_T = POP + DIE.puff;

interface Puff { img: HTMLImageElement; a: number; dist: number; size: number; rot: number; vr: number; flip: number; life: number }

class FeltGhost extends Ghost {
  /** the body with the X-eyes face, composed once */
  static ouch: HTMLCanvasElement;
  static puffImgs: HTMLImageElement[];
  private puffs: Puff[] | null = null;
  /** 1 as drawn (tail trailing right, so heading left), -1 mirrored (heading right); eases through 0 to turn */
  facing = 1;
  private faceTo = 1;

  constructor(queue: SymbolId[], w: World, scale = 1, at?: Pt) {
    super(queue, w, scale, at);
    this.facing = this.faceTo = this.x < w.tx ? -1 : 1;
  }

  /** a fan of wisps thrown mostly upward; each tail trails behind its flight */
  private makePuffs(): Puff[] {
    return FeltGhost.puffImgs.map((img, i) => {
      const a = -Math.PI / 2 + (i - 1.5) * .8 + rnd(-.2, .2);
      return {
        img, a, dist: rnd(.55, .8), size: i === 0 ? .7 : rnd(.48, .58), rot: rnd(-.5, .5), vr: rnd(-1.2, 1.2),
        flip: Math.cos(a) > 0 ? -1 : 1, life: rnd(.48, DIE.puff),
      };
    });
  }

  update(w: World): GhostEvent {
    if (this.state === 'live') {
      // face the way it's heading; only turn once it's clearly crossed over, so the weave never flips it
      const dx = w.tx - this.x, m = this.box(w).w * .4;
      if (dx > m) this.faceTo = -1; else if (dx < -m) this.faceTo = 1;
    }
    this.facing += (this.faceTo - this.facing) * Math.min(1, w.dt * 9);
    if (this.state !== 'dying') return super.update(w);
    const k = Math.max(0, 1 - w.dt * 14);
    this.vx *= k; this.vy *= k;
    this.x += this.vx * w.dt; this.y += this.vy * w.dt;
    if (w.t - this.deadT > DIE_T) { this.state = 'gone'; return 'remove'; }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, w: World, art: Art, dpr: number) {
    // mirrored about its own x. The rig's hem drift, lean and glance are mirrored too, so they still read right
    const f = this.facing, flip = f < 0, vx = this.vx, lean = this.lean, tx = w.tx;
    if (flip) { this.vx = -vx; this.lean = -lean; w.tx = 2 * this.x - tx; }
    ctx.save();
    ctx.translate(this.x, 0); ctx.scale(flip ? Math.min(-.04, f) : Math.max(.04, f), 1); ctx.translate(-this.x, 0);
    if (this.state === 'dying') this.drawDeath(ctx, w, art, dpr);
    else super.draw(ctx, w, art, dpr);
    ctx.restore();
    if (flip) { this.vx = vx; this.lean = lean; w.tx = tx; }
  }

  /** The felt symbols fill less of their square than the printed glyphs ghost.ts spaces for, so the row is pulled
      in tighter and down closer to the head. */
  glyphAt(w: World, art: Art, i: number) {
    const at = super.glyphAt(w, art, i), g = i === 0 ? at.size / 1.12 : at.size;
    return { ...at, x: this.x + (at.x - this.x) * .72, y: at.y + g * .2 };
  }

  private drawDeath(ctx: CanvasRenderingContext2D, w: World, art: Art, dpr: number) {
    const since = w.t - this.deadT, W0 = this.box(w).w, H0 = W0 * art.rig.aspect;
    const bob = Math.sin(this.deadT * 1.7 + this.ph) * w.U * .006 * this.scale, cx = this.x, cy = this.y + bob;
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
      // springs up out of the squash and dims away as the wisps leave it
      const q = Math.min(1, (since - POP) / DIE.fade), k = outCubic(Math.min(1, q / .3));
      sx = lerp(1.2, .86, k); sy = lerp(.8, 1.2, k);
      rise = H0 * .12 * outCubic(q);
      alpha = 1 - smooth(0, 1, q);
      blur = W0 * .03 * q;
    }
    // the wisps come out from behind the body, so the X eyes stay readable while it bursts
    const tp = since - POP;
    if (tp > 0) for (const p of this.puffs ??= this.makePuffs()) {
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
      ctx.rotate(this.lean);
      ctx.scale(sx, sy);
      ctx.globalAlpha = alpha;
      const f = [blur > .3 ? `blur(${blur * dpr}px)` : '', bright !== 1 ? `brightness(${bright})` : ''].join(' ').trim();
      if (f) ctx.filter = f;
      ctx.drawImage(FeltGhost.ouch, -W0 / 2, -H0 / 2, W0, H0);
      ctx.restore();
    }
  }
}

/** A knocked-off symbol swells and fades where it was: Fx.strip without its sparks. */
class GlyphPops {
  list: { img: HTMLCanvasElement; x: number; y: number; size: number; age: number }[] = [];
  add(img: HTMLCanvasElement, x: number, y: number, size: number) { this.list.push({ img, x, y, size, age: 0 }); }
  update(dt: number) {
    for (const g of this.list) g.age += dt;
    this.list = this.list.filter(g => g.age < .3);
  }
  draw(ctx: CanvasRenderingContext2D) {
    for (const g of this.list) {
      const q = g.age / .3, s = g.size * (1 + .8 * outCubic(q));
      ctx.globalAlpha = (1 - q) ** 1.5;
      ctx.drawImage(g.img, g.x - s / 2, g.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
}

/* ---------- lineup: one ghost held in each state ---------- */

type Hold = 'spawn' | 'approach' | 'blink' | 'hit' | 'banish' | 'poof' | 'boo';
const HOLDS: [Hold, string, string][] = [
  ['spawn', 'SPAWN', 'pops in, symbols first'],
  ['approach', 'APPROACH', 'drifts at you, smug'],
  ['blink', 'BLINK', 'idle blink'],
  ['hit', 'HIT', 'loses a symbol: flinch'],
  ['banish', 'BANISH', 'last symbol: X eyes, freeze'],
  ['poof', 'POOF', 'bursts into felt wisps'],
  ['boo', 'BOO', 'reached you, then gone'],
];
const QUEUES: Record<Hold, SymbolId[]> = {
  spawn: ['dash', 'roof'], approach: ['fang', 'dash', 'pillar'], blink: ['roof', 'pillar'], hit: ['pillar'], banish: [], poof: [], boo: ['dash'],
};

/** pin a lineup ghost in its state (called every frame, before update) */
function hold(g: Ghost, h: Hold, t: number) {
  g.nextBlink = Infinity;
  g.born = h === 'spawn' ? t - .15 : t - 10;
  if (h === 'blink') g.blinkT = t;
  if (h === 'hit') { g.hitT = t - .14; g.sq = .06; }
  if (h === 'banish') { g.state = 'dying'; g.deadT = t - .05; }
  if (h === 'poof') { g.state = 'dying'; g.deadT = t - (POP + .14); }
  if (h === 'boo') { g.state = 'boo'; g.deadT = t - .14; }
}

/** what the live state machine is doing, for the labels */
function stateOf(g: Ghost, t: number) {
  if (g.state === 'dying') return t - g.deadT < DIE.freeze ? 'BANISH' : 'POOF';
  if (g.state === 'boo') return 'BOO';
  if (t - g.born < .6) return 'SPAWN';
  if (t - g.hitT < HIT_FACE) return 'HIT';
  return 'APPROACH';
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, sub?: string) {
  ctx.font = '700 12px system-ui, sans-serif';
  const tw = ctx.measureText(title).width;
  ctx.font = '12px system-ui, sans-serif';
  const sw = sub ? ctx.measureText(sub).width : 0, w = Math.max(tw, sw) + 18, h = sub ? 38 : 22;
  ctx.fillStyle = 'rgba(11, 10, 31, .62)';
  ctx.beginPath(); ctx.roundRect(x - w / 2, y, w, h, 8); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = '#e9e4ff'; ctx.fillText(title, x, y + 11);
  if (sub) { ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#a9a3d8'; ctx.fillText(sub, x, y + 27); }
}

/* ---------- boot ---------- */

function toCanvas(img: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c;
}

async function boot() {
  const cv = $<HTMLCanvasElement>('c'), ctx = cv.getContext('2d')!;
  const [glow, fly, bodyImg, ...rest] = await Promise.all([
    loadImage(BG + 'lanterns/glow.png'), loadImage(BG + M.fireflies.file), loadImage(RIG + 'body.webp'),
    ...FACES.map(f => loadImage(`${RIG}face-${f}.webp`)),
    ...[1, 2, 3, 4].map(i => loadImage(`${RIG}puff-${i}.webp`)),
    ...SYMBOL_IDS.map(id => loadImage(`${SYM}${id}.webp`)),
    ...items.map(it => loadImage(BG + it.file)),
  ]);
  const faceImgs = rest.slice(0, FACES.length), puffImgs = rest.slice(FACES.length, FACES.length + 4);
  const symImgs = rest.slice(FACES.length + 4, FACES.length + 4 + SYMBOL_IDS.length);
  rest.slice(FACES.length + 4 + SYMBOL_IDS.length).forEach((im, i) => bake(items[i], im));

  // the rig, built like makeRig() but without reading pixels back (the page runs from file://, where that's blocked)
  const bw = bodyImg.naturalWidth, bh = bodyImg.naturalHeight;
  const body = toCanvas(bodyImg, bw, bh), flash = toCanvas(bodyImg, bw, bh), fg = flash.getContext('2d')!;
  fg.globalCompositeOperation = 'source-in'; fg.fillStyle = '#ffffff'; fg.fillRect(0, 0, bw, bh);
  const rig: Rig = {
    body, flash, aspect: bh / bw, pad: RIG_PAD / bw, dust: [],
    faces: Object.fromEntries(FACES.map((f, i) => [f, toCanvas(faceImgs[i], bw, bh)])) as Record<Face, HTMLCanvasElement>,
  };
  FeltGhost.ouch = toCanvas(body, bw, bh);
  FeltGhost.ouch.getContext('2d')!.drawImage(rig.faces.ouch, 0, 0);
  FeltGhost.puffImgs = puffImgs;
  // the felt symbols (symbols/*.webp), in place of the flat printed glyphs
  const glyphs = Object.fromEntries(SYMBOL_IDS.map((id, i) => [id, toCanvas(symImgs[i], symImgs[i].naturalWidth, symImgs[i].naturalHeight)])) as Art['glyphs'];
  const art: Art = { rig, glyphs, lantern: glow };

  const w: World = { W: 0, H: 0, U: 0, tx: 0, ty: 0, t: 0, dt: 0, speed: 1.1, ghosts: [] };
  const pops = new GlyphPops(), spared = new WeakSet<Ghost>();
  const qs = new URLSearchParams(location.search);
  let mode: 'live' | 'lineup' = 'live', held: { g: Ghost; hold: Hold; x: number; y: number; since?: number }[] = [];
  let clock = 0, stopUntil = 0, hurtT = -9, nextSpawn = .3, nextCast = 2;

  /* ---------- ghosts in the scene ----------
     Each ghost goes between the layers by how far along its approach it is: it starts behind the near trees,
     lanterns, graves and ground fog, comes out under the fog halfway, and is in front of all but the corner grass
     when it's close. Crossing a layer it dissolves through rather than popping. Further back it takes on the
     scene's haze, blur and dimming like the layers do, and any lantern it passes lights the side facing it. */
  type Slot = 'far' | 'mid' | 'near' | 'top';
  const SLOTS: Slot[] = ['far', 'mid', 'near', 'top'];
  const after = (name: string) => items.findIndex(it => it.file.includes(name));
  /** each slot is drawn right after this scene item */
  const SLOT_AFTER: Record<Slot, number> = { far: after('05_trees_mid'), mid: after('07_graves_back'), near: after('09_graves_front'), top: items.length - 1 };
  const HAZE = [90, 86, 210];
  interface Shot {
    c: HTMLCanvasElement; x: number; y: number; cw: number; ch: number; wts: Record<Slot, number>;
    alpha: number; blur: number; bright: number; W0: number; gx: number; gy: number; glow: number;
  }
  const sprites = new WeakMap<Ghost, HTMLCanvasElement>(), mask = document.createElement('canvas');

  /** 0 where it spawned, 1 at you */
  const progress = (g: Ghost) => g.home ? 1 : clamp(1 - Math.hypot(g.x - w.tx, g.y - w.ty) / g.d0, 0, 1);

  function weights(g: Ghost, n: number): Record<Slot, number> {
    if (g.state === 'boo') return { far: 0, mid: 0, near: 0, top: 1 };
    const k1 = smooth(.27, .37, n), k2 = smooth(.58, .68, n);
    return { far: 1 - k1, mid: k1 * (1 - k2), near: k2, top: 0 };
  }

  /** render one ghost into its own canvas, lit and hazed for where it is */
  function shoot(g: Ghost, dpr: number, fit: Fit): Shot {
    const W0 = g.box(w).w, n = progress(g), z = 1 - n;
    // room for the lean and hem, the boo swell, or the poof's wisps: [half width, above, below] in body widths
    const [hw, up, down] = g.state === 'dying' ? [1.7, 2.4, 1.1] : g.state === 'boo' ? [1.4, 1.5, 1.3] : [1.1, 1.05, 1];
    const x = g.x - W0 * hw, y = g.y - W0 * up, cw = Math.ceil(W0 * hw * 2 * dpr), ch = Math.ceil(W0 * (up + down) * dpr);
    let c = sprites.get(g);
    if (!c) { c = document.createElement('canvas'); sprites.set(g, c); }
    if (c.width < cw || c.height < ch) { c.width = Math.max(c.width, cw); c.height = Math.max(c.height, ch); }
    const s = c.getContext('2d')!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, c.width, c.height);
    s.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
    g.draw(s, w, art, dpr);
    // lantern light multiplies, so the felt warms up but the black face stays black; multiply also paints the
    // empty space around the ghost, so its own alpha is put back afterwards
    const lit = M.lanterns.filter(L => Math.hypot(g.x - (fit.ox + L.glow_x! * fit.s), g.y - (fit.oy + L.glow_y! * fit.s)) < L.glow_radius! * fit.s * 3.2 + W0);
    if (lit.length) {
      if (mask.width < cw || mask.height < ch) { mask.width = Math.max(mask.width, cw); mask.height = Math.max(mask.height, ch); }
      const m = mask.getContext('2d')!;
      m.clearRect(0, 0, mask.width, mask.height);
      m.drawImage(c, 0, 0);
      s.globalCompositeOperation = 'multiply';
      for (const L of lit) {
        const lx = fit.ox + L.glow_x! * fit.s, ly = fit.oy + L.glow_y! * fit.s, R = L.glow_radius! * fit.s * 3.2;
        const k = .5 * flicker(clock, L.x! * .013), gr = s.createRadialGradient(lx, ly, 0, lx, ly, R);
        gr.addColorStop(0, `rgba(255, 168, 92, ${k})`); gr.addColorStop(1, 'rgba(255, 168, 92, 0)');
        s.fillStyle = gr; s.fillRect(x, y, cw / dpr, ch / dpr);
      }
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(mask, 0, 0);
      s.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
    }
    // the haze lifts the face too, as distance does
    s.globalCompositeOperation = 'source-atop';
    s.fillStyle = `rgba(${HAZE[0]}, ${HAZE[1]}, ${HAZE[2]}, ${.05 + .17 * z})`;
    s.fillRect(x, y, cw / dpr, ch / dpr);
    s.globalCompositeOperation = 'source-over';
    return {
      c, x, y, cw, ch, wts: weights(g, n), alpha: .96 - .12 * z, blur: 2.4 * z * w.U / 1920, bright: .97 - .13 * z,
      // the glow sits on the live body; the boo and the poof go without it rather than leave it hanging
      W0, gx: g.x, gy: g.y, glow: g.live ? Math.min(1, (w.t - g.born) / .6) : 0,
    };
  }

  // its own soft light in the mist: the silhouette blurred once here, not per ghost per frame
  const hp = Math.round(bw * .35), halo = document.createElement('canvas');
  halo.width = bw + hp * 2; halo.height = bh + hp * 2;
  const hg = halo.getContext('2d')!;
  hg.filter = `blur(${bw * .1}px)`; hg.drawImage(flash, hp, hp);

  function paint(sh: Shot, wt: number, dpr: number) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = sh.alpha * wt;
    ctx.filter = `${sh.blur > .25 ? `blur(${sh.blur * dpr}px) ` : ''}brightness(${sh.bright})`;
    ctx.drawImage(sh.c, 0, 0, sh.cw, sh.ch, sh.x * dpr, sh.y * dpr, sh.cw, sh.ch);
    ctx.filter = 'none';
    if (sh.glow > 0) {
      const k = sh.W0 / bw, hw = halo.width * k, hh = halo.height * k;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = .16 * sh.alpha * wt * sh.glow;
      ctx.drawImage(halo, (sh.gx - hw / 2) * dpr, (sh.gy - hh / 2) * dpr, hw * dpr, hh * dpr);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  function resize() {
    w.W = innerWidth; w.H = innerHeight; w.U = Math.min(w.W, w.H * 16 / 9);
    // where the waist-up player's head and chest would be
    w.tx = w.W * .5; w.ty = w.H * .46;
  }

  // ?mode=lineup&strip=death lays the banish out frame by frame instead
  const strip = qs.get('strip') === 'death' ? [.03, .1, .16, .22, .3, .4, .5, .62, .74] : null;

  function lineup() {
    w.ghosts = []; pops.list = [];
    if (strip) {
      held = strip.map((since, i) => {
        const x = w.W * (i + .5) / strip.length, y = w.H * .55;
        const g = new FeltGhost([], w, 1, { x, y });
        g.home = { x, y };
        w.ghosts.push(g);
        return { g, hold: 'banish' as Hold, x, y, since };
      });
      return;
    }
    held = HOLDS.map(([h], i) => {
      const x = w.W * (i + .5) / HOLDS.length, y = w.H * .5;
      const g = new FeltGhost(QUEUES[h], w, 1, { x, y });
      g.home = { x, y };
      w.ghosts.push(g);
      return { g, hold: h, x, y };
    });
  }

  function setMode(m: 'live' | 'lineup') {
    mode = m;
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('live-ui').hidden = m !== 'live';
    if (m === 'lineup') lineup();
    else { w.ghosts = []; pops.list = []; nextSpawn = w.t + .3; nextCast = w.t + 2; }
  }

  /** like the doodle: pop in just inside the left, right or top edge, never near you */
  function spawn() {
    const n = Math.random() < .4 ? 1 : Math.random() < .6 ? 2 : 3, m = w.U * .07, r = Math.random();
    // low enough that the symbol row fits above the head instead of being pinned over the face
    const at = r < .2 ? { x: rnd(.2, .8) * w.W, y: w.H * .28 } : { x: r < .6 ? m : w.W - m, y: rnd(.28, .75) * w.H };
    const g = new FeltGhost(Array.from({ length: n }, () => pick(CAST)), w, 1, at);
    if (Math.random() < .25) spared.add(g);
    w.ghosts.push(g);
  }

  /** the game's cast: strip `id` off every ghost showing it in front */
  function cast(id: SymbolId) {
    if (mode !== 'live') return;
    let killed = 0;
    for (const g of w.ghosts.filter(g => g.live && g.front === id)) {
      const s = g.strip(w, art);
      if (s) pops.add(art.glyphs[s.id], s.x, s.y, s.size);
      if (g.slots.length) g.flinch(w);
      else { g.banish(w); killed++; }
    }
    if (killed) stopUntil = clock + (killed > 1 ? .09 : .055);
  }

  // controls
  $('casts').innerHTML = CAST.map((id, i) => `<button data-cast="${id}" title="${SYMBOLS[id].name} (${i + 1})"><img src="${SYM}${id}.webp" alt=""><span>${i + 1}</span></button>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-cast]').forEach(b => { b.onclick = () => cast(b.dataset.cast as SymbolId); });
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode as 'live' | 'lineup'); });
  $('spawn').onclick = () => mode === 'live' && spawn();
  let paused = false;
  addEventListener('keydown', e => {
    const i = '1234'.indexOf(e.key);
    if (i >= 0) cast(CAST[i]);
    if (e.key === 's' || e.key === 'S') $('spawn').click();
    if (e.key === ' ') { paused = !paused; e.preventDefault(); }
  });
  const auto = $<HTMLInputElement>('auto'), slow = $<HTMLInputElement>('slow'), labels = $<HTMLInputElement>('labels');
  addEventListener('resize', () => { resize(); if (mode === 'lineup') lineup(); });
  resize();
  if (qs.has('noui')) $('ui').hidden = true;
  setMode(qs.get('mode') === 'lineup' ? 'lineup' : 'live');

  function step(dt: number) {
    clock += dt;
    // a beat of hit-stop on every banish, like the game
    w.dt = clock < stopUntil ? 0 : dt;
    w.t += w.dt;
    const t = w.t;

    if (mode === 'live') {
      const alive = w.ghosts.filter(g => g.live);
      if (t > nextSpawn && alive.length < 5) { spawn(); nextSpawn = t + rnd(1.5, 2.6); }
      if (auto.checked && t > nextCast) {
        nextCast = t + rnd(.9, 1.5);
        const d = (g: Ghost) => Math.hypot(g.x - w.tx, g.y - w.ty);
        // only ghosts you can see, and it lets the spared ones through so you see the boo
        const ready = alive.filter(g => t - g.born > 1.3 && g.front && !spared.has(g) && g.x > 0 && g.x < w.W && g.y > 0 && g.y < w.H)
          .sort((a, b) => d(a) - d(b));
        if (ready.length) cast(ready[0].front!);
      }
    } else for (const h of held) {
      if (h.since === undefined) hold(h.g, h.hold, t);
      else { h.g.state = 'dying'; h.g.deadT = t - h.since; }
    }

    for (let i = w.ghosts.length - 1; i >= 0; i--) {
      const ev = w.ghosts[i].update(w);
      if (ev === 'reached') hurtT = clock;
      else if (ev === 'remove') w.ghosts.splice(i, 1);
    }
    pops.update(w.dt);
  }

  function render() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = w.W, H = w.H, t = w.t;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0a1f'; ctx.fillRect(0, 0, cv.width, cv.height);
    const order = [...w.ghosts].sort((a, b) => a.box(w).w - b.box(w).w);
    const fit = sceneFit(W, H), shots = order.map(g => shoot(g, dpr, fit));
    drawScene(ctx, W, H, dpr, clock, glow, fly, i => {
      for (const slot of SLOTS) if (SLOT_AFTER[slot] === i) for (const sh of shots) if (sh.wts[slot] > .01) paint(sh, sh.wts[slot], dpr);
    });

    // symbols stay on top of everything, so a ghost behind a tree can still be read
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const g of order) g.drawSymbols(ctx, w, art);
    pops.draw(ctx);

    if (mode === 'lineup') {
      if (strip) for (const h of held) pill(ctx, h.x, h.y + GHOST.size * w.U * .9, `${Math.round(h.since! * 1000)} ms`);
      else for (const [i, [, title, sub]] of HOLDS.entries()) pill(ctx, held[i].x, held[i].y + GHOST.size * w.U * .7, title, sub);
    } else if (labels.checked) {
      for (const g of w.ghosts) if (g.state !== 'gone') pill(ctx, g.x, g.y + g.box(w).w * rig.aspect * .55, stateOf(g, t));
    }

    // reaching you: a soft pink flash at the edges
    const k = Math.max(0, 1 - (clock - hurtT) / .6);
    if (k > 0) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75);
      gr.addColorStop(0, 'rgba(255, 90, 120, 0)'); gr.addColorStop(1, `rgba(255, 90, 120, ${.35 * k})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    if (paused) pill(ctx, W / 2, 14, 'PAUSED · space to resume');
  }

  // ?find=spawn|hit|banish|poof|boo|far|mid runs the live loop until that moment and pauses on it
  const FIND: Record<string, () => boolean> = {
    spawn: () => w.ghosts.some(g => g.live && w.t - g.born > .2),
    hit: () => w.ghosts.some(g => g.live && w.t - g.hitT > .06 && w.t - g.hitT < .2),
    banish: () => w.ghosts.some(g => g.state === 'dying' && w.t - g.deadT > .05),
    poof: () => w.ghosts.some(g => g.state === 'dying' && w.t - g.deadT > POP + +(qs.get('at') ?? .14)),
    boo: () => w.ghosts.some(g => g.state === 'boo' && w.t - g.deadT > .12),
    far: () => w.ghosts.filter(g => g.live && w.t - g.born > .8 && progress(g) < .25).length >= 2,
    mid: () => w.ghosts.some(g => g.live && progress(g) > .4 && progress(g) < .55),
  };
  const find = FIND[qs.get('find') ?? ''];
  if (find && mode === 'live') {
    for (let i = 0; i < 60 * 120 && !find(); i++) step(1 / 60);
    paused = true;
  }

  let last = performance.now();
  function frame(now: number) {
    let dt = Math.min(.05, (now - last) / 1000);
    last = now;
    if (slow.checked) dt *= .3;
    if (!paused) step(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

boot().catch(e => {
  document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;bottom:8px;left:12px">${String(e.message ?? e)}</p>`);
});
