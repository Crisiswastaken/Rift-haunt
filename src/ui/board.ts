/* The leaderboard in the game: a ticket when a run starts, the save form on the game-over screen, and the board
   itself (the top ten for mouse & touch, or for hands), all through /api/leaderboard (api/_lib/handler.ts). Names
   only ever go onto the page as text. */
import { NAME, shapeName } from '../../api/_lib/name-shape';
import type { Mode } from '../../api/_lib/rules';

export interface Entry { rank: number; name: string; score: number }
/** a finished run, ready to save: what the server needs to check it */
export interface Run { ticket: Promise<string | null>; mode: Mode; score: number; seconds: number; log: number[][] }
interface Saved { name: string; rank: number; best: number; improved: boolean; top: Entry[] }

export const MODE_NAME: Record<Mode, string> = { mouse: 'Mouse & touch', hands: 'Hands' };
/** relative, so it works wherever the game is served from (or set VITE_LEADERBOARD_URL at build time) */
const API = (import.meta.env.VITE_LEADERBOARD_URL as string | undefined) || 'api/leaderboard';
const NAME_KEY = 'haunt.name';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');

function remember(value?: string) {
  try {
    if (value !== undefined) localStorage.setItem(NAME_KEY, value);
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch { return ''; }
}

const UNREACHABLE = "The leaderboard can't be reached right now.";

async function call<T>(method: 'GET' | 'POST', query = '', body?: object): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + query, {
      method, body: body && JSON.stringify(body),
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch { throw new Error(UNREACHABLE); }
  const out = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? UNREACHABLE);
  return out;
}

export class Board {
  /** saving is off where the game can be poked at from the console (?debug) */
  readonly enabled = !new URLSearchParams(location.search).has('debug');
  private mode: Mode = 'mouse';
  /** the name you last saved under, picked out on the board */
  private mine = remember();
  private run: Run | null = null;
  private asked = 0;
  /** the board as a save just left it, so it shows at once (the server's copy can be a few seconds behind) */
  private fresh: { mode: Mode; top: Entry[]; at: number } | null = null;
  private form = $<HTMLFormElement>('save');
  private input = $<HTMLInputElement>('save-name');
  private msg = $('save-msg');
  private go = $<HTMLButtonElement>('save-go');

  constructor() {
    this.input.maxLength = NAME.max;
    this.form.addEventListener('submit', e => { e.preventDefault(); void this.save(); });
    this.input.addEventListener('input', () => { if (this.msg.dataset.kind === 'error') this.say(''); });
    for (const m of ['mouse', 'hands'] as Mode[]) $(`tab-${m}`).addEventListener('click', () => void this.show(m));
    // the arrow keys move between the tabs
    document.querySelector('#board .tabs')!.addEventListener('keydown', e => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
      const m: Mode = this.mode === 'mouse' ? 'hands' : 'mouse';
      void this.show(m);
      $(`tab-${m}`).focus();
    });
  }

  /** a run is starting: ask for its ticket now, so it's there by the end */
  ticket(mode: Mode): Promise<string | null> {
    if (!this.enabled) return Promise.resolve(null);
    return call<{ ticket: string }>('POST', '', { op: 'start', mode }).then(r => r.ticket, () => null);
  }

  /** the game-over screen: offer to save the run, if it scored and there's a ticket for it */
  async offer(run: Run | null) {
    const ask = ++this.asked;
    this.run = null;
    this.form.hidden = true;
    $('saved').hidden = true;
    this.say('');
    if (!run || run.score <= 0) return;
    const ticket = await run.ticket;
    if (ask !== this.asked || !ticket) return;
    this.run = run;
    $('save-mode').textContent = MODE_NAME[run.mode];
    this.input.value = this.mine;
    this.go.disabled = false;
    this.form.hidden = false;
  }

  private async save() {
    const run = this.run;
    if (!run || this.go.disabled) return;
    const shaped = shapeName(this.input.value);
    if ('error' in shaped) { this.say(shaped.error, 'error'); this.input.focus(); return; }
    this.go.disabled = true;
    this.say('Saving…');
    try {
      const ticket = await run.ticket;
      const r = await call<Saved>('POST', '', { op: 'save', ticket, name: shaped.name, score: run.score, seconds: run.seconds, log: run.log });
      this.mine = remember(r.name);
      this.run = null;
      this.form.hidden = true;
      const where = `#${fmt(r.rank)} on the ${MODE_NAME[run.mode]} board`;
      $('saved-text').textContent = r.improved ? `Saved! You're ${where}.` : `Your best of ${fmt(r.best)} stays: ${where}.`;
      $('saved').hidden = false;
      this.fresh = { mode: run.mode, top: r.top, at: Date.now() };
    } catch (e) {
      this.go.disabled = false;
      this.say(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  private say(text: string, kind: 'error' | 'info' = 'info') {
    this.msg.textContent = text;
    this.msg.dataset.kind = text ? kind : '';
  }

  /** the board screen, on one mode's tab */
  async show(mode: Mode = this.mode) {
    this.mode = mode;
    for (const m of ['mouse', 'hands'] as Mode[]) {
      const tab = $(`tab-${m}`);
      tab.setAttribute('aria-selected', String(m === mode));
      tab.tabIndex = m === mode ? 0 : -1;
    }
    $('board-list').setAttribute('aria-labelledby', `tab-${mode}`);
    const fresh = this.fresh?.mode === mode && Date.now() - this.fresh.at < 20e3 ? this.fresh.top : null;
    if (fresh) { this.render(fresh); return; }
    this.note('Fetching the scores…');
    this.render([]);
    try {
      const { top } = await call<{ top: Entry[] }>('GET', `?mode=${mode}`);
      if (this.mode !== mode) return;
      this.render(top);
      this.note(top.length ? '' : 'No scores yet. Yours could be the first.');
    } catch (e) {
      if (this.mode !== mode) return;
      this.note(e instanceof Error ? e.message : String(e));
    }
  }

  private note(text: string) {
    const n = $('board-note');
    n.textContent = text;
    n.hidden = !text;
  }

  private render(top: Entry[]) {
    const list = $('board-list');
    list.replaceChildren(...top.map(e => {
      const li = document.createElement('li');
      li.className = 'row';
      if (e.rank <= 3) li.dataset.medal = String(e.rank);
      if (this.mine && e.name.toLowerCase() === this.mine.toLowerCase()) li.classList.add('you');
      const rank = document.createElement('span'), who = document.createElement('span'), pts = document.createElement('span');
      rank.className = 'rank'; who.className = 'who'; pts.className = 'pts';
      rank.textContent = String(e.rank);
      who.textContent = e.name;
      pts.textContent = fmt(e.score);
      li.append(rank, who, pts);
      return li;
    }));
    if (top.length) this.note('');
  }
}
