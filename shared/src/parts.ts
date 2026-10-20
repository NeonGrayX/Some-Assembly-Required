import { BRICK_TYPES, PLATE_H, STUD, hasTopStud } from './bricks.ts';
import type { BrickTypeId, Facing, Rotation } from './bricks.ts';
import type { Quat, Vec3 } from './math.ts';
import { v3 } from './math.ts';

/*
 * Where a part sits and how it is turned, for upright parts and for parts clipped sideways onto
 * side studs. The grid, the physics, snapping and drawing all go through these, so they agree.
 *
 * An upright part covers its footprint (turned by `rot`) and `plates` layers from `y` up. It may
 * sit half a stud off the grid: then its x and z are both half way between whole studs, and it
 * covers every cell its footprint reaches into. A part with a centre hollow (`bottom: 'centre'`)
 * gets there by going between four studs; any part can stand on studs that are half a stud off
 * themselves, like the stud on top of a cone between four.
 *
 * A sideways part (one with a `face`) has its top, studs and print pointing along `face`. It
 * covers one cell in that direction, its back flat against the side studs it is clipped to;
 * along the side it covers its width, and upward its height in studs, from `y`. A stud is 2.5
 * plates, so sideways parts sit where the side studs put them, not on whole layers: `y` may be
 * a fraction (a tile on a 1x1 brick with studs on its side starts half a plate up), and the
 * part covers every layer it reaches into. Its coordinate along `face` is its cell, moved by
 * half a plate (0.2 studs) the way the studs' base is: back into a headlight brick's recess,
 * out onto a bracket's flange. `rot` turns it a quarter at a time about the way it faces:
 * even turns lay its x (studsX) along the side and its z up, odd turns stand its x up.
 */

/** Anything with a place in a grid. Matches `Placement` in grid.ts. */
export interface PartPlacement {
  type: BrickTypeId;
  x: number;
  y: number;
  z: number;
  rot: Rotation;
  face?: Facing;
}

/** Plates per stud: a sideways part one stud high is this many plates high. */
export const PLATES_PER_STUD = STUD / PLATE_H;

/** Slack for comparing heights and offsets worked out in fractions of a plate. */
const EPS = 1e-6;

/** Cells covered, as a box: from the min corner up to (not including) the max corner. */
export interface CellBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

/** A box in the grid's own frame, in metres. */
export interface MetreBox {
  min: Vec3;
  max: Vec3;
}

const FACE_VECTORS: Record<Facing, Vec3> = {
  '+x': v3(1, 0, 0),
  '-x': v3(-1, 0, 0),
  '+z': v3(0, 0, 1),
  '-z': v3(0, 0, -1),
};

export const FACINGS: readonly Facing[] = ['+x', '-x', '+z', '-z'];

export function faceVector(face: Facing): Vec3 {
  return FACE_VECTORS[face];
}

/** The face a horizontal direction points along, if it is close to an axis. */
export function faceOf(dir: Vec3): Facing | null {
  if (Math.abs(dir.x) > 0.7) return dir.x > 0 ? '+x' : '-x';
  if (Math.abs(dir.z) > 0.7) return dir.z > 0 ? '+z' : '-z';
  return null;
}

/** A sideways part's size: studs along the side it is clipped to, and studs up. */
function sidewaysSize(p: PartPlacement): { along: number; up: number } {
  const t = BRICK_TYPES[p.type];
  return p.rot % 2 === 0 ? { along: t.studsX, up: t.studsZ } : { along: t.studsZ, up: t.studsX };
}

/** Footprint of an upright part after rotation, in studs. */
function uprightSize(p: PartPlacement): { w: number; d: number } {
  const t = BRICK_TYPES[p.type];
  return p.rot % 2 === 0 ? { w: t.studsX, d: t.studsZ } : { w: t.studsZ, d: t.studsX };
}

