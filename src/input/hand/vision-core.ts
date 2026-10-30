/* MediaPipe on camera frames, in two parts that run side by side (one worker each), after RIFT-Desktop:
   - PoseCore: the body model on the whole frame. Where you are, your shoulders and arms (which hand is up, the box
     your hand moves in, where to look for the hand), and the person mask that cuts you out into the graveyard.
   - HandCore: the hand model on a close crop around your hand, cut from the full-size frame, so a hand two metres
     away is still big enough to read the pointing finger. The pen only ever waits on this one.
   Shared by the workers and the main-thread fallback. */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';

export type Delegate = 'GPU' | 'CPU';
export interface MaskData { data: Uint8Array; w: number; h: number }
/** 33 body landmarks, x y z visibility each, normalised to the frame (not mirrored) */
export interface PoseResult { lm: Float32Array | null; mask: MaskData | null; ms: number }
/** 21 hand landmarks, x y z, normalised to the image it was given; and the same in metres around the hand */
export interface HandData { lm: Float32Array; world: Float32Array; score: number }
export interface HandResult { hand: HandData | null; ms: number }

/** the frame each model is warmed up with, so the shaders are compiled behind the loading screen */
function blank(w: number, h: number) {
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d')!;
  g.fillStyle = '#556';
  g.fillRect(0, 0, w, h);
  return c.transferToImageBitmap();
}

/** MediaPipe wants strictly increasing timestamps */
class Clock {
  private last = 0;
  next(tMs: number) { return this.last = Math.max(Math.round(tMs), this.last + 1); }
}

async function create<T>(make: (d: Delegate) => Promise<T>, prefer: Delegate): Promise<{ task: T; delegate: Delegate }> {
  const order: Delegate[] = prefer === 'GPU' ? ['GPU', 'CPU'] : ['CPU'];
  for (const d of order) {
    try { return { task: await make(d), delegate: d }; } catch (e) { if (d === order[order.length - 1]) throw e; }
  }
  throw new Error('unreachable');
}

export class PoseCore {
  private pose!: PoseLandmarker;
  private clock = new Clock();
  private prev: Uint8Array | null = null;
  delegate: Delegate = 'GPU';

  /** base: the URL of public/vision/ (models, and wasm/ under it); module: the ES-module wasm loader (in a worker) */
  async init(base: string, module: boolean, prefer: Delegate) {
    const files = await FilesetResolver.forVisionTasks(base + 'wasm', module);
    const r = await create(delegate => PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: base + 'pose_landmarker_lite.task', delegate },
      runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: true,
      minPoseDetectionConfidence: .5, minPosePresenceConfidence: .5, minTrackingConfidence: .5,
    }), prefer);
    this.pose = r.task;
    this.delegate = r.delegate;
    const b = blank(640, 360);
    for (let i = 0; i < 3; i++) this.process(b, i + 1);
    b.close();
    this.prev = null;
  }

  process(image: ImageBitmap | HTMLVideoElement, tMs: number): PoseResult {
    const t0 = performance.now();
    let lm: Float32Array | null = null, mask: MaskData | null = null;
    this.pose.detectForVideo(image, this.clock.next(tMs), res => {
      const p = res.landmarks[0];
      if (p) {
        lm = new Float32Array(33 * 4);
        p.forEach((q, k) => { lm![k * 4] = q.x; lm![k * 4 + 1] = q.y; lm![k * 4 + 2] = q.z; lm![k * 4 + 3] = q.visibility ?? 0; });
      }
      const m = res.segmentationMasks?.[0];
      if (m) {
        // the mask flickers frame to frame at the edges; half of the last one steadies it without trailing
        const f = m.getAsFloat32Array(), data = new Uint8Array(f.length), prev = this.prev?.length === f.length ? this.prev : null;
        if (prev) for (let i = 0; i < f.length; i++) data[i] = (f[i] * 255 + prev[i]) * .5;
        else for (let i = 0; i < f.length; i++) data[i] = f[i] * 255;
        this.prev = data.slice();
        mask = { data, w: m.width, h: m.height };
      }
    });
    if (!lm) this.prev = null;
    return { lm, mask, ms: performance.now() - t0 };
  }

  close() { this.pose?.close(); }
}

export class HandCore {
  private hands!: HandLandmarker;
  private clock = new Clock();
  delegate: Delegate = 'GPU';

  async init(base: string, module: boolean, prefer: Delegate) {
    const files = await FilesetResolver.forVisionTasks(base + 'wasm', module);
    const r = await create(delegate => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: base + 'hand_landmarker.task', delegate },
      // one hand: with two, the palm finder runs on every frame looking for the second
      runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: .5, minHandPresenceConfidence: .5, minTrackingConfidence: .5,
    }), prefer);
    this.hands = r.task;
    this.delegate = r.delegate;
    const b = blank(256, 256);
    for (let i = 0; i < 3; i++) this.process(b, i + 1);
    b.close();
  }

  process(image: ImageBitmap | HTMLVideoElement, tMs: number): HandResult {
    const t0 = performance.now();
    const r = this.hands.detectForVideo(image, this.clock.next(tMs));
    const p = r.landmarks[0], w = r.worldLandmarks[0];
    let hand: HandData | null = null;
    if (p && w) {
      const lm = new Float32Array(63), world = new Float32Array(63);
      p.forEach((q, k) => { lm[k * 3] = q.x; lm[k * 3 + 1] = q.y; lm[k * 3 + 2] = q.z; });
      w.forEach((q, k) => { world[k * 3] = q.x; world[k * 3 + 1] = q.y; world[k * 3 + 2] = q.z; });
      hand = { lm, world, score: r.handedness[0]?.[0]?.score ?? 1 };
    }
    return { hand, ms: performance.now() - t0 };
  }

  close() { this.hands?.close(); }
}
