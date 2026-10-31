/* A flawless player against the real director, for the leaderboard's ceilings (api/_lib/caps.ts): it strokes every
   `gap` seconds, as soon as a symbol has shown for the game's .15 s, always the shape on the most ghosts, banishing
   everything the moment it can. That keeps the crowd down, so the director spawns as fast as it ever will. With
   `patience` it waits until a shape is on that many ghosts (unless one is getting close), for the multi-kill bonus,
   which scores more than rushing. No hearts are ever lost, so no heart ghosts come: the caps allow for those apart. */
import { Director, MOUSE } from '../src/game/director';
import type { World } from '../src/game/ghost';
import { PACE, RULES, type SymbolId } from '../src/config';

export type Mode = 'mouse' | 'hands';
export interface Point { t: number; symbols: number; ghosts: number; score: number }

/** play `seconds` of a run; a point every `every` seconds of how much has been knocked off, banished and scored */
export function oracle(mode: Mode, seconds: number, { gap = .12, patience = 1, every = 15 } = {}): Point[] {
  const w: World = { W: 1600, H: 900, U: 1600, tx: 800, ty: 414, t: 0, dt: 0, speed: 1, ghosts: [] };
  const director = new Director();
  director.reset(mode === 'hands' ? { speed: PACE.hands.speed, gap: PACE.hands.gap, maxAlive: PACE.hands.maxAlive } : MOUSE);
  const dt = 1 / 60, out: Point[] = [];
  let symbols = 0, ghosts = 0, score = 0, chain = 0, last = -9, next = 0;
  for (let i = 0; i * dt <= seconds; i++) {
    const t = i * dt;
    w.dt = dt; w.t += dt;
    director.update(w, t, RULES.hearts);
    for (let j = w.ghosts.length - 1; j >= 0; j--) if (w.ghosts[j].update(w) === 'remove') w.ghosts.splice(j, 1);
    if (t >= next) { out.push({ t: Math.round(t), symbols, ghosts, score }); next += every; }

    const live = w.ghosts.filter(g => g.live && g.front && w.t - g.born > .15);
    if (!live.length || t - last < gap) continue;
    const on = new Map<SymbolId, number>();
    for (const g of live) on.set(g.front!, (on.get(g.front!) ?? 0) + 1);
    const ready = on.has('bolt') || Math.max(...on.values()) >= patience || live.some(g => g.progress(w) > .6);
    if (!ready) continue;
    last = t;
    chain++;
    const mult = Math.min(RULES.maxMult, 1 + Math.floor((chain - 1) / RULES.comboStep));
    if (on.has('bolt')) {
      for (const g of live) { symbols += g.slots.length; score += g.slots.length * RULES.points * mult; ghosts++; g.banish(w); }
      continue;
    }
    const id = [...on].sort((a, b) => b[1] - a[1])[0][0];
    let kills = 0;
    for (const g of live) {
      if (g.front !== id) continue;
      g.slots.shift(); symbols++; score += RULES.points * mult;
      if (!g.slots.length) { kills++; ghosts++; g.banish(w); }
    }
    if (kills > 1) score += RULES.multiKill * (kills - 1) * mult;
  }
  return out;
}

/** the most any of `runs` flawless runs per strategy reached by each point in time */
export function ceiling(mode: Mode, seconds: number, runs: number, every = 15): Point[] {
  const best: Point[] = [];
  for (const patience of [1, 2, 3]) for (let r = 0; r < runs; r++) {
    oracle(mode, seconds, { patience, every }).forEach((p, i) => {
      const b = best[i] ??= { t: p.t, symbols: 0, ghosts: 0, score: 0 };
      b.symbols = Math.max(b.symbols, p.symbols); b.ghosts = Math.max(b.ghosts, p.ghosts); b.score = Math.max(b.score, p.score);
    });
  }
  return best;
}
