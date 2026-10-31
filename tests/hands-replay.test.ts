// @ts-ignore no @types/node in this browser project; vitest runs this in node
import { readFileSync } from 'node:fs';
// @ts-ignore no @types/node in this browser project; vitest runs this in node
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HANDS, type Pt, type SymbolId } from '../src/config';
import { HandPen } from '../src/input/hand/handpen';
import { Recognizer } from '../src/input/recognizer';
import { Player } from "../src/render/player";

/* Real play, replayed: two hands-mode sessions (logs/2026-10-31T05-38-54 = A, 05-42-17 = B), the body and hand model
   results at the times they arrived, plus mode changes, through the real pen and recogniser as the game runs them.
   Labels are the shape the player meant per stroke of the original replay (time spans in log seconds). Fixtures are
   built by tests/fixtures/make.mjs. */

type Win = [number, number];
interface Fixture {
  session: string;
  screen: [number, number];
  trace: (['m', number, string] | ['p', number, number, number, number, number[] | null] |
    ['h', number, number, number, number, number[] | null, number[] | null])[];
  /** the game's logged strokes: [at, shapes on screen] */
  logged: [number, SymbolId[]][];
  /** [label, from, to]: a shape id, 'half:<id>:<group>' (one piece of a shape the old pen split), 'junk', '?', 'skip' */
  labels: [string, number, number][];
  fist: Win[]; flick: Win[]; drop: Win[];
}

interface Stroke { a: number; b: number; mode: string; read: SymbolId | null; cast: boolean }

const load = (k: string): Fixture => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/hands-${k}.json.gz`, import.meta.url))).toString());

function replay(f: Fixture): Stroke[] {
  const [W, H] = f.screen, minSize = Math.max(24, Math.min(W, H * 16 / 9) * .03), rec = new Recognizer();
  const pen = new HandPen(HANDS, () => ({ W, H })), out: Stroke[] = [];
  // the pen sits on your fingertip in the picture of you, as in the game
  const pl = new Player(null as never, pen.body); pl.iw = 640; pl.ih = 360; pen.view = pl.toScreen;
  let mode = 'title', now = 0, from = 0, live: Pt[] | null = null;
  pen.enabled = () => mode === 'play' || mode === 'ready' || mode === 'practice';
  // a stroke spans from the moment the pen went down to its lift
  const track = () => { if (pen.live !== live) { live = pen.live; from = now; } };
  pen.onStroke = pts => {
    const lg = f.logged.reduce((p, l) => Math.abs(l[0] - now) < Math.abs(p[0] - now) ? l : p);
    const wanted = new Set(Math.abs(lg[0] - now) < 1.5 ? lg[1] : []);
    const read = rec.read(pts, minSize, wanted)?.id ?? null;
    // only shapes on screen count (a read of anything else is dropped, combo kept); ready mode never casts
    out.push({ a: live ? from : now, b: now, mode, read, cast: (mode === 'play' || mode === 'practice') && !!read && wanted.has(read) });
  };
  let tick = -1;
  for (const e of f.trace) {
    if (e[0] === 'm') { mode = e[2]; continue; }
    if (tick < 0) tick = e[1];
    // the game's frames tick the pen in between the models' results
    while (tick < e[1]) { now = tick; pen.tick(tick); pl.frame(W, H, 1 / 60); track(); tick += 1 / 60; }
    now = e[1];
    if (e[0] === 'p') pen.pose(e[2], e[5] ? Float32Array.from(e[5]) : null, e[3], e[4]);
    else pen.hand(e[2], e[5] && e[6] ? { lm: Float32Array.from(e[5]), world: Float32Array.from(e[6]), score: 1 } as never : null, e[3], e[4], e[1]);
    track();
  }
  return out;
}

const over = (s: { a: number; b: number }, w: Win) => s.a <= w[1] && s.b >= w[0];

/** the labelled shapes: whole ones, and the pieces of one split shape merged back into one window */
function shapes(f: Fixture) {
  const m = new Map<string, { id: SymbolId; w: Win }>();
  f.labels.forEach(([l, a, b], i) => {
    const p = l.split(':');
    if (p[0] === 'half') { const s = m.get(p[2]); if (s) s.w = [Math.min(s.w[0], a), Math.max(s.w[1], b)]; else m.set(p[2], { id: p[1] as SymbolId, w: [a, b] }); }
    else if (!['junk', '?', 'skip'].includes(l)) m.set(`#${i}`, { id: l as SymbolId, w: [a, b] });
  });
  // a fist window is meant to cast nothing, so it isn't a shape to hit
  return [...m.values()].filter(s => !f.fist.some(w => over({ a: s.w[0], b: s.w[1] }, w)));
}

for (const k of ['A', 'B']) {
  describe(`real play, session ${k}`, () => {
    const f = load(k), strokes = replay(f), casts = strokes.filter(s => s.cast), sh = shapes(f);
    const hit = sh.filter(s => casts.some(c => over(c, s.w) && c.read === s.id));
    const accidental = casts.filter(c => !sh.some(s => over(c, s.w) && c.read === s.id));
    const lines = strokes.filter(c => (c.read === 'bolt' || c.read === 'fang') && sh.some(s => s.id === 'pillar' && over(c, s.w)));
    const split = sh.filter(s => (s.id === 'fang' || s.id === 'roof') && casts.filter(c => over(c, s.w)).length > 1);
    const fistCasts = f.fist.map(w => casts.filter(c => over(c, w)).length);
    const flicks = f.flick.map(w => strokes.filter(c => over(c, w)).length);
    const drops = f.drop.map(w => casts.filter(c => over(c, w)).length);
    console.log(`session ${k} (${f.session})`);
    console.table({ strokes: strokes.length, casts: casts.length, shapes: sh.length, hits: hit.length, misses: sh.length - hit.length,
      'hit %': Math.round(100 * hit.length / sh.length), accidental: accidental.length, 'line->bolt/V': lines.length, 'V/roof split': split.length,
      'fist casts': fistCasts.join(' '), 'flick strokes': flicks.join(' '), 'arm-drop casts': drops.join(' ') });
    console.log('  misses:', sh.filter(s => !hit.includes(s)).map(s => `${s.id}@${s.w[0].toFixed(1)}`).join(' '));
    console.log('  accidental:', accidental.map(c => `${c.read}@${c.a.toFixed(1)}`).join(' '));

    it('casts nothing while the hand is a fist', () => expect(fistCasts.every(n => n === 0), `per window ${fistCasts}`).toBe(true));
    it('draws a stroke in each finger-flick window', () => expect(flicks.every(n => n > 0), `per window ${flicks}`).toBe(true));
    it('never splits a V or roof into two casts', () => expect(split.map(s => `${s.id}@${s.w[0].toFixed(1)}`)).toEqual([]));
    it('never reads a line-down as a bolt or V', () => expect(lines.map(c => `${c.read}@${c.a.toFixed(1)}`)).toEqual([]));
    it('reads at least 90% of the shapes as drawn', () => expect(hit.length / sh.length).toBeGreaterThanOrEqual(.9));
    it('casts nothing when the arm drops out of frame', () => expect(drops.every(n => n === 0), `per window ${drops}`).toBe(true));
  });
}
