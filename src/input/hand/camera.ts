/* The webcam: a user-facing stream into a hidden <video>, with the reasons it might not start put plainly. */

export type CameraError = 'denied' | 'missing' | 'busy' | 'insecure' | 'unsupported' | 'failed';

export const CAMERA_HELP: Record<CameraError, string> = {
  denied: 'Camera access is blocked. Allow it from the camera icon in the address bar, then try again.',
  missing: "We couldn't find a camera on this device.",
  busy: 'Another app is using the camera. Close it, then try again.',
  insecure: 'The camera only works on a secure (https) page.',
  unsupported: "This browser can't share its camera with web pages.",
  failed: "The camera didn't start. Try again.",
};

export class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor() {
    const v = this.video = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.append(v);
  }

  get on() { return !!this.stream; }
  get media() { return this.stream; }
  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }

  async start(): Promise<CameraError | null> {
    if (this.stream) { await this.video.play().catch(() => {}); return null; }
    if (!isSecureContext) return 'insecure';
    if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing'
        : name === 'NotReadableError' || name === 'AbortError' ? 'busy' : 'failed';
    }
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
      if (!this.video.videoWidth) await new Promise(r => this.video.addEventListener('loadedmetadata', r, { once: true }));
    } catch {
      this.stop();
      return 'failed';
    }
    return null;
  }

  stop() {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  /** what the camera actually gives us: its picture size, and frames a second (measured once it's running) */
  fps = 0;
  get settings() { const s = this.stream?.getVideoTracks()[0]?.getSettings(); return { w: s?.width ?? 0, h: s?.height ?? 0, fps: s?.frameRate ?? 0 }; }

  /** call `fn` for each new camera frame (up to 30 a second), until the returned function is called. Paced off the
      display rather than video-frame callbacks, which a hidden <video> may never get; a frame counts as new when the
      video's decoded-frame count moves (where the browser keeps one). A dim room can drop a webcam to 15 a second. */
  frames(fn: (t: number) => void): () => void {
    let live = true, last = -1, count = -1, countT = 0, counts = true, n0 = -1, n0T = 0;
    const loop = () => {
      if (!live) return;
      const t = performance.now() / 1000;
      const n = this.video.getVideoPlaybackQuality?.().totalVideoFrames ?? -1;
      if (n < 0) counts = false;
      let fresh = !counts;
      if (counts) {
        if (n !== count) { count = n; countT = t; fresh = true; }
        else if (t - countT > .25) counts = false; // this browser doesn't count them for a camera
      }
      if (counts && n >= 0) {
        if (n0 < 0) { n0 = n; n0T = t; } else if (t - n0T >= 1) { this.fps = (n - n0) / (t - n0T); n0 = n; n0T = t; }
      } else this.fps = this.settings.fps;
      if (fresh && t - last >= .9 / 30) { last = t; fn(t); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { live = false; };
  }
}
