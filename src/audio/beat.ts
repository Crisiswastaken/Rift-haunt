/* The score: spooky and bouncing, made live with Web Audio (no audio files).
   4/4 at 160 bpm in D minor. A 32-bar cycle (48 s) that loops for good:
     A   the hook: an original tune over a lament bass, Dm, C, B♭ and A with a flat nine, two bars each
     A′  the hook again, with glockenspiel, turning up to a high A at the end
     B   the breather: half-time drums and a slow ghostly counter-line over Gm, Dm, E♭ (the Neapolitan creep) and A,
         then a snare roll and a riser out of it
     C   the chaos: a pipe organ and a running square-wave toccata over a chromatic line (D, C♯, C, B, B♭, A), four on
         the floor, then a stutter, a dive and dead air before the hook comes back
   Layers come in with `level`:
     0  a ghostly choir, a drone, wind, a music box playing the tune     (title, game over)
     1  + a bouncing bass                                                 (a run starts)
     2  + drums, crashes, fills and risers
     3  + a theremin takes the tune, glockenspiel, sixteenth hats
     4  everything a semitone up, the bass and a square lead under the tune driven, claps, a shaker, the choir
        trembling                                                         (down to your last hearts)
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
/** a line written one token a sixteenth: a note ('Bb4') starts, '.' holds it, '-' rests. Eight bars. */
function line(src: string) {
  const steps = src.trim().split(/\s+/).map(x => x === '.' ? HOLD : x === '-' ? REST : midi(x));
  if (steps.length !== 8 * BAR) throw new Error(`a line is eight bars, not ${steps.length / BAR}`);
  return steps;
}
/** how many sixteenths the note starting at i lasts */
function held(steps: number[], i: number) {
  let n = 1;
  while (steps[i + n] === HOLD) n++;
  return n;
}

const HOOK_HEAD = `
  D5 . . . . . A4 . F5 . . . E5 . D5 .
  C#5 . . . D5 . E5 . A4 . . . . . - -
  C5 . . . . . G4 . E5 . . . D5 . C5 .
  B4 . . . C5 . D5 . G4 . . . . . - -
  D5 . . . F5 . Bb5 . . . . . A5 . G5 .
  F5 . . . D5 . F5 . E5 . . . . . - -`;
/** A: the tune, ending on its way back to D */
const HOOK = line(HOOK_HEAD + `
  G5 . . . F5 . E5 . C#5 . . . Bb4 . C#5 .
  A4 . . . . . . . . . . . C#5 . E5 .`);
/** A′: the tune, ending with a swoop up to the high A */
const HOOK_2 = line(HOOK_HEAD + `
  Bb5 . . . A5 . G5 . F5 . . . E5 . C#5 .
  A4 . . . . . . . A5 . . . . . - -`);
/** B: long, slow notes, for the theremin only */
const GHOST = line(`
  G5 . . . . . . . . . . . F5 . D5 .
  Bb4 . . . . . . . . . . . - - - -
  A4 . . . . . . . D5 . . . . . F5 .
  E5 . . . . . . . . . . . - - - -
  G5 . . . . . . . . . . . F5 . Eb5 .
  D5 . . . . . . . . . . . Bb4 . . .
  C#5 . . . . . . . E5 . . . . . . .
  Bb5 . . . . . . . A5 . . . . . - -`);

/** C: four notes that run under a pedal note sounding every other sixteenth, a bar at a time */
const TOCCATA: [number[], number][] = [
  [[81, 77, 74, 77], 86], [[81, 77, 73, 77], 86], [[81, 77, 72, 77], 86], [[81, 77, 71, 77], 86],
  [[77, 74, 70, 74], 86], [[79, 76, 74, 76], 86], [[79, 76, 73, 76], 85], [[82, 79, 76, 73], 85],
];

