import { BRICK_TYPES, PLATE_H, STUD, hasTopStud } from './bricks.ts';
import type { BrickTypeId, Facing } from './bricks.ts';
import type { Vec3 } from './math.ts';
import { v3 } from './math.ts';
import type { PartPlacement } from './parts.ts';
import { faceVector, inHole, partAxes, partBounds } from './parts.ts';

/*
 * Every part as studs, stud receivers and solid boxes, in any of the 24 ways a part can be
 * turned square to the grid, on one fine lattice: LDraw units (LDU), 20 to a stud and 8 to a
 * plate. Every offset SNOT building makes lands on it: a side stud's centre 14 up a brick
 * (1.75 plates), a headlight brick's recess and a bracket's flange 4 (half a plate), a
 * jumper plate's half stud 10, a stud's height (2.5 plates) 20.
 *
 * A part's own frame has its body from the origin to (studsX, plates, studsZ) in studs and
 * plates, its studs pointing up (+y). An orientation says where the part's own x, y and z
 * axes point in the grid; a placement puts that turned body where the grid puts it today
 * (see parts.ts). Clutch is one rule: a stud and a receiver at the same lattice point, facing
 * each other. The grid does not use this yet: it is the model the grid moves onto, and its
 * tests check it gives the same studs, receivers and cells as the grid does now.
 */

/** LDraw units per stud, across. */
export const LDU_PER_STUD = 20;
/** LDraw units per plate, up. */
export const LDU_PER_PLATE = 8;

/** A direction along one of the grid's axes. */
export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

export const AXES: readonly Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z'];

const AXIS_VECTORS: Record<Axis, Vec3> = {
  '+x': v3(1, 0, 0),
  '-x': v3(-1, 0, 0),
  '+y': v3(0, 1, 0),
  '-y': v3(0, -1, 0),
  '+z': v3(0, 0, 1),
  '-z': v3(0, 0, -1),
};

export function axisVector(a: Axis): Vec3 {
  return AXIS_VECTORS[a];
}

/** The axis a unit vector along a grid axis points along. */
export function axisOf(v: Vec3): Axis {
  if (v.x) return v.x > 0 ? '+x' : '-x';
  if (v.y) return v.y > 0 ? '+y' : '-y';
  return v.z > 0 ? '+z' : '-z';
}

export function oppositeAxis(a: Axis): Axis {
  return `${a[0] === '+' ? '-' : '+'}${a[1]}` as Axis;
}

const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/**
 * One of the 24 turns square to the grid: where the part's own x, y (up, toward its studs) and
 * z axes point. Always right-handed, so z is x × y.
 */
export interface Orientation {
  x: Axis;
  y: Axis;
  z: Axis;
}

/** A short name for an orientation: its up axis, then its x axis ('+y+x' is upright, unturned). */
export function orientationKey(o: Orientation): string {
  return o.y + o.x;
}

/**
 * The 24 orientations, upright ones first in the order of `Rotation` (0 to 3 quarter turns
 * about +y, as `partAxes` turns them), then the rest by up axis.
 */
export const ORIENTATIONS: readonly Orientation[] = (() => {
  const out: Orientation[] = [];
  const ups: Axis[] = ['+y', '+x', '-x', '+z', '-z', '-y'];
  for (const y of ups) {
    // Turning about up a quarter at a time, as a part's rotation turns it: x goes toward -z
    // when up is +y.
    const u = axisVector(y);
    let x = AXIS_VECTORS[y[1] === 'y' ? '+x' : '+y'];
    for (let i = 0; i < 4; i++) {
      out.push({ x: axisOf(x), y, z: axisOf(cross(x, u)) });
      x = cross(u, x);
    }
  }
  return out;
})();

const BY_KEY = new Map(ORIENTATIONS.map((o) => [orientationKey(o), o]));

/** The orientation with this key, if there is one. */
export function orientationByKey(key: string): Orientation | undefined {
  return BY_KEY.get(key);
}

