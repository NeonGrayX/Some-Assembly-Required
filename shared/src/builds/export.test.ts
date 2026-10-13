import { describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { BrickGrid } from '../grid.ts';
import type { PlacedBrick } from '../grid.ts';
import { BUILDS } from './catalog.ts';
import { buildFileNames, buildFromGrid } from './export.ts';
import { BUILD_FILE_LIMITS, buildProblems, parseBuildFile, stringifyBuildFile } from './file.ts';
import { matchBuild } from './match.ts';
import { TEST_LIGHTHOUSE } from './testing.ts';
import type { TargetBuild } from './types.ts';
import { binColours } from './variant.ts';

const bins = binColours(HOUSE);
const PLATE: PlacedBrick = {
  id: 1,
  type: 'baseplate16',
  colour: 'baseplate-green',
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
};

/** A job site's grid with this build standing on it, its bricks shuffled out of order. */
function standing(build: TargetBuild): BrickGrid {
  const bricks = build.steps.flatMap((s) => s.bricks).reverse();
  return BrickGrid.from([PLATE, ...bricks.map((b, i) => ({ ...b, id: i + 2 }))]);
}

describe('buildFromGrid', () => {
  it('turns a standing build into a build file that reads back as the same model', () => {
    const grid = standing(TEST_LIGHTHOUSE);
    const build = buildFromGrid(grid, { id: 'my-tower', name: 'My Tower', author: 'Daniel' });
    expect(buildProblems(build, bins)).toEqual([]);
    const r = parseBuildFile(stringifyBuildFile(build), bins);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.build.author).toBe('Daniel');
    const result = matchBuild(r.build, grid);
    expect(result.counts.correct).toBe(result.counts.total);
    expect(result.extras).toEqual([]);
  });

  it('keeps every built-in build buildable, within the page and kind limits', () => {
    for (const target of BUILDS) {
      const build = buildFromGrid(standing(target), { id: 'x', name: 'X', svgs: target.svgs });
      expect(build.steps.length, target.id).toBeLessThanOrEqual(BUILD_FILE_LIMITS.pages);
      expect(buildProblems(build, bins), target.id).toEqual([]);
      expect(matchBuild(build, standing(target)).passed, target.id).toBe(true);
    }
  });

  it('gives a small build a few bricks a page and an empty plate no pages', () => {
    const build = buildFromGrid(standing(TEST_LIGHTHOUSE), { id: 'x', name: 'X' });
    expect(build.steps.every((s) => s.bricks.length <= 4)).toBe(true);
    expect(build.steps.length).toBe(Math.ceil(32 / 4));
    expect(buildFromGrid(BrickGrid.from([PLATE]), { id: 'x', name: 'X' }).steps).toEqual([]);
  });

  it('drops prints whose pictures it does not have', () => {
    const grid = BrickGrid.from([
      PLATE,
      { id: 2, type: '2x4', colour: 'red', x: 0, y: 1, z: 0, rot: 0, prints: { front: 'star' } },
      { id: 3, type: '2x4', colour: 'red', x: 4, y: 1, z: 0, rot: 0, prints: { front: 'moon' } },
    ]);
    const build = buildFromGrid(grid, { id: 'x', name: 'X', svgs: { star: '<svg/>' } });
    const bricks = build.steps.flatMap((s) => s.bricks);
    expect(bricks.map((b) => b.prints)).toEqual([{ front: 'star' }, undefined]);
    expect(build.svgs).toEqual({ star: '<svg/>' });
  });
});

describe('buildFileNames', () => {
  it('makes an id from the name, and falls back when nothing usable was typed', () => {
    expect(buildFileNames('  My Castle!  ', 'Free build')).toEqual({
      id: 'my-castle',
      name: 'My Castle!',
    });
    expect(buildFileNames('', 'Free build')).toEqual({ id: 'free-build', name: 'Free build' });
    expect(buildFileNames('42', 'Free build')).toEqual({ id: 'free-build', name: '42' });
    expect(buildFileNames('A very long name for a build', 'Free build').name).toHaveLength(20);
  });
});
