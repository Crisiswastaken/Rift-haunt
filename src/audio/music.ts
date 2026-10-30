/* Plays the beat (beat.ts) live: a lookahead scheduler on an AudioContext, a master chain (a muffle for pause, a
   compressor to glue it), mute, and the context started on the first click or key, as browsers require. */
import { Beat, STEP } from './beat';

const MUTE_KEY = 'haunt.muted';
/** how far ahead notes are scheduled, and how often the scheduler wakes */
const AHEAD = .15, TICK = 25;

function stored(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export class Music {
  private ctx: AudioContext | null = null;
  private beat: Beat | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private n = 0;
  private next = 0;
  private wantLevel = 0;
  private wantMuffled = false;
  muted = stored();

  /** call from a user gesture: makes the context the first time, wakes it after that */
  start() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.beat = new Beat(ctx);
      this.muffle = ctx.createBiquadFilter();
      this.muffle.type = 'lowpass';
      this.muffle.frequency.value = 20000;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = .004; comp.release.value = .2;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : VOLUME;
      this.beat.out.connect(this.muffle).connect(comp).connect(this.master).connect(ctx.destination);
      this.beat.want = this.beat.level = this.wantLevel;
      this.applyMuffle();
      this.next = ctx.currentTime + .1;
      window.setInterval(() => this.schedule(), TICK);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** 0 (title) to 4 (late waves); it changes on the next bar */
  set level(n: number) {
    this.wantLevel = n;
    if (this.beat) this.beat.want = n;
  }

  /** muffled, as if through a door: paused */
  set muffled(on: boolean) {
    if (on === this.wantMuffled) return;
    this.wantMuffled = on;
    this.applyMuffle();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* private mode */ }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : VOLUME, this.ctx.currentTime, .05);
    return this.muted;
  }

  /** the tab is hidden: stop the clock rather than let the scheduler fall behind */
  sleep() { if (this.ctx?.state === 'running') void this.ctx.suspend(); }
  wake() { if (this.ctx?.state === 'suspended') void this.ctx.resume(); }

  private applyMuffle() {
    if (!this.ctx || !this.muffle) return;
    this.muffle.frequency.setTargetAtTime(this.wantMuffled ? 520 : 20000, this.ctx.currentTime, this.wantMuffled ? .08 : .25);
  }

  private schedule() {
    const ctx = this.ctx!, now = ctx.currentTime;
    if (ctx.state !== 'running') return;
    // fell behind (a stall): pick up from now rather than play a burst of late notes
    if (this.next < now - .05) this.next = now + .02;
    while (this.next < now + AHEAD) {
      this.beat!.step(this.n++, this.next);
      this.next += STEP;
    }
  }
}

const VOLUME = .7;
