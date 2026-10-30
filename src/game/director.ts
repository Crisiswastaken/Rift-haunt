/* What spawns, when and where. No set waves: everything is a dice roll around a difficulty D that rises with time
   (not with how fast you clear), levels off, then creeps.
   - The wait to the next ghost is random around a mean that shortens with D, with the odd quiet spell.
   - A spawn sometimes brings one or two more a moment later (now and then mirrored, or sharing a front symbol so
     one stroke can take them all).
   - Rows, speed and how many may be out at once all grow with D, up to fixed caps.
   - The storm ghost (its bolt clears the screen) and the big one are chance draws with cooldowns; heart ghosts float
     across while you're missing a heart.
   Like the doodle, ghosts fade in just inside the left or right edge or the top corners, never near you. */
import { GHOST, PACE, RULES, type Pt, type SymbolId } from '../config';
import { Ghost, type GhostOpts, type World } from './ghost';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
/** past D = 1 (the late creep) this carries on the same way, a little */
const lerp = (r: [number, number], d: number) => r[0] + (r[1] - r[0]) * d;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** how the input changes the pace: air drawing is slower than a mouse */
export interface PaceMods { speed: number; gap: number; maxAlive: number }
export const MOUSE: PaceMods = { speed: 1, gap: 1, maxAlive: 0 };

interface Pending { at: number; queue: SymbolId[]; o: GhostOpts }

export class Director {
  mods: PaceMods = MOUSE;
  private next = 0;
  private pending: Pending[] = [];
  private nextHeart = Infinity;
  private lastStorm = -Infinity;
  private lastBig = -Infinity;

  /** difficulty at t seconds into a run */
  static level(t: number) {
    const D = 1 - Math.exp(-t / PACE.ramp), creep = Math.max(0, t - PACE.ramp) / 60 * PACE.creep;
    return Math.min(PACE.maxD, D + creep);
  }

  reset(mods: PaceMods = this.mods) {
    this.mods = mods;
    this.next = .8;
    this.pending = [];
    this.nextHeart = Infinity;
    this.lastStorm = this.lastBig = -Infinity;
  }

  /** t: seconds into the run; hearts: how many you have left */
  update(w: World, t: number, hearts: number) {
    const D = Director.level(t), live = w.ghosts.filter(g => g.live);
    this.hearts(w, t, hearts, live);

    let crowd = live.filter(g => g.kind !== 'heart').length;
    const max = Math.max(1, Math.min(PACE.maxAlive[1], Math.round(lerp(PACE.maxAlive, D))) + this.mods.maxAlive);

    // companions of an earlier spawn, a moment behind it
    while (this.pending.length && t >= this.pending[0].at && crowd < max) {
      const p = this.pending.shift()!;
      this.add(w, p.queue, p.o, D);
      crowd++;
    }

    if (t < this.next || crowd >= max) return;
    const mean = lerp(PACE.gap, D) * this.mods.gap;
    this.next = t + clamp(-Math.log(1 - Math.random()) * mean, mean * .5, mean * 2.5);
    if (Math.random() < PACE.lull.chance) this.next += rnd(...PACE.lull.seconds);

    // the specials, by chance
    if (t >= PACE.storm.from && t - this.lastStorm > PACE.storm.cooldown && crowd >= PACE.storm.crowd && Math.random() < PACE.storm.chance) {
      this.lastStorm = t;
      this.add(w, D > .6 && Math.random() < .5 ? [pick(this.pool(t)), 'bolt'] : ['bolt'], { kind: 'storm', at: this.spot(w) }, D);
      return;
    }
    if (t >= PACE.big.from && t - this.lastBig > PACE.big.cooldown && crowd <= max - 2 && Math.random() < PACE.big.chance) {
      this.lastBig = t;
      const m = w.U * .1, n = Math.round(rnd(PACE.big.symbols[0], PACE.big.symbols[1] + .49));
      this.add(w, Array.from({ length: n }, () => pick(this.pool(t))), {
        kind: 'big', scale: PACE.big.scale, at: { x: Math.random() < .5 ? m : w.W - m, y: w.H * rnd(.4, .5) },
      }, D);
      this.next += mean;
      return;
    }

    const first = this.queue(t, D), at = this.spot(w);
    this.add(w, first, { at }, D);
    crowd++;

    // sometimes it brings company
    if (Math.random() < lerp(PACE.burst, D)) {
      const n = Math.random() < .35 ? 2 : 1, share = Math.random() < PACE.shareFront, mirror = Math.random() < .4;
      for (let i = 0; i < n; i++) {
        const q = this.queue(t, D);
        if (share) q[0] = first[0];
        const o: GhostOpts = { at: mirror && i === 0 ? { x: w.W - at.x, y: at.y } : this.spot(w) };
        this.pending.push({ at: t + rnd(.4, .9) * (i + 1), queue: q, o });
      }
      this.pending.sort((a, b) => a.at - b.at);
    }
  }

