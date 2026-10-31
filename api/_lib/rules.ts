/* The leaderboard's referee. A run is sent as a log of what happened, never just a number: this works the score out
   again from that log with the game's own rules, and turns it away if it doesn't add up to what was claimed, or goes
   past what a flawless player could have reached in that time (caps.ts), or breaks the game's rules on the way.
   The game writes the log (src/game/game.ts, `note`); both sides read the events from here. */
import { RULES } from '../../src/config.js';
import { CAPS } from './caps.js';

export type Mode = 'mouse' | 'hands';
export const MODES: readonly Mode[] = ['mouse', 'hands'];

/** an event is [when, what, ...]: when in hundredths of a second of play; for a hit, how many symbols came off and
    how many ghosts went; for a bolt, every symbol it took and every ghost */
export const EV = {
  /** drew a shape no ghost was showing: the combo breaks */
  miss: 0,
  hit: 1,
  /** a ghost reached you: a heart lost, the combo breaks */
  hurt: 2,
  bolt: 3,
  /** a heart ghost caught at full hearts: +50 */
  bonus: 4,
  /** a heart ghost caught: a heart back */
  heal: 5,
} as const;

/** the longest run and log taken */
export const LIMITS = { seconds: 3 * 3600, events: 20000 };

export interface Tally { score: number; banished: number }

const at = (series: number[], seconds: number) => {
  const i = seconds / CAPS.every, n = series.length - 1;
  if (i <= n) return series[Math.min(n, Math.ceil(i))];
  // past the table: on at the last stretch's rate, and then some
  const rate = (series[n] - series[n - 20]) / 20;
  return series[n] + Math.ceil((i - n) * rate * 1.5);
};

/** the most anyone could have had by `seconds` into a run */
export function cap(mode: Mode, seconds: number) {
  const c = CAPS[mode];
  return { symbols: at(c.symbols, seconds), ghosts: at(c.ghosts, seconds), score: at(c.score, seconds) };
}

/** the score and ghosts banished a log adds up to, or why it can't be right */
export function tally(mode: Mode, seconds: number, log: unknown): Tally | string {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > LIMITS.seconds) return 'bad length';
  if (!Array.isArray(log) || !log.length || log.length > LIMITS.events) return 'bad log';
  const end = Math.round(seconds * 100);
  let score = 0, banished = 0, symbols = 0, chain = 0, hearts = RULES.hearts, hearty = 0;
  let prev = 0, lastHit = -1e9, lastHurt = -1e9, lastHeal = -1e9;
  /** the times of the last few strokes */
  const strokes: number[] = [];

  for (const e of log) {
    if (!Array.isArray(e) || e.length < 2 || e.length > 4 || !e.every(v => Number.isInteger(v) && v >= 0 && v <= 1e7)) return 'bad event';
    const [t, kind, a = 0, b = 0] = e as number[];
    if (t < prev || t > end + 50) return 'out of order';
    prev = t;
    // the run goes on for most of a second after the last heart, and no longer
    if (hearts <= 0 && t - lastHurt > 150) return 'played on after the end';

    if (kind === EV.miss || kind === EV.hit || kind === EV.bolt) {
      // nobody draws more than 8 shapes in a second (two can log at almost the same time: the run's clock stops for a
      // moment of hit-stop after each banish)
      strokes.push(t);
      if (strokes.length > 8 && t - strokes.shift()! < 100) return 'too quick';
    }
    switch (kind) {
      case EV.miss:
        if (e.length !== 2) return 'bad event';
        chain = 0;
        break;
      case EV.hit:
      case EV.bolt: {
        // a stroke takes one symbol off each ghost showing it, and there are only so many ghosts out at once
        const ok = kind === EV.hit ? a >= 1 && a <= 8 && b <= a : b >= 1 && b <= 10 && a >= b && a <= b * 5;
        if (e.length !== 4 || !ok) return 'bad event';
        chain++;
        const mult = Math.min(RULES.maxMult, 1 + Math.floor((chain - 1) / RULES.comboStep));
        score += a * RULES.points * mult;
        if (kind === EV.hit && b > 1) score += RULES.multiKill * (b - 1) * mult;
        symbols += a; banished += b; lastHit = t;
        const c = cap(mode, t / 100);
        if (symbols > c.symbols || banished > c.ghosts) return 'too many ghosts';
        break;
      }
      case EV.hurt:
        // a second's grace after each heart lost (less on the run's clock, which stops for hit-stop)
        if (e.length !== 2 || t - lastHurt < 60) return 'bad event';
        hearts--; chain = 0; lastHurt = t;
        break;
      case EV.bonus:
      case EV.heal:
        // only by banishing a heart ghost (a bolt's can land most of a second after it), and they're few and far between
        if (e.length !== 2 || t - lastHit > 120) return 'bad event';
        if (++hearty > t / 1000 + 2) return 'too many hearts';
        if (kind === EV.bonus) score += 50;
        else { hearts = Math.min(RULES.hearts, hearts + 1); lastHeal = t; }
        break;
      default:
        return 'bad event';
    }
  }
  // a run ends when the last heart goes (a heart on its way back as it did never lands), a moment after
  if (!(hearts === 0 || (hearts === 1 && end - lastHeal < 300))) return 'not over';
  if (end - lastHurt > 300) return 'not over';
  if (score > cap(mode, seconds).score) return 'too high';
  return { score, banished };
}
