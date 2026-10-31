/* Where the leaderboard lives: Redis, spoken to over Upstash's REST API with plain fetch (no client library), or a
   stand-in in memory for the dev server and the tests. Only the handful of commands the leaderboard uses. */

export type Cmd = (string | number)[];
export interface Store {
  /** run commands in order, in one round trip; each gives its result */
  run(cmds: Cmd[]): Promise<unknown[]>;
}

/** Upstash Redis (Vercel's Redis integration sets the same two variables) */
export function upstash(url: string, token: string): Store {
  return {
    async run(cmds) {
      const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds),
      });
      if (!res.ok) throw new Error(`redis ${res.status}`);
      const out = await res.json() as { result?: unknown; error?: string }[];
      return out.map(r => { if (r.error) throw new Error(`redis: ${r.error}`); return r.result; });
    },
  };
}

/** in memory, for the dev server and the tests: sorted sets, hashes and plain keys with expiry */
export function memory(): Store {
  const keys = new Map<string, { v: unknown; until: number }>();
  const get = <T>(k: string, make: () => T): T => {
    const e = keys.get(k);
    if (e && e.until > Date.now()) return e.v as T;
    const v = make();
    keys.set(k, { v, until: Infinity });
    return v;
  };
  const live = (k: string) => { const e = keys.get(k); return !!e && e.until > Date.now(); };
  const zset = (k: string) => get(k, () => new Map<string, number>());
  const desc = (z: Map<string, number>) => [...z].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));

  const one = (c: Cmd): unknown => {
    const [op, k, ...a] = c.map(String);
    switch (op.toUpperCase()) {
      case 'SET': {
        const nx = a.includes('NX'), ex = a.indexOf('EX');
        if (nx && live(k)) return null;
        keys.set(k, { v: a[0], until: ex >= 0 ? Date.now() + Number(a[ex + 1]) * 1000 : Infinity });
        return 'OK';
      }
      case 'INCR': { const n = Number(get(k, () => 0)) + 1; keys.get(k)!.v = n; return n; }
      case 'EXPIRE': { const e = keys.get(k); if (!e) return 0; e.until = Date.now() + Number(a[0]) * 1000; return 1; }
      case 'ZADD': {
        // ZADD key [GT] [CH] score member
        const z = zset(k), gt = a.includes('GT'), ch = a.includes('CH'), [score, member] = a.filter(x => x !== 'GT' && x !== 'CH');
        const was = z.get(member), s = Number(score);
        if (was !== undefined && gt && s <= was) return 0;
        z.set(member, s);
        return was === undefined || (ch && s !== was) ? 1 : 0;
      }
      case 'ZSCORE': { const s = zset(k).get(a[0]); return s === undefined ? null : String(s); }
      case 'ZREVRANK': { const i = desc(zset(k)).findIndex(([m]) => m === a[0]); return i < 0 ? null : i; }
      case 'ZREVRANGE': {
        const list = desc(zset(k)).slice(Number(a[0]), Number(a[1]) + 1);
        return a.includes('WITHSCORES') ? list.flatMap(([m, s]) => [m, String(s)]) : list.map(([m]) => m);
      }
      case 'ZREM': return zset(k).delete(a[0]) ? 1 : 0;
      case 'ZCARD': return zset(k).size;
      case 'HSET': { const h = get(k, () => new Map<string, string>()); h.set(a[0], a[1]); return 1; }
      case 'HMGET': { const h = get(k, () => new Map<string, string>()); return a.map(f => h.get(f) ?? null); }
      case 'HDEL': return get(k, () => new Map<string, string>()).delete(a[0]) ? 1 : 0;
      default: throw new Error(`memory store: no ${op}`);
    }
  };
  return { async run(cmds) { return cmds.map(one); } };
}
