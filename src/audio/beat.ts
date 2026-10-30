/* The score: horror synthwave, made live with Web Audio (no audio files).
   5/4 in D minor, an eighth note every 0.18 s. Eight-bar phrase: Dm over a pedal, B♭, Gm, then A with a flat nine for
   the dread, two bars each. An original piano ostinato climbs chromatically over a low pedal, grouped 3+3+2+2; a
   pulsing saw bass, big 80s drums with a gated snare, detuned strings swelling with a minor-second rub, a low drone,
   a square arp through a dotted-eighth delay, and a riser into each phrase.
   Layers come in with `level`:
     0  strings, drone, soft piano                       (title, game over)
     1  + bass pulse                                     (a run starts)
     2  + drums, the riser
     3  + arp, sixteenth hats
     4  everything, a semitone up, strings trembling    (down to your last hearts)
   `Beat` schedules one sixteenth at a time on any BaseAudioContext, so it can be rendered offline to check. */

export const STEP = .09;
/** sixteenths in a 5/4 bar */
export const BAR = 20;

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface Chord {
  /** the ostinato: low pedal, its fifth, and a four-note top line that creeps */
  low: number; fifth: number; top: number[];
  bass: number;
  strings: number[];
  /** the dissonant rub laid quietly over the strings */
  rub: number;
  arp: number[];
}
const CHORDS: Chord[] = [
  { low: 62, fifth: 69, top: [74, 75, 76, 77], bass: 38, strings: [62, 65, 69], rub: 75, arp: [74, 77, 81, 86] }, // Dm
  { low: 58, fifth: 65, top: [77, 76, 74, 73], bass: 34, strings: [58, 62, 65], rub: 76, arp: [70, 74, 77, 82] }, // B♭ (sharp eleven)
  { low: 55, fifth: 62, top: [70, 71, 72, 74], bass: 31, strings: [55, 58, 62], rub: 68, arp: [67, 70, 74, 79] }, // Gm
  { low: 57, fifth: 64, top: [73, 74, 73, 70], bass: 33, strings: [57, 61, 64], rub: 70, arp: [69, 73, 76, 81] }, // A, flat nine
];
/** the ostinato's ten eighths: which voice plays on each (3+3+2+2) */
const OSTINATO: ('low' | 'fifth' | 0 | 1 | 2 | 3)[] = ['low', 'fifth', 0, 'low', 'fifth', 1, 'low', 2, 'low', 3];
/** drums, by eighth of the bar */
const KICK = [0, 5, 6], SNARE = [3, 8];

type Bus = 'drums' | 'bass' | 'piano' | 'strings' | 'arp' | 'drone';

export class Beat {
  level = 0;
  want = 0;
  readonly out: GainNode;
  private noise: AudioBuffer;
  private bus: Record<Bus, GainNode>;
  private verb: ConvolverNode;
  private gate: ConvolverNode;
  private echo: DelayNode;
  /** the drone holds for good once started */
  private drone: OscillatorNode[] | null = null;
  private shift = 0;

