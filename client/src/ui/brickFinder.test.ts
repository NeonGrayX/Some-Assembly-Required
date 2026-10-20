import { describe, expect, it } from 'vitest';
import { BRICK_TYPES } from '@sar/shared';
import type { BrickTypeId } from '@sar/shared';
import {
  allSizes,
  brickKinds,
  catalogueOrder,
  brickShown,
  colourShown,
  parseFavourites,
  sizeLabel,
} from './brickFinder.ts';
import type { BrickFilter, ColourFilter } from './brickFinder.ts';
import { brickName } from './brickViewer.ts';

const ANY: BrickFilter = { query: '', kind: null, size: null, height: null, favouritesOnly: false };
const NONE = new Set<string>();
const types = (Object.keys(BRICK_TYPES) as BrickTypeId[]).filter((t) => !BRICK_TYPES[t].fixture);
const found = (f: Partial<BrickFilter>, favourites: Set<string> = NONE) =>
  types.filter((t) => brickShown(t, brickName(t), { ...ANY, ...f }, favourites));

describe('the brick finder', () => {
  it('sorts parts into kinds', () => {
    expect([...brickKinds('2x4')]).toEqual(['brick']);
    expect([...brickKinds('plate4x6')]).toEqual(['plate']);
    expect([...brickKinds('tile2x2')]).toEqual(['tile']);
    expect([...brickKinds('roundplate2x2')].sort()).toEqual(['plate', 'round']);
    expect([...brickKinds('roundtile1x1')].sort()).toEqual(['round', 'tile']);
    expect([...brickKinds('slope4x3')]).toEqual(['slope']);
    expect([...brickKinds('sidestuds4sides1x1')].sort()).toEqual(['brick', 'modified']);
    expect([...brickKinds('bracket1x2x2')].sort()).toEqual(['modified', 'plate']);
    expect([...brickKinds('window1x2x2')]).toEqual(['other']);
  });

  it('gives every part a kind', () => {
    for (const t of types) expect(brickKinds(t).size, t).toBeGreaterThan(0);
  });

  it('finds parts by name, size either way round, and part number', () => {
    // The sign holder bracket is a 2x4 plate too.
    expect(found({ query: '2x4 plate' })).toEqual(['plate2x4', 'bracket2x4']);
    expect(found({ query: '4×2 PLATE' })).toEqual(['plate2x4', 'bracket2x4']);
    expect(found({ query: '3001' })).toEqual(['2x4']);
    expect(found({ query: 'bracket' })).toContain('bracket1x2x2');
    expect(found({ query: 'curved' })).toEqual(['curve1x2', 'curve2x2', 'curve1x3']);
    expect(found({ query: 'nothing like this' })).toEqual([]);
  });

  it('filters by kind, size and height together', () => {
    expect(found({ kind: 'plate', size: '4×6' })).toEqual(['plate4x6']);
    expect(found({ size: '1×2', height: 'brick' })).toEqual(
      expect.arrayContaining(['1x2', 'slope1x2', 'sidestuds1x2']),
    );
    expect(found({ height: 'tall', kind: 'brick' })).toContain('1x1x5');
    for (const t of found({ kind: 'tile' })) expect(BRICK_TYPES[t].studs).toBe('none');
  });

  it('shows only favourites when asked', () => {
    expect(found({ favouritesOnly: true }, new Set(['1x8', 'tile6x6']))).toEqual([
      '1x8',
      'tile6x6',
    ]);
  });

  it('lists every size once, smallest first', () => {
    const sizes = allSizes(types);
    expect(sizes[0]).toBe('1×1');
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(sizes).toContain(sizeLabel('plate8x16'));
    expect(sizes.indexOf('2×10')).toBeLessThan(sizes.indexOf('3×3'));
  });

  it('finds colours by name and group', () => {
    const f: ColourFilter = { query: '', group: null, favouritesOnly: false };
    expect(colourShown('medium-nougat', { ...f, query: 'nougat' }, NONE)).toBe(true);
    expect(colourShown('trans-pink', { ...f, query: 'see through pink' }, NONE)).toBe(true);
    expect(colourShown('pink', { ...f, group: 'trans' }, NONE)).toBe(false);
    expect(colourShown('pearl-gold', { ...f, group: 'metallic' }, NONE)).toBe(true);
    expect(colourShown('red', { ...f, favouritesOnly: true }, new Set(['red']))).toBe(true);
  });
});

describe('parseFavourites', () => {
  it('starts empty when nothing is stored or it is broken', () => {
    for (const json of [null, '{oops', '42', '{"bricks":"2x4"}']) {
      const f = parseFavourites(json);
      expect([f.bricks.size, f.colours.size]).toEqual([0, 0]);
    }
  });

  it('keeps known parts and colours and drops the rest', () => {
    const f = parseFavourites(
      '{"bricks":["2x4","nope","baseplate16",3],"colours":["red","baseplate-green","plaid"]}',
    );
    expect([...f.bricks]).toEqual(['2x4']);
    expect([...f.colours]).toEqual(['red']);
  });
});

describe('the parts catalogue', () => {
  it('gives no two parts the same part number', () => {
    const parts = types.map((t) => BRICK_TYPES[t].part).filter(Boolean);
    expect(new Set(parts).size).toBe(parts.length);
  });
});

describe('catalogueOrder', () => {
  it('keeps each family together, smallest first', () => {
    const order = catalogueOrder();
    const at = (t: BrickTypeId) => order.indexOf(t);
    expect(order).toHaveLength(Object.keys(BRICK_TYPES).length);
    // The brackets one after another, small to big.
    expect([at('bracket1x1'), at('bracket1x2'), at('bracket1x2x2'), at('bracket2x4')]).toEqual(
      [0, 1, 2, 3].map((i) => at('bracket1x1') + i),
    );
    // The bricks with side studs together, before the brackets.
    for (const t of ['sidestuds1x1', 'headlight1x1', 'sidestuds1x2', 'sidestuds1x4'] as const)
      expect(at(t)).toBeLessThan(at('bracket1x1'));
    expect(at('sidestuds1x4')).toBeGreaterThan(at('sidestuds1x2'));
    expect(at('1x2')).toBeLessThan(at('2x2'));
    expect(at('plate1x1')).toBeLessThan(at('plate8x8'));
    expect(order.at(-1)).toBe('baseplate16');
  });
});
