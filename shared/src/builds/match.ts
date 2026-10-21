import { BRICK_TYPES, COLOURS, sameTurn } from '../bricks.ts';
import { orientationKey, orientationOf, samePlacement } from '../lattice.ts';
import { partAxes, partBox, placedReach } from '../parts.ts';
import { frameKey } from '../frames.ts';
import type { BrickGrid, PlacedBrick } from '../grid.ts';
import { allBricks, PRINT_SIDES, printKey } from './types.ts';
import type { PrintSide, TargetBrick, TargetBuild } from './types.ts';

export type BrickStatus = 'correct' | 'close' | 'wrong' | 'missing';

export interface BrickVerdict {
  target: TargetBrick & { step: number };
  status: BrickStatus;
  /** The brick in the real build that was compared against, if any. */
  actualId?: number;
}

export type StepVerdict = 'correct' | 'partial' | 'wrong' | 'empty';

export interface MatchResult {
  bricks: BrickVerdict[];
  /** Ids of bricks in the real build that are not part of the target. */
  extras: number[];
  steps: StepVerdict[];
  counts: Record<BrickStatus, number> & { extra: number; total: number };
  /** 0..1, close bricks count half. */
  score: number;
  passed: boolean;
}

/** Share of bricks that must be exactly right for the builders to win. */
export const PASS_FRACTION = 0.95;
/** Stray bricks tolerated on a winning build. */
export const MAX_EXTRAS = 1;

/**
 * Same cells, the same way up, and turned so it looks the same (a slope facing the same way). A
 * turned part is the same as any placement with its studs, receivers and body in the same place.
 */
export const sameCells = (a: TargetBrick | PlacedBrick, b: TargetBrick | PlacedBrick) => {
  // Turned 45° off the grid: on the same lattice, and the same there.
  if (a.frame || b.frame)
    return frameKey(a.frame) === frameKey(b.frame) && a.type === b.type && samePlacement(a, b);
  const ba = partBox(a);
  const bb = partBox(b);
  if (a.orient || b.orient)
    return a.type === b.type
      ? samePlacement(a, b)
      : orientationKey(orientationOf(a)) === orientationKey(orientationOf(b)) &&
          ba.x0 === bb.x0 &&
          ba.y0 === bb.y0 &&
          ba.z0 === bb.z0 &&
          ba.x1 === bb.x1 &&
          ba.y1 === bb.y1 &&
          ba.z1 === bb.z1;
  return (
    (a.face ?? null) === (b.face ?? null) &&
    a.x === b.x &&
    a.z === b.z &&
    ba.x0 === bb.x0 &&
    ba.y0 === bb.y0 &&
    ba.z0 === bb.z0 &&
    ba.x1 === bb.x1 &&
    ba.y1 === bb.y1 &&
    ba.z1 === bb.z1 &&
    (a.type !== b.type || sameTurn(a.type, a.rot, b.rot))
  );
};

/** Each printed side's outward direction and its picture's up, in the part's own frame. */
const PRINT_FRAME: Record<PrintSide, [[number, number, number], [number, number, number]]> = {
  top: [
    [0, 1, 0],
    [0, 0, 1],
  ],
  bottom: [
    [0, -1, 0],
    [0, 0, 1],
  ],
  front: [
    [0, 0, 1],
    [0, 1, 0],
  ],
  back: [
    [0, 0, -1],
    [0, 1, 0],
  ],
  right: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  left: [
    [-1, 0, 0],
    [0, 1, 0],
  ],
};

/** Where each picture ends up in the grid, and which way up: the same for two parts showing them alike. */
function printsAsPlaced(b: TargetBrick | PlacedBrick): string {
  const { x, y, z } = partAxes(b);
  const toGrid = ([i, j, k]: [number, number, number]) =>
    [0, 1, 2].map((n) => {
      const axis = (['x', 'y', 'z'] as const)[n]!;
      return i * x[axis] + j * y[axis] + k * z[axis] + 0;
    });
  return PRINT_SIDES.filter((side) => b.prints?.[side])
    .map((side) => {
      const [out, up] = PRINT_FRAME[side];
      return `${toGrid(out).join()}/${toGrid(up).join()}:${b.prints![side]}`;
    })
    .sort()
    .join(';');
}

/**
 * Same prints, but turned so they show on other sides or the wrong way up (a symmetric brick
 * placed a half turn round): the UV printer's work is in the wrong place.
 */
