import type { TargetBuild } from './types.ts';
import { b, paginate, square4 } from './kit.ts';

/**
 * A robot cheering with both arms up, 32 bricks in 8 steps: big feet, a control panel on its
 * chest, red hands, and a face with black eyes and an antenna.
 */
export const ROBOT: TargetBuild = {
  id: 'robot',
  name: 'Robot',
  steps: paginate(
    [
      // Feet and legs.
      b('2x4', 'dark-grey', 5, 1, 6, 1),
      b('2x4', 'dark-grey', 9, 1, 6, 1),
      b('2x2', 'light-grey', 5, 4, 7),
      b('2x2', 'light-grey', 9, 4, 7),
      b('2x2', 'light-grey', 5, 7, 7),
      b('2x2', 'light-grey', 9, 7, 7),
      // Hips, body and the control panel.
      b('2x4', 'dark-grey', 5, 10, 6),
      b('2x4', 'dark-grey', 7, 10, 8),
      b('2x2', 'light-grey', 9, 10, 6),
      b('2x2', 'light-grey', 5, 10, 8),
      b('2x4', 'light-grey', 5, 13, 6, 1),
      b('2x4', 'light-grey', 7, 13, 6, 1),
      b('2x4', 'light-grey', 9, 13, 6, 1),
      b('2x4', 'light-grey', 5, 16, 6),
      b('2x2', 'light-grey', 9, 16, 6),
      b('2x4', 'light-grey', 7, 16, 8),
      b('2x2', 'blue', 5, 16, 8),
      // Shoulders, neck and raised arms.
      b('2x4', 'light-grey', 3, 19, 7),
      b('2x4', 'light-grey', 9, 19, 7),
      b('2x2', 'black', 7, 19, 7),
      b('2x2', 'light-grey', 3, 22, 7),
      b('2x2', 'light-grey', 11, 22, 7),
      b('2x2', 'red', 3, 25, 7),
      b('2x2', 'red', 11, 25, 7),
      // The head.
      ...square4(6, 22, 6, 'light-grey', false),
      b('2x4', 'light-grey', 6, 25, 6),
      b('1x4', 'light-grey', 6, 25, 8),
      b('1x1', 'black', 6, 25, 9),
      b('1x2', 'white', 7, 25, 9),
      b('1x1', 'black', 9, 25, 9),
      b('1x1', 'dark-grey', 7, 28, 7),
    ],
    8,
  ),
};
