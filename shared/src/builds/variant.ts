import { COLOURS } from '../bricks.ts';
import type { BrickTypeId, ColourId } from '../bricks.ts';
import type { LevelDef } from '../content/sandbox.ts';
import type { TargetBuild } from './types.ts';

/** Share of brick groups (same type and colour) that change colour in a round's variant. */
const GROUP_CHANGE = 0.5;
/** Share of single bricks that get a look-alike accent colour on top of that. */
const ACCENT = 0.25;

export type BinColours = Map<BrickTypeId, Set<ColourId>>;

/** Which colours the level's bins hand out, per brick type. */
export function binColours(level: LevelDef): BinColours {
  const out: BinColours = new Map();
  for (const bin of level.bins) {
    const set = out.get(bin.type) ?? new Set<ColourId>();
    set.add(bin.colour);
    out.set(bin.type, set);
  }
  return out;
}

/** A brick's own colour and its look-alikes that a bin actually has, for this type. */
export function lookAlikes(type: BrickTypeId, colour: ColourId, bins: BinColours): ColourId[] {
  const have = bins.get(type);
  return [colour, ...COLOURS[colour].nearMiss].filter((c) => have?.has(c));
}

/**
 * Recolours a build for one round, so nobody can tell a forged page from a real one by colour
 * alone: whole groups of bricks switch to a look-alike colour (all the red stripes turn dark
 * red, say), and some single bricks get a look-alike accent. Only colours the bins hand out
 * are used, and shapes and positions never change, so the variant is always buildable.
 */
export function colourVariant(
  build: TargetBuild,
  bins: BinColours,
  rng: () => number,
): TargetBuild {
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)]!;
  const groupColour = new Map<string, ColourId>();
  return {
    ...build,
    steps: build.steps.map((step) => ({
      bricks: step.bricks.map((b) => {
        const key = `${b.type}|${b.colour}`;
        let colour = groupColour.get(key);
        if (!colour) {
          const options = lookAlikes(b.type, b.colour, bins);
          colour = rng() < GROUP_CHANGE && options.length ? pick(options) : b.colour;
          groupColour.set(key, colour);
        }
        if (rng() < ACCENT) {
          // One step from the design colour at most, never a look-alike of a look-alike.
          const options = lookAlikes(b.type, b.colour, bins);
          if (options.length) colour = pick(options);
        }
        return { ...b, colour };
      }),
    })),
  };
}
