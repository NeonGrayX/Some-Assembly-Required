/**
 * Brick catalogue and world-scale constants.
 *
 * Grid coordinates: x and z count studs, y counts plates (a full brick is 3 plates tall).
 * Bricks are scaled up compared to real ones so they are easy to grab: a 2x4 brick is
 * roughly shoebox-sized next to a character.
 */

/** World size of one stud pitch, in metres. */
export const STUD = 0.1;
/** World height of one plate, in metres. */
export const PLATE_H = 0.04;
/** Plates per full-height brick. */
export const BRICK_PLATES = 3;

export type BrickTypeId =
  | '1x1'
  | '1x2'
  | '1x3'
  | '1x4'
  | '1x6'
  | '2x2'
  | '2x3'
  | '2x4'
  | 'plate1x1'
  | 'plate1x2'
  | 'plate1x3'
  | 'plate1x4'
  | 'plate1x6'
  | 'plate1x8'
  | 'plate2x2'
  | 'plate2x3'
  | 'plate2x4'
  | 'plate2x6'
  | 'plate2x8'
  | 'plate4x4'
  | 'plate8x8'
  | SpecialTypeId
  | 'baseplate16';

/** Parts that are not plain bricks or plates: tiles, slopes, rounds, windows, side studs, prints. */
export type SpecialTypeId =
  | '1x2x2'
  | 'tile1x1'
  | 'tile1x2'
  | 'tile1x3'
  | 'tile1x4'
  | 'tile1x6'
  | 'tile2x2'
  | 'tile2x4'
  | 'grille1x2'
  | 'roundtile1x1'
  | 'roundtile2x2'
  | 'roundplate1x1'
  | 'round1x1'
  | 'roundplate2x2'
  | 'round2x2'
  | 'roundcorner3x3'
  | 'arc3x3'
  | 'dish2x2'
  | 'cone1x1'
  | 'slope1x2'
  | 'slope2x2'
  | 'slope2x3'
  | 'cheese1x1'
  | 'curve1x2'
  | 'window1x2x2'
  | 'lattice1x2x2'
  | 'headlight1x1'
  | 'sidestuds1x2'
  | 'sidestuds1x4'
  | 'sidestuds1x2x2'
  | 'bracket1x1'
  | 'bracket1x2'
  | 'bracket2x4'
  | 'plant1x1'
  | 'flower2x2'
  | 'spire2x2';

/**
 * Which way a part points. Upright parts (no face) have their studs up; a part with a face is
 * clipped sideways onto side studs, its studs pointing along that axis.
 */
export type Facing = '+x' | '-x' | '+z' | '-z';

/** How a part is drawn. Every shape fills its grid cells' footprint. */
export type Shape =
  | 'box'
  | 'tile'
  | 'grille'
  | 'slope'
  | 'cheese'
  | 'curve'
  | 'round'
  | 'cone'
  | 'dish'
  | 'window'
  | 'plant'
  | 'quarter'
  | 'flower'
  | 'spire';

/** A stud on a part's side, in the part's own frame at rotation 0. */
export interface SideStud {
  /** The cell it sits on. */
  x: number;
  z: number;
  /** The way it points. */
  dir: Facing;
  /** Height of its centre above the part's bottom, in plates. Brackets point below it. */
  y: number;
}

export interface BrickType {
  id: BrickTypeId;
  /** Footprint along local x at rotation 0, in studs. */
  studsX: number;
  /** Footprint along local z at rotation 0, in studs. */
  studsZ: number;
  /** Height in plates. */
  plates: number;
  /** Types that are easy to mistake for this one (used for forgeries and "close" matches). */
  nearMiss: BrickTypeId[];
  /** Bins never hand these out (for example baseplates). */
  fixture?: boolean;
  /** How it is drawn; a plain box with studs if left out. */
  shape?: Shape;
  /**
   * Which top cells carry studs: every one (the default), none, only the back row (z = 0), or
   * those inside the quarter circle round the part's (0, 0) corner (round corner plates).
   */
  studs?: 'all' | 'none' | 'back' | 'corner';
  /** For a quarter shape: the radius of its hole round the (0, 0) corner, in studs (0 for none). */
  hole?: number;
  /** Studs on its sides, that sideways parts clip onto. */
  sideStuds?: SideStud[];
  /** What fills a window frame. */
  pane?: 'glass' | 'lattice';
  /** Can be clipped sideways onto side studs (thin parts only). */
  mountable?: boolean;
  /** Its name in parts lists, without the colour ("1x2 tile"); worked out from the id if left out. */
  name?: string;
  /** Looks different when turned half way round (slopes, prints, side studs). */
  directional?: boolean;
}

