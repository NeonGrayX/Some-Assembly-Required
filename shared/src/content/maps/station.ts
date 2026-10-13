import type { Vec3 } from '../../math.ts';
import type {
  BoxDef,
  DecalDef,
  HideoutDef,
  InteriorDef,
  LadderDef,
  LevelDef,
  Paint,
  WindowDef,
} from '../house.ts';
import { VACUUM_FROM_WALL, WALL_T, YARD_HALF } from '../house.ts';
import {
  EAST,
  NORTH,
  SOUTH,
  WEST,
  box,
  dogNetwork,
  drawerIn,
  facingToward,
  fences,
  floorOf,
  gen,
  gridPoints,
  grow,
  hideout,
  interiorOf,
  lampPost,
  mailboxOnPost,
  LADDER_CLEAR,
  rect,
  roofOver,
  roomWalls,
  standing,
  mapProblems,
  standBrickWorks,
  standTrashBins,
  addGroundPageSpots,
  standSecondBoard,
} from './common.ts';
import type { Gap, Gen } from './common.ts';

/**
 * Platform 9, the sleeper train: a country station with two platforms, a footbridge and a
 * goods yard, and a sleeper train standing at platform 1 with its doors open. The job site is
 * on the platform under the canopy. Every round the carriages stand in a different order, each
 * turned end for end or not, and what lies about the yard moves. The tracks run on east
 * past the engine to the end of the site, where the train leaves, so the footbridge over them
 * there is the only way across at that end.
 *
 * Nothing here cuts through anything else: walls meet at their faces, roofs sit on walls,
 * wheels hang off the carriage sides clear of the doorways, and the rails stop where the train
 * stands over them.
 */

const GRAVEL = 0xa49c8c;
const BRICK: Paint = { colour: 0x9c5a44, surface: 'masonry' };
const ROOF: Paint = { colour: 0x4e4a46, surface: 'roof' };
const CANOPY = 0x3d5a6b;
const TILE: Paint = { colour: 0xc9c1b1, surface: 'tiles' };
const BOARDS = 0x8a6a45;
const CARRIAGE = 0x4a3a7a;
const CARRIAGE_ROOF = 0x2e2a3a;
const CARRIAGE_FLOOR = 0x5c4a3c;
const RAIL = 0x5b5650;
const BALLAST = 0x7d776d;
const ENGINE = 0x2f4f3a;
const IRON = 0x1f1f1f;
const WOOD = 0x9a6b43;
/** A sleeper berth's wooden frame. */
const BERTH: Paint = { colour: 0x7a5a3a, surface: 'wood' };

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
/** The wall between a sleeper's compartments and its corridor (centre line). */
const CORRIDOR_WALL = 3.6;
/** The corridor's centre line, the platform side of that wall. */
const CORRIDOR = 4.2;
/** A carriage roof's arch, up from the top of its walls. */
const CAR_ROOF_H = 0.4;
/** The dark valance along the bottom of a carriage's sides, over its floor's edge. */
const VALANCE_H = 0.5;
/** How far the livery strips stop short of a doorway's middle, past its casing. */
const DOOR_CLEAR = 0.62;
/** The canvas gangway over the joint between two carriages, outside their sides. */
const GANGWAY = { width: 0.3, depth: 0.06 };
/** Each carriage's running gear: an axle in from each end, its wheels under its floor. */
const AXLE = { at: 0.9, w: 0.56, h: 0.62, depth: 0.22 };
/** Where the engine starts, east of the last carriage. */
const ENGINE_X0 = CAR_X0 + CAR_LEN * 4 + 0.3;

/** The two rails of a track, this far apart. */
const GAUGE = 2.2;
/**
 * A track's bed: ballast built up off the ground, its shoulders sloping down to it, with the
 * sleepers bedded in it, their tops `h` up (`ballast` draws both); and the rails on the
 * sleepers, stopping where the bed's top does, `toe` in from its ends (the client's
 * `BALLAST_TOE`). The bed and then the rails are each a step up, for the dog too (see
 * `groundObstacles`).
 */
export const TRACK_BED = { h: 0.15, width: GAUGE + 1, toe: 0.25 };
/** A rail on its base plates, which are what make it as wide as this. */
export const TRACK_RAIL = { h: 0.1, width: 0.17 };
/** The top of a rail, which wheels stand on. */
export const RAIL_TOP = TRACK_BED.h + TRACK_RAIL.h;
/**
 * How far the goods wagon stands up off the ground, on its rails: its floor is `WAGON_DECK` up
 * off them, high enough for its wheels to turn under its solebars, and its load's top 0.6 m
 * over that.
 */
const WAGON_DECK = 0.75;
const WAGON_LIFT = RAIL_TOP + WAGON_DECK - 0.6;

/**
 * The cutting the tracks run in between the platforms, `depth` below them: the platforms' edges
 * are its walls, `wall` thick, and the carriages' floors are level with the platforms, their
 * wheels under them on the rails below. At its west end players get down into it and back up
 * by the steps between the two tracks, and the ground runs on round it; at its east end it runs
 * on to the fence round the site, where the train leaves.
 */
