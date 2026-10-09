import { describe, expect, it } from 'vitest';
import { indexLayout } from './indexLayout.ts';
import type { IndexEntry, Measure } from './indexLayout.ts';

/** About how wide system-ui prints: a bit over half the font size per character. */
const measure: Measure = (text, px, bold) => text.length * px * (bold ? 0.6 : 0.55);

/** The master index's box below its heading. */
const W = 552;
const H = 710;

const entries = (pages: number, kinds: number): IndexEntry[] =>
  Array.from({ length: pages }, (_, i) => ({
    label: `Page ${i + 1}`,
    parts: Array.from({ length: kinds }, (_, k) => `${k + 1}× light grey plate2x4`),
  }));

describe('indexLayout', () => {
  it('prints a short manual big, in one column', () => {
    const l = indexLayout(entries(8, 3), measure, W, H);
    expect(l.fits).toBe(true);
    expect(l.columns).toBe(1);
    expect(l.px).toBe(18);
  });

  it('fits 32 pages of up to 8 kinds each', () => {
    for (const kinds of [1, 4, 6, 8]) {
      const l = indexLayout(entries(32, kinds), measure, W, H);
      expect(l.fits, `32 pages of ${kinds} kinds`).toBe(true);
      expect(l.px).toBeGreaterThanOrEqual(7);
    }
  });

  it('leaves the last pages off, inside the box, when even the smallest print is too big', () => {
    const l = indexLayout(entries(32, 20), measure, W, H);
    expect(l.fits).toBe(false);
    expect(l.fitsWidth).toBe(true);
    for (const t of l.texts) {
      expect(t.x + measure(t.text, l.px, t.bold)).toBeLessThanOrEqual(W + 0.001);
      expect(t.y + l.px).toBeLessThanOrEqual(H);
    }
  });

  it('keeps every line inside the box', () => {
    for (const [pages, kinds] of [
      [16, 4],
      [32, 6],
      [24, 8],
      [32, 20],
    ] as const) {
      const l = indexLayout(entries(pages, kinds), measure, W, H);
      for (const t of l.texts) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + measure(t.text, l.px, t.bold)).toBeLessThanOrEqual(W + 0.001);
        expect(t.y + l.px).toBeLessThanOrEqual(H);
      }
    }
  });

  it('labels every page once and keeps every part', () => {
    const e = entries(20, 5);
    const l = indexLayout(e, measure, W, H);
    expect(l.texts.filter((t) => t.bold).map((t) => t.text)).toEqual(e.map((x) => x.label));
    const printed = l.texts
      .filter((t) => !t.bold)
      .map((t) => t.text)
      .join(' ');
    for (const part of e[0]!.parts) expect(printed).toContain(part);
  });
});
