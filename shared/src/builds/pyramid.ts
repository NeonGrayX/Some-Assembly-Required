import type { ColourId } from '../bricks.ts';
import type { TargetBrick, TargetBuild } from './types.ts';
import { b } from './kit.ts';

/** 2-wide bricks along a run of `length` studs: 2x4s, and a 2x2 for the rest. */
function run2(colour: ColourId, x: number, y: number, z: number, length: number, alongZ: boolean) {
  const out: TargetBrick[] = [];
  for (let at = 0; at < length; at += 4) {
    const type = length - at >= 4 ? '2x4' : '2x2';
    out.push(
      alongZ
        ? b(type, colour, x, y, z + at, type === '2x4' ? 1 : 0)
        : b(type, colour, x + at, y, z),
    );
  }
  return out;
}

/** A square ring two studs thick, `size` studs across from (x, z): the full rows along x first. */
function ring(colour: ColourId, x: number, y: number, z: number, size: number) {
  if (size <= 4)
    return [...run2(colour, x, y, z, size, false), ...run2(colour, x, y, z + 2, 4, false)];
  const far = size - 2;
  return [
    ...run2(colour, x, y, z, size, false),
    ...run2(colour, x, y, z + far, size, false),
    ...run2(colour, x, y, z + 2, size - 4, true),
    ...run2(colour, x + far, y, z + 2, size - 4, true),
  ];
}

/** Tan tiles along a run of `length` studs: 1x2s, and a 1x1 for an odd one out. */
function tiles(x: number, y: number, z: number, length: number, alongZ: boolean) {
  const out: TargetBrick[] = [];
  for (let at = 0; at < length; at += 2) {
    const type = length - at >= 2 ? 'tile1x2' : 'tile1x1';
    out.push(
      alongZ
        ? b(type, 'tan', x, y, z + at, type === 'tile1x2' ? 1 : 0)
        : b(type, 'tan', x + at, y, z),
    );
  }
  return out;
}

/**
 * The tan edging round the ledge a step leaves, one stud wide: the back and left sides
 * (`back`), or the front and right sides. The back row and the front row take the corners.
 */
function edging(at: number, y: number, size: number, back: boolean) {
  const far = at + size - 1;
  return back
    ? [...tiles(at, y, at, size, false), ...tiles(at, y, at + 1, size - 2, true)]
    : [...tiles(at, y, far, size, false), ...tiles(far, y, at + 1, size - 2, true)];
}

/**
 * A palm: a brown trunk two bricks high, a brown 2x2 plate on top from (cx, cz) and four ferns
 * on the plate for its leaves.
 */
const palm = (x: number, z: number, cx: number, cz: number) => [
  b('1x1', 'brown', x, 1, z),
  b('1x1', 'brown', x, 4, z),
  b('plate2x2', 'brown', cx, 7, cz),
  b('plant1x1', 'green', cx, 8, cz),
  b('plant1x1', 'green', cx + 1, 8, cz),
  b('plant1x1', 'green', cx, 8, cz + 1),
  b('plant1x1', 'green', cx + 1, 8, cz + 1),
];

/** Four 2x2 slopes in a pinwheel over a 4x4 square from (x, z), studs left in the middle. */
const peak = (x: number, y: number, z: number) => [
  b('slope2x2', 'yellow', x, y, z, 3),
  b('slope2x2', 'yellow', x + 2, y, z, 2),
  b('slope2x2', 'yellow', x + 2, y, z + 2, 1),
  b('slope2x2', 'yellow', x, y, z + 2, 0),
];

/**
 * A stepped sandstone pyramid in an oasis, 147 parts on 16 pages: five steps from 12 studs
 * across, each ledge edged with tan tiles, a dark entrance at the foot, a peak of slopes under
 * a gold capstone, a little queen's pyramid, an obelisk, palms and a pool of see-through water.
 */
