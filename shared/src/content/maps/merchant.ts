import type { Vec3 } from '../../math.ts';
import type { BoxDef, HideoutDef, LevelDef } from '../house.ts';
import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  binsAlong,
  box,
  dogNetwork,
  drawerIn,
  facingToward,
  fences,
  floorOf,
  gen,
  gridPoints,
  hideout,
  lampPost,
  LADDER_CLEAR,
  pallets,
  rect,
  roofOver,
  roomWalls,
  mapProblems,
} from './common.ts';
import type { BinRun, Gap } from './common.ts';

/**
 * Brick & Mortar, the builders' merchant: a warehouse hall with shelving aisles, a staff room
 * and an office along its east side, and a yard with the loading dock as the job site. The
 * bricks are the shop's own stock, in picking bins along the aisles. Every round the aisles
 * are laid out in one of four patterns, two of the three roller shutters stand open, and the
 * skip, the portaloo, the forklift and the pallet stacks go where they will.
 */

const CONCRETE = 0x8d8a84;
const ASPHALT = 0x7f7b76;
const STEEL = 0x9aa3ad;
const ROOF = 0x6e7378;
const LINO = 0xc9b8a0;
const CARPET = 0xa39a7e;
const RACK = 0x3f6fb5;
const WOOD = 0x9a6b43;
const FORK = 0xe8b923;

const HALL = rect(-13, 5, 7, 15);
const STAFF = rect(7, 10, 15, 15);
const OFFICE = rect(7, 5, 15, 10);
const DOCK_OFFICE = rect(-15, -2, -11, 1);
const WALL_H = 4;
const RACK_H = 1.8;
const SHUTTERS = [-9, -3, 3];

interface Rack {
  x: number;
  z: number;
  /** Along z (true) or along x. */
  tall: boolean;
  len: number;
}

const PATTERNS: Rack[][] = [
  // Four straight aisles.
  [-11, -6.6, -2.2, 2.2].map((x) => ({ x, z: 10, tall: true, len: 6 })),
  // Two long ones across and one down the east side.
  [
    ...[7.8, 12.2].map((z) => ({ x: -7.5, z, tall: false, len: 9 })),
    { x: 2.5, z: 10, tall: true, len: 6 },
  ],
  // Staggered short runs.
  [
    { x: -11, z: 8.5, tall: true, len: 4 },
    { x: -6.6, z: 11.5, tall: true, len: 4 },
    { x: -2.2, z: 8.5, tall: true, len: 4 },
    { x: 2.2, z: 11.5, tall: true, len: 4 },
  ],
  // An L round the packing bench.
  [
    { x: -11, z: 10, tall: true, len: 6 },
    { x: -6.6, z: 10, tall: true, len: 6 },
    { x: 0, z: 13, tall: false, len: 5.5 },
    { x: 0, z: 7, tall: false, len: 5.5 },
  ],
];

const rackBox = (r: Rack): BoxDef =>
  box(r.x, RACK_H / 2, r.z, r.tall ? 0.8 : r.len, RACK_H, r.tall ? r.len : 0.8, RACK, {
    model: 'bookshelf',
    front: r.tall ? '+x' : '-z',
  });

/** Bin runs along both long faces of a rack, 0.9 m off it. */
const rackRuns = (r: Rack): BinRun[] => {
  const half = r.len / 2 - 0.4;
  return [-1, 1].map((side) =>
    r.tall
      ? { from: { x: r.x + side * 1.1, z: r.z - half }, to: { x: r.x + side * 1.1, z: r.z + half } }
      : {
          from: { x: r.x - half, z: r.z + side * 1.3 },
          to: { x: r.x + half, z: r.z + side * 1.3 },
        },
  );
};

export function merchantLayout(seed: number): LevelDef {
  for (let attempt = 0; attempt < 12; attempt++) {
    const level = tryLayout(seed + attempt * 7919);
    if (!mapProblems(level).length) return level;
  }
  throw new Error('no merchant layout passed the checks');
}

