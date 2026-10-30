/* Loads the art built by tools/build_assets.py (public/assets) and puts the ghost rig together. */
import type { SymbolId } from './config';
import { SYMBOLS } from './config';
import { SCENE } from './scene/scene';

export type Face = 'idle' | 'blink' | 'hit' | 'ouch' | 'boo';
export const FACES: Face[] = ['idle', 'blink', 'hit', 'ouch', 'boo'];

/** The felt ghost: a faceless body plus face layers on the same canvas, so changing expression never moves the body. */
export interface Rig {
  body: HTMLCanvasElement;
  /** the body's silhouette in white, for hit flashes */
  flash: HTMLCanvasElement;
  faces: Record<Face, HTMLCanvasElement>;
  /** the body with its X-eyes face on, for the banish */
  ouch: HTMLCanvasElement;
  /** soft white glow of the silhouette, .35 of the body width bigger each side */
  halo: HTMLImageElement;
  /** the four felt wisps it bursts into */
  puffs: HTMLImageElement[];
  /** height / width */
  aspect: number;
  /** the canvas padding around the body on each side, as a fraction of the width */
  pad: number;
}

export interface Art {
  rig: Rig;
  /** the felt symbols, 256px square with the symbol filling about 45% */
  glyphs: Record<SymbolId, HTMLImageElement>;
  /** the full-strength felt heart the HUD uses */
  heart: HTMLImageElement;
  /** the scene's layers in manifest order, then the lantern glow and the firefly */
  layers: HTMLImageElement[];
  glow: HTMLImageElement;
  firefly: HTMLImageElement;
}

/** padding around the body in the rig canvas (public/assets/ghost/rig.json) */
const RIG_PAD = 24;
const BASE = `${import.meta.env.BASE_URL}assets/`;

/** loaded and decoded, so the first frames don't stall decoding a dozen big layers */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const im = new Image();
  im.src = url;
  try { await im.decode(); } catch { throw new Error(`Could not load ${url}`); }
  return im;
}

function toCanvas(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return c;
}

export async function loadArt(progress: (q: number) => void): Promise<Art> {
  const ids = Object.keys(SYMBOLS) as SymbolId[];
  const urls = [
    'ghost/body.webp', 'ghost/halo.webp',
    ...FACES.map(f => `ghost/face-${f}.webp`),
    ...[1, 2, 3, 4].map(i => `ghost/puff-${i}.webp`),
    ...ids.map(id => `symbols/${id}.webp`),
    'hud/heart.webp', 'scene/glow.webp', 'scene/firefly.webp',
    ...SCENE.items.map(it => it.file),
  ];
  let done = 0;
  const imgs = await Promise.all(urls.map(u => loadImage(BASE + u).then(im => { progress(++done / urls.length); return im; })));
  const take = (n: number) => imgs.splice(0, n);

  const [bodyImg, halo] = take(2);
  const faceImgs = take(FACES.length), puffs = take(4), symImgs = take(ids.length);
  const [heart, glow, firefly] = take(3);
  const layers = imgs;

  const w = bodyImg.naturalWidth, h = bodyImg.naturalHeight;
  const body = toCanvas(bodyImg, w, h);
  const flash = toCanvas(bodyImg, w, h), fg = flash.getContext('2d')!;
  fg.globalCompositeOperation = 'source-in';
  fg.fillStyle = '#ffffff';
  fg.fillRect(0, 0, w, h);
  const faces = Object.fromEntries(FACES.map((f, i) => [f, toCanvas(faceImgs[i], w, h)])) as Record<Face, HTMLCanvasElement>;
  const ouch = toCanvas(body, w, h);
  ouch.getContext('2d')!.drawImage(faces.ouch, 0, 0);

  return {
    rig: { body, flash, faces, ouch, halo, puffs, aspect: h / w, pad: RIG_PAD / w },
    glyphs: Object.fromEntries(ids.map((id, i) => [id, symImgs[i]])) as Record<SymbolId, HTMLImageElement>,
    heart, layers, glow, firefly,
  };
}
