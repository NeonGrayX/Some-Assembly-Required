import { BrickGrid } from '../grid.ts';
import {
  PLATES_PER_STUD,
  clipsOnto,
  faceVector,
  partBox,
  sideStudsOf,
  sidewaysAt,
  sidewaysSpan,
  sidewaysStudGrid,
} from '../parts.ts';
import type { TargetBrick, TargetBuild } from './types.ts';

/**
 * Moves sideways parts saved before side studs had their real heights (build files before
 * version 2) to where those studs put them. Such a part sat on a whole layer and held onto
 * any side stud within its height. Now it goes to the spot that lines up with the most of
 * those studs without running into anything, the nearest one to where it was if several do.
 * Parts with no stud behind them are left alone. Changes the bricks in place, and returns how
 * many moved.
 */
export function seatSideways(steps: TargetBuild['steps']): number {
  const grid = BrickGrid.from([
    { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
  ]);
  let id = 1;
  let moved = 0;
  for (const step of steps) {
    for (const b of step.bricks) {
      if (b.face) {
        const seat = seats(b, grid).find((p) => grid.check(p).ok) ?? seats(b, grid)[0];
        if (seat && (seat.x !== b.x || seat.y !== b.y || seat.z !== b.z)) {
          Object.assign(b, { x: seat.x, y: seat.y, z: seat.z });
          moved++;
        }
      }
      grid.add({ ...b, id: id++ });
    }
  }
  return moved;
}

/** Where a sideways part could go on the side studs it reached, best first. */
function seats(b: TargetBrick, grid: BrickGrid): TargetBrick[] {
  const face = b.face!;
  const v = faceVector(face);
  const box = partBox(b);
  const { y0, y1 } = sidewaysSpan(b);
  const { up } = sidewaysStudGrid(b);
  // Side studs right behind the part, about as high as it reached.
  const studs = [...grid.bricks.values()]
    .flatMap((h) => (h.face ? [] : sideStudsOf(h)))
    .filter((s) => {
      if (s.dir !== face) return false;
      const along = v.x ? s.z >= box.z0 && s.z < box.z1 : s.x >= box.x0 && s.x < box.x1;
      const behind = v.x ? s.x + v.x === box.x0 : s.z + v.z === box.z0;
      return along && behind && s.y > y0 - 1 && s.y < y1 + 1;
    });
  const out: { p: TargetBrick; held: number; off: number }[] = [];
  for (const s of studs) {
    for (let k = 0; k < up; k++) {
      const at = sidewaysAt(v.x ? s.x : s.z, face, s.out);
      const p = { ...b, y: s.y - (k + 0.5) * PLATES_PER_STUD, [v.x ? 'x' : 'z']: at };
      const held = studs.filter((t) => clipsOnto(p, t)).length;
      out.push({ p, held, off: Math.abs(p.y - b.y) });
    }
  }
  return out.sort((a, b) => b.held - a.held || a.off - b.off).map((c) => c.p);
}