/** Whether the part has one hollow in the middle of its bottom (see `BrickType.bottom`). */
export function hasCentreHollow(type: BrickTypeId): boolean {
  return BRICK_TYPES[type].bottom === 'centre';
}

/** Whether an upright part sits half a stud off the grid. */
export function isHalfStud(p: PartPlacement): boolean {
  return !p.face && (p.x % 1 !== 0 || p.z % 1 !== 0);
}

/** Grid cells a placement covers. */
export function partBox(p: PartPlacement): CellBox {
  const t = BRICK_TYPES[p.type];
  if (!p.face) {
    const { w, d } = uprightSize(p);
    return {
      x0: Math.floor(p.x),
      y0: p.y,
      z0: Math.floor(p.z),
      x1: Math.ceil(p.x + w),
      y1: p.y + t.plates,
      z1: Math.ceil(p.z + d),
    };
  }
  const { along, up } = sidewaysSize(p);
  const y0 = Math.floor(p.y + EPS);
  const y1 = Math.ceil(p.y + up * PLATES_PER_STUD - EPS);
  // Its cell along the face: the coordinate is at most a fifth of a stud off it.
  const x = Math.round(p.x);
  const z = Math.round(p.z);
  return p.face === '+x' || p.face === '-x'
    ? { x0: x, y0, z0: z, x1: x + 1, y1, z1: z + along }
    : { x0: x, y0, z0: z, x1: x + along, y1, z1: z + 1 };
}

/**
 * How far a sideways part's back stands out from its cell's side toward what it is clipped
 * to, in plates: -0.5 in a headlight brick's recess, 0.5 on a bracket's flange, else 0.
 */
export function sidewaysOut(p: PartPlacement): number {
  if (!p.face) return 0;
  const v = faceVector(p.face);
  const at = v.x ? p.x : p.z;
  const sign = v.x || v.z;
  return Math.round((at - Math.round(at)) * sign * PLATES_PER_STUD * 4) / 4;
}

/**
 * The coordinate along `face` of a sideways part in front of side studs on cell `cell` (the
 * host's x for '+x' and '-x', its z for the others) whose base stands `out` plates off its side.
 */
export function sidewaysAt(cell: number, face: Facing, out = 0): number {
  const v = faceVector(face);
  const sign = v.x || v.z;
  return cell + sign + (sign * out) / PLATES_PER_STUD;
}

/** The part's body exactly, in metres: what is drawn and what collides. */
export function partBounds(p: PartPlacement): MetreBox {
  const t = BRICK_TYPES[p.type];
  const b = partBox(p);
  if (!p.face) {
    const { w, d } = uprightSize(p);
    return {
      min: v3(p.x * STUD, b.y0 * PLATE_H, p.z * STUD),
      max: v3((p.x + w) * STUD, b.y1 * PLATE_H, (p.z + d) * STUD),
    };
  }
  const { up } = sidewaysSize(p);
  const thick = t.plates * PLATE_H;
  const y0 = p.y * PLATE_H;
  const y1 = y0 + up * STUD;
  // The back lies on the cell's side toward what it is clipped to, moved as far as the studs'
  // base is (the coordinate along the face carries that).
  switch (p.face) {
    case '+x':
      return {
        min: v3(p.x * STUD, y0, b.z0 * STUD),
        max: v3(p.x * STUD + thick, y1, b.z1 * STUD),
      };
    case '-x':
      return {
        min: v3((p.x + 1) * STUD - thick, y0, b.z0 * STUD),
        max: v3((p.x + 1) * STUD, y1, b.z1 * STUD),
      };
    case '+z':
      return {
        min: v3(b.x0 * STUD, y0, p.z * STUD),
        max: v3(b.x1 * STUD, y1, p.z * STUD + thick),
      };
    case '-z':
      return {
        min: v3(b.x0 * STUD, y0, (p.z + 1) * STUD - thick),
        max: v3(b.x1 * STUD, y1, (p.z + 1) * STUD),
      };
  }
}

