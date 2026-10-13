import type { TargetBrick, TargetBuild } from './types.ts';
import { b } from './kit.ts';

/** A thin part clipped sideways onto the side studs of a part placed earlier. */
const side = (
  type: TargetBrick['type'],
  colour: TargetBrick['colour'],
  x: number,
  y: number,
  z: number,
  face: NonNullable<TargetBrick['face']>,
): TargetBrick => ({ type, colour, x, y, z, rot: 0, face });

const pages: { note: string; view?: { turn?: number; zoom?: number }; bricks: TargetBrick[] }[] = [
  {
    note: 'The rocky islet: dark grey plates.',
    view: { zoom: 1.4 },
    bricks: [
      b('plate4x4', 'dark-grey', 6, 1, 5),
      b('plate2x4', 'dark-grey', 6, 1, 9),
      b('plate2x4', 'dark-grey', 4, 1, 5, 1),
      b('plate2x2', 'dark-grey', 4, 1, 9),
    ],
  },
  {
    note: 'The sea around it, blue and dark blue.',
    view: { zoom: 1.2 },
    bricks: [
      b('plate2x4', 'dark-blue', 6, 1, 11),
      b('plate2x4', 'blue', 2, 1, 11),
      b('plate2x4', 'blue', 10, 1, 9, 1),
      b('plate2x4', 'dark-blue', 10, 1, 5, 1),
    ],
  },
  {
    note: 'Waves, a path to the jetty and a flower.',
    view: { zoom: 1.2 },
    bricks: [
      b('tile1x2', 'trans-light-blue', 3, 2, 12),
      b('tile1x2', 'trans-light-blue', 8, 2, 12),
      b('tile1x2', 'trans-light-blue', 10, 2, 10, 1),
      b('tile1x2', 'trans-light-blue', 11, 2, 6, 1),
      b('tile1x2', 'tan', 6, 2, 9),
      b('plate1x4', 'brown', 6, 2, 11, 1),
      b('flower2x2', 'yellow', 4, 2, 9),
      b('roundplate1x1', 'green', 5, 2, 8),
    ],
  },
  {
    note: "The tower's red foot and the keeper's door.",
    view: { zoom: 1.2 },
    bricks: [
      b('2x4', 'red', 6, 2, 5),
      b('1x4', 'red', 6, 2, 7),
      b('window1x2x2', 'brown', 6, 2, 8),
      b('1x2', 'red', 8, 2, 8),
      b('1x2', 'light-grey', 8, 2, 9),
    ],
  },
  {
    note: 'More red beside the door; a rock and a fern.',
    view: { zoom: 1.2 },
    bricks: [
      b('2x3', 'red', 6, 5, 5, 1),
      b('2x3', 'red', 8, 5, 5, 1),
      b('1x2', 'red', 8, 5, 8),
      b('1x1', 'dark-grey', 9, 5, 9),
      b('plant1x1', 'green', 5, 3, 8),
    ],
  },
  {
    note: 'A white band with a small window.',
    bricks: [
      b('2x4', 'white', 6, 8, 5),
      b('2x2', 'white', 6, 8, 7),
      b('1x2', 'white', 8, 8, 7),
      b('headlight1x1', 'white', 8, 8, 8),
      b('headlight1x1', 'white', 9, 8, 8),
      side('tile1x2', 'trans-light-blue', 8, 8.5, 8.8, '+z'),
    ],
  },
  {
    note: 'White, then red again, turned to lock it.',
    bricks: [
      b('2x4', 'white', 6, 11, 5, 1),
      b('2x4', 'white', 8, 11, 5, 1),
      b('2x4', 'red', 6, 14, 5),
      b('2x4', 'red', 6, 14, 7),
    ],
  },
  {
    note: 'The last red layer and the round gallery.',
    bricks: [
      b('2x4', 'red', 6, 17, 5, 1),
      b('2x4', 'red', 8, 17, 5, 1),
      b('roundcorner3x3', 'light-grey', 8, 20, 7, 0),
      b('roundcorner3x3', 'light-grey', 5, 20, 7, 3),
      b('roundcorner3x3', 'light-grey', 5, 20, 4, 2),
      b('roundcorner3x3', 'light-grey', 8, 20, 4, 1),
    ],
  },
  {
    note: 'Corner posts and the yellow lamp.',
    bricks: [
      b('1x1', 'black', 6, 21, 5),
      b('1x1', 'black', 9, 21, 5),
      b('1x1', 'black', 6, 21, 8),
      b('1x1', 'black', 9, 21, 8),
      b('2x2', 'yellow', 7, 21, 6),
    ],
  },
  {
    note: 'Glass all round the lamp room.',
    bricks: [
      b('1x1', 'trans-clear', 7, 21, 8),
      b('1x1', 'trans-clear', 8, 21, 8),
      b('1x1', 'trans-clear', 9, 21, 6),
      b('1x1', 'trans-clear', 9, 21, 7),
      b('1x1', 'trans-clear', 7, 21, 5),
      b('1x1', 'trans-clear', 8, 21, 5),
      b('1x1', 'trans-clear', 6, 21, 6),
      b('1x1', 'trans-clear', 6, 21, 7),
    ],
  },
  {
    note: 'The red roof and a gold tip.',
    bricks: [
      b('slope2x2', 'red', 8, 24, 7, 0),
      b('slope2x2', 'red', 6, 24, 7, 3),
      b('slope2x2', 'red', 6, 24, 5, 2),
      b('slope2x2', 'red', 8, 24, 5, 1),
      b('roundplate2x2', 'light-grey', 7, 27, 6),
      b('cone1x1', 'gold', 7.5, 28, 6.5),
    ],
  },
];

/**
 * The first build: a red and white lighthouse on a rocky islet in the sea, 60 parts in 11
 * pages. A keeper's door and a small window in the striped tower, a round gallery, a glass
 * lamp room with a yellow light, a red slope roof with a gold tip, waves, a jetty and a flower.
 */
export const LIGHTHOUSE: TargetBuild = {
  id: 'lighthouse',
  name: 'Lighthouse',
  steps: pages.map((p) => ({ bricks: p.bricks })),
  pages: pages.map(({ note, view }) => (view ? { note, view } : { note })),
};
