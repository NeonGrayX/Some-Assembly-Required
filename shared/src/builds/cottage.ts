import type { TargetBuild } from './types.ts';
import { b, paginate } from './kit.ts';

/**
 * A little stone cottage, 35 bricks in 8 steps: a red door and lit yellow windows on the south and
 * east walls, a stepped red roof and a chimney.
 */
export const COTTAGE: TargetBuild = {
  id: 'cottage',
  name: 'Cottage',
  steps: paginate(
    [
      // Walls, three bricks high: the long walls run along x, the short ones along z.
      b('1x4', 'light-grey', 4, 1, 5),
      b('1x4', 'light-grey', 8, 1, 5),
      b('1x2', 'light-grey', 4, 1, 10),
      b('1x1', 'light-grey', 6, 1, 10),
      b('1x2', 'dark-red', 7, 1, 10),
      b('1x1', 'light-grey', 9, 1, 10),
      b('1x2', 'light-grey', 10, 1, 10),
      b('1x4', 'light-grey', 4, 1, 6, 1),
      b('1x4', 'light-grey', 11, 1, 6, 1),
      b('1x4', 'light-grey', 4, 4, 5, 1),
      b('1x2', 'light-grey', 4, 4, 9, 1),
      b('1x2', 'light-grey', 11, 4, 5, 1),
      b('1x2', 'yellow', 11, 4, 7, 1),
      b('1x2', 'light-grey', 11, 4, 9, 1),
      b('1x4', 'light-grey', 5, 4, 5),
      b('1x2', 'light-grey', 9, 4, 5),
      b('1x2', 'yellow', 5, 4, 10),
      b('1x2', 'dark-red', 7, 4, 10),
      b('1x2', 'light-grey', 9, 4, 10),
      b('1x4', 'light-grey', 4, 7, 5),
      b('1x4', 'light-grey', 8, 7, 5),
      b('1x4', 'light-grey', 4, 7, 10),
      b('1x4', 'light-grey', 8, 7, 10),
      b('1x4', 'light-grey', 4, 7, 6, 1),
      b('1x4', 'light-grey', 11, 7, 6, 1),
      // The roof steps in from both long walls.
      b('2x4', 'red', 4, 10, 5),
      b('2x4', 'red', 8, 10, 5),
      b('2x4', 'red', 4, 10, 9),
      b('2x4', 'red', 8, 10, 9),
      b('2x4', 'red', 4, 13, 6),
      b('2x4', 'red', 8, 13, 6),
      b('2x4', 'red', 4, 13, 8),
      b('2x4', 'red', 8, 13, 8),
      b('2x2', 'dark-red', 9, 16, 6),
      b('1x1', 'dark-grey', 10, 19, 7),
    ],
    8,
  ),
};
