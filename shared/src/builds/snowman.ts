import type { TargetBuild } from './types.ts';
import { b, paginate, pinwheel6, square4 } from './kit.ts';

/**
 * A snowman, 32 bricks in 8 steps: two snowballs, stick arms, a red scarf, a head with a carrot
 * nose and coal eyes on the south face, and a top hat.
 */
export const SNOWMAN: TargetBuild = {
  id: 'snowman',
  name: 'Snowman',
  steps: paginate(
    [
      ...pinwheel6('2x4', '2x2', 'white', 5, 1, 5),
      ...pinwheel6('2x4', '2x2', 'white', 5, 4, 5, true),
      ...square4(6, 7, 6, 'white', false),
      b('1x2', 'dark-red', 4, 7, 7),
      b('1x2', 'dark-red', 10, 7, 7),
      ...square4(6, 10, 6, 'white', true),
      ...square4(6, 13, 6, 'red', false),
      // The head: the carrot sticks out of the south face.
      b('2x4', 'white', 6, 16, 6),
      b('1x2', 'white', 6, 16, 8, 1),
      b('1x4', 'orange', 7, 16, 8, 1),
      b('2x2', 'white', 8, 16, 8),
      b('2x4', 'white', 6, 19, 6),
      b('1x2', 'white', 6, 19, 8),
      b('1x2', 'white', 8, 19, 8),
      b('1x1', 'black', 6, 19, 9),
      b('1x2', 'white', 7, 19, 9),
      b('1x1', 'black', 9, 19, 9),
      // The top hat.
      ...square4(6, 22, 6, 'black', true),
      b('2x2', 'black', 7, 25, 7),
      b('2x2', 'black', 7, 28, 7),
    ],
    8,
  ),
};
