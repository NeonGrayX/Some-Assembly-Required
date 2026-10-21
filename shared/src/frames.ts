import { PLATE_H, STUD } from './bricks.ts';
import type { Axis, Orientation } from './lattice.ts';
import {
  ORIENTATIONS,
  applyOrientation,
  axisOf,
  axisVector,
  composeOrientations,
  invertOrientation,
  orientationByKey,
  orientationKey,
  orientationOf,
  plainPlacement,
} from './lattice.ts';
import type { Quat, Vec3 } from './math.ts';
import { v3 } from './math.ts';
import type { PartPlacement } from './parts.ts';
import { partBounds, quatFromAxes } from './parts.ts';

/*
 * Parts turned 45° about a stud, and the parts built onto them, sit on a lattice of their own:
 * a frame, turned and moved off the grid's. Inside one frame everything is as on the grid
 * (studs, receivers and boxes on the lattice, see lattice.ts); a part's `frame` says where its
 * frame is in the grid. Turning by 45° about grid axes only ever needs whole numbers, halves,
 * quarters and so on, and √2 times those, so a frame is kept exactly as such numbers (`Surd`):
 * two parts turned the same way about the same studs land in the very same frame, and a stud of
 * one meets a receiver of another exactly where they line up, whatever frames they are in.
 */

/** The number a + b√2, where a and b are whole numbers, halves, quarters and so on. */
export type Surd = readonly [a: number, b: number];

const ZERO: Surd = [0, 0];
const ONE: Surd = [1, 0];
/** cos 45° and sin 45°: √2 / 2. */
const HALF_ROOT: Surd = [0, 0.5];

const add = (p: Surd, q: Surd): Surd => [p[0] + q[0], p[1] + q[1]];
const neg = (p: Surd): Surd => [-p[0] || 0, -p[1] || 0];
const mul = (p: Surd, q: Surd): Surd => [
  p[0] * q[0] + 2 * p[1] * q[1] || 0,
  p[0] * q[1] + p[1] * q[0] || 0,
];
const num = (n: number): Surd => [n || 0, 0];

/** A surd's value. */
export const surdValue = (p: Surd): number => p[0] + p[1] * Math.SQRT2;

/** A point or direction worked out exactly. */
export type SurdVec = readonly [Surd, Surd, Surd];

/** A surd vector as one string: the same for the same point exactly. */
export const surdVecKey = (v: SurdVec): string =>
  `${v[0][0]},${v[0][1]},${v[1][0]},${v[1][1]},${v[2][0]},${v[2][1]}`;

/** The vector's value, if it has no √2 in it: a point of the lattice it is on. */
export function rational(v: SurdVec): Vec3 | null {
  if (v[0][1] || v[1][1] || v[2][1]) return null;
  return v3(v[0][0], v[1][0], v[2][0]);
}

/**
 * Where a frame is in the grid: what it turns its own x, y and z axes into (`m`, row by row, so
 * `m[3 * i + j]` is row i, column j), and where its origin is (`t`), in LDU.
 */
export interface Frame {
  m: readonly Surd[];
  t: readonly Surd[];
}

/** A turn square to the lattice and a move by whole LDU: a frame the lattice already has. */
export interface LatticeMove {
  o: Orientation;
  d: Vec3;
}

/** The frame that turns as `o` and moves by `d` (in LDU). */
export function latticeFrame(o: Orientation, d: Vec3 = v3()): Frame {
  const cols = [axisVector(o.x), axisVector(o.y), axisVector(o.z)];
  const m: Surd[] = [];
  for (const i of ['x', 'y', 'z'] as const) for (const c of cols) m.push(num(c[i]));
  return { m, t: [num(d.x), num(d.y), num(d.z)] };
}

/** Not turned (looked up when needed: lattice.ts may still be loading when this is). */
const unturned = () => ORIENTATIONS[0]!;

