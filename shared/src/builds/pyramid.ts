import type { ColourId } from '../bricks.ts';
import type { TargetBrick, TargetBuild } from './types.ts';
import { b, paginate } from './kit.ts';

/** 2-wide bricks along a run of `length` studs: 2x4s, and a 2x2 for the rest. */
function run2(colour: ColourId, x: number, y: number, z: number, length: number, alongZ: boolean) {
  const out: TargetBrick[] = [];
  for (let at = 0; at < length; at += 4) {
    const type = length - at >= 4 ? '2x4' : '2x2';
    out.push(
      alongZ
        ? b(type, colour, x, y, z + at, type === '2x4' ? 1 : 0)
        : b(type, colour, x + at, y, z),
    );
  }
  return out;
}

/**
 * A square ring two studs thick, `size` studs across from (x, z). With `turned`, the east and
 * west sides run the full length instead of the north and south ones, so two stacked rings
 * overlap at the corners.
 */
function ring(colour: ColourId, x: number, y: number, z: number, size: number, turned: boolean) {
  if (size <= 4)
    return run2(colour, x, y, z, size, false).concat(
      size === 4 ? run2(colour, x, y, z + 2, 4, false) : [],
    );
  const far = size - 2;
  return turned
    ? [
        ...run2(colour, x, y, z, size, true),
        ...run2(colour, x + far, y, z, size, true),
        ...run2(colour, x + 2, y, z, size - 4, false),
        ...run2(colour, x + 2, y, z + far, size - 4, false),
      ]
    : [
        ...run2(colour, x, y, z, size, false),
        ...run2(colour, x, y, z + far, size, false),
        ...run2(colour, x, y, z + 2, size - 4, true),
        ...run2(colour, x + far, y, z + 2, size - 4, true),
      ];
}

// Seven steps, each two bricks high, from 14 studs across down to a 2x2 cap.
const bricks = [14, 12, 10, 8, 6, 4].flatMap((size, level) => {
  const at = 1 + level;
  const y = 1 + level * 6;
  return [...ring('yellow', at, y, at, size, false), ...ring('yellow', at, y + 3, at, size, true)];
});

/** A stepped pyramid with a golden cap, 12 pages: six two-brick-high steps and the top. */
export const PYRAMID: TargetBuild = {
  id: 'pyramid',
  name: 'Pyramid',
  steps: [
    ...paginate(bricks, 11),
    { bricks: [b('2x2', 'orange', 7, 37, 7), b('2x2', 'orange', 7, 40, 7)] },
  ],
};
