import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handle } from './api/_lib/handler';
import { memory, upstash } from './api/_lib/store';

/** dev server only: hands-mode sessions post their camera video and logs here (src/debug/recorder.ts), saved into
    logs/<session>/ for debugging */
function recorder(): Plugin {
  return {
    name: 'haunt-recorder',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__rec', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const u = new URL(req.url ?? '/', 'http://x');
        const session = (u.searchParams.get('s') ?? 'unknown').replace(/[^\w-]/g, '');
        const file = u.pathname === '/video' ? 'camera.webm' : 'log.jsonl';
        const dir = join(process.cwd(), 'logs', session);
        mkdirSync(dir, { recursive: true });
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => { appendFileSync(join(dir, file), Buffer.concat(chunks)); res.end('ok'); });
      });
    },
  };
}

/** dev server only: /api/leaderboard as on Vercel (api/leaderboard.ts), kept in memory unless the Redis variables are
    set (in .env.local, say), so the leaderboard can be tried out locally */
function leaderboard(): Plugin {
  return {
    name: 'haunt-leaderboard',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL, token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
      const deps = { store: url && token ? upstash(url, token) : memory(), secret: env.LEADERBOARD_SECRET || 'dev only', admin: env.LEADERBOARD_ADMIN_KEY };
      server.middlewares.use('/api/leaderboard', (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
          const response = await handle(new Request(`http://${req.headers.host}${req.originalUrl}`, { method: req.method, headers, body }), deps);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        });
      });
    },
  };
}

// Relative base so the build can live under any path on tryrift.fun (e.g. /halloween/).
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: [recorder(), leaderboard()],
});
