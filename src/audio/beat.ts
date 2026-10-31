/* The score: dark synthwave, made live with Web Audio (no audio files).
   4/4 at 160 bpm in D minor. A 34-bar cycle (51 s) that loops for good:
     riff    8 bars: a bright staccato arpeggio of stabs over four-on-the-floor kicks (Dm, B♭, Gm, A, two bars each)
     tear    2 bars: the riff melts down in pitch, a noise cloud swells over a gritty low A, glissandi fall, then a beat
             of silence
     soar   16 bars: a near-pure sine lead, high up, holding long notes and sliding between them over warm pads and a
             legato saw bass that pumps against the kick; the drums keep out of its way
     storm   8 bars: the lead's first phrase again with the riff under it and the drums back in full, ending on a long
             slide down an octave into the riff
   Layers come in with `level`:
     0  pads, the lead, soft stabs                                              (title, game over)
     1  + the bass, the stabs full                                              (a run starts)
     2  + drums and the pump, crashes, fills and risers
     3  + sixteenth hats, the stabs doubled an octave up, glass arpeggios and a backbeat under the lead
     4  everything a semitone up, the bass and stabs driven, claps and a shaker  (down to your last hearts)
   `Beat` schedules one sixteenth at a time on any BaseAudioContext, so it can be rendered offline to check. */

/** a sixteenth at 160 bpm */
export const STEP = 60 / 160 / 4;
/** sixteenths in a bar */
export const BAR = 16;

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C#5' → 73, 'Bb4' → 70 */
const midi = (s: string) => 12 * (+s[s.length - 1] + 1) + LETTER[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0);

const HOLD = 0, REST = -1;
interface Note { note: number; slow: boolean }
/** a lead line, one token a sixteenth: a note ('Bb4') starts, '~' before it slides there slowly, '.' holds, '-' rests */
function line(src: string, bars: number): Note[] {
  const tokens = src.trim().split(/\s+/);
  if (tokens.length !== bars * BAR) throw new Error(`a line of ${bars} bars has ${tokens.length / BAR}`);
  return tokens.map(x => ({ note: x === '.' ? HOLD : x === '-' ? REST : midi(x.replace('~', '')), slow: x[0] === '~' }));
}

const PHRASE = `
  A5 . . . ~D6 . . . . . . . . . . .
  . . . . . . . . E6 . . . F6 . . .
  D6 . . . ~F6 . . . . . . . . . . .
  . . . . . . . . G6 . . . A6 . . .
  ~C7 . . . . . . . . . . . . . . .
  . . . . . . . . A6 . . . . . . .`;
const SOAR = line(PHRASE + `
  ~G6 . . . . . . . . . . . E6 . . .
  ~C#6 . . . . . . . . . . . - - - -
  A5 . . . ~D6 . . . . . . . . . . .
  . . . . . . . . F6 . . . E6 . . .
  D6 . . . . . . . . . . . . . . .
  . . . . . . . . ~Bb6 . . . . . . .
  . . . . . . . . A6 . . . G6 . . .
  ~D6 . . . . . . . . . . . . . . .
  E6 . . . . . . . C#6 . . . . . . .
  ~A6 . . . . . . . . . . . - - - -`, 16);
const STORM = line(PHRASE + `
  ~G6 . . . . . . . . . . . E6 . . .
  A6 . . . . . . . ~A5 . . . . . - -`, 8);

interface Chord {
  /** the bass's root */
  root: number;
  pad: number[];
  /** the riff's notes, low to high */
  stab: number[];
}
const Dm: Chord = { root: 38, pad: [57, 62, 65, 69], stab: [57, 62, 65, 69, 74] };
const Bb: Chord = { root: 34, pad: [58, 62, 65, 70], stab: [58, 62, 65, 70, 74] };
const Gm: Chord = { root: 31, pad: [55, 58, 62, 67], stab: [58, 62, 67, 70, 74] };
const F: Chord = { root: 41, pad: [57, 60, 65, 69], stab: [57, 60, 65, 69, 72] };
const A: Chord = { root: 33, pad: [57, 61, 64, 67], stab: [57, 61, 64, 69, 73] };

