import type { Vec3 } from '../../math.ts';
import type { BoxDef, DoorDef, HideoutDef, LevelDef, WindowDef } from '../house.ts';
import {
  EAST,
  NORTH,
  PALLET,
  SOUTH,
  WEST,
  binsAlong,
  box,
  dogNetwork,
  drawerIn,
  fences,
  floorOf,
  gen,
  gridPoints,
  grow,
  headersOver,
  hideout,
  lampPost,
  mapProblems,
  LADDER_CLEAR,
  pallets,
  reachable,
  rect,
  roofOver,
  roomWalls,
  unreachableHighSpots,
  walkableGround,
} from './common.ts';
import type { BinRun, Gap } from './common.ts';
import type { FloorRect } from '../house.ts';

/**
 * Brick & Mortar, the builders' merchant: a warehouse hall with shelving aisles, a staff room
 * and an office along its east side, and a yard with the dock office as the job site. The
 * bricks are the shop's own stock, in picking bins along the aisles. Every round the aisles
 * are laid out in one of four patterns, two of the three roller shutters stand open, and the
 * skip, the portaloo, the forklift and the pallet stacks go where they will.
 *
 * Everything is placed so that nothing runs into anything else: the walls of neighbouring
 * rooms stop at each other's faces, doorways have a header over them as tall as a door, the
 * pallet stacks are stairs up to one rack, and the yard's things are put where there is room
 * (see `place` below). `merchantProblems` checks all of that for a finished layout.
 */

const CONCRETE = 0x8d8a84;
const ASPHALT = 0x7f7b76;
const STEEL = 0x9aa3ad;
const ROOF = 0x6e7378;
const LINO = 0xc9b8a0;
const CARPET = 0xa39a7e;
const RACK = 0x2f5fa8;
const WOOD = 0x9a6b43;
const FORK = 0xe8b923;
const SHUTTER = 0xb9bec4;
const PALLET_WOOD = 0xb48f5a;

const HALL = rect(-13, 5, 7, 15);
const STAFF = rect(7, 10, 15, 15);
const OFFICE = rect(7, 5, 15, 10);
const BUILDING = rect(HALL.x0, HALL.z0, OFFICE.x1, HALL.z1);
const DOCK_OFFICE = rect(-15, -2, -11, 1);
const WALL_H = 4;
const DOCK_H = 3;
/** Doorways are this tall; the wall above them is a header. */
const DOOR_H = 2.2;
/** The roller shutters' bays: this wide, this tall, along the hall's south wall. */
const SHUTTERS = [-9, -3, 3];
const BAY = { width: 3, height: 3.2 };
const RACK_H = 1.6;
const ROOF_TOP = WALL_H + 0.2;
/** Where a ladder's foot stands off the wall it leans on, and the roof rail's height. */
const LADDER_OFF = 0.4;
const ROOF_RAIL_H = 1.3;
const ROOF_RAIL_T = 0.06;
/** Picking bins stand this far apart along an aisle, centre to centre. */
const BIN_PITCH = 0.95;

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
    ...[8.4, 12.6].map((z) => ({ x: -7.5, z, tall: false, len: 9 })),
    { x: 2.5, z: 10, tall: true, len: 6 },
  ],
  // Staggered runs.
  [
    { x: -11, z: 9.2, tall: true, len: 5 },
    { x: -6.6, z: 11.2, tall: true, len: 5 },
    { x: -2.2, z: 9.2, tall: true, len: 5 },
    { x: 2.2, z: 11.2, tall: true, len: 5 },
  ],
  // Two aisles down and two across between them and the east wall.
  [
    { x: -11, z: 10, tall: true, len: 6 },
    { x: -6.6, z: 10, tall: true, len: 6 },
    { x: 0, z: 12.6, tall: false, len: 5.5 },
    { x: 0, z: 8.2, tall: false, len: 5.5 },
  ],
];

/** The yard's lamp posts. */
const LAMPS = [
  [-14, -14],
  [14, -14],
  [-5, 3.6],
  [9, 3.6],
  [-14, 10],
] as const;

const RACK_DEPTH = 0.8;
/** How far the bins on either side stand from a rack's middle. */
const BIN_OFF = { tall: 1.1, flat: 1.3 };