/** The frame a part turned by `eighths` of a turn about the stud at `pivot` pointing `axis` is in. */
export function spinFrame(pivot: Vec3, axis: Axis, eighths = 1): Frame {
  // Rodrigues' rotation about the unit axis u: c I + s [u]x + (1 - c) u uᵀ.
  const turns = ((eighths % 8) + 8) % 8;
  const cs: [Surd, Surd][] = [
    [ONE, ZERO],
    [HALF_ROOT, HALF_ROOT],
    [ZERO, ONE],
    [neg(HALF_ROOT), HALF_ROOT],
    [num(-1), ZERO],
    [neg(HALF_ROOT), neg(HALF_ROOT)],
    [ZERO, num(-1)],
    [HALF_ROOT, neg(HALF_ROOT)],
  ];
  const [c, s] = cs[turns]!;
  const u = axisVector(axis);
  const uv = [u.x, u.y, u.z];
  const cross = [
    [0, -u.z, u.y],
    [u.z, 0, -u.x],
    [-u.y, u.x, 0],
  ];
  const m: Surd[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let e = add(mul(s, num(cross[i]![j]!)), mul(add(ONE, neg(c)), num(uv[i]! * uv[j]!)));
      if (i === j) e = add(e, c);
      m.push(e);
    }
  // About the pivot: it stays where it is.
  const p = [num(pivot.x), num(pivot.y), num(pivot.z)];
  const r = mulVec(m, p);
  return { m, t: [add(p[0]!, neg(r[0])), add(p[1]!, neg(r[1])), add(p[2]!, neg(r[2]))] };
}

function mulVec(m: readonly Surd[], v: readonly Surd[]): SurdVec {
  const row = (i: number) =>
    add(add(mul(m[3 * i]!, v[0]!), mul(m[3 * i + 1]!, v[1]!)), mul(m[3 * i + 2]!, v[2]!));
  return [row(0), row(1), row(2)];
}

