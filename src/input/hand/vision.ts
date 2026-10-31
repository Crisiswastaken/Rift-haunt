/* Sends camera frames to MediaPipe and hands back what it found, on two channels that run side by side: the body
   (the whole frame, small) and the hand (the whole frame at 640 wide, or a crop for a far player). Each runs in its own
   worker when it can, and on the page when it can't. Each has one frame in flight at a time: a slow frame is skipped
   rather than queued, so what comes back is never more than a frame behind. */
import type { Delegate, HandData, MaskData } from './vision-core';

export type { HandData, MaskData };

/** a rectangle of the camera picture, in its pixels */
export interface Rect { x: number; y: number; w: number; h: number }

export interface PoseFrame {
  /** seconds: when the frame was taken, and when its result arrived */
  t: number; at: number;
  /** the frame itself, to draw you from; whoever takes it closes it */
  bitmap: ImageBitmap;
  /** 33 body landmarks (x y z visibility), normalised to the frame; null when nobody's there */
  lm: Float32Array | null;
  mask: MaskData | null;
  /** a sharper picture of just the part of the frame that's on screen, taken at the same moment (x, y, w, h of it as
      fractions of the frame); whoever takes it closes it */
  view: { bitmap: ImageBitmap; part: [number, number, number, number] } | null;
}

/** a part of the camera picture (its pixels) to keep at a size (output pixels) */
export interface ViewReq { rect: Rect; w: number; h: number }

export interface HandFrame {
  t: number; at: number;
  /** where the crop was taken from, and the camera picture's size */
  rect: Rect; vw: number; vh: number;
  /** the hand, its landmarks moved back into the whole frame (normalised to it); null when none was found */
  hand: HandData | null;
}

const BASE = new URL(`${import.meta.env.BASE_URL}vision/`, location.href).href;
/** the body model's frame width, and the hand crop's size */
const POSE_W = 640, CROP = 256, WHOLE = Number(new URLSearchParams(location.search).get('whole')) || 640;

type Core = { process(image: ImageBitmap, tMs: number): unknown; close(): void };

class Channel {
  worker: Worker | null = null;
  core: Core | null = null;
  busy = false;
  delegate: Delegate | null = null;
  /** ms a frame takes the model; results a second; ms from taking the frame to having its result (all smoothed) */
  ms = 0; hz = 0; lag = 0;
  private lastAt = 0;

  constructor(readonly role: 'pose' | 'hand') {}

  async init(prefer: Delegate): Promise<string | null> {
    try {
      const w = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
      const ok = await new Promise<string | null>(resolve => {
        w.onmessage = e => { if (e.data.type === 'ready') this.delegate = e.data.delegate; resolve(e.data.type === 'ready' ? null : e.data.message ?? 'failed'); };
        w.onerror = e => resolve(e.message || 'worker failed');
        w.postMessage({ type: 'init', role: this.role, base: BASE, delegate: prefer });
      });
      if (ok === null) { this.worker = w; return null; }
      w.terminate();
      console.warn(`Hand tracking (${this.role}) worker failed, running on the page:`, ok);
    } catch (e) {
      console.warn(`No worker for hand tracking (${this.role}), running on the page:`, e);
    }
    try {
      const { PoseCore, HandCore } = await import('./vision-core');
      const core = this.role === 'pose' ? new PoseCore() : new HandCore();
      await core.init(BASE, false, prefer);
      this.core = core;
      this.delegate = core.delegate;
      return null;
    } catch (e) {
      return String((e as Error)?.message ?? e);
    }
  }

  /** a result came back: keep the numbers */
  measured(ms: number, t: number, at: number) {
    this.busy = false;
    this.ms += (ms - this.ms) * .1;
    this.lag += ((at - t) * 1000 - this.lag) * .1;
    if (this.lastAt) this.hz += (1 / Math.max(.005, at - this.lastAt) - this.hz) * .1;
    this.lastAt = at;
  }

  close() {
    this.worker?.terminate();
    this.core?.close();
    this.worker = null; this.core = null; this.busy = false; this.hz = 0; this.lastAt = 0;
  }
}

export class Vision {
  onPose: (r: PoseFrame) => void = () => {};
  onHand: (r: HandFrame) => void = () => {};
  readonly pose = new Channel('pose');
  readonly hand = new Channel('hand');
  /** where MediaPipe runs: in workers, or on the page when a worker couldn't start */
  get where(): 'worker' | 'page' | null {
    return !this.ready ? null : this.pose.worker && this.hand.worker ? 'worker' : 'page';
  }
  private ready = false;
  /** sharp views waiting for their frame's body result, by frame time */
  private views = new Map<number, PoseFrame['view']>();

  /** loads both models; resolves to an error message, or null when ready */
  async init(delegates: { pose: Delegate; hand: Delegate }): Promise<string | null> {
    if (this.ready) return null;
    const [a, b] = await Promise.all([this.pose.init(delegates.pose), this.hand.init(delegates.hand)]);
    if (a || b) { this.pose.close(); this.hand.close(); return a ?? b; }
    if (this.pose.worker) this.pose.worker.onmessage = e => this.posed(e.data);
    if (this.hand.worker) this.hand.worker.onmessage = e => this.handed(e.data);
    this.ready = true;
    return null;
  }

