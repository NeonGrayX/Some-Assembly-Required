import { BRICK_TYPES, PLATE_H, STUD, footprint } from './bricks.ts';
import type { BrickTypeId, Rotation } from './bricks.ts';
import type { BrickGrid, Placement } from './grid.ts';
import type { Vec3 } from './math.ts';

/**
 * Finds where a brick would snap when aimed at a point on an assembly.
 *
 * `hit` and `normal` are in the assembly's local frame (metres). Aiming at a top face puts
 * the brick on top, aiming at a bottom face hangs it underneath. Side faces do not snap.
 * The brick is centred on the aim point and nudged by up to one stud to find a free,
 * clutched spot.
 */
export function computeSnap(
  grid: BrickGrid,
  hit: Vec3,
  normal: Vec3,
  type: BrickTypeId,
  rot: Rotation,
): Placement | null {
  let y: number;
  if (normal.y > 0.7) y = Math.round(hit.y / PLATE_H);
  else if (normal.y < -0.7) y = Math.round(hit.y / PLATE_H) - BRICK_TYPES[type].plates;
  else return null;

  const { w, d } = footprint(type, rot);
  const cx = hit.x / STUD - w / 2;
  const cz = hit.z / STUD - d / 2;
  const candidates: Placement[] = [];
  for (const dx of [-1, 0, 1]) {
    for (const dz of [-1, 0, 1]) {
      candidates.push({ type, rot, y, x: Math.round(cx) + dx, z: Math.round(cz) + dz });
    }
  }
  candidates.sort(
    (a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2),
  );
  return candidates.find((p) => grid.check(p).ok) ?? null;
}
