import { COLOURS } from '../bricks.ts';
import type { TargetBrick, TargetBuild } from './types.ts';
import { lookAlikes } from './variant.ts';
import type { BinColours } from './variant.ts';

/** What a printed instruction page shows: the bricks it adds and the ink stamp on it. */
export interface PrintedPage {
  step: number;
  added: TargetBrick[];
  stamp: string;
}

/** "3": the number printed big on a page. */
export function pageNumber(p: { step: number }): string {
  return `${p.step + 1}`;
}

/** "the master index", "page 3": how to speak of a page. */
export function pageName(p: { step: number } | null | undefined): string {
  if (!p || p.step < 0) return 'the master index';
  return `page ${pageNumber(p)}`;
}

/** Real stamp and the near-copy a forger has to make do with. */
export const STAMPS: [real: string, fake: string][] = [
  ['★', '✩'],
  ['♦', '◇'],
  ['♣', '♧'],
  ['♠', '♤'],
  ['●', '◉'],
  ['▲', '△'],
  ['✿', '❀'],
  ['☀', '☼'],
];

export function realPage(build: TargetBuild, step: number, stamp: string): PrintedPage {
  return {
    step,
    added: build.steps[step]!.bricks.map((b) => ({ ...b })),
    stamp,
  };
}

/**
 * A forgery of a step: one brick turned a look-alike colour so it is almost right. Shapes and
 * positions never change, since a brick sitting in the wrong place gives the page away at a
 * glance; the wrong shade only shows up against the master index's parts list, the stamp or
 * the inspector.
 */
export function forgePage(
  build: TargetBuild,
  step: number,
  fakeStamp: string,
  rng: () => number,
  bins?: BinColours,
): PrintedPage {
  const page = realPage(build, step, fakeStamp);
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length)]!;
  // A look-alike colour the team can actually get from a bin, so the forgery is buildable.
  const options = page.added.map((b) =>
    (bins ? lookAlikes(b.type, b.colour, bins) : COLOURS[b.colour].nearMiss).filter(
      (c) => c !== b.colour,
    ),
  );
  const forgeable = options.flatMap((o, i) => (o.length ? [i] : []));
  if (forgeable.length) {
    const i = pick(forgeable);
    page.added[i] = { ...page.added[i]!, colour: pick(options[i]!) };
    return page;
  }
  // No bin has a look-alike for anything on this page: fall back to a colour's own nearest.
  // With none of those either, the page cannot be forged and stays as it is.
  const nearest = page.added.flatMap((b, i) => (COLOURS[b.colour].nearMiss.length ? [i] : []));
  if (nearest.length) {
    const i = pick(nearest);
    page.added[i] = { ...page.added[i]!, colour: COLOURS[page.added[i]!.colour].nearMiss[0]! };
  }
  return page;
}

/** True if a printed page differs from the real one in any way. */
export function isForged(build: TargetBuild, page: PrintedPage, realStamp: string): boolean {
  if (page.stamp !== realStamp) return true;
  const real = build.steps[page.step]!.bricks;
  return (
    real.length !== page.added.length ||
    real.some((b, i) => JSON.stringify(b) !== JSON.stringify(page.added[i]))
  );
}