const side = (x: number, z: number, y: number, dir: Facing = '+z'): SideStud => ({ x, z, y, dir });

/** Tiles, round tiles and prints: one plate, no studs, can be clipped sideways. */
const flat = (
  id: SpecialTypeId,
  studsX: number,
  studsZ: number,
  name: string,
  extra: Partial<BrickType> = {},
): BrickType => ({
  id,
  studsX,
  studsZ,
  plates: 1,
  nearMiss: [],
  shape: 'tile',
  studs: 'none',
  mountable: true,
  name,
  ...extra,
});

const SPECIAL_TYPES: Record<SpecialTypeId, BrickType> = {
  '1x2x2': { id: '1x2x2', studsX: 2, studsZ: 1, plates: 6, nearMiss: ['1x2'], name: '1x2x2 brick' },
  tile1x1: flat('tile1x1', 1, 1, '1x1 tile', { nearMiss: ['plate1x1'] }),
  tile1x2: flat('tile1x2', 2, 1, '1x2 tile', { nearMiss: ['plate1x2', 'grille1x2'] }),
  tile1x3: flat('tile1x3', 3, 1, '1x3 tile', { nearMiss: ['plate1x3'] }),
  tile1x4: flat('tile1x4', 4, 1, '1x4 tile', { nearMiss: ['plate1x4'] }),
  tile1x6: flat('tile1x6', 6, 1, '1x6 tile', { nearMiss: ['plate1x6'] }),
  tile2x2: flat('tile2x2', 2, 2, '2x2 tile', { nearMiss: ['plate2x2'] }),
  tile2x4: flat('tile2x4', 4, 2, '2x4 tile', { nearMiss: ['plate2x4'] }),
  grille1x2: flat('grille1x2', 2, 1, '1x2 grille tile', {
    shape: 'grille',
    nearMiss: ['tile1x2'],
  }),
  roundtile1x1: flat('roundtile1x1', 1, 1, '1x1 round tile', {
    shape: 'round',
    nearMiss: ['roundplate1x1'],
  }),
  roundtile2x2: flat('roundtile2x2', 2, 2, '2x2 round tile', {
    shape: 'round',
    nearMiss: ['roundplate2x2', 'tile2x2'],
  }),
  roundplate1x1: flat('roundplate1x1', 1, 1, '1x1 round plate', {
    shape: 'round',
    studs: 'all',
    nearMiss: ['roundtile1x1', 'plate1x1'],
  }),
  round1x1: {
    id: 'round1x1',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x1', 'cone1x1'],
    shape: 'round',
    name: '1x1 round brick',
  },
  roundplate2x2: flat('roundplate2x2', 2, 2, '2x2 round plate', {
    shape: 'round',
    studs: 'all',
    nearMiss: ['plate2x2'],
  }),
  round2x2: {
    id: 'round2x2',
    studsX: 2,
    studsZ: 2,
    plates: 3,
    nearMiss: ['2x2', 'roundplate2x2'],
    shape: 'round',
    name: '2x2 round brick',
  },
  // A quarter of a disc: its square corner at (0, 0), its curved edge toward +x and +z.
  roundcorner3x3: flat('roundcorner3x3', 3, 3, '3x3 round corner plate', {
    shape: 'quarter',
    studs: 'corner',
    mountable: false,
    directional: true,
    nearMiss: ['plate2x2', 'arc3x3'],
  }),
  // The same quarter with a hole round the corner: a curved band, smooth on top.
  arc3x3: flat('arc3x3', 3, 3, '3x3 quarter arc tile', {
    shape: 'quarter',
    hole: 2,
    mountable: false,
    directional: true,
    nearMiss: ['roundcorner3x3'],
  }),
  dish2x2: flat('dish2x2', 2, 2, '2x2 dish', { shape: 'dish', nearMiss: ['roundplate2x2'] }),
  cone1x1: {
    id: 'cone1x1',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['round1x1'],
    shape: 'cone',
    name: '1x1 cone',
  },
  slope1x2: {
    id: 'slope1x2',
    studsX: 1,
    studsZ: 2,
    plates: 3,
    nearMiss: ['curve1x2', '1x2'],
    shape: 'slope',
    studs: 'back',
    directional: true,
    name: '2x1 slope',
  },
  slope2x2: {
    id: 'slope2x2',
    studsX: 2,
    studsZ: 2,
    plates: 3,
    nearMiss: ['slope2x3', '2x2'],
    shape: 'slope',
    studs: 'back',
    directional: true,
    name: '2x2 slope',
  },
  slope2x3: {
    id: 'slope2x3',
    studsX: 2,
    studsZ: 3,
    plates: 3,
    nearMiss: ['slope2x2', '2x3'],
    shape: 'slope',
    studs: 'back',
    directional: true,
    name: '3x2 slope',
  },
  cheese1x1: {
    id: 'cheese1x1',
    studsX: 1,
    studsZ: 1,
    plates: 2,
    nearMiss: ['tile1x1'],
    shape: 'cheese',
    studs: 'none',
    mountable: true,
    directional: true,
    name: '1x1 cheese slope',
  },
  curve1x2: {
    id: 'curve1x2',
    studsX: 1,
    studsZ: 2,
    plates: 2,
    nearMiss: ['slope1x2'],
    shape: 'curve',
    studs: 'none',
    directional: true,
    name: '2x1 curved slope',
  },
  window1x2x2: {
    id: 'window1x2x2',
    studsX: 2,
    studsZ: 1,
    plates: 6,
    nearMiss: ['lattice1x2x2', '1x2x2'],
    shape: 'window',
    pane: 'glass',
    name: '1x2x2 window',
  },
  lattice1x2x2: {
    id: 'lattice1x2x2',
    studsX: 2,
    studsZ: 1,
    plates: 6,
    nearMiss: ['window1x2x2'],
    shape: 'window',
    pane: 'lattice',
    name: '1x2x2 lattice window',
  },
  headlight1x1: {
    id: 'headlight1x1',
    studsX: 1,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x1'],
    sideStuds: [side(0, 0, 1.5)],
    directional: true,
    name: '1x1 headlight brick',
  },
  sidestuds1x2: {
    id: 'sidestuds1x2',
    studsX: 2,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x2'],
    sideStuds: [side(0, 0, 1.5), side(1, 0, 1.5)],
    directional: true,
    name: '1x2 brick, studs on side',
  },
  sidestuds1x4: {
    id: 'sidestuds1x4',
    studsX: 4,
    studsZ: 1,
    plates: 3,
    nearMiss: ['1x4'],
    sideStuds: [0, 1, 2, 3].map((x) => side(x, 0, 1.5)),
    directional: true,
    name: '1x4 brick, studs on side',
  },
  sidestuds1x2x2: {
    id: 'sidestuds1x2x2',
    studsX: 2,
    studsZ: 1,
    plates: 6,
    nearMiss: ['1x2x2'],
    sideStuds: [side(0, 0, 1.25), side(1, 0, 1.25), side(0, 0, 3.75), side(1, 0, 3.75)],
    directional: true,
    name: '1x2x2 brick, studs on side',
  },
  bracket1x1: {
    id: 'bracket1x1',
    studsX: 1,
    studsZ: 1,
    plates: 1,
    nearMiss: ['plate1x1'],
    sideStuds: [side(0, 0, 1.25)],
    directional: true,
    name: '1x1 bracket',
  },
  bracket1x2: {
    id: 'bracket1x2',
    studsX: 2,
    studsZ: 1,
    plates: 1,
    nearMiss: ['plate1x2'],
    sideStuds: [side(0, 0, 1.25), side(1, 0, 1.25)],
    directional: true,
    name: '1x2 bracket',
  },
  // The sign holder: a 2x4 plate whose four side studs sit below it, so a tile hangs down.
  bracket2x4: {
    id: 'bracket2x4',
    studsX: 4,
    studsZ: 2,
    plates: 1,
    nearMiss: ['plate2x4'],
    sideStuds: [0, 1, 2, 3].map((x) => side(x, 1, -1.25)),
    directional: true,
    name: '2x4 inverted bracket',
  },
  plant1x1: {
    id: 'plant1x1',
    studsX: 1,
    studsZ: 1,
    plates: 2,
    nearMiss: [],
    shape: 'plant',
    studs: 'none',
    name: 'fern',
  },
  flower2x2: flat('flower2x2', 2, 2, '2x2 flower', {
    shape: 'flower',
    mountable: false,
    nearMiss: ['plant1x1', 'roundplate2x2'],
  }),
  // A thin mast with cross arms on a round foot, for the top of a tower.
  spire2x2: {
    id: 'spire2x2',
    studsX: 2,
    studsZ: 2,
    plates: 15,
    nearMiss: ['cone1x1'],
    shape: 'spire',
    studs: 'none',
    name: 'spire',
  },
};

