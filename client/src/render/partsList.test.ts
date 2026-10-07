import { describe, expect, it } from 'vitest';
import { partCell, partsLayout } from './partsList.ts';

/** The parts box of a printed page, inside its margins. */
const W = 528;
const H = 140;

describe('partsLayout', () => {
  it('keeps the big icons for up to four kinds of brick', () => {
    for (const n of [1, 2, 3, 4]) {
      const l = partsLayout(n, W, H);
      expect(l.stacked).toBe(true);
      expect(l.cols).toBe(n);
      expect(l.rows).toBe(1);
      expect(l.icon).toBe(84);
    }
  });

  it('switches to a compact grid for five or more', () => {
    const l = partsLayout(5, W, H);
    expect(l.stacked).toBe(false);
    expect(l.cols).toBe(3);
    expect(l.rows).toBe(2);
    expect(l.icon).toBeLessThan(84);
  });

  it('adds columns before rows', () => {
    expect(partsLayout(7, W, H)).toMatchObject({ cols: 3, rows: 3 });
    expect(partsLayout(10, W, H)).toMatchObject({ cols: 4, rows: 3 });
    expect(partsLayout(13, W, H)).toMatchObject({ cols: 5, rows: 3 });
    expect(partsLayout(16, W, H)).toMatchObject({ cols: 5, rows: 4 });
  });

  it('fits every cell inside the box, for any count', () => {
    for (let n = 1; n <= 30; n++) {
      const l = partsLayout(n, W, H);
      expect(l.cols * l.rows).toBeGreaterThanOrEqual(n);
      expect(l.cols * l.cellW).toBeLessThanOrEqual(W);
      expect(l.rows * l.cellH).toBeLessThanOrEqual(H);
      const last = partCell(l, n - 1);
      expect(last.x + l.cellW).toBeLessThanOrEqual(W);
      expect(last.y + l.cellH).toBeLessThanOrEqual(H);
      // The icon and both lines of text fit in a cell.
      expect(l.icon).toBeLessThanOrEqual(l.cellH);
      if (l.stacked) expect(l.icon + l.countPx + l.namePx).toBeLessThanOrEqual(l.cellH);
      else expect(l.countPx + l.namePx).toBeLessThanOrEqual(l.cellH);
      expect(l.namePx).toBeGreaterThanOrEqual(8);
    }
  });

  it('lays cells out left to right, then down', () => {
    const l = partsLayout(5, W, H);
    expect(partCell(l, 0)).toEqual({ x: 0, y: 0 });
    expect(partCell(l, 2)).toEqual({ x: 2 * l.cellW, y: 0 });
    expect(partCell(l, 3)).toEqual({ x: 0, y: l.cellH });
  });
});
