import type { BrickTypeId, ColourId } from '../bricks.ts';
import type { Vec3 } from '../math.ts';

/** A static, axis-aligned box (walls, tables, crates). `pos` is the box centre. */
export interface BoxDef {
  pos: Vec3;
  size: Vec3;
  colour: number;
  /** Tilt around the x axis in radians, for ramps. */
  tiltX?: number;
}

/** A bin that hands out bricks of one type and colour. `pos` is the centre of its base. */
export interface BinDef {
  id: number;
  pos: Vec3;
  type: BrickTypeId;
  colour: ColourId;
}

export interface LevelDef {
  /** Side length of the square floor, in metres. */
  floorSize: number;
  boxes: BoxDef[];
  bins: BinDef[];
  /** World position of the job-site baseplate's minimum corner. */
  baseplate: Vec3;
  /** Quality inspector pad: centre on the floor and size. A build resting on it is scanned. */
  inspector: { pos: Vec3; size: { x: number; z: number } };
  /** Base of the "Done" button pedestal next to the job site. */
  doneButton: Vec3;
  /** Surfaces where instruction pages can be hidden. */
  pageSpots: Vec3[];
  spawn: Vec3;
}

export const BIN_SIZE = { x: 0.8, y: 0.6, z: 0.8 };
export const BUTTON_SIZE = { x: 0.4, y: 0.9, z: 0.4 };

const WALL = 0xd8cfc0;
const WOOD = 0x9a6b43;

/** The test yard: job site in the middle, bins around it, inspector behind the short wall. */
export const SANDBOX: LevelDef = {
  floorSize: 24,
  baseplate: { x: -0.8, y: 0, z: -0.8 },
  spawn: { x: 0, y: 1, z: 3.5 },
  boxes: [
    // Perimeter walls.
    { pos: { x: 0, y: 1, z: -12 }, size: { x: 24, y: 2, z: 0.3 }, colour: WALL },
    { pos: { x: 0, y: 1, z: 12 }, size: { x: 24, y: 2, z: 0.3 }, colour: WALL },
    { pos: { x: -12, y: 1, z: 0 }, size: { x: 0.3, y: 2, z: 24 }, colour: WALL },
    { pos: { x: 12, y: 1, z: 0 }, size: { x: 0.3, y: 2, z: 24 }, colour: WALL },
    // A short wall to bump carried builds into.
    { pos: { x: -6, y: 0.75, z: 2 }, size: { x: 0.3, y: 1.5, z: 4 }, colour: WALL },
    // Table and crates.
    { pos: { x: 5, y: 0.4, z: -5 }, size: { x: 2, y: 0.8, z: 1.2 }, colour: WOOD },
    { pos: { x: -5, y: 0.3, z: -6 }, size: { x: 0.6, y: 0.6, z: 0.6 }, colour: WOOD },
    { pos: { x: -4.2, y: 0.3, z: -6.3 }, size: { x: 0.6, y: 0.6, z: 0.6 }, colour: WOOD },
    // Ramp up to a ledge.
    { pos: { x: 7, y: 0.5, z: 5 }, size: { x: 2, y: 0.2, z: 4 }, colour: WOOD, tiltX: 0.26 },
    { pos: { x: 7, y: 0.5, z: 8.5 }, size: { x: 2, y: 1, z: 3 }, colour: WOOD },
  ],
  inspector: { pos: { x: -9, y: 0, z: 4 }, size: { x: 2.4, z: 2.4 } },
  doneButton: { x: -1.8, y: 0, z: 1.4 },
  pageSpots: [
    { x: 5.6, y: 0.8, z: -4.7 }, // on the table
    { x: -5, y: 0.6, z: -6 }, // on the crates
    { x: -4.2, y: 0.6, z: -6.3 },
    { x: 6.4, y: 1, z: 7.6 }, // up on the ledge
    { x: -10.5, y: 0, z: -10.5 }, // corners
    { x: 10.5, y: 0, z: -10.5 },
    { x: -10.5, y: 0, z: 10.5 },
    { x: 10.5, y: 0, z: 10.5 },
    { x: -6.6, y: 0, z: 3 }, // behind the short wall
    { x: -10.5, y: 0, z: 0 },
    { x: 8.4, y: 0, z: 3.6 }, // next to the ramp
    { x: 0, y: 0, z: 10.5 },
    { x: -2, y: 0, z: 8 },
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
    { id: 9, pos: { x: 5, y: 0.8, z: -5 }, type: '1x1', colour: 'dark-grey' }, // on the table
    // The rare one, tucked away on the ledge.
    { id: 10, pos: { x: 7, y: 1, z: 9 }, type: '1x1', colour: 'black' },
    // Look-alikes, so a wrong brick is easy to grab by mistake (or on purpose).
    { id: 11, pos: { x: -5, y: 0, z: -2.6 }, type: '2x4', colour: 'dark-red' },
    { id: 12, pos: { x: 5, y: 0, z: 0.6 }, type: '2x4', colour: 'light-grey' },
    { id: 13, pos: { x: -5, y: 0, z: 0.6 }, type: '2x3', colour: 'red' },
    { id: 14, pos: { x: 4.4, y: 0, z: 2.6 }, type: '2x2', colour: 'orange' },
  ],
};
