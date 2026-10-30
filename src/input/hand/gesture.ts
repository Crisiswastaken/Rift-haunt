/* What a hand is doing, from MediaPipe's 21 hand landmarks in world coordinates (metres, centred on the hand). Those
   are true 3D, so a finger pointed at the camera still reads as straight, where flat image coordinates would see it
   foreshortened into a fist.
   A finger's straightness is the distance from its knuckle to its tip over the length along its joints: about 1
   when straight, well under when curled. Pointing is read by how much straighter the index is than the middle and
   ring fingers, not by fixed cut-offs for each, and it has to be clearly so to start and only somewhat so to carry on:
   a loosely curled middle finger or a noisy frame doesn't flicker the pen. */

export type Pose = 'point' | 'open' | 'fist' | 'other';

/** knuckle, middle joint, top joint, tip, for index, middle, ring, little finger */
const FINGERS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

function dist(w: ArrayLike<number>, a: number, b: number) {
  return Math.hypot(w[a * 3] - w[b * 3], w[a * 3 + 1] - w[b * 3 + 1], w[a * 3 + 2] - w[b * 3 + 2]);
}

/** 0..1 for each finger (index, middle, ring, little) */
export function straightness(world: ArrayLike<number>): number[] {
  return FINGERS.map(([m, p, d, t]) => {
    const along = dist(world, m, p) + dist(world, p, d) + dist(world, d, t);
    return along > 0 ? dist(world, m, t) / along : 0;
  });
}

export interface PoseOpts {
  /** pointing: the index at least this straight, and this much straighter than the straighter of middle and ring;
      [to start, to carry on] */
  index: [number, number];
  margin: [number, number];
  /** open: index, middle and ring all at least this straight; a fist: all four at most `curled` */
  open: number;
  curled: number;
}

/** the hand's pose; `was`: its pose last frame (pointing is easier to keep than to start) */
export function pose(world: ArrayLike<number>, o: PoseOpts, was: Pose = 'other'): Pose {
  const [index, middle, ring, little] = straightness(world);
  const k = was === 'point' ? 1 : 0;
  if (index >= o.index[k] && index - Math.max(middle, ring) >= o.margin[k]) return 'point';
  if (index >= o.open && middle >= o.open && ring >= o.open) return 'open';
  if (index <= o.curled && middle <= o.curled && ring <= o.curled && little <= o.curled) return 'fist';
  return 'other';
}