const CUTTING = { depth: 1.1, wall: 0.25, x0: -16, x1: YARD_HALF - 0.15, z0: -2.9, z1: 5.2 };
/** Where the footbridge crosses: at the east end, over the tracks where the train leaves. */
const BRIDGE_X = 16.4;
/** The bottom of the cutting, which the tracks in it stand on. */
const CUT_FLOOR = -CUTTING.depth;
/** The carriages' underframe: their floors, from the ground down to on top of their wheels. */
const CAR_FLOOR_T = 0.23;
/**
 * Where across the cutting its steps are, between the two tracks' beds, and how deep each
 * tread: short enough to stop clear of the footbridge's middle posts.
 */
const CUT_STEPS = { z0: 0.7, z1: 1.6, tread: 0.25 };

/**
 * The footbridge: a deck up a flight of steps at each end. Each step rises what a player can
 * walk up, and the deck is one more step above the top one. It clears the carriage roofs and
 * the engine with room to spare.
 */
const STEP = { rise: 0.28, tread: 0.32, width: 1.4, count: 12 };
const DECK_TOP = (STEP.count + 1) * STEP.rise;
const DECK_T = 0.2;

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
  const windows: WindowDef[] = [];
  /** Where the dog may walk that its grids miss: through the train's doorways. */
  const dogSpots: Vec3[] = [];
  const decals: DecalDef[] = [];
  const ladders: LadderDef[] = [];
  /** The building, the shed and the carriages: the canopy over platform 1 is open air. */
  const interiors: InteriorDef[] = [];
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
  interiors.push(interiorOf(rect(TICKET.x0, 10, PARCELS.x1, 15), WALL_H));
  // Windows onto the platform and the yard behind, clear of the doors and the furniture.
  windows.push(
    ...[-10, -2.5, 0, 4.8, 7.8, 12.5].map((x) => ({ x, z: 10, alongX: true })),
    // (The waiting room's one stops short of the stove, whose top would cut its sill.)
    ...[-9, -4, 0.5, 4.2, 10].map((x) => ({ x, z: 15, alongX: true })),
    { x: TICKET.x0, z: 11, alongX: false },
    { x: PARCELS.x1, z: 12, alongX: false },
  );
  // Ticket hall: the ticket counter, lost property, a vending machine, benches.
  const ticketCounter = box(-6.5, 0.45, 14.6, 3, 0.9, 0.6, TILE, { model: 'counter' });
  boxes.push(ticketCounter);
  hideouts.push(drawerIn(next(), ticketCounter, -0.9), drawerIn(next(), ticketCounter, 0.9));
  pageSpots.push({ x: -5.6, y: 0.95, z: 14.6 });
  hideouts.push(hideout(next(), 'cabinet', TICKET.x0 + 0.35, 12.6, EAST));
  hideouts.push(hideout(next(), 'locker', -2, 14.5, SOUTH, 0, { x: 0.9, y: 1.9, z: 0.8 }));
  hideouts.push(hideout(next(), 'rug', -6, 10.9, SOUTH, 0));
  for (const x of [-10, -3]) {
    boxes.push(box(x, 0.225, 11.2, 1.6, 0.45, 0.5, WOOD, { model: 'step' }));
    pageSpots.push({ x, y: 0.48, z: 11.2 });
  }
  lights.push({ x: -6.5, y: 2.3, z: 12.5 });
  // Waiting room: the table everyone meets round, the stove with its flue, a rug.
  boxes.push(box(2.5, 0.4, 12.5, 2.6, 0.8, 1.1, WOOD, { model: 'table' }));
  pageSpots.push({ x: 3.3, y: 0.85, z: 12.5 });
  boxes.push(
    box(5.5, 0.6, 14.5, 0.7, 1.2, 0.7, IRON, { model: 'stove' }),
    box(5.5, 2.1, 14.5, 0.16, 1.8, 0.16, IRON, { model: 'flue' }),
  );
  hideouts.push(hideout(next(), 'rug', 2.5, 10.9, SOUTH, 0));
  const meetingSeats: Vec3[] = [
    ...[1.4, 2.1, 2.8, 3.5].map((x) => ({ x, y: 0, z: 11.5 })),
    ...[1.4, 2.1, 2.8, 3.5].map((x) => ({ x, y: 0, z: 13.5 })),
    { x: 0.5, y: 0, z: 12.5 },
    { x: 4.5, y: 0, z: 12.5 },
  ];
  lights.push({ x: 2.5, y: 2.3, z: 12.5 });
  // Parcels office: the inspector weighs builds like parcels; the parcels cage and lockers,
  // with a page on top of the lockers.
  hideouts.push(hideout(next(), 'chest', 13.2, 13.4, SOUTH, 0, { x: 1.2, y: 1, z: 0.8 }));
  for (const x of [7, 7.9]) hideouts.push(hideout(next(), 'locker', x, 14.5, SOUTH));
  pageSpots.push({ x: 7, y: 2.05, z: 14.5 });
  lights.push({ x: 10, y: 2.3, z: 12.5 });
  // The mailbox on the platform wall, by the ticket hall door.
  const [letterbox, letterboxPost] = mailboxOnPost(next(), -8.5, 9.65, SOUTH);
  hideouts.push(letterbox);
  boxes.push(letterboxPost);

  // Platform 1's canopy: a lean-to off the building's roof on posts, with a valance along its
  // edge and lamps under it; and the lamp posts along platform 2.
  const canopyY = WALL_H + 0.2;
  boxes.push(standing(rect(-11, 6.2, 13, 10.1), 0.15, CANOPY, canopyY));
  for (const x of [-9, -3, 3, 9])
    boxes.push(box(x, canopyY / 2, 6.4, 0.2, canopyY, 0.2, ROOF, { model: 'post' }));
  boxes.push(box(1, canopyY - 0.1, 6.25, 24, 0.2, 0.06, ROOF));
  for (const x of [-6, 0, 6]) lights.push({ x, y: canopyY - 0.35, z: 8.2 });
  for (const x of [-13, -6, 6, 13]) boxes.push(lampPost(x, -4.2));

  // The cutting, and both tracks along it, the train standing on track 1.
  boxes.push(...cutting());
  const [inX0, inX1] = [CUTTING.x0 + CUTTING.wall, CUTTING.x1 - CUTTING.wall];
  boxes.push(...track(inX0, inX1, -1, CUT_FLOOR), ...track(inX0, inX1, 3.3, CUT_FLOOR));

  // The train: the engine at the east end, four carriages west of it in a new order each round.
  boxes.push(...engine());
  // The cab: a door on the platform side.
  hideouts.push(
    hideout(next(), 'locker', ENGINE_X0 + 0.6, 5.25, NORTH, 0, { x: 0.9, y: 2.2, z: 0.8 }),
  );
  const order = g.shuffle(['sleeper', 'dining', 'lounge', 'guard'] as const);
  let treatJar: Vec3 | null = null;
  order.forEach((kind, i) => {
    const x0 = CAR_X0 + i * CAR_LEN + 0.1;
    const x1 = x0 + CAR_LEN - 0.2;
    const flipped = g.chance(0.5);
    const car = rect(x0, TRACK.z0, x1, TRACK.z1);
    const made = carriage(kind, car, flipped, g, next);
    interiors.push(interiorOf(car, CAR_H));
    // Its floor over the cutting, out to the platform's edge and on to the next carriage's,
    // so there is no gap to step across.
    boxes.push(
      standing(
        rect(
          CAR_X0 + i * CAR_LEN,
          TRACK.z0 - WALL_T / 2,
          CAR_X0 + (i + 1) * CAR_LEN,
          CUTTING.z1 - CUTTING.wall,
        ),
        CAR_FLOOR_T,
        IRON,
        -CAR_FLOOR_T,
      ),
    );
    boxes.push(...made.boxes);
    hideouts.push(...made.hideouts);
    pageSpots.push(...made.pageSpots);
    windows.push(...made.windows);
    dogSpots.push(...made.dogSpots);
    decals.push(made.floor);
    lights.push({ x: (x0 + x1) / 2, y: 2.2, z: CORRIDOR });
    if (made.treatJar) treatJar = made.treatJar;
  });
  if (!treatJar) throw new Error('the dining car with the treat jar is missing');
  // The canvas gangways over the joints between the carriages, on both sides.
  for (let i = 1; i < order.length; i++)
    for (const z of [
      TRACK.z1 + WALL_T / 2 + GANGWAY.depth / 2 + 0.005,
      TRACK.z0 - WALL_T / 2 - GANGWAY.depth / 2 - 0.005,
    ])
      boxes.push(
        box(
          CAR_X0 + i * CAR_LEN,
          (CAR_H - 0.1) / 2,
          z,
          GANGWAY.width,
          CAR_H - 0.1,
          GANGWAY.depth,
          IRON,
          {
            model: 'gangway',
            front: z > TRACK.z1 ? '+z' : '-z',
          },
        ),
      );

  // The footbridge over the tracks at the east end: a deck on posts between the platforms,
  // railed along both sides, with a flight of steps down onto each platform and a page on the
  // deck and on the steps.
  const bx = BRIDGE_X;
  boxes.push(...footbridge(bx));
  // Platform 1's lamp post stands at the west end, clear of the way round the cutting's end.
  boxes.push(lampPost(-13, 5.7));
  const onStep = 7;
  pageSpots.push(
    { x: bx, y: DECK_TOP + 0.05, z: 1 },
    { x: bx, y: DECK_TOP + 0.05, z: -2.5 },
    {
      x: bx + 0.4,
      y: (STEP.count + 1 - onStep) * STEP.rise + 0.05,
      z: 5.5 + (onStep - 0.5) * STEP.tread,
    },
  );

  // The goods yard: the shed with the panel and the vacuum, the siding with the old wagon on
  // it, the water tower, the kennel.
  boxes.push(
    ...roomWalls(SHED, WALL_H, BOARDS, [{ side: 'e', at: -11, width: 1.8 }]),
    roofOver(SHED, WALL_H, ROOF),
  );
  interiors.push(interiorOf(SHED, WALL_H));
  windows.push({ x: SHED.x0, z: -11, alongX: false });
  boxes.push(box(-10, 1.5, SHED.z1 - 0.17, 0.6, 0.8, 0.14, 0x8e979c, { model: 'panel' }));
  boxes.push(box(-12.5, 0.4, -10, 1.6, 0.8, 0.8, WOOD, { model: 'table' }));
  hideouts.push(hideout(next(), 'toolbox', -12.5, -10, SOUTH, 0.8));
  hideouts.push(hideout(next(), 'chest', -7.4, -12.5, NORTH, 0, { x: 1, y: 0.8, z: 0.8 }));
  for (const c of g
    .shuffle([
      { x: -8, z: -9 },
      { x: -12.5, z: -13 },
      { x: -9.5, z: -12.5 },
    ])
    .slice(0, 2)) {
    boxes.push(box(c.x, 0.3, c.z, 0.6, 0.6, 0.6, WOOD, { model: 'crate' }));
    pageSpots.push({ x: c.x, y: 0.62, z: c.z });
  }
  lights.push({ x: -10, y: 2.3, z: -11 });
  // The siding, and the wagon somewhere along it with a ladder up its end (a ladder's height
  // is where the climber's centre stops, a little above what they step onto: `LADDER_CLEAR`).
  // (It stops short of the water tower's leg.)
  boxes.push(...track(-1, 10.65, -9.5));
  const wagonX = g.pick([2, 5, 8]);
  boxes.push(...wagon(wagonX, -9.5));
  // (Its foot on the track bed.)
  ladders.push({
    pos: { x: wagonX - 2.3, y: TRACK_BED.h, z: -9.5 },
    width: 0.8,
    height: 1.2 + WAGON_LIFT - TRACK_BED.h + LADDER_CLEAR,
    facing: EAST,
  });
  pageSpots.push({ x: wagonX - 1.4, y: 1.25 + WAGON_LIFT, z: -8.9 });
  // The water tower: a deck up a ladder with the tank on it, and the spout off the east side.
  const tx = 12;
  boxes.push(...waterTower(tx, -12));
  ladders.push({
    pos: { x: tx, y: 0, z: -10.3 },
    width: 0.8,
    height: 3.6 + LADDER_CLEAR,
    facing: SOUTH,
  });
  pageSpots.push({ x: tx - 0.6, y: 3.65, z: -11.2 });
  // The kennel, the odd crate, and pages on the ground.
  boxes.push(...kennel(-1.3, -7.2));
  boxes.push(box(-4.5, 0.45, -7.8, 1, 0.9, 1.2, WOOD, { model: 'crate' }));
  pageSpots.push({ x: -4.5, y: 0.92, z: -7.8 }, { x: 4, y: 0, z: -14.5 }, { x: -3, y: 0, z: -6.5 });

  const level: LevelDef = {
    floorSize: 2 * YARD_HALF,
    groundColour: GRAVEL,
    groundHoles: [rect(CUTTING.x0, CUTTING.z0, CUTTING.x1, CUTTING.z1)],
    boxes,
    decals: [
      floorOf(TICKET, TILE),
      floorOf(WAITING, 0xb59b7a),
      floorOf(PARCELS, 0x9d9a94),
      floorOf(SHED, 0x8d8a84),
      ...decals,
      // The platforms are paved (platform 1 in three: the stretch under the canopy, and the
      // open ends) up to the cutting's edges, the siding's bed ballast.
      ...platformPaving(),
      { pos: { x: 5.2, y: 0, z: -9.5 }, size: { x: 12.4, z: 3 }, colour: 0x8a8378 },
    ],
    // The brick works' machines stand about the site (`standBrickWorks`).
    machines: [],
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
    interiors,
    windows,
    spawn: { x: 4, y: 1, z: 7.5 },
    dog: { points: [], links: [], start: 0, treatJar },
    vacuum: { pos: { x: SHED.x0 + WALL_T / 2 + VACUUM_FROM_WALL, y: 0, z: -11 }, facing: WEST },
    catapult: { pos: { x: -2, y: 0, z: -13.5 }, facing: facingToward(2, 20.5) },
  };
  // A second corkboard beside the first, and the brick works.
  standSecondBoard(level);
  standBrickWorks(level);
  // Room for every page of the longest manual.
  addGroundPageSpots(level);
  // The dog's walks: both platforms and round the west end of the cutting, the yard, the rooms,
  // and the train's corridor.
  const dog = dogNetwork(
    level,
    [
      // Close together on the platform, where the job site and the posts are in the way.
      ...gridPoints(rect(-17, 5.2, 17, 9), 1.5),
      ...gridPoints(rect(-17, -6, 17, CUTTING.z0 - 0.4), 2.2),
      // Round the west end of the cutting, from one platform to the other.
      ...[-2, 0, 2, 4].map((z) => ({ x: -17, y: 0, z })),
      ...gridPoints(rect(-17, -17.5, 17, -6), 2.5),
      ...gridPoints(TICKET, 2),
      ...gridPoints(WAITING, 2),
      ...gridPoints(PARCELS, 2),
      ...gridPoints(SHED, 2),
      ...Array.from({ length: 16 }, (_, i) => ({ x: CAR_X0 + 0.7 + i * 1.4, y: 0, z: CORRIDOR })),
      ...dogSpots,
    ],
    { x: 0, y: 0, z: -7.5 },
    treatJar,
  );
  level.dog = dog;
  // Bins for unwanted bricks, off the dog's walks: the railway's green litter bins, on the
  // platforms, about the yard and in the rooms.
  standTrashBins(level, {
    rooms: [TICKET, WAITING, PARCELS, SHED],
    outdoor: { model: 'litterBin', colours: [0x2f4f3a, 0x23382b] },
    indoor: { model: 'litterBin', colours: [0x2f4f3a] },
  });
  return level;
}

