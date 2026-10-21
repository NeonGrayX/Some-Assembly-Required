import { STUD_HEIGHT, STUD_REACH, studBox } from './lattice.ts';
import type { Axis, LatticeBox, LatticeStud, PartShape, Receiver } from './lattice.ts';
import type { Frame, SurdVec } from './frames.ts';
import { axisOfDir, frameDir, framePoint, surdValue, surdVecKey } from './frames.ts';
import type { Vec3 } from './math.ts';
import { v3 } from './math.ts';

/*
 * Parts on different lattices (see frames.ts), as the grid sees them: every stud and receiver
 * at its exact point and pointing its exact way in the grid, and every box turned with its
 * frame. A stud and a receiver meet across frames only exactly; boxes meet where they share
 * room by more than the little real parts leave between them (`ACROSS_SLACK`).
 */

/**
 * How far in, in LDU, a box is drawn on each side before it is tried against a box turned
 * another way: real parts are a tenth of a millimetre short of the lattice on every side, so a
 * 1x1 turned 45° on a stud clears the studs round it (a turned 1x1 reaches 13.8 LDU out from
 * its middle, those studs begin 14 out) and two plates on neighbouring sides of an octagon meet
 * only at their edges.
 */
export const ACROSS_SLACK = 0.25;

/** A box turned some way, in LDU: its middle, its own axes (unit long) and half its size along each. */
export interface TurnedLdu {
  c: Vec3;
  u: readonly [Vec3, Vec3, Vec3];
  e: readonly [number, number, number];
}

/** A stud or receiver at its exact point and direction in the grid. */
export interface PlacedPoint<T> {
  of: T;
  at: SurdVec;
  /** `at` as one string: the same for the same point. */
  key: string;
  /** The direction as one string. */
  dir: string;
  /** The direction, if it is along one of the grid's axes. */
  axis: Axis | null;
}

/** A part's shape as the grid sees it, for meeting parts on other lattices. */
export interface AcrossShape {
  studs: PlacedPoint<LatticeStud>[];
  receivers: PlacedPoint<Receiver>[];
  boxes: TurnedLdu[];
  /** The room each stud takes, in the order of `studs`. */
  studBoxes: TurnedLdu[];
  /** Round all of it, in the grid, grown by as far as a stud stands out. */
  bounds: LatticeBox;
}

const ROOT: Frame = {
  m: [
    [1, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [1, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [1, 0],
  ],
  t: [
    [0, 0],
    [0, 0],
    [0, 0],
  ],
};

/** The direction pointing the other way, as `PlacedPoint.dir` says it. */
export function oppositeDir(v: SurdVec): string {
  const n = (s: readonly [number, number]) => [-s[0] || 0, -s[1] || 0] as const;
  return surdVecKey([n(v[0]), n(v[1]), n(v[2])]);
}

/** The shape (on the lattice of `frame`, the grid's if none) as the grid sees it. */
export function acrossShape(shape: PartShape, frame: Frame | undefined): AcrossShape {
  const f = frame ?? ROOT;
  const m = f.m.map(surdValue);
  const axes: [Vec3, Vec3, Vec3] = [
    v3(m[0], m[3], m[6]),
    v3(m[1], m[4], m[7]),
    v3(m[2], m[5], m[8]),
  ];
  const turn = (b: LatticeBox, slack: number): TurnedLdu => {
    const mid = framePoint(
      f,
      v3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2),
    );
    return {
      c: v3(surdValue(mid[0]), surdValue(mid[1]), surdValue(mid[2])),
      u: axes,
      e: [
        Math.max((b.max.x - b.min.x) / 2 - slack, 0),
        Math.max((b.max.y - b.min.y) / 2 - slack, 0),
        Math.max((b.max.z - b.min.z) / 2 - slack, 0),
      ],
    };
  };
  const point = <T extends { at: Vec3; dir: Axis }>(of: T): PlacedPoint<T> => {
    const at = framePoint(f, of.at);
    const d = frameDir(f, of.dir);
    return { of, at, key: surdVecKey(at), dir: surdVecKey(d), axis: axisOfDir(d) };
  };
  const boxes = shape.boxes.map((b) => turn(b, ACROSS_SLACK));
  const studBoxes = shape.studs.map((s) => turn(studBox(s), ACROSS_SLACK));
  const lo = v3(Infinity, Infinity, Infinity);
  const hi = v3(-Infinity, -Infinity, -Infinity);
  for (const b of [...boxes, ...studBoxes])
    for (const k of ['x', 'y', 'z'] as const) {
      const r = b.u.reduce((s, u, i) => s + Math.abs(u[k]) * b.e[i]!, 0);
      lo[k] = Math.min(lo[k], b.c[k] - r);
      hi[k] = Math.max(hi[k], b.c[k] + r);
    }
  const pad = STUD_HEIGHT + STUD_REACH;
  return {
    studs: shape.studs.map(point),
    receivers: shape.receivers.map(point),
    boxes,
    studBoxes,
    bounds: {
      min: v3(lo.x - pad, lo.y - pad, lo.z - pad),
      max: v3(hi.x + pad, hi.y + pad, hi.z + pad),
    },
  };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3) =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** Whether two turned boxes share room: no plane between them along any of the 15 axes that could part them. */
export function turnedMeet(a: TurnedLdu, b: TurnedLdu): boolean {
  const d = v3(b.c.x - a.c.x, b.c.y - a.c.y, b.c.z - a.c.z);
  const axes: Vec3[] = [...a.u, ...b.u];
  for (const x of a.u)
    for (const y of b.u) {
      const c = cross(x, y);
      if (dot(c, c) > 1e-12) axes.push(c);
    }
  for (const n of axes) {
    const ra = a.u.reduce((s, u, i) => s + Math.abs(dot(u, n)) * a.e[i]!, 0);
    const rb = b.u.reduce((s, u, i) => s + Math.abs(dot(u, n)) * b.e[i]!, 0);
    // Touching is not meeting.
    if (Math.abs(dot(d, n)) >= ra + rb - 1e-9 * Math.sqrt(dot(n, n))) return false;
  }
  return true;
}