/** The orientation an orientation's axes as vectors describe. */
function fromVectors(x: Vec3, y: Vec3, z: Vec3): Orientation {
  return BY_KEY.get(axisOf(y) + axisOf(x)) ?? fail(x, y, z);
}

function fail(x: Vec3, y: Vec3, z: Vec3): never {
  throw new Error(`not an orientation: ${JSON.stringify({ x, y, z })}`);
}

/** Turns a vector in the part's own frame into the grid's frame. */
export function applyOrientation(o: Orientation, v: Vec3): Vec3 {
  const x = AXIS_VECTORS[o.x];
  const y = AXIS_VECTORS[o.y];
  const z = AXIS_VECTORS[o.z];
  return v3(
    x.x * v.x + y.x * v.y + z.x * v.z,
    x.y * v.x + y.y * v.y + z.y * v.z,
    x.z * v.x + y.z * v.y + z.z * v.z,
  );
}

/** Turns an axis in the part's own frame into the grid's frame. */
export function turnAxis(o: Orientation, a: Axis): Axis {
  return axisOf(applyOrientation(o, AXIS_VECTORS[a]));
}

/** `a` after `b`: turning by `b`, then by `a`. */
export function composeOrientations(a: Orientation, b: Orientation): Orientation {
  return fromVectors(
    applyOrientation(a, AXIS_VECTORS[b.x]),
    applyOrientation(a, AXIS_VECTORS[b.y]),
    applyOrientation(a, AXIS_VECTORS[b.z]),
  );
}

/** The turn that undoes `o`. */
export function invertOrientation(o: Orientation): Orientation {
  // The inverse of a rotation matrix is its transpose: row i of `o` is column i of the result.
  const cols = [AXIS_VECTORS[o.x], AXIS_VECTORS[o.y], AXIS_VECTORS[o.z]];
  const row = (i: 'x' | 'y' | 'z') => v3(cols[0]![i], cols[1]![i], cols[2]![i]);
  return fromVectors(row('x'), row('y'), row('z'));
}

/** How a placement is turned. */
export function orientationOf(p: PartPlacement): Orientation {
  const { x, y, z } = partAxes(p);
  return fromVectors(x, y, z);
}

/** A stud: the middle of its base, and the way it points. */
export interface LatticeStud {
  at: Vec3;
  dir: Axis;
  /** On top of the part, or on its side (where sideways parts clip on). */
  kind: 'top' | 'side';
  /** Open, with a hole a bar goes into (a round 1x1's, a side-stud brick's). */
  open?: boolean;
}

/**
 * Where a part takes a stud: the middle of the stud's base when it is in, and the way the
 * receiver faces (out of the part, toward the stud it takes). A `hole` takes a stud on its
 * own. The four `around` a centre hollow wedge it between them, holding only all together. A
 * `bar` (a plant stem) goes only into an open stud.
 */
export interface Receiver {
  at: Vec3;
  dir: Axis;
  kind: 'hole' | 'around' | 'bar';
}

/** A box of the lattice: from `min` up to `max`, in LDU. */
export interface LatticeBox {
  min: Vec3;
  max: Vec3;
}

/** A part as studs, receivers and the boxes its body fills. */
export interface PartShape {
  studs: LatticeStud[];
  receivers: Receiver[];
  boxes: LatticeBox[];
}

const S = LDU_PER_STUD;
const P = LDU_PER_PLATE;

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({
  min: v3(x0, y0, z0),
  max: v3(x1, y1, z1),
});

