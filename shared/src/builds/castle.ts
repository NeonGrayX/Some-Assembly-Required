import type { TargetBrick, TargetBuild } from './types.ts';
import { b, paginate, run1, square4 } from './kit.ts';

/** A corner tower: five 4x4 layers from (x, z), with a merlon on each corner on top. */
const tower = (x: number, z: number): TargetBrick[][] => [
  ...[1, 4, 7, 10, 13].map((y, i) => square4(x, y, z, 'light-grey', i % 2 === 1)),
  [
    b('1x1', 'light-grey', x, 16, z),
    b('1x1', 'light-grey', x + 3, 16, z),
    b('1x1', 'light-grey', x, 16, z + 3),
    b('1x1', 'light-grey', x + 3, 16, z + 3),
  ],
];

/**
 * A curtain wall between two towers: 8 studs long, three bricks high with staggered joints and
 * four merlons on top. `alongZ` walls run north to south.
 */
const wall = (x: number, z: number, alongZ: boolean): TargetBrick[][] => [
  ...[1, 4, 7].map((y, i) => run1('light-grey', x, y, z, 8, alongZ, i === 1)),
  [0, 2, 4, 6].map((d) => b('1x1', 'light-grey', alongZ ? x : x + d, 10, alongZ ? z + d : z)),
];

/** The south wall, with a gate in the middle under a lintel. */
const gateWall: TargetBrick[][] = [
  ...[1, 4].map((y) => [
    b('1x2', 'light-grey', 4, y, 15),
    b('1x1', 'light-grey', 6, y, 15),
    b('1x1', 'light-grey', 9, y, 15),
    b('1x2', 'light-grey', 10, y, 15),
  ]),
  [
    b('1x2', 'light-grey', 4, 7, 15),
    b('1x4', 'light-grey', 6, 7, 15),
    b('1x2', 'light-grey', 10, 7, 15),
  ],
  [4, 6, 8, 10].map((x) => b('1x1', 'light-grey', x, 10, 15)),
];

/** The keep in the courtyard: a tower with a red roof. */
const keep: TargetBrick[][] = [
  ...[1, 4, 7, 10].map((y, i) => square4(6, y, 6, 'light-grey', i % 2 === 1)),
  square4(6, 13, 6, 'red', false),
  [b('2x2', 'red', 7, 16, 7), b('1x1', 'dark-grey', 7, 19, 7)],
];

const parts = [
  ...tower(0, 0),
  ...tower(12, 0),
  ...tower(0, 12),
  ...tower(12, 12),
  ...wall(4, 0, false),
  ...wall(0, 4, true),
  ...wall(15, 4, true),
  ...gateWall,
  ...keep,
];

// Laid layer by layer, all the way round, so every page builds on the pages before it.
const byLayer = parts.flat().sort((p, q) => p.y - q.y);

/**
 * A castle that fills the whole baseplate, 16 pages: four corner towers, curtain walls with
 * battlements, a gate in the south wall, red flags and a keep with a red roof in the courtyard.
 */
export const CASTLE: TargetBuild = {
  id: 'castle',
  name: 'Castle',
  steps: [
    // Two red flags on the front towers, last.
    ...paginate(byLayer, 15),
    { bricks: [b('1x2', 'red', 0, 19, 12), b('1x2', 'red', 14, 19, 15)] },
  ],
};
