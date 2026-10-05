import type { ColourId, Rotation } from '../bricks.ts';
import type { TargetBrick, TargetBuild } from './types.ts';

const b = (
  type: TargetBrick['type'],
  colour: ColourId,
  x: number,
  y: number,
  z: number,
  rot: Rotation = 0,
): TargetBrick => ({ type, colour, x, y, z, rot });

/** Two 2x4 bricks covering the 4x4 body from (6, 6), turned a quarter on odd layers. */
const bodyLayer = (y: number, colour: ColourId, turned: boolean): TargetBrick[] =>
  turned
    ? [b('2x4', colour, 6, y, 6, 1), b('2x4', colour, 8, y, 6, 1)]
    : [b('2x4', colour, 6, y, 6), b('2x4', colour, 6, y, 8)];

/**
 * A rocket on its launch pad, 33 bricks in 8 steps: a white body with a porthole on the
 * south side, four stepped red fins and a red nose with an antenna on top.
 */
export const ROCKET: TargetBuild = {
  id: 'rocket',
  name: 'Rocket',
  steps: [
    {
      // The launch pad: a pinwheel of plates around a 2x2 hole, filled in.
      bricks: [
        b('plate2x4', 'dark-grey', 5, 1, 5, 0),
        b('plate2x4', 'dark-grey', 9, 1, 5, 1),
        b('plate2x4', 'dark-grey', 7, 1, 9, 0),
        b('plate2x4', 'dark-grey', 5, 1, 7, 1),
        b('plate2x2', 'dark-grey', 7, 1, 7),
      ],
    },
    {
      bricks: [
        ...bodyLayer(2, 'white', false),
        b('2x2', 'red', 4, 2, 7),
        b('2x2', 'red', 10, 2, 7),
        b('2x2', 'red', 7, 2, 4),
        b('2x2', 'red', 7, 2, 10),
      ],
    },
    {
      bricks: [
        ...bodyLayer(5, 'white', true),
        b('1x2', 'red', 5, 5, 7, 1),
        b('1x2', 'red', 10, 5, 7, 1),
        b('1x2', 'red', 7, 5, 5),
        b('1x2', 'red', 7, 5, 10),
      ],
    },
    { bricks: [...bodyLayer(8, 'white', false), ...bodyLayer(11, 'white', true)] },
    {
      // The porthole, in the middle of the south face.
      bricks: [
        b('2x4', 'white', 6, 14, 6),
        b('1x2', 'white', 6, 14, 8, 1),
        b('2x2', 'blue', 7, 14, 8),
        b('1x2', 'white', 9, 14, 8, 1),
      ],
    },
    { bricks: [...bodyLayer(17, 'white', true), ...bodyLayer(20, 'white', false)] },
    { bricks: bodyLayer(23, 'red', true) },
    { bricks: [b('2x2', 'red', 7, 26, 7), b('1x1', 'dark-grey', 7, 29, 7)] },
  ],
};
