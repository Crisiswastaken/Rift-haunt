import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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

// Relative base so the build can live under any path on tryrift.fun (e.g. /halloween/).
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
  plugins: [recorder()],
});
