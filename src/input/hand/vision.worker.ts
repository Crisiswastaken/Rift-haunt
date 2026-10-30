/* Runs one MediaPipe model off the main thread, so the game keeps its frame rate while the camera is read. Two of
   these run side by side: the body model (frames come back with the person mask, so the picture of you and its mask
   are always from the same frame) and the hand model (crops of the hand; only the landmarks come back). */
import { HandCore, PoseCore, type HandResult, type PoseResult } from './vision-core';

// the worker's own global (the project's types are the page's, not a worker's)
const scope = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };
let pose: PoseCore | null = null, hand: HandCore | null = null;

// MediaPipe loads its wasm loader with a dynamic import and reads the factory it leaves on the global, then clears
// it after each task it makes. A module only runs once, so the second task would find no factory; this puts it back
// from the module's export every time. (MediaPipe uses `self.import` when there is one, and an import inside
// Function code is also left alone by the dev server, which would otherwise rewrite it into an asset import.)
(self as unknown as { import: (u: string) => Promise<unknown> }).import =
  new Function('u', 'return import(u).then(m => { self.ModuleFactory = m.default; return m; })') as (u: string) => Promise<unknown>;

scope.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      if (m.role === 'pose') { pose = new PoseCore(); await pose.init(m.base, true, m.delegate); }
      else { hand = new HandCore(); await hand.init(m.base, true, m.delegate); }
      scope.postMessage({ type: 'ready', delegate: (pose ?? hand)!.delegate });
    } catch (err) {
      scope.postMessage({ type: 'error', message: String((err as Error)?.stack ?? (err as Error)?.message ?? err) });
    }
  } else if (m.type === 'frame') {
    const bitmap = m.bitmap as ImageBitmap;
    try {
      if (pose) {
        const r: PoseResult = pose.process(bitmap, m.t);
        const transfer: Transferable[] = [bitmap];
        if (r.lm) transfer.push(r.lm.buffer);
        if (r.mask) transfer.push(r.mask.data.buffer);
        scope.postMessage({ type: 'result', t: m.t, sent: m.sent, bitmap, ...r }, transfer);
      } else {
        const r: HandResult = hand!.process(bitmap, m.t);
        bitmap.close();
        scope.postMessage({ type: 'result', t: m.t, sent: m.sent, rect: m.rect, ...r }, r.hand ? [r.hand.lm.buffer, r.hand.world.buffer] : []);
      }
    } catch (err) {
      bitmap.close();
      scope.postMessage({ type: 'fail', message: String((err as Error)?.message ?? err) });
    }
  }
};
