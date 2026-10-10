import { describe, expect, it } from 'vitest';
import schema from '../../../docs/build-file.schema.json';
import { BRICK_TYPES, COLOURS } from '../bricks.ts';
import { HOUSE } from '../content/house.ts';
import { BUILDS, addImportedBuild, buildById, importedBuilds } from './catalog.ts';
import {
  BUILD_FILE_FORMAT,
  BUILD_FILE_LIMITS,
  parseBuildFile,
  stringifyBuildFile,
} from './file.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { withoutPrints } from './types.ts';
import { allBins, binColours } from './variant.ts';

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
    expect(problems(withPages([{ bricks: [{ ...red(6, 1), colour: 'magenta' }] }]))).toEqual([
      'page 1, brick 1: unknown colour "magenta"',
    ]);
    expect(problems(withPages([{ bricks: [red(6, 1), red(6, 1)] }]))).toEqual([
      'page 1, brick 2: overlaps another brick',
    ]);
    expect(problems(withPages([{ bricks: [red(14, 1)] }]))).toEqual([
      'page 1, brick 1: sticks out past the baseplate',
    ]);
  });

  it('refuse pages with more than twenty kinds of brick', () => {
    // 21 kinds: seven colours of three plates, laid side by side on the baseplate.
    const colours = ['white', 'red', 'yellow', 'black', 'green', 'blue', 'orange'] as const;
    const types = ['plate1x1', 'plate1x2', 'plate2x2'] as const;
    const bricks = colours.flatMap((colour, i) =>
      types.map((type, j) => ({ type, colour, x: i * 2, y: 1, z: j * 3, rot: 0 })),
    );
    expect(problems(withPages([{ bricks }]))).toEqual([
      'page 1: 21 kinds of brick, at most 20 fit on a page',
    ]);
    expect(problems(withPages([{ bricks: bricks.slice(0, 20) }]))[0]).not.toMatch(/kinds/);
  });

  it('read manuals of up to 32 pages', () => {
    const page = (i: number) => ({
      bricks: [
        { type: '1x1', colour: 'red', x: i % 16, y: 1 + 3 * Math.floor(i / 16), z: 0, rot: 0 },
      ],
    });
    const pages = (n: number) => Array.from({ length: n }, (_, i) => page(i));
    const r = parseBuildFile(withPages(pages(32)), allBins());
    expect(r.ok ? r.build.steps.length : r.problems).toBe(32);
    expect(problems(withPages(pages(33)))).toEqual(['the manual has 33 pages, at most 32 fit']);
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

  it('match the JSON schema in docs/', () => {
    const brick = schema.$defs.brick.properties;
    const types = Object.values(BRICK_TYPES).filter((t) => !t.fixture);
    expect(brick.type.enum).toEqual(types.map((t) => t.id));
    const colours = Object.keys(COLOURS).filter((c) => c !== 'baseplate-green');
    expect(brick.colour.enum).toEqual(colours);
    expect(schema.properties.manual.properties.pages.maxItems).toBe(BUILD_FILE_LIMITS.pages);
  });

  it('read and write sideways parts', () => {
    const pages = [
      {
        bricks: [
          { type: 'headlight1x1', colour: 'white', x: 4, y: 1, z: 4, rot: 0 },
          { type: 'tile1x1', colour: 'pink', x: 4, y: 1, z: 5, rot: 0, face: '+z' },
        ],
      },
    ];
    const r = parseBuildFile(withPages(pages), allBins());
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (!r.ok) return;
    expect(r.build.steps[0]!.bricks[1]!.face).toBe('+z');
    const again = parseBuildFile(stringifyBuildFile(r.build), allBins());
    expect(again.ok && again.build.steps).toEqual(r.build.steps);
    // Not clipped onto anything.
    const loose = [{ bricks: [{ ...pages[0]!.bricks[1]! }] }];
    expect(problems(withPages(loose))[0]).toMatch(/not attached/);
    // A brick is too thick to clip on sideways.
    const thick = [{ bricks: [{ ...pages[0]!.bricks[1]!, type: '2x2' }] }];
    expect(problems(withPages(thick))).toEqual([
      'page 1, brick 1: a 2x2 cannot be clipped on sideways',
    ]);
  });

  it('read parts with a centre hollow half a stud off the grid', () => {
    const pages = [
      {
        bricks: [
          { type: '1x1', colour: 'white', x: 4, y: 1, z: 4, rot: 0 },
          // Centred on the 1x1's stud.
          { type: 'dish2x2', colour: 'light-grey', x: 3.5, y: 4, z: 3.5, rot: 0 },
        ],
      },
    ];
    const r = parseBuildFile(withPages(pages), allBins());
    expect(r.ok ? [] : r.problems).toEqual([]);
    if (!r.ok) return;
    expect(r.build.steps[0]!.bricks[1]).toMatchObject({ x: 3.5, z: 3.5 });
    const again = parseBuildFile(stringifyBuildFile(r.build), allBins());
    expect(again.ok && again.build.steps).toEqual(r.build.steps);
    // Only both ways at once, and only for a part with a centre hollow.
    const askew = [{ bricks: [pages[0]!.bricks[0]!, { ...pages[0]!.bricks[1]!, z: 4 }] }];
    expect(problems(withPages(askew))[0]).toMatch(/both half way between/);
    const brick = [{ bricks: [{ ...pages[0]!.bricks[0]!, x: 4.5, z: 4.5 }] }];
    expect(problems(withPages(brick))[0]).toMatch(/must be whole numbers/);
  });

  describe('prints', () => {
    const SVG =
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'><rect width='1' height='1'/></svg>";
    const printed = (prints: unknown, svgs?: unknown) =>
      JSON.stringify({
        ...TINY_TOWER,
        manual: {
          pages: [
            {
              bricks: [
                { type: '2x4', colour: 'white', x: 6, y: 1, z: 6, rot: 0, prints },
                { type: '2x4', colour: 'white', x: 6, y: 4, z: 6, rot: 0 },
              ],
            },
          ],
        },
        ...(svgs === undefined ? {} : { svgs }),
      });

    it('are read and written with their svgs', () => {
      const r = parseBuildFile(printed({ front: 'logo', top: 'logo' }, { logo: SVG }), bins);
      expect(r.ok ? [] : r.problems).toEqual([]);
      if (!r.ok) return;
      expect(r.build.steps[0]!.bricks[0]!.prints).toEqual({ front: 'logo', top: 'logo' });
      expect(r.build.svgs).toEqual({ logo: SVG });
      const text = stringifyBuildFile(r.build);
      // On the brick's line, sides in the documented order.
      expect(text).toContain('"prints": { "top": "logo", "front": "logo" } }');
      const again = parseBuildFile(text, bins);
      expect(again.ok && again.build).toEqual(r.build);
    });

    it('are dropped when the file has no svgs, for the clean version', () => {
      const r = parseBuildFile(printed({ top: 'logo' }), bins);
      expect(r.ok && r.build.steps[0]!.bricks[0]).toEqual({
        type: '2x4',
        colour: 'white',
        x: 6,
        y: 1,
        z: 6,
        rot: 0,
      });
      expect(r.ok && r.build.svgs).toBeUndefined();
    });

    it('must name an svg the file has, on a side a brick has', () => {
      expect(problems(printed({ top: 'logo' }, { other: SVG }))).toEqual([
        'page 1, brick 1: no svg named "logo"',
      ]);
      expect(problems(printed({ side: 'logo' }, { logo: SVG }))[0]).toMatch(/"side" is not a side/);
      expect(problems(printed('logo', { logo: SVG }))[0]).toMatch(/prints must be an object/);
    });

    it('check the svgs are SVG images', () => {
      expect(problems(printed({ top: 'logo' }, { logo: '<html></html>' }))).toEqual([
        'svg "logo": must be the text of one SVG image, <svg ...>...</svg>',
      ]);
      expect(problems(printed({ top: 'logo' }, { Logo: SVG }))[0]).toMatch(/names are a-z/);
      const big = SVG.replace('</svg>', `<!--${'x'.repeat(BUILD_FILE_LIMITS.svgLength)}--></svg>`);
      expect(problems(printed({ top: 'logo' }, { logo: big }))).toEqual([
        'svg "logo": bigger than 32 KB',
      ]);
      const declared = `<?xml version="1.0"?>\n${SVG}`;
      expect(problems(printed({ top: 'logo' }, { logo: declared }))).toEqual([]);
    });

    it('can be stripped, leaving the clean version', () => {
      const r = parseBuildFile(printed({ top: 'logo' }, { logo: SVG }), bins);
      expect(r.ok && withoutPrints(r.build).steps[0]!.bricks[0]!.prints).toBeUndefined();
      expect(r.ok && withoutPrints(r.build).svgs).toBeUndefined();
    });
  });
});
