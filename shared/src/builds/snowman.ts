import type { BuildStep, PageLayout, TargetBrick, TargetBuild } from './types.ts';
import { b } from './kit.ts';

/** A sideways part clipped onto the side stud behind it. */
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

/** A plus-shaped layer of a snowball: a 4x4 core and a 1x2 bump on each side of it. */
const ball = (y: number, core: TargetBrick[]): TargetBrick[] => [
  ...core,
  b('1x2', 'white', 5, y, 7, 1),
  b('1x2', 'white', 10, y, 7, 1),
  b('1x2', 'white', 7, y, 5),
  b('1x2', 'white', 7, y, 10),
];

/** A plus-shaped layer of the middle snowball, with a coal button on the front. */
const middle = (y: number): TargetBrick[] => [
  b('2x2', 'white', 7, y, 7),
  b('1x2', 'white', 6, y, 7, 1),
  b('1x2', 'white', 9, y, 7, 1),
  b('1x2', 'white', 7, y, 6),
  b('1x1', 'white', 7, y, 9),
  b('headlight1x1', 'white', 8, y, 9),
  side('roundtile1x1', 'black', 8, y, 10, '+z'),
];

const PAGES: Page[] = [
  {
    note: 'Snowy ground, and the bottom of the big snowball.',
    bricks: [
      b('plate2x4', 'white', 4, 1, 5),
      b('plate2x4', 'white', 8, 1, 5),
      b('plate2x4', 'white', 4, 1, 7),
      b('plate2x4', 'white', 8, 1, 7),
      b('plate2x4', 'white', 4, 1, 9),
      b('plate2x4', 'white', 8, 1, 9),
      b('2x4', 'white', 6, 2, 6),
      b('2x4', 'white', 6, 2, 8),
    ],
  },
  {
    note: 'Its widest layer, a 6x6 square laid as a pinwheel.',
    bricks: [
      b('2x4', 'white', 5, 5, 5),
      b('2x4', 'white', 9, 5, 5, 1),
      b('2x4', 'white', 7, 5, 9),
      b('2x4', 'white', 5, 5, 7, 1),
      b('2x2', 'white', 7, 5, 7),
    ],
  },
  {
    note: 'Narrower at the top: a square with a bump each side.',
    bricks: ball(8, [b('2x4', 'white', 6, 8, 6, 1), b('2x4', 'white', 8, 8, 6, 1)]),
  },
  {
    note: 'Cheese slopes round off the bumps.',
    bricks: [
      b('cheese1x1', 'white', 5, 11, 7, 3),
      b('cheese1x1', 'white', 5, 11, 8, 3),
      b('cheese1x1', 'white', 10, 11, 7, 1),
      b('cheese1x1', 'white', 10, 11, 8, 1),
    ],
  },
  {
    note: 'The middle snowball, with a coal button.',
    bricks: middle(11),
  },
  {
    note: 'Its top, with a second button.',
    bricks: middle(14),
  },
  {
    note: 'A broom: a lattice brick for straw, a brown handle.',
    bricks: [
      b('lattice1x2x2', 'tan', 11, 2, 7, 1),
      b('1x1', 'brown', 11, 8, 8),
      b('1x1', 'brown', 11, 11, 8),
      b('plate1x1', 'brown', 11, 14, 8),
      b('plate1x1', 'brown', 11, 15, 8),
    ],
  },
  {
    note: 'Stick arms, one holding the broom, under the scarf.',
    bricks: [
      b('plate1x6', 'brown', 4, 17, 7),
      b('plate1x6', 'brown', 6, 17, 8),
      b('plate1x4', 'red', 6, 17, 6),
      b('plate1x4', 'red', 6, 17, 9),
    ],
  },
  {
    note: 'The red scarf, its end hanging over the arm.',
    bricks: [
      b('2x4', 'red', 6, 18, 6),
      b('2x4', 'red', 6, 18, 8),
      b('slope1x2', 'red', 10, 18, 8, 1),
    ],
  },
  {
    note: 'The bottom of the head, and a carrot nose.',
    view: { zoom: 1.4 },
    bricks: [
      b('2x4', 'white', 6, 21, 6),
      b('1x2', 'white', 6, 21, 8),
      b('1x2', 'white', 8, 21, 8),
      b('1x2', 'white', 6, 21, 9),
      b('curve1x2', 'orange', 8, 21, 9),
      b('1x1', 'white', 9, 21, 9),
    ],
  },
  {
    note: 'Coal eyes clip onto white headlight bricks.',
    view: { zoom: 1.4 },
    bricks: [
      b('2x4', 'white', 6, 24, 6),
      b('1x2', 'white', 6, 24, 8),
      b('1x2', 'white', 8, 24, 8, 1),
      b('1x1', 'white', 9, 24, 8),
      b('1x1', 'white', 6, 24, 9),
      b('headlight1x1', 'white', 7, 24, 9),
      b('headlight1x1', 'white', 9, 24, 9),
      side('roundtile1x1', 'black', 7, 24, 10, '+z'),
      side('roundtile1x1', 'black', 9, 24, 10, '+z'),
    ],
  },
  {
    note: 'The top of the head.',
    bricks: [b('2x4', 'white', 6, 27, 6, 1), b('2x4', 'white', 8, 27, 6, 1)],
  },
  {
    note: 'The wide brim of the top hat.',
    bricks: [
      b('plate2x2', 'black', 7, 30, 5),
      b('plate2x2', 'black', 5, 30, 6),
      b('plate2x2', 'black', 7, 30, 7),
      b('plate2x2', 'black', 9, 30, 6),
      b('plate2x2', 'black', 7, 30, 9),
      b('plate2x2', 'black', 5, 30, 8),
      b('plate2x2', 'black', 9, 30, 8),
    ],
  },
  {
    note: 'The hat: a red band, then black on top.',
    bricks: [
      b('2x4', 'red', 6, 31, 6),
      b('2x4', 'red', 6, 31, 8),
      b('2x4', 'black', 6, 34, 6, 1),
      b('2x4', 'black', 8, 34, 6, 1),
    ],
  },
  {
    note: 'A little fir tree beside the snow.',
    bricks: [
      b('1x1', 'brown', 2, 1, 11),
      b('2x2', 'green', 2, 4, 10),
      b('1x1', 'green', 2, 7, 10),
      b('plant1x1', 'green', 2, 10, 10),
    ],
  },
];

/**
 * A snowman on snowy ground, 81 parts on 15 pages. The big snowball is narrow, then a wide 6x6
 * pinwheel, then a plus shape rounded with cheese slopes; the middle snowball has two coal
 * buttons on headlight bricks. Stick arms (one holding a straw broom) come out under a red
 * scarf, the head has a carrot nose of an orange curve and coal eyes, and a top hat with a red
 * band sits on a wide black brim. A little fir tree stands beside the snow.
 */
export const SNOWMAN: TargetBuild = {
  id: 'snowman',
  name: 'Snowman',
  steps: PAGES.map(({ bricks }): BuildStep => ({ bricks })),
  pages: PAGES.map(({ note, view }) => ({ note, view })),
};
