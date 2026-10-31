/* Hands mode: the camera, the two MediaPipe models, you cut out into the graveyard, and the pen in your hand, as one
   thing the game can start, stop and ask about. With ?debug it can also record what the models saw (landmarks only,
   no pictures), which is how the replay tests are made from real footage. */
import { HANDS } from '../config';
import { recorder } from '../debug/recorder';
import { CAMERA_HELP, Camera } from '../input/hand/camera';
import { HandPen } from '../input/hand/handpen';
import { Vision, type Rect } from '../input/hand/vision';
import type { Gl } from '../render/gl';
import { Player } from '../render/player';

/** one model result as it arrived: 'p' the body (33 x [x y z visibility]), 'h' the hand (21 x [x y z] in the whole
    frame, and in metres around the hand) or none */
export type TraceEntry =
  | { k: 'p'; t: number; at: number; vw: number; vh: number; lm: number[] | null }
  | { k: 'h'; t: number; at: number; vw: number; vh: number; rect: Rect; lm: number[] | null; world: number[] | null };

const round = (a: ArrayLike<number>) => Array.from(a, v => Math.round(v * 1e4) / 1e4);

export class Hands {
  readonly camera = new Camera();
  readonly vision = new Vision();
  readonly player: Player;
  readonly pen: HandPen;
  /** camera running and tracking ready */
  on = false;
  /** what the models saw, while recording */
  trace: TraceEntry[] | null = null;
  private stopFrames: (() => void) | null = null;
  private handT = -9;

  constructor(gl: Gl, stage: () => { W: number; H: number }) {
    this.pen = new HandPen(HANDS, stage);
    this.player = new Player(gl, this.pen.body);
    // the firefly sits on your fingertip in the picture of you
    this.pen.view = this.player.toScreen;
  }

  /** start the camera and the tracking; resolves to a message to show if it couldn't */
  async start(status: (s: string) => void): Promise<string | null> {
    if (this.on) return null;
    status('Starting the camera…');
    const err = await this.camera.start();
    if (err) return CAMERA_HELP[err];
    if (!this.vision.where) status('Waking up the hand tracking…');
    // ?pose=CPU / ?hand=GPU try another place for a model (for measuring on a new machine)
    const q = new URLSearchParams(location.search), d = (k: 'pose' | 'hand') => (q.get(k)?.toUpperCase() === 'CPU' ? 'CPU' : q.get(k)?.toUpperCase() === 'GPU' ? 'GPU' : HANDS.delegates[k]);
    const verr = await this.vision.init({ pose: d('pose'), hand: d('hand') });
    if (verr) { this.camera.stop(); return `Hand tracking couldn't start on this device (${verr}).`; }
    const cam = this.camera;
    const rec = recorder;
    if (rec) {
      rec.video(cam.media!);
      rec.log('start', { delegates: [this.vision.pose.delegate, this.vision.hand.delegate], where: this.vision.where, camera: cam.settings, screen: [innerWidth, innerHeight, devicePixelRatio] });
    }
    this.vision.onPose = r => {
      this.pen.pose(r.t, r.lm, cam.width, cam.height);
      this.player.take(r, r.at);
      const e = { k: 'p' as const, t: r.t, at: r.at, vw: cam.width, vh: cam.height, lm: r.lm && round(r.lm) };
      this.trace?.push(e);
      rec?.log('p', { t: e.t, vw: e.vw, vh: e.vh, lm: e.lm, S: Math.round(this.pen.body.S), side: this.pen.body.side });
    };
    this.vision.onHand = r => {
      if (r.hand) this.handT = r.at;
      const e = { k: 'h' as const, t: r.t, at: r.at, vw: r.vw, vh: r.vh, rect: r.rect, lm: r.hand && round(r.hand.lm), world: r.hand && round(r.hand.world) };
      this.trace?.push(e);
      this.pen.hand(r.t, r.hand, r.vw, r.vh, r.at);
      if (rec) {
        const p = this.pen.stats, c = this.pen.cursor;
        rec.log('h', { t: e.t, vw: e.vw, vh: e.vh, rect: e.rect, lm: e.lm, world: e.world });
        rec.log('pen', { t: e.t, src: p.source, crop: p.crop, side: p.side, S: Math.round(p.S), fingers: p.fingers.map(x => Math.round(x * 100) / 100),
          pose: p.pose, rest: p.rest, speed: Math.round(p.speed * 100) / 100, live: this.pen.live?.length ?? 0, cur: c.visible ? [Math.round(c.x), Math.round(c.y)] : null });
      }
    };
    this.stopFrames = cam.frames(t => {
      void this.vision.pushPose(cam.video, t, this.player.view(cam.width, cam.height));
      const rect = q.get('crop') === 'whole' ? { x: 0, y: 0, w: cam.width, h: cam.height } : this.pen.crop(cam.width, cam.height, t);
      void this.vision.pushHand(cam.video, t, rect);
    });
    this.on = true;
    return null;
  }

  stop() {
    recorder?.stopVideo();
    this.stopFrames?.();
    this.stopFrames = null;
    this.camera.stop();
    this.player.clear();
    this.pen.reset();
    this.on = false;
  }

  /** someone's in front of the camera */
  present(now: number) { return this.on && this.player.present(now); }
  /** a hand has been seen in the last moment */
  handSeen(now: number) { return this.on && now - this.handT < .5; }
  /** the camera is giving us few frames (a dim room slows webcams down) */
  slow() { return this.on && this.camera.fps > 0 && this.camera.fps < 25; }
  /** the low-light warning for the HUD, or null */
  lowLight() { return this.slow() ? `Too dark — camera at ${this.camera.fps.toFixed(0)} fps, add light` : null; }

  /** the practice coaching line, from what the camera sees */
  coach(now: number) {
    const c = this.pen.cursor;
    if (!this.present(now)) return 'Stand in front of the camera';
    if (!this.handSeen(now)) return 'Raise one hand in front of you';
    if (c.drawing) return "That's it: swipe the line, then make a fist";
    if (c.pose === 'point') return 'Now swipe a line across the ghost';
    return 'Point your finger to draw · Make a fist to move';
  }

  /** the debug panel's lines */
  report(): string {
    const c = this.camera, v = this.vision, p = this.pen.stats, s = c.settings, f = (n: number) => n.toFixed(0);
    return [
      `camera ${s.w}x${s.h} at ${c.fps.toFixed(1)} fps (asked ${f(s.fps)})`,
      `body  ${f(v.pose.hz)}/s  ${f(v.pose.ms)} ms model  ${f(v.pose.lag)} ms behind  [${v.pose.delegate}, ${v.where}]`,
      `hand  ${f(v.hand.hz)}/s  ${f(v.hand.ms)} ms model  ${f(v.hand.lag)} ms behind  [${v.hand.delegate}]`,
      `pen from ${p.source ?? 'nothing'}, crop ${p.crop}, hand ${p.side ?? '-'}, S ${f(p.S)} px${p.rest ? ', resting' : ''}`,
      `speed ${p.speed.toFixed(2)} screens/s (draws over ${HANDS.downV})${this.pen.live ? '  DRAWING' : ''}   fingers ${p.fingers.map(x => x.toFixed(2)).join(' ')} ${p.pose}`,
    ].join('\n');
  }
}
