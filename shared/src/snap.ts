import { BRICK_TYPES, PLATE_H, STUD, footprint } from './bricks.ts';
import type { BrickTypeId, Rotation } from './bricks.ts';
import type { BrickGrid, PlacedBrick, Placement } from './grid.ts';
import {
  LDU_PER_PLATE,
  LDU_PER_STUD,
  ORIENTATIONS,
  oppositeAxis,
  orientationKey,
  orientationOf,
  partShape,
  placementsInto,
  placementsOnto,
  plainPlacement,
  sidewaysStuds,
  turnAxis,
} from './lattice.ts';
import type { Axis } from './lattice.ts';
import type { Vec3 } from './math.ts';
import { v3 } from './math.ts';
import {
  PLATES_PER_STUD,
  faceOf,
  partBounds,
  partColliders,
  faceVector,
  sidewaysAt,
  sidewaysStudGrid,
} from './parts.ts';

/**
 * Finds where a brick would snap when aimed at a point on an assembly.
 *
 * `hit` and `normal` are in the assembly's local frame (metres). Aiming at a top face puts
 * the brick on top, aiming at a bottom face hangs it underneath. Aiming at a side face clips
 * it sideways onto the side studs there, if there are any. The brick is centred on the aim
 * point and nudged by up to one stud to find a free, clutched spot. Failing those, it goes
 * onto whatever studs or receivers face out of the face aimed at, turned to take them (see
 * `latticeSnap`). Flipped (`flip`, see `canFlip`), it goes on by its other hole only.
 */
export function computeSnap(
  grid: BrickGrid,
  hit: Vec3,
  normal: Vec3,
  type: BrickTypeId,
  rot: Rotation,
  flip = false,
): Placement | null {
  if (flip) return latticeSnap(grid, hit, normal, type, rot, true);
  const plain =
    Math.abs(normal.y) < 0.3
      ? sideSnap(grid, hit, normal, type, rot)
      : (computeGroupSnap(grid, hit, normal, [{ type, rot: 0, x: 0, y: 0, z: 0 }], rot)?.[0] ??
        null);
  return plain ?? latticeSnap(grid, hit, normal, type, rot);
}

/**
 * Clips a part sideways onto the side studs of the face aimed at: of the studs pointing
 * out of that face (an upright part's side studs, or the studs of a part already clipped on
 * sideways), the nearest one to the aim point that the part can cover while it fits.
 * The part goes exactly where that stud puts it: one of its stud spots over the stud, its
 * back on the stud's base (set back on a headlight brick, out on a bracket's flange).
 */
