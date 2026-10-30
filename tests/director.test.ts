import { describe, expect, it } from 'vitest';
import { GHOST, PACE } from '../src/config';
import { Director, MOUSE, type PaceMods } from '../src/game/director';
import type { World } from '../src/game/ghost';

const HANDS: PaceMods = { speed: PACE.hands.speed, gap: PACE.hands.gap, maxAlive: PACE.hands.maxAlive };

/** ten minutes of a run, with a player who knocks a symbol off the nearest ghost every `every` seconds */
function run(mods: PaceMods, every: number, seconds = 600) {
  const w: World = { W: 1600, H: 900, U: 1600, tx: 800, ty: 414, t: 0, dt: 1 / 30, speed: 1, ghosts: [] };
  const d = new Director();
  d.reset(mods);
  const seen = new Set<object>(), spawns: { t: number; kind: string; pace: number; d: number }[] = [];
  let maxOut = 0, nextCast = every;
  for (let t = 0; t < seconds; t += w.dt) {
    w.t = t;
    d.update(w, t, 5);
    for (const g of w.ghosts) {
      if (seen.has(g)) continue;
      seen.add(g);
      spawns.push({ t, kind: g.kind, pace: g.pace, d: Math.hypot(g.x - w.tx, g.y - w.ty) });
    }
    if (t >= nextCast) {
      nextCast = t + every;
      const near = w.ghosts.filter(g => g.live && g.slots.length).sort((a, b) => Math.hypot(a.x - w.tx, a.y - w.ty) - Math.hypot(b.x - w.tx, b.y - w.ty))[0];
      if (near) { near.slots.shift(); if (!near.slots.length) near.banish(w); }
    }
    for (let i = w.ghosts.length - 1; i >= 0; i--) if (w.ghosts[i].update(w) === 'remove') w.ghosts.splice(i, 1);
    maxOut = Math.max(maxOut, w.ghosts.filter(g => g.live && g.kind !== 'heart').length);
  }
  return { spawns, maxOut };
}

describe('director', { timeout: 60000 }, () => {
  it('never has more than 5 ghosts out with the mouse, or 4 with hands', () => {
    expect(run(MOUSE, 1.2).maxOut).toBeLessThanOrEqual(5);
    expect(run(MOUSE, 99).maxOut).toBeLessThanOrEqual(5);
    expect(run(HANDS, 99).maxOut).toBeLessThanOrEqual(4);
  });

  it('caps the speed, and hands mode is slower', () => {
    const top = (PACE.speed[0] + (PACE.speed[1] - PACE.speed[0]) * PACE.maxD) * 1.12;
    expect(Math.max(...run(MOUSE, 1.2).spawns.map(s => s.pace))).toBeLessThanOrEqual(top + 1e-9);
    expect(Math.max(...run(HANDS, 1.2).spawns.map(s => s.pace))).toBeLessThanOrEqual(top * PACE.hands.speed + 1e-9);
  });

  it('spaces ghosts at random, not like clockwork', () => {
    const t = run(MOUSE, .5, 300).spawns.filter(s => s.kind === 'plain').map(s => s.t);
    const gaps = t.slice(1).map((x, i) => x - t[i]).filter(g => g > .05);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    expect(sd / mean).toBeGreaterThan(.4);
  });

  it('keeps the storm and big ghosts apart by their cooldowns', () => {
    for (let k = 0; k < 4; k++) {
      const { spawns } = run(MOUSE, 1);
      for (const [kind, cool] of [['storm', PACE.storm.cooldown], ['big', PACE.big.cooldown]] as const) {
        const ts = spawns.filter(s => s.kind === kind).map(s => s.t);
        for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(cool);
      }
    }
  });

  it('never spawns a ghost anywhere near you', () => {
    const { spawns } = run(MOUSE, 1.2);
    for (const s of spawns) expect(s.d).toBeGreaterThan(GHOST.reach * 1600 * 2);
  });
});