  /** offer the camera's current frame to the body model; ignored while it's still on the last one */
  async pushPose(video: HTMLVideoElement, t: number, view: ViewReq | null = null) {
    const c = this.pose;
    if (c.busy || !this.ready || !video.videoWidth) return;
    c.busy = true;
    const vw = video.videoWidth, vh = video.videoHeight, k = Math.min(1, POSE_W / vw);
    // each caught on its own, so one failing never leaks the other
    const [bitmap, sharp] = await Promise.all([
      createImageBitmap(video, { resizeWidth: Math.round(vw * k), resizeHeight: Math.round(vh * k), resizeQuality: 'medium' }).catch(() => null),
      view ? createImageBitmap(video, Math.round(view.rect.x), Math.round(view.rect.y), Math.round(view.rect.w), Math.round(view.rect.h),
        { resizeWidth: view.w, resizeHeight: view.h, resizeQuality: 'medium' }).catch(() => null) : null,
    ]);
    if (!bitmap) { sharp?.close(); c.busy = false; return; }
    const v = view?.rect;
    if (sharp && v) this.views.set(t * 1000, { bitmap: sharp, part: [v.x / vw, v.y / vh, v.w / vw, v.h / vh] });
    if (c.worker) c.worker.postMessage({ type: 'frame', bitmap, t: t * 1000 }, [bitmap]);
    else this.run(c, bitmap, t, r => this.posed({ type: 'result', t: t * 1000, bitmap, ...(r as object) }));
  }

  /** offer a crop of the camera's current frame (camera pixels) to the hand model */
  async pushHand(video: HTMLVideoElement, t: number, rect: Rect) {
    const c = this.hand;
    if (c.busy || !this.ready || !video.videoWidth) return;
    c.busy = true;
    const vw = video.videoWidth, vh = video.videoHeight;
    // a crop goes in square; the whole picture at WHOLE wide
    const whole = rect.w >= vw && rect.h >= vh;
    const ow = whole ? Math.min(vw, WHOLE) : CROP, oh = whole ? Math.round(vh * ow / vw) : CROP;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(video, Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h),
        { resizeWidth: ow, resizeHeight: oh, resizeQuality: 'medium' });
    } catch { c.busy = false; return; }
    const msg = { type: 'frame', bitmap, t: t * 1000, rect: { ...rect }, sent: { vw, vh } };
    if (c.worker) c.worker.postMessage(msg, [bitmap]);
    else this.run(c, bitmap, t, r => { bitmap.close(); this.handed({ ...msg, type: 'result', ...(r as object) }); });
  }

  /** on the page (no worker): run it now */
  private run(c: Channel, bitmap: ImageBitmap, t: number, done: (r: unknown) => void) {
    try { done(c.core!.process(bitmap, t * 1000)); } catch (e) { bitmap.close(); c.busy = false; console.warn(e); }
  }

  private posed(m: { type: string; t: number; bitmap?: ImageBitmap; lm?: Float32Array | null; mask?: MaskData | null; ms?: number; message?: string }) {
    const at = performance.now() / 1000, t = m.t / 1000;
    if (m.type !== 'result' || !m.bitmap) { this.pose.busy = false; m.bitmap?.close(); if (m.message) console.warn('body tracking:', m.message); return; }
    this.pose.measured(m.ms ?? 0, t, at);
    const view = this.views.get(m.t) ?? null;
    // anything older is from a frame that never came back
    for (const [k, v] of this.views) if (k <= m.t) { if (k < m.t) v?.bitmap.close(); this.views.delete(k); }
    this.onPose({ t, at, bitmap: m.bitmap, lm: m.lm ?? null, mask: m.mask ?? null, view });
  }

  private handed(m: { type: string; t: number; rect?: Rect; sent?: { vw: number; vh: number }; hand?: HandData | null; ms?: number; message?: string }) {
    const at = performance.now() / 1000, t = m.t / 1000;
    if (m.type !== 'result' || !m.rect || !m.sent) { this.hand.busy = false; if (m.message) console.warn('hand tracking:', m.message); return; }
    this.hand.measured(m.ms ?? 0, t, at);
    const { rect, sent: { vw, vh } } = m, h = m.hand ?? null;
    if (h) for (let i = 0; i < 21; i++) {
      h.lm[i * 3] = (rect.x + h.lm[i * 3] * rect.w) / vw;
      h.lm[i * 3 + 1] = (rect.y + h.lm[i * 3 + 1] * rect.h) / vh;
    }
    this.onHand({ t, at, rect, vw, vh, hand: h });
  }

  close() {
    for (const v of this.views.values()) v?.bitmap.close();
    this.views.clear();
    this.pose.close();
    this.hand.close();
    this.ready = false;
  }
}
