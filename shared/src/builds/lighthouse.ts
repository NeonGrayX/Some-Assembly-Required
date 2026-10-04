import type { ColourId, Rotation } from '../bricks.ts';
import type { TargetBrick, TargetBuild } from './types.ts';

const b = (
  type: TargetBrick['type'],
  colour: ColourId,
  x: number,
  y: number,
  z: number,
  rot: Rotation = 0,
): TargetBrick => ({ type, colour, x, y, z, rot });

/** Two 2x4 bricks covering the 4x4 tower footprint, turned a quarter on odd layers. */
const towerLayer = (y: number, colour: ColourId, turned: boolean): TargetBrick[] =>
  turned
    ? [b('2x4', colour, 6, y, 6, 1), b('2x4', colour, 8, y, 6, 1)]
    : [b('2x4', colour, 6, y, 6), b('2x4', colour, 6, y, 8)];

/** Four bricks laid as a pinwheel around a 2x2 hole, covering a 6x6 square from (5, 5). */
const pinwheel = (type: '2x4' | 'plate2x4', colour: ColourId, y: number): TargetBrick[] => [
  b(type, colour, 5, y, 5, 0),
  b(type, colour, 9, y, 5, 1),
  b(type, colour, 7, y, 9, 0),
  b(type, colour, 5, y, 7, 1),
];

/**
 * The MVP build: a striped lighthouse, 32 bricks in 8 steps. Layers are 3 plates tall and
 * alternate direction so every layer clutches the one below with 2x2 overlaps.
 */
export const LIGHTHOUSE: TargetBuild = {
  id: 'lighthouse',
  name: 'Lighthouse',
  steps: [
    { bricks: [...pinwheel('2x4', 'dark-grey', 1), b('2x2', 'light-grey', 7, 1, 7)] },
    {
      bricks: [
        b('plate2x4', 'light-grey', 7, 1, 11, 1),
        ...towerLayer(4, 'red', false),
        ...towerLayer(7, 'red', true),
      ],
    },
    { bricks: [...towerLayer(10, 'white', false), ...towerLayer(13, 'white', true)] },
    { bricks: [...towerLayer(16, 'red', false), ...towerLayer(19, 'red', true)] },
    { bricks: [...pinwheel('plate2x4', 'light-grey', 22), b('plate2x2', 'light-grey', 7, 22, 7)] },
    {
      bricks: [
        b('2x2', 'yellow', 7, 23, 7),
        b('1x1', 'black', 6, 23, 6),
        b('1x1', 'black', 9, 23, 6),
        b('1x1', 'black', 6, 23, 9),
        b('1x1', 'black', 9, 23, 9),
      ],
    },
    { bricks: towerLayer(26, 'red', false) },
    { bricks: [b('2x2', 'red', 7, 29, 7), b('1x1', 'dark-grey', 7, 32, 7)] },
  ],
};
