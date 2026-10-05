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
  'table' | 'counter' | 'sofa' | 'sofaBack' | 'bookshelf' | 'crate' | 'lampPost';

/** A coloured patch drawn on the floor, with no collision (room floors). */
export interface DecalDef {
  pos: Vec3;
  size: { x: number; z: number };
  colour: number;
}

/** A bin that hands out bricks of one type and colour. `pos` is the centre of its base. */
export interface BinDef {
  id: number;
  pos: Vec3;
  type: BrickTypeId;
  colour: ColourId;
  /** Rare bins only hold what a round needs, plus one spare. */
  rare?: boolean;
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

/** A climbable ladder. `pos` is the centre of its foot; climbers go straight up. */
export interface LadderDef {
  pos: Vec3;
  width: number;
  /** Height up to which a climber's centre keeps climbing. */
  height: number;
  facing: number;
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
  /** Corkboard for pinning pages where everyone can see them: centre of its face. */
  board: { pos: Vec3; facing: number };
  /** Open surfaces where instruction pages can lie. */
  pageSpots: Vec3[];
  /** Closed hiding places for pages. */
  hideouts: HideoutDef[];
  ladders: LadderDef[];
  /** Where players stand during a Brick Meeting. */
  meetingSeats: Vec3[];
  /** Where ceiling lamps hang inside: the glowing underside of each shade. */
  lights: Vec3[];
  spawn: Vec3;
  dog: DogDef;
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
export const BUTTON_SIZE = { x: 0.4, y: 0.9, z: 0.4 };
export const BOARD_SIZE = { x: 1.7, y: 1.1, z: 0.06 };
export const BOARD_SLOTS = 8;

const FENCE = 0xd8cfc0;
const WALL = 0xece4d4;
const WOOD = 0x9a6b43;
const DARK_WOOD = 0x6b4a2f;
const ROOF = 0x8c4b3a;
const LAMP_POST = 0x2f3336;
const SOFA = 0x4f6d8f;
const HEIGHT = 2.6;
const T = 0.2;
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
  { pos: { x: -6.5, y: HEIGHT / 2, z: 6 }, size: { x: 11, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: 6.5, y: HEIGHT / 2, z: 6 }, size: { x: 11, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: 0, y: HEIGHT / 2, z: 15 }, size: { x: 24.2, y: HEIGHT, z: T }, colour: WALL },
  { pos: { x: -12, y: HEIGHT / 2, z: 10.5 }, size: { x: T, y: HEIGHT, z: 9 }, colour: WALL },
  { pos: { x: 12, y: HEIGHT / 2, z: 10.5 }, size: { x: T, y: HEIGHT, z: 9 }, colour: WALL },
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
  // Flat roof you can walk on (reach it by the ladder on the south wall).
  { pos: { x: 0, y: HEIGHT + 0.1, z: 10.5 }, size: { x: 24.2, y: 0.2, z: 9.2 }, colour: ROOF },
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
    // Ramp up to a ledge in the east of the yard.
    { pos: { x: 13.5, y: 0.5, z: -4 }, size: { x: 2, y: 0.2, z: 4 }, colour: WOOD, tiltX: 0.26 },
    { pos: { x: 13.5, y: 0.5, z: -7.5 }, size: { x: 2, y: 1, z: 3 }, colour: WOOD },
    // Mailbox post.
    { pos: { x: 2.4, y: 0.375, z: 4.8 }, size: { x: 0.08, y: 0.75, z: 0.08 }, colour: DARK_WOOD },
    ...gardenLamps,
    ...houseWalls,
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
      pos: { x: 0, y: 0.35, z: 14.3 },
      size: { x: 3, y: 0.7, z: 0.9 },
      colour: SOFA,
      model: 'sofa',
    },
    {
      pos: { x: 0, y: 0.75, z: 14.75 },
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
  ],
  decals: [
    { pos: { x: -8, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xc8c2b4 },
    { pos: { x: 0, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0xa47a52 },
    { pos: { x: 8, y: 0, z: 10.5 }, size: { x: 7.8, z: 8.8 }, colour: 0x8e9aa6 },
  ],
  inspector: { pos: { x: -12, y: 0, z: -4 }, size: { x: 2.4, z: 2.4 } },
  doneButton: { x: -1.8, y: 0, z: 1.4 },
  bell: { x: 1.8, y: 0, z: 1.4 },
  board: { pos: { x: -4, y: 1.3, z: 3.2 }, facing: Math.PI },
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
    { x: -8, y: HEIGHT + 0.2, z: 10 }, // on the roof
    { x: 8, y: HEIGHT + 0.2, z: 12.5 },
    { x: -8, y: 0.8, z: 9.5 }, // kitchen table
    { x: 3.2, y: 2, z: 14.65 }, // top of the bookshelf
    { x: 8.6, y: 0.8, z: 10.3 }, // break room table
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
      pos: { x: 0.7, y: 0.75, z: 14.2 },
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
      pos: { x: 6, y: 0.01, z: 7.5 },
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
  ],
  bins: [
    // Everything the lighthouse needs.
    { id: 1, pos: { x: -3, y: 0, z: -3 }, type: '2x4', colour: 'red' },
    { id: 2, pos: { x: -1.5, y: 0, z: -3.8 }, type: '2x4', colour: 'white' },
    { id: 3, pos: { x: 0, y: 0, z: -4 }, type: '2x4', colour: 'dark-grey' },
    { id: 4, pos: { x: 1.5, y: 0, z: -3.8 }, type: '2x2', colour: 'light-grey', rare: true },
    { id: 5, pos: { x: 3, y: 0, z: -3 }, type: 'plate2x4', colour: 'light-grey' },
    { id: 6, pos: { x: 3.6, y: 0, z: -1.2 }, type: 'plate2x2', colour: 'light-grey', rare: true },
    { id: 7, pos: { x: -3.6, y: 0, z: -1.2 }, type: '2x2', colour: 'yellow', rare: true },
    { id: 8, pos: { x: 5, y: 0, z: -2.6 }, type: '2x2', colour: 'red', rare: true },
    { id: 9, pos: { x: 5, y: 0.8, z: -5 }, type: '1x1', colour: 'dark-grey', rare: true },
    // The rarest one, up on the ledge.
    { id: 10, pos: { x: 13.5, y: 1, z: -8 }, type: '1x1', colour: 'black', rare: true },
    // Look-alikes, so a wrong brick is easy to grab by mistake (or on purpose).
    { id: 11, pos: { x: -5, y: 0, z: -2.6 }, type: '2x4', colour: 'dark-red' },
    { id: 12, pos: { x: 5, y: 0, z: 0.6 }, type: '2x4', colour: 'light-grey' },
    { id: 13, pos: { x: -5, y: 0, z: 0.6 }, type: '2x3', colour: 'red' },
    { id: 14, pos: { x: 4.4, y: 0, z: 2.6 }, type: '2x2', colour: 'orange', rare: true },
    // More look-alikes: each round's colour variant may need them.
    { id: 15, pos: { x: -6.5, y: 0, z: -4 }, type: '2x4', colour: 'black' },
    { id: 16, pos: { x: 6.5, y: 0, z: -0.5 }, type: '2x2', colour: 'dark-red', rare: true },
    { id: 17, pos: { x: -6.5, y: 0, z: -1.2 }, type: '2x2', colour: 'white', rare: true },
    { id: 18, pos: { x: 6.5, y: 0, z: -2.6 }, type: 'plate2x4', colour: 'dark-grey' },
    { id: 19, pos: { x: 3, y: 0, z: -6 }, type: 'plate2x2', colour: 'dark-grey', rare: true },
    { id: 20, pos: { x: -3, y: 0, z: -6 }, type: '2x4', colour: 'orange' },
  ],
};
