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

/**
 * A robot cheering with both arms up, on a small platform, 82 parts on 13 pages: black feet
 * with sloped toes, a chest of green grilles and see-through buttons on side studs, orange
 * vents on its back, round white hands, a glowing mouth and eyes, dish ears, a tiled head with
 * an antenna, and ferns and a flower by its feet.
 */
export const ROBOT: TargetBuild = {
  id: 'robot',
  name: 'Robot',
  steps: [
    // The platform.
    [
      b('plate8x8', 'light-grey', 4, 1, 4),
      b('tile1x4', 'black', 4, 2, 11),
      b('tile1x4', 'black', 8, 2, 11),
    ],
    // Feet.
    [
      b('2x2', 'black', 5, 2, 5),
      b('2x2', 'black', 9, 2, 5),
      b('slope2x2', 'black', 5, 2, 7),
      b('slope2x2', 'black', 9, 2, 7),
    ],
    // Legs and knees.
    [
      b('2x2', 'light-grey', 5, 5, 5),
      b('2x2', 'light-grey', 9, 5, 5),
      b('plate2x2', 'dark-grey', 5, 8, 5),
      b('plate2x2', 'dark-grey', 9, 8, 5),
      b('2x2', 'light-grey', 5, 9, 5),
      b('2x2', 'light-grey', 9, 9, 5),
    ],
    // Waist, and plants on the platform.
    [
      b('plate4x4', 'dark-grey', 5, 12, 5),
      b('plate2x4', 'dark-grey', 9, 12, 5, 1),
      b('roundplate1x1', 'green', 4, 2, 9),
      b('plant1x1', 'green', 4, 3, 9),
      b('flower2x2', 'yellow', 10, 2, 9),
      b('roundplate1x1', 'green', 11, 2, 7),
      b('plant1x1', 'green', 11, 3, 7),
    ],
    // Chest, lower layer with the grille panel.
    [
      b('1x4', 'light-grey', 5, 13, 5, 1),
      b('1x4', 'light-grey', 10, 13, 5, 1),
      b('sidestuds1x4', 'teal', 6, 13, 5, 2),
      b('1x4', 'light-grey', 6, 13, 6),
      b('1x4', 'light-grey', 6, 13, 7),
      b('sidestuds1x4', 'teal', 6, 13, 8),
      side('grille1x2', 'green', 6, 13.5, 9, '+z'),
      side('grille1x2', 'green', 8, 13.5, 9, '+z'),
    ],
    // Back vents.
    [
      side('grille1x2', 'trans-orange', 6, 13.5, 4, '-z'),
      side('grille1x2', 'trans-orange', 8, 13.5, 4, '-z'),
    ],
    // Chest, buttons.
    [
      b('1x4', 'light-grey', 5, 16, 5, 1),
      b('1x4', 'light-grey', 10, 16, 5, 1),
      b('2x4', 'light-grey', 6, 16, 5),
      b('1x4', 'light-grey', 6, 16, 7),
      b('1x1', 'white', 6, 16, 8),
      b('headlight1x1', 'white', 7, 16, 8),
      b('headlight1x1', 'white', 8, 16, 8),
      b('1x1', 'white', 9, 16, 8),
      side('cheese1x1', 'trans-orange', 7, 16.5, 8.8, '+z'),
      side('cheese1x1', 'trans-blue', 8, 16.5, 8.8, '+z'),
    ],
    // Shoulders.
    [
      b('2x4', 'light-grey', 3, 19, 6),
      b('2x4', 'light-grey', 9, 19, 6),
      b('2x4', 'light-grey', 7, 19, 5, 1),
      b('1x2', 'light-grey', 5, 19, 5),
      b('1x2', 'light-grey', 9, 19, 5),
      b('1x2', 'light-grey', 5, 19, 8),
      b('1x2', 'light-grey', 9, 19, 8),
    ],
    // Arms and hands.
    [
      b('2x2', 'light-grey', 3, 22, 6),
      b('2x2', 'light-grey', 11, 22, 6),
      b('plate2x2', 'dark-grey', 3, 25, 6),
      b('plate2x2', 'dark-grey', 11, 25, 6),
      b('round2x2', 'white', 3, 26, 6),
      b('round2x2', 'white', 11, 26, 6),
      b('tile1x4', 'light-grey', 5, 22, 5, 1),
      b('tile1x4', 'light-grey', 10, 22, 5, 1),
    ],
    // Neck and mouth.
    [
      b('plate4x4', 'dark-grey', 6, 22, 5),
      b('2x4', 'light-grey', 6, 23, 5),
      b('1x4', 'light-grey', 6, 23, 7),
      b('1x1', 'light-grey', 6, 23, 8),
      b('sidestuds1x2', 'black', 7, 23, 8),
      b('1x1', 'light-grey', 9, 23, 8),
      side('grille1x2', 'trans-orange', 7, 23.5, 9, '+z'),
    ],
    // Eyes.
    [
      b('1x1', 'light-grey', 6, 26, 5),
      b('sidestuds1x2', 'black', 6, 26, 6, 3),
      b('1x1', 'light-grey', 6, 26, 8),
      b('1x1', 'light-grey', 9, 26, 5),
      b('sidestuds1x2', 'black', 9, 26, 6, 1),
      b('1x1', 'light-grey', 9, 26, 8),
      b('2x2', 'light-grey', 7, 26, 5),
      b('1x2', 'light-grey', 7, 26, 7),
      b('headlight1x1', 'black', 7, 26, 8),
      b('headlight1x1', 'black', 8, 26, 8),
      side('tile1x1', 'trans-green', 7, 26.5, 8.8, '+z'),
      side('tile1x1', 'trans-green', 8, 26.5, 8.8, '+z'),
    ],
    // Dish ears.
    [side('dish2x2', 'light-grey', 10, 24, 6, '+x'), side('dish2x2', 'light-grey', 5, 24, 6, '-x')],
    // Top of the head and the antenna.
    [
      b('plate4x4', 'dark-grey', 6, 29, 5),
      b('tile1x4', 'light-grey', 6, 30, 5, 1),
      b('tile1x4', 'light-grey', 9, 30, 5, 1),
      b('tile1x2', 'black', 7, 30, 5),
      b('tile1x2', 'black', 7, 30, 8),
      b('roundplate2x2', 'light-grey', 7, 30, 6),
      b('round1x1', 'red', 7.5, 31, 6.5),
      b('cone1x1', 'gold', 7.5, 34, 6.5),
    ],
  ].map((bricks) => ({ bricks })),
  pages: [
    { note: 'A platform with a black step at the front.' },
    { note: 'Big black feet with sloped toes.' },
    { note: 'Legs with dark grey knees.', view: { zoom: 1.3 } },
    { note: 'The waist, and ferns and a flower by the feet.' },
    { note: 'The chest: side studs and two green grilles.', view: { zoom: 1.3 } },
    { note: 'Two see-through vents on the back.', view: { turn: 2, zoom: 1.3 } },
    { note: 'A white panel with see-through buttons.', view: { zoom: 1.3 } },
    { note: 'Shoulders sticking out to both sides.', view: { zoom: 1.3 } },
    { note: 'Arms up, with round white hands.', view: { zoom: 1.3 } },
    { note: 'The neck and a glowing orange mouth.', view: { zoom: 1.3 } },
    { note: 'Glowing green eyes, side studs for the ears.', view: { zoom: 1.3 } },
    { note: 'Clip a dish ear onto each side.', view: { zoom: 1.3 } },
    { note: 'Tiles on top of the head and the antenna.', view: { zoom: 1.3 } },
  ],
};
