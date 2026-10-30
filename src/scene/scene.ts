/* The misty graveyard (v6b), drawn back to front from its layers. Depth of field, haze and brightness are baked
   into the images by tools/build_assets.py; what's live is a slow parallax drift, the lanterns' flickering glow and
   a handful of fireflies. `draw` calls back after each layer so ghosts can be slipped in between them. Drawn with
   WebGL (render/gl.ts). */
import manifest from './manifest.json';
import type { Gl, Tex } from '../render/gl';

export interface SceneItem {
  name: string; file: string;
  /** top-left and size on the 2048x1152 canvas */
  x: number; y: number; w: number; h: number;
  /** parallax: 0 is the fixed sky, 1 moves most */
  depth: number;
  opacity: number;
  blend: string;
  /** for a lantern: its flame centre and glow radius on the canvas */
  lantern?: { x: number; y: number; r: number };
}

interface Firefly {
  lantern: string; ax: number; ay: number; amp_x: number; amp_y: number; speed: number; phase: number[];
  blink_period: number; blink_phase: number; size: number; peak: number; blur: number;
}

export const SCENE = manifest as unknown as { canvas: [number, number]; items: SceneItem[]; fireflies: Firefly[] };

/** the canvas cover-fitted to the screen, with a little overscan so the drift never shows an edge */
export interface Fit { s: number; ox: number; oy: number }

/** a lantern's light on screen, for lighting the ghosts that pass it */
export interface Light { x: number; y: number; r: number; k: number }

export function flicker(t: number, seed: number) {
  return .82 + .1 * Math.sin(t * 7.1 + seed) + .05 * Math.sin(t * 13.7 + seed * 2.3) + .03 * Math.sin(t * 31.3 + seed * 5.1);
}

export class Scene {
  readonly items = SCENE.items;
  private tex: Tex[];
  private glow: Tex;
  private fly: Tex;

  constructor(private gl: Gl, layers: HTMLImageElement[], glow: HTMLImageElement, fly: HTMLImageElement) {
    this.tex = layers.map(im => gl.texture(im));
    this.glow = gl.texture(glow);
    this.fly = gl.texture(fly);
  }

  fit(W: number, H: number): Fit {
    const [CW, CH] = SCENE.canvas, s = Math.max(W / CW, H / CH) * 1.05;
    return { s, ox: (W - CW * s) / 2, oy: (H - CH * s) / 2 };
  }

  /** index of the first layer whose name contains `name` */
  indexOf(name: string) {
    const i = this.items.findIndex(it => it.name.includes(name));
    if (i < 0) throw new Error(`no scene layer ${name}`);
    return i;
  }

  lights(fit: Fit, t: number): Light[] {
    return this.items.filter(it => it.lantern).map(it => ({
      x: fit.ox + it.lantern!.x * fit.s, y: fit.oy + it.lantern!.y * fit.s,
      r: it.lantern!.r * fit.s * 3.2, k: .5 * flicker(t, it.x * .013),
    }));
  }

  draw(fit: Fit, dpr: number, t: number, after: (i: number) => void) {
    const { s, ox, oy } = fit, k = s * dpr;
    this.items.forEach((it, i) => {
      // a slow sideways drift, more for nearer layers
      const px = Math.sin(t * .15) * 8 * it.depth, X = (ox + px * s) * dpr, Y = oy * dpr;
      this.gl.draw(this.tex[i], X + it.x * k, Y + it.y * k, it.w * k, it.h * k, it.opacity, it.blend === 'screen' ? 'screen' : 'normal');
      if (it.lantern) this.drawLight(it, t, X, Y, k);
      after(i);
    });
  }

  /** the flame's glow, a wide faint spill, and the fireflies that hang around this lantern */
  private drawLight(it: SceneItem, t: number, X: number, Y: number, k: number) {
    const L = it.lantern!, f = flicker(t, it.x * .013), r = L.r * (.95 + .08 * f), gl = this.gl;
    gl.draw(this.glow, X + (L.x - r) * k, Y + (L.y - r) * k, r * 2 * k, r * 2 * k, .55 * f, 'lighter');
    gl.draw(this.glow, X + (L.x - r * 2.2) * k, Y + (L.y - r * 2.2) * k, r * 4.4 * k, r * 4.4 * k, .35 * f, 'lighter');
    for (const q of SCENE.fireflies) {
      if (q.lantern !== it.name) continue;
      // a lazy wander, lit only for the first 40% of each slow blink
      const c = ((t / q.blink_period + q.blink_phase) % 1 + 1) % 1;
      if (c >= .4) continue;
      const p = q.phase, w = q.speed, soft = 1 + q.blur * .12, sz = q.size * soft;
      const x = q.ax + q.amp_x * (.65 * Math.sin(w * t + p[0]) + .35 * Math.sin(2.3 * w * t + p[1])) + 1.2 * Math.sin(5.1 * t + p[2]);
      const y = q.ay + q.amp_y * (.6 * Math.sin(.8 * w * t + p[3]) + .4 * Math.sin(1.9 * w * t + p[4])) + Math.sin(4.3 * t + p[5]);
      gl.draw(this.fly, X + (x - sz / 2) * k, Y + (y - sz / 2) * k, sz * k, sz * k, q.peak * Math.sin(Math.PI * c / .4) ** 2 / soft, 'lighter');
    }
  }
}