const rackBox = (r: Rack): BoxDef =>
  box(
    r.x,
    RACK_H / 2,
    r.z,
    r.tall ? RACK_DEPTH : r.len,
    RACK_H,
    r.tall ? r.len : RACK_DEPTH,
    RACK,
    { model: 'rack', front: r.tall ? '+x' : '-z' },
  );

/** Bin runs along both long faces of a rack. */
const rackRuns = (r: Rack): BinRun[] => {
  const half = r.len / 2 - 0.4;
  return [-1, 1].map((side) =>
    r.tall
      ? {
          from: { x: r.x + side * BIN_OFF.tall, z: r.z - half },
          to: { x: r.x + side * BIN_OFF.tall, z: r.z + half },
        }
      : {
          from: { x: r.x - half, z: r.z + side * BIN_OFF.flat },
          to: { x: r.x + half, z: r.z + side * BIN_OFF.flat },
        },
  );
};

/** The floor a rack and its bins take up. */
const rackZone = (r: Rack): FloorRect =>
  r.tall
    ? rect(r.x - BIN_OFF.tall - 0.4, r.z - r.len / 2, r.x + BIN_OFF.tall + 0.4, r.z + r.len / 2)
    : rect(r.x - r.len / 2, r.z - BIN_OFF.flat - 0.4, r.x + r.len / 2, r.z + BIN_OFF.flat + 0.4);

/**
 * `total` bins spread as evenly as the runs allow, each run's share spaced out along it
 * (the bins stand `BIN_PITCH` apart at the closest).
 */
function spreadBins(runs: BinRun[], total: number): BinRun[] {
  const cap = runs.map(
    (r) => Math.floor(Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z) / BIN_PITCH + 1e-6) + 1,
  );
  const n = runs.map(() => 0);
  for (let left = total; left > 0;) {
    let any = false;
    for (let i = 0; i < runs.length && left > 0; i++)
      if (n[i]! < cap[i]!) {
        n[i]!++;
        left--;
        any = true;
      }
    if (!any) throw new Error('the aisles cannot hold all the bins');
  }
  return runs.flatMap((r, i) => {
    const count = n[i]!;
    if (!count) return [];
    const len = Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z);
    return [{ ...r, every: count === 1 ? len + 1 : len / (count - 1) }];
  });
}

const foot = (x: number, z: number, w: number, d: number): FloorRect =>
  rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
const touches = (a: FloorRect, b: FloorRect): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

export function merchantLayout(seed: number): LevelDef {
  for (let attempt = 0; attempt < 12; attempt++) {
    const level = tryLayout(seed + attempt * 7919);
    if (!merchantProblems(level).length) return level;
  }
  throw new Error('no merchant layout passed the checks');
}

/** What is wrong with a finished layout: the common checks, and that every way in is open. */
export function merchantProblems(level: LevelDef): string[] {
  const problems = mapProblems(level);
  const walk = walkableGround(level);
  const shut = (x: number) =>
    level.boxes.some((b) => b.model === 'shutter' && b.size.y > 2 && Math.abs(b.pos.x - x) < 0.1);
  for (const x of SHUTTERS) {
    if (shut(x)) continue;
    // Out in the yard in front of an open shutter, and inside the hall behind it.
    if (!reachable(walk, x, HALL.z0 - 0.8, 0.5))
      problems.push(`shutter at ${x}: yard side blocked`);
    if (!reachable(walk, x, HALL.z0 + 1.1, 0.5))
      problems.push(`shutter at ${x}: hall side blocked`);
  }
  for (const [x, z] of [
    [HALL.x0 - 0.8, 6],
    [HALL.x0 + 0.8, 6],
    [HALL.x1 - 0.8, 12.5],
    [HALL.x1 + 0.8, 12.5],
    [HALL.x1 - 0.8, 7.5],
    [HALL.x1 + 0.8, 7.5],
  ] as const)
    if (!reachable(walk, x, z, 0.5)) problems.push(`the doorway near ${x}, ${z} is blocked`);
  return problems;
}

