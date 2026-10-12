import { describe, expect, it } from 'vitest';
import { TEST_LIGHTHOUSE as LIGHTHOUSE } from './testing.ts';
import { attachOrder, validateBuild } from './validate.ts';
import { BUILDS } from './catalog.ts';
import { BrickGrid } from '../grid.ts';
import type { TargetBuild } from './types.ts';

describe('validateBuild', () => {
  it('accepts the lighthouse', () => {
    expect(validateBuild(LIGHTHOUSE)).toEqual([]);
  });

  it('reports floating, overlapping and out-of-order bricks', () => {
    const build: TargetBuild = {
      id: 't',
      name: 'Test',
      steps: [
        {
          bricks: [
            { type: '2x4', colour: 'red', x: 0, y: 1, z: 0, rot: 0 },
            { type: '1x1', colour: 'red', x: 0, y: 1, z: 0, rot: 0 },
          ],
        },
        // Floating until the step after it is built.
        { bricks: [{ type: '1x1', colour: 'red', x: 10, y: 7, z: 10, rot: 0 }] },
        { bricks: [] },
      ],
    };
    expect(validateBuild(build).map((p) => [p.step, p.message])).toEqual([
      [0, 'overlaps another brick'],
      [1, 'not attached to anything'],
      [2, 'step is empty'],
    ]);
  });
});

describe('attachOrder', () => {
  it('orders every catalogue build so that it validates, sideways parts and all', () => {
    for (const build of BUILDS) {
      const grid = BrickGrid.from([
        { id: 0, type: 'baseplate16', colour: 'baseplate-green', x: 0, y: 0, z: 0, rot: 0 },
      ]);
      let id = 1;
      const steps = build.steps.map((step) => ({
        bricks: attachOrder(
          grid,
          // Top down, the worst order to start from.
          [...step.bricks].reverse().map((b) => ({ ...b, id: id++ })),
        ).map(({ id: _, ...b }) => b),
      }));
      expect(validateBuild({ ...build, steps }), build.id).toEqual([]);
    }
  });
});