/**
 * A stretch of track along x, centred on `z` and standing on `y0`: the ballasted bed with its
 * sleepers, and the two rails on them.
 */
function track(x0: number, x1: number, z: number, y0 = 0): BoxDef[] {
  const { h, width, toe } = TRACK_BED;
  const out: BoxDef[] = [
    box((x0 + x1) / 2, y0 + h / 2, z, x1 - x0, h, width, BALLAST, { model: 'ballast' }),
  ];
  for (const dz of [-GAUGE / 2, GAUGE / 2])
    out.push(
      box(
        (x0 + x1) / 2,
        y0 + h + TRACK_RAIL.h / 2,
        z + dz,
        x1 - x0 - 2 * toe,
        TRACK_RAIL.h,
        TRACK_RAIL.width,
        RAIL,
        {
          model: 'trackRail',
        },
      ),
    );
  return out;
}

/**
 * The engine, standing at the east end of track 1 with its cab to the train: a tank engine on
 * six coupled wheels, the boiler with its chimney and dome, the cab with its roof, the
 * headlamp, and the buffer beam at the front, down in the cutting on the rails. The frames'
 * box draws all of it (`locomotive`); the others are where it collides.
 */
function engine(): BoxDef[] {
  const x = ENGINE_X0;
  const z = (TRACK.z0 + TRACK.z1) / 2;
  // Down in the cutting, its wheels on the rails.
  const y = CUT_FLOOR + RAIL_TOP;
  // The frames carry the whole engine's model; the rest only collide.
  const part = { model: 'collider' as const };
  const out: BoxDef[] = [
    box(x + 2.5, 0.5 + y, z, 5, 1, 2.8, ENGINE, { model: 'locomotive' }),
    box(x + 3.45, 1.75 + y, z, 3.1, 1.5, 1.7, ENGINE, part),
    box(x + 0.9, 2.1 + y, z, 1.8, 2.2, 2.6, ENGINE, part),
    box(x + 0.9, 3.3 + y, z, 2, 0.2, 2.8, CARRIAGE_ROOF, part),
    box(x + 4.4, 2.925 + y, z, 0.6, 0.85, 0.6, IRON, part),
    box(x + 3.2, 2.7 + y, z, 0.7, 0.4, 0.7, ENGINE, part),
    box(x + 5.125, 2 + y, z, 0.25, 0.3, 0.3, 0xd9b44a, part),
    box(x + 5.1, 0.75 + y, z, 0.2, 0.5, 2.6, 0x8a2f2f, part),
  ];
  for (const dz of [-0.7, 0.7])
    out.push(box(x + 5.325, 0.8 + y, z + dz, 0.25, 0.2, 0.2, IRON, part));
  // (Its wheels run on the rails inside the frames' box, which is where they collide.)
  return out;
}

