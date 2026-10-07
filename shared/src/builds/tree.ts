import type { TargetBuild } from './types.ts';
import { b, paginate, pinwheel6, square4 } from './kit.ts';

/**
 * A Christmas tree, 32 bricks in 8 steps: a trunk, two green tiers with yellow baubles, a star
 * on top and two presents next to it.
 */
export const CHRISTMAS_TREE: TargetBuild = {
  id: 'christmas-tree',
  name: 'Christmas Tree',
  steps: paginate(
    [
      b('2x2', 'dark-red', 7, 1, 7),
      b('2x2', 'red', 12, 1, 12),
      b('2x2', 'blue', 1, 1, 11),
      b('2x2', 'dark-red', 7, 4, 7),
      // The lower tier widens out from the trunk.
      ...square4(6, 7, 6, 'green', false),
      ...pinwheel6('2x4', '2x2', 'green', 5, 10, 5),
      ...[4, 6, 8, 10].flatMap((z) => [b('2x4', 'green', 4, 13, z), b('2x4', 'green', 8, 13, z)]),
      b('1x1', 'yellow', 4, 16, 4),
      b('1x1', 'yellow', 11, 16, 4),
      b('1x1', 'yellow', 4, 16, 11),
      b('1x1', 'yellow', 11, 16, 11),
      // The upper tier, and the star.
      ...square4(6, 16, 6, 'green', true),
      ...pinwheel6('2x4', '2x2', 'green', 5, 19, 5, true),
      b('2x2', 'green', 7, 22, 7),
      b('1x1', 'yellow', 7, 25, 7),
    ],
    8,
  ),
};