interface Chord {
  /** the bass's root */
  root: number;
  /** for the choir, the organ and the arpeggios */
  notes: number[];
}
const Dm: Chord = { root: 38, notes: [57, 62, 65, 69] };
const C: Chord = { root: 36, notes: [55, 60, 64, 67] };
const Bb: Chord = { root: 34, notes: [53, 58, 62, 65] };
const A7: Chord = { root: 33, notes: [55, 61, 64, 69] };
const A7b9: Chord = { root: 33, notes: [55, 61, 64, 70] };
const Gm: Chord = { root: 31, notes: [55, 58, 62, 67] };
const Eb: Chord = { root: 39, notes: [55, 58, 63, 67] };
// section C's line cliché: D minor over a bass falling a semitone a bar
const DmC_: Chord = { root: 37, notes: [57, 61, 65, 69] };
const DmC: Chord = { root: 36, notes: [57, 60, 65, 69] };
const Bo: Chord = { root: 35, notes: [57, 59, 62, 65] };
const Bb11: Chord = { root: 34, notes: [58, 62, 64, 67] };

/** the bass, a bar a token: R root, r a softer root, O its octave, F its fifth, A a step into the next chord's root */
const GROOVE: [string, string] = ['R.Or..R.R.Or.rF.', 'R.Or..R.R.OrF.A.'];
const HALF: [string, string] = ['R.......O..r..F.', 'R.......O..r..A.'];
const DRIVE: [string, string] = ['R.rOR.rOR.rOR.rO', 'R.rOR.rOR.rOR.rO'];

interface Section {
  chords: Chord[];
  /** the theremin's line */
  line?: number[];
  /** the line is the tune, which the music box plays until the theremin comes in */
  hook?: boolean;
  /** the glockenspiel arpeggiates the chords from level 3 (where there's no hook, the music box does before that) */
  bells?: boolean;
  /** the organ and toccata instead of the choir */
  chaos?: boolean;
  /** a chord's first bar, then its second */
  bass: [string, string];
  drums: 'groove' | 'half' | 'four';
  crash?: boolean;
}
const SECTIONS: Section[] = [
  { chords: [Dm, Dm, C, C, Bb, Bb, A7b9, A7b9], line: HOOK, hook: true, bass: GROOVE, drums: 'groove', crash: true },
  { chords: [Dm, Dm, C, C, Bb, Bb, A7b9, A7b9], line: HOOK_2, hook: true, bells: true, bass: GROOVE, drums: 'groove' },
  { chords: [Gm, Gm, Dm, Dm, Eb, Eb, A7, A7b9], line: GHOST, bells: true, bass: HALF, drums: 'half', crash: true },
  { chords: [Dm, DmC_, DmC, Bo, Bb, Bb11, A7, A7b9], chaos: true, bass: DRIVE, drums: 'four', crash: true },
];
/** arpeggio orders over a chord's four notes, by eighth; the cycles take turns */
const ARPS = [[0, 1, 2, 3, 2, 1, 2, 3], [3, 1, 2, 0, 2, 1, 3, 1]];
/** the drone: a low D, a twin beating slowly against it, and the A */
const DRONE = [26, 26.08, 33];
/** organ pipes as harmonics of the 16′ rank: 16′, 8′, 5⅓′, 4′, 2⅔′, 2′ */
const PIPES = [0, .7, 1, .25, .55, 0, .35, 0, .4];

function bassNote(token: string, root: number, next: number) {
  switch (token) {
    case 'O': return root + 12;
    case 'F': return root + 7;
    // chromatic, from below unless that's where the bass already is
    case 'A': return next === root ? root + 7 : next - 1 !== root ? next - 1 : next + 1;
    default: return root;
  }
}

type Bus = 'drums' | 'bass' | 'grit' | 'lead' | 'chip' | 'fuzz' | 'box' | 'bell' | 'choir' | 'organ' | 'drone' | 'air';

interface Theremin { osc: OscillatorNode[]; amp: GainNode; vibrato: GainNode; on: boolean; note: number }

