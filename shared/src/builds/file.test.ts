import { describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { BUILDS, addImportedBuild, buildById, importedBuilds } from './catalog.ts';
import { BUILD_FILE_FORMAT, parseBuildFile, stringifyBuildFile } from './file.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { binColours } from './variant.ts';

const bins = binColours(HOUSE);

/** The example from docs/07-build-file-format.md. */
const TINY_TOWER = {
  format: BUILD_FILE_FORMAT,
  version: 1,
  build: { id: 'tiny-tower', name: 'Tiny Tower', author: 'Daniel' },
  manual: {
    cover: { view: { turn: 0, zoom: 1 } },
    pages: [
      {
        bricks: [
          { type: '2x4', colour: 'white', x: 6, y: 1, z: 6, rot: 0 },
          { type: '2x4', colour: 'white', x: 6, y: 1, z: 8, rot: 0 },
        ],
      },
      {
        note: 'Lay these across the bricks below.',
        view: { turn: 1 },
        bricks: [
          { type: '2x4', colour: 'red', x: 6, y: 4, z: 6, rot: 1 },
          { type: '2x4', colour: 'red', x: 8, y: 4, z: 6, rot: 1 },
        ],
      },
    ],
  },
};

const withPages = (pages: unknown[]) => JSON.stringify({ ...TINY_TOWER, manual: { pages } });
const problems = (text: string) => {
  const r = parseBuildFile(text, bins);
  return r.ok ? [] : r.problems;
};

describe('build files', () => {
  it('read the example from the spec', () => {
    const r = parseBuildFile(JSON.stringify(TINY_TOWER), bins);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.build.name).toBe('Tiny Tower');
    expect(r.build.author).toBe('Daniel');
    expect(r.build.steps.map((s) => s.bricks.length)).toEqual([2, 2]);
    // Defaults are dropped: the cover's view is the plain one.
    expect(r.build.cover).toBeUndefined();
    expect(r.build.pages).toEqual([
      {},
      { view: { turn: 1 }, note: TINY_TOWER.manual.pages[1]!.note },
    ]);
  });

  it('export every built-in build so it imports back the same', () => {
    for (const build of BUILDS) {
      const r = parseBuildFile(stringifyBuildFile(build), bins);
      expect(r, build.id).toEqual({ ok: true, build });
    }
  });

  it('keep notes and views through an export', () => {
    const r = parseBuildFile(JSON.stringify(TINY_TOWER), bins);
    if (!r.ok) throw new Error(r.problems.join());
    expect(parseBuildFile(stringifyBuildFile(r.build), bins)).toEqual(r);
  });

  it('write one brick per line', () => {
    const lines = stringifyBuildFile(LIGHTHOUSE).split('\n');
    const brickLines = lines.filter((l) => l.includes('"type"'));
    expect(brickLines).toHaveLength(32);
    expect(brickLines[0]!.trim()).toMatch(
      /^\{ "type": "2x4", "colour": "[\w-]+", "x": \d+, "y": \d+, "z": \d+, "rot": \d \},?$/,
    );
  });

  it('read what the build editor exports as version 0', () => {
    const r = parseBuildFile(JSON.stringify(LIGHTHOUSE), bins);
    expect(r).toEqual({ ok: true, build: LIGHTHOUSE });
  });

  it('refuse files that are not build files, or from a newer game', () => {
    expect(problems('not json')).toEqual(['the file is not JSON']);
    expect(problems('{"format":"something-else"}')).toEqual(['the file is not a build file']);
    expect(problems(JSON.stringify({ ...TINY_TOWER, version: 2 }))).toEqual([
      'the file was made with a newer version of the game',
    ]);
  });

  it('point at the brick that is wrong', () => {
    const red = (x: number, y: number) => ({ type: '2x4', colour: 'red', x, y, z: 6, rot: 0 });
    expect(problems(withPages([{ bricks: [{ ...red(6, 1), colour: 'pink' }] }]))).toEqual([
      'page 1, brick 1: unknown colour "pink"',
    ]);
    expect(problems(withPages([{ bricks: [red(6, 1), red(6, 1)] }]))).toEqual([
      'page 1, brick 2: overlaps another brick',
    ]);
    expect(problems(withPages([{ bricks: [red(14, 1)] }]))).toEqual([
      'page 1, brick 1: sticks out past the baseplate',
    ]);
  });

  it('refuse pages with more than four kinds of brick', () => {
    const bricks = (['white', 'red', 'yellow', 'black', 'green'] as const).map((colour, i) => ({
      type: '2x2',
      colour,
      x: i * 3,
      y: 1,
      z: 0,
      rot: 0,
    }));
    expect(problems(withPages([{ bricks }]))).toEqual([
      'page 1: 5 kinds of brick, at most 4 fit on a page',
    ]);
  });

  it('refuse bricks that hang under others or that no bin hands out', () => {
    const overhang = [
      { type: '2x4', colour: 'red', x: 6, y: 1, z: 6, rot: 0 },
      { type: '2x4', colour: 'red', x: 4, y: 4, z: 6, rot: 0 },
    ];
    expect(problems(withPages([{ bricks: overhang }]))).toEqual([]);
    // A plate under the overhang clutches it, but could only be pushed on from below.
    const under = { type: 'plate2x2', colour: 'light-grey', x: 4, y: 3, z: 6, rot: 0 };
    expect(problems(withPages([{ bricks: [...overhang, under] }]))).toEqual([
      'page 1, brick 3: does not sit on anything below it',
    ]);
    const plate = [{ type: 'plate1x2', colour: 'red', x: 0, y: 1, z: 0, rot: 0 }];
    expect(problems(withPages([{ bricks: plate }]))).toEqual([
      "page 1, brick 1: no bin hands out red plate1x2, so it can't be built",
    ]);
  });
});

describe('imported builds', () => {
  it('are found by id next to the built-in ones', () => {
    const r = parseBuildFile(JSON.stringify(TINY_TOWER), bins);
    if (!r.ok) throw new Error(r.problems.join());
    addImportedBuild(r.build);
    expect(buildById('tiny-tower')).toBe(r.build);
    expect(importedBuilds()).toContain(r.build);
    expect(() => addImportedBuild({ ...r.build, id: 'castle' })).toThrow();
  });
});
