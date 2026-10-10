import type { BrickTypeId, ColourId, Facing, Rotation } from '../bricks.ts';
import type { PageLayout, TargetBrick, TargetBuild } from './types.ts';
import { b, run1, square4 } from './kit.ts';

/** A part clipped sideways onto side studs placed earlier. */
const side = (
  type: BrickTypeId,
  colour: ColourId,
  x: number,
  y: number,
  z: number,
  face: Facing,
  rot: Rotation = 0,
  print?: string,
): TargetBrick => ({
  type,
  colour,
  x,
  y,
  z,
  rot,
  face,
  ...(print ? { prints: { top: print } } : {}),
});

/**
 * One light grey course over a w x d area from (x, z), with the cells in `dark` left as black
 * 1x1 arrow slits. The rest is filled greedily with the biggest bricks that fit.
 */
function course(
  x0: number,
  y: number,
  z0: number,
  w: number,
  d: number,
  dark: [number, number][],
): TargetBrick[] {
  const used = new Set<string>();
  const key = (x: number, z: number) => `${x},${z}`;
  const out: TargetBrick[] = dark.map(([x, z]) => {
    used.add(key(x, z));
    return b('1x1', 'black', x, y, z);
  });
  const shapes: [BrickTypeId, Rotation, number, number][] = [
    ['2x4', 0, 4, 2],
    ['2x4', 1, 2, 4],
    ['2x2', 0, 2, 2],
    ['1x4', 0, 4, 1],
    ['1x4', 1, 1, 4],
    ['1x2', 0, 2, 1],
    ['1x2', 1, 1, 2],
    ['1x1', 0, 1, 1],
  ];
  for (let z = z0; z < z0 + d; z++) {
    for (let x = x0; x < x0 + w; x++) {
      if (used.has(key(x, z))) continue;
      for (const [type, rot, sw, sd] of shapes) {
        const cells: string[] = [];
        for (let i = 0; i < sw; i++)
          for (let j = 0; j < sd; j++)
            if (x + i < x0 + w && z + j < z0 + d && !used.has(key(x + i, z + j)))
              cells.push(key(x + i, z + j));
        if (cells.length !== sw * sd) continue;
        cells.forEach((c) => used.add(c));
        out.push(b(type, 'light-grey', x, y, z, rot));
        break;
      }
    }
  }
  return out;
}

/** The four corner towers, back-left, back-right, front-left, front-right. */
const TOWERS: { x: number; z: number; slits: [number, number][] }[] = [
  { x: 0, z: 0, slits: [[1, 0]] },
  { x: 12, z: 0, slits: [[15, 1]] },
  { x: 0, z: 12, slits: [[2, 15]] },
  { x: 12, z: 12, slits: [[13, 15]] },
];

/** Plain tower courses: two 2x4s each, crossed on alternate layers. */
const towerCourse = (y: number, turned: boolean, which = [0, 1, 2, 3]) =>
  which.flatMap((i) => square4(TOWERS[i]!.x, y, TOWERS[i]!.z, 'light-grey', turned));

/** The slit course of a tower. */
const slitCourse = (i: number) => course(TOWERS[i]!.x, 7, TOWERS[i]!.z, 4, 4, TOWERS[i]!.slits);

/**
 * A black hipped roof on a 4x4 tower top at y = 16: a ring of four 2x2 slopes first, then two
 * more on the ridge and a gold cone between their studs.
 */
const roofRing = (i: number): TargetBrick[] => {
  const { x, z } = TOWERS[i]!;
  return [
    b('slope2x2', 'black', x, 16, z, 2),
    b('slope2x2', 'black', x + 2, 16, z, 2),
    b('slope2x2', 'black', x, 16, z + 2, 0),
    b('slope2x2', 'black', x + 2, 16, z + 2, 0),
  ];
};
const roofTop = (i: number): TargetBrick[] => {
  const { x, z } = TOWERS[i]!;
  return [
    b('slope2x2', 'black', x, 19, z + 1, 3),
    b('slope2x2', 'black', x + 2, 19, z + 1, 1),
    b('cone1x1', 'gold', x + 1.5, 22, z + 1.5),
  ];
};

/** The three plain curtain walls: back (z 0), left (x 0) and right (x 15), x or z 4 to 11. */
const WALLS = [
  { x: 4, z: 0, alongZ: false },
  { x: 0, z: 4, alongZ: true },
  { x: 15, z: 4, alongZ: true },
];
const wallRun = (y: number, offset: boolean) =>
  WALLS.flatMap((w) => run1('light-grey', w.x, y, w.z, 8, w.alongZ, offset));