/** One try at a layout from a seed, before the checks (see `mapProblems`). */
export function tryLayout(seed: number): LevelDef {
  const g = gen(seed);
  const boxes: BoxDef[] = [...fences()];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  let id = 1;

  // The hall, with two of its three shutters open and a side door to the west.
  const open = g.shuffle(SHUTTERS).slice(0, 2);
  const gaps: Gap[] = [
    ...open.map((x) => ({ side: 's', at: x, width: 3 }) as Gap),
    { side: 'w', at: 6, width: 1.6 },
    { side: 'e', at: 12.5, width: 1.4 },
    { side: 'e', at: 7.5, width: 1.4 },
  ];
  boxes.push(...roomWalls(HALL, WALL_H, STEEL, gaps));
  boxes.push(...roomWalls(STAFF, WALL_H, STEEL, [], { skip: ['w', 's'] }));
  boxes.push(
    ...roomWalls(OFFICE, WALL_H, STEEL, [{ side: 's', at: 11, width: 1.4 }], { skip: ['w'] }),
  );
  boxes.push(roofOver(rect(HALL.x0, HALL.z0, OFFICE.x1, HALL.z1), WALL_H, ROOF));
  // Shut shutters are drawn as a lower, lighter stretch of wall.
  for (const x of SHUTTERS)
    if (!open.includes(x)) boxes.push(box(x, 1.6, HALL.z0, 2.9, 3.2, 0.12, 0xb9bec4));

  // The dock office in the yard.
  boxes.push(...roomWalls(DOCK_OFFICE, 3, 0xd9d4c7, [{ side: 'e', at: -0.5, width: 1.2 }]));
  boxes.push(roofOver(DOCK_OFFICE, 3, ROOF));
  hideouts.push(hideout(id++, 'mailbox', -10.75, -1.4, EAST, 0.9));
  pageSpots.push({ x: -13, y: 3.25, z: -0.5 }, { x: -13, y: 0.8, z: -0.5 });
  boxes.push(box(-13, 0.4, -0.5, 1.4, 0.8, 0.7, WOOD, { model: 'table' }));

  // The aisles.
  const pattern = g.pick(PATTERNS);
  const runs: BinRun[] = [];
  for (const r of pattern) {
    boxes.push(rackBox(r));
    runs.push(...rackRuns(r));
    pageSpots.push({ x: r.x, y: RACK_H + 0.05, z: r.z });
  }
  // Pallet stacks to climb a rack by, at one of its ends, and loose ones about the yard.
  const climb = g.pick(pattern);
  const end = climb.tall
    ? { x: climb.x, z: climb.z + (g.chance(0.5) ? 1 : -1) * (climb.len / 2 + 0.9) }
    : { x: climb.x + (g.chance(0.5) ? 1 : -1) * (climb.len / 2 + 0.9), z: climb.z };
  const dir = climb.tall ? { x: 1.1, z: 0 } : { x: 0, z: 1.1 };
  for (let n = 1; n <= 4; n++)
    boxes.push(...pallets(end.x + dir.x * (n - 2.5), end.z + dir.z * (n - 2.5), n));
  pageSpots.push({ x: end.x + dir.x * 1.5, y: 1.15, z: end.z + dir.z * 1.5 });
  // Spare bin spots along the hall's front, outside.
  const spare = Array.from({ length: 20 }, (_, i) => ({ x: -12 + i * 1.3, z: 3.4 }));
  const bins = binsAlong(runs, spare);

  // The packing bench, with the toolbox on it and the broom beside it.
  boxes.push(box(4, 0.45, 13.5, 2.4, 0.9, 1, WOOD, { model: 'table' }));
  hideouts.push(hideout(id++, 'toolbox', 3.4, 13.5, SOUTH, 0.9));
  pageSpots.push({ x: 4.6, y: 0.95, z: 13.5 });
  // Paint tins on a rack end: small lidded tins.
  const tins = g.pick(pattern);
  const tinAt = tins.tall
    ? { x: tins.x, z: tins.z - tins.len / 2 + 0.4 }
    : { x: tins.x - tins.len / 2 + 0.4, z: tins.z };
  hideouts.push(
    hideout(id++, 'toolbox', tinAt.x, tinAt.z, SOUTH, RACK_H, { x: 0.4, y: 0.3, z: 0.4 }),
  );
  // The electrical panel on the back wall, and a doormat inside an open shutter.
  boxes.push(box(-5, 1.5, HALL.z1 - 0.17, 0.6, 0.8, 0.14, 0x8e979c, { model: 'panel' }));
  hideouts.push(
    hideout(id++, 'rug', g.pick(open), HALL.z0 + 0.8, SOUTH, 0.0, { x: 1.4, y: 0.02, z: 1 }),
  );

  // The staff room: lockers along the north wall, the fridge, the table everyone meets at.
  const lockerXs = g.shuffle([8.4, 9.3, 10.2, 11.1, 12]).slice(0, 3);
  for (const x of lockerXs) hideouts.push(hideout(id++, 'locker', x, STAFF.z1 - 0.5, SOUTH));
  hideouts.push(hideout(id++, 'fridge', STAFF.x1 - 0.5, 13.2, WEST));
  pageSpots.push({ x: STAFF.x1 - 0.5, y: 1.85, z: 13.2 });
  const counter = box(13.4, 0.45, STAFF.z1 - 0.4, 2, 0.9, 0.6, 0xd9d4c7, { model: 'counter' });
  boxes.push(counter);
  hideouts.push(drawerIn(id++, counter, -0.5));
  const treatJar = { x: 13.9, y: 0.9, z: STAFF.z1 - 0.4 };
  boxes.push(box(11, 0.4, 12.2, 2.6, 0.8, 1.1, WOOD, { model: 'table' }));
  pageSpots.push({ x: 11.8, y: 0.85, z: 12.2 });
  hideouts.push(hideout(id++, 'rug', STAFF.x0 + 0.9, 12.5, SOUTH, 0));
  const meetingSeats: Vec3[] = [
    ...[9.9, 10.6, 11.3, 12.0].map((x) => ({ x, y: 0, z: 11.2 })),
    ...[9.9, 10.6, 11.3, 12.0].map((x) => ({ x, y: 0, z: 13.2 })),
    { x: 9.3, y: 0, z: 12.2 },
    { x: 12.7, y: 0, z: 12.2 },
  ];

  // The office: a desk with drawers, the filing cabinet, the safe.
  const desk = box(11, 0.45, OFFICE.z1 - 0.5, 2, 0.9, 0.7, WOOD, { model: 'counter' });
  boxes.push(desk);
  hideouts.push(drawerIn(id++, desk, -0.5), drawerIn(id++, desk, 0.5));
  pageSpots.push({ x: 11.6, y: 0.95, z: OFFICE.z1 - 0.5 });
  hideouts.push(hideout(id++, 'cabinet', OFFICE.x1 - 0.35, 8.3, WEST));
  // A little off the walls, so the lid can lift behind it.
  const safeAt = g.pick([
    { x: OFFICE.x0 + 1.1, z: OFFICE.z0 + 1.1 },
    { x: OFFICE.x1 - 1.1, z: OFFICE.z0 + 1.1 },
    { x: OFFICE.x0 + 1.1, z: OFFICE.z1 - 1.6 },
  ]);
  hideouts.push(hideout(id++, 'chest', safeAt.x, safeAt.z, NORTH, 0, { x: 0.8, y: 0.9, z: 0.7 }));
  hideouts.push(hideout(id++, 'rug', 11, OFFICE.z0 + 0.9, SOUTH, 0));

  // The yard: the skip, the portaloo, the forklift, crates, and lamp posts.
  const skipAt = g.pick([
    { x: -13.5, z: -9 },
    { x: 13.5, z: -9 },
    { x: 9, z: -13.5 },
  ]);
  hideouts.push(hideout(id++, 'skip', skipAt.x, skipAt.z, facingToward(-skipAt.x, -skipAt.z)));
  const looAt = g.pick([
    { x: 14.3, z: 2 },
    { x: -14.3, z: 3 },
    { x: 14.3, z: -13 },
  ]);
  hideouts.push(
    hideout(id, 'locker', looAt.x, looAt.z, looAt.x > 0 ? WEST : EAST, 0, {
      x: 1.1,
      y: 2.3,
      z: 1.1,
    }),
  );
  const forkAt = g.pick([
    { x: -9, z: -10 },
    { x: 6, z: -9 },
    { x: -5, z: -13 },
  ]);
  boxes.push(
    box(forkAt.x, 0.55, forkAt.z, 1.4, 1.1, 2.2, FORK),
    box(forkAt.x, 1.4, forkAt.z - 1.3, 1.2, 2.8, 0.25, 0x2b2b2b),
  );
  pageSpots.push(
    { x: forkAt.x, y: 0.35, z: forkAt.z - 1.9 },
    { x: forkAt.x, y: 1.15, z: forkAt.z },
  );
  boxes.push(box(forkAt.x, 0.15, forkAt.z - 1.9, 1, 0.3, 0.9, 0x2b2b2b, { model: 'step' }));
  for (const c of g
    .shuffle([
      { x: -6, z: -8 },
      { x: 3, z: -6 },
      { x: 12, z: -3 },
      { x: -11, z: -13 },
      { x: 7, z: -14 },
    ])
    .slice(0, 3)) {
    boxes.push(box(c.x, 0.3, c.z, 0.6, 0.6, 0.6, WOOD, { model: 'crate' }));
    pageSpots.push({ x: c.x, y: 0.62, z: c.z });
  }
  for (const [x, z] of [
    [-14, -14],
    [14, -14],
    [-5, 3.6],
    [9, 3.6],
    [-14, 10],
  ] as const)
    boxes.push(lampPost(x, z));
  // The returns desk by the inspector.
  boxes.push(box(-12, 0.4, -7, 1.8, 0.8, 0.8, WOOD, { model: 'table' }));
  pageSpots.push({ x: -12, y: 0.85, z: -7 });

  // Up on the hall's roof by the yard ladder: air-conditioning units with pages behind them.
  const ladderX = g.pick([-11, 5]);
  const ladders = [
    {
      pos: { x: ladderX, y: 0, z: HALL.z0 - 0.35 },
      width: 0.8,
      // Up past the roof's top by a climber's height, so they come out standing on it.
      height: WALL_H + 0.2 + LADDER_CLEAR,
      facing: NORTH,
    },
  ];
  for (const [x, z] of [
    [-4, 8],
    [1, 12],
    [11, 8],
  ] as const) {
    boxes.push(box(x, WALL_H + 0.2 + 0.45, z, 1.2, 0.9, 1.2, 0xb9bec4));
    pageSpots.push({ x: x + 1, y: WALL_H + 0.25, z });
  }
  pageSpots.push({ x: -8, y: WALL_H + 0.25, z: 13 }, { x: 6, y: WALL_H + 0.25, z: 6 });

  const level: LevelDef = {
    floorSize: 32,
    groundColour: ASPHALT,
    boxes,
    decals: [
      floorOf(HALL, CONCRETE),
      floorOf(STAFF, LINO),
      floorOf(OFFICE, CARPET),
      floorOf(DOCK_OFFICE, LINO),
    ],
    bins,
    baseplate: { x: -0.8, y: 0, z: -0.8 },
    inspector: { pos: { x: -12, y: 0, z: -4 }, size: { x: 2.4, z: 2.4 } },
    doneButton: { x: -1.8, y: 0, z: 1.4 },
    bell: { x: 1.8, y: 0, z: 1.4 },
    board: { pos: { x: -4, y: 1.3, z: 3 }, facing: Math.PI },
    pageSpots,
    hideouts,
    ladders,
    meetingSeats,
    lights: [
      ...[-10, -5, 0, 5].flatMap((x) => [7.5, 12.5].map((z) => ({ x, y: 3.6, z }))),
      { x: 11, y: 2.6, z: 12.5 },
      { x: 11, y: 2.6, z: 7.5 },
      { x: -13, y: 2.4, z: -0.5 },
    ],
    windows: [],
    spawn: { x: 0, y: 1, z: -5 },
    dog: { points: [], links: [], start: 0, treatJar },
    broom: { pos: { x: -8, y: 0, z: HALL.z1 - 0.25 }, facing: 0 },
    catapult: { pos: { x: 10, y: 0, z: -13.5 }, facing: facingToward(-10, 13.5) },
  };
  const dog = dogNetwork(
    level,
    [
      ...gridPoints(rect(-15, -15, 15, 4), 2.5),
      ...gridPoints(HALL, 2),
      ...gridPoints(STAFF, 2),
      ...gridPoints(OFFICE, 2),
      { x: -13, y: 0, z: -0.5 },
    ],
    { x: -9, y: 0, z: -3 },
    treatJar,
  );
  level.dog = dog;
  return level;
}
