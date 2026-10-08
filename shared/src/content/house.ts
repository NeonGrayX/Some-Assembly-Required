import type { BrickTypeId, ColourId } from '../bricks.ts';
import type { Vec3 } from '../math.ts';

/** A static, axis-aligned box (walls, tables, crates). `pos` is the box centre. */
export interface BoxDef {
  pos: Vec3;
  size: Vec3;
  colour: number;
  /** Tilt around the x axis in radians, for ramps. */
  tiltX?: number;
  /**
   * What the box is, if it is a piece of furniture: it is then drawn as one (a table with
   * legs, a sofa with cushions…) fitted to the box, while it still collides as the box.
   */
  model?: BoxModel;
  /** Which side of the box is its front, for models that have one. Default -z. */
  front?: '-z' | '+z' | '-x' | '+x';
}

export type BoxModel =
  | 'table'
  | 'counter'
  | 'sofa'
  | 'sofaBack'
  | 'bookshelf'
  | 'crate'
  | 'lampPost'
  | 'bed'
  | 'step'
  | 'rail'
  /** The basement's electrical panel: click it to fix the power when it has failed. */
  | 'panel';

/** A coloured patch drawn on the floor, with no collision (room floors). */
export interface DecalDef {
  pos: Vec3;
  size: { x: number; z: number };
  colour: number;
}

/** A bin that hands out bricks of one type and colour. `pos` is the centre of its base. */
export interface BinDef {
  id: number;
  /** Centre of its bottom. */
  pos: Vec3;
  type: BrickTypeId;
  colour: ColourId;
  /** A small parts drawer on a rack, rather than a tub on the ground. */
  small?: boolean;
}

export type HideoutKind =
  'drawer' | 'fridge' | 'locker' | 'cabinet' | 'cushion' | 'rug' | 'mailbox' | 'toolbox' | 'chest';

/**
 * Somewhere a page can be hidden out of sight: it only shows once someone opens it (or lifts
 * the rug). `pos` is the centre, `facing` the heading its front looks toward (0 = -z).
 */
export interface HideoutDef {
  id: number;
  kind: HideoutKind;
  pos: Vec3;
  size: Vec3;
  facing: number;
}

/**
 * A climbable ladder. `pos` is the centre of its foot; climbers go straight up. `facing` is the
 * way a climber faces: the ladder leans that way (against a wall, usually), and is climbed from
 * the other side.
 */
export interface LadderDef {
  pos: Vec3;
  width: number;
  /** Height up to which a climber's centre keeps climbing. */
  height: number;
  facing: number;
}

/**
 * A window centred on a wall, given by a point on the wall's centre line. It cuts a hole
 * through the wall that is drawn only: players still collide with the whole wall.
 */
export interface WindowDef {
  x: number;
  z: number;
  /** The floor it looks out from: 0 downstairs (the default) or `UPPER_FLOOR`. */
  y?: number;
  /** True when the wall runs along x (a north or south wall). */
  alongX: boolean;
}

/**
 * Which side of its wall a doorway's doors stand open on, given by a point in the doorway on
 * the wall's centre line. The doors are drawn only, swung flat against the wall either side of
 * the opening.
 */
export interface DoorDef {
  x: number;
  z: number;
  /** The floor the doorway is on: 0 downstairs (the default) or `UPPER_FLOOR`. */
  y?: number;
  /** +1 or -1: the side they open to, along z for a north or south wall, else along x. */
  opensTo: number;
}

/** How wide each of a doorway's two doors is (they cover the opening between them). */
export const doorLeaf = (doorwayWidth: number): number => Math.min(1, doorwayWidth / 2);

/**
 * A straight flight of stairs against a wall, one storey up: from the ground floor to
 * `UPPER_FLOOR`, or from the basement to the ground floor. Its steps are solid blocks standing
 * on the floor, and above its upper part the floor above has a stairwell, railed off on its
 * open side and at its lower end.
 */
export interface StairsDef {
  /**
   * The middle of the foot of the flight: the front edge of the first step, on the floor. Its
   * `y` is the floor it starts from (`BASEMENT_FLOOR` for the flight down to the basement).
   */
  pos: Vec3;
  /** The heading the flight climbs toward (0 = -z), a quarter turn. */
  facing: number;
  /** The side of the flight its wall is on, seen climbing: 1 for the right, -1 for the left. */
  wall: number;
}

/** The shape every flight has. */
export const STAIRS = {
  width: 1,
  /** Steps below the upper floor: the last climb is onto the floor itself. */
  steps: 13,
  rise: 0.2,
  tread: 0.3,
  /** The stairwell opens above the flight from this step on, so nobody bumps their head. */
  wellFrom: 1,
  railHeight: 0.95,
  railThickness: 0.06,
  /** Floor kept clear at the foot of the flight and at its top, to step on and off. */
  landing: 1,
};

/** An axis-aligned rectangle on the floor. */
export interface FloorRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Where a flight of stairs stands and what it needs, as rectangles on the floor. */
export interface StairsPlan {
  /** Under the steps. */
  flight: FloorRect;
  /** The hole in the upper floor above it. */
  well: FloorRect;
  /** The well with its railings round it: nothing upstairs may stand there. */
  railed: FloorRect;
  /** Floor kept clear at its foot, downstairs. */
  foot: FloorRect;
  /** Floor kept clear where it comes out at the top, upstairs. */
  top: FloorRect;
  /** The steps and railings, as boxes. */
  boxes: BoxDef[];
}

const FRONT_BY_TURN = ['-z', '-x', '+z', '+x'] as const;

/** Works out a flight's steps, railings and the floor it needs. */
export function stairsPlan(s: StairsDef): StairsPlan {
  const { width: W, steps, rise, tread, wellFrom, railHeight: RH, railThickness: RT } = STAIRS;
  const turnIndex = ((Math.round(s.facing / (Math.PI / 2)) % 4) + 4) % 4;
  // Climbing along `f`; `r` points to the climber's right.
  const f = { x: -Math.round(Math.sin(s.facing)), z: -Math.round(Math.cos(s.facing)) };
  const r = { x: Math.round(Math.cos(s.facing)), z: -Math.round(Math.sin(s.facing)) };
  /** A floor rectangle given along the flight (from its foot) and across it (to the right). */
  const rect = (a0: number, a1: number, c0: number, c1: number): FloorRect => {
    const xs = [a0, a1].flatMap((a) => [c0, c1].map((c) => s.pos.x + f.x * a + r.x * c));
    const zs = [a0, a1].flatMap((a) => [c0, c1].map((c) => s.pos.z + f.z * a + r.z * c));
    return {
      x0: tidy(Math.min(...xs)),
      x1: tidy(Math.max(...xs)),
      z0: tidy(Math.min(...zs)),
      z1: tidy(Math.max(...zs)),
    };
  };
  const box = (q: FloorRect, y0: number, y1: number, b: Omit<BoxDef, 'pos' | 'size'>): BoxDef => ({
    ...b,
    pos: { x: tidy((q.x0 + q.x1) / 2), y: tidy((y0 + y1) / 2), z: tidy((q.z0 + q.z1) / 2) },
    size: { x: tidy(q.x1 - q.x0), y: tidy(y1 - y0), z: tidy(q.z1 - q.z0) },
  });
  const run = steps * tread;
  const half = W / 2;
  const open = -s.wall;
  const base = s.pos.y;
  const top = tidy(base + UPPER_FLOOR);
  const boxes: BoxDef[] = [];
  for (let i = 0; i < steps; i++)
    boxes.push(
      box(rect(i * tread, (i + 1) * tread, -half, half), base, tidy(base + (i + 1) * rise), {
        colour: STEP,
        model: 'step',
        // The riser faces down the flight.
        front: FRONT_BY_TURN[(turnIndex + 2) % 4],
      }),
    );
  const wellStart = wellFrom * tread;
  const across = (c: number) => [Math.min(c, c + open * RT), Math.max(c, c + open * RT)] as const;
  const [s0, s1] = across(open * half);
  // Along the open side of the well, and across its lower end from that rail to the wall.
  const side = rect(wellStart - RT, run, s0, s1);
  const end = rect(wellStart - RT, wellStart, Math.min(-half, s0), Math.max(half, s1));
  for (const q of [side, end])
    boxes.push(box(q, top, top + RH, { colour: DARK_WOOD, model: 'rail' }));
  const well = rect(wellStart, run, -half, half);
  return {
    flight: rect(0, run, -half, half),
    well,
    railed: {
      x0: Math.min(well.x0, side.x0, end.x0),
      x1: Math.max(well.x1, side.x1, end.x1),
      z0: Math.min(well.z0, side.z0, end.z0),
      z1: Math.max(well.z1, side.z1, end.z1),
    },
    foot: rect(-STAIRS.landing, 0, -half, half),
    top: rect(run, run + STAIRS.landing, -half, half),
    boxes,
  };
}

