import type { TargetBrick, TargetBuild, PageLayout, BuildStep } from './types.ts';
import { b } from './kit.ts';

/** A sideways part clipped onto the side stud in front of it. */
const side = (
  type: TargetBrick['type'],
  colour: TargetBrick['colour'],
  x: number,
  y: number,
  z: number,
  face: NonNullable<TargetBrick['face']>,
  rot: TargetBrick['rot'] = 0,
): TargetBrick => ({ type, colour, x, y, z, rot, face });

interface Page extends PageLayout {
  bricks: TargetBrick[];
}

const PAGES: Page[] = [
  {
    note: 'The back of the pond: blue plates, dark in the middle.',
    bricks: [
      b('plate2x4', 'blue', 3, 1, 4),
      b('plate2x4', 'blue', 7, 1, 4),
      b('plate2x4', 'blue', 11, 1, 4, 1),
      b('plate2x4', 'dark-blue', 3, 1, 6),
      b('plate2x4', 'dark-blue', 7, 1, 6),
    ],
  },
  {
    note: 'The front of the pond.',
    bricks: [
      b('plate2x4', 'dark-blue', 3, 1, 8),
      b('plate2x4', 'dark-blue', 7, 1, 8),
      b('plate2x4', 'blue', 11, 1, 8, 1),
      b('plate2x4', 'blue', 3, 1, 10),
      b('plate2x4', 'blue', 7, 1, 10),
    ],
  },
  {
    note: 'The bottom of the duck, its wings and its chest.',
    bricks: [
      b('2x4', 'yellow', 4, 2, 6, 1),
      b('2x4', 'yellow', 6, 2, 6, 1),
      b('2x4', 'yellow', 8, 2, 6, 1),
      b('1x4', 'yellow', 5, 2, 5),
      b('1x4', 'yellow', 5, 2, 10),
      b('2x2', 'yellow', 10, 2, 7),
    ],
  },
  {
    note: 'The body, and a slope to round off the chest.',
    bricks: [
      b('2x4', 'yellow', 4, 5, 6),
      b('2x4', 'yellow', 4, 5, 8),
      b('2x4', 'yellow', 8, 5, 6, 1),
      b('1x4', 'yellow', 5, 5, 5),
      b('1x4', 'yellow', 5, 5, 10),
      b('slope2x2', 'yellow', 10, 5, 7, 1),
    ],
  },
  {
    note: 'Slopes round the back; the neck and its shoulders.',
    bricks: [
      b('slope2x2', 'yellow', 4, 8, 6, 2),
      b('slope2x2', 'yellow', 6, 8, 6, 2),
      b('slope2x2', 'yellow', 4, 8, 8),
      b('slope2x2', 'yellow', 6, 8, 8),
      b('2x2', 'yellow', 8, 8, 7),
      b('curve1x2', 'yellow', 8, 8, 6, 1),
      b('curve1x2', 'yellow', 8, 8, 9, 1),
    ],
  },
  {
    note: 'Curved feathers on the wings, a brick for the beak.',
    bricks: [
      b('curve1x2', 'yellow', 5, 8, 5, 1),
      b('curve1x2', 'yellow', 7, 8, 5, 1),
      b('curve1x2', 'yellow', 5, 8, 10, 1),
      b('curve1x2', 'yellow', 7, 8, 10, 1),
      b('1x2', 'yellow', 10, 8, 7, 1),
    ],
  },
  {
    note: 'The tail, the dip of the back, the head and the beak.',
    bricks: [
      b('slope2x2', 'yellow', 4, 11, 7, 1),
      b('curve1x2', 'yellow', 6, 11, 7, 3),
      b('curve1x2', 'yellow', 6, 11, 8, 3),
      b('2x4', 'yellow', 8, 11, 6, 1),
      b('2x2', 'orange', 10, 11, 7),
    ],
  },
  {
    note: 'White headlight bricks hold the round black eyes.',
    view: { zoom: 1.4 },
    bricks: [
      b('1x4', 'yellow', 8, 14, 6, 1),
      b('headlight1x1', 'white', 9, 14, 6, 1),
      b('1x2', 'yellow', 9, 14, 7, 1),
      b('headlight1x1', 'white', 9, 14, 9, 1),
      side('roundtile1x1', 'black', 9.8, 14.5, 6, '+x'),
      side('roundtile1x1', 'black', 9.8, 14.5, 9, '+x'),
      b('curve1x2', 'orange', 10, 14, 7, 1),
      b('curve1x2', 'orange', 10, 14, 8, 1),
    ],
  },
  {
    note: 'The top of the head, rounded with curves.',
    view: { zoom: 1.4 },
    bricks: [
      b('2x4', 'yellow', 8, 17, 6, 1),
      b('curve1x2', 'yellow', 8, 20, 6, 2),
      b('curve1x2', 'yellow', 9, 20, 6, 2),
      b('curve1x2', 'yellow', 8, 20, 8),
      b('curve1x2', 'yellow', 9, 20, 8),
    ],
  },
  {
    note: 'Ripples of see-through tiles and little lily pads.',
    bricks: [
      b('tile1x2', 'trans-light-blue', 11, 2, 11),
      b('tile1x2', 'trans-light-blue', 11, 2, 5, 1),
      b('tile1x3', 'trans-clear', 5, 2, 11),
      b('roundtile1x1', 'sand-green', 3, 2, 9),
      b('roundtile1x1', 'sand-green', 12, 2, 7),
    ],
  },
  {
    note: 'A big lily pad with a flower, and stones on the bank.',
    bricks: [
      b('plate2x3', 'lime', 10, 2, 9),
      b('flower2x2', 'yellow', 11, 3, 9),
      b('plate2x2', 'dark-grey', 13, 1, 9),
      b('roundplate1x1', 'light-grey', 13, 2, 10),
      b('plate1x1', 'dark-grey', 2, 1, 11),
      b('plate1x1', 'tan', 3, 1, 12),
    ],
  },
  {
    note: 'Tall reeds and a cattail behind the pond.',
    view: { turn: 1 },
    bricks: [
      b('1x1', 'green', 2, 1, 4),
      b('1x1', 'green', 2, 4, 4),
      b('1x1', 'green', 2, 7, 4),
      b('roundplate1x1', 'green', 2, 10, 4),
      b('plant1x1', 'green', 2, 11, 4),
      b('1x1', 'green', 3, 1, 3),
      b('1x1', 'brown', 3, 4, 3),
      b('tile1x1', 'dark-brown', 3, 7, 3),
      b('tile1x3', 'trans-clear', 6, 2, 4),
    ],
  },
  {
    note: 'More reeds and cattails in the far corner.',
    bricks: [
      b('1x1', 'green', 13, 1, 3),
      b('1x1', 'green', 13, 4, 3),
      b('1x1', 'brown', 13, 7, 3),
      b('tile1x1', 'dark-brown', 13, 10, 3),
      b('1x1', 'green', 12, 1, 3),
      b('1x1', 'green', 12, 4, 3),
      b('roundplate1x1', 'green', 12, 7, 3),
      b('plant1x1', 'green', 12, 8, 3),
    ],
  },
  {
    note: 'Flowers, a stone and a lily pad at the front.',
    bricks: [
      b('flower2x2', 'yellow', 5, 1, 13),
      b('flower2x2', 'yellow', 12, 1, 12),
      b('plate1x1', 'dark-grey', 9, 1, 12),
      b('roundtile1x1', 'sand-green', 9, 2, 11),
    ],
  },
];

/**
 * A giant rubber duck floating on a pond, 82 parts on 14 pages. The body runs along x with the
 * head at the east end, looking east: slopes round its back, curved feathers top the wings,
 * a slope rounds the chest and the tail turns up. Its round black eyes clip onto white
 * headlight bricks either side of an orange beak with a curved tip. Around it: see-through
 * ripples, lily pads and a flower, reeds and cattails on the banks, and a few stones.
 */
export const GIANT_DUCK: TargetBuild = {
  id: 'giant-duck',
  name: 'Giant Duck',
  steps: PAGES.map(({ bricks }): BuildStep => ({ bricks })),
  pages: PAGES.map(({ note, view }) => ({ note, view })),
};
