import { describe, expect, it } from 'vitest';
import { SYMBOLS, type Pt, type SymbolId } from '../src/config';
import { Recognizer } from '../src/input/recognizer';
import { drawn, drawnStyle, rng, scribble, sloppy } from './strokes';

const ids = Object.keys(SYMBOLS) as SymbolId[];

function rate(rec: Recognizer, id: SymbolId, make: () => Pt[], n = 200, wanted?: Set<SymbolId>) {
  let ok = 0;
  const wrong: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const got = rec.read(make(), 20, wanted)?.id ?? 'none';
    if (got === id) ok++; else wrong[got] = (wrong[got] ?? 0) + 1;
  }
  return { rate: ok / n, report: `${(ok / n * 100).toFixed(1)}% ${JSON.stringify(wrong)}` };
}

describe('recognizer', { timeout: 60000 }, () => {
  const rec = new Recognizer();

  it('reads each clean glyph as itself', () => {
    for (const id of ids) expect(rec.read(SYMBOLS[id].glyph.map(p => ({ x: p.x * 3, y: p.y * 3 })), 20)?.id).toBe(id);
  });

  it.each(ids)('reads a sloppy %s at least 97% of the time', id => {
    const r = rng(42 + ids.indexOf(id));
    const { rate: k, report } = rate(rec, id, () => drawn(id, r));
    expect(k, report).toBeGreaterThanOrEqual(.97);
  });

  it.each(ids)('reads the everyday ways of drawing %s (U for V, Z for bolt, open loops) at least 93% of the time', id => {
    const r = rng(9 + ids.indexOf(id));
    const { rate: k, report } = rate(rec, id, () => drawnStyle(id, r, .045, .015));
    expect(k, report).toBeGreaterThanOrEqual(.93);
  });

  it.each(ids)('still reads a very sloppy %s most of the time', id => {
    const r = rng(3 + ids.indexOf(id));
    const { rate: k, report } = rate(rec, id, () => drawn(id, r, .06, .025));
    expect(k, report).toBeGreaterThanOrEqual(.88);
  });

  it('never reads a level line as a line down or an upright one as a line across, whatever is on screen', () => {
    const r = rng(11);
    const onlyPillar = new Set<SymbolId>(['pillar']), onlyDash = new Set<SymbolId>(['dash']);
    for (let i = 0; i < 300; i++) {
      const flat = sloppy([{ x: 10, y: 50 }, { x: 90, y: 50 }], false, r, .03, .012, 28);
      const tall = sloppy([{ x: 50, y: 10 }, { x: 50, y: 90 }], false, r, .03, .012, 28);
      expect(rec.read(flat, 20, onlyPillar)?.id).not.toBe('pillar');
      expect(rec.read(tall, 20, onlyDash)?.id).not.toBe('dash');
      expect(rec.read(flat, 20)?.id).toBe('dash');
      expect(rec.read(tall, 20)?.id).toBe('pillar');
    }
  });

  it('never takes a V for a roof, even with only roofs on screen', () => {
    const r = rng(5);
    for (let i = 0; i < 200; i++) expect(rec.read(drawn('fang', r), 20, new Set(['roof']))?.id).not.toBe('roof');
  });

  it('never takes a roof for a V, even with only Vs on screen', () => {
    const r = rng(6);
    for (let i = 0; i < 200; i++) expect(rec.read(drawn('roof', r), 20, new Set(['fang']))?.id).not.toBe('fang');
  });

  it('never takes a line for a shape, whatever is on screen', () => {
    const r = rng(8);
    for (let i = 0; i < 200; i++) expect(rec.read(drawn('dash', r), 20, new Set(['moon', 'fang']))?.id).toBe('dash');
  });

  it('gives a close call to the shape on screen', () => {
    const r = rng(21);
    const { rate: k, report } = rate(rec, 'bolt', () => drawnStyle('bolt', r, .06, .025), 200, new Set(['bolt']));
    expect(k, report).toBeGreaterThanOrEqual(.92);
  });

  it('reads a line down with the hand coming back up over it as a line down', () => {
    const r = rng(31), wanted = new Set<SymbolId>(['pillar', 'fang']);
    let ok = 0;
    for (let i = 0; i < 100; i++) {
      const s = sloppy([{ x: 50, y: 10 }, { x: 50, y: 90 }, { x: 53, y: 40 }], false, r, .02, .01, 6);
      if (rec.read(s, 20, wanted)?.id === 'pillar') ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(95);
  });

  it('reads a V with a hook at its end as a V when a V is on screen', () => {
    const r = rng(32), wanted = new Set<SymbolId>(['fang']);
    let ok = 0;
    for (let i = 0; i < 100; i++) {
      const s = sloppy([{ x: 20, y: 20 }, { x: 50, y: 80 }, { x: 80, y: 20 }, { x: 66, y: 30 }], false, r, .02, .01, 6);
      if (rec.read(s, 20, wanted)?.id === 'fang') ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(90);
  });

  it('reads a diagonal as no line at all', () => {
    expect(rec.read([{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 90, y: 90 }], 20, new Set(['pillar']))).toBeNull();
  });

  it('ignores taps and tiny strokes', () => {
    expect(rec.read([{ x: 10, y: 10 }, { x: 12, y: 11 }, { x: 13, y: 12 }], 20)).toBeNull();
  });

  it('rejects most random scribbles', () => {
    const r = rng(7);
    let cast = 0;
    for (let i = 0; i < 200; i++) if (rec.read(scribble(r), 20)) cast++;
    expect(cast / 200).toBeLessThan(.25);
  });
});