/** Rounds away float dust, so plans print and compare cleanly. */
const tidy = (x: number) => Math.round(x * 1e6) / 1e6;

/** The upper floor's slab over the kitchen and living room, walls and all. */
export const UPPER_SLAB: FloorRect = { x0: -12.1, x1: 4.1, z0: 5.9, z1: 15.1 };
/** The break room's floor, over the basement, walls and all: the ground has a hole here. */
export const BASEMENT_SLAB: FloorRect = { x0: 3.9, x1: 12.1, z0: 5.9, z1: 15.1 };

/**
 * The slab of the floor a flight comes out on, with a stairwell cut out of it, and the flight's
 * steps and railings: everything in a level that changes with where the stairs are.
 */
export function upperFloor(s: StairsDef): BoxDef[] {
  const plan = stairsPlan(s);
  const down = s.pos.y < 0;
  const { x0, x1, z0, z1 } = down ? BASEMENT_SLAB : UPPER_SLAB;
  const y = tidy(s.pos.y + UPPER_FLOOR - 0.1);
  const w = plan.well;
  const pieces: FloorRect[] = [
    { x0, x1, z0, z1: w.z0 },
    { x0, x1, z0: w.z1, z1 },
    { x0, x1: w.x0, z0: w.z0, z1: w.z1 },
    { x0: w.x1, x1, z0: w.z0, z1: w.z1 },
  ].filter((q) => q.x1 - q.x0 > 1e-6 && q.z1 - q.z0 > 1e-6);
  return [
    ...pieces.map((q) => ({
      pos: { x: tidy((q.x0 + q.x1) / 2), y, z: tidy((q.z0 + q.z1) / 2) },
      size: { x: tidy(q.x1 - q.x0), y: 0.2, z: tidy(q.z1 - q.z0) },
      colour: down ? CONCRETE : ROOF,
    })),
    ...plan.boxes,
  ];
}

/** The floor something at height `y` stands on: the basement's, the ground floor's or the upper floor's. */
export const floorLevel = (y: number): number =>
  y >= UPPER_FLOOR - 0.15 ? UPPER_FLOOR : y < -0.15 ? BASEMENT_FLOOR : 0;

/**
 * The ground as rectangles: the whole square of the level, but for the hole over the
 * basement (whose own floor and the break room's slab over it are boxes).
 */
export function groundPieces(level: LevelDef): FloorRect[] {
  const h = level.floorSize / 2;
  const all: FloorRect = { x0: -h, x1: h, z0: -h, z1: h };
  const hole = level.groundHole;
  if (!hole) return [all];
  // Cut round the hole along whole metres first, then the strips left up to its edge: the big
  // pieces players run about on then have sizes floats hold exactly, and the physics engine's
  // single-precision maths gives the very same movement on them as on the whole ground.
  const frame = {
    x0: Math.floor(hole.x0),
    x1: Math.ceil(hole.x1),
    z0: Math.floor(hole.z0),
    z1: Math.ceil(hole.z1),
  };
  return [...around(all, frame), ...around(frame, hole)];
}

/** What is left of `r` once `hole` is cut out of it, as up to four rectangles. */
function around(r: FloorRect, hole: FloorRect): FloorRect[] {
  return [
    { x0: r.x0, x1: r.x1, z0: r.z0, z1: hole.z0 },
    { x0: r.x0, x1: r.x1, z0: hole.z1, z1: r.z1 },
    { x0: r.x0, x1: hole.x0, z0: hole.z0, z1: hole.z1 },
    { x0: hole.x1, x1: r.x1, z0: hole.z0, z1: hole.z1 },
  ].filter((q) => q.x1 - q.x0 > 1e-6 && q.z1 - q.z0 > 1e-6);
}

export interface LevelDef {
  /** Side length of the square floor, in metres. */
  floorSize: number;
  boxes: BoxDef[];
  decals: DecalDef[];
  bins: BinDef[];
  /** World position of the job-site baseplate's minimum corner. */
  baseplate: Vec3;
  /** Quality inspector pad: centre on the floor and size. A build resting on it is scanned. */
  inspector: { pos: Vec3; size: { x: number; z: number } };
  /** Base of the "Done" button pedestal next to the job site. */
  doneButton: Vec3;
  /** Base of the meeting bell next to the job site. */
  bell: Vec3;
  /**
   * Two-sided corkboards for pinning pages where everyone can see them: each one's centre. The
   * slots run board by board, so the first board's 16 come first.
   */
  boards: { pos: Vec3; facing: number }[];
  /** Open surfaces where instruction pages can lie. */
  pageSpots: Vec3[];
  /** Closed hiding places for pages. */
  hideouts: HideoutDef[];
  ladders: LadderDef[];
  /** Where players stand during a Brick Meeting. */
  meetingSeats: Vec3[];
  /** Where ceiling lamps hang inside: the glowing underside of each shade. */
  lights: Vec3[];
  /** The house's windows, if not the client's default ones (they may move with the layout). */
  windows?: WindowDef[];
  /** Which side each doorway's doors open to, if not the client's default (into the house). */
  doors?: DoorDef[];
  /**
   * Flights of stairs: up to the upper floor, then down to the basement (their steps and
   * railings are in `boxes`).
   */
  stairs?: StairsDef[];
  /** Where the ground has a hole for the basement under the house, if it has one. */
  groundHole?: FloorRect;
  spawn: Vec3;
  dog: DogDef;
  /**
   * Where the broom is kept, leaning against a basement wall: the spot on the floor its head
   * rests on, and the way its bristles face (away from the wall), as a yaw.
   */
  broom: { pos: Vec3; facing: number };
}

