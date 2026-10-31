/* Everything the game is tuned by: the symbols, the ghost, the pacing, hand tracking and the scoring. */

export type SymbolId = 'dash' | 'pillar' | 'fang' | 'roof' | 'moon' | 'bolt' | 'heart';
export type Pt = { x: number; y: number };

const P = (pts: number[][]): Pt[] => pts.map(([x, y]) => ({ x, y }));

/** a loop around the 100x100 box, starting at the top */
function ring(n = 48): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: 50 + Math.cos(a) * 34, y: 50 + Math.sin(a) * 34 };
  });
}

/** the classic heart curve, from the dip at the top round and back */
function heartCurve(n = 64): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return { x: 50 + x * 2.55, y: 50 + (-y - 2.5) * 2.55 };
  });
}

/**
 * The shapes. `glyph` is the shape in a 100x100 box (y down): the recogniser's reference. `color` is the felt
 * symbol's colour, used for your stroke and the score when you cast it. The art is public/assets/symbols/<id>.webp.
 */
export const SYMBOLS: Record<SymbolId, { name: string; color: string; glyph: Pt[] }> = {
  dash: { name: 'Line across', color: '#ff6f8e', glyph: P([[16, 50], [84, 50]]) },
  pillar: { name: 'Line down', color: '#6c9dff', glyph: P([[50, 16], [50, 84]]) },
  fang: { name: 'V', color: '#ff9440', glyph: P([[20, 22], [50, 80], [80, 22]]) },
  roof: { name: 'Roof', color: '#93d64e', glyph: P([[20, 78], [50, 20], [80, 78]]) },
  moon: { name: 'Circle', color: '#c2b0ff', glyph: ring() },
  bolt: { name: 'Bolt', color: '#ffd94a', glyph: P([[64, 10], [32, 52], [66, 48], [36, 90]]) },
  heart: { name: 'Heart', color: '#ff5468', glyph: heartCurve() },
};

export const GHOST = {
  /** body width as a fraction of the 16:9 frame width; each extra symbol makes it a little bigger */
  size: .088,
  perSymbol: .1,
  /** approach speed in frame widths per second, before the difficulty's speed-up */
  speed: .05,
  /** each symbol past the first slows a ghost by this much, so a long row is a fair fight */
  perSymbolSlow: .1,
  /** how close (frame widths, centre to you) counts as reaching you */
  reach: .085,
  /** a hit's shove away from you, in frame widths per second */
  knockback: .04,
};

/** where the ghosts are heading: the waist-up player's head and chest, as a fraction of the screen */
export const TARGET = { x: .5, y: .46 };

/**
 * How the ghosts come: at random, never in set waves. Difficulty D rises with time (not with how fast you clear),
 * D = 1 - exp(-t / ramp), levels off, then creeps up slowly so a run does end, up to `maxD`.
 * Pairs are [at D = 0, at D = 1].
 */
export const PACE = {
  /** seconds for D to get most of the way up */
  ramp: 110,
  /** after that, D keeps creeping by this much a minute, up to maxD */
  creep: .1,
  maxD: 1.4,
  /** the average wait between spawns; each one is random around it (from half to two and a half times) */
  gap: [3.4, 2.3] as [number, number],
  /** now and then a quiet spell of this long */
  lull: { chance: .1, seconds: [3, 5] as [number, number] },
  /** most ghosts out at once (heart ghosts aside) */
  maxAlive: [2, 5] as [number, number],
  /** approach speed multiplier */
  speed: [1, 1.25] as [number, number],
  /** the average row length, and the longest a plain ghost can carry */
  symbols: [1.1, 2] as [number, number],
  longest: [2, 4] as [number, number],
  /** a spawn sometimes brings one or two more with it, a moment apart */
  burst: [0, .2] as [number, number],
  /** a burst sometimes shares its front symbol, so one stroke can take several */
  shareFront: .4,
  /** when each shape joins (seconds into the run) */
  unlock: [['dash', 0], ['pillar', 0], ['fang', 15], ['roof', 15], ['moon', 60]] as [SymbolId, number][],
  /** the storm ghost (its bolt clears the screen): a chance per spawn, from `from` s, `cooldown` s apart, with a crowd */
  storm: { from: 60, chance: .05, cooldown: 35, crowd: 3 },
  /** the big one */
  big: { from: 100, chance: .03, cooldown: 80, scale: 1.5, symbols: [4, 5] as [number, number] },
  /** air drawing is slower than a mouse: hands mode gets slower ghosts, longer gaps and one fewer out at once */
  hands: { speed: .8, gap: 1.3, maxAlive: -1 },
};

