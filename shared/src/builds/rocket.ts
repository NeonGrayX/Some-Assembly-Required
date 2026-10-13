import type { TargetBrick, TargetBuild } from './types.ts';
import { b } from './kit.ts';

/** A thin part clipped sideways onto the side studs of a part placed earlier. */
const side = (
  type: TargetBrick['type'],
  colour: TargetBrick['colour'],
  x: number,
  y: number,
  z: number,
  face: NonNullable<TargetBrick['face']>,
): TargetBrick => ({ type, colour, x, y, z, rot: 0, face });

/** A layer of the 4x4 body from (6, 6): two 2x4 bricks, turned a quarter when `turned`. */
const body = (y: number, colour: TargetBrick['colour'], turned: boolean): TargetBrick[] =>
  turned
    ? [b('2x4', colour, 6, y, 6, 1), b('2x4', colour, 8, y, 6, 1)]
    : [b('2x4', colour, 6, y, 6), b('2x4', colour, 6, y, 8)];

/** One storey of the orange lattice service tower on (2, 6), 2x2 studs. */
const tower = (y: number, turned: boolean): TargetBrick[] =>
  turned
    ? [b('lattice1x2x2', 'orange', 2, y, 6, 1), b('lattice1x2x2', 'orange', 3, y, 6, 1)]
    : [b('lattice1x2x2', 'orange', 2, y, 6), b('lattice1x2x2', 'orange', 2, y, 7)];

const pages: { note: string; view?: { turn?: number; zoom?: number }; bricks: TargetBrick[] }[] = [
  {
    note: 'The launch pad, hazard stripes, the tower footing.',
    view: { zoom: 1.4 },
    bricks: [
      b('plate8x8', 'light-grey', 4, 1, 4),
      b('plate2x4', 'dark-grey', 2, 1, 5, 1),
      b('plate1x4', 'yellow', 8, 2, 11),
      b('plate1x4', 'yellow', 11, 2, 4, 1),
    ],
  },
  {
    note: 'Engine flames: see-through red and orange.',
    view: { zoom: 1.4 },
    bricks: [
      b('round1x1', 'trans-red', 7, 2, 7),
      b('round1x1', 'trans-red', 8, 2, 7),
      b('round1x1', 'trans-red', 7, 2, 8),
      b('round1x1', 'trans-red', 8, 2, 8),
      b('cheese1x1', 'trans-orange', 7, 2, 10, 0),
      b('cheese1x1', 'trans-orange', 8, 2, 10, 0),
      b('cheese1x1', 'trans-orange', 10, 2, 7, 1),
      b('cheese1x1', 'trans-orange', 10, 2, 8, 1),
    ],
  },
  {
    note: 'Flames out the back, a fuel tank, a radar post.',
    view: { turn: 2, zoom: 1.2 },
    bricks: [
      b('cheese1x1', 'trans-orange', 5, 2, 7, 3),
      b('cheese1x1', 'trans-orange', 5, 2, 8, 3),
      b('cheese1x1', 'trans-orange', 7, 2, 5, 2),
      b('cheese1x1', 'trans-orange', 8, 2, 5, 2),
      b('round1x1', 'white', 4, 2, 10),
      b('round2x2', 'white', 4, 2, 4),
      b('round2x2', 'white', 4, 5, 4),
      b('roundtile2x2', 'black', 4, 8, 4),
    ],
  },
  {
    note: 'The white body sits on the flames.',
    view: { zoom: 1.3 },
    bricks: [
      ...body(5, 'white', false),
      b('1x2', 'red', 4, 2, 6),
      b('1x2', 'red', 6, 2, 10, 1),
      b('1x2', 'red', 10, 2, 9),
      b('1x2', 'red', 9, 2, 4, 1),
    ],
  },
  {
    note: 'Slopes finish the four red fins.',
    view: { zoom: 1.3 },
    bricks: [
      b('slope1x2', 'red', 4, 5, 6, 3),
      b('slope1x2', 'red', 6, 5, 10, 0),
      b('slope1x2', 'red', 10, 5, 9, 1),
      b('slope1x2', 'red', 9, 5, 4, 2),
      b('dish2x2', 'light-grey', 3.5, 5, 9.5),
    ],
  },
  {
    note: 'A red stripe, then a porthole on the front.',
    view: { zoom: 1.2 },
    bricks: [
      ...body(8, 'red', true),
      b('2x4', 'white', 6, 11, 6),
      b('2x2', 'white', 6, 11, 8),
      b('1x1', 'white', 8, 11, 8),
      b('1x2', 'white', 9, 11, 8, 1),
      b('headlight1x1', 'white', 8, 11, 9),
      side('roundtile1x1', 'black', 8, 11.5, 9.8, '+z'),
    ],
  },
  {
    note: 'A white layer, then a porthole on the side.',
    bricks: [
      ...body(14, 'white', true),
      b('2x4', 'white', 6, 17, 6, 1),
      b('1x2', 'white', 8, 17, 6),
      b('1x1', 'white', 8, 17, 7),
      b('headlight1x1', 'white', 9, 17, 7, 1),
      b('2x2', 'white', 8, 17, 8),
      side('roundtile1x1', 'black', 9.8, 17.5, 7, '+x'),
    ],
  },
  {
    note: 'The top red stripe and two white layers.',
    bricks: [...body(20, 'red', false), ...body(23, 'white', true), ...body(26, 'white', false)],
  },
  {
    note: 'Lattice for the service tower.',
    view: { turn: 1 },
    bricks: [...tower(2, false), ...tower(8, true)],
  },
  {
    note: 'Two more storeys of lattice.',
    view: { turn: 1 },
    bricks: [...tower(14, false), ...tower(20, true)],
  },
  {
    note: 'The access arm and a red beacon.',
    view: { turn: 1 },
    bricks: [
      b('plate1x4', 'light-grey', 2, 26, 7),
      b('plate1x2', 'light-grey', 2, 26, 6),
      b('round1x1', 'trans-red', 2, 27, 6),
    ],
  },
  {
    note: 'Four red slopes make the nose.',
    bricks: [
      b('slope2x2', 'red', 8, 29, 8, 0),
      b('slope2x2', 'red', 6, 29, 8, 3),
      b('slope2x2', 'red', 6, 29, 6, 2),
      b('slope2x2', 'red', 8, 29, 6, 1),
    ],
  },
  {
    note: 'The tip of the nose and a gold cone.',
    bricks: [b('2x2', 'red', 7, 32, 7), b('cone1x1', 'gold', 7.5, 35, 7.5)],
  },
];

/**
 * A rocket lifting off its launch pad, 70 parts in 13 pages: a white body with red stripes
 * and two portholes, four sloped red fins, see-through flames under it and a red nose with a
 * gold tip. Beside it stand an orange lattice service tower with an arm and beacon, a radar
 * dish and a fuel tank.
 */
export const ROCKET: TargetBuild = {
  id: 'rocket',
  name: 'Rocket',
  steps: pages.map((p) => ({ bricks: p.bricks })),
  pages: pages.map(({ note, view }) => (view ? { note, view } : { note })),
};