export const BRICK_TYPES: Record<BrickTypeId, BrickType> = {
  '1x1': { id: '1x1', studsX: 1, studsZ: 1, plates: 3, nearMiss: ['1x2'] },
  '1x2': { id: '1x2', studsX: 2, studsZ: 1, plates: 3, nearMiss: ['1x1', 'plate1x2'] },
  '1x3': { id: '1x3', studsX: 3, studsZ: 1, plates: 3, nearMiss: ['1x2', '1x4'] },
  '1x4': { id: '1x4', studsX: 4, studsZ: 1, plates: 3, nearMiss: ['1x2'] },
  '1x6': { id: '1x6', studsX: 6, studsZ: 1, plates: 3, nearMiss: ['1x4'] },
  '2x2': { id: '2x2', studsX: 2, studsZ: 2, plates: 3, nearMiss: ['2x3', 'plate2x2'] },
  '2x3': { id: '2x3', studsX: 3, studsZ: 2, plates: 3, nearMiss: ['2x2', '2x4'] },
  '2x4': { id: '2x4', studsX: 4, studsZ: 2, plates: 3, nearMiss: ['2x3', 'plate2x4'] },
  plate1x1: { id: 'plate1x1', studsX: 1, studsZ: 1, plates: 1, nearMiss: ['1x1', 'plate1x2'] },
  plate1x2: { id: 'plate1x2', studsX: 2, studsZ: 1, plates: 1, nearMiss: ['1x2'] },
  plate1x3: { id: 'plate1x3', studsX: 3, studsZ: 1, plates: 1, nearMiss: ['plate1x2', 'plate1x4'] },
  plate1x4: { id: 'plate1x4', studsX: 4, studsZ: 1, plates: 1, nearMiss: ['1x4', 'plate1x3'] },
  plate1x6: { id: 'plate1x6', studsX: 6, studsZ: 1, plates: 1, nearMiss: ['plate1x4', 'plate1x8'] },
  plate1x8: { id: 'plate1x8', studsX: 8, studsZ: 1, plates: 1, nearMiss: ['plate1x6'] },
  plate2x2: { id: 'plate2x2', studsX: 2, studsZ: 2, plates: 1, nearMiss: ['2x2'] },
  plate2x3: { id: 'plate2x3', studsX: 3, studsZ: 2, plates: 1, nearMiss: ['2x3', 'plate2x2'] },
  plate2x4: { id: 'plate2x4', studsX: 4, studsZ: 2, plates: 1, nearMiss: ['2x4'] },
  plate2x6: { id: 'plate2x6', studsX: 6, studsZ: 2, plates: 1, nearMiss: ['plate2x4', 'plate2x8'] },
  plate2x8: { id: 'plate2x8', studsX: 8, studsZ: 2, plates: 1, nearMiss: ['plate2x6'] },
  plate4x4: { id: 'plate4x4', studsX: 4, studsZ: 4, plates: 1, nearMiss: ['plate2x4'] },
  plate8x8: { id: 'plate8x8', studsX: 8, studsZ: 8, plates: 1, nearMiss: ['plate4x4'] },
  baseplate16: {
    id: 'baseplate16',
    studsX: 16,
    studsZ: 16,
    plates: 1,
    nearMiss: [],
    fixture: true,
  },
  ...SPECIAL_TYPES,
};