/**
 * The cutting: its walls round the edge of the hole in the ground (`CUTTING`), its floor, and
 * a flight of steps up out of its west end, between the tracks.
 */
function cutting(): BoxDef[] {
  const { x0, x1, z0, z1, wall, depth } = CUTTING;
  const stone = 0x8f8a80;
  const out: BoxDef[] = [
    standing(rect(x0, z0, x1, z1), 0.2, 0x5f5a52, CUT_FLOOR - 0.2),
    standing(rect(x0, z0, x1, z0 + wall), depth, stone, CUT_FLOOR),
    standing(rect(x0, z1 - wall, x1, z1), depth, stone, CUT_FLOOR),
    standing(rect(x0, z0 + wall, x0 + wall, z1 - wall), depth, stone, CUT_FLOOR),
    standing(rect(x1 - wall, z0 + wall, x1, z1 - wall), depth, stone, CUT_FLOOR),
  ];
  const steps = Math.ceil(depth / STEP.rise);
  const rise = depth / steps;
  const { z0: sz0, z1: sz1, tread } = CUT_STEPS;
  for (let k = 1; k < steps; k++) {
    const h = (steps - k) * rise;
    out.push(
      box(
        x0 + wall + (k - 0.5) * tread,
        CUT_FLOOR + h / 2,
        (sz0 + sz1) / 2,
        tread,
        h,
        sz1 - sz0,
        stone,
        {
          model: 'step',
          front: '+x',
        },
      ),
    );
  }
  return out;
}

