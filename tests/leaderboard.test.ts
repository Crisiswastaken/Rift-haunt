import { describe, expect, it } from 'vitest';
import { handle, RATE } from '../api/_lib/handler';
import { decentName, nameKey, rot13 } from '../api/_lib/names';
import { shapeName } from '../api/_lib/name-shape';
import { cap, EV, tally } from '../api/_lib/rules';
import { memory } from '../api/_lib/store';
import { oracle } from '../tools/oracle';

/** a plain run: `hits` strokes a second apart, each taking one ghost, then five hearts lost and the end */
function run(hits = 10, from = 100) {
  const log: number[][] = [];
  for (let i = 0; i < hits; i++) log.push([from + i * 100, EV.hit, 1, 1]);
  const t = from + hits * 100 + 200;
  for (let i = 0; i < 5; i++) log.push([t + i * 200, EV.hurt]);
  return { log, seconds: (t + 4 * 200 + 100) / 100 };
}

describe('the referee', () => {
  it('scores a run by the game\'s rules', () => {
    // combo x1 for strokes 1-4, x2 for 5-8, x3 for 9-10
    const { log, seconds } = run(10);
    expect(tally('mouse', seconds, log)).toEqual({ score: 10 * (4 + 8 + 6), banished: 10 });
  });

  it('counts multi-kills, bolts, misses, hurts and heart bonuses', () => {
    const log = [
      [100, EV.hit, 3, 3],   // x1: 30 + 2 extra ghosts x 50
      [200, EV.bolt, 6, 3],  // x1: 60
      [300, EV.miss],        // combo broken
      [400, EV.hit, 1, 1],   // x1: 10
      [400, EV.bonus],       // a heart ghost at full hearts: 50
      [600, EV.hurt], [800, EV.hurt], [1000, EV.hurt], [1200, EV.hurt], [1400, EV.hurt],
    ];
    expect(tally('hands', 15, log)).toEqual({ score: 130 + 60 + 10 + 50, banished: 7 });
  });

  it('turns away logs that break the rules', () => {
    const ok = run(4);
    const bad = (log: unknown, seconds = ok.seconds) => tally('mouse', seconds, log);
    expect(bad(ok.log)).not.toBeTypeOf('string');
    expect(bad('nope')).toBe('bad log');
    expect(bad([[1.5, EV.hit, 1, 1], ...ok.log.slice(1)])).toBe('bad event');
    expect(bad([[100, EV.hit, 9, 1], ...ok.log.slice(1)])).toBe('bad event');
    expect(bad([[100, EV.hit, 1, 2], ...ok.log.slice(1)])).toBe('bad event');
    expect(bad([[100, 7], ...ok.log.slice(1)])).toBe('bad event');
    // out of order, two strokes at once, a heart ghost from nowhere
    expect(bad([[300, EV.hit, 1, 1], [200, EV.hit, 1, 1], ...ok.log.slice(2)])).toBe('out of order');
    // two strokes can log at almost the same moment (hit-stop), but not nine in a second
    expect(bad([[100, EV.hit, 1, 1], [101, EV.hit, 1, 1], ...ok.log.slice(2)])).not.toBeTypeOf('string');
    const burst = Array.from({ length: 9 }, (_, i) => [100 + i * 10, EV.miss]);
    expect(bad([...burst, ...ok.log.slice(4)])).toBe('too quick');
    expect(bad([[50, EV.heal], ...ok.log])).toBe('bad event');
    // still had hearts, or carried on after
    expect(bad(ok.log.slice(0, -1))).toBe('not over');
    const lastHurt = ok.log[ok.log.length - 1][0];
    expect(bad([...ok.log, [lastHurt + 100, EV.hit, 1, 1]], (lastHurt + 150) / 100)).not.toBeTypeOf('string');
    expect(bad([...ok.log, [lastHurt + 200, EV.hit, 1, 1]], (lastHurt + 250) / 100)).toBe('played on after the end');
    expect(bad(ok.log, 99999)).toBe('bad length');
  });

  it('turns away more than a flawless player could have done', () => {
    const log: number[][] = [];
    for (let i = 0; i < 60; i++) log.push([100 + i * 10, EV.hit, 5, 5]);
    for (let i = 0; i < 5; i++) log.push([800 + i * 100, EV.hurt]);
    expect(tally('mouse', 13, log)).toBe('too many ghosts');
  });

  it('caps sit above what flawless play reaches', () => {
    for (const mode of ['mouse', 'hands'] as const) for (const patience of [1, 2, 3]) {
      for (const p of oracle(mode, 300, { patience, every: 5 })) {
        const c = cap(mode, p.t);
        expect(p.symbols).toBeLessThanOrEqual(c.symbols);
        expect(p.ghosts).toBeLessThanOrEqual(c.ghosts);
        expect(p.score).toBeLessThanOrEqual(c.score);
      }
    }
  });
});

