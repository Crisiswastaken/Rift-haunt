import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HANDS, type Pt, type SymbolId } from '../src/config';
import { HandPen } from '../src/input/hand/handpen';
import { Recognizer } from '../src/input/recognizer';

/* Real footage, replayed: what the body and hand models saw in a recording of a real player doing a script of shapes
   (landmarks only, no pictures), in the order and at the times the results arrived. Run through the pen and the
   recogniser exactly as the game does, the strokes have to read as the script, with nothing cast in between.
   The fixtures are made by recording hands mode with ?debug against the clip (see README). */

interface Fixture {
  clip: string;
  /** the shapes drawn, in order */
  script: SymbolId[];
  /** [kind, t, at, ...]: 'p' body (vw, vh, then x y visibility for each of KEEP, or null), 'h' hand (vw, vh, then x y for
      21 points and x y z in metres for 21, or null) */
  trace: (['p', number, number, number, number, number[] | null] | ['h', number, number, number, number, number[] | null, number[] | null])[];
}

/** the body landmarks the pen uses (nose, ears, shoulders, elbows, wrists) */
const KEEP = [0, 7, 8, 11, 12, 13, 14, 15, 16];
const W = 1600, H = 900;

function replay(f: Fixture) {
  const pen = new HandPen(HANDS, () => ({ W, H })), strokes: Pt[][] = [];
  pen.onStroke = s => strokes.push(s);
  let tick = f.trace[0]?.[2] ?? 0;
  for (const e of f.trace) {
    // the game's frames tick the pen in between the models' results
    while (tick < e[2]) { pen.tick(tick); tick += 1 / 60; }
    if (e[0] === 'p') {
      const [, t, , vw, vh, xs] = e;
      let lm: Float32Array | null = null;
      if (xs) {
        lm = new Float32Array(33 * 4);
        KEEP.forEach((i, k) => { lm![i * 4] = xs[k * 3]; lm![i * 4 + 1] = xs[k * 3 + 1]; lm![i * 4 + 3] = xs[k * 3 + 2]; });
      }
      pen.pose(t, lm, vw, vh);
    } else {
      const [, t, , vw, vh, xy, world] = e;
      let hand = null;
      if (xy && world) {
        const lm = new Float32Array(63);
        for (let i = 0; i < 21; i++) { lm[i * 3] = xy[i * 2]; lm[i * 3 + 1] = xy[i * 2 + 1]; }
        hand = { lm, world: Float32Array.from(world), score: 1 };
      }
      pen.hand(t, hand, vw, vh);
    }
  }
  return strokes;
}

const rec = new Recognizer();
for (const name of ['near', 'far']) {
  const path = new URL(`./fixtures/hands-${name}.json`, import.meta.url);
  describe.skipIf(!existsSync(path))(`real footage: ${name}`, () => {
    it('casts the scripted shapes in order, and nothing else', () => {
      const f: Fixture = JSON.parse(readFileSync(path, 'utf-8'));
      const reads = replay(f).map(s => rec.read(s, Math.max(24, W * .03))?.id ?? null).filter(r => r !== null);
      expect(reads).toEqual(f.script);
    });
  });
}
