import { describe, expect, it } from 'vitest';
import { paint, paintingSize, stretched } from './paint.ts';
import type { PaintJob } from './paint.ts';
import { paintedOnce } from './kit.ts';

const MOSS: PaintJob = {
  kind: 'moss',
  outline: [
    [0, 0],
    [2, 0],
    [2, 1.5],
    [0, 1.5],
  ],
  rect: [-0.9, -0.9, 3.8, 3.3],
  perMetre: 32,
};

const PAVING: PaintJob = { kind: 'paving', w: 3, d: 1.2, perMetre: 40, seed: 201 };

describe('the big painted textures', () => {
  it('are as big as their jobs say, at their own fineness or a rough one', () => {
    for (const job of [MOSS, PAVING]) {
      const [width, height] = paintingSize(job);
      const fine = paint(job);
      expect([fine.width, fine.height]).toEqual([width, height]);
      expect(fine.data.length).toBe(width * height * 4);
      const rough = paint(job, job.perMetre / 8);
      expect(rough.width).toBeLessThan(width);
      expect(rough.height).toBeLessThan(height);
    }
  });

  it('stretch a rough copy over the whole, each pixel the nearest of its own', () => {
    const p = { data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), width: 2, height: 1 };
    const s = stretched(p, 4, 2);
    expect([s.width, s.height]).toEqual([4, 2]);
    expect([...s.data.slice(0, 16)]).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8]);
    expect([...s.data.slice(16)]).toEqual([...s.data.slice(0, 16)]);
  });

  it('are painted at once where there are no workers, and shared after', () => {
    const t = paintedOnce(PAVING);
    expect(t.image.data).toEqual(paint(PAVING).data);
    expect(paintedOnce({ ...PAVING })).toBe(t);
  });
});
