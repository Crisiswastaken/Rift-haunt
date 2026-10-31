/* The DOM over the canvas: hearts, score, combo, the Ready / Set / Draw cues, the screens, and in hands mode the
   firefly at your fingertip, which presses a menu button when you hold it there. */
import { RULES } from '../config';

export type Screen = 'loading' | 'title' | 'camera' | 'pause' | 'over' | 'board';
export interface RunStats { score: number; banished: number; seconds: number; best: number; isBest: boolean }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ASSETS = `${import.meta.env.BASE_URL}assets/`;
/** a phone or tablet: no mouse, so "mouse" mode is played by touch */
export const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches;

export class Hud {
  private hearts = $('hearts');
  private score = $<HTMLOutputElement>('score');
  private combo = $('combo');
  private comboN = $('combo-n');
  private cueBox = $('cue');
  private hint = $('hint');
  private dark = Object.assign(document.createElement('p'), { className: 'light-hint', hidden: true });
  private shown = 0;
  private hand = $('hand-cursor');
  private held: { el: HTMLElement; t: number } | null = null;

  constructor(private stage: HTMLElement) {
    for (const img of document.querySelectorAll<HTMLImageElement>('img[data-src]')) img.src = ASSETS + img.dataset.src;
    stage.append(this.dark);
    this.dark.setAttribute('aria-live', 'polite');
    if (TOUCH) for (const el of document.querySelectorAll<HTMLElement>('[data-touch]')) el.textContent = el.dataset.touch!;
    this.hearts.innerHTML = Array.from({ length: RULES.hearts }, () => `<img src="${ASSETS}hud/heart.webp" alt="" draggable="false">`).join('');
  }

  on(action: string, fn: () => void) {
    for (const b of document.querySelectorAll<HTMLElement>(`[data-action="${action}"]`)) b.addEventListener('click', fn);
  }

  /** which screen is up (or none), and the stage's state for styling */
  show(screen: Screen | null, state: string) {
    for (const s of ['loading', 'title', 'camera', 'pause', 'over', 'board'] as Screen[]) $(s).hidden = s !== screen;
    this.stage.dataset.state = state;
  }

  progress(q: number) { $('bar').style.width = `${Math.round(q * 100)}%`; }

  setHearts(n: number) {
    const imgs = [...this.hearts.children] as HTMLElement[];
    imgs.forEach((im, i) => {
      const was = !im.classList.contains('lost'), now = i < n;
      im.classList.toggle('lost', !now);
      if (was !== now && this.shown) {
        im.classList.remove('pop', 'drop');
        void im.offsetWidth;
        im.classList.add(now ? 'pop' : 'drop');
      }
    });
    this.hearts.setAttribute('aria-label', `${n} of ${RULES.hearts} hearts`);
    this.shown = 1;
  }