/** The part's body: whole, or less what a quarter arc's hole or a leaf plate's leaves change. */
function bodyBoxes(type: BrickTypeId): LatticeBox[] {
  const t = BRICK_TYPES[type];
  const h = t.plates * P;
  if (t.canopy) {
    // The first cell is the plate; its leaves are tipped up half a plate over the rest.
    const out = [box(0, 0, 0, S, h, S)];
    for (let lx = 0; lx < t.studsX; lx++)
      for (let lz = 0; lz < t.studsZ; lz++)
        if (lx || lz) out.push(box(lx * S, P / 2, lz * S, (lx + 1) * S, h + P / 2, (lz + 1) * S));
    return out;
  }
  if (!t.hole) return [box(0, 0, 0, t.studsX * S, h, t.studsZ * S)];
  // A box per run of filled cells along z, as `partSolids` does.
  const out: LatticeBox[] = [];
  for (let lx = 0; lx < t.studsX; lx++)
    for (let lz = 0; lz < t.studsZ; lz++) {
      if (inHole(type, lx, lz) || (lz > 0 && !inHole(type, lx, lz - 1))) continue;
      let end = lz;
      while (end + 1 < t.studsZ && !inHole(type, lx, end + 1)) end++;
      out.push(box(lx * S, 0, lz * S, (lx + 1) * S, h, (end + 1) * S));
    }
  return out;
}

/**
 * A bracket's flanges: in front of the side its studs stand out from, as thick as they stand
 * out, from its plate's top down to half a stud under the lowest stud on each cell's side.
 */
function flangeBoxes(type: BrickTypeId): LatticeBox[] {
  const t = BRICK_TYPES[type];
  const top = t.plates * P;
  const low = new Map<string, { x: number; z: number; dir: Facing; out: number; y: number }>();
  for (const s of t.sideStuds ?? []) {
    if (!s.out || s.out <= 0) continue;
    const key = `${s.x},${s.z},${s.dir}`;
    const y = s.y * P - S / 2;
    const f = low.get(key);
    if (!f || y < f.y) low.set(key, { x: s.x, z: s.z, dir: s.dir, out: s.out, y });
  }
  return [...low.values()].map(({ x, z, dir, out, y }) => {
    const v = faceVector(dir);
    const thick = out * P;
    // The side of the cell it stands on, and its front.
    const side = (c: number, d: number) => (d > 0 ? (c + 1) * S : c * S);
    const a = v.x ? side(x, v.x) : x * S;
    const b = v.z ? side(z, v.z) : z * S;
    const x0 = v.x ? Math.min(a, a + v.x * thick) : a;
    const x1 = v.x ? Math.max(a, a + v.x * thick) : a + S;
    const z0 = v.z ? Math.min(b, b + v.z * thick) : b;
    const z1 = v.z ? Math.max(b, b + v.z * thick) : b + S;
    return box(x0, y, z0, x1, top, z1);
  });
}

function buildShape(type: BrickTypeId): PartShape {
  const t = BRICK_TYPES[type];
  const top = t.plates * P;
  const centre = v3((t.studsX * S) / 2, 0, (t.studsZ * S) / 2);
  const cell = (lx: number, y: number, lz: number) => v3((lx + 0.5) * S, y, (lz + 0.5) * S);
  const studs: LatticeStud[] = [];
  const open = t.openStud ? { open: true } : {};
  if (t.studs === 'centre')
    studs.push({ at: v3(centre.x, top, centre.z), dir: '+y', kind: 'top', ...open });
  else
    for (let lx = 0; lx < t.studsX; lx++)
      for (let lz = 0; lz < t.studsZ; lz++)
        if (hasTopStud(type, lx, lz))
          studs.push({ at: cell(lx, top, lz), dir: '+y', kind: 'top', ...open });
  for (const s of t.sideStuds ?? []) {
    const v = faceVector(s.dir);
    // On the side of its cell, moved out (or back) as far as its base stands out.
    const off = S / 2 + (s.out ?? 0) * P;
    const c = cell(s.x, s.y * P, s.z);
    studs.push({
      at: v3(c.x + v.x * off, c.y, c.z + v.z * off),
      dir: s.dir,
      kind: 'side',
      ...(t.openSideStuds ? { open: true } : {}),
    });
  }
  const receivers: Receiver[] = [];
  const bottom = t.bottom ?? 'cells';
  if (bottom === 'centre') {
    receivers.push({ at: centre, dir: '-y', kind: 'hole' });
    for (const dx of [-S / 2, S / 2])
      for (const dz of [-S / 2, S / 2])
        receivers.push({ at: v3(centre.x + dx, 0, centre.z + dz), dir: '-y', kind: 'around' });
  } else if (bottom === 'first') receivers.push({ at: cell(0, 0, 0), dir: '-y', kind: 'hole' });
  else
    for (let lx = 0; lx < t.studsX; lx++)
      for (let lz = 0; lz < t.studsZ; lz++)
        if (!inHole(type, lx, lz))
          receivers.push({
            at: cell(lx, 0, lz),
            dir: '-y',
            kind: bottom === 'bar' ? 'bar' : 'hole',
          });
  return { studs, receivers, boxes: [...bodyBoxes(type), ...flangeBoxes(type)] };
}

