/* Vercel Web Analytics (cookieless): the page view, and a few moments in a run as custom events. Only on the live
   site: the dev server and ?debug sessions send nothing. Page addresses go without their query (?debug, ?dpr ...).
   Custom events show in the dashboard on Vercel's Pro plan; elsewhere they're simply not kept. */
import { inject, track } from '@vercel/analytics';

const on = !import.meta.env.DEV && !new URLSearchParams(location.search).has('debug');
if (on) inject({ mode: 'production', beforeSend: e => ({ ...e, url: e.url.split('?')[0] }) });

/** a moment worth counting, with at most two properties (all a custom event carries on Pro) */
export function count(event: 'Play' | 'Game over' | 'Leaderboard save' | 'Camera failed', props?: Record<string, string>) {
  if (on) track(event, props);
}

/** how long a run lasted, in a few bands */
export const lasted = (s: number) =>
  s < 30 ? 'under 30 s' : s < 60 ? '30 s to 1 min' : s < 120 ? '1 to 2 min' : s < 300 ? '2 to 5 min' : '5 min or more';