/** The middle course of each wall, with two arrow slits under the battlements. */
const slitWalls = [
  ...course(4, 4, 0, 8, 1, [
    [6, 0],
    [9, 0],
  ]),
  ...course(0, 4, 4, 1, 8, [
    [0, 6],
    [0, 9],
  ]),
  ...course(15, 4, 4, 1, 8, [
    [15, 6],
    [15, 9],
  ]),
];
const merlons = WALLS.flatMap((w) =>
  [0, 2, 5, 7].map((d) =>
    b('1x1', 'light-grey', w.alongZ ? w.x : w.x + d, 10, w.alongZ ? w.z + d : w.z),
  ),
);

/** A crest over the gate and two purple banners. */
const SVGS: Record<string, string> = {
  crest:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#dcc391'/><path d='M40 30 H160 V100 C160 145 130 168 100 182 C70 168 40 145 40 100 Z' fill='#c91a1a' stroke='#3b2418' stroke-width='8'/><path d='M100 30 V182 M40 92 H160' stroke='#f5c518' stroke-width='14'/></svg>",
  banner:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 200'><rect width='400' height='200' fill='#5c3a9e'/><rect x='10' y='10' width='380' height='180' fill='none' stroke='#c9a23a' stroke-width='10'/><g transform='rotate(-90 200 100)'><path d='M150 130 L150 80 L172 104 L200 66 L228 104 L250 80 L250 130 Z' fill='#c9a23a'/></g></svg>",
};