/** The platforms' paving, up to the cutting's edges (platform 1's in three, round its canopy). */
function platformPaving(): DecalDef[] {
  const paving = 0xb8b2a6;
  const north = { z0: CUTTING.z1, z1: 10 };
  const south = { z0: -6, z1: CUTTING.z0 };
  const strip = (x0: number, x1: number, r: { z0: number; z1: number }): DecalDef => ({
    pos: { x: (x0 + x1) / 2, y: 0, z: (r.z0 + r.z1) / 2 },
    size: { x: x1 - x0, z: r.z1 - r.z0 },
    colour: paving,
  });
  return [
    strip(-11, 13, north),
    strip(-YARD_HALF, -11, north),
    strip(13, YARD_HALF, north),
    strip(-YARD_HALF, YARD_HALF, south),
  ];
}

/**
 * The footbridge at `x`: the deck between the platforms on three pairs of posts, a railing
 * along each side, and a flight of steps down onto each platform, every step a block from the
 * ground up so there is nothing to walk into under them.
 */
function footbridge(x: number): BoxDef[] {
  const [z0, z1] = [-3.5, 5.5];
  const out: BoxDef[] = [
    standing(rect(x - 0.8, z0, x + 0.8, z1), DECK_T, BOARDS, DECK_TOP - DECK_T, { model: 'deck' }),
  ];
  for (const z of [z0 + 0.5, (z0 + z1) / 2, z1 - 0.2]) {
    // (The middle pair stand in the cutting, between the tracks.)
    const foot = z > CUTTING.z0 && z < CUTTING.z1 ? CUT_FLOOR : 0;
    const h = DECK_TOP - DECK_T - foot;
    for (const side of [-1, 1])
      out.push(box(x + side * 0.7, foot + h / 2, z, 0.15, h, 0.15, ROOF, { model: 'post' }));
  }
  for (const side of [-1, 1])
    out.push(
      box(x + side * 0.75, DECK_TOP + 0.5, (z0 + z1) / 2, 0.1, 1, z1 - z0, 0x6b6b6b, {
        model: 'rail',
      }),
    );
  for (const [edge, dir] of [
    [z1, 1],
    [z0, -1],
  ] as const)
    for (let k = 1; k <= STEP.count; k++) {
      const h = (STEP.count + 1 - k) * STEP.rise;
      out.push(
        box(x, h / 2, edge + dir * (k - 0.5) * STEP.tread, STEP.width, h, STEP.tread, BOARDS, {
          model: 'step',
          front: dir > 0 ? '+z' : '-z',
        }),
      );
    }
  return out;
}

