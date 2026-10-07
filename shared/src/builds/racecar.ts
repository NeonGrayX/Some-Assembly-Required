import type { TargetBuild } from './types.ts';
import { b, paginate } from './kit.ts';

/**
 * A race car facing east, 29 bricks in 8 steps: four big black wheels under red fenders, a
 * black cockpit with a yellow helmet in it, a white stripe on the hood and a rear wing.
 */
export const RACE_CAR: TargetBuild = {
  id: 'race-car',
  name: 'Race Car',
  steps: paginate(
    [
      // Wheels and the floor between them.
      b('2x2', 'black', 4, 1, 4),
      b('2x2', 'black', 10, 1, 4),
      b('2x2', 'black', 4, 1, 10),
      b('2x2', 'black', 10, 1, 10),
      b('2x4', 'dark-grey', 4, 1, 6),
      b('2x4', 'dark-grey', 8, 1, 6),
      b('2x4', 'dark-grey', 4, 1, 8),
      b('2x4', 'dark-grey', 8, 1, 8),
      // The body.
      ...[4, 6, 8, 10].flatMap((x) => [b('2x4', 'red', x, 4, 4, 1), b('2x4', 'red', x, 4, 8, 1)]),
      b('2x2', 'red', 4, 7, 4),
      b('2x2', 'red', 10, 7, 4),
      b('2x2', 'red', 4, 7, 10),
      b('2x2', 'red', 10, 7, 10),
      // Deck, cockpit and hood.
      b('2x4', 'red', 4, 7, 6),
      b('2x4', 'red', 4, 7, 8),
      b('2x4', 'black', 8, 7, 6, 1),
      b('2x4', 'red', 10, 7, 6, 1),
      b('2x2', 'yellow', 8, 10, 7),
      b('1x2', 'white', 10, 10, 7, 1),
      // The rear wing on two posts.
      b('1x1', 'dark-grey', 4, 10, 6),
      b('1x1', 'dark-grey', 4, 10, 9),
      b('plate2x4', 'dark-grey', 4, 13, 6, 1),
    ],
    8,
  ),
};