/**
 * Where the dog can go: points on the floor and the straight, clear walks between them. It
 * starts at `points[start]`. The treat jar hands out dog treats.
 */
export interface DogDef {
  points: Vec3[];
  links: [number, number][];
  start: number;
  treatJar: Vec3;
}

export const BIN_SIZE = { x: 0.8, y: 0.6, z: 0.8 };
/** A parts drawer on a rack. */
export const SMALL_BIN_SIZE = { x: 0.4, y: 0.3, z: 0.4 };

export function binSize(bin: BinDef): { x: number; y: number; z: number } {
  return bin.small ? SMALL_BIN_SIZE : BIN_SIZE;
}
export const BUTTON_SIZE = { x: 0.4, y: 0.9, z: 0.4 };
export const BOARD_SIZE = { x: 1.7, y: 1.1, z: 0.06 };
/** Pin slots on each face of a corkboard: two rows of four. */
export const BOARD_FACE_SLOTS = 8;
/** Slots on one whole board: the front face's first, then the back's. */
export const BOARD_SLOTS = 2 * BOARD_FACE_SLOTS;

/** Pin slots on all of a level's corkboards together. */
export function boardSlots(level: LevelDef): number {
  return level.boards.length * BOARD_SLOTS;
}

const FENCE = 0xd8cfc0;
const WALL = 0xece4d4;
const WOOD = 0x9a6b43;
const DARK_WOOD = 0x6b4a2f;
const ROOF = 0x8c4b3a;
const LAMP_POST = 0x2f3336;
const SOFA = 0x4f6d8f;
const BLANKET = 0x5f7f6a;
const STEP = 0xe9e1d0;
const CONCRETE = 0x8d8a84;
const BASEMENT_WALL = 0xbdb6a8;
const PANEL = 0x8e979c;
const HEIGHT = 2.6;
const T = 0.2;
/** Height of the upper floor, on top of the ground floor's walls and ceiling. */
export const UPPER_FLOOR = 2.8;
const UP = UPPER_FLOOR;
/** Height of the basement's floor, under the break room: a storey down. */
export const BASEMENT_FLOOR = -2.8;
const DOWN = BASEMENT_FLOOR;
/** Doorways are this tall, with a header box above them up to the roof. */
const DOOR_HEIGHT = 2.2;
const HEADER = HEIGHT - DOOR_HEIGHT;

/**
 * Garden lamp posts: by the front door, along the fence and around the job site, kept clear of
 * the bins, page spots and the dog's walks. A post collides as a thin box; its lantern sits on top.
 */
const gardenLamps: BoxDef[] = [
  [-1.5, 5.4],
  [1.5, 5.4],
  [-6, -14.8],
  [6, -14.8],
  [-14.8, 2],
  [14.8, 1],
  // Around the job site, so it is lit at night.
  [0, -7.5],
  [-8, 0.5],
  [8, -1],
].map(([x, z]) => ({
  pos: { x: x!, y: 1.1, z: z! },
  size: { x: 0.14, y: 2.2, z: 0.14 },
  colour: LAMP_POST,
  model: 'lampPost' as const,
}));

