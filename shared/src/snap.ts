import { BRICK_TYPES, PLATE_H, STUD, footprint } from './bricks.ts';
import type { BrickTypeId, Rotation } from './bricks.ts';
import { cellsOf } from './grid.ts';
import type { BrickGrid, Placement } from './grid.ts';
import type { Vec3 } from './math.ts';
import { PLATES_PER_STUD, faceOf, faceVector, sideStudsOf, sidewaysStudGrid } from './parts.ts';

/**
 * Finds where a brick would snap when aimed at a point on an assembly.
 *
 * `hit` and `normal` are in the assembly's local frame (metres). Aiming at a top face puts
 * the brick on top, aiming at a bottom face hangs it underneath. Aiming at a side face clips
 * a thin part (a tile, a plate) sideways onto the side studs there, if there are any. The
 * brick is centred on the aim point and nudged by up to one stud to find a free, clutched spot.
 */
export function computeSnap(
  grid: BrickGrid,
  hit: Vec3,
  normal: Vec3,
  type: BrickTypeId,
  rot: Rotation,
): Placement | null {
  if (Math.abs(normal.y) < 0.3) return sideSnap(grid, hit, normal, type, rot);
  return (
    computeGroupSnap(grid, hit, normal, [{ type, rot: 0, x: 0, y: 0, z: 0 }], rot)?.[0] ?? null
  );
}

/**
 * Clips a thin part sideways onto the side studs of the face aimed at: of the studs pointing
 * out of that face, the nearest one to the aim point that the part can cover while it fits.
 */
export function sideSnap(
  grid: BrickGrid,
  hit: Vec3,
  normal: Vec3,
  type: BrickTypeId,
  rot: Rotation,
): Placement | null {
  if (!BRICK_TYPES[type].mountable) return null;
  const face = faceOf(normal);
  if (!face) return null;
  const v = faceVector(face);
  // Side studs on the plane aimed at, nearest first.
  const plane = face === '+x' || face === '-x' ? hit.x / STUD : hit.z / STUD;
  const studs = [...grid.bricks.values()]
    .flatMap((b) => (b.face ? [] : sideStudsOf(b)))
    .filter((s) => s.dir === face)
    .filter((s) => {
      // The stud's cell side it sticks out of.
      const side = v.x ? s.x + (v.x > 0 ? 1 : 0) : s.z + (v.z > 0 ? 1 : 0);
      return Math.abs(side - plane) < 0.3;
    })
    .map((s) => {
      const along = v.x ? s.z + 0.5 - hit.z / STUD : s.x + 0.5 - hit.x / STUD;
      const up = (s.y - hit.y / PLATE_H) / PLATES_PER_STUD;
      return { s, d: along * along + up * up };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  const size = sidewaysStudGrid({ type, rot, x: 0, y: 0, z: 0, face });
  for (const { s } of studs) {
    // Try each of the part's own studs over this side stud, the one nearest the aim first.
    const options: Placement[] = [];
    for (let i = 0; i < size.along; i++) {
      for (let j = 0; j < size.up; j++) {
        const y = Math.round(s.y - (j + 0.5) * PLATES_PER_STUD);
        const x = v.x ? s.x + v.x : s.x - i;
        const z = v.x ? s.z - i : s.z + v.z;
        options.push({ type, rot, face, x, y, z });
      }
    }
    const centre = (p: Placement) => {
      const a = v.x ? p.z + size.along / 2 : p.x + size.along / 2;
      const h = p.y + (size.up * PLATES_PER_STUD) / 2;
      const aim = v.x ? hit.z / STUD : hit.x / STUD;
      return (a - aim) ** 2 + ((h - hit.y / PLATE_H) / PLATES_PER_STUD) ** 2;
    };
    options.sort((a, b) => centre(a) - centre(b));
    for (const p of options) if (fits(grid, [p])) return p;
  }
  return null;
}

/** Turns a placement a quarter turn `turns` times around the grid's origin (like `yawQuat`). */
export function turnPlacement(p: Placement, turns: Rotation): Placement {
  let { x, z } = p;
  for (let i = 0; i < turns; i++) {
    const { w } = footprint(p.type, ((p.rot + i) % 4) as Rotation);
    [x, z] = [z, -x - w];
  }
  return { ...p, x, z, rot: ((p.rot + turns) % 4) as Rotation };
}

/**
 * Finds where a group of bricks clutched together (a piece built off the job site) would
 * snap when aimed at a point on an assembly, all in one go. `bricks` are in the group's own
 * grid; `rot` turns the group into the target's frame. Aiming at a top face sets the group's
 * lowest layer on top, aiming at a bottom face hangs its highest layer underneath, centred on
 * the aim point and nudged by up to one stud. Every brick must land on a free spot and at
 * least one must clutch the target. Returns the placements in the order `bricks` came in.
 */
export function computeGroupSnap(
  grid: BrickGrid,
  hit: Vec3,
  normal: Vec3,
  bricks: Placement[],
  rot: Rotation,
): Placement[] | null {
  if (!bricks.length) return null;
  const turned = bricks.map((b) => turnPlacement(b, rot));
  const top = (p: Placement) => p.y + BRICK_TYPES[p.type].plates;
  let face: Placement[];
  let dy: number;
  if (normal.y > 0.7) {
    const low = Math.min(...turned.map((p) => p.y));
    face = turned.filter((p) => p.y === low);
    dy = Math.round(hit.y / PLATE_H) - low;
  } else if (normal.y < -0.7) {
    const high = Math.max(...turned.map(top));
    face = turned.filter((p) => top(p) === high);
    dy = Math.round(hit.y / PLATE_H) - high;
  } else return null;

  // Centre the face that touches the target on the aim point.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of face) {
    const { w, d } = footprint(p.type, p.rot);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + w);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z + d);
  }
  const cx = hit.x / STUD - (minX + maxX) / 2;
  const cz = hit.z / STUD - (minZ + maxZ) / 2;
  const shifts: { x: number; z: number }[] = [];
  for (const dx of [-1, 0, 1]) {
    for (const dz of [-1, 0, 1]) shifts.push({ x: Math.round(cx) + dx, z: Math.round(cz) + dz });
  }
  shifts.sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2));
  for (const s of shifts) {
    const moved = turned.map((p) => ({ ...p, x: p.x + s.x, y: p.y + dy, z: p.z + s.z }));
    if (fits(grid, moved)) return moved;
  }
  return null;
}

/** No brick overlaps the grid, and at least one is clutched to it (or the grid is empty). */
function fits(grid: BrickGrid, group: Placement[]): boolean {
  for (const p of group) {
    for (const [x, y, z] of cellsOf(p)) if (grid.brickAt(x, y, z) !== undefined) return false;
  }
  return grid.size === 0 || group.some((p) => grid.neighbours(p).length > 0);
}