export const RULES = {
  hearts: 5,
  /** seconds of grace after losing a heart, so a clump costs one heart, not three */
  grace: 1,
  /** heart ghosts, only while you are missing a heart; sooner when you're down to one or two */
  heartEvery: [22, 32] as [number, number],
  heartEveryLow: [11, 16] as [number, number],
  /** points per symbol knocked off, times the combo multiplier */
  points: 10,
  /** each extra ghost banished by the same stroke */
  multiKill: 50,
  /** combo multiplier: one more for every `comboStep` strokes in a row that hit, up to `maxMult` */
  comboStep: 4,
  maxMult: 5,
};

/**
 * Hand tracking: aim with a slow hand, draw with a quick swipe.
 * The body model finds you, your shoulders and which hand is up; the hand model reads a close crop of that hand. Your
 * hand moves in a box anchored to your shoulders that maps to the whole screen, smoothed by a filter, all after
 * RIFT-Desktop's Fruit Ninja slicer (tuned there on recordings of real players). Times are in seconds; S is your
 * shoulder width in camera pixels; screen distances are fractions of the screen.
 */
export const HANDS = {
  /** where each model runs (GPU or CPU; ?hand=GPU tries it). The hand model on the GPU falls back to the CPU if it
      won't start. On whole 640x360 frames (M2, no game running) the GPU took 9 ms against 18-29 ms with the same
      landmarks; on 256 crops under game load it found the hand in 33% of frames against 84%. CPU until the GPU is
      checked under game load with the D panel */
  delegates: { pose: 'CPU', hand: 'CPU' } as { pose: 'GPU' | 'CPU'; hand: 'GPU' | 'CPU' },
  pose: {
    /** pointing: the index at least this straight and this much straighter than the middle and ring fingers;
        [to start, to carry on] */
    // measured on a real player: pointing reads index .93-.98 with the middle and ring .4-.68 (a margin of .25-.5); an
    // open hand has a negative margin, two fingers out about none
    index: [.85, .7] as [number, number],
    margin: [.2, .08] as [number, number],
    open: .8,
    /** a fist: the index at most [0] straight and the middle and ring at most [1] (thumb and little finger ignored) */
    curled: [.65, .7] as [number, number],
  },
  body: {
    vis: .3, wristLo: .15, palm: .35,
    /** the box your hand moves in: S wide and tall (tuned so a seated player's fingertip spans ~80% of the screen on
        both logs), centred this far under the shoulder line; it maps to a little more
        than the screen so the edges are easy to reach */
    box: { w: 2.2, h: 1.42, dy: .1, fit: .95, overX: .06, overTop: .06, overBottom: .08 },
    anchorTau: .1, sizeWindow: 3,
    raiseMargin: .5, switchTime: .2, raised: -.3, holdTime: .5,
    restY: .85, restBack: .7, below: .12, edge: .03, reach: 1.3,
    earS: 2.75,
  },
  smooth: {
    minCutoff: .5, beta: 16, vFloor: .6, perpCutoff: 2.5, perpBeta: .5,
    trackCutoff: 6, trackBeta: 20, velWindow: .05,
    moveDisp: .06, moveV: 1, stillDisp: .04, stillV: .5, dispWindow: .15,
    deadzone: .01,
    lead: .025, leadV0: .4, leadV1: .8, leadMax: .04, leadTau: .06,
    jump0: .1, jumpK: 3, agree: 4, jumpGap: 1.6,
  },
  /** point and move to draw, fist (or open hand) to move without drawing. Pen down: pointing for `point` [frames, s]
      and the fingertip faster than `downV` (from where it was `preroll` s before). Pen up: fist or open for `end`
      [frames, s], trimmed back to the first of them, or slower than `upV` for `up` s (tuned on the two replays).
      Speeds are screens a second (fractions of each screen axis) */
  point: [2, .05] as [number, number],
  end: [3, .1] as [number, number],
  downV: .35,
  upV: .2,
  up: .12,
  preroll: .1,
  /** a stroke shorter than [s, samples] isn't cast; still points within `trim` of the screen at each end are cut */
  minStroke: [.1, 4] as [number, number],
  trim: .02,
  /** no hand at all: the stroke coasts this long, then waits; hand lost `lost` s (or leaving the picture) drops it
      uncast; the cursor hides after `hide`. In a dim room the hand model misses runs of 7-9 frames (~.4 s at 18/s),
      which a stroke should survive */
  coast: .07, lost: .5, hide: .6,
  /** the longest stroke; after it the pen lifts until the hand slows down */
  maxStroke: 4,
  palmS: 5,
  /** the hand model's palm has to be within this many S of the drawing arm's palm */
  match: .8,
  crop: { hand: 2.2, arm: 1.4, min: 96 },
  freeze: .5,
  /** hover the cursor on a button this long to press it (menus only, never during play) */
  dwell: 1.1,
  /** out of view this long during a run pauses it; back this long resumes */
  away: 2.5,
  back: 1,
};