/** Whether a placement turned `a` and one turned `b` look the same. */
export function sameTurn(type: BrickTypeId, a: Rotation, b: Rotation): boolean {
  const t = BRICK_TYPES[type];
  if (t.directional) return a === b;
  if (t.studsX === t.studsZ) return true;
  return a % 2 === b % 2;
}

/** Top cells (in the part's own frame at rotation 0) that carry studs. */
export function hasTopStud(type: BrickTypeId, x: number, z: number): boolean {
  const t = BRICK_TYPES[type];
  const studs = t.studs ?? 'all';
  if (studs === 'corner') return (x + 0.5) ** 2 + (z + 0.5) ** 2 <= t.studsX ** 2;
  return studs === 'all' || (studs === 'back' && z === 0);
}

export type ColourId =
  | 'white'
  | 'light-grey'
  | 'dark-grey'
  | 'black'
  | 'red'
  | 'dark-red'
  | 'yellow'
  | 'orange'
  | 'blue'
  | 'dark-blue'
  | 'green'
  | 'gold'
  | 'dark-brown'
  | 'sand-green'
  | 'trans-clear'
  | 'trans-light-blue'
  | 'trans-blue'
  | 'trans-red'
  | 'trans-orange'
  | 'trans-black'
  | 'brown'
  | 'tan'
  | 'teal'
  | 'pink'
  | 'purple'
  | 'light-blue'
  | 'lime'
  | 'trans-green'
  | 'baseplate-green';