  /** the centre and size of heart slot i, in stage pixels: where a won-back heart flies to */
  heartSlot(i: number) {
    const el = this.hearts.children[Math.min(i, RULES.hearts - 1)] as HTMLElement, r = el.getBoundingClientRect();
    const s = this.stage.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, size: r.width };
  }

  setScore(n: number, bump = false) {
    this.score.value = n.toLocaleString('en-US');
    if (bump) {
      this.score.classList.remove('bump');
      void this.score.offsetWidth;
      this.score.classList.add('bump');
    }
  }

  /** the combo badge: how many strokes in a row have hit something */
  setCombo(n: number) {
    const on = n >= 2;
    if (on) {
      this.comboN.textContent = String(n);
      this.combo.classList.remove('bump');
      void this.combo.offsetWidth;
      this.combo.classList.add('bump');
    }
    this.combo.classList.toggle('on', on);
  }

  /** a pill sliding in from the left, like the doodle's Ready / Set / Draw; `small` for a lesser cue */
  cue(text: string, small = false) {
    for (const old of this.cueBox.children) old.classList.add('out');
    const el = document.createElement('div');
    el.className = small ? 'pill small' : 'pill';
    el.textContent = text;
    this.cueBox.append(el);
    setTimeout(() => el.classList.add('out'), 900);
    setTimeout(() => el.remove(), 1400);
  }

  /** a short line of help under the cues */
  coach(text: string | null) {
    this.hint.textContent = text ?? '';
    this.hint.classList.toggle('on', !!text);
  }

  /** the low-light warning (Hands.lowLight()), or null to hide it */
  light(text: string | null) {
    if (this.dark.textContent !== (text ?? '')) this.dark.textContent = text ?? '';
    this.dark.hidden = !text;
  }

  setBest(best: number) {
    $('title-best').textContent = best.toLocaleString('en-US');
    $('best-line').hidden = best <= 0;
  }

  over(s: RunStats) {
    $('over-score').textContent = s.score.toLocaleString('en-US');
    $('over-banished').textContent = String(s.banished);
    $('over-time').textContent = `${Math.floor(s.seconds / 60)}:${String(Math.floor(s.seconds % 60)).padStart(2, '0')}`;
    $('over-best').textContent = s.best.toLocaleString('en-US');
    $('over-new').hidden = !s.isBest;
  }

  setMuted(muted: boolean) {
    const b = document.querySelector<HTMLButtonElement>('[data-action="mute"]')!;
    b.classList.toggle('off', muted);
    b.setAttribute('aria-label', muted ? 'Turn the music on' : 'Turn the music off');
    b.setAttribute('aria-pressed', String(muted));
  }

  /** mouse or hands: the title marks the last one used (once there's been a last time), and the switch links offer
      the other */
  setInput(input: 'mouse' | 'hands', played = true) {
    for (const b of document.querySelectorAll<HTMLElement>('[data-action="play-hands"], [data-action="play-mouse"]')) {
      b.classList.toggle('last', played && b.dataset.action === `play-${input}`);
    }
    for (const b of document.querySelectorAll<HTMLElement>('[data-action="switch"]')) {
      b.textContent = input === 'hands' ? (TOUCH ? 'Switch to touch' : 'Switch to the mouse') : 'Switch to your hands';
    }
  }

  /** the camera screen: what it's doing, or why it couldn't */
  cameraStatus(text: string) {
    $('camera-text').textContent = text;
    $('camera-busy').hidden = false;
    $('camera-fail').hidden = true;
  }

  cameraError(text: string) {
    $('camera-text').textContent = text;
    $('camera-busy').hidden = true;
    $('camera-fail').hidden = false;
  }

  /** paused by you, or because you walked out of the camera's view */
  pauseReason(why: 'you' | 'away') {
    $('pause-title').textContent = why === 'away' ? 'Where did you go?' : 'Paused';
    $('pause-sub').hidden = why !== 'away';
  }

  skip(show: boolean) { $('skip').hidden = !show; }

  /** the hand-tracking debug panel (D in hands mode) */
  debugging = false;
  debug(on: boolean) { this.debugging = on; $('hand-debug').hidden = !on; }
  debugText(s: string) { const el = $('hand-debug'); if (el.textContent !== s) el.textContent = s; }

  /** the firefly at your hand: dim and small while the pen is up (aiming), bright and glowing while it's down (`drawing`) */
  cursor(visible: boolean, x: number, y: number, lit: boolean, drawing: boolean) {
    const c = this.hand;
    c.classList.toggle('on', visible);
    c.classList.toggle('point', lit);
    c.classList.toggle('draw', drawing);
    // `translate`, not `transform`: the CSS `scale` that sizes it would otherwise scale its position too
    if (visible) c.style.translate = `${x}px ${y}px`;
  }

  /** hold the fingertip on a menu button for `hold` seconds to press it; a ring fills as you do */
  dwell(at: { x: number; y: number } | null, dt: number, hold: number) {
    let el: HTMLElement | null = null;
    if (at) {
      const r = this.stage.getBoundingClientRect(), hit = document.elementFromPoint(r.left + at.x, r.top + at.y);
      el = (hit as HTMLElement | null)?.closest<HTMLElement>('button[data-action]:not([hidden])') ?? null;
    }
    if (this.held && this.held.el !== el) { this.held.el.style.removeProperty('--dwell'); this.held.el.classList.remove('dwell'); this.held = null; }
    if (!el) return;
    this.held ??= { el, t: 0 };
    this.held.t += dt;
    const q = Math.min(1, this.held.t / hold);
    el.classList.add('dwell');
    el.style.setProperty('--dwell', String(q));
    if (q >= 1) {
      el.classList.remove('dwell');
      el.style.removeProperty('--dwell');
      this.held = null;
      el.click();
    }
  }

  shake() {
    this.stage.classList.remove('shake');
    void this.stage.offsetWidth;
    this.stage.classList.add('shake');
  }
}