describe('names', () => {
  it('tidies and shapes them', () => {
    expect(shapeName('  Pumpkin   King ')).toEqual({ name: 'Pumpkin King' });
    expect(shapeName("Zoë O'Neil-Smith")).toEqual({ name: "Zoë O'Neil-Smith" });
    expect(shapeName('line\nbreak')).toEqual({ name: 'line break' });
    for (const bad of ['a', 'x'.repeat(17), '<script>', 'boo\u{1F47B}', '__', `zero${String.fromCharCode(0x200b)}width`, 'nul\u0000l', '']) {
      expect(shapeName(bad)).toHaveProperty('error');
    }
  });

  it('lets innocent names through', () => {
    for (const name of ['Wanda', 'Ada Lovelace', 'Kshitij', 'Gandum', 'Nigeria', 'Cassie', 'Dickens', 'Peacock', 'Hancock',
      'Therapist', 'Assassin', 'Grape', 'Spicy', 'Raccoon', 'Analyst', 'Cumberland', 'Title', 'Matsushita', 'Nazir',
      'Ghost_Buster', 'Pumpkin King', 'Shitake', 'Scott', 'Class Act', 'Torpedo', 'Hello', 'Essex']) {
      expect(decentName(name), name).toBe(true);
    }
  });

  it('catches slurs and profanity however they are written', () => {
    // ROT13'd here too, so this file doesn't read as a list of slurs
    const f = rot13('shpx');
    const bad = [f, f.toUpperCase(), f.split('').join(' '), f.split('').join('.'), f[0] + f[1].repeat(5) + f.slice(2), f.replace('u', '\u00fc'),
      ...['zl nff', 'n f f', 'nffubyr', '5u1g', 'ovgpu', 'ovgpurf', 'avttre', 'avttnn', 'a1tt3e', 'avvvttre', 'snttbg', 'ergneq',
        'qvpx', 'puhgvln', 'znqnepubq', 'nqzva', 'zbqrengbe'].map(rot13), rot13('zbqrengbe').toUpperCase()];
    for (const name of bad) expect(decentName(name), name).toBe(false);
  });

  it('keys names by how they read', () => {
    expect(nameKey('Zoë  Smith')).toBe(nameKey('zoe smith'));
  });
});

