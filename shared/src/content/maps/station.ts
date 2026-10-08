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
  rect,
  roofOver,
  roomWalls,
  standing,
  mapProblems,
} from './common.ts';
import type { Gap, Gen } from './common.ts';

/**
 * Platform 9, the sleeper train: a country station with two platforms, a footbridge and a
 * goods yard, and a sleeper train standing at platform 1 with its doors open. The job site is
 * on the platform under the canopy. Every round the carriages stand in a different order, each
 * turned end for end or not, the footbridge is at one end of the platforms or the other, and
 * what lies about the yard moves.
 */

const GRAVEL = 0xa49c8c;
const BRICK = 0x9c5a44;
const ROOF = 0x4e4a46;
const CANOPY = 0x3d5a6b;
const TILE = 0xc9c1b1;
const BOARDS = 0x8a6a45;
const CARRIAGE = 0x4a3a7a;
const RAIL = 0x5b5650;
const SLEEPER = 0x6e5a44;
const ENGINE = 0x2f4f3a;
const WOOD = 0x9a6b43;

const TICKET = rect(-12, 10, -1, 15);
const WAITING = rect(-1, 10, 6, 15);
const PARCELS = rect(6, 10, 14, 15);
const SHED = rect(-14, -14, -6, -8);
const WALL_H = 3;
const CAR_H = 2.6;
/** The carriages along track 1, west to east, each this long with a little between. */
const CAR_LEN = 5.5;
const CAR_X0 = -12;
const TRACK = { z0: 1.8, z1: 4.8 };

type CarKind = 'sleeper' | 'dining' | 'lounge' | 'guard';

export function stationLayout(seed: number): LevelDef {
  for (let attempt = 0; attempt < 12; attempt++) {
    const level = tryLayout(seed + attempt * 7919);
    if (!mapProblems(level).length) return level;
  }
  throw new Error('no station layout passed the checks');
}