/**
 * The old wagon on the siding at `x`, `z`: a body on an underframe on wheels on the rails, with
 * a headboard at its east end, so whoever climbs up its west end has somewhere to stop.
 */
function wagon(x: number, z: number): BoxDef[] {
  // The body's box draws the whole wagon (`wagon`); the rest only collide.
  const part = { model: 'collider' as const };
  const y = WAGON_LIFT;
  const out: BoxDef[] = [
    box(x, 0.9 + y, z, 4, 0.6, 2, 0x7a3b2e, { model: 'wagon' }),
    box(x + 1.94, 1.45 + y, z, 0.12, 0.5, 2, 0x7a3b2e, part),
    box(x, 0.525 + y, z, 3.4, 0.15, 1.8, IRON, part),
  ];
  // Its wheels, standing on the rails.
  for (const dx of [-1.3, 1.3])
    for (const dz of [-GAUGE / 2, GAUGE / 2])
      out.push(box(x + dx, RAIL_TOP + 0.3, z + dz, 0.6, 0.6, 0.3, IRON, part));
  return out;
}

/**
 * The water tower at `x`, `z`: a deck on four braced legs at its corners, the round tank on
 * its south-east quarter, and the spout off the east side with its hose hanging over the edge. The braces between the legs are what a climber
 * presses against on the ladder up its north side, so they are never more than a body's
 * height apart, and they stand a whisker proud of the deck's edge: a climber held there
 * comes up past the edge instead of bumping their head on the deck.
 */
function waterTower(x: number, z: number): BoxDef[] {
  const half = 1.3;
  const leg = 0.25;
  const out: BoxDef[] = [];
  for (const dx of [-1, 1])
    for (const dz of [-1, 1])
      out.push(
        box(x + dx * (half - leg / 2), 1.7, z + dz * (half - leg / 2), leg, 3.4, leg, RAIL, {
          model: 'post',
        }),
      );
  const brace = 0.12;
  const at = half + 0.03 - brace / 2;
  const span = 2 * (half - leg);
  for (const y of [0.6, 1.5, 2.4, 3.2])
    for (const side of [-1, 1]) {
      out.push(box(x, y, z + side * at, span, brace, brace, RAIL));
      out.push(box(x + side * at, y, z, brace, brace, span, RAIL));
    }
  out.push(
    standing(rect(x - half, z - half, x + half, z + half), 0.2, BOARDS, 3.4, { model: 'deck' }),
    box(x + 0.35, 4.35, z - 0.6, 1.3, 1.5, 1.3, RAIL, { model: 'waterTank' }),
    box(x + 1.375, 4.02, z - 0.6, 0.75, 0.8, 0.2, IRON, { model: 'tankSpout' }),
  );
  return out;
}

/** The dog's kennel at `x`, `z`: a hut with a flat roof and a dark doorway on its south side. */
function kennel(x: number, z: number): BoxDef[] {
  return [
    box(x, 0.45, z, 1, 0.9, 1.2, WOOD),
    box(x, 0.94, z, 1.2, 0.08, 1.4, ROOF),
    box(x, 0.3, z - 0.61, 0.45, 0.6, 0.02, 0x1a1a1a),
  ];
}

/**
 * One carriage of the train: a room on the track with its interior, the corridor on the
 * platform side. Its doors onto the platform are at both ends, a corridor door goes through
 * each end wall (the carriages stand close enough to walk from one to the next), and the
 * lounge and the guard's van may have a door onto the far track too.
 */
