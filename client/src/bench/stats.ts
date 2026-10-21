/**
 * The numbers a benchmark run is judged by, worked out from what was recorded frame by frame.
 * Pure functions, so they can be tested without a browser.
 */

/** One drawn frame. Times in ms; `t` from the start of the run, to the end of the frame. */
export interface FrameSample {
  t: number;
  /** Time since the frame before: what the player feels. */
  frame: number;
  /** The game's own work this frame, by part. */
  sim: number;
  scene: number;
  draw: number;
  /** The in-tab solo server since the frame before. */
  server: number;
  calls: number;
  triangles: number;
  /** JS heap in MB, or -1 where the browser does not tell (only Chromium does). */
  heap: number;
  /** Index into the run's phases. */
  phase: number;
  /** The profiler's time in each of its sections (the run's `parts`), as the performance panel shows them. */
  parts: number[];
  /** The graphics card's time in each pass (the run's `gpuPasses`); empty where not measured. */
  gpu: number[];
  /** Physics steps taken. */
  steps: number;
  /** A shader program was compiled ('sh' in the panel), new textures or geometry sent ('up'). */
  compiled: boolean;
  uploaded: boolean;
  /** What the renderer holds on the graphics card at the end of the frame. */
  programs: number;
  geometries: number;
  textures: number;
}

export interface Summary {
  frames: number;
  seconds: number;
  /** Frames drawn per second over the whole stretch. */
  avgFps: number;
  /** 99% (99.9%) of frames came faster than this rate. */
  low1: number;
  low01: number;
  /** Frame times (ms) at these percentiles. */
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  /** Frames over 33.3 ms (under 30 fps): the hitches a player notices. */
  stutters: number;
  /** Averages per frame. */
  cpu: number;
  calls: number;
  triangles: number;
  steps: number;
  /** The graphics card's time per frame, over the frames it was measured in; -1 if none were. */
  gpu: number;
  /** Frames in which a shader program was compiled, or new textures or geometry were sent. */
  compiles: number;
  uploads: number;
  /** Average time per frame in each of the profiler's sections. */
  parts: number[];
}

/** The average of each place in the arrays `pick` gives, over those not empty. */
function meanOf(frames: readonly FrameSample[], pick: (f: FrameSample) => number[]): number[] {
  const sum: number[] = [];
  let n = 0;
  for (const f of frames) {
    const v = pick(f);
    if (!v.length) continue;
    n++;
    v.forEach((x, k) => (sum[k] = (sum[k] ?? 0) + x));
  }
  return sum.map((x) => x / n);
}

/** The value `q` (0 to 1) of the way up the sorted values, interpolated between neighbours. */
export function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const at = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

export const STUTTER_MS = 1000 / 30;

export function summarize(frames: readonly FrameSample[]): Summary {
  const n = frames.length;
  const times = frames.map((f) => f.frame).sort((a, b) => a - b);
  const total = times.reduce((s, v) => s + v, 0);
  const mean = (pick: (f: FrameSample) => number) =>
    n ? frames.reduce((s, f) => s + pick(f), 0) / n : 0;
  const fps = (ms: number) => (ms > 0 ? 1000 / ms : 0);
  return {
    frames: n,
    seconds: total / 1000,
    avgFps: total > 0 ? (n * 1000) / total : 0,
    low1: fps(percentile(times, 0.99)),
    low01: fps(percentile(times, 0.999)),
    p50: percentile(times, 0.5),
    p95: percentile(times, 0.95),
    p99: percentile(times, 0.99),
    worst: times[n - 1] ?? 0,
    stutters: times.filter((v) => v > STUTTER_MS).length,
    cpu: mean((f) => f.sim + f.scene + f.draw + f.server),
    calls: mean((f) => f.calls),
    triangles: mean((f) => f.triangles),
    steps: mean((f) => f.steps),
    gpu: frames.some((f) => f.gpu.length)
      ? meanOf(frames, (f) => f.gpu).reduce((a, b) => a + b, 0)
      : -1,
    compiles: frames.filter((f) => f.compiled).length,
    uploads: frames.filter((f) => f.uploaded).length,
    parts: meanOf(frames, (f) => f.parts),
  };
}

/** Averages over a slice of the run, for the graphs. */
export interface Bucket {
  /** Middle of the slice, ms from the start. */
  t: number;
  fps: number;
  frame: number;
  /** The slowest frame in the slice. */
  worst: number;
  sim: number;
  scene: number;
  draw: number;
  server: number;
  calls: number;
  triangles: number;
  /** -1 when unknown. */
  heap: number;
  /** Average time in each of the profiler's sections. */
  parts: number[];
  /** Average graphics card time in each pass, over the frames it was measured in; empty if none. */
  gpu: number[];
}

/**
 * The run cut into slices `ms` long. Frame rate is frames over the time they took, so one slow
 * frame pulls its slice down instead of averaging away. Slices without a frame are left out.
 */
export function buckets(frames: readonly FrameSample[], ms: number): Bucket[] {
  const out: Bucket[] = [];
  let i = 0;
  while (i < frames.length) {
    const slice = Math.floor(frames[i]!.t / ms);
    let j = i;
    let time = 0;
    let worst = 0;
    const sum = { sim: 0, scene: 0, draw: 0, server: 0, calls: 0, triangles: 0, heap: 0 };
    let heapKnown = true;
    for (; j < frames.length && Math.floor(frames[j]!.t / ms) === slice; j++) {
      const f = frames[j]!;
      time += f.frame;
      worst = Math.max(worst, f.frame);
      sum.sim += f.sim;
      sum.scene += f.scene;
      sum.draw += f.draw;
      sum.server += f.server;
      sum.calls += f.calls;
      sum.triangles += f.triangles;
      sum.heap += f.heap;
      if (f.heap < 0) heapKnown = false;
    }
    const n = j - i;
    const inSlice = frames.slice(i, j);
    out.push({
      t: (slice + 0.5) * ms,
      fps: time > 0 ? (n * 1000) / time : 0,
      frame: time / n,
      worst,
      sim: sum.sim / n,
      scene: sum.scene / n,
      draw: sum.draw / n,
      server: sum.server / n,
      calls: sum.calls / n,
      triangles: sum.triangles / n,
      heap: heapKnown ? sum.heap / n : -1,
      parts: meanOf(inSlice, (f) => f.parts),
      gpu: meanOf(inSlice, (f) => f.gpu),
    });
    i = j;
  }
  return out;
}

/** How many frames took each `width` ms band of time; the last band takes everything slower. */
export function histogram(frames: readonly FrameSample[], width: number, bands: number): number[] {
  const counts = new Array<number>(bands).fill(0);
  for (const f of frames) counts[Math.min(bands - 1, Math.floor(f.frame / width))]!++;
  return counts;
}
