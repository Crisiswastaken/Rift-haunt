/* Ghosts in the scene.
   Each ghost goes in between the graveyard's layers by how far along its approach it is: it starts behind the near
   trees, lanterns, graves and ground fog, comes out under the fog about halfway, and is in front of everything but
   the corner grass when it's close. Crossing a layer it dissolves through rather than popping. Further back it takes
   on the scene's haze, blur and dimming like the layers do, a lantern it passes warms the side of it facing the light
   (multiplied, so the black face stays black), and it carries a faint halo of its own in the mist.
   Each ghost is drawn into a sprite of its own with canvas 2D, then goes into the scene as a WebGL texture. */
import type { Art } from '../assets';
import type { Ghost, World } from '../game/ghost';
import type { Light, Scene } from '../scene/scene';
import type { Gl, Tex } from './gl';

type Slot = 'far' | 'mid' | 'near' | 'top';
const SLOTS: Slot[] = ['far', 'mid', 'near', 'top'];
const HAZE = [90, 86, 210];

interface Shot {
  tex: Tex; x: number; y: number; cw: number; ch: number;
  /** device pixels on screen per sprite pixel */
  k: number;
  wts: Record<Slot, number>;
  alpha: number; W0: number; gx: number; gy: number; glow: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => { const q = clamp((v - a) / (b - a), 0, 1); return q * q * (3 - 2 * q); };

export class Compositor {
  /** each slot is drawn right after this scene layer */
  private after: Record<Slot, number>;
  /** each ghost's sprite canvas and its texture, freed when the ghost is gone */
  private sprites = new Map<Ghost, { c: HTMLCanvasElement; tex: Tex | null }>();
  private mask = document.createElement('canvas');
  private halo: Tex;
  private shots: Shot[] = [];

  constructor(private gl: Gl, scene: Scene, private art: Art) {
    this.after = {
      far: scene.indexOf('05_trees_mid'), mid: scene.indexOf('07_graves_back'),
      near: scene.indexOf('09_graves_front'), top: scene.items.length - 1,
    };
    this.halo = gl.texture(art.rig.halo);
  }

  /** render every ghost into its own sprite for this frame; call before the scene draws */
  prepare(ghosts: Ghost[], w: World, dpr: number, lights: Light[]) {
    const live = ghosts.filter(g => g.state !== 'gone');
    for (const [g, sp] of this.sprites) {
      if (live.includes(g)) continue;
      if (sp.tex) this.gl.free(sp.tex);
      this.sprites.delete(g);
    }
    this.shots = live.map(g => this.shoot(g, w, dpr, lights));
  }

  /** the scene's after-layer hook: paint the ghosts that belong behind the next layer */
  paintAfter(i: number, dpr: number) {
    for (const slot of SLOTS) {
      if (this.after[slot] !== i) continue;
      for (const sh of this.shots) if (sh.wts[slot] > .01) this.paint(sh, sh.wts[slot], dpr);
    }
  }

  private weights(g: Ghost, n: number): Record<Slot, number> {
    if (g.state === 'boo') return { far: 0, mid: 0, near: 0, top: 1 };
    const k1 = smooth(.27, .37, n), k2 = smooth(.58, .68, n);
    return { far: 1 - k1, mid: k1 * (1 - k2), near: k2, top: 0 };
  }

  private shoot(g: Ghost, w: World, dpr: number, lights: Light[]): Shot {
    const W0 = g.box(w).w, n = g.progress(w), z = 1 - n;
    // Further back, the sprite is drawn at a lower resolution and stretched: that's its depth of field, and far
    // cheaper than blurring it.
    const sd = dpr * (1 - .5 * z);
    // room for the lean and hem, the boo's swell, or the poof's wisps: [half width, above, below] in body widths
    const [hw, up, down] = g.state === 'dying' ? [1.7, 2.4, 1.1] : g.state === 'boo' ? [1.4, 1.5, 1.3] : [1.1, 1.05, 1];
    const x = g.x - W0 * hw, y = g.y - W0 * up, cw = Math.ceil(W0 * hw * 2 * sd), ch = Math.ceil(W0 * (up + down) * sd);
    let sp = this.sprites.get(g);
    if (!sp) { sp = { c: document.createElement('canvas'), tex: null }; this.sprites.set(g, sp); }
    const c = sp.c;
    if (c.width < cw || c.height < ch) { c.width = Math.max(c.width, cw); c.height = Math.max(c.height, ch); }
    const s = c.getContext('2d')!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, c.width, c.height);
    s.setTransform(sd, 0, 0, sd, -x * sd, -y * sd);
    g.draw(s, w, this.art, sd);

    // lantern light multiplies, so the felt warms but the face stays black; multiply also paints the empty space
    // around the ghost, so its own alpha is put back afterwards
    const lit = lights.filter(L => Math.hypot(g.x - L.x, g.y - L.y) < L.r + W0);
    if (lit.length) {
      const m = this.mask;
      if (m.width < cw || m.height < ch) { m.width = Math.max(m.width, cw); m.height = Math.max(m.height, ch); }
      const mg = m.getContext('2d')!;
      mg.clearRect(0, 0, cw, ch);
      mg.drawImage(c, 0, 0, cw, ch, 0, 0, cw, ch);
      s.globalCompositeOperation = 'multiply';
      for (const L of lit) {
        const gr = s.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.r);
        gr.addColorStop(0, `rgba(255, 168, 92, ${L.k})`);
        gr.addColorStop(1, 'rgba(255, 168, 92, 0)');
        s.fillStyle = gr;
        s.fillRect(x, y, cw / sd, ch / sd);
      }
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(m, 0, 0, cw, ch, 0, 0, cw, ch);
      s.setTransform(sd, 0, 0, sd, -x * sd, -y * sd);
    }
    // haze lifts the face too, as distance does; then it dims with distance (brightness, as black over it)
    s.globalCompositeOperation = 'source-atop';
    s.fillStyle = `rgba(${HAZE[0]}, ${HAZE[1]}, ${HAZE[2]}, ${.05 + .17 * z})`;
    s.fillRect(x, y, cw / sd, ch / sd);
    s.fillStyle = `rgba(0, 0, 0, ${.03 + .13 * z})`;
    s.fillRect(x, y, cw / sd, ch / sd);
    s.globalCompositeOperation = 'source-over';

    sp.tex = this.gl.update(sp.tex, c);
    return {
      tex: sp.tex, x, y, cw, ch, k: dpr / sd, wts: this.weights(g, n), alpha: .96 - .12 * z,
      // the halo sits on the live body; the boo and the poof go without it rather than leave it hanging
      W0, gx: g.x, gy: g.y, glow: g.live ? Math.min(1, (w.t - g.born) / .6) : 0,
    };
  }

  private paint(sh: Shot, wt: number, dpr: number) {
    this.gl.draw(sh.tex, sh.x * dpr, sh.y * dpr, sh.cw * sh.k, sh.ch * sh.k, sh.alpha * wt, 'normal', [0, 0, sh.cw, sh.ch]);
    if (sh.glow > 0) {
      // halo.webp is the silhouette padded by .35 of the body width each side, at half the body's resolution
      const k = sh.W0 / (this.art.rig.body.width / 2), hw = this.halo.w * k, hh = this.halo.h * k;
      this.gl.draw(this.halo, (sh.gx - hw / 2) * dpr, (sh.gy - hh / 2) * dpr, hw * dpr, hh * dpr, .16 * sh.alpha * wt * sh.glow, 'screen');
    }
  }

}
