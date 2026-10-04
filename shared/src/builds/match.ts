import { BRICK_TYPES, COLOURS, footprint } from '../bricks.ts';
import type { BrickGrid, PlacedBrick } from '../grid.ts';
import { allBricks } from './types.ts';
import type { TargetBrick, TargetBuild } from './types.ts';

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

const sameCells = (a: TargetBrick | PlacedBrick, b: TargetBrick | PlacedBrick) => {
  const fa = footprint(a.type, a.rot);
  const fb = footprint(b.type, b.rot);
  return a.x === b.x && a.y === b.y && a.z === b.z && fa.w === fb.w && fa.d === fb.d;
};

const overlaps = (a: TargetBrick, b: PlacedBrick) => {
  const fa = footprint(a.type, a.rot);
  const fb = footprint(b.type, b.rot);
  const ha = BRICK_TYPES[a.type].plates;
  const hb = BRICK_TYPES[b.type].plates;
  return (
    a.x < b.x + fb.w &&
    b.x < a.x + fa.w &&
    a.z < b.z + fb.d &&
    b.z < a.z + fa.d &&
    a.y < b.y + hb &&
    b.y < a.y + ha
  );
};

/**
 * Compares a real build (grid in baseplate coordinates, baseplate included) with its target.
 *
 * Per target brick: `correct` is the right type, colour and position. `close` is a near
 * miss: right spot with a look-alike colour, or a look-alike type at the same corner.
 * `wrong` means something else sits there, `missing` means nothing does.
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
      if (exact.colour === t.colour) return { target: t, status: 'correct', actualId: exact.id };
      const close = COLOURS[t.colour].nearMiss.includes(exact.colour);
      return { target: t, status: close ? 'close' : 'wrong', actualId: exact.id };
    }
    const lookAlike = free(
      (a) =>
        BRICK_TYPES[t.type].nearMiss.includes(a.type) &&
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