/** Centre of the part's body in the grid's frame, in metres. */
export function partCentre(p: PartPlacement): Vec3 {
  const { min, max } = partBounds(p);
  return v3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
}

/** Where the part's own x, y (up, toward its studs) and z axes point in the grid's frame. */
export function partAxes(p: PartPlacement): { x: Vec3; y: Vec3; z: Vec3 } {
  const turns = p.rot;
  if (!p.face) {
    const a = (turns * Math.PI) / 2;
    const c = Math.round(Math.cos(a));
    const s = Math.round(Math.sin(a));
    // A turn about +y, as yawQuat: x goes toward -z.
    return { x: v3(c, 0, -s), y: v3(0, 1, 0), z: v3(s, 0, c) };
  }
  const u = faceVector(p.face);
  // Along the side: up × ... chosen so that x, y, z stay right-handed with z pointing up.
  const along = v3(-u.z, 0, u.x);
  const a = (turns * Math.PI) / 2;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  return {
    x: v3(c * along.x, s, c * along.z),
    y: u,
    z: v3(-s * along.x, c, -s * along.z),
  };
}

/** The rotation that turns a part's own frame into the grid's frame. */
export function partQuat(p: PartPlacement): Quat {
  const { x, y, z } = partAxes(p);
  return quatFromAxes(x, y, z);
}

/** Quaternion of the rotation whose matrix has columns `x`, `y` and `z`. */
export function quatFromAxes(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m00, m01, m02] = [x.x, y.x, z.x];
  const [m10, m11, m12] = [x.y, y.y, z.y];
  const [m20, m21, m22] = [x.z, y.z, z.z];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
}

/**
 * The grid cell (x, z) under the part's own cell (lx, lz), for an upright part. For a part half
 * a stud off the grid, it is half way between cells too.
 */
function uprightCell(p: PartPlacement, lx: number, lz: number): { x: number; z: number } {
  const t = BRICK_TYPES[p.type];
  const { w, d } = uprightSize(p);
  const { x: ax, z: az } = partAxes(p);
  const ox = lx + 0.5 - t.studsX / 2;
  const oz = lz + 0.5 - t.studsZ / 2;
  const cx = p.x + w / 2 + ox * ax.x + oz * az.x;
  const cz = p.z + d / 2 + ox * ax.z + oz * az.z;
  // Halves add up exactly, so no rounding is needed.
  return { x: cx - 0.5, z: cz - 0.5 };
}

/**
 * Grid columns (x, z) inside an upright part's box that its body leaves empty, as "x,z" keys:
 * the cells a quarter arc's hole takes in whole, where another part fits.
 */
export function emptyColumns(p: PartPlacement): Set<string> {
  const out = new Set<string>();
  const t = BRICK_TYPES[p.type];
  if (p.face || !t.hole) return out;
  for (let lx = 0; lx < t.studsX; lx++) {
    for (let lz = 0; lz < t.studsZ; lz++) {
      // The hole is round the (0, 0) corner; a cell is empty if its far corner is in it.
      if (Math.hypot(lx + 1, lz + 1) > t.hole) continue;
      const c = uprightCell(p, lx, lz);
      out.add(`${c.x},${c.z}`);
    }
  }
  return out;
}

/**
 * The grid columns (x, z) of an upright leaf plate's leaves (`canopy`): all its cells but the
 * first.
 */
export function leafColumns(p: PartPlacement): { x: number; z: number }[] {
  const t = BRICK_TYPES[p.type];
  if (p.face || !t.canopy) return [];
  const out: { x: number; z: number }[] = [];
  for (let lx = 0; lx < t.studsX; lx++)
    for (let lz = 0; lz < t.studsZ; lz++) if (lx || lz) out.push(uprightCell(p, lx, lz));
  return out;
}

/**
 * Whether `q` sits on the centre stud of the dish `dish`, inside its rim: an upright 1x1 on
 * its top, half a stud off the grid both ways at its middle.
 */