/** One try at a layout from a seed, before the checks (see `merchantProblems`). */
export function tryLayout(seed: number): LevelDef {
  const g = gen(seed);
  const boxes: BoxDef[] = [...fences()];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  let id = 1;

  /** Floor spoken for, so that what goes next does not land on it. */
  const taken: FloorRect[] = [];
  const claim = (r: FloorRect) => void taken.push(r);
  const fits = (r: FloorRect, gap = 0.3) => !taken.some((t) => touches(grow(r, gap), t));
  /** Puts something at the first of the candidates (in random order) with room for it. */
  const place = <T extends { x: number; z: number }>(
    candidates: T[],
    area: (c: T) => FloorRect,
    gap = 0.4,
  ): T | null => {
    for (const c of g.shuffle(candidates)) {
      if (fits(area(c), gap)) {
        claim(area(c));
        return c;
      }
    }
    return null;
  };

  // ---------------------------------------------------------------- the buildings
  // The hall: all three shutter bays are openings, a side door to the west and two to the
  // east. Two shutters stand open; the third has its slats down.
  const open = g.shuffle(SHUTTERS).slice(0, 2);
  const bays: Gap[] = SHUTTERS.map((x) => ({ side: 's', at: x, width: BAY.width }));
  const doors: Gap[] = [
    { side: 'w', at: 6, width: 1.6 },
    { side: 'e', at: 12.5, width: 1.4 },
    { side: 'e', at: 7.5, width: 1.4 },
  ];
  boxes.push(...roomWalls(HALL, WALL_H, STEEL, [...bays, ...doors]));
  // The staff room and the office share the hall's east wall and each other's, and stop at
  // the faces of those walls instead of running on into them.
  boxes.push(...roomWalls(STAFF, WALL_H, STEEL, [], { skip: ['w', 's'] }));
  const officeDoor: Gap = { side: 's', at: 11, width: 1.4 };
  boxes.push(...roomWalls(OFFICE, WALL_H, STEEL, [officeDoor], { skip: ['w'] }));
  // Over the doorways the wall carries on down to a door's height; over a shutter bay it is
  // the shutter's housing.
  boxes.push(
    ...headersOver(HALL, WALL_H, STEEL, [...doors], DOOR_H),
    ...headersOver(OFFICE, WALL_H, STEEL, [officeDoor], DOOR_H),
    ...headersOver(HALL, WALL_H, SHUTTER, bays, BAY.height).map((b): BoxDef => ({
      ...b,
      model: 'shutter',
    })),
  );
  boxes.push(roofOver(BUILDING, WALL_H, ROOF));
  // Slats down over the shut shutter's bay.
  for (const x of SHUTTERS)
    if (!open.includes(x))
      boxes.push(
        box(x, BAY.height / 2, HALL.z0, BAY.width, BAY.height, 0.12, SHUTTER, { model: 'shutter' }),
      );

  // The dock office in the yard.
  const dockDoor: Gap = { side: 'e', at: -0.5, width: 1.2 };
  boxes.push(
    ...roomWalls(DOCK_OFFICE, DOCK_H, 0xd9d4c7, [dockDoor]),
    ...headersOver(DOCK_OFFICE, DOCK_H, 0xd9d4c7, [dockDoor], DOOR_H),
    roofOver(DOCK_OFFICE, DOCK_H, ROOF),
  );
  hideouts.push(hideout(id++, 'mailbox', DOCK_OFFICE.x1 + 0.36, -1.4, EAST, 0.9));
  pageSpots.push({ x: -13, y: 0.8, z: -0.5 });
  boxes.push(box(-13, 0.4, -0.5, 1.4, 0.8, 0.7, WOOD, { model: 'table' }));

  // Windows: the dock office, the staff room over the counter, and the office.
  const windows: WindowDef[] = [
    { x: -13, z: DOCK_OFFICE.z1, alongX: true },
    { x: 13.4, z: STAFF.z1, alongX: true },
    { x: 13.6, z: OFFICE.z0, alongX: true },
    { x: OFFICE.x1, z: 6.9, alongX: false },
  ];

  // Ground spoken for before anything is scattered in the yard: the walk in front of the
  // hall (the ladder, lamp posts and every way in), the job site, the dock office and the
  // inspector, the catapult, and the spot players appear at.
  claim(rect(-15.5, 1, 15.5, 4.9));
  claim(grow(DOCK_OFFICE, 1));
  claim(rect(-13.4, -5.4, -10.6, -2.6));
  claim(rect(-3, -2.5, 3, 2.2));
  claim(rect(6.5, -15.9, 12.8, -11));
  claim(rect(-1.5, -6.5, 1.5, -3.5));
  claim(rect(-13.4, -7.8, -10.6, -6.2));
  for (const [x, z] of LAMPS) claim(foot(x, z, 0.5, 0.5));

  // ---------------------------------------------------------------- inside the hall
  // Keep the ways in clear: in front of the bays, doors and the panel, the broom's corner.
  for (const x of SHUTTERS) claim(rect(x - 1.7, HALL.z0, x + 1.7, HALL.z0 + 1.2));
  claim(rect(HALL.x0, 5.2, HALL.x0 + 1.4, 6.8));
  claim(rect(HALL.x1 - 1.4, 6.8, HALL.x1, 8.2));
  claim(rect(HALL.x1 - 1.4, 11.8, HALL.x1, 13.2));
  claim(rect(-5.8, 13.9, -4.2, HALL.z1));
  claim(rect(-8.5, 14.2, -7.5, HALL.z1));

  // The aisles.
  const pattern = g.pick(PATTERNS);
  const runs: BinRun[] = [];
  for (const r of pattern) {
    boxes.push(rackBox(r));
    runs.push(...rackRuns(r));
  }
  // The packing bench by the east wall, with the toolbox and the paint tins on it.
  const bench = { x: 5.4, z: 14.4 };
  boxes.push(box(bench.x, 0.45, bench.z, 2, 0.9, 0.9, WOOD, { model: 'table' }));
  claim(foot(bench.x, bench.z, 2, 0.9));
  hideouts.push(hideout(id++, 'toolbox', bench.x - 0.4, bench.z, SOUTH, 0.9));
  hideouts.push(hideout(id++, 'tin', bench.x + 0.35, bench.z, SOUTH, 0.9));
  hideouts.push(hideout(id++, 'tin', bench.x + 0.75, bench.z + 0.1, SOUTH, 0.9));
  pageSpots.push({ x: bench.x, y: 0.95, z: bench.z - 0.25 });
  for (const r of pattern) claim(rackZone(r));

  // Pallet stacks as stairs up to one rack: four pallets high by its end, then three, two and
  // one going out sideways. The first end and side that fits in the hall is used.
  const stairs = g
    .shuffle(pattern)
    .flatMap((r) =>
      g.shuffle([1, -1]).flatMap((end) => g.shuffle([1, -1]).map((side) => ({ r, end, side }))),
    )
    .map(({ r, end, side }) => {
      const stacks = [4, 3, 2, 1].map((n, k) => {
        // Along the rack's axis past its end for the first, then sideways from there.
        const reach = (r.len / 2) * end + end * (PALLET[r.tall ? 'z' : 'x'] / 2 + 0.05);
        const sideways = side * k * ((r.tall ? PALLET.x : PALLET.z) + 0.05);
        const at = r.tall
          ? { x: r.x + sideways, z: r.z + reach }
          : { x: r.x + reach, z: r.z + sideways };
        return { n, ...at, area: foot(at.x, at.z, PALLET.x, PALLET.z) };
      });
      return { r, stacks };
    })
    .find(({ stacks }) =>
      stacks.every(
        (s) =>
          s.area.x0 > HALL.x0 + 0.2 &&
          s.area.x1 < HALL.x1 - 0.2 &&
          s.area.z0 > HALL.z0 + 0.2 &&
          s.area.z1 < HALL.z1 - 0.2 &&
          fits(s.area, 0.02),
      ),
    );
  if (stairs) {
    for (const s of stairs.stacks) {
      boxes.push(...pallets(s.x, s.z, s.n, PALLET_WOOD));
      claim(s.area);
    }
    const top = stairs.r;
    pageSpots.push({ x: top.x, y: RACK_H + 0.05, z: top.z });
    // A paint tin up there too, at the rack's end, away from the stairs.
    const away = top.tall
      ? { x: top.x, z: top.z - Math.sign(stairs.stacks[0]!.z - top.z) * (top.len / 2 - 0.4) }
      : { x: top.x - Math.sign(stairs.stacks[0]!.x - top.x) * (top.len / 2 - 0.4), z: top.z };
    hideouts.push(hideout(id++, 'tin', away.x, away.z, SOUTH, RACK_H));
  }

  // The electrical panel on the back wall, and a doormat out in front of an open shutter.
  boxes.push(box(-5, 1.5, HALL.z1 - 0.17, 0.6, 0.8, 0.14, 0x8e979c, { model: 'panel' }));
  hideouts.push(
    hideout(id++, 'rug', g.pick(open), HALL.z0 - 0.8, SOUTH, 0, { x: 1.4, y: 0.02, z: 1 }),
  );

  // ---------------------------------------------------------------- the staff room
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

  // ---------------------------------------------------------------- the office
  const desk = box(11, 0.45, OFFICE.z1 - 0.5, 2, 0.9, 0.7, WOOD, { model: 'counter' });
  boxes.push(desk);
  hideouts.push(drawerIn(id++, desk, -0.5), drawerIn(id++, desk, 0.5));
  pageSpots.push({ x: 11.6, y: 0.95, z: OFFICE.z1 - 0.5 });
  hideouts.push(hideout(id++, 'cabinet', OFFICE.x1 - 0.35, 8.3, WEST));
  // The safe stands a little off the walls so its door can swing.
  const safeAt = g.pick([
    { x: OFFICE.x0 + 1.1, z: OFFICE.z0 + 1.1 },
    { x: OFFICE.x1 - 1.1, z: OFFICE.z0 + 1.1 },
    { x: OFFICE.x0 + 1.1, z: OFFICE.z1 - 1.6 },
  ]);
  hideouts.push(hideout(id++, 'safe', safeAt.x, safeAt.z, NORTH));
  hideouts.push(hideout(id++, 'rug', 11, OFFICE.z0 + 0.9, SOUTH, 0));

  // ---------------------------------------------------------------- the yard
  const skip = place(
    [
      { x: -13.5, z: -9, facing: EAST, w: 1.6, d: 2.4 },
      { x: -13.5, z: -13, facing: EAST, w: 1.6, d: 2.4 },
      { x: 13.5, z: -9, facing: WEST, w: 1.6, d: 2.4 },
      { x: 13.5, z: -5, facing: WEST, w: 1.6, d: 2.4 },
      { x: 3, z: -13.5, facing: NORTH, w: 2.4, d: 1.6 },
    ],
    (c) => foot(c.x, c.z, c.w, c.d),
  );
  if (skip) hideouts.push(hideout(id++, 'skip', skip.x, skip.z, skip.facing));
  const loo = place(
    [
      { x: 14.3, z: -0.5, facing: WEST },
      { x: 14.3, z: -13, facing: WEST },
      { x: -14.3, z: -13, facing: EAST },
    ],
    (c) => foot(c.x, c.z, 1.1, 1.1),
  );
  if (loo) hideouts.push(hideout(id, 'portaloo', loo.x, loo.z, loo.facing));
  // The forklift faces the yard's south, mast and forks reaching out ahead of it.
  const fork = place(
    [
      { x: -9, z: -9 },
      { x: 6, z: -8 },
      { x: -5, z: -11.5 },
    ],
    (c) => rect(c.x - 0.8, c.z - 2.5, c.x + 0.8, c.z + 1.2),
  );
  if (fork) {
    boxes.push(
      box(fork.x, 0.4, fork.z, 1.4, 0.8, 2.2, FORK, { model: 'forklift' }),
      // The mast and the forks are drawn by the forklift; these only carry the collisions.
      box(fork.x, 1.4, fork.z - 1.3, 1.2, 2.8, 0.25, 0x2b2b2b, { model: 'collider' }),
      box(fork.x, 0.11, fork.z - 1.9, 1, 0.22, 0.9, 0x2b2b2b, { model: 'collider' }),
    );
    pageSpots.push(
      { x: fork.x, y: 0.27, z: fork.z - 1.9 },
      { x: fork.x + 0.45, y: 0.85, z: fork.z },
    );
  }
  const crates = [
    { x: -6, z: -8 },
    { x: 3, z: -6 },
    { x: 12, z: -3 },
    { x: -11, z: -12 },
    { x: 7, z: -14 },
    { x: -2, z: -10 },
  ];
  for (let n = 0; n < 3; n++) {
    const c = place(crates, (p) => foot(p.x, p.z, 0.6, 0.6));
    if (!c) break;
    crates.splice(crates.indexOf(c), 1);
    boxes.push(box(c.x, 0.3, c.z, 0.6, 0.6, 0.6, WOOD, { model: 'crate' }));
    pageSpots.push({ x: c.x, y: 0.62, z: c.z });
  }
  // Loose pallets about the yard: a low stack or two, to hop up onto.
  const spots = [
    { x: 9, z: -6 },
    { x: -8, z: -13.5 },
    { x: 12.5, z: -9.5 },
    { x: -5, z: -5.5 },
    { x: 5, z: -11.5 },
  ];
  for (let n = 0; n < 2; n++) {
    const p = place(spots, (c) => foot(c.x, c.z, PALLET.x, PALLET.z));
    if (!p) break;
    spots.splice(spots.indexOf(p), 1);
    boxes.push(...pallets(p.x, p.z, 1 + n, PALLET_WOOD));
  }
  for (const [x, z] of LAMPS) boxes.push(lampPost(x, z));
  // The returns desk by the inspector.
  boxes.push(box(-12, 0.4, -7, 1.8, 0.8, 0.8, WOOD, { model: 'table' }));
  pageSpots.push({ x: -12, y: 0.85, z: -7 });

  // ---------------------------------------------------------------- the roof
  // Up on the hall's roof by the yard ladder, which comes up past the roof's edge by more
  // than a climber's height so they can step off onto it; a railing runs round the roof
  // with a gap where the ladder arrives.
  const ladderX = g.pick([-11, 5]);
  const ladders = [
    {
      pos: { x: ladderX, y: 0, z: HALL.z0 - 0.1 - LADDER_OFF },
      width: 0.8,
      // Up past the roof's top by a climber's height, so they come out standing on it.
      height: ROOF_TOP + LADDER_CLEAR,
      facing: NORTH,
    },
  ];
  const [rx0, rx1, rz0, rz1] = [
    BUILDING.x0 - 0.1,
    BUILDING.x1 + 0.1,
    BUILDING.z0 - 0.1,
    BUILDING.z1 + 0.1,
  ];
  const gap0 = ladderX - 0.4 - 0.4;
  const gap1 = ladderX + 0.4 + 0.4;
  const rail = (x0: number, z0: number, x1: number, z1: number) =>
    box(
      (x0 + x1) / 2,
      ROOF_TOP + ROOF_RAIL_H / 2,
      (z0 + z1) / 2,
      x1 - x0,
      ROOF_RAIL_H,
      z1 - z0,
      0x4b5560,
      { model: 'rail' },
    );
  boxes.push(
    rail(rx0, rz0, gap0, rz0 + ROOF_RAIL_T),
    rail(gap1, rz0, rx1, rz0 + ROOF_RAIL_T),
    rail(rx0, rz1 - ROOF_RAIL_T, rx1, rz1),
    rail(rx0, rz0 + ROOF_RAIL_T, rx0 + ROOF_RAIL_T, rz1 - ROOF_RAIL_T),
    rail(rx1 - ROOF_RAIL_T, rz0 + ROOF_RAIL_T, rx1, rz1 - ROOF_RAIL_T),
  );
  for (const [x, z] of [
    [-4, 8],
    [1, 12],
    [11, 8],
  ] as const) {
    boxes.push(box(x, ROOF_TOP + 0.45, z, 1.2, 0.9, 1.2, SHUTTER, { model: 'acUnit' }));
    pageSpots.push({ x: x + 1, y: ROOF_TOP + 0.05, z });
  }
  pageSpots.push({ x: -8, y: ROOF_TOP + 0.05, z: 13 }, { x: 6, y: ROOF_TOP + 0.05, z: 6 });

  // Which way each shutter bay's doorway is drawn: bare, as the housing and guides show it.
  const doorDefs: DoorDef[] = SHUTTERS.map((x) => ({
    x,
    z: HALL.z0,
    opensTo: 1,
    finish: 'bare',
  }));

  // ---------------------------------------------------------------- bins
  const bins = binsAlong(spreadBins(runs, 40));

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
      { x: 11, y: 3.6, z: 12.5 },
      { x: 11, y: 3.6, z: 7.5 },
      { x: -13, y: 2.4, z: -0.5 },
    ],
    windows,
    doors: doorDefs,
    spawn: { x: 0, y: 1, z: -5 },
    dog: { points: [], links: [], start: 0, treatJar },
    broom: { pos: { x: -8, y: 0, z: HALL.z1 - 0.25 }, facing: 0 },
    catapult: { pos: { x: 10, y: 0, z: -13.5 }, facing: Math.atan2(10, -13.5) },
  };
  // A page nobody can get up to is no use: drop it.
  const unreachable = new Set(unreachableHighSpots(level));
  level.pageSpots = pageSpots.filter((p) => !unreachable.has(p));
  level.dog = dogNetwork(
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
  return level;
}