export function sideSnap(
  grid: BrickGrid,
  hit: Vec3,
  normal: Vec3,
  type: BrickTypeId,
  rot: Rotation,
): Placement | null {
  const face = faceOf(normal);
  if (!face) return null;
  const v = faceVector(face);
  // Side studs on the plane aimed at, nearest first.
  const plane = face === '+x' || face === '-x' ? hit.x / STUD : hit.z / STUD;
  const studs = [...grid.bricks.values()]
    .flatMap((b) => sidewaysStuds(b))
    .filter((s) => s.dir === face)
    .filter((s) => {
      // The stud's cell side it sticks out of, or its base, set back or standing out from it
      // (a sideways plate's studs stand out a plate from the cell it is in).
      const side = v.x ? s.x + (v.x > 0 ? 1 : 0) : s.z + (v.z > 0 ? 1 : 0);
      const base = side + ((v.x || v.z) * s.out) / PLATES_PER_STUD;
      return Math.abs(side - plane) < 0.3 || Math.abs(base - plane) < 0.3;
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
        const y = s.y - (j + 0.5) * PLATES_PER_STUD;
        const x = v.x ? sidewaysAt(s.x, face, s.out) : s.x - i;
        const z = v.x ? s.z - i : sidewaysAt(s.z, face, s.out);
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

/**
 * Puts a single part onto the studs pointing out of the face aimed at, or with its studs into
 * the receivers facing out of it, whatever part they are on and whichever way they point: on a
 * sideways plate's studs, on studs pointing down (upside down), on a bracket's flange turned
 * up half a plate off the layers. The part's up goes the way those studs point (or against the
 * way the receivers face), and `rot` turns it a quarter at a time about that. Flipped, a part
 * with a hole elsewhere (a headlight brick's back, see `canFlip`) goes on a stud by that hole
 * instead, `rot` turning it about the stud the same way. Of the spots where one of its
 * receivers (or studs) meets one there, the one nearest the aim point that fits wins. It comes
 * back upright or sideways where those can say it (see `plainPlacement`).
 */
export function latticeSnap(
  grid: BrickGrid,
  hit: Vec3,
  normal: Vec3,
  type: BrickTypeId,
  rot: Rotation,
  flip = false,
): Placement | null {
  const axis = axisNear(normal);
  if (!axis) return null;
  const k = axis[1] as 'x' | 'y' | 'z';
  const unit = (c: 'x' | 'y' | 'z') => (c === 'y' ? LDU_PER_PLATE / PLATE_H : LDU_PER_STUD / STUD);
  const aim = v3(hit.x * unit('x'), hit.y * unit('y'), hit.z * unit('z'));
  // How far off the face a stud's base or a receiver may be (a recess, a flange), and how far
  // from the aim point along it, in LDU.
  const off = (v: Vec3) => Math.abs(v[k] - aim[k]);
  const across = (v: Vec3) =>
    (['x', 'y', 'z'] as const).reduce((d, c) => (c === k ? d : d + (v[c] - aim[c]) ** 2), 0);
  const turns = ORIENTATIONS.filter((o) => o.y === axis);
  const against = ORIENTATIONS.filter((o) => o.y === oppositeAxis(axis));
  // Flipped: turned so its other hole faces the studs.
  const ways = flip
    ? flipHoles(type).map(
        (d) => ORIENTATIONS.filter((o) => turnAxis(o, d) === oppositeAxis(axis))[rot]!,
      )
    : [turns[rot]!];
  const options: Placement[] = [];
  for (const b of grid.bricks.values()) {
    const shape = grid.shapeOfBrick(b.id)!;
    for (const s of shape.studs)
      if (s.dir === axis && off(s.at) <= 6 && across(s.at) <= 40 * 40)
        options.push(...placementsOnto(type, s, ways));
    for (const r of shape.receivers)
      if (!flip && r.dir === axis && off(r.at) <= 6 && across(r.at) <= 40 * 40)
        options.push(...placementsInto(type, r, [against[rot]!]));
  }
  const centre = (p: Placement) => {
    const { min, max } = partBounds(p);
    return across(
      v3(
        ((min.x + max.x) / 2) * unit('x'),
        ((min.y + max.y) / 2) * unit('y'),
        ((min.z + max.z) / 2) * unit('z'),
      ),
    );
  };
  options.sort((a, b) => centre(a) - centre(b));
  for (const p of options) {
    const plain = plainPlacement(p);
    if (fits(grid, [plain])) return plain;
  }
  return null;
}

/** The ways the part's holes face, in its own frame, but for those under it. */
function flipHoles(type: BrickTypeId): Axis[] {
  return [
    ...new Set(
      partShape(type)
        .receivers.filter((r) => r.dir !== '-y')
        .map((r) => r.dir),
    ),
  ];
}

/**
 * Whether the part can be flipped (E) to go on a stud by a hole other than its bottom: a
 * headlight brick by its back, a round tile by the hole in its top. A part picked up goes on by
 * its bottom; flipped, by that other hole, until it is placed, dropped or flipped back.
 */
export function canFlip(type: BrickTypeId): boolean {
  return flipHoles(type).length > 0;
}

/** The grid axis a face's normal points along, if it is close to one. */
function axisNear(n: Vec3): Axis | null {
  for (const c of ['x', 'y', 'z'] as const)
    if (Math.abs(n[c]) > 0.7) return `${n[c] > 0 ? '+' : '-'}${c}` as Axis;
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
 * least one must clutch the target. An upright group can also land half a stud off the grid
 * either way or both, whichever is nearer the aim: a cone between four studs, a dish on one,
 * anything on a jumper's stud, or on the stud of a cone that sits between four (half off one
 * way only, each part comes back turned). Returns the placements in the order `bricks` came in.
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
  // Upright parts may also go half a stud off the grid either way or both, if that clutches
  // (on a jumper's stud, or between four).
  const halves = turned.every((p) => !p.face) ? [0, 0.5] : [0];
  for (const hx of halves)
    for (const hz of halves) {
      const bx = Math.round(cx - hx) + hx;
      const bz = Math.round(cz - hz) + hz;
      for (const dx of [-1, 0, 1])
        for (const dz of [-1, 0, 1]) shifts.push({ x: bx + dx, z: bz + dz });
    }
  shifts.sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2));
  for (const s of shifts) {
    const moved = turned.map((p) => ({ ...p, x: p.x + s.x, y: p.y + dy, z: p.z + s.z }));
    if (fits(grid, moved)) return moved.map(sayable);
  }
  return null;
}