export interface Colour {
  id: ColourId;
  hex: number;
  nearMiss: ColourId[];
  /** How opaque a see-through colour is drawn; solid colours leave it out. */
  alpha?: number;
}

export const COLOURS: Record<ColourId, Colour> = {
  white: { id: 'white', hex: 0xf4f4f0, nearMiss: ['light-grey'] },
  'light-grey': { id: 'light-grey', hex: 0xa3a6a8, nearMiss: ['dark-grey', 'white'] },
  'dark-grey': { id: 'dark-grey', hex: 0x5c5f62, nearMiss: ['light-grey', 'black'] },
  black: { id: 'black', hex: 0x232527, nearMiss: ['dark-grey'] },
  red: { id: 'red', hex: 0xc91a1a, nearMiss: ['dark-red', 'orange'] },
  'dark-red': { id: 'dark-red', hex: 0x7b1a1a, nearMiss: ['red'] },
  yellow: { id: 'yellow', hex: 0xf5c518, nearMiss: ['orange'] },
  orange: { id: 'orange', hex: 0xf07d1a, nearMiss: ['yellow', 'red'] },
  blue: { id: 'blue', hex: 0x1e5bc6, nearMiss: ['dark-blue'] },
  'dark-blue': { id: 'dark-blue', hex: 0x15305e, nearMiss: ['blue'] },
  green: { id: 'green', hex: 0x2c9a3a, nearMiss: ['baseplate-green'] },
  brown: { id: 'brown', hex: 0x6b3a24, nearMiss: ['dark-red', 'orange'] },
  tan: { id: 'tan', hex: 0xdcc391, nearMiss: ['yellow', 'white'] },
  teal: { id: 'teal', hex: 0x138a8a, nearMiss: ['green', 'blue'] },
  pink: { id: 'pink', hex: 0xd2589a, nearMiss: ['red', 'purple'] },
  purple: { id: 'purple', hex: 0x5c3a9e, nearMiss: ['dark-blue', 'pink'] },
  'light-blue': { id: 'light-blue', hex: 0x9fd2ea, nearMiss: ['blue', 'white'] },
  lime: { id: 'lime', hex: 0x9cb83a, nearMiss: ['green', 'yellow'] },
  gold: { id: 'gold', hex: 0xc9a23a, nearMiss: ['yellow', 'tan'] },
  'dark-brown': { id: 'dark-brown', hex: 0x3b2418, nearMiss: ['brown', 'black'] },
  'sand-green': { id: 'sand-green', hex: 0x7a9e86, nearMiss: ['teal', 'light-grey'] },
  'trans-clear': { id: 'trans-clear', hex: 0xe8f1f4, nearMiss: ['trans-light-blue'], alpha: 0.35 },
  'trans-light-blue': {
    id: 'trans-light-blue',
    hex: 0x9fdcef,
    nearMiss: ['trans-clear', 'trans-blue'],
    alpha: 0.5,
  },
  'trans-blue': { id: 'trans-blue', hex: 0x2f6fd0, nearMiss: ['trans-light-blue'], alpha: 0.6 },
  'trans-red': { id: 'trans-red', hex: 0xd0202a, nearMiss: ['trans-orange'], alpha: 0.6 },
  'trans-orange': { id: 'trans-orange', hex: 0xf28a1e, nearMiss: ['trans-red'], alpha: 0.6 },
  'trans-black': { id: 'trans-black', hex: 0x4a4740, nearMiss: ['trans-clear'], alpha: 0.6 },
  'trans-green': {
    id: 'trans-green',
    hex: 0x5fd06a,
    nearMiss: ['trans-light-blue', 'trans-clear'],
    alpha: 0.55,
  },
  'baseplate-green': { id: 'baseplate-green', hex: 0x3f8a3a, nearMiss: ['green'] },
};

/** Quarter turns around the vertical axis. */
export type Rotation = 0 | 1 | 2 | 3;

/** Footprint in grid studs after rotation. */
export function footprint(type: BrickTypeId, rot: Rotation): { w: number; d: number } {
  const t = BRICK_TYPES[type];
  return rot % 2 === 0 ? { w: t.studsX, d: t.studsZ } : { w: t.studsZ, d: t.studsX };
}

/** World-space size of a brick's body (without studs) at rotation 0, in metres. */
export function brickSize(type: BrickTypeId): { x: number; y: number; z: number } {
  const t = BRICK_TYPES[type];
  return { x: t.studsX * STUD, y: t.plates * PLATE_H, z: t.studsZ * STUD };
}
