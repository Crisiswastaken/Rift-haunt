/* The leaderboard API (api/leaderboard.ts on Vercel; the dev server mounts it too, vite.config.ts).

     GET    ?mode=mouse|hands                    the top ten
     POST   { op: 'start', mode }                a ticket for a run that's starting
     POST   { op: 'save', ticket, name, score, seconds, log }
                                                 put a finished run on the board, under a name
     DELETE ?mode=..&name=..  (Bearer admin key) take a name off the board

   Nothing the game says is taken on trust:
   - A run needs a ticket, signed here when it starts (HMAC, so it can't be made up), good for one save, for its own
     mode only, and only for a few hours. The clock is ours too: a run can't have lasted longer than its ticket.
   - The score is worked out again from the run's log by the game's rules (rules.ts), must come to exactly what was
     claimed, and can't pass what a flawless player could have done in that time.
   - The name is tidied and vetted (name-shape.ts, names.ts); the game only ever shows names as text.
   - Saves are rate-limited per address (kept only as a keyed hash), and only from the game's own pages.
   - Each name keeps its best score per mode, so nobody can fill the board with copies of themselves.
   Turned-away runs are logged (why, not who) so cheating attempts show up in the function logs. */
import { decentName, nameKey } from './names.js';
import { shapeName } from './name-shape.js';
import { MODES, tally, type Mode } from './rules.js';
import type { Cmd, Store } from './store.js';

export interface Deps {
  store: Store;
  /** signs tickets and hashes addresses */
  secret: string;
  /** lets DELETE take names off; empty turns it off */
  admin?: string;
  now?: () => number;
}

export interface Entry { rank: number; name: string; score: number }

const TOP = 10;
const TICKET_HOURS = 4;
/** saves per address: a minute, an hour */
const RATE = { minute: 6, hour: 40 };
const BODY_MAX = 400_000;

const K = {
  board: (m: Mode) => `haunt:board:${m}`,
  names: (m: Mode) => `haunt:names:${m}`,
  used: (id: string) => `haunt:used:${id}`,
  rate: (who: string, span: string) => `haunt:rate:${who}:${span}`,
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const fail = (status: number, error: string) => json(status, { error });
const isMode = (m: unknown): m is Mode => MODES.includes(m as Mode);

/* ---------- signing ---------- */

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();
const hmacKey = (secret: string) => {
  if (!keys.has(secret)) keys.set(secret, crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));
  return keys.get(secret)!;
};
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sign = async (secret: string, text: string) => b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(text)));

/** a ticket: id.mode.issued.signature */
async function issue(secret: string, mode: Mode, now: number) {
  const id = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
  const body = `${id}.${mode}.${now}`;
  return `${body}.${await sign(secret, body)}`;
}

async function redeem(secret: string, ticket: unknown): Promise<{ id: string; mode: Mode; issued: number } | null> {
  if (typeof ticket !== 'string' || ticket.length > 200) return null;
  const parts = ticket.split('.');
  if (parts.length !== 4) return null;
  const [id, mode, issued, sig] = parts;
  if (!/^[0-9a-f]{24}$/.test(id) || !isMode(mode) || !/^\d{13}$/.test(issued)) return null;
  let raw: Uint8Array;
  try { raw = unb64url(sig); } catch { return null; }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), raw, enc.encode(`${id}.${mode}.${issued}`));
  return ok ? { id, mode, issued: Number(issued) } : null;
}

/* ---------- the board ---------- */

async function top(store: Store, mode: Mode): Promise<Entry[]> {
  const [flat] = await store.run([['ZREVRANGE', K.board(mode), 0, TOP - 1, 'WITHSCORES']]) as [string[]];
  return entries(store, mode, flat ?? [], 0);
}

/** [member, score, member, score ...] from rank `from`, with each name as it was typed */
async function entries(store: Store, mode: Mode, flat: string[], from: number): Promise<Entry[]> {
  const members = flat.filter((_, i) => i % 2 === 0);
  if (!members.length) return [];
  const [shown] = await store.run([['HMGET', K.names(mode), ...members]]) as [(string | null)[]];
  return members.map((m, i) => {
    let name = m;
    try { name = (JSON.parse(shown?.[i] ?? 'null') as { n?: string } | null)?.n ?? m; } catch { /* keep the key */ }
    return { rank: from + i + 1, name, score: Number(flat[i * 2 + 1]) };
  });
}