export function onCentreStud(q: PartPlacement, dish: PartPlacement): boolean {
  const t = BRICK_TYPES[dish.type];
  if (q.face || dish.face || t.studs !== 'centre') return false;
  const { w, d } = uprightSize(dish);
  const s = uprightSize(q);
  return (
    s.w === 1 &&
    s.d === 1 &&
    q.y === dish.y + t.plates &&
    q.x + 0.5 === dish.x + w / 2 &&
    q.z + 0.5 === dish.z + d / 2
  );
}

/**
 * The boxes a part's body fills, in metres in the grid's frame: its bounds, or for a part whose
 * hole leaves some columns empty (`emptyColumns`), a box per run of filled cells along its own z,
 * so the physics lets another part into the hole as the grid does.
 */
export function partSolids(p: PartPlacement): MetreBox[] {
  const bounds = partBounds(p);
  const empty = emptyColumns(p);
  if (empty.size === 0) return [bounds];
  const t = BRICK_TYPES[p.type];
  const filled = (lx: number, lz: number) => {
    const c = uprightCell(p, lx, lz);
    return !empty.has(`${c.x},${c.z}`);
  };
  const out: MetreBox[] = [];
  for (let lx = 0; lx < t.studsX; lx++) {
    for (let lz = 0; lz < t.studsZ; lz++) {
      if (!filled(lx, lz) || (lz > 0 && filled(lx, lz - 1))) continue;
      let end = lz;
      while (end + 1 < t.studsZ && filled(lx, end + 1)) end++;
      const a = uprightCell(p, lx, lz);
      const b = uprightCell(p, lx, end);
      out.push({
        min: v3(Math.min(a.x, b.x) * STUD, bounds.min.y, Math.min(a.z, b.z) * STUD),
        max: v3((Math.max(a.x, b.x) + 1) * STUD, bounds.max.y, (Math.max(a.z, b.z) + 1) * STUD),
      });
    }
  }
  return out;
}

/**
 * How far each of a part's collision boxes is drawn in from its solids on every side, in metres,
 * so parts clutched side by side do not rub.
 */
export const COLLIDER_INSET = 0.003;

/**
 * The boxes a part collides by and is aimed at by, in metres in the grid's frame: its solids,
 * each drawn in by `COLLIDER_INSET` (and never thinner than 8 mm).
 */
export function partColliders(p: PartPlacement): MetreBox[] {
  const span = (lo: number, hi: number) => {
    const c = (lo + hi) / 2;
    const h = Math.max((hi - lo) / 2 - COLLIDER_INSET, 0.004);
    return [c - h, c + h] as const;
  };
  return partSolids(p).map(({ min, max }) => {
    const [x0, x1] = span(min.x, max.x);
    const [y0, y1] = span(min.y, max.y);
    const [z0, z1] = span(min.z, max.z);
    return { min: v3(x0, y0, z0), max: v3(x1, y1, z1) };
  });
}

/**
 * Grid columns (x, z) where an upright part has a stud on top, half way between columns for a
 * part half a stud off the grid or a dish's centre stud. Sideways parts have none.
 */
export function topStudCells(p: PartPlacement): { x: number; z: number }[] {
  if (p.face) return [];
  const t = BRICK_TYPES[p.type];
  const out: { x: number; z: number }[] = [];
  if (t.studs === 'centre') {
    const { w, d } = uprightSize(p);
    return [{ x: p.x + w / 2 - 0.5, z: p.z + d / 2 - 0.5 }];
  }
  for (let lx = 0; lx < t.studsX; lx++) {
    for (let lz = 0; lz < t.studsZ; lz++) {
      if (hasTopStud(p.type, lx, lz)) out.push(uprightCell(p, lx, lz));
    }
  }
  return out;
}

/**
 * Where an upright part's bottom can take a stud, as the columns (x, z) of those studs, like
 * `topStudCells`. An ordinary part takes one under each of its cells, each on its own (`under`).
 * A part with a centre hollow takes the stud right under the hollow, or wedges between the four
 * studs round it, which holds only with all four there (`around`), whatever the part's size.
 */
