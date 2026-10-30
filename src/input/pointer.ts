/* Drawing with the mouse, a pen or a finger on a touch screen: press, drag, release. The game only ever sees `Pen`,
   and a hand tracked by the camera (input/hand/handpen.ts) drives it the same way. Points are in CSS pixels of the
   stage. */
import type { Pt } from '../config';

export interface Pen {
  /** the stroke being drawn right now, or null */
  readonly live: Pt[] | null;
  /** called with the finished stroke on release */
  onStroke: (pts: Pt[]) => void;
  /** whether a press should start a stroke at all (e.g. only while playing) */
  enabled: () => boolean;
  /** drop a stroke in progress (pausing, game over) */
  reset(): void;
}

export class PointerPen implements Pen {
  live: Pt[] | null = null;
  onStroke: (pts: Pt[]) => void = () => {};
  enabled: () => boolean = () => true;
  private id = -1;

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.up);
  }

  private at(e: PointerEvent): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    if (this.live || !e.isPrimary || e.button > 0 || !this.enabled()) return;
    // let buttons and links in the HUD keep their clicks
    if ((e.target as HTMLElement).closest('button, a, [data-ui]')) return;
    e.preventDefault();
    this.id = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    this.live = [this.at(e)];
  };

  private move = (e: PointerEvent) => {
    if (!this.live || e.pointerId !== this.id) return;
    // every sample since the last frame, not just the latest, so fast flicks keep their corners
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) {
      const p = this.at(ev), last = this.live[this.live.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.5) this.live.push(p);
    }
  };

  private up = (e: PointerEvent) => {
    if (!this.live || e.pointerId !== this.id) return;
    const pts = this.live;
    this.live = null; this.id = -1;
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    // losing capture some other way carries no useful position
    if (e.type === 'pointerup') pts.push(this.at(e));
    this.onStroke(pts);
  };

  private cancel = (e: PointerEvent) => {
    if (e.pointerId !== this.id) return;
    this.live = null; this.id = -1;
  };

  /** drop a stroke in progress (pausing, game over) */
  reset() { this.live = null; this.id = -1; }
}