function carriage(
  kind: CarKind,
  r: { x0: number; z0: number; x1: number; z1: number },
  flipped: boolean,
  g: Gen,
  next: () => number,
): {
  boxes: BoxDef[];
  hideouts: HideoutDef[];
  pageSpots: Vec3[];
  windows: WindowDef[];
  dogSpots: Vec3[];
  floor: DecalDef;
  treatJar: Vec3 | null;
} {
  const boxes: BoxDef[] = [];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  const windows: WindowDef[] = [];
  let treatJar: Vec3 | null = null;
  const dogSpots: Vec3[] = [];
  /** A position along the carriage, mirrored when it stands turned round. */
  const X = (x: number) => (flipped ? r.x0 + r.x1 - x : x);
  const F = (f: number) =>
    f === EAST ? (flipped ? WEST : EAST) : f === WEST ? (flipped ? EAST : WEST) : f;
  const mid = (r.x0 + r.x1) / 2;
  /** Where something `depth` deep stands with its back to the far wall. */
  const against = (depth: number) => r.z0 + 0.1 + depth / 2;
  const gaps: Gap[] = [
    { side: 'n', at: X(r.x0 + 1.1), width: 1 },
    { side: 'n', at: X(r.x1 - 1.1), width: 1 },
    { side: 'e', at: CORRIDOR, width: 1 },
    { side: 'w', at: CORRIDOR, width: 1 },
  ];
  for (const x of [r.x0 + 1.1, r.x1 - 1.1])
    dogSpots.push({ x: X(x), y: 0, z: CORRIDOR }, { x: X(x), y: 0, z: r.z1 + 0.5 });
  const farDoor = (kind === 'lounge' || kind === 'guard') && g.chance(0.5);
  if (farDoor) gaps.push({ side: 's', at: X(mid), width: 1 });
  boxes.push(
    ...roomWalls(r, CAR_H, CARRIAGE, gaps),
    standing(grow(r, 0.1), CAR_ROOF_H, CARRIAGE_ROOF, CAR_H, { model: 'carriageRoof' }),
  );
  // Windows: between the platform doors, and on the far side wherever nothing standing
  // against it would reach up into the window's sill and frame (see `farWindows`).
  windows.push({ x: X(mid), z: r.z1, alongX: true });
  const farWindows = (...xs: number[]) =>
    windows.push(...xs.map((x) => ({ x: X(x), z: r.z0, alongX: true })));
  // Along both sides: the dark valance over the bottom of the body, the cream band under the
  // roof and the gold waist line, stopping short of the gangways at the ends and either side
  // of the doorways (the band runs on over them, above head height).
  const outside = (side: 'n' | 's', out: number, depth: number) =>
    side === 'n' ? r.z1 + WALL_T / 2 + out + depth / 2 : r.z0 - WALL_T / 2 - out - depth / 2;
  const ends = {
    from: r.x0 - WALL_T / 2 + GANGWAY.width / 2 + 0.01,
    to: r.x1 + WALL_T / 2 - GANGWAY.width / 2 - 0.01,
  };
  for (const side of ['n', 's'] as const) {
    const doors = gaps
      .filter((gp) => gp.side === side)
      .map((gp) => gp.at)
      .sort((a, b) => a - b);
    const strip = (y0: number, h: number, depth: number, colour: number, cut: boolean) => {
      let from = ends.from;
      for (const at of [...(cut ? doors : []), Infinity]) {
        const to = Math.min(ends.to, at - DOOR_CLEAR);
        if (to - from > 0.05)
          boxes.push(
            box((from + to) / 2, y0 + h / 2, outside(side, 0, depth), to - from, h, depth, colour, {
              model: 'livery',
            }),
          );
        from = at + DOOR_CLEAR;
      }
    };
    strip(0, VALANCE_H, 0.05, IRON, true);
    strip(1.08, 0.04, 0.02, 0xd9b44a, true);
    strip(2.32, 0.2, 0.02, 0xe8dcc0, false);
    // A pair of wheels under each end on this side, on the rail down in the cutting, hung
    // from the underframe.
    const rail = (TRACK.z0 + TRACK.z1) / 2 + (side === 'n' ? 1 : -1) * (GAUGE / 2);
    for (const x of [r.x0 + AXLE.at, r.x1 - AXLE.at])
      boxes.push(
        box(x, CUT_FLOOR + RAIL_TOP + AXLE.h / 2, rail, AXLE.w, AXLE.h, AXLE.depth, IRON, {
          model: 'axle',
          front: side === 'n' ? '+z' : '-z',
        }),
      );
  }
  switch (kind) {
    case 'sleeper': {
      // No windows on the far side: the luggage racks run across where they would be.
      // Two compartments off the corridor, each with a berth under a luggage rack, and a
      // drawer under the first berth.
      const inner = r.z0 + 0.1;
      const wallFace = CORRIDOR_WALL - 0.1;
      boxes.push(
        box(X(mid), CAR_H / 2, (inner + wallFace) / 2, 0.1, CAR_H, wallFace - inner, CARRIAGE),
      );
      for (const cx of [mid - 1.3, mid + 1.3]) {
        const bed = box(X(cx), 0.25, against(0.65), 1.9, 0.5, 0.65, BERTH, {
          model: 'bed',
          front: '+z',
        });
        boxes.push(bed);
        hideouts.push(
          hideout(next(), 'berth', X(cx), against(0.65), SOUTH, 0.5, { x: 1.6, y: 0.1, z: 0.5 }),
        );
        boxes.push(box(X(cx), 1.9, against(0.5), 1.6, 0.04, 0.5, 0x6b6b6b));
        pageSpots.push({ x: X(cx), y: 1.95, z: against(0.5) });
        if (cx < mid) hideouts.push(drawerIn(next(), bed, 0, 0.19));
      }
      // The wall to the corridor, with a door into each compartment.
      boxes.push(
        ...roomWalls(
          rect(r.x0, r.z0, r.x1, CORRIDOR_WALL),
          CAR_H,
          CARRIAGE,
          [
            { side: 'n', at: X(mid - 1.3), width: 1 },
            { side: 'n', at: X(mid + 1.3), width: 1 },
          ],
          { skip: ['s', 'e', 'w'] },
        ),
      );
      break;
    }
    case 'dining': {
      // Over the counter and the tables, both lower than the sills.
      farWindows(mid - 1.3, mid + 1.3);
      // The bar counter with its drawer and the treat jar at the west end, tables by the
      // windows, and the fridge in the east corner, clear of the corridor door.
      const counter = box(X(r.x0 + 1.2), 0.45, against(0.6), 1.8, 0.9, 0.6, 0x8a2f2f, {
        model: 'counter',
        front: '+z',
      });
      boxes.push(counter);
      hideouts.push(drawerIn(next(), counter, 0));
      treatJar = { x: X(r.x0 + 1.7), y: 0.9, z: against(0.6) };
      for (const cx of [r.x0 + 2.9, r.x0 + 4.2]) {
        boxes.push(box(X(cx), 0.375, against(0.9), 1, 0.75, 0.9, WOOD, { model: 'table' }));
        pageSpots.push({ x: X(cx), y: 0.8, z: against(0.9) });
      }
      hideouts.push(
        hideout(next(), 'fridge', X(r.x1 - 0.5), 3.3, F(WEST), 0, { x: 0.7, y: 1.6, z: 0.6 }),
      );
      break;
    }
    case 'lounge': {
      // Over the sofa, and between the armchair and the bookshelf (clear of a door between).
      farWindows(r.x0 + 1.35, ...(farDoor ? [] : [r.x0 + 3.2]));
      // A sofa and an armchair facing the corridor, the bookshelf, a rug down the middle.
      boxes.push(
        box(X(r.x0 + 1.2), 0.225, against(0.8), 1.8, 0.45, 0.8, 0x4f6d8f, {
          model: 'sofa',
          front: '+z',
        }),
        box(X(r.x0 + 3.55), 0.225, against(0.8), 0.8, 0.45, 0.8, 0x4f6d8f, {
          model: 'sofa',
          front: '+z',
        }),
      );
      hideouts.push(
        hideout(next(), 'cushion', X(r.x0 + 1.2), against(0.8), NORTH, 0.45, {
          x: 1,
          y: 0.1,
          z: 0.6,
        }),
      );
      boxes.push(
        box(X(r.x1 - 0.8), 0.9, against(0.4), 1, 1.8, 0.4, 0x6b4a2f, {
          model: 'bookshelf',
          front: '+z',
        }),
      );
      pageSpots.push({ x: X(r.x1 - 0.8), y: 1.85, z: against(0.4) });
      hideouts.push(hideout(next(), 'rug', X(mid), 3.6, SOUTH, 0, { x: 1.8, y: 0.02, z: 0.9 }));
      break;
    }
    case 'guard': {
      // Between the chest and the desk, where neither the lockers nor the lids opening reach
      // the window (unless the door between is there).
      if (!farDoor) farWindows(r.x0 + 3.1);
      // Lockers and the parcels cage along the far wall, the desk with a drawer and the
      // toolbox on it at the east end. The lockers' doors hang on their left, so each stands
      // a little off the end wall, whichever way round the van is.
      for (const cx of [r.x0 + 0.5, r.x0 + 1.3])
        hideouts.push(
          hideout(next(), 'locker', X(cx), against(0.7), NORTH, 0, { x: 0.6, y: 1.9, z: 0.7 }),
        );
      hideouts.push(
        hideout(next(), 'chest', X(r.x0 + 1.9), against(1) + 0.3, NORTH, 0, {
          x: 0.5,
          y: 0.9,
          z: 1,
        }),
      );
      const desk = box(X(r.x1 - 1), 0.45, against(0.6), 1.4, 0.9, 0.6, WOOD, {
        model: 'counter',
        front: '+z',
      });
      boxes.push(desk);
      hideouts.push(drawerIn(next(), desk, 0));
      hideouts.push(
        hideout(next(), 'toolbox', X(r.x1 - 1), against(0.6), NORTH, 0.9, {
          x: 0.5,
          y: 0.25,
          z: 0.3,
        }),
      );
      break;
    }
  }
  // The floor, a little inside the walls: a room to light and shade, with no house trim.
  const floor = floorOf(rect(r.x0 + 0.15, r.z0 + 0.15, r.x1 - 0.15, r.z1 - 0.15), CARRIAGE_FLOOR);
  return { boxes, hideouts, pageSpots, windows, dogSpots, floor, treatJar };
}