export class Beat {
  level = 0;
  want = 0;
  readonly out: GainNode;
  private noise: AudioBuffer;
  private bus: Record<Bus, GainNode>;
  private verb: ConvolverNode;
  private gate: ConvolverNode;
  private echo: DelayNode;
  private pulse: PeriodicWave;
  private pipes: PeriodicWave;
  /** the drone, the wind and the theremin run for good once started */
  private drone: OscillatorNode[] | null = null;
  private wind: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private theremin: Theremin | null = null;
  private shift = 0;

  constructor(private ctx: BaseAudioContext) {
    const c = ctx;
    this.out = c.createGain();

    this.noise = c.createBuffer(1, Math.round(c.sampleRate * 2.5), c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // a square with a 25% duty, the old consoles' reedy lead
    const n = 48, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      re[i] = Math.sin(2 * Math.PI * i * .25) / (Math.PI * i);
      im[i] = 2 * Math.sin(Math.PI * i * .25) ** 2 / (Math.PI * i);
    }
    this.pulse = c.createPeriodicWave(re, im);
    this.pipes = c.createPeriodicWave(new Float32Array(PIPES.length), Float32Array.from(PIPES));

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

    // a dotted-eighth echo for the tunes and bells
    this.echo = c.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = c.createGain(), tone = c.createBiquadFilter(), wet = c.createGain();
    fb.gain.value = .35; tone.type = 'lowpass'; tone.frequency.value = 3000; wet.gain.value = .3;
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
    /** a bus through a soft clipper, for the last hearts */
    const driven = (gain: number, send: number, drive: number, tone: number) => {
      const into = c.createGain(), shaper = c.createWaveShaper(), lp = c.createBiquadFilter();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 511.5 - 1) * drive) / Math.tanh(drive);
      shaper.curve = curve; shaper.oversample = '2x';
      lp.type = 'lowpass'; lp.frequency.value = tone;
      into.connect(shaper).connect(lp).connect(bus(gain, send));
      return into;
    };
    this.bus = {
      drums: bus(.8, .08), bass: bus(.5, .04), grit: driven(.36, .04, 3, 2400),
      lead: bus(.085, .35, .35), chip: bus(1.2, .2, .25), fuzz: driven(.32, .25, 4, 3200),
      box: bus(.9, .45, .45), bell: bus(.8, .45, .3),
      choir: bus(2.2, .6), organ: bus(.75, .75), drone: bus(.2, .3), air: bus(.16, .5),
    };
    // a slow tremulant on the organ
    const trem = c.createOscillator(), depth = c.createGain();
    trem.frequency.value = 5.5; depth.gain.value = .06;
    trem.connect(depth).connect(this.bus.organ.gain);
    trem.start();
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
    const s = n % BAR, bar = Math.floor(n / BAR), b = bar % 8, cycle = Math.floor(bar / 32);
    if (!this.drone) this.begin(t);
    if (s === 0) this.newBar(t);
    const L = this.level, k = this.shift, si = Math.floor(bar / 8) % 4, sec = SECTIONS[si], chord = sec.chords[b];
    const next = b < 7 ? sec.chords[b + 1] : SECTIONS[(si + 1) % 4].chords[0], at = b * BAR + s;
    // the end of C: a stutter on beat three, then nothing but a swell back into the hook
    const gap = sec.chaos && b === 7;

    if (s === 0) {
      if (sec.chaos) this.organ(t, chord.notes.map(m => m + k), (gap ? 12 : BAR) * STEP, L ? 1 : .6);
      else if (b % 2 === 0) this.choir(t, chord.notes.map(m => m + k), 2 * BAR * STEP, L >= 4);
    }
    if (gap && s >= 12) {
      if (s === 12) this.swell(t, 4 * STEP);
      return;
    }

    // the tune, or the ghost's line
    const note = sec.line?.[at];
    if (note !== undefined && note !== HOLD) {
      if (L >= 3) {
        if (note === REST) this.hush(t);
        else {
          this.sing(t, note + k);
          if (L >= 4 && sec.hook) this.chip(t, note + k - 12, held(sec.line!, at) * STEP - .02, .7, true);
        }
      } else if (sec.hook && note !== REST) this.box(t, note + k + 12, L ? 1 : .75);
    }

    // arpeggios: glockenspiel, or the music box where there's no tune for it
    if (s % 2 === 0 && !sec.chaos) {
      const m = chord.notes[ARPS[cycle % 2][s / 2]] + k;
      if (L >= 3 && sec.bells) this.bell(t, m + 24, sec.hook ? .5 : .8);
      else if (L < 3 && !sec.hook && (L > 0 || s % 4 === 0)) this.box(t, m + 12, L ? .7 : .6);
    }

    if (sec.chaos) {
      const [cell, pedal] = TOCCATA[b];
      if (gap && s >= 8) {
        // the stutter: the run dives in thirty-seconds
        if (L >= 3) for (const half of [0, 1]) this.chip(t + half * STEP / 2, cell[0] + k - (s - 8) * 2 - half, STEP / 2 - .01, .8, L >= 4);
      } else if (L >= 3) this.chip(t, (s % 2 ? pedal : cell[(s >> 1) % 4]) + k, STEP * .85, s % 4 === 0 ? 1 : .7, L >= 4);
      else if (s % 2 === 0) this.box(t, cell[(s >> 1) % 4] + k, .55);
    }

    if (L >= 1) {
      if (gap && s >= 8) { if (s === 8) this.bass(t, chord.root + k + 12, 1, L >= 4, 4 * STEP); }
      else {
        const token = sec.bass[b % 2][s];
        if (token !== '.') this.bass(t, bassNote(token, chord.root, next.root) + k, token === 'R' ? 1 : token === 'r' ? .6 : .8, L >= 4);
      }
    }

    if (L >= 2) this.drums(sec, b, s, t, L, cycle);
  }

  private newBar(t: number) {
    this.level = this.want;
    const k = this.level >= 4 ? 1 : 0, th = this.theremin!;
    if (k !== this.shift) {
      // the dread: everything up a semitone, the drone and a held theremin note sliding with it
      this.drone!.forEach((o, i) => o.frequency.setTargetAtTime(hz(DRONE[i] + k), t, .2));
      if (th.on) {
        th.note += k - this.shift;
        for (const o of th.osc) o.frequency.setTargetAtTime(hz(th.note), t, .05);
      }
      this.shift = k;
    }
    if (this.level < 3) this.hush(t);
    // the wind howls on the title and drops under the band
    this.wind!.gain.gain.setTargetAtTime(this.level ? .3 : 1, t, 1.5);
  }

  private drums(sec: Section, b: number, s: number, t: number, L: number, cycle: number) {
    if (s === 0 && b === 0 && sec.crash) this.crash(t);
    switch (sec.drums) {
      case 'four':
        if (b === 7 && s >= 8) {
          // the stutter: the snare in thirty-seconds, climbing
          for (const half of [0, 1]) this.snare(t + half * STEP / 2, .35 + (s - 8 + half / 2) * .16);
          return;
        }
        if (s % 4 === 0) this.kick(t);
        if (s === 4 || s === 12) this.backbeat(t, L);
        if (s % 4 === 2) this.hat(t, .5, true);
        else if (L >= 3) this.hat(t, s % 2 ? .22 : .38);
        break;
      case 'half':
        if (b === 7) {
          // a roll into C: eighths, then sixteenths, louder all the way
          if (s % 4 === 0) this.kick(t);
          if (s >= 8 || s % 2 === 0) this.snare(t, .3 + .7 * s / 15);
          if (s === 0) this.riser(t, BAR * STEP);
          return;
        }
        if (s === 0 || s === 6 || (b === 6 && s === 12)) this.kick(t);
        if (s === 8) this.backbeat(t, L);
        if (s % 2 === 0) this.hat(t, s % 4 === 0 ? .45 : .3);
        else if (L >= 3) this.hat(t, .15);
        break;
      default:
        if (b === 7 && s >= 12) {
          // a fill to turn the eight bars: toms, or every other time round a run on the snare
          if (cycle % 2 === 0) this.tom(t, [57, 53, 50, 45][s - 12]);
          else this.snare(t, .45 + (s - 12) * .18);
          return;
        }
        if (s === 0 || s === 6 || s === 8 || (b % 2 === 1 && s === 14)) this.kick(t);
        if (s === 4 || s === 12) this.backbeat(t, L);
        if (L >= 3 && b % 2 === 1 && s === 14) this.hat(t, .5, true);
        else if (s % 2 === 0) this.hat(t, s % 4 === 0 ? .55 : .4);
        else if (L >= 3) this.hat(t, .2);
    }
    if (L >= 4 && s % 2 === 1) this.shaker(t, s % 4 === 3 ? 1 : .6);
  }

  private backbeat(t: number, L: number) {
    this.snare(t);
    if (L >= 4) this.clap(t);
  }

  /* ---------- the ones that run for good ---------- */

  private begin(t: number) {
    const c = this.ctx;
    // the drone: three saws through a dark filter
    const lp = c.createBiquadFilter(), gain = c.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 160;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(.2, t + 3);
    lp.connect(gain).connect(this.bus.drone);
    this.drone = DRONE.map(m => {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(m);
      o.connect(lp); o.start(t);
      return o;
    });

    // the wind: noise through a band that wanders, in gusts
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), sweep = c.createOscillator(), sweepDepth = c.createGain();
    src.buffer = this.noise; src.loop = true;
    bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 3;
    sweep.frequency.value = .07; sweepDepth.gain.value = 320;
    sweep.connect(sweepDepth).connect(bp.frequency);
    const gust = c.createOscillator(), gustDepth = c.createGain(), gusts = c.createGain(), wind = c.createGain();
    gust.frequency.value = .043; gustDepth.gain.value = .45; gusts.gain.value = .55;
    gust.connect(gustDepth).connect(gusts.gain);
    wind.gain.setValueAtTime(0, t);
    wind.gain.setTargetAtTime(1, t, 1);
    src.connect(bp).connect(gusts).connect(wind).connect(this.bus.air);
    src.start(t); sweep.start(t); gust.start(t);
    this.wind = { src, gain: wind };

    // the theremin: one voice that glides from note to note, its vibrato blooming as a note holds
    const amp = c.createGain(), tone = c.createBiquadFilter(), lfo = c.createOscillator(), vibrato = c.createGain();
    amp.gain.value = 0;
    tone.type = 'lowpass'; tone.frequency.value = 2600;
    lfo.frequency.value = 5.6; vibrato.gain.value = 0;
    lfo.connect(vibrato);
    const osc = (['sine', 'triangle'] as const).map((type, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = hz(74);
      vibrato.connect(o.detune);
      g.gain.value = i ? .35 : 1;
      o.connect(g).connect(tone);
      o.start(t);
      return o;
    });
    tone.connect(amp).connect(this.bus.lead);
    lfo.start(t);
    this.theremin = { osc, amp, vibrato, on: false, note: 74 };
  }

  private sing(t: number, note: number) {
    const th = this.theremin!, f = hz(note), leap = Math.abs(note - th.note);
    for (const o of th.osc) {
      if (th.on) o.frequency.setTargetAtTime(f, t, leap >= 7 ? .07 : .025);
      // from silence, a little scoop up into the note
      else { o.frequency.setValueAtTime(f * .96, t); o.frequency.setTargetAtTime(f, t, .035); }
    }
    th.vibrato.gain.setTargetAtTime(3, t, .02);
    th.vibrato.gain.setTargetAtTime(30, t + .2, .3);
    if (th.on) {
      // a breath between notes
      th.amp.gain.setTargetAtTime(.6, t, .006);
      th.amp.gain.setTargetAtTime(1, t + .03, .03);
    } else th.amp.gain.setTargetAtTime(1, t, .025);
    th.on = true;
    th.note = note;
  }

  private hush(t: number) {
    const th = this.theremin!;
    if (!th.on) return;
    th.amp.gain.setTargetAtTime(0, t, .07);
    th.on = false;
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

  /** a music box: a bright FM tine ringing out, a little out of tune like an old one */
  private box(t: number, note: number, v: number) {
    const c = this.ctx, f = hz(note), car = c.createOscillator(), mod = c.createOscillator(), idx = c.createGain();
    car.frequency.value = f;
    car.detune.value = (Math.random() - .5) * 16;
    mod.frequency.value = f * 4;
    idx.gain.setValueAtTime(f * 1.2, t);
    idx.gain.setTargetAtTime(0, t, .06);
    mod.connect(idx).connect(car.frequency);
    car.connect(this.env(t, .12 * v, .002, 1.8)).connect(this.bus.box);
    // and the clink: an inharmonic partial that dies fast
    const p = c.createOscillator();
    p.frequency.value = f * 5.4;
    p.connect(this.env(t, .025 * v, .001, .2)).connect(this.bus.box);
    for (const o of [car, mod, p]) { o.start(t); o.stop(t + 2); }
  }

  /** a glockenspiel: FM at an inharmonic ratio, for the metal */
  private bell(t: number, note: number, v: number) {
    const c = this.ctx, f = hz(note), car = c.createOscillator(), mod = c.createOscillator(), idx = c.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.5;
    idx.gain.setValueAtTime(f * 1.8, t);
    idx.gain.setTargetAtTime(0, t, .1);
    mod.connect(idx).connect(car.frequency);
    car.connect(this.env(t, .09 * v, .002, 1.1)).connect(this.bus.bell);
    for (const o of [car, mod]) { o.start(t); o.stop(t + 1.4); }
  }

  /** the square lead: plucked for the toccata, held under the tune at the end */
  private chip(t: number, note: number, dur: number, v: number, fuzz: boolean) {
    const c = this.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.setPeriodicWave(this.pulse);
    o.frequency.value = hz(note);
    lp.type = 'lowpass'; lp.frequency.value = 2600;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.13 * v, t + .003);
    g.gain.setTargetAtTime(.08 * v, t + .003, .04);
    g.gain.setTargetAtTime(0, t + dur, .02);
    o.connect(lp).connect(g).connect(fuzz ? this.bus.fuzz : this.bus.chip);
    o.start(t); o.stop(t + dur + .15);
  }

  /** a saw and a square through a plucked filter, a clean sub under them; `dive` drops it two octaves over that long */
  private bass(t: number, note: number, v: number, grit: boolean, dive = 0) {
    const c = this.ctx, f = hz(note), end = dive ? t + dive * 2 : t + .3, lp = c.createBiquadFilter();
    const g = this.env(t, .5 * v, .004, dive ? dive * 1.5 : .2);
    lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.linearRampToValueAtTime(240 + 1100 * v, t + .012);
    lp.frequency.setTargetAtTime(200, t + .015, .07);
    lp.connect(g).connect(grit ? this.bus.grit : this.bus.bass);
    const pitch = (o: OscillatorNode) => {
      o.frequency.setValueAtTime(f, t);
      if (dive) o.frequency.exponentialRampToValueAtTime(f / 4, t + dive);
    };
    for (const [type, det] of [['sawtooth', -7], ['square', 7]] as const) {
      const o = c.createOscillator();
      o.type = type; o.detune.value = det; pitch(o);
      o.connect(lp);
      o.start(t); o.stop(end);
    }
    const sub = c.createOscillator();
    pitch(sub);
    sub.connect(this.env(t, .38 * v, .004, dive ? dive * 1.5 : .22)).connect(this.bus.bass);
    sub.start(t); sub.stop(end);
  }

  /** a ghostly choir: detuned saws through two vowel formants that open from "oo" to "ah" and close over the chord */
  private choir(t: number, notes: number[], dur: number, tremble: boolean) {
    const c = this.ctx, end = t + dur + 1.3, voices = c.createGain(), g = c.createGain(), vowel = c.createOscillator();
    voices.gain.value = 1 / notes.length;
    vowel.frequency.value = 1 / (2 * dur);
    for (const [lo, swing, q, amp] of [[330, 400, 5, 1], [870, 230, 7, .6]]) {
      const bp = c.createBiquadFilter(), depth = c.createGain(), a = c.createGain();
      bp.type = 'bandpass'; bp.frequency.value = lo; bp.Q.value = q;
      depth.gain.value = swing;
      vowel.connect(depth).connect(bp.frequency);
      a.gain.value = amp;
      voices.connect(bp).connect(a).connect(g);
    }
    const body = c.createBiquadFilter(), bodyGain = c.createGain();
    body.type = 'lowpass'; body.frequency.value = 450; bodyGain.gain.value = .35;
    voices.connect(body).connect(bodyGain).connect(g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.1, t + 1.1);
    g.gain.setValueAtTime(.1, t + dur - .2);
    g.gain.linearRampToValueAtTime(0, t + dur + 1.2);
    let out: AudioNode = g;
    if (tremble) {
      const trem = c.createGain(), tl = c.createOscillator(), td = c.createGain();
      trem.gain.value = .65; tl.frequency.value = 7.5; td.gain.value = .35;
      tl.connect(td).connect(trem.gain);
      tl.start(t); tl.stop(end);
      g.connect(trem);
      out = trem;
    }
    out.connect(this.bus.choir);
    for (const m of notes) for (const det of [-10, 10]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(voices);
      o.start(t); o.stop(end);
    }
    vowel.start(t); vowel.stop(end);
  }

  /** a pipe organ chord, each note one oscillator built from the ranks, held for `dur` */
  private organ(t: number, notes: number[], dur: number, v: number) {
    const c = this.ctx, g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.05 * v, t + .04);
    g.gain.setValueAtTime(.05 * v, t + dur - .03);
    g.gain.linearRampToValueAtTime(0, t + dur + .12);
    g.connect(this.bus.organ);
    for (const m of notes) {
      const o = c.createOscillator();
      // the waveform's fundamental is the 16′ rank, an octave under the note
      o.setPeriodicWave(this.pipes);
      o.frequency.value = hz(m) / 2;
      o.detune.value = (Math.random() - .5) * 6;
      o.connect(g);
      o.start(t); o.stop(t + dur + .2);
    }
  }

  private kick(t: number) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + .13);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + .003);
    g.gain.exponentialRampToValueAtTime(.001, t + .45);
    o.connect(g).connect(this.bus.drums);
    o.start(t); o.stop(t + .5);
    const n = this.noiseHit(t, .02), hp = c.createBiquadFilter(), ng = this.env(t, .3, .001, .015);
    hp.type = 'highpass'; hp.frequency.value = 2000;
    n.connect(hp).connect(ng).connect(this.bus.drums);
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

  /** a cymbal played backwards, out of the silence at the end of C */
  private swell(t: number, dur: number) {
    const c = this.ctx, n = this.noiseHit(t, dur), hp = c.createBiquadFilter(), g = c.createGain();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1500, t);
    hp.frequency.exponentialRampToValueAtTime(5000, t + dur);
    g.gain.setValueAtTime(.001, t);
    g.gain.exponentialRampToValueAtTime(.3, t + dur - .01);
    g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(hp).connect(g).connect(this.bus.drums);
    const s = c.createGain();
    s.gain.value = .4;
    g.connect(s).connect(this.verb);
  }

  stop() {
    for (const o of [...(this.drone ?? []), ...(this.theremin?.osc ?? []), this.wind?.src]) {
      try { o?.stop(); } catch { /* already stopped */ }
    }
    this.drone = null;
    this.theremin = null;
    this.wind = null;
  }
}
