import { BRICK_TYPES, COLOURS } from '../bricks.ts';
import { BrickGrid } from '../grid.ts';
import type { PlacedBrick } from '../grid.ts';
import type { TargetBuild } from './types.ts';

export interface BuildProblem {
  step: number;
  brick: number;
  message: string;
}

/**
 * Checks that a build can be made on the 16x16 baseplate by following its steps in order:
 * every brick is a real type and colour, stays on the plate, does not overlap, and clutches
 * something that is already there when its step comes up.
 */
export function validateBuild(build: TargetBuild): BuildProblem[] {
  const problems: BuildProblem[] = [];
  const grid = BrickGrid.from([
    { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
  ]);
  let id = 1;
  build.steps.forEach((step, s) => {
    if (step.bricks.length === 0) problems.push({ step: s, brick: -1, message: 'step is empty' });
    step.bricks.forEach((b, i) => {
      const fail = (message: string) => problems.push({ step: s, brick: i, message });
      const type = BRICK_TYPES[b.type];
      if (!type || type.fixture) return fail(`unknown brick type "${b.type}"`);
      if (!COLOURS[b.colour]) return fail(`unknown colour "${b.colour}"`);
      if (b.y < 1) return fail('below the baseplate');
      const r = grid.add({ ...b, id: id++ });
      if (!r.ok)
        fail(r.reason === 'overlap' ? 'overlaps another brick' : 'not attached to anything');
    });
  });
  return problems;
}

/**
 * Puts a step's bricks in an order they can be added in: each clutches something already in
 * `grid` or added before it, lowest first wherever there is a choice. A part clipped on
 * sideways can hang lower than the studs that hold it, so plain bottom-up is not enough. Adds
 * them to `grid` as it goes; any brick that never attaches comes last, bottom up.
 */
export function attachOrder<T extends PlacedBrick>(grid: BrickGrid, bricks: readonly T[]): T[] {
  const left = [...bricks].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
  const order: T[] = [];
  for (;;) {
    const i = left.findIndex((b) => grid.add(b).ok);
    if (i < 0) return [...order, ...left];
    order.push(...left.splice(i, 1));
  }
}
