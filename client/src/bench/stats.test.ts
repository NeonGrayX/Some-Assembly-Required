import { describe, expect, it } from 'vitest';
import { buckets, histogram, percentile, summarize } from './stats.ts';
import type { FrameSample } from './stats.ts';

/** Frames of the given times, one after another. */
function run(times: number[]): FrameSample[] {
  let t = 0;
  return times.map((frame) => {
    t += frame;
    return {
      t,
      frame,
      sim: 1,
      scene: 2,
      draw: 3,
      server: 0.5,
      calls: 100,
      triangles: 5000,
      heap: 50,
      phase: 0,
    };
  });
}

describe('benchmark numbers', () => {
  it('interpolates percentiles between neighbours', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('sums up a steady run with a hitch in it', () => {
    const s = summarize(run([...new Array<number>(99).fill(10), 100]));
    expect(s.frames).toBe(100);
    expect(s.seconds).toBeCloseTo(1.09);
    expect(s.avgFps).toBeCloseTo(100 / 1.09);
    expect(s.p50).toBe(10);
    expect(s.worst).toBe(100);
    expect(s.stutters).toBe(1);
    // The one slow frame sits just past the 99th percentile, so the 1% low is pulled down.
    expect(s.low1).toBeLessThan(100);
    expect(s.low01).toBeCloseTo(1000 / percentile([...new Array<number>(99).fill(10), 100], 0.999));
    expect(s.cpu).toBeCloseTo(6.5);
  });

  it('cuts a run into slices, a slow frame dragging its slice down', () => {
    const b = buckets(run([10, 10, 10, 10, 10, 50, 10, 10]), 50);
    expect(b.map((x) => x.t)).toEqual([25, 75, 125]);
    expect(b[0]!.fps).toBeCloseTo(100);
    // The slow frame ends at 100 ms, in the third slice.
    expect(b[2]!.worst).toBe(50);
    expect(b[2]!.fps).toBeCloseTo(3000 / 70);
  });

  it('counts frames into bands, the slowest into the last', () => {
    expect(histogram(run([1, 4, 6, 99]), 5, 3)).toEqual([2, 1, 1]);
  });
});
