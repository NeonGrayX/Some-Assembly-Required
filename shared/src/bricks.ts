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
  | 'baseplate16';

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
}

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
};

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
  | 'brown'
  | 'tan'
  | 'teal'
  | 'pink'
  | 'purple'
  | 'light-blue'
  | 'baseplate-green';

export interface Colour {
  id: ColourId;
  hex: number;
  nearMiss: ColourId[];
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