/** the riff, an eighth at a time over a chord's two bars, as indices into its stab notes; accents fall 3+3+2 */
const RIFF = [[1, 3, 4, 3, 2, 3, 4, 3], [0, 2, 3, 2, 4, 3, 2, 1]];
/** the glass arpeggio's order over a pad chord */
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];

type Kind = 'riff' | 'tear' | 'soar' | 'storm';
const SECTIONS: { kind: Kind; chords: Chord[]; line?: Note[] }[] = [
  { kind: 'riff', chords: [Dm, Dm, Bb, Bb, Gm, Gm, A, A] },
  { kind: 'tear', chords: [A, A] },
  { kind: 'soar', chords: [Dm, Dm, Bb, Bb, F, F, A, A, Dm, Dm, Bb, Bb, Gm, Gm, A, A], line: SOAR },
  { kind: 'storm', chords: [Dm, Dm, Bb, Bb, F, F, A, A], line: STORM },
];
const CYCLE = SECTIONS.reduce((n, s) => n + s.chords.length, 0);

type Bus = 'drums' | 'bass' | 'grit' | 'lead' | 'stab' | 'crunch' | 'pad' | 'glass' | 'fx';

interface Lead { osc: OscillatorNode[]; amp: GainNode; trim: GainNode; vibrato: GainNode; on: boolean; note: number }
/** the lead's partials: a sine, a whisper of its octave, and a slightly sharp twin for width */
const PARTIALS: [number, number, number][] = [[1, 1, 0], [2, .06, 0], [1, .22, 9]];

export class Beat {
  level = 0;
  want = 0;
  readonly out: GainNode;
  private noise: AudioBuffer;
  private bus: Record<Bus, GainNode>;
  /** the bass and pads duck under each kick */
  private pump: GainNode;
  private verb: ConvolverNode;
  private gate: ConvolverNode;
  private echo: DelayNode;
  private lead: Lead | null = null;
  private shift = 0;