describe('the API', () => {
  const origin = 'http://haunt.test';
  const setup = () => {
    let now = Date.UTC(2026, 9, 31, 20);
    const deps = { store: memory(), secret: 'test secret', admin: 'an admin key of some length', origins: ['https://tryrift.fun'], now: () => now };
    const post = (body: object, headers: Record<string, string> = { origin }) =>
      handle(new Request(`${origin}/api/leaderboard`, { method: 'POST', headers: { host: 'haunt.test', ...headers }, body: JSON.stringify(body) }), deps);
    const get = (mode: string) => handle(new Request(`${origin}/api/leaderboard?mode=${mode}`), deps).then(r => r.json());
    const ticket = async (mode = 'mouse') => (await (await post({ op: 'start', mode })).json()).ticket as string;
    return { deps, post, get, ticket, later: (s: number) => { now += s * 1000; } };
  };

  it('saves a run, ranks it and shows it', async () => {
    const { post, get, ticket, later } = setup();
    const t = await ticket('hands'), { log, seconds } = run(10);
    later(seconds + 5);
    const res = await post({ op: 'save', ticket: t, name: 'Pumpkin King', score: 180, seconds, log });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: 'hands', rank: 1, best: 180, improved: true, top: [{ rank: 1, name: 'Pumpkin King', score: 180 }] });
    expect(await get('hands')).toMatchObject({ top: [{ name: 'Pumpkin King', score: 180 }] });
    expect(await get('mouse')).toMatchObject({ top: [] });
  });

  it('takes each ticket once, for its own mode, and only for a real run', async () => {
    const { post, ticket, later } = setup();
    const { log, seconds } = run(10);
    const t = await ticket('mouse');
    // too soon: the run can't have lasted longer than the ticket has existed
    expect((await post({ op: 'save', ticket: t, name: 'Quick', score: 180, seconds, log })).status).toBe(422);
    later(60);
    // the score has to be what the log adds up to
    expect((await post({ op: 'save', ticket: t, name: 'Greedy', score: 999999, seconds, log })).status).toBe(422);
    // the ticket's mode can't be changed, or the ticket made up
    const [id, , issued, sig] = t.split('.');
    expect((await post({ op: 'save', ticket: `${id}.hands.${issued}.${sig}`, name: 'Sneaky', score: 180, seconds, log })).status).toBe(400);
    expect((await post({ op: 'save', ticket: `${id}.mouse.${issued}.AAAA`, name: 'Sneaky', score: 180, seconds, log })).status).toBe(400);
    // a rude name is turned away and the ticket isn't used up
    const rude = await post({ op: 'save', ticket: t, name: rot13('shpx lbh'), score: 180, seconds, log });
    expect(rude.status).toBe(400);
    expect((await rude.json()).error).toMatch(/isn't allowed/);
    expect((await post({ op: 'save', ticket: t, name: 'Fair Play', score: 180, seconds, log })).status).toBe(200);
    expect((await post({ op: 'save', ticket: t, name: 'Fair Play', score: 180, seconds, log })).status).toBe(409);
    // and too old
    const old = await ticket('mouse');
    later(5 * 3600);
    expect((await post({ op: 'save', ticket: old, name: 'Late', score: 180, seconds, log })).status).toBe(400);
  });

  it('only takes saves from the game\'s own pages, and not too many', async () => {
    const { post, ticket, later } = setup();
    const { log, seconds } = run(10);
    const tickets = await Promise.all(Array.from({ length: RATE.minute + 2 }, () => ticket()));
    later(60 - (Date.UTC(2026, 9, 31, 20) / 1000) % 60 + 30);
    expect((await post({ op: 'save', ticket: tickets[0], name: 'Elsewhere', score: 180, seconds, log }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await post({ op: 'start', mode: 'mouse' }, {})).status).toBe(403);
    // a site the game is served through (a rewrite from its path) may save too
    expect((await post({ op: 'save', ticket: tickets[0], name: 'Through RIFT', score: 180, seconds, log }, { origin: 'https://tryrift.fun' })).status).toBe(200);
    const codes = [];
    for (const t of tickets.slice(1)) codes.push((await post({ op: 'save', ticket: t, name: 'Spammer', score: 180, seconds, log }, { origin, 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })).status);
    expect(codes).toEqual([...Array(RATE.minute).fill(200), 429]);
  });

  it('keeps each name\'s best, and the admin can take one off', async () => {
    const { deps, post, get, ticket, later } = setup();
    const a = run(10), b = run(4);
    const t1 = await ticket(), t2 = await ticket(), t3 = await ticket();
    later(60);
    await post({ op: 'save', ticket: t1, name: 'Wisp', score: 180, seconds: a.seconds, log: a.log });
    const lower = await (await post({ op: 'save', ticket: t2, name: 'wisp', score: 40, seconds: b.seconds, log: b.log })).json();
    expect(lower).toMatchObject({ improved: false, best: 180, rank: 1 });
    await post({ op: 'save', ticket: t3, name: 'Boo Radley', score: 40, seconds: b.seconds, log: b.log });
    expect((await get('mouse')).top).toEqual([{ rank: 1, name: 'Wisp', score: 180 }, { rank: 2, name: 'Boo Radley', score: 40 }]);

    const del = (auth: string) => handle(new Request('http://haunt.test/api/leaderboard?mode=mouse&name=WISP', { method: 'DELETE', headers: { authorization: auth } }), deps);
    expect((await del('Bearer wrong')).status).toBe(401);
    expect((await del(`Bearer ${deps.admin}`)).status).toBe(200);
    expect((await get('mouse')).top).toEqual([{ rank: 1, name: 'Boo Radley', score: 40 }]);
  });
});