  private add(w: World, queue: SymbolId[], o: GhostOpts, D: number) {
    const g = new Ghost(queue, w, o);
    // quicker with difficulty, a little slower for a long row, slower in hands mode
    g.pace *= lerp(PACE.speed, D) * this.mods.speed / (1 + GHOST.perSymbolSlow * (queue.length - 1));
    w.ghosts.push(g);
    return g;
  }

  /** the shapes in play by now */
  private pool(t: number): SymbolId[] {
    return PACE.unlock.filter(([, at]) => t >= at).map(([id]) => id);
  }

  private queue(t: number, D: number): SymbolId[] {
    const longest = Math.round(lerp(PACE.longest, D));
    const len = clamp(Math.round(lerp(PACE.symbols, D) + rnd(-.8, .8)), 1, longest);
    const pool = this.pool(t);
    // a shape that has just come in turns up more for a little while, so you get to practise it
    const fresh = PACE.unlock.find(([, at]) => at > 0 && t >= at && t < at + 20)?.[0];
    return Array.from({ length: len }, (_, i) => fresh && i === 0 && Math.random() < .5 ? fresh : pick(pool));
  }

  /** just inside the left or right edge or the top corners, as far from the ghosts already out as we can manage */
  private spot(w: World): Pt {
    const m = w.U * .07;
    const any = (): Pt => {
      const r = Math.random();
      // the top comes in from the corners, not the middle (that's right above your head); low enough that the
      // symbol row fits above the ghost, and above the front gravestones and grass that would hide a far-off one
      if (r < .25) return { x: w.W * (Math.random() < .5 ? rnd(.08, .2) : rnd(.8, .92)), y: w.H * .28 };
      return { x: r < .62 ? m : w.W - m, y: rnd(.28, .58) * w.H };
    };
    let best = any(), far = -1;
    for (let i = 0; i < 6; i++) {
      const p = i ? any() : best;
      const d = Math.min(Infinity, ...w.ghosts.filter(g => g.live).map(g => Math.hypot(g.x - p.x, g.y - p.y)));
      if (d > far) { far = d; best = p; }
    }
    return best;
  }

  /** heart ghosts: only while you're missing one, and never two at once */
  private hearts(w: World, t: number, hearts: number, live: Ghost[]) {
    const every = () => rnd(...(hearts <= 2 ? RULES.heartEveryLow : RULES.heartEvery));
    if (hearts >= RULES.hearts) { this.nextHeart = Infinity; return; }
    if (this.nextHeart === Infinity) this.nextHeart = t + every();
    if (t < this.nextHeart || live.some(g => g.kind === 'heart')) return;
    this.nextHeart = t + every();
    // it floats along the top, edge to edge; catch it before it's gone
    const left = Math.random() < .5, at = { x: left ? w.U * .06 : w.W - w.U * .06, y: w.H * rnd(.3, .42) };
    const g = new Ghost(['heart'], w, { kind: 'heart', scale: .85, at, home: { ...at }, depth: .7 });
    g.drift = left ? .06 : -.06;
    w.ghosts.push(g);
  }
}