  constructor(private ctx: BaseAudioContext) {
    const c = ctx;
    this.out = c.createGain();
    this.pump = c.createGain();
    this.pump.connect(this.out);

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
    gOut.gain.value = .45;
    this.gate.connect(gOut).connect(this.out);

    // a dotted-eighth echo for the lead and the stabs
    this.echo = c.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = c.createGain(), tone = c.createBiquadFilter(), wet = c.createGain();
    fb.gain.value = .35; tone.type = 'lowpass'; tone.frequency.value = 3500; wet.gain.value = .3;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    tone.connect(wet).connect(this.out);
    const verbSend = c.createGain();
    verbSend.gain.value = .3;
    tone.connect(verbSend).connect(this.verb);

    const bus = (gain: number, send: number, echo = 0, to: AudioNode = this.out) => {
      const g = c.createGain();
      g.gain.value = gain;
      g.connect(to);
      if (send) { const s = c.createGain(); s.gain.value = send; g.connect(s).connect(this.verb); }
      if (echo) { const s = c.createGain(); s.gain.value = echo; g.connect(s).connect(this.echo); }
      return g;
    };
    /** a bus through a soft clipper, for the last hearts */
    const driven = (gain: number, send: number, drive: number, tone: number, to: AudioNode = this.out) => {
      const into = c.createGain(), shaper = c.createWaveShaper(), lp = c.createBiquadFilter();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 511.5 - 1) * drive) / Math.tanh(drive);
      shaper.curve = curve; shaper.oversample = '2x';
      lp.type = 'lowpass'; lp.frequency.value = tone;
      into.connect(shaper).connect(lp).connect(bus(gain, send, 0, to));
      return into;
    };
    this.bus = {
      drums: bus(.8, .08), bass: bus(.5, .04, 0, this.pump), grit: driven(.22, .05, 3, 2000, this.pump),
      lead: bus(.115, .45, .3), stab: bus(1, .25, .2), crunch: driven(.55, .25, 3, 4500),
      pad: bus(1, .5, 0, this.pump), glass: bus(.55, .45, .3), fx: bus(.8, .8),
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
    if (!this.lead) this.begin(t);
    if (s === 0) this.newBar(t);
    const L = this.level, k = this.shift;
    let b = bar % CYCLE, si = 0;
    while (b >= SECTIONS[si].chords.length) b -= SECTIONS[si++].chords.length;
    const sec = SECTIONS[si], chord = sec.chords[b], last = b === sec.chords.length - 1;

    if (sec.kind === 'tear') { this.tear(chord, b, s, t, L, k); return; }

    if (s === 0) {
      if (b === 0 && L >= 2) this.crash(t);
      if (b % 2 === 0) {
        this.pad(t, chord.pad.map(m => m + k), 2 * BAR * STEP);
        if (L >= 1 && sec.kind !== 'riff') this.bassNote(t, chord.root + k, 2 * BAR * STEP, L >= 4);
      }
      if (last && L >= 2 && sec.kind !== 'riff') this.riser(t, BAR * STEP);
    }

    const note = sec.line?.[b * BAR + s];
    if (note && note.note !== HOLD) {
      if (note.note === REST) this.hush(t);
      else this.sing(t, note.note + k, note.slow);
    }

    // the riff
    if (sec.kind !== 'soar' && s % 2 === 0) {
      const e = s / 2, m = chord.stab[RIFF[b % 2][e]] + k;
      const v = (e === 0 || e === 3 || e === 6 ? 1 : .7) * (L === 0 ? .5 : sec.kind === 'storm' ? .7 : 1);
      this.stab(t, m, v, L === 0, L >= 4);
      if (L >= 3) this.stab(t, m + 12, v * .3, false, false);
    }
    // under the riff, the bass punches on the beat
    if (sec.kind === 'riff' && L >= 1 && s % 4 === 0) this.bass(t, chord.root + k, s === 0 ? 1 : .8, L >= 4);
    // glass under the lead
    if (sec.kind === 'soar' && L >= 3 && s % 2 === 0) this.glass(t, chord.pad[ARP[s / 2]] + 12 + k, s % 4 === 0 ? 1 : .7);

    if (L >= 2) this.drums(sec.kind, last, b, s, t, L);
  }

  private newBar(t: number) {
    this.level = this.want;
    const k = this.level >= 4 ? 1 : 0, lead = this.lead!;
    if (k !== this.shift) {
      // the dread: everything up a semitone, a held lead note sliding with it
      if (lead.on) {
        lead.note += k - this.shift;
        lead.osc.forEach((o, i) => o.frequency.setTargetAtTime(hz(lead.note) * PARTIALS[i][0], t, .05));
      }
      this.shift = k;
    }
    // softer over the title
    lead.trim.gain.setTargetAtTime(this.level ? 1 : .65, t, .5);
  }

  /** the two bars between riff and soar: everything comes apart */
  private tear(chord: Chord, b: number, s: number, t: number, L: number, k: number) {
    if (b === 0) {
      if (s === 0) {
        this.bassNote(t, chord.root + k, 28 * STEP, true);
        this.cloud(t, 2 * BAR * STEP);
        if (L >= 2) this.kick(t);
      }
      // the riff keeps going, sagging further out of tune each note
      if (s % 2 === 0) this.stab(t, chord.stab[RIFF[0][s / 2]] + k - s * .1, L ? .8 : .5, L === 0, L >= 4, true);
    } else {
      if (s === 0) this.fall(t);
      // a cymbal backwards, cut off a moment before the soar
      if (s === 6) this.swell(t, 7 * STEP);
    }
  }

  private drums(kind: Kind, last: boolean, b: number, s: number, t: number, L: number) {
    if (kind === 'soar') {
      if (s === 0 || s === 8 || (L >= 3 && b % 2 === 1 && s === 14)) this.kick(t, .5);
      if (L >= 3 && (s === 4 || s === 12)) { this.snare(t, .4); if (L >= 4) this.clap(t); }
      this.shaker(t, s % 4 === 2 ? .6 : s % 2 ? .3 : .4);
      if (L >= 4 && s % 4 === 2) this.hat(t, .35, true);
      return;
    }
    // riff and storm: four on the floor; the riff's last two beats a snare run
    if (kind === 'riff' && last && s >= 8) {
      if (s % 4 === 0) this.kick(t);
      this.snare(t, .35 + (s - 8) * .09);
      return;
    }
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) { this.snare(t); if (L >= 4) this.clap(t); }
    if (s % 4 === 2) this.hat(t, .5);
    else if (L >= 3 && s % 2 === 1) this.hat(t, .25);
    if (L >= 4 && s % 2 === 1) this.shaker(t, .7);
  }

  /* ---------- the lead: one voice that runs for good, gliding from note to note ---------- */

  private begin(t: number) {
    const c = this.ctx, amp = c.createGain(), trim = c.createGain(), tone = c.createBiquadFilter(), lfo = c.createOscillator();
    const vibrato = c.createGain();
    amp.gain.value = 0;
    tone.type = 'lowpass'; tone.frequency.value = 5000;
    lfo.frequency.value = 5; vibrato.gain.value = 0;
    lfo.connect(vibrato);
    const osc = PARTIALS.map(([mul, gain, det]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = hz(86) * mul; o.detune.value = det;
      vibrato.connect(o.detune);
      g.gain.value = gain;
      o.connect(g).connect(tone);
      o.start(t);
      return o;
    });
    tone.connect(amp).connect(trim).connect(this.bus.lead);
    lfo.start(t);
    this.lead = { osc, amp, trim, vibrato, on: false, note: 86 };
  }

  private sing(t: number, note: number, slow: boolean) {
    const lead = this.lead!, f = hz(note);
    lead.osc.forEach((o, i) => {
      const target = f * PARTIALS[i][0];
      if (lead.on) o.frequency.setTargetAtTime(target, t, slow ? .1 : .03);
      // from silence, a little scoop up into the note
      else { o.frequency.setValueAtTime(target * .97, t); o.frequency.setTargetAtTime(target, t, .04); }
    });
    // only a touch of vibrato, and only once a note has held a while
    lead.vibrato.gain.setTargetAtTime(0, t, .03);
    lead.vibrato.gain.setTargetAtTime(9, t + .35, .3);
    if (!lead.on) lead.amp.gain.setTargetAtTime(1, t, .03);
    lead.on = true;
    lead.note = note;
  }

  private hush(t: number) {
    const lead = this.lead!;
    if (!lead.on) return;
    lead.amp.gain.setTargetAtTime(0, t, .08);
    lead.on = false;
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

  /** a staccato stab: a saw and a square through a filter that snaps shut; `sag` droops each one flat */
  private stab(t: number, note: number, v: number, soft: boolean, crunch: boolean, sag = false) {
    const c = this.ctx, f = hz(note), lp = c.createBiquadFilter(), g = this.env(t, .16 * v, .002, .22);
    lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(soft ? 1800 : 6000, t);
    lp.frequency.setTargetAtTime(soft ? 700 : 1100, t, .05);
    lp.connect(g).connect(crunch ? this.bus.crunch : this.bus.stab);
    for (const [type, det] of [['sawtooth', -6], ['square', 6]] as const) {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = f; o.detune.value = det;
      if (sag) o.detune.linearRampToValueAtTime(det - 90, t + .25);
      o.connect(lp);
      o.start(t); o.stop(t + .3);
    }
  }

  /** a short bass note on the beat: a saw and a square through a plucked filter, a clean sub under them */
  private bass(t: number, note: number, v: number, grit: boolean) {
    const c = this.ctx, f = hz(note), lp = c.createBiquadFilter(), g = this.env(t, .5 * v, .004, .3);
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.linearRampToValueAtTime(240 + 900 * v, t + .012);
    lp.frequency.setTargetAtTime(220, t + .015, .07);
    lp.connect(g).connect(grit ? this.bus.grit : this.bus.bass);
    for (const [type, det] of [['sawtooth', -7], ['square', 7]] as const) {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = f; o.detune.value = det;
      o.connect(lp);
      o.start(t); o.stop(t + .4);
    }
    const sub = c.createOscillator();
    sub.frequency.value = f;
    sub.connect(this.env(t, .4 * v, .004, .32)).connect(this.bus.bass);
    sub.start(t); sub.stop(t + .4);
  }

  /** a held bass note: two saws and a sub under a dark filter, for `dur` */
  private bassNote(t: number, note: number, dur: number, grit: boolean) {
    const c = this.ctx, f = hz(note), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 1.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.15, t + .015);
    g.gain.setValueAtTime(.15, t + dur - .03);
    g.gain.linearRampToValueAtTime(0, t + dur + .06);
    lp.connect(g).connect(grit ? this.bus.grit : this.bus.bass);
    for (const [type, det, gain] of [['sawtooth', -6, 1], ['sawtooth', 6, 1], ['sine', 0, 1.6]] as const) {
      const o = c.createOscillator(), og = c.createGain();
      o.type = type; o.frequency.value = f; o.detune.value = det;
      og.gain.value = gain;
      o.connect(og).connect(lp);
      o.start(t); o.stop(t + dur + .1);
    }
  }

  /** warm pads: detuned saws under a soft filter */
  private pad(t: number, notes: number[], dur: number) {
    const c = this.ctx, lp = c.createBiquadFilter(), g = c.createGain(), end = t + dur + 1.1;
    lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = .5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.045, t + .4);
    g.gain.setValueAtTime(.045, t + dur - .1);
    g.gain.linearRampToValueAtTime(0, t + dur + 1);
    lp.connect(g).connect(this.bus.pad);
    for (const m of notes) for (const det of [-8, 8]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(lp);
      o.start(t); o.stop(end);
    }
  }

  /** a glassy FM pluck */
  private glass(t: number, note: number, v: number) {
    const c = this.ctx, f = hz(note), car = c.createOscillator(), mod = c.createOscillator(), idx = c.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.5;
    idx.gain.setValueAtTime(f * 1.5, t);
    idx.gain.setTargetAtTime(0, t, .08);
    mod.connect(idx).connect(car.frequency);
    car.connect(this.env(t, .09 * v, .002, .9)).connect(this.bus.glass);
    for (const o of [car, mod]) { o.start(t); o.stop(t + 1.1); }
  }

  /** a cloud of noise swelling through a band that climbs, then thinning out */
  private cloud(t: number, dur: number) {
    const c = this.ctx, n = this.noiseHit(t, 2.4), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.exponentialRampToValueAtTime(5000, t + dur * .5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.18, t + dur * .4);
    g.gain.linearRampToValueAtTime(0, t + dur * .8);
    n.connect(bp).connect(g).connect(this.bus.fx);
  }

  /** sines falling an octave or two, out of step with each other */
  private fall(t: number) {
    const c = this.ctx;
    [[5200, 1.1], [3900, 1.3], [2900, .9], [2100, 1.2], [1500, 1]].forEach(([from, len], i) => {
      const o = c.createOscillator(), g = c.createGain(), at = t + i * .07;
      o.frequency.setValueAtTime(from, at);
      o.frequency.exponentialRampToValueAtTime(from / (i % 2 ? 4 : 2.5), at + len);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(.03, at + .05);
      g.gain.linearRampToValueAtTime(0, at + len);
      o.connect(g).connect(this.bus.fx);
      o.start(at); o.stop(at + len + .05);
    });
  }

  /** the kick also pumps the bass and pads */
  private kick(t: number, v = 1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + .13);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + .003);
    g.gain.exponentialRampToValueAtTime(.001 * v, t + .45);
    o.connect(g).connect(this.bus.drums);
    o.start(t); o.stop(t + .5);
    const n = this.noiseHit(t, .02), hp = c.createBiquadFilter(), ng = this.env(t, .3 * v, .001, .015);
    hp.type = 'highpass'; hp.frequency.value = 2000;
    n.connect(hp).connect(ng).connect(this.bus.drums);
    const p = this.pump.gain;
    p.setTargetAtTime(1 - .4 * v, t, .004);
    p.setTargetAtTime(1, t + .03, .09);
  }

  /** the 80s snare: a crack of noise and a tone body, thrown into the gated room */
  private snare(t: number, v = 1) {
    const c = this.ctx, n = this.noiseHit(t, .3), bp = c.createBiquadFilter(), g = this.env(t, .7 * v, .001, .2);
    bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = .6;
    n.connect(bp).connect(g).connect(this.bus.drums);
    const body = c.createOscillator(), bg = this.env(t, .4 * v, .001, .12);
    body.frequency.setValueAtTime(240, t);
    body.frequency.exponentialRampToValueAtTime(170, t + .08);
    body.connect(bg).connect(this.bus.drums);
    body.start(t); body.stop(t + .25);
    const s = c.createGain();
    s.gain.value = .9;
    g.connect(s).connect(this.gate);
    bg.connect(s);
  }

  private clap(t: number) {
    const c = this.ctx, bp = c.createBiquadFilter(), g = c.createGain(), pan = c.createStereoPanner();
    bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.1;
    pan.pan.value = .15;
    g.gain.setValueAtTime(0, t);
    // three quick slaps, then the tail
    for (const d of [0, .011, .022]) {
      g.gain.setValueAtTime(.5, t + d);
      g.gain.setTargetAtTime(.05, t + d, .004);
    }
    g.gain.setValueAtTime(.4, t + .033);
    g.gain.setTargetAtTime(0, t + .033, .05);
    this.noiseHit(t, .3).connect(bp).connect(g).connect(pan).connect(this.bus.drums);
    const s = c.createGain();
    s.gain.value = .5;
    g.connect(s).connect(this.gate);
  }

  private hat(t: number, v: number, open = false) {
    const c = this.ctx, n = this.noiseHit(t, open ? .4 : .05), hp = c.createBiquadFilter(), lp = c.createBiquadFilter();
    const pan = c.createStereoPanner(), g = this.env(t, .3 * v, .001, open ? .35 : .03);
    hp.type = 'highpass'; hp.frequency.value = open ? 6500 : 7000;
    // and not too fizzy, to sit easy for hours
    lp.type = 'lowpass'; lp.frequency.value = 13000;
    pan.pan.value = -.2;
    n.connect(hp).connect(lp).connect(g).connect(pan).connect(this.bus.drums);
  }

  private shaker(t: number, v: number) {
    const c = this.ctx, n = this.noiseHit(t, .08), bp = c.createBiquadFilter(), pan = c.createStereoPanner(), g = c.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 6000; bp.Q.value = 1.2;
    pan.pan.value = .35;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.12 * v, t + .015);
    g.gain.setTargetAtTime(0, t + .015, .015);
    n.connect(bp).connect(g).connect(pan).connect(this.bus.drums);
  }

  private crash(t: number) {
    const c = this.ctx, n = this.noiseHit(t, 2), hp = c.createBiquadFilter(), g = this.env(t, .28, .002, 2.2);
    const pan = c.createStereoPanner();
    hp.type = 'highpass'; hp.frequency.value = 4000;
    pan.pan.value = .25;
    n.connect(hp).connect(g).connect(pan).connect(this.bus.drums);
    const s = c.createGain();
    s.gain.value = .3;
    g.connect(s).connect(this.verb);
  }

  /** a swell into the next section: noise and a band sweeping up, cut dead on the downbeat */
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

  /** a cymbal played backwards */
  private swell(t: number, dur: number) {
    const c = this.ctx, n = this.noiseHit(t, dur), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1500, t);
    hp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    g.gain.setValueAtTime(.001, t);
    g.gain.exponentialRampToValueAtTime(.3, t + dur - .01);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(hp).connect(g).connect(this.bus.fx);
  }

  stop() {
    for (const o of this.lead?.osc ?? []) { try { o.stop(); } catch { /* already stopped */ } }
    this.lead = null;
  }
}