/** One try at a layout from a seed, before the checks (see `mapProblems`). */
export function tryLayout(seed: number): LevelDef {
  const g = gen(seed);
  const boxes: BoxDef[] = [...fences()];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  const lights: Vec3[] = [];
  let id = 1;
  const next = () => id++;

  // The station building: ticket hall, waiting room, parcels office, under one roof.
  boxes.push(
    ...roomWalls(TICKET, WALL_H, BRICK, [
      { side: 's', at: -6, width: 1.6 },
      { side: 'e', at: 12.5, width: 1.4 },
    ]),
    ...roomWalls(
      WAITING,
      WALL_H,
      BRICK,
      [
        { side: 's', at: 2.5, width: 1.6 },
        { side: 'e', at: 12.5, width: 1.4 },
      ],
      { skip: ['w'] },
    ),
    ...roomWalls(PARCELS, WALL_H, BRICK, [{ side: 's', at: 10, width: 1.6 }], { skip: ['w'] }),
    roofOver(rect(TICKET.x0, 10, PARCELS.x1, 15), WALL_H, ROOF),
  );
  // Ticket hall: the ticket counter, lost property, a vending machine, benches.
  const ticketCounter = box(-6.5, 0.45, 14.6, 3, 0.9, 0.6, TILE, { model: 'counter' });
  boxes.push(ticketCounter);
  hideouts.push(drawerIn(next(), ticketCounter, -0.9), drawerIn(next(), ticketCounter, 0.9));
  pageSpots.push({ x: -5.6, y: 0.95, z: 14.6 });
  hideouts.push(hideout(next(), 'cabinet', TICKET.x0 + 0.35, 12, EAST));
  hideouts.push(hideout(next(), 'locker', -2, 14.5, SOUTH, 0, { x: 0.9, y: 1.9, z: 0.8 }));
  hideouts.push(hideout(next(), 'rug', -6, 10.9, SOUTH, 0));
  for (const x of [-10, -3]) {
    boxes.push(box(x, 0.225, 11.2, 1.6, 0.45, 0.5, WOOD, { model: 'step' }));
    pageSpots.push({ x, y: 0.48, z: 11.2 });
  }
  lights.push({ x: -6.5, y: 2.3, z: 12.5 });
  // Waiting room: the table everyone meets round, the stove, a rug.
  boxes.push(box(2.5, 0.4, 12.5, 2.6, 0.8, 1.1, WOOD, { model: 'table' }));
  pageSpots.push({ x: 3.3, y: 0.85, z: 12.5 });
  boxes.push(box(5.5, 0.6, 14.5, 0.7, 1.2, 0.7, 0x2b2b2b, { model: 'crate' }));
  hideouts.push(hideout(next(), 'rug', 2.5, 10.9, SOUTH, 0));
  const meetingSeats: Vec3[] = [
    ...[1.4, 2.1, 2.8, 3.5].map((x) => ({ x, y: 0, z: 11.5 })),
    ...[1.4, 2.1, 2.8, 3.5].map((x) => ({ x, y: 0, z: 13.5 })),
    { x: 0.5, y: 0, z: 12.5 },
    { x: 4.5, y: 0, z: 12.5 },
  ];
  lights.push({ x: 2.5, y: 2.3, z: 12.5 });
  // Parcels office: the inspector weighs builds like parcels; the parcels cage and lockers.
  hideouts.push(hideout(next(), 'chest', 13.2, 13.4, SOUTH, 0, { x: 1.2, y: 1, z: 0.8 }));
  for (const x of [7, 7.9]) hideouts.push(hideout(next(), 'locker', x, 14.5, SOUTH));
  pageSpots.push({ x: 7.45, y: 2.05, z: 14.5 });
  lights.push({ x: 10, y: 2.3, z: 12.5 });
  // The mailbox on the platform wall, by the ticket hall door.
  hideouts.push(hideout(next(), 'mailbox', -8.5, 9.85, SOUTH, 0.9));

  // Platform 1's canopy on posts, and the lamp posts along both platforms.
  boxes.push(standing(rect(-11, 6.2, 13, 10.1), 0.15, CANOPY, 3.4));
  for (const x of [-9, -3, 3, 9]) boxes.push(box(x, 1.7, 6.4, 0.2, 3.4, 0.2, ROOF));
  for (const x of [-13, 13]) boxes.push(lampPost(x, 8.5), lampPost(x, -4.2));
  for (const x of [-6, 6]) boxes.push(lampPost(x, -4.2));

  // The tracks: rails on sleepers along both.
  for (const zs of [
    [2.2, 4.4],
    [-1.9, -0.1],
  ]) {
    for (const z of zs) boxes.push(box(0, 0.035, z, 31.6, 0.07, 0.08, RAIL));
    for (let x = -15.5; x <= 15.5; x += 1.6)
      boxes.push(box(x, 0.005, (zs[0]! + zs[1]!) / 2, 0.25, 0.01, 2.6, SLEEPER));
  }

  // The train: the engine at the east end, four carriages west of it in a new order each round.
  const engineX0 = CAR_X0 + CAR_LEN * 4 + 0.3;
  boxes.push(
    box(engineX0 + 2.5, 1.3, 3.3, 5, 2.6, 2.8, ENGINE),
    box(engineX0 + 1, 2.9, 3.3, 1.6, 0.6, 2, ENGINE),
  );
  boxes.push(box(engineX0 + 4.2, 3.2, 3.3, 0.7, 1.2, 0.7, 0x2b2b2b));
  // The cab: a door on the platform side.
  hideouts.push(
    hideout(next(), 'locker', engineX0 + 0.8, 5.2, NORTH, 0, { x: 0.9, y: 2.2, z: 0.8 }),
  );
  const order = g.shuffle(['sleeper', 'dining', 'lounge', 'guard'] as const);
  let treatJar: Vec3 | null = null;
  order.forEach((kind, i) => {
    const x0 = CAR_X0 + i * CAR_LEN + 0.1;
    const x1 = x0 + CAR_LEN - 0.2;
    const flipped = g.chance(0.5);
    const made = carriage(kind, rect(x0, TRACK.z0, x1, TRACK.z1), flipped, g, next);
    boxes.push(...made.boxes);
    hideouts.push(...made.hideouts);
    pageSpots.push(...made.pageSpots);
    lights.push({ x: (x0 + x1) / 2, y: 2.2, z: 4.2 });
    if (made.treatJar) treatJar = made.treatJar;
  });
  if (!treatJar) throw new Error('the dining car with the treat jar is missing');

  // The footbridge over the tracks, at one end or the other, with a ladder up each side.
  const bx = g.pick([-14.2, 14.2]);
  boxes.push(standing(rect(bx - 0.8, -3.5, bx + 0.8, 5.5), 0.2, BOARDS, 3.2));
  for (const z of [-3.5, 5.5]) boxes.push(box(bx, 1.6, z, 1.6, 3.2, 0.2, ROOF));
  for (const side of [-1, 1])
    boxes.push(box(bx + side * 0.75, 3.9, 1, 0.1, 1, 9, 0x6b6b6b, { model: 'rail' }));
  // A ladder is climbed until the climber's centre reaches its height: that has to leave
  // their feet above the deck they step onto (see `LADDER_CLEAR`).
  const ladders = [
    { pos: { x: bx, y: 0, z: 5.9 }, width: 0.8, height: 3.4 + LADDER_CLEAR, facing: SOUTH },
    { pos: { x: bx, y: 0, z: -3.9 }, width: 0.8, height: 3.4 + LADDER_CLEAR, facing: NORTH },
  ];
  pageSpots.push({ x: bx, y: 3.45, z: 1 }, { x: bx, y: 3.45, z: -2.5 });

  // The goods yard: the shed with the panel and the broom, the old wagon, the water tower,
  // the kennel.
  boxes.push(
    ...roomWalls(SHED, WALL_H, BOARDS, [{ side: 'e', at: -11, width: 1.8 }]),
    roofOver(SHED, WALL_H, ROOF),
  );
  boxes.push(box(-10, 1.5, SHED.z1 - 0.17, 0.6, 0.8, 0.14, 0x8e979c, { model: 'panel' }));
  boxes.push(box(-12.5, 0.4, -10, 1.6, 0.8, 0.8, WOOD, { model: 'table' }));
  hideouts.push(hideout(next(), 'toolbox', -12.5, -10, SOUTH, 0.8));
  hideouts.push(hideout(next(), 'chest', -7.4, -12.5, NORTH, 0, { x: 1, y: 0.8, z: 0.8 }));
  for (const c of g
    .shuffle([
      { x: -8, z: -9 },
      { x: -12.5, z: -13 },
      { x: -7.2, z: -11 },
    ])
    .slice(0, 2)) {
    boxes.push(box(c.x, 0.3, c.z, 0.6, 0.6, 0.6, WOOD, { model: 'crate' }));
    pageSpots.push({ x: c.x, y: 0.62, z: c.z });
  }
  lights.push({ x: -10, y: 2.3, z: -11 });
  const wagonX = g.pick([2, 6, 9]);
  boxes.push(
    box(wagonX, 0.6, -9.5, 4, 1.2, 2, 0x7a3b2e),
    box(wagonX - 2.6, 0.15, -9.5, 1, 0.3, 1, SLEEPER, { model: 'step' }),
    box(wagonX - 2.6, 0.45, -8.6, 1, 0.3, 0.8, SLEEPER, { model: 'step' }),
  );
  pageSpots.push({ x: wagonX - 1.6, y: 1.25, z: -8.8 });
  // The water tower: a deck up a ladder with the tank on it.
  const tx = 12;
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    boxes.push(box(tx + dx, 1.7, -12 + dz, 0.25, 3.4, 0.25, RAIL));
  boxes.push(standing(rect(tx - 1.3, -13.3, tx + 1.3, -10.7), 0.2, BOARDS, 3.4));
  boxes.push(box(tx, 4.25, -12.6, 1.6, 1.3, 1.2, RAIL));
  ladders.push({
    pos: { x: tx, y: 0, z: -10.3 },
    width: 0.8,
    height: 3.6 + LADDER_CLEAR,
    facing: SOUTH,
  });
  pageSpots.push({ x: tx, y: 3.65, z: -11.2 });
  boxes.push(box(0, 0.45, -9, 1, 0.9, 1.2, WOOD, { model: 'crate' }));
  pageSpots.push({ x: 0, y: 0.92, z: -9 }, { x: 4, y: 0, z: -14.5 }, { x: -3, y: 0, z: -6.5 });

  // Bins: luggage trolleys of bricks along the building wall between the doors, and along
  // platform 2.
  const bins = binsAlong(
    [
      { from: { x: -11, z: 9.3 }, to: { x: -7.6, z: 9.3 } },
      { from: { x: -4.4, z: 9.3 }, to: { x: 0.9, z: 9.3 } },
      { from: { x: 4.1, z: 9.3 }, to: { x: 8.4, z: 9.3 } },
      { from: { x: 11.6, z: 9.3 }, to: { x: 13.4, z: 9.3 } },
      { from: { x: -12, z: -5.2 }, to: { x: 12, z: -5.2 } },
    ],
    [
      { x: -4, z: -12 },
      { x: -2, z: -12 },
      { x: 0, z: -12 },
      { x: 2, z: -12 },
      { x: 4, z: -12 },
      { x: 6, z: -12 },
    ],
  );

  const level: LevelDef = {
    floorSize: 32,
    groundColour: GRAVEL,
    boxes,
    decals: [
      floorOf(TICKET, TILE),
      floorOf(WAITING, 0xb59b7a),
      floorOf(PARCELS, 0x9d9a94),
      floorOf(SHED, 0x8d8a84),
      // The platforms are paved, the track beds ballast.
      { pos: { x: 0, y: 0, z: 7.5 }, size: { x: 32, z: 5 }, colour: 0xb8b2a6 },
      { pos: { x: 0, y: 0, z: -4.25 }, size: { x: 32, z: 3.5 }, colour: 0xb8b2a6 },
      { pos: { x: 0, y: 0, z: 1.25 }, size: { x: 32, z: 7.5 }, colour: 0x8a8378 },
    ],
    bins,
    baseplate: { x: -5.8, y: 0, z: 6.6 },
    inspector: { pos: { x: 10, y: 0, z: 12.4 }, size: { x: 2.4, z: 2.4 } },
    doneButton: { x: -3.4, y: 0, z: 7.4 },
    bell: { x: -6.6, y: 0, z: 7.4 },
    board: { pos: { x: 0.5, y: 1.3, z: 8 }, facing: 0 },
    pageSpots,
    hideouts,
    ladders,
    meetingSeats,
    lights,
    windows: [],
    spawn: { x: 4, y: 1, z: 7.5 },
    dog: { points: [], links: [], start: 0, treatJar },
    broom: { pos: { x: SHED.x0 + 0.25, y: 0, z: -11 }, facing: WEST },
    catapult: { pos: { x: -2, y: 0, z: -13.5 }, facing: facingToward(2, 20.5) },
  };
  // The dog's walks: both platforms, the tracks, the yard, the rooms, and the train's corridor.
  const dog = dogNetwork(
    level,
    [
      // Close together on the platform, where the job site and the posts are in the way.
      ...gridPoints(rect(-15, 5.2, 15, 9), 1.5),
      ...gridPoints(rect(-15, -2.5, 15, 1.6), 2.2),
      ...gridPoints(rect(-15, -6, 15, -2.5), 2.2),
      ...gridPoints(rect(-15, -15.5, 15, -6), 2.5),
      ...gridPoints(TICKET, 2),
      ...gridPoints(WAITING, 2),
      ...gridPoints(PARCELS, 2),
      ...gridPoints(SHED, 2),
      ...Array.from({ length: 16 }, (_, i) => ({ x: CAR_X0 + 0.7 + i * 1.4, y: 0, z: 4.3 })),
    ],
    { x: 0, y: 0, z: -7.5 },
    treatJar,
  );
  level.dog = dog;
  return level;
}