  constructor(private ctx: BaseAudioContext) {
    const c = ctx;
    this.out = c.createGain();

    this.noise = c.createBuffer(1, Math.round(c.sampleRate * 2.5), c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // a big dark hall
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(3.6, 1.7, false);
    const vOut = c.createGain();
    vOut.gain.value = .55;
    this.verb.connect(vOut).connect(this.out);
    // the 80s gated reverb: a burst of dense room that stops dead
    this.gate = c.createConvolver();
    this.gate.buffer = this.impulse(.26, 0, true);
    const gOut = c.createGain();
    gOut.gain.value = .5;
    this.gate.connect(gOut).connect(this.out);

    // dotted-eighth echo for the arp and the piano
    this.echo = c.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = c.createGain(), tone = c.createBiquadFilter(), wet = c.createGain();
    fb.gain.value = .38; tone.type = 'lowpass'; tone.frequency.value = 3200; wet.gain.value = .35;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    tone.connect(wet).connect(this.out);
    const verbSend = c.createGain();
    verbSend.gain.value = .3;
    tone.connect(verbSend).connect(this.verb);

    const bus = (gain: number, send: number, echo = 0) => {
      const g = c.createGain();
      g.gain.value = gain;
      g.connect(this.out);
      if (send) { const s = c.createGain(); s.gain.value = send; g.connect(s).connect(this.verb); }
      if (echo) { const s = c.createGain(); s.gain.value = echo; g.connect(s).connect(this.echo); }
      return g;
    };
    this.bus = {
      drums: bus(.8, .08), bass: bus(.5, .05), piano: bus(1.75, .35, .25), strings: bus(1.1, .6), arp: bus(.8, .4, .8), drone: bus(.2, .3),
    };
  }

  private impulse(seconds: number, decay: number, gated: boolean) {
    const c = this.ctx, len = Math.round(c.sampleRate * seconds), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / c.sampleRate, env = gated ? (t < seconds * .85 ? 1 : (seconds - t) / (seconds * .15)) : Math.exp(-t * decay);
        x[i] = (Math.random() * 2 - 1) * env * (i < 100 ? i / 100 : 1);
      }
    }
    return ir;
  }

  /** play sixteenth n (from the start) at time t */
  step(n: number, t: number) {
    const s = n % BAR, bar = Math.floor(n / BAR);
    if (s === 0) {
      this.level = this.want;
      // the dread: everything up a semitone, from the next bar
      this.shift = this.level >= 4 ? 1 : 0;
    }
    const L = this.level, chord = CHORDS[Math.floor(bar / 2) % 4], k = this.shift, eighth = s % 2 === 0 ? s / 2 : -1;
    const phraseBar = bar % 8;

    if (!this.drone) this.startDrone(t);
    if (s === 0 && bar % 2 === 0) this.strings(t, chord, BAR * 2 * STEP, k, L >= 4);

    // the ostinato
    if (eighth >= 0) {
      const v = OSTINATO[eighth], top = bar % 2 === 1 ? [...chord.top].reverse() : chord.top;
      const note = v === 'low' ? chord.low : v === 'fifth' ? chord.fifth : top[v];
      const accent = [0, 3, 6, 8].includes(eighth);
      this.piano(t, note + k, (accent ? 1 : .62) * (L === 0 ? .55 : 1), L === 0);
    }

    if (L >= 1 && eighth >= 0) this.bass(t, chord.bass + k, [0, 3, 6, 8].includes(eighth) ? 1 : .65);

    if (L >= 2) {
      const fill = phraseBar === 7 && eighth >= 7;
      if (fill) this.tom(t, [55, 50, 45][eighth - 7]);
      else {
        if (KICK.includes(eighth)) this.kick(t);
        if (SNARE.includes(eighth)) this.snare(t);
      }
      if (phraseBar === 7 && s === 0) this.riser(t, BAR * STEP);
      if (L >= 3 ? true : s % 2 === 0) this.hat(t, s % 4 === 0 ? .55 : s % 2 === 0 ? .4 : .25);
    }

    if (L >= 3 && phraseBar >= 4) this.arp(t, chord.arp[[0, 1, 2, 3, 2, 1][s % 6]] + k + 12, s % 4 === 0 ? 1 : .7);
  }

  /* ---------- voices ---------- */

  private env(t: number, peak: number, attack: number, decay: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 4);
    return g;
  }

  private noiseHit(t: number, dur: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * .4, dur);
    return src;
  }

  /** an electric-piano pluck: a sine carrier frequency-modulated hard at the attack, settling to a pure tone */
  private piano(t: number, note: number, v: number, soft: boolean) {
    const c = this.ctx, f = hz(note), car = c.createOscillator(), mod = c.createOscillator(), idx = c.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * (soft ? 1 : 2);
    idx.gain.setValueAtTime(f * (soft ? 1.2 : 2.6), t);
    idx.gain.setTargetAtTime(f * .15, t, .08);
    mod.connect(idx).connect(car.frequency);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = soft ? 2200 : 5200;
    const g = this.env(t, .16 * v, .003, .9);
    car.connect(lp).connect(g).connect(this.bus.piano);
    car.start(t); mod.start(t); car.stop(t + 1.3); mod.stop(t + 1.3);
  }

  private bass(t: number, note: number, v: number) {
    const c = this.ctx, lp = c.createBiquadFilter(), g = this.env(t, .5 * v, .004, .2);
    lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(260 + 900 * v, t + .012);
    lp.frequency.setTargetAtTime(220, t + .015, .06);
    lp.connect(g).connect(this.bus.bass);
    for (const [type, det] of [['sawtooth', -7], ['square', 7]] as const) {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = hz(note); o.detune.value = det;
      o.connect(lp);
      o.start(t); o.stop(t + .3);
    }
    // and a clean sub under it
    const sub = c.createOscillator(), sg = this.env(t, .35 * v, .004, .22);
    sub.frequency.value = hz(note);
    sub.connect(sg).connect(this.bus.bass);
    sub.start(t); sub.stop(t + .3);
  }

  private strings(t: number, chord: Chord, dur: number, k: number, tremble: boolean) {
    const c = this.ctx, lp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), depth = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = .8;
    lfo.frequency.value = .13; depth.gain.value = 650;
    lfo.connect(depth).connect(lp.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.05, t + 1.1);
    g.gain.setValueAtTime(.05, t + dur - .2);
    g.gain.linearRampToValueAtTime(0, t + dur + 1.2);
    let out: AudioNode = g;
    if (tremble) {
      const trem = c.createGain(), tl = c.createOscillator(), td = c.createGain();
      trem.gain.value = .65; tl.frequency.value = 7.5; td.gain.value = .35;
      tl.connect(td).connect(trem.gain);
      tl.start(t); tl.stop(t + dur + 1.3);
      g.connect(trem);
      out = trem;
    }
    lp.connect(g);
    out.connect(this.bus.strings);
    const notes = [...chord.strings.map(m => [m + k, 1] as const), [chord.rub + k, .3] as const];
    for (const [m, amp] of notes) for (const det of [-9, 0, 9]) {
      const o = c.createOscillator(), og = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      og.gain.value = amp;
      o.connect(og).connect(lp);
      o.start(t); o.stop(t + dur + 1.3);
    }
    lfo.start(t); lfo.stop(t + dur + 1.3);
  }

  /** a low D that never stops: two detuned saws through a dark filter, beating slowly */
  private startDrone(t: number) {
    const c = this.ctx, lp = c.createBiquadFilter(), gain = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 160;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(.2, t + 3);
    lp.connect(gain).connect(this.bus.drone);
    this.drone = [26, 26.08, 33].map(m => {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(m);
      o.connect(lp); o.start(t);
      return o;
    });
  }

  private kick(t: number) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + .13);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + .003);
    g.gain.exponentialRampToValueAtTime(.001, t + .55);
    o.connect(g).connect(this.bus.drums);
    o.start(t); o.stop(t + .6);
    const n = this.noiseHit(t, .02), hp = c.createBiquadFilter(), ng = this.env(t, .3, .001, .015);
    hp.type = 'highpass'; hp.frequency.value = 2000;
    n.connect(hp).connect(ng).connect(this.bus.drums);
  }

  /** the 80s snare: a crack of noise and a tone body, thrown into the gated room */
  private snare(t: number) {
    const c = this.ctx, n = this.noiseHit(t, .3), bp = c.createBiquadFilter(), g = this.env(t, .7, .001, .2);
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = .6;
    n.connect(bp).connect(g).connect(this.bus.drums);
    const body = c.createOscillator(), bg = this.env(t, .4, .001, .12);
    body.frequency.setValueAtTime(240, t);
    body.frequency.exponentialRampToValueAtTime(170, t + .08);
    body.connect(bg).connect(this.bus.drums);
    body.start(t); body.stop(t + .25);
    const s = c.createGain();
    s.gain.value = .9;
    g.connect(s).connect(this.gate);
    bg.connect(s);
  }

  private tom(t: number, note: number) {
    const c = this.ctx, o = c.createOscillator(), g = this.env(t, .75, .002, .45);
    o.frequency.setValueAtTime(hz(note) * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(hz(note), t + .1);
    o.connect(g).connect(this.bus.drums);
    o.start(t); o.stop(t + .6);
    const s = c.createGain();
    s.gain.value = .6;
    g.connect(s).connect(this.gate);
  }

  private hat(t: number, v: number) {
    const c = this.ctx, n = this.noiseHit(t, .05), hp = c.createBiquadFilter(), pan = c.createStereoPanner();
    hp.type = 'highpass'; hp.frequency.value = 7500;
    pan.pan.value = -.2;
    const g = this.env(t, .3 * v, .001, .03);
    n.connect(hp).connect(g).connect(pan).connect(this.bus.drums);
  }

  private arp(t: number, note: number, v: number) {
    const c = this.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = this.env(t, .3 * v, .002, .14);
    o.type = 'square'; o.frequency.value = hz(note);
    lp.type = 'lowpass'; lp.frequency.value = 3800;
    o.connect(lp).connect(g).connect(this.bus.arp);
    o.start(t); o.stop(t + .25);
  }

  /** a swell into the next phrase: noise and a saw sweeping up, cut dead on the downbeat */
  private riser(t: number, dur: number) {
    const c = this.ctx, n = this.noiseHit(t, dur), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.22, t + dur - .02);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(bp).connect(g).connect(this.bus.drums);
    const s = c.createGain();
    s.gain.value = .5;
    g.connect(s).connect(this.verb);
  }

  stop() {
    for (const o of this.drone ?? []) { try { o.stop(); } catch { /* already stopped */ } }
    this.drone = null;
  }
}
