/* Recording a hands-mode session for debugging, on the dev server only (vite.config.ts saves what it's sent into
   logs/<session>/): the camera as a video (camera.webm), and a log line for everything the tracking and the game did
   (log.jsonl): each body and hand result, the pen's state after each hand frame, every stroke and what it read as,
   mode changes, and the rates once a second. Played back as a fake camera, the video gives the same session again. */

export class Recorder {
  readonly session = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  private lines: string[] = [];
  private media: MediaRecorder | null = null;
  /** posts go one after another, so the video's pieces arrive in order */
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    setInterval(() => this.flush(), 1000);
    addEventListener('pagehide', () => this.flush());
  }

  log(k: string, data: object = {}) {
    this.lines.push(JSON.stringify({ k, at: Math.round(performance.now() * 10) / 1e4, ...data }));
  }

  /** record the camera itself; its first frame is at the 'video' line's time */
  video(stream: MediaStream) {
    if (this.media || typeof MediaRecorder === 'undefined') return;
    const type = ['video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    const m = this.media = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4e6 });
    m.ondataavailable = e => { if (e.data.size) this.post('video', e.data); };
    m.start(1000);
    const s = stream.getVideoTracks()[0]?.getSettings();
    this.log('video', { w: s?.width, h: s?.height, fps: s?.frameRate, type });
  }

  stopVideo() {
    if (this.media?.state === 'recording') this.media.stop();
    this.media = null;
    this.log('video-stop');
  }

  private flush() {
    if (!this.lines.length) return;
    this.post('log', new Blob([this.lines.join('\n') + '\n']));
    this.lines = [];
  }

  private post(kind: 'log' | 'video', body: Blob) {
    this.queue = this.queue.then(() => fetch(`/__rec/${kind}?s=${this.session}`, { method: 'POST', body }).catch(() => {}));
  }
}

/** on the dev server (where there's somewhere to save it), or with ?rec */
export const recorder: Recorder | null =
  import.meta.env.DEV || new URLSearchParams(location.search).has('rec') ? new Recorder() : null;