const pages: { note: string; view?: PageLayout['view']; bricks: TargetBrick[] }[] = [
  {
    note: 'Start the four corner towers.',
    bricks: towerCourse(1, false),
  },
  {
    note: 'The curtain walls, and the gate with its portcullis.',
    bricks: [
      ...wallRun(1, false),
      b('2x2', 'light-grey', 4, 1, 12),
      b('1x2', 'light-grey', 6, 1, 12, 1),
      b('1x2x2', 'brown', 7, 1, 12),
      b('lattice1x2x2', 'brown', 7, 1, 13),
      b('1x2', 'light-grey', 9, 1, 12, 1),
      b('2x2', 'light-grey', 10, 1, 12),
    ],
  },
  {
    note: 'Drawbridge, path, well, tree, flowers, keep base.',
    bricks: [
      b('plate2x4', 'brown', 6, 1, 14),
      b('tile2x2', 'tan', 7, 1, 10),
      b('tile2x2', 'tan', 7, 1, 8),
      b('2x2', 'light-grey', 12, 1, 6),
      b('tile1x2', 'trans-light-blue', 12, 4, 7),
      b('1x2x2', 'brown', 2, 1, 8),
      b('flower2x2', 'yellow', 4, 1, 9),
      b('plant1x1', 'green', 6, 1, 8),
      b('plant1x1', 'green', 9, 1, 8),
      b('plant1x1', 'green', 13, 1, 9),
      ...square4(6, 1, 4, 'light-grey', false),
    ],
  },
  {
    note: 'Towers and gatehouse up a course; well posts.',
    bricks: [
      ...towerCourse(4, true),
      b('1x2', 'light-grey', 4, 4, 12, 1),
      b('2x2', 'light-grey', 5, 4, 12),
      b('2x2', 'light-grey', 9, 4, 12),
      b('1x2', 'light-grey', 11, 4, 12, 1),
      b('1x1', 'brown', 12, 4, 6),
      b('1x1', 'brown', 13, 4, 6),
    ],
  },
  {
    note: 'Walls up a course, with arrow slits.',
    bricks: slitWalls,
  },
  {
    note: 'The keep gets its window; a roof on the well.',
    view: { zoom: 1.3 },
    bricks: [
      b('2x4', 'light-grey', 6, 4, 4),
      b('1x4', 'light-grey', 6, 4, 6),
      b('1x1', 'light-grey', 6, 4, 7),
      b('window1x2x2', 'brown', 7, 4, 7),
      b('1x1', 'light-grey', 9, 4, 7),
      b('slope1x2', 'red', 12, 7, 6),
      b('slope1x2', 'red', 13, 7, 6),
    ],
  },
  {
    note: 'Arrow slits in three of the towers.',
    bricks: [...slitCourse(1), ...slitCourse(2), ...slitCourse(3)],
  },
  {
    note: 'The last slit tower, the tree top and the keep.',
    view: { turn: 2 },
    bricks: [
      ...slitCourse(0),
      b('2x4', 'green', 2, 7, 7, 1),
      b('2x2', 'green', 2, 10, 8),
      b('2x4', 'light-grey', 6, 7, 4),
      b('1x4', 'light-grey', 6, 7, 6),
      b('1x1', 'light-grey', 6, 7, 7),
      b('1x1', 'light-grey', 9, 7, 7),
    ],
  },
  {
    note: 'Top course of the walls; side studs over the gate.',
    bricks: [
      ...wallRun(7, false),
      b('1x4', 'light-grey', 4, 7, 12),
      b('1x4', 'light-grey', 8, 7, 12),
      b('1x2', 'light-grey', 4, 7, 13),
      b('1x1', 'light-grey', 6, 7, 13),
      b('sidestuds1x2', 'black', 7, 7, 13),
      b('1x1', 'light-grey', 9, 7, 13),
      b('1x2', 'light-grey', 10, 7, 13),
    ],
  },
  {
    note: 'The towers rise; side studs on the keep for banners.',
    bricks: [
      ...towerCourse(10, false),
      b('2x4', 'light-grey', 6, 10, 4, 1),
      b('1x4', 'light-grey', 8, 10, 4, 1),
      b('sidestuds1x2', 'black', 9, 10, 4, 1),
      b('sidestuds1x2', 'black', 9, 10, 6, 1),
    ],
  },
  {
    note: 'Clip on the crest and banners; light the torches.',
    view: { zoom: 1.3 },
    bricks: [
      side('tile2x2', 'tan', 7, 7.5, 14, '+z', 0, 'crest'),
      side('tile2x4', 'purple', 10, 3, 4, '+x', 1, 'banner'),
      side('tile2x4', 'purple', 10, 3, 6, '+x', 1, 'banner'),
      b('1x1', 'brown', 5, 1, 14),
      b('cheese1x1', 'trans-orange', 5, 4, 14),
      b('1x1', 'brown', 10, 1, 14),
      b('cheese1x1', 'trans-orange', 10, 4, 14),
    ],
  },
  {
    note: 'Battlements along the walls; top the gatehouse.',
    bricks: [...merlons, b('2x4', 'light-grey', 4, 10, 12), b('2x4', 'light-grey', 8, 10, 12)],
  },
  {
    note: 'Last tower course, and the gatehouse battlements.',
    bricks: [
      ...towerCourse(13, true),
      ...[4, 6, 9, 11].map((x) => b('1x1', 'light-grey', x, 13, 13)),
    ],
  },
  {
    note: 'Roof slopes round the keep and the front towers.',
    bricks: [
      b('slope2x2', 'red', 6, 13, 4, 2),
      b('slope2x2', 'red', 8, 13, 4, 2),
      b('slope2x2', 'red', 6, 13, 6, 0),
      b('slope2x2', 'red', 8, 13, 6, 0),
      ...roofRing(2),
      ...roofRing(3),
    ],
  },
  {
    note: 'And round the back towers.',
    view: { turn: 2 },
    bricks: [...roofRing(0), ...roofRing(1)],
  },
  {
    note: 'Ridge slopes and gold tips on every roof.',
    bricks: [
      b('slope2x2', 'red', 6, 16, 5, 3),
      b('slope2x2', 'red', 8, 16, 5, 1),
      b('cone1x1', 'gold', 7.5, 19, 5.5),
      ...[0, 1, 2, 3].flatMap(roofTop),
    ],
  },
];

/**
 * A castle that fills the whole baseplate, 185 parts on 16 pages: four corner towers
 * with arrow slits and black hipped roofs tipped in gold, curtain walls with battlements, a
 * gatehouse with a brown door behind a lattice portcullis, a printed crest, purple banners and
 * two torches by the drawbridge, and a courtyard with a red-roofed keep, a well, a tree, a
 * path and flowers.
 */
export const CASTLE: TargetBuild = {
  id: 'castle',
  name: 'Castle',
  steps: pages.map((p) => ({ bricks: p.bricks })),
  pages: pages.map((p) => ({ note: p.note, ...(p.view ? { view: p.view } : {}) })),
  svgs: SVGS,
};
