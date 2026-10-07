import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import type { BuildStep, TargetBrick } from './types.ts';

/** One brick of a build, in baseplate grid coordinates. */
export const b = (
  type: BrickTypeId,
  colour: ColourId,
  x: number,
  y: number,
  z: number,
  rot: Rotation = 0,
): TargetBrick => ({ type, colour, x, y, z, rot });

/** Two 2x4 bricks covering a 4x4 square from (x, z), turned a quarter when `turned`. */
export const square4 = (
  x: number,
  y: number,
  z: number,
  colour: ColourId,
  turned: boolean,
): TargetBrick[] =>
  turned
    ? [b('2x4', colour, x, y, z, 1), b('2x4', colour, x + 2, y, z, 1)]
    : [b('2x4', colour, x, y, z), b('2x4', colour, x, y, z + 2)];

/**
 * Four bricks laid as a pinwheel around a 2x2 hole, covering a 6x6 square from (x, z), and a
 * 2x2 of `centre` type in the hole. `mirror` turns the pinwheel the other way, so two layers
 * of it overlap at every joint.
 */
export const pinwheel6 = (
  type: '2x4' | 'plate2x4',
  centre: '2x2' | 'plate2x2',
  colour: ColourId,
  x: number,
  y: number,
  z: number,
  mirror = false,
): TargetBrick[] =>
  mirror
    ? [
        b(type, colour, x, y, z, 1),
        b(type, colour, x + 2, y, z),
        b(type, colour, x + 4, y, z + 2, 1),
        b(type, colour, x, y, z + 4),
        b(centre, colour, x + 2, y, z + 2),
      ]
    : [
        b(type, colour, x, y, z, 0),
        b(type, colour, x + 4, y, z, 1),
        b(type, colour, x + 2, y, z + 4, 0),
        b(type, colour, x, y, z + 2, 1),
        b(centre, colour, x + 2, y, z + 2),
      ];

/**
 * A run of 1-stud-wide bricks along x (or along z when `alongZ`), `length` studs long: 1x4s,
 * then a 1x2 or 1x1 for what is left. `offset` starts with a 1x2 instead, so the joints of two
 * stacked runs don't line up.
 */
export function run1(
  colour: ColourId,
  x: number,
  y: number,
  z: number,
  length: number,
  alongZ = false,
  offset = false,
): TargetBrick[] {
  const out: TargetBrick[] = [];
  let at = 0;
  const place = (n: number) => {
    const type: BrickTypeId = n === 4 ? '1x4' : n === 2 ? '1x2' : '1x1';
    out.push(alongZ ? b(type, colour, x, y, z + at, n > 1 ? 1 : 0) : b(type, colour, x + at, y, z));
    at += n;
  };
  if (offset && length >= 3) place(2);
  while (length - at >= 4) place(4);
  if (length - at >= 2) place(2);
  if (length - at >= 1) place(1);
  return out;
}

/**
 * Splits bricks, listed bottom up, into about `pages` pages of even size. A page never shows
 * more than four kinds of brick, so its parts list fits; such a page ends early.
 */
export function paginate(bricks: TargetBrick[], pages: number): BuildStep[] {
  const steps: BuildStep[] = [];
  let page: TargetBrick[] = [];
  let kinds = new Set<string>();
  bricks.forEach((brick, i) => {
    const kind = `${brick.type}|${brick.colour}`;
    const due = Math.round(((steps.length + 1) * bricks.length) / pages);
    if (page.length && (i >= due || (!kinds.has(kind) && kinds.size >= 4))) {
      steps.push({ bricks: page });
      page = [];
      kinds = new Set();
    }
    page.push(brick);
    kinds.add(kind);
  });
  if (page.length) steps.push({ bricks: page });
  return steps;
}
