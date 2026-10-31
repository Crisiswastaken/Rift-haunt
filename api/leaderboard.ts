// /api/leaderboard on Vercel: the game's leaderboard (the API itself is api/_lib/handler.ts).
//
// Environment variables (Vercel project settings):
//   KV_REST_API_URL, KV_REST_API_TOKEN   set for you when you add Upstash Redis to the project (Vercel → Storage);
//                                        UPSTASH_REDIS_REST_URL / _TOKEN work too
//   LEADERBOARD_SECRET                   optional: signs run tickets (by default one is derived from the Redis token)
//   LEADERBOARD_ADMIN_KEY                optional, 16+ characters: lets DELETE take a name off the board
import { handle } from './_lib/handler.js';
import { upstash } from './_lib/store.js';

const env = (k: string) => String((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k] ?? '').trim();

export default {
  async fetch(request: Request): Promise<Response> {
    const url = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
    const token = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
    if (!url || !token) {
      return new Response(JSON.stringify({ error: "The leaderboard isn't set up yet." }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return handle(request, {
      store: upstash(url, token),
      secret: env('LEADERBOARD_SECRET') || `haunt-leaderboard:${token}`,
      admin: env('LEADERBOARD_ADMIN_KEY'),
    });
  },
};