const SHAPES = new Map<BrickTypeId, PartShape>();

/** A part type's studs, receivers and boxes in its own frame. */
export function partShape(type: BrickTypeId): PartShape {
  let s = SHAPES.get(type);
  if (!s) SHAPES.set(type, (s = buildShape(type)));
  return s;
}

/**
 * Where the part's own origin lands in the grid, in LDU: the turned body's middle goes where
 * the grid puts the part's body (`partBounds`), so the lattice and the grid agree.
 */
function originOf(p: PartPlacement, o: Orientation): Vec3 {
  const t = BRICK_TYPES[p.type];
  const { min, max } = partBounds(p);
  const mid = v3(
    ((min.x + max.x) / 2 / STUD) * S,
    ((min.y + max.y) / 2 / PLATE_H) * P,
    ((min.z + max.z) / 2 / STUD) * S,
  );
  const own = applyOrientation(o, v3((t.studsX * S) / 2, (t.plates * P) / 2, (t.studsZ * S) / 2));
  return v3(lattice(mid.x - own.x), lattice(mid.y - own.y), lattice(mid.z - own.z));
}

/** A coordinate worked out in fractions of studs and plates, put back on the lattice. */
function lattice(n: number): number {
  const r = Math.round(n);
  if (Math.abs(n - r) > 1e-6) throw new Error(`off the lattice: ${n}`);
  return r;
}

/** A placed part's studs, receivers and boxes, in the grid's frame in LDU. */
export function placedShape(p: PartPlacement): PartShape {
  const o = orientationOf(p);
  const origin = originOf(p, o);
  const point = (v: Vec3) => {
    const r = applyOrientation(o, v);
    return v3(origin.x + r.x, origin.y + r.y, origin.z + r.z);
  };
  const shape = partShape(p.type);
  return {
    studs: shape.studs.map((s) => ({ ...s, at: point(s.at), dir: turnAxis(o, s.dir) })),
    receivers: shape.receivers.map((r) => ({ ...r, at: point(r.at), dir: turnAxis(o, r.dir) })),
    boxes: shape.boxes.map((b) => {
      const a = point(b.min);
      const c = point(b.max);
      return {
        min: v3(Math.min(a.x, c.x), Math.min(a.y, c.y), Math.min(a.z, c.z)),
        max: v3(Math.max(a.x, c.x), Math.max(a.y, c.y), Math.max(a.z, c.z)),
      };
    }),
  };
}

/** Whether a stud goes into a receiver: the same point, facing each other. */
export function clutches(stud: LatticeStud, r: Receiver): boolean {
  if (r.kind === 'bar' && !stud.open) return false;
  return (
    stud.dir === oppositeAxis(r.dir) &&
    stud.at.x === r.at.x &&
    stud.at.y === r.at.y &&
    stud.at.z === r.at.z
  );
}
