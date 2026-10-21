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
      parts: [0.5, 1, 0.25],
      gpu: [2, 3],
      steps: 1,
      compiled: false,
      uploaded: false,
      programs: 40,
      geometries: 300,
      textures: 20,
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

  it('sums up the profiler’s parts, the graphics card where it was measured, and the hitches', () => {
    const frames = run([10, 10, 10, 10]);
    frames[0]!.compiled = true;
    frames[1]!.uploaded = frames[1]!.compiled = true;
    frames[2]!.gpu = [];
    frames[3]!.gpu = [4, 6];
    frames[3]!.parts = [1.5, 3, 0.25];
    const s = summarize(frames);
    expect(s.parts).toEqual([0.75, 1.5, 0.25]);
    // Over the three frames it was measured in: (5 + 5 + 10) / 3.
    expect(s.gpu).toBeCloseTo(20 / 3);
    expect(s.steps).toBe(1);
    expect(s.compiles).toBe(2);
    expect(s.uploads).toBe(1);
    const b = buckets(frames, 20);
    expect(b[0]!.parts).toEqual([0.5, 1, 0.25]);
    // The second slice's unmeasured frame is left out of its average.
    expect(b[1]!.gpu).toEqual([2, 3]);
    expect(b[2]!.gpu).toEqual([4, 6]);
    for (const f of frames) f.gpu = [];
    expect(summarize(frames).gpu).toBe(-1);
    expect(buckets(frames, 20)[0]!.gpu).toEqual([]);
  });

  it('counts frames into bands, the slowest into the last', () => {
    expect(histogram(run([1, 4, 6, 99]), 5, 3)).toEqual([2, 1, 1]);
  });
});
