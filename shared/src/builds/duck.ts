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

/**
 * A giant rubber duck in a pond, 32 bricks in 8 steps. The body runs along x with the head
 * at the east end, looking east; the eyes sit between the head and its cap.
 */
export const GIANT_DUCK: TargetBuild = {
  id: 'giant-duck',
  name: 'Giant Duck',
  steps: [
    {
      // The pond: eight blue plates covering 8x8 studs from (4, 4).
      bricks: [4, 6, 8, 10].flatMap((z) => [
        b('plate2x4', 'blue', 4, 1, z),
        b('plate2x4', 'blue', 8, 1, z),
      ]),
    },
    {
      // The bottom of the body, and the bottom of both wings.
      bricks: [
        b('2x4', 'yellow', 5, 2, 6, 1),
        b('2x4', 'yellow', 7, 2, 6, 1),
        b('2x4', 'yellow', 9, 2, 6, 1),
        b('1x4', 'yellow', 6, 2, 5),
        b('1x4', 'yellow', 6, 2, 10),
      ],
    },
    {
      bricks: [
        b('2x4', 'yellow', 5, 5, 6),
        b('2x4', 'yellow', 5, 5, 8),
        b('2x4', 'yellow', 9, 5, 6, 1),
        b('1x4', 'yellow', 6, 5, 5),
        b('1x4', 'yellow', 6, 5, 10),
      ],
    },
    {
      // The back, and the neck at the east end.
      bricks: [
        b('2x4', 'yellow', 5, 8, 6, 1),
        b('2x4', 'yellow', 7, 8, 6, 1),
        b('2x2', 'yellow', 9, 8, 7),
      ],
    },
    { bricks: [b('1x2', 'yellow', 5, 11, 7, 1), b('2x4', 'yellow', 9, 11, 6, 1)] },
    {
      bricks: [
        b('1x4', 'yellow', 9, 14, 6, 1),
        b('1x1', 'black', 10, 14, 6),
        b('1x1', 'black', 10, 14, 9),
        b('2x2', 'orange', 10, 14, 7),
      ],
    },
    { bricks: [b('2x4', 'yellow', 9, 17, 6, 1)] },
    {
      // Reeds in two corners of the pond.
      bricks: [
        b('1x1', 'green', 4, 2, 11),
        b('1x1', 'green', 4, 5, 11),
        b('1x1', 'green', 11, 2, 4),
        b('1x1', 'green', 11, 5, 4),
      ],
    },
  ],
};
