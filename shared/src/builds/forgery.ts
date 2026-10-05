import { COLOURS } from '../bricks.ts';
import type { TargetBrick, TargetBuild } from './types.ts';
import { validateBuild } from './validate.ts';
import { lookAlikes } from './variant.ts';
import type { BinColours } from './variant.ts';

/** What a printed instruction page shows: the bricks it adds and the ink stamp on it. */
export interface PrintedPage {
  step: number;
  added: TargetBrick[];
  stamp: string;
}

/** Real stamp and the near-copy a forger has to make do with. */
export const STAMPS: [real: string, fake: string][] = [
  ['★', '✩'],
  ['♦', '◇'],
  ['♣', '♧'],
  ['♠', '♤'],
  ['●', '◉'],
  ['▲', '△'],
  ['✿', '❀'],
  ['☀', '☼'],
];

export function realPage(build: TargetBuild, step: number, stamp: string): PrintedPage {
  return { step, added: build.steps[step]!.bricks.map((b) => ({ ...b })), stamp };
}

/**
 * A forgery of a step: one brick changed so it is almost right. Usually a look-alike colour
 * (which shows up against the master index's parts list); otherwise the brick is moved one
 * stud, which only the stamp, the inspector or a sharp eye will catch.
 */
export function forgePage(
  build: TargetBuild,
  step: number,
  fakeStamp: string,
  rng: () => number,
  bins?: BinColours,
): PrintedPage {
  const page = realPage(build, step, fakeStamp);
  const i = Math.floor(rng() * page.added.length);
  const brick = page.added[i]!;
  if (rng() < 0.4) {
    const moved = shiftedPlacement(build, step, i, rng);
    if (moved) {
      page.added[i] = moved;
      return page;
    }
  }
  // A look-alike colour the team can actually get from a bin, so the forgery is buildable.
  const near = (
    bins ? lookAlikes(brick.type, brick.colour, bins) : COLOURS[brick.colour].nearMiss
  ).filter((c) => c !== brick.colour);
  if (near.length) {
    page.added[i] = { ...brick, colour: near[Math.floor(rng() * near.length)]! };
    return page;
  }
  const moved = shiftedPlacement(build, step, i, rng);
  page.added[i] = moved ?? { ...brick, colour: COLOURS[brick.colour].nearMiss[0] ?? brick.colour };
  return page;
}

/**
 * The brick moved by one stud, if the whole model can still be built that way: a forgery
 * should send the team down a wrong path, not ask for something impossible.
 */
function shiftedPlacement(
  build: TargetBuild,
  step: number,
  index: number,
  rng: () => number,
): TargetBrick | null {
  const brick = build.steps[step]!.bricks[index]!;
  const moves = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].sort(() => rng() - 0.5);
  for (const [dx, dz] of moves) {
    const moved = { ...brick, x: brick.x + dx!, z: brick.z + dz! };
    const steps = build.steps.map((s, i) =>
      i === step ? { bricks: s.bricks.map((b, j) => (j === index ? moved : b)) } : s,
    );
    if (validateBuild({ ...build, steps }).length === 0) return moved;
  }
  return null;
}

/** True if a printed page differs from the real one in any way. */
export function isForged(build: TargetBuild, page: PrintedPage, realStamp: string): boolean {
  if (page.stamp !== realStamp) return true;
  const real = build.steps[page.step]!.bricks;
  return (
    real.length !== page.added.length ||
    real.some((b, i) => JSON.stringify(b) !== JSON.stringify(page.added[i]))
  );
}
