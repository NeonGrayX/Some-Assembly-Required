import type { TargetBrick, TargetBuild } from './types.ts';
import { b } from './kit.ts';

/** A part clipped sideways onto side studs placed earlier. */
const side = (
  type: TargetBrick['type'],
  colour: TargetBrick['colour'],
  x: number,
  y: number,
  z: number,
  face: NonNullable<TargetBrick['face']>,
  rot: TargetBrick['rot'] = 0,
): TargetBrick => ({ type, colour, x, y, z, rot, face });

const NUMBER =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><rect width='200' height='200' fill='#232527'/><circle cx='100' cy='100' r='78' fill='#f4f4f0'/><text x='100' y='106' font-family='Helvetica, Arial, sans-serif' font-weight='bold' font-size='120' fill='#c91a1a' text-anchor='middle' dominant-baseline='central'>7</text></svg>";

/**
 * A red open-wheel race car facing east on a strip of track, 71 parts on 13 pages: black round
 * tile wheels clipped onto side-stud bricks, sloped sidepods, a curved hood with a printed
 * number 7, a see-through windscreen, a white-helmeted driver, exhausts and a rear wing topped
 * with tiles. Round it: a red and white kerb, a start line, a start light, ferns and cones.
 */
export const RACE_CAR: TargetBuild = {
  id: 'race-car',
  name: 'Race Car',
  svgs: { number: NUMBER },
  steps: [
    [
      b('plate8x8', 'light-grey', 0, 1, 4),
      b('plate8x8', 'light-grey', 8, 1, 4),
      b('plate2x4', 'white', 0, 1, 12),
      b('plate1x4', 'red', 4, 1, 12),
      b('plate1x4', 'red', 4, 1, 13),
      b('plate2x4', 'white', 8, 1, 12),
      b('plate1x4', 'red', 12, 1, 12),
      b('plate1x4', 'red', 12, 1, 13),
      b('tile1x3', 'white', 1, 2, 4, 1),
      b('tile1x3', 'white', 1, 2, 9, 1),
    ],
    [
      b('1x1', 'black', 1, 1, 2),
      b('1x1', 'black', 1, 4, 2),
      b('headlight1x1', 'black', 1, 7, 2),
      side('roundplate1x1', 'trans-red', 1, 7.5, 2.8, '+z'),
      b('roundtile1x1', 'black', 1, 10, 2),
      b('flower2x2', 'yellow', 4, 1, 1),
      b('roundplate1x1', 'green', 7, 1, 2),
      b('plant1x1', 'green', 7, 2, 2),
      b('roundplate1x1', 'green', 8, 1, 1),
      b('plant1x1', 'green', 8, 2, 1),
    ],
    [
      b('cone1x1', 'gold', 13, 1, 2),
      b('cone1x1', 'gold', 14, 1, 1),
      b('plate2x8', 'light-grey', 3, 2, 6),
      b('plate2x8', 'light-grey', 3, 2, 8),
      b('plate2x4', 'light-grey', 11, 2, 6, 1),
    ],
    [
      b('plate4x4', 'dark-grey', 3, 3, 6),
      b('plate4x4', 'dark-grey', 7, 3, 6),
      b('plate2x4', 'dark-grey', 11, 3, 7),
      b('sidestuds1x2', 'black', 4, 4, 6, 2),
      b('sidestuds1x2', 'black', 4, 4, 9, 0),
      b('sidestuds1x2', 'black', 10, 4, 6, 2),
      b('sidestuds1x2', 'black', 10, 4, 9, 0),
    ],
    [
      side('roundtile2x2', 'black', 4, 2, 10, '+z'),
      side('roundtile2x2', 'black', 10, 2, 10, '+z'),
      side('roundtile2x2', 'black', 4, 2, 5, '-z'),
      side('roundtile2x2', 'black', 10, 2, 5, '-z'),
    ],
    [
      b('2x4', 'red', 4, 4, 7),
      b('2x4', 'red', 8, 4, 7),
      b('2x4', 'red', 6, 4, 5),
      b('2x4', 'red', 6, 4, 9),
    ],
    [
      b('slope2x2', 'red', 12, 4, 7, 1),
      b('plate1x4', 'red', 14, 4, 6, 1),
      b('cheese1x1', 'white', 14, 5, 6, 1),
      b('cheese1x1', 'white', 14, 5, 9, 1),
      b('tile1x2', 'black', 14, 5, 7, 1),
    ],
    [
      b('1x1', 'red', 3, 4, 6),
      b('headlight1x1', 'black', 3, 4, 7, 3),
      b('headlight1x1', 'black', 3, 4, 8, 3),
      b('1x1', 'red', 3, 4, 9),
      side('roundplate1x1', 'light-grey', 2.2, 4.5, 7, '-x'),
      side('roundplate1x1', 'light-grey', 2.2, 4.5, 8, '-x'),
    ],
    [
      b('slope2x2', 'red', 6, 7, 5, 2),
      b('slope2x2', 'red', 8, 7, 5, 2),
      b('slope2x2', 'red', 6, 7, 9, 0),
      b('slope2x2', 'red', 8, 7, 9, 0),
    ],
    [
      b('curve1x2', 'red', 10, 7, 6, 1),
      b('curve1x2', 'red', 10, 7, 9, 1),
      { ...b('tile2x2', 'black', 10, 7, 7), prints: { top: 'number' } },
      b('cheese1x1', 'trans-clear', 9, 7, 7, 1),
      b('cheese1x1', 'trans-clear', 9, 7, 8, 1),
    ],
    [b('2x2', 'black', 7, 7, 7), b('round1x1', 'white', 7.5, 10, 7.5), b('1x2', 'red', 6, 7, 7, 1)],
    [
      b('1x2', 'red', 4, 7, 6),
      b('1x2', 'red', 4, 7, 9),
      b('1x2', 'red', 5, 7, 7, 1),
      b('slope2x2', 'red', 3, 7, 7, 3),
      b('1x1', 'black', 3, 7, 6),
      b('1x1', 'black', 3, 7, 9),
    ],
    [
      b('slope2x2', 'red', 5, 10, 7, 3),
      b('plate2x4', 'white', 2, 10, 6, 1),
      b('tile1x4', 'black', 2, 11, 6, 1),
      b('tile1x4', 'black', 3, 11, 6, 1),
    ],
  ].map((bricks) => ({ bricks })),
  pages: [
    { note: 'Track with a kerb and a white start line.' },
    { note: 'Trackside: a start light, flowers, ferns and cones.' },
    { note: 'The floor of the car, and two cones.', view: { zoom: 1.2 } },
    { note: 'Bricks with side studs to hold the wheels.', view: { zoom: 1.7 } },
    { note: 'Clip a round tile wheel onto each side stud brick.', view: { zoom: 1.7 } },
    { note: 'The middle of the body and the sidepods.', view: { zoom: 1.7 } },
    { note: 'The nose and the front wing.', view: { zoom: 1.7 } },
    { note: 'Round on the back: tail bricks and exhausts.', view: { turn: 1, zoom: 1.7 } },
    { note: 'Slopes over the sidepods.', view: { zoom: 1.7 } },
    { note: 'The hood with its number, and the windscreen.', view: { zoom: 1.7 } },
    { note: 'The driver in a white helmet.', view: { zoom: 1.7 } },
    { note: 'The engine cover and the wing posts.', view: { turn: 1, zoom: 1.7 } },
    { note: 'The air box and the rear wing.', view: { zoom: 1.7 } },
  ],
};
