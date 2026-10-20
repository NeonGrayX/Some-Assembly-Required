import type { TargetBuild } from './types.ts';
import { b } from './kit.ts';

/**
 * A timber-framed cottage in its garden, 85 parts on 16 pages: white walls with brown corner
 * posts, lattice windows with flower boxes and a brown door on a stone floor, a black slope roof
 * with a ridge of tiles and a brick chimney, a tan path between two white fences, a red mailbox,
 * a flower bed and a tree.
 */
export const COTTAGE: TargetBuild = {
  id: 'cottage',
  name: 'Cottage',
  description:
    'A timber-framed cottage with lattice windows, flower boxes, a black slope roof and a brick chimney, in a garden with a path, a fence, a mailbox and a tree.',
  cover: { zoom: 1.3 },
  steps: [
    // 1. The stone floor and the path to the door.
    {
      bricks: [
        b('plate4x4', 'dark-grey', 4, 1, 5),
        b('plate4x4', 'dark-grey', 8, 1, 5),
        b('tile2x2', 'tan', 7, 1, 9),
        b('tile2x2', 'tan', 7, 1, 11),
        b('tile2x2', 'tan', 7, 1, 13),
      ],
    },
    // 2. The first course of the back and side walls.
    {
      bricks: [
        b('1x1', 'brown', 4, 2, 5),
        b('1x3', 'white', 5, 2, 5),
        b('1x3', 'white', 8, 2, 5),
        b('1x1', 'brown', 11, 2, 5),
        b('1x2', 'white', 4, 2, 6, 1),
        b('1x2', 'white', 11, 2, 6, 1),
      ],
    },
    // 3. The front: the door and the first course.
    {
      bricks: [
        b('1x1', 'brown', 4, 2, 8),
        b('1x2', 'white', 5, 2, 8),
        b('1x2x2', 'brown', 7, 2, 8),
        b('1x2', 'white', 9, 2, 8),
        b('1x1', 'brown', 11, 2, 8),
      ],
    },
    // 4. The back wall and its window.
    {
      bricks: [
        b('1x2', 'white', 5, 5, 5),
        b('1x2', 'white', 5, 8, 5),
        b('window1x2x2', 'brown', 7, 5, 5),
        b('1x2', 'white', 9, 5, 5),
        b('1x2', 'white', 9, 8, 5),
      ],
    },
    // 5. The side windows and the back corner posts.
    {
      bricks: [
        b('window1x2x2', 'brown', 4, 5, 6, 1),
        b('window1x2x2', 'brown', 11, 5, 6, 1),
        b('1x1', 'brown', 4, 5, 5),
        b('1x1', 'brown', 4, 8, 5),
        b('1x1', 'brown', 11, 5, 5),
        b('1x1', 'brown', 11, 8, 5),
      ],
    },
    // 6. The front lattice windows, posts and the lintel.
    {
      bricks: [
        b('1x1', 'brown', 4, 5, 8),
        b('1x1', 'brown', 4, 8, 8),
        b('lattice1x2x2', 'tan', 5, 5, 8),
        b('1x2', 'white', 7, 8, 8),
        b('lattice1x2x2', 'tan', 9, 5, 8),
        b('1x1', 'brown', 11, 5, 8),
        b('1x1', 'brown', 11, 8, 8),
      ],
    },
    // 7. Flower boxes under the front windows.
    {
      bricks: [
        b('1x2', 'brown', 5, 1, 9),
        b('1x2', 'brown', 9, 1, 9),
        b('roundplate1x1', 'green', 5, 4, 9),
        b('plant1x1', 'green', 5, 5, 9),
        b('tile1x1', 'pink', 6, 4, 9),
        b('tile1x1', 'pink', 9, 4, 9),
        b('roundplate1x1', 'green', 10, 4, 9),
        b('plant1x1', 'green', 10, 5, 9),
      ],
    },
    // 8. The ceiling, a stud wider than the walls front and back.
    {
      bricks: [
        b('plate2x4', 'brown', 4, 11, 4),
        b('plate2x4', 'brown', 8, 11, 4),
        b('plate2x8', 'light-grey', 4, 11, 6),
        b('plate2x4', 'brown', 4, 11, 8),
        b('plate2x4', 'brown', 8, 11, 8),
      ],
    },
    // 9. The back half of the roof's lower row.
    {
      bricks: [4, 6, 8, 10].map((x) => b('slope2x3', 'black', x, 12, 4, 2)),
    },
    // 10. The front half.
    {
      bricks: [4, 6, 8, 10].map((x) => b('slope2x3', 'black', x, 12, 7)),
    },
    // 11. The chimney and the upper back slopes.
    {
      bricks: [
        b('slope2x2', 'black', 4, 15, 5, 2),
        b('slope2x2', 'black', 6, 15, 5, 2),
        b('2x2', 'dark-red', 8, 15, 5),
        b('slope2x2', 'black', 10, 15, 5, 2),
      ],
    },
    // 12. The upper front slopes.
    {
      bricks: [4, 6, 8, 10].map((x) => b('slope2x2', 'black', x, 15, 7)),
    },
    // 13. The ridge tiles and the top of the chimney.
    {
      bricks: [
        b('tile1x4', 'black', 4, 18, 7),
        b('tile1x4', 'black', 8, 18, 7),
        b('tile1x4', 'black', 4, 18, 6),
        b('tile1x2', 'black', 10, 18, 6),
        b('2x2', 'dark-red', 8, 18, 5),
        b('plate2x2', 'black', 8, 21, 5),
      ],
    },
    // 14. The fence, the mailbox and the flower bed.
    {
      bricks: [
        b('1x3', 'white', 4, 1, 15),
        b('round1x1', 'white', 4, 4, 15),
        b('round1x1', 'white', 6, 4, 15),
        b('1x3', 'white', 9, 1, 15),
        b('round1x1', 'white', 9, 4, 15),
        b('round1x1', 'white', 11, 4, 15),
      ],
    },
    // 15. The mailbox and a flower bed.
    {
      bricks: [
        b('1x1', 'brown', 12, 1, 14),
        b('1x2', 'red', 12, 4, 13, 1),
        b('curve1x2', 'red', 12, 7, 13, 2),
        b('plate2x3', 'lime', 1, 1, 9, 1),
        b('leaf2x2', 'yellow', 1, 2, 9),
        b('roundplate1x1', 'green', 1, 2, 11),
        b('plant1x1', 'green', 1, 3, 11),
        b('roundplate1x1', 'green', 2, 2, 11),
        b('plant1x1', 'green', 2, 3, 11),
      ],
    },
    // 16. A tree behind the house.
    {
      bricks: [
        b('1x1', 'brown', 13, 1, 2),
        b('2x4', 'green', 13, 4, 1, 1),
        b('slope2x2', 'green', 13, 7, 1, 2),
        b('slope2x2', 'green', 13, 7, 3),
        b('2x2', 'green', 13, 10, 2),
      ],
    },
  ],
  pages: [
    { note: 'The stone floor and a tan path to the door.' },
    { note: 'The first course of the back and side walls.' },
    { note: 'The front: the brown door and the corner posts.' },
    { note: 'The back wall and its window.' },
    { note: 'A window in each side, and the back posts.', view: { turn: 2 } },
    { note: 'Lattice windows, the front posts and the lintel.' },
    { note: 'Flower boxes under the front windows.' },
    { note: 'The ceiling sticks out a stud front and back.' },
    { note: 'The back of the roof.', view: { turn: 2 } },
    { note: 'The front of the roof.' },
    { note: 'The chimney and the upper back slopes.', view: { turn: 2 } },
    { note: 'The upper front slopes.' },
    { note: 'Tiles along the ridge; finish the chimney.' },
    { note: 'A white fence on each side of the path.' },
    { note: 'The red mailbox and a flower bed.' },
    { note: 'A tree beside the house.' },
  ],
};