/** One carriage of the train: a room on the track with its interior, the corridor on the platform side. */
function carriage(
  kind: CarKind,
  r: { x0: number; z0: number; x1: number; z1: number },
  flipped: boolean,
  g: Gen,
  next: () => number,
): { boxes: BoxDef[]; hideouts: HideoutDef[]; pageSpots: Vec3[]; treatJar: Vec3 | null } {
  const boxes: BoxDef[] = [];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  let treatJar: Vec3 | null = null;
  /** A position along the carriage, mirrored when it stands turned round. */
  const X = (x: number) => (flipped ? r.x0 + r.x1 - x : x);
  const F = (f: number) =>
    f === EAST ? (flipped ? WEST : EAST) : f === WEST ? (flipped ? EAST : WEST) : f;
  // Doors onto the platform at both ends, a corridor door through each end wall, and now and
  // then a door onto the far track.
  const gaps: Gap[] = [
    { side: 'n', at: r.x0 + 1.1, width: 1 },
    { side: 'n', at: r.x1 - 1.1, width: 1 },
    { side: 'e', at: 4.3, width: 1 },
    { side: 'w', at: 4.3, width: 1 },
  ];
  if (g.chance(0.35)) gaps.push({ side: 's', at: X((r.x0 + r.x1) / 2), width: 1 });
  boxes.push(...roomWalls(r, CAR_H, CARRIAGE, gaps), roofOver(r, CAR_H, 0x2e2a3a, 0.2));
  // Wheels under it, showing below the walls on both sides.
  for (const x of [r.x0 + 1, r.x1 - 1])
    for (const z of [r.z0 - 0.1, r.z1 + 0.1]) boxes.push(box(x, 0.3, z, 0.9, 0.6, 0.3, 0x1f1f1f));
  const mid = (r.x0 + r.x1) / 2;
  const far = r.z0 + 0.6; // against the far wall
  switch (kind) {
    case 'sleeper': {
      // Two compartments off the corridor, each with a berth and a cupboard under the window.
      boxes.push(box(mid, CAR_H / 2, 2.8, 0.1, CAR_H, 2, CARRIAGE));
      for (const cx of [mid - 1.3, mid + 1.3]) {
        const bed = box(X(cx), 0.25, far, 1.9, 0.5, 0.8, 0x7a5a3a, { model: 'bed', front: '+z' });
        boxes.push(bed);
        hideouts.push(hideout(next(), 'berth', X(cx), far, SOUTH, 0.5, { x: 1.6, y: 0.1, z: 0.6 }));
        pageSpots.push({ x: X(cx), y: 1.9, z: far });
        // A drawer under the first berth.
        if (cx < mid) hideouts.push(drawerIn(next(), bed, 0, 0.22));
      }
      // The wall to the corridor, with a door into each compartment.
      boxes.push(
        ...roomWalls(
          rect(r.x0 + 0.1, r.z0, r.x1 - 0.1, 3.8),
          CAR_H,
          CARRIAGE,
          [
            { side: 'n', at: X(mid - 1.3), width: 0.9 },
            { side: 'n', at: X(mid + 1.3), width: 0.9 },
          ],
          { skip: ['s', 'e', 'w'] },
        ),
      );
      break;
    }
    case 'dining': {
      // Tables by the windows, the bar counter with its drawer and the treat jar, the fridge.
      for (const cx of [r.x0 + 1.0]) {
        boxes.push(box(X(cx), 0.375, far, 1, 0.75, 0.9, WOOD, { model: 'table' }));
        pageSpots.push({ x: X(cx), y: 0.8, z: far });
      }
      // The counter stands clear of the fridge door's swing.
      const counter = box(X(r.x1 - 2.0), 0.45, far, 1.8, 0.9, 0.6, 0x8a2f2f, {
        model: 'counter',
        front: '+z',
      });
      boxes.push(counter);
      hideouts.push(drawerIn(next(), counter, 0));
      treatJar = { x: X(r.x1 - 1.4), y: 0.9, z: far };
      hideouts.push(
        hideout(next(), 'fridge', X(r.x1 - 0.5), 3.6, F(WEST), 0, { x: 0.7, y: 1.6, z: 0.6 }),
      );
      break;
    }
    case 'lounge': {
      boxes.push(box(X(mid - 1), 0.225, far, 2.2, 0.45, 0.8, 0x4f6d8f, { model: 'sofa' }));
      hideouts.push(
        hideout(next(), 'cushion', X(mid - 1), far, SOUTH, 0.45, { x: 1, y: 0.1, z: 0.6 }),
      );
      boxes.push(box(X(r.x1 - 0.8), 0.9, far, 1, 1.8, 0.4, 0x6b4a2f, { model: 'bookshelf' }));
      pageSpots.push({ x: X(r.x1 - 0.8), y: 1.85, z: far });
      hideouts.push(hideout(next(), 'rug', X(mid), 3.3, SOUTH, 0, { x: 1.8, y: 0.02, z: 0.9 }));
      break;
    }
    case 'guard': {
      for (const cx of [r.x0 + 0.6, r.x0 + 1.3])
        hideouts.push(hideout(next(), 'locker', X(cx), far, NORTH, 0, { x: 0.6, y: 1.9, z: 0.7 }));
      hideouts.push(
        hideout(next(), 'chest', X(mid - 0.5), r.z0 + 0.75, F(WEST), 0, { x: 0.8, y: 0.9, z: 1.2 }),
      );
      const desk = box(X(r.x1 - 1), 0.45, far, 1.4, 0.9, 0.6, WOOD, {
        model: 'counter',
        front: '+z',
      });
      boxes.push(desk);
      hideouts.push(drawerIn(next(), desk, 0));
      hideouts.push(
        hideout(next(), 'toolbox', X(r.x1 - 1), far, NORTH, 0.9, { x: 0.5, y: 0.25, z: 0.3 }),
      );
      break;
    }
  }
  return { boxes, hideouts, pageSpots, treatJar };
}
