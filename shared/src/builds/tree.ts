import type { BuildStep, PageLayout, TargetBrick, TargetBuild } from './types.ts';
import { b, pinwheel6 } from './kit.ts';

interface Page extends PageLayout {
  bricks: TargetBrick[];
}

/*
 * The tree stands round the corner between studs (8, 7), so its middle is the middle of a 2x2
 * and the star (a cone, which may sit between four studs) goes right on top. Each tier is a
 * square of bricks with a ring of 2x2 slopes on it, hanging one stud over the edge.
 */

const PAGES: Page[] = [
  {
    note: 'Snowy ground: white plates on the grass.',
    bricks: [
      b('plate2x4', 'white', 4, 1, 5),
      b('plate2x4', 'white', 8, 1, 5),
      b('plate2x4', 'white', 4, 1, 7),
      b('plate2x4', 'white', 8, 1, 7),
    ],
  },
  {
    note: 'The front of the snow, and the foot of the trunk.',
    bricks: [
      b('plate2x4', 'white', 4, 1, 9),
      b('plate2x4', 'white', 8, 1, 9),
      b('plate2x4', 'white', 4, 1, 11),
      b('plate2x4', 'white', 8, 1, 11),
      b('plate2x2', 'brown', 7, 2, 6),
    ],
  },
  {
    note: 'The trunk, and two presents with yellow bows.',
    bricks: [
      b('1x2', 'brown', 7, 3, 6),
      b('1x2', 'brown', 7, 3, 7),
      b('2x2', 'red', 5, 2, 10),
      b('flower2x2', 'yellow', 5, 5, 10),
      b('2x2', 'blue', 9, 2, 11),
      b('flower2x2', 'yellow', 9, 5, 11),
    ],
  },
  {
    note: 'Two more presents, and green bricks on the trunk.',
    bricks: [
      b('2x4', 'yellow', 12, 1, 6, 1),
      b('tile2x4', 'purple', 12, 4, 6, 1),
      b('2x2', 'dark-red', 12, 1, 11),
      b('roundtile1x1', 'gold', 12, 4, 11),
      b('roundtile1x1', 'gold', 13, 4, 12),
      b('2x4', 'green', 6, 6, 5),
      b('2x4', 'green', 6, 6, 7),
    ],
  },
  {
    note: 'The bottom tier: a 6x6 square laid as a pinwheel.',
    bricks: pinwheel6('2x4', '2x2', 'green', 5, 9, 4),
  },
  {
    note: 'Slopes down the sides, hanging over the edge.',
    bricks: [
      b('slope2x2', 'green', 4, 12, 3, 3),
      b('slope2x2', 'green', 4, 12, 5, 3),
      b('slope2x2', 'green', 4, 12, 7, 3),
      b('slope2x2', 'green', 4, 12, 9, 3),
      b('slope2x2', 'green', 10, 12, 3, 1),
      b('slope2x2', 'green', 10, 12, 5, 1),
      b('slope2x2', 'green', 10, 12, 7, 1),
      b('slope2x2', 'green', 10, 12, 9, 1),
    ],
  },
  {
    note: 'Slopes front and back, and green bricks in the middle.',
    bricks: [
      b('slope2x2', 'green', 6, 12, 3, 2),
      b('slope2x2', 'green', 8, 12, 3, 2),
      b('slope2x2', 'green', 6, 12, 9),
      b('slope2x2', 'green', 8, 12, 9),
      b('2x4', 'green', 6, 12, 5),
      b('2x4', 'green', 6, 12, 7),
    ],
  },
  {
    note: "Red and white baubles, and the middle tier's square.",
    bricks: [
      b('round1x1', 'red', 5, 15, 3),
      b('round1x1', 'white', 10, 15, 3),
      b('round1x1', 'white', 5, 15, 10),
      b('round1x1', 'red', 10, 15, 10),
      ...pinwheel6('2x4', '2x2', 'green', 5, 15, 4, true),
    ],
  },
  {
    note: 'A ring of slopes on it, and a brick in the middle.',
    bricks: [
      b('slope2x2', 'green', 5, 18, 4, 3),
      b('slope2x2', 'green', 7, 18, 4, 2),
      b('slope2x2', 'green', 9, 18, 4, 1),
      b('slope2x2', 'green', 5, 18, 6, 3),
      b('slope2x2', 'green', 9, 18, 6, 1),
      b('slope2x2', 'green', 5, 18, 8, 3),
      b('slope2x2', 'green', 7, 18, 8),
      b('slope2x2', 'green', 9, 18, 8, 1),
      b('2x2', 'green', 7, 18, 6),
    ],
  },
  {
    note: "Orange baubles, and the top tier's square.",
    bricks: [
      b('round1x1', 'orange', 6, 21, 4),
      b('round1x1', 'orange', 9, 21, 4),
      b('round1x1', 'orange', 6, 21, 9),
      b('round1x1', 'orange', 9, 21, 9),
      b('2x4', 'green', 6, 21, 5, 1),
      b('2x4', 'green', 8, 21, 5, 1),
    ],
  },
  {
    note: 'Four slopes make the top tier.',
    bricks: [
      b('slope2x2', 'green', 6, 24, 5, 2),
      b('slope2x2', 'green', 8, 24, 5, 1),
      b('slope2x2', 'green', 8, 24, 7),
      b('slope2x2', 'green', 6, 24, 7, 3),
    ],
  },
  {
    note: 'Little red lights, the tip and a gold star.',
    bricks: [
      b('roundplate1x1', 'trans-red', 6, 27, 6),
      b('roundplate1x1', 'trans-red', 8, 27, 5),
      b('roundplate1x1', 'trans-red', 9, 27, 7),
      b('roundplate1x1', 'trans-red', 7, 27, 8),
      b('2x2', 'green', 7, 27, 6),
      b('cone1x1', 'gold', 7.5, 30, 6.5),
    ],
  },
];

/**
 * A Christmas tree on snowy ground, 75 parts on 12 pages. A short brown trunk carries three
 * tiers, each a square of green bricks with a ring of slopes on it (the bottom ring hangs over
 * the edge). Red, white and orange round baubles sit on the tiers' corners and see-through red
 * lights near the top, under a gold star. Presents with yellow flower bows and gold studs
 * stand round it in the snow.
 */
export const CHRISTMAS_TREE: TargetBuild = {
  id: 'christmas-tree',
  name: 'Christmas Tree',
  steps: PAGES.map(({ bricks }): BuildStep => ({ bricks })),
  pages: PAGES.map(({ note, view }) => ({ note, view })),
};