/**
 * A layer of an assembly that snapping keeps to while the player holds a key (Shift), so a
 * brick can hang out over the edge of the brick below instead of dropping to whatever the aim
 * point is on. `y` is the height of the face the bricks touch, in plates; `down` means they
 * hang underneath it rather than sit on top.
 */
export interface SnapLayer {
  y: number;
  down: boolean;
}

/** The layer a snap aimed at this point and face would land on, if it is a top or bottom face. */
export function snapLayer(hit: Vec3, normal: Vec3): SnapLayer | null {
  if (Math.abs(normal.y) <= 0.7) return null;
  return { y: Math.round(hit.y / PLATE_H), down: normal.y < 0 };
}

/**
 * Like `computeGroupSnap`, but on a locked layer: the aim ray (`origin` and `dir`, in the
 * assembly's frame) is met with the layer's plane, so the bricks stay on that layer for as long
 * as they still clutch something there, wherever the ray goes on to hit. Null once they do not
 * (or the plane is behind the ray, past `maxDist`, or seen from the wrong side).
 */
export function computeLayerSnap(
  grid: BrickGrid,
  origin: Vec3,
  dir: Vec3,
  bricks: Placement[],
  rot: Rotation,
  layer: SnapLayer,
  maxDist = Infinity,
): Placement[] | null {
  const h = layer.y * PLATE_H;
  // A top face is seen from above, a bottom face from below.
  if (layer.down ? origin.y >= h || dir.y <= 0 : origin.y <= h || dir.y >= 0) return null;
  const t = (h - origin.y) / dir.y;
  if (t > maxDist) return null;
  const hit = { x: origin.x + dir.x * t, y: h, z: origin.z + dir.z * t };
  const normal = { x: 0, y: layer.down ? -1 : 1, z: 0 };
  return computeGroupSnap(grid, hit, normal, bricks, rot);
}

/**
 * An upright placement as a placement can say it: half a stud off the grid one way only, it is
 * a turned one (upright parts go half off both ways or neither).
 */
function sayable(p: Placement): Placement {
  if (p.face || p.orient || Number.isInteger(p.x) === Number.isInteger(p.z)) return p;
  // Its low corner is where it is; turned, (x, y, z) is that corner too.
  return { type: p.type, rot: 0, orient: orientationKey(orientationOf(p)), x: p.x, y: p.y, z: p.z };
}

/** No brick overlaps the grid, and at least one is clutched to it (or the grid is empty). */
function fits(grid: BrickGrid, group: Placement[]): boolean {
  for (const p of group) if (grid.overlaps(p)) return false;
  return grid.size === 0 || group.some((p) => grid.neighbours(p).length > 0);
}

/** Where an aim ray meets a brick: as the game's physics reports it (see `aimAtBricks`). */
export interface BrickAim {
  point: Vec3;
  normal: Vec3;
  brickId: number;
  /** How far along the ray, in metres. */
  distance: number;
}

/**
 * Where a ray (`origin` and a unit `dir`, in the bricks' grid frame) first meets one of `bricks`,
 * within `maxDist`. It meets the boxes the game's physics gives each brick (`partColliders`), so
 * the point and face are the ones the game aims at: a ray starting inside a box meets it at once,
 * with no face (a zero normal), as the physics has it.
 */
export function aimAtBricks(
  bricks: Iterable<PlacedBrick>,
  origin: Vec3,
  dir: Vec3,
  maxDist = Infinity,
): BrickAim | null {
  let best: BrickAim | null = null;
  const axes = ['x', 'y', 'z'] as const;
  for (const b of bricks) {
    for (const box of partColliders(b)) {
      let near = -Infinity;
      let far = Infinity;
      let face: { axis: (typeof axes)[number]; sign: number } | null = null;
      for (const axis of axes) {
        const o = origin[axis];
        const d = dir[axis];
        const lo = box.min[axis];
        const hi = box.max[axis];
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) near = Infinity;
          continue;
        }
        const t0 = (lo - o) / d;
        const t1 = (hi - o) / d;
        const enter = Math.min(t0, t1);
        if (enter > near) {
          near = enter;
          // Entering through the low side faces down the axis, through the high side up it.
          face = { axis, sign: d > 0 ? -1 : 1 };
        }
        far = Math.min(far, Math.max(t0, t1));
      }
      if (near > far || far < 0) continue;
      const t = Math.max(near, 0);
      if (t > maxDist || (best && t >= best.distance)) continue;
      const normal = { x: 0, y: 0, z: 0 };
      if (near >= 0 && face) normal[face.axis] = face.sign;
      best = {
        point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
        normal,
        brickId: b.id,
        distance: t,
      };
    }
  }
  return best;
}