export const printTurnedWrong = (a: TargetBrick | PlacedBrick, b: TargetBrick | PlacedBrick) =>
  !!a.prints &&
  printKey(a.prints) === printKey(b.prints) &&
  printsAsPlaced(a) !== printsAsPlaced(b);

const overlaps = (a: TargetBrick, b: PlacedBrick) => {
  if (a.frame || b.frame) {
    // Round their turned boxes, a little in from them.
    const [ra, rb] = [placedReach(a), placedReach(b)];
    const e = 0.01;
    return (['x', 'y', 'z'] as const).every(
      (k) => ra.min[k] + e < rb.max[k] && rb.min[k] + e < ra.max[k],
    );
  }
  const ba = partBox(a);
  const bb = partBox(b);
  return (
    ba.x0 < bb.x1 &&
    bb.x0 < ba.x1 &&
    ba.z0 < bb.z1 &&
    bb.z0 < ba.z1 &&
    ba.y0 < bb.y1 &&
    bb.y0 < ba.y1
  );
};

/**
 * Compares a real build (grid in baseplate coordinates, baseplate included) with its target.
 *
 * Per target brick: `correct` is the right type, colour, position and prints. `close` is a
 * near miss: right spot with a look-alike colour or without the right print, or a look-alike
 * type at the same corner.
 * `wrong` means something else sits there, or the right printed part turned so its prints face
 * the wrong way; `missing` means nothing does.
 */
export function matchBuild(target: TargetBuild, grid: BrickGrid): MatchResult {
  const actual = [...grid.bricks.values()].filter((b) => !BRICK_TYPES[b.type].fixture);
  const used = new Set<number>();
  const free = (pred: (a: PlacedBrick) => boolean) =>
    actual.find((a) => !used.has(a.id) && pred(a));

  const bricks: BrickVerdict[] = allBricks(target).map((t) => {
    const exact = free((a) => a.type === t.type && sameCells(a, t));
    if (exact) {
      used.add(exact.id);
      // Right but for its print (none, or another): it still looks nearly right.
      if (exact.colour === t.colour && printKey(exact.prints) !== printKey(t.prints))
        return { target: t, status: 'close', actualId: exact.id };
      if (printTurnedWrong(exact, t)) return { target: t, status: 'wrong', actualId: exact.id };
      if (exact.colour === t.colour) return { target: t, status: 'correct', actualId: exact.id };
      const close = COLOURS[t.colour].nearMiss.includes(exact.colour);
      return { target: t, status: close ? 'close' : 'wrong', actualId: exact.id };
    }
    const lookAlike = free(
      (a) =>
        BRICK_TYPES[t.type].nearMiss.includes(a.type) &&
        (a.face ?? null) === (t.face ?? null) &&
        (a.orient ?? null) === (t.orient ?? null) &&
        frameKey(a.frame) === frameKey(t.frame) &&
        a.x === t.x &&
        a.y === t.y &&
        a.z === t.z &&
        (a.colour === t.colour || COLOURS[t.colour].nearMiss.includes(a.colour)),
    );
    if (lookAlike) {
      used.add(lookAlike.id);
      return { target: t, status: 'close', actualId: lookAlike.id };
    }
    const intruder = free((a) => overlaps(t, a));
    if (intruder) {
      used.add(intruder.id);
      return { target: t, status: 'wrong', actualId: intruder.id };
    }
    return { target: t, status: 'missing' };
  });

  const extras = actual.filter((a) => !used.has(a.id)).map((a) => a.id);
  const counts = { correct: 0, close: 0, wrong: 0, missing: 0, extra: extras.length, total: 0 };
  for (const v of bricks) counts[v.status]++;
  counts.total = bricks.length;

  const steps: StepVerdict[] = target.steps.map((_, i) => {
    const mine = bricks.filter((v) => v.target.step === i);
    if (mine.every((v) => v.status === 'correct')) return 'correct';
    if (mine.every((v) => v.status === 'missing')) return 'empty';
    if (mine.some((v) => v.status === 'wrong' || v.status === 'close')) return 'wrong';
    return 'partial';
  });

  const score = counts.total ? (counts.correct + counts.close / 2) / counts.total : 0;
  const passed =
    counts.correct >= Math.ceil(PASS_FRACTION * counts.total) && extras.length <= MAX_EXTRAS;
  return { bricks, extras, steps, counts, score, passed };
}