export function bottomGrips(p: PartPlacement): {
  under: { x: number; z: number }[];
  around: { x: number; z: number }[];
} {
  if (p.face) return { under: [], around: [] };
  const { w, d } = uprightSize(p);
  if (BRICK_TYPES[p.type].bottom === 'first') return { under: [uprightCell(p, 0, 0)], around: [] };
  if (hasCentreHollow(p.type)) {
    const x = p.x + w / 2 - 0.5;
    const z = p.z + d / 2 - 0.5;
    const around = [-0.5, 0.5].flatMap((dx) => [-0.5, 0.5].map((dz) => ({ x: x + dx, z: z + dz })));
    return { under: [{ x, z }], around };
  }
  const under: { x: number; z: number }[] = [];
  const empty = emptyColumns(p);
  for (let i = 0; i < w; i++)
    for (let j = 0; j < d; j++)
      if (!empty.size || !empty.has(`${p.x + i},${p.z + j}`))
        under.push({ x: p.x + i, z: p.z + j });
  return { under, around: [] };
}

/** A side stud in the grid: the cell it sits on, the way it points and its centre height. */
export interface PlacedSideStud {
  x: number;
  z: number;
  dir: Facing;
  /** Height of its centre, in plates (it may be between layers). */
  y: number;
  /** How far its base stands out from the cell's side, in plates (see `SideStud.out`). */
  out: number;
}

/** Turns a face direction the way an upright part's rotation turns it. */
function turnFace(face: Facing, p: PartPlacement): Facing {
  const { x, z } = partAxes(p);
  const local = faceVector(face);
  return faceOf(v3(local.x * x.x + local.z * z.x, 0, local.x * x.z + local.z * z.z))!;
}

/** The side studs of an upright part, in the grid. */
export function sideStudsOf(p: PartPlacement): PlacedSideStud[] {
  if (p.face) return [];
  const studs = BRICK_TYPES[p.type].sideStuds ?? [];
  return studs.map((s) => ({
    ...uprightCell(p, s.x, s.z),
    dir: turnFace(s.dir, p),
    y: p.y + s.y,
    out: s.out ?? 0,
  }));
}

/** Heights (in plates) a sideways part reaches, exactly: bottom and top. */
export function sidewaysSpan(p: PartPlacement): { y0: number; y1: number } {
  const { up } = sidewaysSize(p);
  return { y0: p.y, y1: p.y + up * PLATES_PER_STUD };
}

/** Studs a sideways part offers along the side and up, for snapping it onto side studs. */
export function sidewaysStudGrid(p: PartPlacement): { along: number; up: number } {
  return sidewaysSize(p);
}

/**
 * Whether the sideways part `p` takes the side stud `s`: it faces the same way from the cell
 * in front of the stud, one of its own stud spots (a stud's width apart, the first half a
 * stud up from its bottom) is right over it, and its back is where the stud's base is. A
 * part a fraction of a stud off, or flat against a side whose studs are set back or stand
 * out, does not clutch it.
 */
export function clipsOnto(p: PartPlacement, s: PlacedSideStud): boolean {
  if (!p.face || p.face !== s.dir) return false;
  const v = faceVector(s.dir);
  const b = partBox(p);
  const inFront = v.x
    ? b.x0 === s.x + v.x && s.z >= b.z0 && s.z < b.z1
    : b.z0 === s.z + v.z && s.x >= b.x0 && s.x < b.x1;
  if (!inFront) return false;
  const { up } = sidewaysSize(p);
  const k = (s.y - p.y) / PLATES_PER_STUD - 0.5;
  if (Math.abs(k - Math.round(k)) > EPS || k < -EPS || k > up - 1 + EPS) return false;
  return Math.abs(sidewaysOut(p) - s.out) < EPS;
}
