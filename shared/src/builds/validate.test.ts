import { describe, expect, it } from 'vitest';
import { LIGHTHOUSE } from './lighthouse.ts';
import { validateBuild } from './validate.ts';
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