/** House walls: south wall with a front door, two inner walls with doorways. */
const houseWalls: BoxDef[] = [
  // The front and back walls run out to the end walls' outer faces and the end walls fit
  // between them, so each corner is square, with no notch and no overlapping faces.
  { pos: { x: -6.55, y: HEIGHT / 2, z: 6 }, size: { x: 11.1, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: 6.55, y: HEIGHT / 2, z: 6 }, size: { x: 11.1, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: 0, y: HEIGHT / 2, z: 15 }, size: { x: 24.2, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: -12, y: HEIGHT / 2, z: 10.5 }, size: { x: T, y: HEIGHT, z: 9 - T }, colour: WALL },
  { pos: { x: 12, y: HEIGHT / 2, z: 10.5 }, size: { x: T, y: HEIGHT, z: 9 - T }, colour: WALL },
  ...[-4, 4].flatMap((x) => [
    { pos: { x, y: HEIGHT / 2, z: 7.5 }, size: { x: T, y: HEIGHT, z: 3 }, colour: WALL },
    { pos: { x, y: HEIGHT / 2, z: 13 }, size: { x: T, y: HEIGHT, z: 4 }, colour: WALL },
  ]),
  // Headers over the front door and the two inner doorways.
  { pos: { x: 0, y: HEIGHT - HEADER / 2, z: 6 }, size: { x: 2, y: HEADER, z: T }, colour: WALL },
  ...[-4, 4].map((x) => ({
    pos: { x, y: HEIGHT - HEADER / 2, z: 10 },
    size: { x: T, y: HEADER, z: 2 },
    colour: WALL,
  })),
  // Flat roof over the break room you can walk on (reach it by the ladder on the south wall,
  // or out of the upper floor's door).
  { pos: { x: 8.1, y: HEIGHT + 0.1, z: 10.5 }, size: { x: 8, y: 0.2, z: 9.2 }, colour: ROOF },
  // The upper floor over the kitchen and living room: the same walls again, standing on its
  // slab (see `upperFloor`), with a doorway between its two rooms and one out onto that roof.
  { pos: { x: -4, y: UP + HEIGHT / 2, z: 6 }, size: { x: 16.2, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: -4, y: UP + HEIGHT / 2, z: 15 }, size: { x: 16.2, y: HEIGHT, z: T }, colour: WALL },
  {
    pos: { x: -12, y: UP + HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    colour: WALL,
  },
  ...[-4, 4].flatMap((x) => [
    { pos: { x, y: UP + HEIGHT / 2, z: 7.5 }, size: { x: T, y: HEIGHT, z: 3 }, colour: WALL },
    { pos: { x, y: UP + HEIGHT / 2, z: 13 }, size: { x: T, y: HEIGHT, z: 4 }, colour: WALL },
    {
      pos: { x, y: UP + HEIGHT - HEADER / 2, z: 10 },
      size: { x: T, y: HEADER, z: 2 },
      colour: WALL,
    },
  ]),
  // And its own flat roof.
  {
    pos: { x: -4, y: UP + HEIGHT + 0.1, z: 10.5 },
    size: { x: 16.2, y: 0.2, z: 9.2 },
    colour: ROOF,
  },
  // The basement under the break room: a concrete floor and four walls up to the break room's
  // floor (see `upperFloor`), the same lines as the walls above.
  {
    pos: { x: 8, y: DOWN - 0.1, z: 10.5 },
    size: { x: 8.2, y: 0.2, z: 9.2 },
    colour: CONCRETE,
  },
  ...[6, 15].map((z) => ({
    pos: { x: 8, y: DOWN + HEIGHT / 2, z },
    size: { x: 8.2, y: HEIGHT, z: T },
    colour: BASEMENT_WALL,
  })),
  ...[4, 12].map((x) => ({
    pos: { x, y: DOWN + HEIGHT / 2, z: 10.5 },
    size: { x: T, y: HEIGHT, z: 9 - T },
    colour: BASEMENT_WALL,
  })),
];

/** Where the stairs are in the hand-made house: along the kitchen's south wall, climbing west. */
const HOUSE_STAIRS: StairsDef = { pos: { x: -5.5, y: 0, z: 6.6 }, facing: Math.PI / 2, wall: 1 };

/**
 * Where the stairs down to the basement are in the hand-made house: along the break room's
 * south wall, from the basement climbing east.
 */
const HOUSE_BASEMENT_STAIRS: StairsDef = {
  pos: { x: 7, y: BASEMENT_FLOOR, z: 6.6 },
  facing: -Math.PI / 2,
  wall: -1,
};

/**
 * The hand-made house's upper floor slab and the break room's floor over the basement, with
 * both flights' steps and railings (layouts make their own).
 */
export const HOUSE_STAIRWAYS: BoxDef[] = [
  ...upperFloor(HOUSE_STAIRS),
  ...upperFloor(HOUSE_BASEMENT_STAIRS),
];

/**
 * The yard and the house. The job site, bins, inspector and a ramp to a ledge are in the yard;
 * the house to the north has a kitchen, a living room and the break room where meetings are
 * held, full of drawers and rugs to hide pages in, and a roof reached by a ladder.
 */
export const HOUSE: LevelDef = {
  floorSize: 32,
  baseplate: { x: -0.8, y: 0, z: -0.8 },
  spawn: { x: 0, y: 1, z: 3.5 },
  dog: {
    points: [
      { x: 0, y: 0, z: 4.4 }, // 0: outside the front door
      { x: 0, y: 0, z: 7.2 }, // 1: just inside
      { x: 0, y: 0, z: 11.8 }, // 2: living room
      { x: -3, y: 0, z: 10 }, // 3: living room, by the kitchen door
      { x: -5.2, y: 0, z: 10 }, // 4: kitchen, by the door
      { x: -6, y: 0, z: 12.4 }, // 5: kitchen, between table and counter
      { x: -10.5, y: 0, z: 11.5 }, // 6: kitchen, by the fridge
      { x: -9.5, y: 0, z: 7.5 }, // 7: kitchen, south corner
      { x: 3, y: 0, z: 10 }, // 8: living room, by the break room door
      { x: 5.2, y: 0, z: 10 }, // 9: break room, by the door
      { x: 8, y: 0, z: 8 }, // 10: break room, south of the table
      { x: 10.6, y: 0, z: 12.6 }, // 11: break room, by the lockers
      { x: 6, y: 0, z: 13.4 }, // 12: break room, north of the table
      { x: -2.5, y: 0, z: 4.3 }, // 13: yard, by the house
      { x: -8, y: 0, z: 3.5 }, // 14: yard, west of the house front
      { x: -10, y: 0, z: -10 }, // 15: yard, south-west
      { x: 0, y: 0, z: -10.5 }, // 16: yard, south
      { x: 9, y: 0, z: -11 }, // 17: yard, south-east
      { x: 9.5, y: 0, z: 2 }, // 18: yard, east
      { x: -13, y: 0, z: 0 }, // 19: yard, far west
      { x: 10.5, y: 0, z: 8.5 }, // 20: break room, south-east
      { x: -14.5, y: 0, z: -8 }, // 21: yard, behind the inspector
      { x: 6, y: 0, z: 4.3 }, // 22: yard, north of the bins
    ],
    links: [
      [0, 1],
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [1, 8],
      [2, 8],
      [8, 9],
      [9, 10],
      [9, 12],
      [10, 20],
      [20, 11],
      [12, 11],
      [0, 13],
      [13, 14],
      [14, 19],
      [19, 21],
      [21, 15],
      [15, 16],
      [16, 17],
      [17, 18],
      [18, 22],
      [22, 0],
    ],
    start: 2,
    treatJar: { x: -6.8, y: 0.9, z: 14.55 },
  },
  boxes: [
    // Yard fence.
    { pos: { x: 0, y: 1, z: -16 }, size: { x: 32, y: 2, z: 0.3 }, colour: FENCE },
    { pos: { x: 0, y: 1, z: 16 }, size: { x: 32, y: 2, z: 0.3 }, colour: FENCE },
    { pos: { x: -16, y: 1, z: 0 }, size: { x: 0.3, y: 2, z: 32 }, colour: FENCE },
    { pos: { x: 16, y: 1, z: 0 }, size: { x: 0.3, y: 2, z: 32 }, colour: FENCE },
    // A short wall in the yard, between the job site and the inspector.
    { pos: { x: -8.5, y: 0.75, z: -4 }, size: { x: 0.3, y: 1.5, z: 5 }, colour: FENCE },
    // Yard table and crates.
    { pos: { x: 5, y: 0.4, z: -5 }, size: { x: 2, y: 0.8, z: 1.2 }, colour: WOOD, model: 'table' },
    {
      pos: { x: -5, y: 0.3, z: -6 },
      size: { x: 0.6, y: 0.6, z: 0.6 },
      colour: WOOD,
      model: 'crate',
    },
    {
      pos: { x: -4.2, y: 0.3, z: -6.3 },
      size: { x: 0.6, y: 0.6, z: 0.6 },
      colour: WOOD,
      model: 'crate',
    },
    // The parts racks' shelves and posts (their drawers are bins).
    { pos: { x: -2.925, y: 0.4, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: -2.925, y: 0.82, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: -2.925, y: 1.24, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: -2.925, y: 1.66, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: -5.225, y: 0.84, z: -15.4 }, size: { x: 0.05, y: 1.68, z: 0.46 }, colour: WOOD },
    { pos: { x: -0.625, y: 0.84, z: -15.4 }, size: { x: 0.05, y: 1.68, z: 0.46 }, colour: WOOD },
    { pos: { x: 2.925, y: 0.4, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: 2.925, y: 0.82, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: 2.925, y: 1.24, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: 2.925, y: 1.66, z: -15.4 }, size: { x: 4.6, y: 0.03, z: 0.46 }, colour: WOOD },
    { pos: { x: 0.625, y: 0.84, z: -15.4 }, size: { x: 0.05, y: 1.68, z: 0.46 }, colour: WOOD },
    { pos: { x: 5.225, y: 0.84, z: -15.4 }, size: { x: 0.05, y: 1.68, z: 0.46 }, colour: WOOD },
    // Ramp up to a ledge in the east of the yard.
    { pos: { x: 13.5, y: 0.5, z: -4 }, size: { x: 2, y: 0.2, z: 4 }, colour: WOOD, tiltX: 0.26 },
    { pos: { x: 13.5, y: 0.5, z: -7.5 }, size: { x: 2, y: 1, z: 3 }, colour: WOOD },
    // Mailbox post.
    { pos: { x: 2.4, y: 0.375, z: 4.8 }, size: { x: 0.08, y: 0.75, z: 0.08 }, colour: DARK_WOOD },
    ...gardenLamps,
    ...houseWalls,
    ...HOUSE_STAIRWAYS,
    // Kitchen: counter (drawers in its front), table.
    {
      pos: { x: -8, y: 0.45, z: 14.6 },
      size: { x: 3.2, y: 0.9, z: 0.6 },
      colour: 0xd9d4c7,
      model: 'counter',
    },
    {
      pos: { x: -8, y: 0.4, z: 9.5 },
      size: { x: 1.6, y: 0.8, z: 1 },
      colour: WOOD,
      model: 'table',
    },
    // Living room: sofa seat and back, bookshelf.
    {
      pos: { x: 0, y: 0.225, z: 14.3 },
      size: { x: 3, y: 0.45, z: 0.9 },
      colour: SOFA,
      model: 'sofa',
    },
    {
      pos: { x: 0, y: 0.6, z: 14.75 },
      size: { x: 3, y: 0.8, z: 0.2 },
      colour: SOFA,
      model: 'sofaBack',
    },
    {
      pos: { x: 3.2, y: 1, z: 14.65 },
      size: { x: 1, y: 2, z: 0.4 },
      colour: DARK_WOOD,
      model: 'bookshelf',
    },
    // Break room table.
    {
      pos: { x: 8, y: 0.4, z: 10.5 },
      size: { x: 2.2, y: 0.8, z: 1.2 },
      colour: WOOD,
      model: 'table',
    },
    // Bedroom, upstairs over the kitchen: a bed against the north wall.
    {
      pos: { x: -8.5, y: UP + 0.25, z: 13.83 },
      size: { x: 1.4, y: 0.5, z: 2.1 },
      colour: BLANKET,
      model: 'bed',
    },
    // Study, upstairs over the living room: a desk and a bookshelf.
    {
      pos: { x: -1.5, y: UP + 0.375, z: 14.53 },
      size: { x: 1.4, y: 0.75, z: 0.7 },
      colour: WOOD,
      model: 'table',
    },
    {
      pos: { x: 2.4, y: UP + 1, z: 14.68 },
      size: { x: 1, y: 2, z: 0.4 },
      colour: DARK_WOOD,
      model: 'bookshelf',
    },
    // Basement: the electrical panel on the north wall, and an old bookshelf.
    {
      pos: { x: 8.6, y: DOWN + 1.5, z: 14.81 },
      size: { x: 0.6, y: 0.8, z: 0.14 },
      colour: PANEL,
      model: 'panel',
    },
    {
      pos: { x: 4.32, y: DOWN + 0.9, z: 12 },
      size: { x: 0.4, y: 1.8, z: 1.2 },
      colour: DARK_WOOD,
      model: 'bookshelf',
      front: '+x',
    },
  ],
  stairs: [HOUSE_STAIRS, HOUSE_BASEMENT_STAIRS],
  groundHole: BASEMENT_SLAB,
  decals: [
    { pos: { x: -8, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xc8c2b4 },
    { pos: { x: 0, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xa47a52 },
    { pos: { x: 8, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0x8e9aa6 },
    // Upstairs: the bedroom and the study.
    { pos: { x: -8, y: UP, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xb7a58c },
    { pos: { x: 0, y: UP, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0x8f9a7e },
    // Downstairs from the break room: the basement.
    { pos: { x: 8, y: DOWN, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0x9c9890 },
  ],
  inspector: { pos: { x: -12, y: 0, z: -4 }, size: { x: 2.4, z: 2.4 } },
  doneButton: { x: -1.8, y: 0, z: 1.4 },
  bell: { x: 1.8, y: 0, z: 1.4 },
  // Two boards side by side, so a manual of 32 pages fits on them.
  boards: [
    { pos: { x: -4, y: 1.3, z: 3.2 }, facing: Math.PI },
    { pos: { x: -6.2, y: 1.3, z: 3.2 }, facing: Math.PI },
  ],
  // Against the basement's east wall (each layout puts it somewhere else down there).
  broom: { pos: { x: 11.62, y: DOWN, z: 13.5 }, facing: Math.PI / 2 },
  pageSpots: [
    { x: 5.6, y: 0.8, z: -4.7 }, // yard table
    { x: -5, y: 0.6, z: -6 }, // crates
    { x: -4.2, y: 0.6, z: -6.3 },
    { x: 12.9, y: 1, z: -6.6 }, // up on the ledge
    { x: -15, y: 0, z: -15 }, // yard corners
    { x: 15, y: 0, z: -15 },
    { x: -9.2, y: 0, z: -5 }, // behind the short wall
    { x: -14.5, y: 0, z: -1 },
    { x: 14.5, y: 0, z: 3 },
    { x: -14, y: 0, z: 4.5 },
    // More on the ground, out along the fences and beside the house, so a manual of 32 pages
    // still leaves room for the gear.
    { x: -11, y: 0, z: -15.2 },
    { x: 0, y: 0, z: -15.2 },
    { x: 11, y: 0, z: -15.2 },
    { x: -15.2, y: 0, z: -11.5 },
    { x: 15.2, y: 0, z: -11.5 },
    { x: 14.5, y: 0, z: 9 },
    { x: -14.5, y: 0, z: 12 },
    { x: 14.5, y: 0, z: 13.5 },
    { x: 8, y: HEIGHT + 0.2, z: 12.5 }, // on the roof
    { x: -8, y: 0.8, z: 9.5 }, // kitchen table
    { x: 3.2, y: 2, z: 14.65 }, // top of the bookshelf
    { x: 8.6, y: 0.8, z: 10.3 }, // break room table
    { x: -8.1, y: UP + 0.5, z: 13.2 }, // on the bed
    { x: -1.2, y: UP + 0.75, z: 14.5 }, // the study's desk
    { x: 2.4, y: UP + 2, z: 14.68 }, // top of the study's bookshelf
    { x: 4.32, y: DOWN + 1.8, z: 12 }, // top of the basement's bookshelf
  ],
  hideouts: [
    // Kitchen.
    {
      id: 1,
      kind: 'fridge',
      pos: { x: -11.5, y: 0.9, z: 13.8 },
      size: { x: 0.8, y: 1.8, z: 0.7 },
      facing: -Math.PI / 2,
    },
    {
      id: 2,
      kind: 'drawer',
      pos: { x: -9.1, y: 0.62, z: 14.25 },
      size: { x: 0.9, y: 0.22, z: 0.1 },
      facing: 0,
    },
    {
      id: 3,
      kind: 'drawer',
      pos: { x: -8, y: 0.62, z: 14.25 },
      size: { x: 0.9, y: 0.22, z: 0.1 },
      facing: 0,
    },
    {
      id: 4,
      kind: 'drawer',
      pos: { x: -6.9, y: 0.62, z: 14.25 },
      size: { x: 0.9, y: 0.22, z: 0.1 },
      facing: 0,
    },
    {
      id: 5,
      kind: 'rug',
      pos: { x: -6.2, y: 0.01, z: 8 },
      size: { x: 1.4, y: 0.02, z: 1 },
      facing: 0,
    },
    // Living room.
    {
      id: 6,
      kind: 'cushion',
      pos: { x: 0.7, y: 0.5, z: 14.2 },
      size: { x: 1.2, y: 0.1, z: 0.7 },
      facing: 0,
    },
    {
      id: 7,
      kind: 'cabinet',
      pos: { x: -3.1, y: 0.35, z: 14.55 },
      size: { x: 1.2, y: 0.7, z: 0.5 },
      facing: 0,
    },
    {
      id: 8,
      kind: 'rug',
      pos: { x: 0, y: 0.01, z: 10 },
      size: { x: 2.6, y: 0.02, z: 1.8 },
      facing: 0,
    },
    // Break room.
    {
      id: 9,
      kind: 'locker',
      pos: { x: 11.55, y: 1, z: 12.6 },
      size: { x: 0.6, y: 2, z: 0.8 },
      facing: Math.PI / 2,
    },
    {
      id: 10,
      kind: 'locker',
      pos: { x: 11.55, y: 1, z: 13.6 },
      size: { x: 0.6, y: 2, z: 0.8 },
      facing: Math.PI / 2,
    },
    {
      id: 11,
      kind: 'rug',
      pos: { x: 5.6, y: 0.01, z: 13.4 },
      size: { x: 1.2, y: 0.02, z: 0.9 },
      facing: 0,
    },
    // Yard.
    {
      id: 12,
      kind: 'mailbox',
      pos: { x: 2.4, y: 0.9, z: 4.8 },
      size: { x: 0.24, y: 0.3, z: 0.5 },
      facing: 0,
    },
    {
      id: 13,
      kind: 'toolbox',
      pos: { x: -9.5, y: 0.15, z: -9 },
      size: { x: 0.7, y: 0.3, z: 0.35 },
      facing: Math.PI,
    },
    {
      id: 14,
      kind: 'chest',
      pos: { x: 11, y: 0.3, z: 2 },
      size: { x: 0.8, y: 0.6, z: 0.6 },
      facing: Math.PI / 2,
    },
    // Bedroom: under the pillow, the nightstand, a chest, a rug.
    {
      id: 15,
      kind: 'cushion',
      pos: { x: -8.5, y: UP + 0.55, z: 14.45 },
      size: { x: 1, y: 0.1, z: 0.5 },
      facing: 0,
    },
    {
      id: 16,
      kind: 'cabinet',
      pos: { x: -10, y: UP + 0.3, z: 14.63 },
      size: { x: 0.6, y: 0.6, z: 0.5 },
      facing: 0,
    },
    {
      id: 17,
      kind: 'chest',
      pos: { x: -11.2, y: UP + 0.3, z: 10 },
      size: { x: 0.8, y: 0.6, z: 0.6 },
      facing: -Math.PI / 2,
    },
    {
      id: 18,
      kind: 'rug',
      pos: { x: -8, y: UP + 0.01, z: 10.5 },
      size: { x: 2, y: 0.02, z: 1.4 },
      facing: 0,
    },
    // Study: a toolbox by the wall, a rug.
    {
      id: 19,
      kind: 'toolbox',
      pos: { x: 3.4, y: UP + 0.15, z: 7.2 },
      size: { x: 0.7, y: 0.3, z: 0.35 },
      facing: Math.PI / 2,
    },
    {
      id: 20,
      kind: 'rug',
      pos: { x: 0, y: UP + 0.01, z: 10.5 },
      size: { x: 2.4, y: 0.02, z: 1.6 },
      facing: 0,
    },
    // Basement: an old chest.
    {
      id: 21,
      kind: 'chest',
      pos: { x: 10.5, y: DOWN + 0.3, z: 11 },
      size: { x: 0.8, y: 0.6, z: 0.6 },
      facing: Math.PI,
    },
  ],
  ladders: [{ pos: { x: 10, y: 0, z: 5.6 }, width: 0.8, height: 3.75, facing: Math.PI }],
  meetingSeats: [
    ...[6.6, 7.6, 8.6, 9.6].map((x) => ({ x, y: 0, z: 9.25 })),
    ...[6.6, 7.6, 8.6, 9.6].map((x) => ({ x, y: 0, z: 11.75 })),
    { x: 6.2, y: 0, z: 10.5 },
    { x: 9.9, y: 0, z: 10.5 },
  ],
  lights: [
    { x: -8, y: 2.3, z: 10.5 },
    { x: 0, y: 2.3, z: 10.5 },
    { x: 8, y: 2.3, z: 10.5 },
    { x: -8, y: UP + 2.3, z: 10.5 },
    { x: 0, y: UP + 2.3, z: 10.5 },
    { x: 8, y: DOWN + 2.3, z: 10.5 },
  ],
  bins: [
    // Everything the lighthouse needs.
    { id: 1, pos: { x: -3, y: 0, z: -3 }, type: '2x4', colour: 'red' },
    { id: 2, pos: { x: -1.5, y: 0, z: -3.8 }, type: '2x4', colour: 'white' },
    { id: 3, pos: { x: 0, y: 0, z: -4 }, type: '2x4', colour: 'dark-grey' },
    { id: 4, pos: { x: 1.5, y: 0, z: -3.8 }, type: '2x2', colour: 'light-grey' },
    { id: 5, pos: { x: 3, y: 0, z: -3 }, type: 'plate2x4', colour: 'light-grey' },
    { id: 6, pos: { x: 3.6, y: 0, z: -1.2 }, type: 'plate2x2', colour: 'light-grey' },
    { id: 7, pos: { x: -3.6, y: 0, z: -1.2 }, type: '2x2', colour: 'yellow' },
    { id: 8, pos: { x: 5, y: 0, z: -2.6 }, type: '2x2', colour: 'red' },
    { id: 9, pos: { x: 5, y: 0.8, z: -5 }, type: '1x1', colour: 'dark-grey' },
    // The hardest one to reach, up on the ledge.
    { id: 10, pos: { x: 13.5, y: 1, z: -8 }, type: '1x1', colour: 'black' },
    // Look-alikes, so a wrong brick is easy to grab by mistake (or on purpose).
    { id: 11, pos: { x: -5, y: 0, z: -2.6 }, type: '2x4', colour: 'dark-red' },
    { id: 12, pos: { x: 5, y: 0, z: 0.6 }, type: '2x4', colour: 'light-grey' },
    { id: 13, pos: { x: -5, y: 0, z: 0.6 }, type: '2x3', colour: 'red' },
    { id: 14, pos: { x: 4.4, y: 0, z: 2.6 }, type: '2x2', colour: 'orange' },
    // More look-alikes: each round's colour variant may need them.
    { id: 15, pos: { x: -6.5, y: 0, z: -4 }, type: '2x4', colour: 'black' },
    { id: 16, pos: { x: 6.5, y: 0, z: -0.5 }, type: '2x2', colour: 'dark-red' },
    { id: 17, pos: { x: -6.5, y: 0, z: -1.2 }, type: '2x2', colour: 'white' },
    { id: 18, pos: { x: 6.5, y: 0, z: -2.6 }, type: 'plate2x4', colour: 'dark-grey' },
    { id: 19, pos: { x: 3, y: 0, z: -6 }, type: 'plate2x2', colour: 'dark-grey' },
    { id: 20, pos: { x: -3, y: 0, z: -6 }, type: '2x4', colour: 'orange' },
    // What the rocket and the giant duck need on top, in a row south of the job site.
    { id: 21, pos: { x: -7.2, y: 0, z: -8.5 }, type: '1x2', colour: 'red' },
    { id: 22, pos: { x: -5.6, y: 0, z: -8.5 }, type: '1x2', colour: 'white' },
    { id: 23, pos: { x: -4, y: 0, z: -8.5 }, type: '2x2', colour: 'blue' },
    { id: 24, pos: { x: -2.4, y: 0, z: -8.5 }, type: 'plate2x4', colour: 'blue' },
    { id: 25, pos: { x: -0.8, y: 0, z: -8.5 }, type: '2x4', colour: 'yellow' },
    { id: 26, pos: { x: 0.8, y: 0, z: -8.5 }, type: '1x4', colour: 'yellow' },
    { id: 27, pos: { x: 2.4, y: 0, z: -8.5 }, type: '1x2', colour: 'yellow' },
    { id: 28, pos: { x: 4, y: 0, z: -8.5 }, type: '1x1', colour: 'green' },
    // And their look-alikes.
    { id: 29, pos: { x: 5.6, y: 0, z: -8.5 }, type: '1x2', colour: 'dark-red' },
    { id: 30, pos: { x: 7.2, y: 0, z: -8.5 }, type: 'plate2x2', colour: 'black' },
    { id: 31, pos: { x: 8, y: 0, z: -5.2 }, type: '2x2', colour: 'dark-blue' },
    { id: 32, pos: { x: 8, y: 0, z: -3.7 }, type: 'plate2x4', colour: 'dark-blue' },
    { id: 33, pos: { x: 8, y: 0, z: -2.2 }, type: '1x4', colour: 'orange' },
    // What the snowman, robot, race car, cottage, Christmas tree and castle need on top: a
    // column east of the job site, between the dog's walk and the ramp.
    { id: 34, pos: { x: 11, y: 0, z: -6.6 }, type: '2x4', colour: 'green' },
    { id: 35, pos: { x: 11, y: 0, z: -5 }, type: '2x2', colour: 'green' },
    { id: 36, pos: { x: 11, y: 0, z: -3.4 }, type: '1x1', colour: 'yellow' },
    { id: 37, pos: { x: 11, y: 0, z: -1.8 }, type: '2x2', colour: 'black' },
    { id: 38, pos: { x: 11, y: 0, z: -0.2 }, type: '1x4', colour: 'light-grey' },
    { id: 39, pos: { x: 11, y: 0, z: -8.2 }, type: '1x2', colour: 'light-grey' },
    { id: 40, pos: { x: 11, y: 0, z: -9.8 }, type: '1x1', colour: 'light-grey' },
    // Parts drawers on two racks along the south fence: everything the Manga Shop needs, its
    // tiles, slopes, round parts, window frames, side-stud bricks, brackets and prints.
    {
      id: 41,
      pos: { x: -4.95, y: 0, z: -15.4 },
      type: 'bracket2x4',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 42,
      pos: { x: -4.5, y: 0, z: -15.4 },
      type: 'dish2x2',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 43,
      pos: { x: -4.05, y: 0, z: -15.4 },
      type: 'plate1x2',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 44,
      pos: { x: -3.6, y: 0, z: -15.4 },
      type: 'plate1x3',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 45,
      pos: { x: -3.15, y: 0, z: -15.4 },
      type: 'plate1x4',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 46,
      pos: { x: -2.7, y: 0, z: -15.4 },
      type: 'plate1x6',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 47,
      pos: { x: -2.25, y: 0, z: -15.4 },
      type: 'plate1x8',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 48,
      pos: { x: -1.8, y: 0, z: -15.4 },
      type: 'plate2x8',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 49,
      pos: { x: -1.35, y: 0, z: -15.4 },
      type: 'plate8x8',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 50,
      pos: { x: -0.9, y: 0, z: -15.4 },
      type: 'roundplate1x1',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 51,
      pos: { x: -4.95, y: 0.42, z: -15.4 },
      type: 'tile1x4',
      colour: 'light-grey',
      small: true,
    },
    {
      id: 52,
      pos: { x: -4.5, y: 0.42, z: -15.4 },
      type: 'plate1x1',
      colour: 'dark-grey',
      small: true,
    },
    {
      id: 53,
      pos: { x: -4.05, y: 0.42, z: -15.4 },
      type: 'plate1x4',
      colour: 'dark-grey',
      small: true,
    },
    {
      id: 54,
      pos: { x: -3.6, y: 0.42, z: -15.4 },
      type: 'plate4x4',
      colour: 'dark-grey',
      small: true,
    },
    { id: 55, pos: { x: -3.15, y: 0.42, z: -15.4 }, type: '1x1', colour: 'white', small: true },
    { id: 56, pos: { x: -2.7, y: 0.42, z: -15.4 }, type: '1x3', colour: 'white', small: true },
    {
      id: 57,
      pos: { x: -2.25, y: 0.42, z: -15.4 },
      type: 'cheese1x1',
      colour: 'white',
      small: true,
    },
    {
      id: 58,
      pos: { x: -1.8, y: 0.42, z: -15.4 },
      type: 'headlight1x1',
      colour: 'white',
      small: true,
    },
    {
      id: 59,
      pos: { x: -1.35, y: 0.42, z: -15.4 },
      type: 'print-manga',
      colour: 'white',
      small: true,
    },
    { id: 60, pos: { x: -0.9, y: 0.42, z: -15.4 }, type: '1x2', colour: 'black', small: true },
    { id: 61, pos: { x: -4.95, y: 0.84, z: -15.4 }, type: '1x4', colour: 'black', small: true },
    {
      id: 62,
      pos: { x: -4.5, y: 0.84, z: -15.4 },
      type: 'cheese1x1',
      colour: 'black',
      small: true,
    },
    {
      id: 63,
      pos: { x: -4.05, y: 0.84, z: -15.4 },
      type: 'headlight1x1',
      colour: 'black',
      small: true,
    },
    {
      id: 64,
      pos: { x: -3.6, y: 0.84, z: -15.4 },
      type: 'print-catface',
      colour: 'black',
      small: true,
    },
    {
      id: 65,
      pos: { x: -3.15, y: 0.84, z: -15.4 },
      type: 'print-mangashop',
      colour: 'black',
      small: true,
    },
    {
      id: 66,
      pos: { x: -2.7, y: 0.84, z: -15.4 },
      type: 'sidestuds1x2',
      colour: 'black',
      small: true,
    },
    {
      id: 67,
      pos: { x: -2.25, y: 0.84, z: -15.4 },
      type: 'slope1x2',
      colour: 'black',
      small: true,
    },
    { id: 68, pos: { x: -1.8, y: 0.84, z: -15.4 }, type: 'slope2x2', colour: 'black', small: true },
    {
      id: 69,
      pos: { x: -1.35, y: 0.84, z: -15.4 },
      type: 'slope2x3',
      colour: 'black',
      small: true,
    },
    { id: 70, pos: { x: -0.9, y: 0.84, z: -15.4 }, type: 'tile1x2', colour: 'black', small: true },
    { id: 71, pos: { x: -4.95, y: 1.26, z: -15.4 }, type: '1x1', colour: 'brown', small: true },
    { id: 72, pos: { x: -4.5, y: 1.26, z: -15.4 }, type: '1x2', colour: 'brown', small: true },
    { id: 73, pos: { x: -4.05, y: 1.26, z: -15.4 }, type: '1x2x2', colour: 'brown', small: true },
    { id: 74, pos: { x: -3.6, y: 1.26, z: -15.4 }, type: '1x3', colour: 'brown', small: true },
    {
      id: 75,
      pos: { x: -3.15, y: 1.26, z: -15.4 },
      type: 'curve1x2',
      colour: 'brown',
      small: true,
    },
    {
      id: 76,
      pos: { x: -2.7, y: 1.26, z: -15.4 },
      type: 'headlight1x1',
      colour: 'brown',
      small: true,
    },
    {
      id: 77,
      pos: { x: -2.25, y: 1.26, z: -15.4 },
      type: 'lattice1x2x2',
      colour: 'brown',
      small: true,
    },
    { id: 78, pos: { x: -1.8, y: 1.26, z: -15.4 }, type: 'plate1x1', colour: 'brown', small: true },
    {
      id: 79,
      pos: { x: -1.35, y: 1.26, z: -15.4 },
      type: 'plate1x2',
      colour: 'brown',
      small: true,
    },
    { id: 80, pos: { x: -0.9, y: 1.26, z: -15.4 }, type: 'plate1x3', colour: 'brown', small: true },
    { id: 81, pos: { x: 0.9, y: 0, z: -15.4 }, type: 'plate1x4', colour: 'brown', small: true },
    { id: 82, pos: { x: 1.35, y: 0, z: -15.4 }, type: 'plate1x6', colour: 'brown', small: true },
    { id: 83, pos: { x: 1.8, y: 0, z: -15.4 }, type: 'plate2x2', colour: 'brown', small: true },
    { id: 84, pos: { x: 2.25, y: 0, z: -15.4 }, type: 'plate2x3', colour: 'brown', small: true },
    { id: 85, pos: { x: 2.7, y: 0, z: -15.4 }, type: 'plate2x4', colour: 'brown', small: true },
    {
      id: 86,
      pos: { x: 3.15, y: 0, z: -15.4 },
      type: 'sidestuds1x2',
      colour: 'brown',
      small: true,
    },
    {
      id: 87,
      pos: { x: 3.6, y: 0, z: -15.4 },
      type: 'sidestuds1x2x2',
      colour: 'brown',
      small: true,
    },
    { id: 88, pos: { x: 4.05, y: 0, z: -15.4 }, type: 'slope1x2', colour: 'brown', small: true },
    { id: 89, pos: { x: 4.5, y: 0, z: -15.4 }, type: 'window1x2x2', colour: 'brown', small: true },
    {
      id: 90,
      pos: { x: 4.95, y: 0, z: -15.4 },
      type: 'tile1x1',
      colour: 'dark-brown',
      small: true,
    },
    {
      id: 91,
      pos: { x: 0.9, y: 0.42, z: -15.4 },
      type: 'lattice1x2x2',
      colour: 'tan',
      small: true,
    },
    { id: 92, pos: { x: 1.35, y: 0.42, z: -15.4 }, type: 'plate1x1', colour: 'tan', small: true },
    {
      id: 93,
      pos: { x: 1.8, y: 0.42, z: -15.4 },
      type: 'print-poster',
      colour: 'tan',
      small: true,
    },
    { id: 94, pos: { x: 2.25, y: 0.42, z: -15.4 }, type: 'tile1x1', colour: 'tan', small: true },
    { id: 95, pos: { x: 2.7, y: 0.42, z: -15.4 }, type: '1x4', colour: 'red', small: true },
    { id: 96, pos: { x: 3.15, y: 0.42, z: -15.4 }, type: 'plate1x4', colour: 'red', small: true },
    {
      id: 97,
      pos: { x: 3.6, y: 0.42, z: -15.4 },
      type: 'cheese1x1',
      colour: 'dark-red',
      small: true,
    },
    {
      id: 98,
      pos: { x: 4.05, y: 0.42, z: -15.4 },
      type: 'round1x1',
      colour: 'orange',
      small: true,
    },
    { id: 99, pos: { x: 4.5, y: 0.42, z: -15.4 }, type: 'tile1x1', colour: 'pink', small: true },
    {
      id: 100,
      pos: { x: 4.95, y: 0.42, z: -15.4 },
      type: 'print-billboard',
      colour: 'purple',
      small: true,
    },
    { id: 101, pos: { x: 0.9, y: 0.84, z: -15.4 }, type: 'cone1x1', colour: 'teal', small: true },
    { id: 102, pos: { x: 1.35, y: 0.84, z: -15.4 }, type: 'plate1x4', colour: 'teal', small: true },
    {
      id: 103,
      pos: { x: 1.8, y: 0.84, z: -15.4 },
      type: 'sidestuds1x4',
      colour: 'teal',
      small: true,
    },
    {
      id: 104,
      pos: { x: 2.25, y: 0.84, z: -15.4 },
      type: 'roundtile1x1',
      colour: 'sand-green',
      small: true,
    },
    { id: 105, pos: { x: 2.7, y: 0.84, z: -15.4 }, type: 'plant1x1', colour: 'green', small: true },
    { id: 106, pos: { x: 3.15, y: 0.84, z: -15.4 }, type: 'cone1x1', colour: 'gold', small: true },
    {
      id: 107,
      pos: { x: 3.6, y: 0.84, z: -15.4 },
      type: 'roundtile1x1',
      colour: 'gold',
      small: true,
    },
    {
      id: 108,
      pos: { x: 4.05, y: 0.84, z: -15.4 },
      type: '1x1',
      colour: 'trans-clear',
      small: true,
    },
    {
      id: 109,
      pos: { x: 4.5, y: 0.84, z: -15.4 },
      type: 'cheese1x1',
      colour: 'trans-clear',
      small: true,
    },
    {
      id: 110,
      pos: { x: 4.95, y: 0.84, z: -15.4 },
      type: 'print-neon',
      colour: 'trans-clear',
      small: true,
    },
    {
      id: 111,
      pos: { x: 0.9, y: 1.26, z: -15.4 },
      type: 'roundplate1x1',
      colour: 'trans-clear',
      small: true,
    },
    {
      id: 112,
      pos: { x: 1.35, y: 1.26, z: -15.4 },
      type: 'tile1x2',
      colour: 'trans-light-blue',
      small: true,
    },
    {
      id: 113,
      pos: { x: 1.8, y: 1.26, z: -15.4 },
      type: 'cheese1x1',
      colour: 'trans-blue',
      small: true,
    },
    {
      id: 114,
      pos: { x: 2.25, y: 1.26, z: -15.4 },
      type: 'round1x1',
      colour: 'trans-red',
      small: true,
    },
    {
      id: 115,
      pos: { x: 2.7, y: 1.26, z: -15.4 },
      type: 'roundplate1x1',
      colour: 'trans-red',
      small: true,
    },
    {
      id: 116,
      pos: { x: 3.15, y: 1.26, z: -15.4 },
      type: '1x4',
      colour: 'trans-orange',
      small: true,
    },
    {
      id: 117,
      pos: { x: 3.6, y: 1.26, z: -15.4 },
      type: 'cheese1x1',
      colour: 'trans-orange',
      small: true,
    },
    {
      id: 118,
      pos: { x: 4.05, y: 1.26, z: -15.4 },
      type: 'grille1x2',
      colour: 'trans-orange',
      small: true,
    },
    {
      id: 119,
      pos: { x: 4.5, y: 1.26, z: -15.4 },
      type: 'cone1x1',
      colour: 'trans-black',
      small: true,
    },
    {
      id: 120,
      pos: { x: 4.95, y: 1.26, z: -15.4 },
      type: 'roundplate2x2',
      colour: 'light-grey',
      small: true,
    },
  ],
};