/* ---------- requests ---------- */

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const url = new URL(request.url);
  try {
    if (request.method === 'GET') {
      const mode = url.searchParams.get('mode');
      if (!isMode(mode)) return fail(400, 'Which leaderboard?');
      // the edge keeps a copy for a few seconds: a busy board costs Redis next to nothing
      return json(200, { mode, top: await top(deps.store, mode) }, { 'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=50' });
    }
    if (request.method === 'DELETE') return remove(url, request, deps);
    if (request.method !== 'POST') return fail(405, 'Method not allowed.');

    // only from the game's own pages
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    let sameSite = false;
    try { sameSite = new URL(request.headers.get('origin') ?? '').host === host; } catch { /* no origin */ }
    if (!sameSite) return fail(403, 'Scores can only be saved from the game.');

    const raw = await request.text();
    if (raw.length > BODY_MAX) return fail(413, 'That run is too long to save.');
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { return fail(400, 'Something went wrong. Please try again.'); }
    if (!data || typeof data !== 'object') return fail(400, 'Something went wrong. Please try again.');

    if (data.op === 'start') {
      if (!isMode(data.mode)) return fail(400, 'Which leaderboard?');
      return json(200, { ticket: await issue(deps.secret, data.mode, now) });
    }
    if (data.op === 'save') return save(data, request, deps, now);
    return fail(400, 'Something went wrong. Please try again.');
  } catch (e) {
    console.error('leaderboard', e);
    return fail(503, "The leaderboard can't be reached right now. Please try again in a minute.");
  }
}

async function save(data: Record<string, unknown>, request: Request, deps: Deps, now: number): Promise<Response> {
  const { store, secret } = deps;
  const ticket = await redeem(secret, data.ticket);
  if (!ticket) return fail(400, "This run can't be saved. Play another and try again.");
  if (now - ticket.issued > TICKET_HOURS * 3600e3) return fail(400, 'This run is too old to save now.');

  const shaped = shapeName(data.name);
  if ('error' in shaped) return fail(400, shaped.error);
  const name = shaped.name;
  if (!decentName(name)) return fail(400, "That name isn't allowed. Please pick another.");

  const mode = ticket.mode, score = data.score, seconds = Number(data.seconds);
  if (!Number.isInteger(score) || (score as number) <= 0) return fail(400, 'There is no score to save.');
  // the run can't have lasted longer than its ticket has existed
  let why: string | null = seconds > (now - ticket.issued) / 1000 + 3 ? 'longer than its ticket' : null;
  if (!why) {
    const t = tally(mode, seconds, data.log);
    if (typeof t === 'string') why = t;
    else if (t.score !== score) why = `adds up to ${t.score}, not ${score}`;
  }
  if (why) {
    console.warn('leaderboard: turned away a run', { mode, score, seconds, why });
    return fail(422, "That run didn't add up, so it wasn't saved.");
  }

  // rate limit by address, kept as a keyed hash
  const ip = (request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local').trim();
  const who = (await sign(secret, `ip:${ip}`)).slice(0, 16), minute = Math.floor(now / 60e3), hour = Math.floor(now / 3600e3);
  const [perMinute, , perHour] = await store.run([
    ['INCR', K.rate(who, `m${minute}`)], ['EXPIRE', K.rate(who, `m${minute}`), 70],
    ['INCR', K.rate(who, `h${hour}`)], ['EXPIRE', K.rate(who, `h${hour}`), 3700],
  ]) as number[];
  if (perMinute > RATE.minute || perHour > RATE.hour) return fail(429, 'Easy there. Try again in a minute.');

  // one save per run
  const [fresh] = await store.run([['SET', K.used(ticket.id), '1', 'NX', 'EX', TICKET_HOURS * 3600 + 600]]);
  if (fresh === null) return fail(409, 'This run is already saved.');

  // each name keeps its best; the name is shown as it was last typed with a new best
  const member = nameKey(name), board = K.board(mode);
  const [changed] = await store.run([['ZADD', board, 'GT', 'CH', score as number, member]]) as [number];
  const cmds: Cmd[] = [];
  if (changed) cmds.push(['HSET', K.names(mode), member, JSON.stringify({ n: name, t: now })]);
  cmds.push(['ZREVRANK', board, member], ['ZSCORE', board, member], ['ZREVRANGE', board, 0, TOP - 1, 'WITHSCORES']);
  const out = await store.run(cmds);
  const [rank, best, flat] = out.slice(changed ? 1 : 0) as [number, string, string[]];
  return json(200, { mode, name, improved: !!changed, rank: rank + 1, best: Number(best), top: await entries(store, mode, flat ?? [], 0) });
}

/** take a name off a board: DELETE ?mode=hands&name=... with Authorization: Bearer <LEADERBOARD_ADMIN_KEY> */
async function remove(url: URL, request: Request, deps: Deps): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  if (!deps.admin || deps.admin.length < 16) return fail(404, 'Not found.');
  const given = await sign(deps.secret, auth), wanted = await sign(deps.secret, `Bearer ${deps.admin}`);
  if (given !== wanted) return fail(401, 'Not allowed.');
  const mode = url.searchParams.get('mode'), name = url.searchParams.get('name') ?? '';
  if (!isMode(mode) || !name) return fail(400, 'Give a mode and a name.');
  const member = nameKey(name);
  const [removed] = await deps.store.run([['ZREM', K.board(mode), member], ['HDEL', K.names(mode), member]]) as number[];
  return json(200, { removed: !!removed, mode, name: member });
}