export const PYRAMID: TargetBuild = {
  id: 'pyramid',
  name: 'Pyramid',
  description:
    'A stepped sandstone pyramid with tan edging, a dark entrance and a gold capstone, in an oasis with palms, a pool, an obelisk and a little queen’s pyramid.',
  steps: [
    // 1. The bottom step: back and sides.
    {
      bricks: [
        ...run2('yellow', 0, 1, 0, 12, false),
        ...run2('yellow', 0, 1, 2, 8, true),
        ...run2('yellow', 10, 1, 2, 8, true),
      ],
    },
    // 2. The front, round the dark entrance.
    {
      bricks: [
        b('2x4', 'yellow', 0, 1, 10),
        b('1x2', 'yellow', 4, 1, 10, 1),
        b('2x2', 'black', 5, 1, 9),
        b('1x2', 'yellow', 7, 1, 10, 1),
        b('2x4', 'yellow', 8, 1, 10),
      ],
    },
    // 3. Edging on the back and left.
    { bricks: edging(0, 4, 12, true) },
    // 4. Edging on the front and the right.
    {
      bricks: [
        b('tile1x2', 'tan', 0, 4, 11),
        b('tile1x2', 'tan', 2, 4, 11),
        b('tile1x1', 'tan', 4, 4, 11),
        b('tile1x1', 'tan', 7, 4, 11),
        b('tile1x2', 'tan', 8, 4, 11),
        b('tile1x2', 'tan', 10, 4, 11),
        ...tiles(11, 4, 1, 10, true),
      ],
    },
    // 5. The second step, the entrance going on up.
    {
      bricks: [
        ...run2('yellow', 1, 4, 1, 10, false),
        ...run2('yellow', 1, 4, 3, 6, true),
        ...run2('yellow', 9, 4, 3, 6, true),
        b('2x4', 'yellow', 1, 4, 9),
        b('1x2', 'black', 5, 4, 9),
        b('2x4', 'yellow', 7, 4, 9),
      ],
    },
    // 6. Its edging, with the lintel over the entrance.
    {
      bricks: [
        ...edging(1, 7, 10, true),
        b('tile1x2', 'tan', 1, 7, 10),
        b('tile1x1', 'tan', 3, 7, 10),
        b('tile1x2', 'tan', 4, 7, 10),
        b('tile1x2', 'tan', 6, 7, 10),
        b('tile1x2', 'tan', 8, 7, 10),
        b('tile1x1', 'tan', 10, 7, 10),
        ...tiles(10, 7, 2, 8, true),
      ],
    },
    // 7. The third step.
    { bricks: ring('yellow', 2, 7, 2, 8) },
    // 8. Its edging.
    { bricks: [...edging(2, 10, 8, true), ...edging(2, 10, 8, false)] },
    // 9. The fourth step.
    { bricks: ring('yellow', 3, 10, 3, 6) },
    // 10. Its edging.
    {
      bricks: [...edging(3, 13, 6, true), ...edging(3, 13, 6, false)],
    },
    // 11. The solid top step, the peak and the gold capstone.
    {
      bricks: [
        ...ring('yellow', 4, 13, 4, 4),
        ...peak(4, 16, 4),
        b('cone1x1', 'gold', 5.5, 19, 5.5),
      ],
    },
    // 12. The queen's pyramid.
    {
      bricks: [
        b('2x4', 'yellow', 12, 1, 1, 1),
        b('2x4', 'yellow', 14, 1, 1, 1),
        ...peak(12, 4, 1),
        b('cone1x1', 'gold', 13.5, 7, 2.5),
      ],
    },
    // 13. The obelisk.
    {
      bricks: [
        b('2x2', 'yellow', 1, 1, 13),
        b('1x1', 'yellow', 1, 4, 13),
        b('1x1', 'yellow', 1, 7, 13),
        b('1x1', 'yellow', 1, 10, 13),
        b('cone1x1', 'gold', 1, 13, 13),
      ],
    },
    // 14. The pool.
    {
      bricks: [
        b('tile1x2', 'trans-light-blue', 12, 1, 12),
        b('tile1x2', 'trans-light-blue', 11, 1, 13),
        b('tile1x2', 'trans-light-blue', 13, 1, 13),
        b('tile1x2', 'trans-light-blue', 12, 1, 14),
        b('cheese1x1', 'trans-blue', 14, 1, 12),
        b('cheese1x1', 'trans-blue', 14, 1, 14, 2),
      ],
    },
    // 15. A palm by the pool, and one by the obelisk.
    { bricks: [...palm(15, 11, 14, 10), ...palm(4, 14, 3, 13)] },
    // 16. A third palm, and ferns round the pool.
    {
      bricks: [
        ...palm(14, 6, 13, 6),
        b('plant1x1', 'green', 15, 1, 13),
        b('plant1x1', 'green', 11, 1, 12),
      ],
    },
  ],
  pages: [
    { note: 'The bottom step, 12 studs across: back and sides.' },
    { note: 'The front, round a dark entrance.' },
    { note: 'Tan edging along the back and left of the ledge.' },
    { note: 'Edging on the front and right; leave the doorway open.' },
    { note: 'The second step; the entrance goes up a level.' },
    { note: 'Its edging, with a lintel over the entrance.' },
    { note: 'The third step.' },
    { note: 'Its edging all the way round.' },
    { note: 'The fourth step.' },
    { note: 'Its edging all the way round.' },
    { note: 'The top step, a peak of slopes and the gold capstone.' },
    { note: 'A little queen’s pyramid beside it.' },
    { note: 'A sandstone obelisk with a gold tip.' },
    { note: 'The oasis: see-through blue water.' },
    { note: 'A palm by the pool and one by the obelisk.' },
    { note: 'A palm behind, and ferns by the water.' },
  ],
};