/** `a` after `b`: what is in `b` and `b` in `a`, as one frame. */
export function composeFrames(a: Frame, b: Frame): Frame {
  const m: Surd[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      m.push(
        add(
          add(mul(a.m[3 * i]!, b.m[j]!), mul(a.m[3 * i + 1]!, b.m[3 + j]!)),
          mul(a.m[3 * i + 2]!, b.m[6 + j]!),
        ),
      );
  const r = mulVec(a.m, b.t);
  return { m, t: [add(r[0], a.t[0]!), add(r[1], a.t[1]!), add(r[2], a.t[2]!)] };
}

/** The frame that undoes `f`. */
export function invertFrame(f: Frame): Frame {
  const m: Surd[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(f.m[3 * j + i]!);
  const r = mulVec(m, f.t);
  return { m, t: [neg(r[0]), neg(r[1]), neg(r[2])] };
}

/** A point of the frame's own lattice (in LDU), in the grid. */
export function framePoint(f: Frame, v: Vec3): SurdVec {
  const r = mulVec(f.m, [num(v.x), num(v.y), num(v.z)]);
  return [add(r[0], f.t[0]!), add(r[1], f.t[1]!), add(r[2], f.t[2]!)];
}

/** A point given exactly in one frame, in another (`f` the frame it is put into, inverted). */
export function framePointOf(f: Frame, v: SurdVec): SurdVec {
  const r = mulVec(f.m, v);
  return [add(r[0], f.t[0]!), add(r[1], f.t[1]!), add(r[2], f.t[2]!)];
}

/** A direction of the frame's own lattice, in the grid. */
export function frameDir(f: Frame, a: Axis): SurdVec {
  const u = axisVector(a);
  return mulVec(f.m, [num(u.x), num(u.y), num(u.z)]);
}

/** The direction exactly along a grid axis, if it is one. */
export function axisOfDir(v: SurdVec): Axis | null {
  const r = rational(v);
  if (!r || Math.abs(r.x) + Math.abs(r.y) + Math.abs(r.z) !== 1) return null;
  return axisOf(r);
}

/** The turn and move the frame makes, if the lattice has it: no 45° in it, moved whole LDU. */
export function latticeMove(f: Frame): LatticeMove | null {
  if (f.m.some((e) => e[1] || (e[0] !== 0 && e[0] !== 1 && e[0] !== -1))) return null;
  if (f.t.some((e) => e[1] || !Number.isInteger(e[0]))) return null;
  const col = (j: number) => v3(f.m[j]![0], f.m[3 + j]![0], f.m[6 + j]![0]);
  const o = orientationByKey(axisOf(col(1)) + axisOf(col(0)));
  if (!o) return null;
  return { o, d: v3(f.t[0]![0], f.t[1]![0], f.t[2]![0]) };
}

/** A frame as one string: the same for the same frame exactly. */
export function frameKey(f: Frame | undefined): string {
  if (!f) return '';
  return [...f.m, ...f.t].map((e) => `${e[0]},${e[1]}`).join(';');
}

/** A frame as the 24 numbers a file or message carries: a and b of each of `m`, then `t`. */
export function encodeFrame(f: Frame): number[] {
  return [...f.m, ...f.t].flatMap((e) => [e[0], e[1]]);
}

/** A frame from `encodeFrame`'s numbers, if they make one: a true turn, with nothing stretched. */
export function decodeFrame(n: unknown): Frame | null {
  if (!Array.isArray(n) || n.length !== 24) return null;
  if (!n.every((e) => typeof e === 'number' && Number.isFinite(e))) return null;
  const s: Surd[] = [];
  for (let i = 0; i < 24; i += 2) s.push([n[i] as number, n[i + 1] as number]);
  const f = { m: s.slice(0, 9), t: s.slice(9) };
  // Its axes a unit long and square to each other, exactly, and right-handed.
  const prod = composeFrames(
    { m: f.m, t: [ZERO, ZERO, ZERO] },
    invertFrame({ m: f.m, t: [ZERO, ZERO, ZERO] }),
  );
  for (let i = 0; i < 9; i++) {
    const want = i % 4 === 0 ? 1 : 0;
    if (prod.m[i]![0] !== want || prod.m[i]![1] !== 0) return null;
  }
  return det(f.m) > 0 ? f : null;
}

function det(m: readonly Surd[]): number {
  const v = m.map(surdValue);
  return (
    v[0]! * (v[4]! * v[8]! - v[5]! * v[7]!) -
    v[1]! * (v[3]! * v[8]! - v[5]! * v[6]!) +
    v[2]! * (v[3]! * v[7]! - v[4]! * v[6]!)
  );
}

/** Metres per LDU: a stud is 20 across, a plate 8 up, and they come out the same. */
export const METRES_PER_LDU = STUD / 20;
if (Math.abs(PLATE_H / 8 - METRES_PER_LDU) > 1e-12) throw new Error('LDU are not square');

/** The turn a frame makes. */
export function frameQuat(f: Frame): Quat {
  const v = f.m.map(surdValue);
  return quatFromAxes(v3(v[0], v[3], v[6]), v3(v[1], v[4], v[7]), v3(v[2], v[5], v[8]));
}

/** A point in the frame, in metres, in the grid, in metres. */
export function frameMetres(f: Frame, p: Vec3): Vec3 {
  const v = f.m.map(surdValue);
  const t = f.t.map((e) => surdValue(e) * METRES_PER_LDU);
  return v3(
    v[0]! * p.x + v[1]! * p.y + v[2]! * p.z + t[0]!,
    v[3]! * p.x + v[4]! * p.y + v[5]! * p.z + t[1]!,
    v[6]! * p.x + v[7]! * p.y + v[8]! * p.z + t[2]!,
  );
}

/** A direction in the frame, in the grid. */
export function frameTurn(f: Frame, d: Vec3): Vec3 {
  const v = f.m.map(surdValue);
  return v3(
    v[0]! * d.x + v[1]! * d.y + v[2]! * d.z,
    v[3]! * d.x + v[4]! * d.y + v[5]! * d.z,
    v[6]! * d.x + v[7]! * d.y + v[8]! * d.z,
  );
}

/**
 * The same part moved by a lattice move: turned by `o` about the origin, then moved by `d` (in
 * LDU). It comes back upright or sideways where those can say it (see `plainPlacement`).
 */
export function movePlacement<T extends PartPlacement>(p: T, o: Orientation, d: Vec3): T {
  const { min, max } = partBounds(p);
  const toLdu = (m: Vec3) => v3(m.x / METRES_PER_LDU, m.y / METRES_PER_LDU, m.z / METRES_PER_LDU);
  const a = applyOrientation(o, toLdu(min));
  const b = applyOrientation(o, toLdu(max));
  const lo = (k: 'x' | 'y' | 'z') => Math.round(Math.min(a[k], b[k]) + d[k]);
  const orient = orientationKey(composeOrientations(o, orientationOf(p)));
  const { face: _f, orient: _o, frame: _fr, ...rest } = p;
  const moved = {
    ...rest,
    rot: 0,
    orient,
    x: lo('x') / 20,
    y: lo('y') / 8,
    z: lo('z') / 20,
  } as T;
  const plain = plainPlacement(moved);
  if (plain === moved) return moved;
  // `plainPlacement` gives back only where and how it sits.
  const { face, orient: o2, ...at } = plain;
  const out = { ...rest, ...at } as T;
  if (face) out.face = face;
  if (o2) out.orient = o2;
  return out;
}

/** The four quarter turns about a frame's own up. */
const upright = () => ORIENTATIONS.filter((o) => o.y === '+y');

/**
 * A part as its frame is best said: on the grid itself when its frame turns square to the
 * lattice by whole LDU (two 45° turns about the same line make a quarter turn); otherwise in the
 * one frame of the lattice it is on, so parts on the same lattice always share a frame. Of the
 * frames that differ by a quarter turn about their own up, the one turned least is kept (by its
 * trace; of two turned as far either way, the one turned as a part's `rot` turns it, then by its
 * key), moved by whole cells (20, 8 and 20 LDU) to have its origin's place in the first cell of
 * its own lattice.
 */
export function canonicalPlacement<T extends PartPlacement>(p: T): T {
  const f = p.frame;
  if (!f) return p;
  const move = latticeMove(f);
  if (move) return movePlacement(p, move.o, move.d);
  let best: { f: Frame; o: Orientation; trace: number; sin: number; key: string } | null = null;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  for (const o of upright()) {
    const g = composeFrames(f, latticeFrame(o));
    const trace = surdValue(g.m[0]!) + surdValue(g.m[4]!) + surdValue(g.m[8]!);
    // How far it turns x toward -z, as `rot` does (twice the sine, about up).
    const sin = surdValue(g.m[2]!) - surdValue(g.m[6]!);
    const key = frameKey(g);
    const better =
      !best ||
      trace > best.trace + 1e-9 ||
      (near(trace, best.trace) &&
        (sin > best.sin + 1e-9 || (near(sin, best.sin) && key < best.key)));
    if (better) best = { f: g, o, trace, sin, key };
  }
  const g = best!.f;
  // The origin's place in its own lattice, put into the first cell.
  const u = framePointOf(invertFrame({ m: g.m, t: [ZERO, ZERO, ZERO] }), g.t as SurdVec);
  const cell = (e: Surd, size: number) => -size * Math.floor(surdValue(e) / size + 1e-12);
  const d = v3(cell(u[0], 20), cell(u[1], 8), cell(u[2], 20));
  const can = composeFrames(g, latticeFrame(unturned(), d));
  // In the new frame, the part is where `o` then the move undoes: turned back, moved back.
  const local = movePlacement(p, invertOrientation(best!.o), v3());
  const out = movePlacement(local, unturned(), v3(-d.x, -d.y, -d.z));
  out.frame = can;
  return out;
}

/** A point in the grid, in metres, in the frame, in metres: what `frameMetres` undoes. */
export function unframeMetres(f: Frame, p: Vec3): Vec3 {
  const v = f.m.map(surdValue);
  const t = f.t.map((e) => surdValue(e) * METRES_PER_LDU);
  const d = v3(p.x - t[0]!, p.y - t[1]!, p.z - t[2]!);
  return v3(
    v[0]! * d.x + v[3]! * d.y + v[6]! * d.z,
    v[1]! * d.x + v[4]! * d.y + v[7]! * d.z,
    v[2]! * d.x + v[5]! * d.y + v[8]! * d.z,
  );
}

/** A direction in the grid, in the frame: what `frameTurn` undoes. */
export function unframeTurn(f: Frame, d: Vec3): Vec3 {
  const v = f.m.map(surdValue);
  return v3(
    v[0]! * d.x + v[3]! * d.y + v[6]! * d.z,
    v[1]! * d.x + v[4]! * d.y + v[7]! * d.z,
    v[2]! * d.x + v[5]! * d.y + v[8]! * d.z,
  );
}
