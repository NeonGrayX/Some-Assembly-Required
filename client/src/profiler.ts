import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

/**
 * What a frame's time is split into, group by group: each group is its own graph in the
 * performance panel (see `ui/perf.ts`), and the groups together make up the frame.
 */
export const GROUPS = [
  {
    id: 'physics',
    name: 'Physics',
    sections: [
      ['physics.step', 'World step'],
      ['physics.move', 'Character movement'],
      ['physics.query', 'Collision queries'],
    ],
  },
  {
    id: 'logic',
    name: 'Game logic',
    sections: [
      ['logic.input', 'Input'],
      ['logic.rules', 'Game rules'],
      ['logic.net', 'Network and smoothing'],
      ['logic.audio', 'Sound and voice'],
      ['logic.ui', 'Interface'],
      ['logic.perf', 'This panel'],
      ['logic.other', 'Untracked game code'],
    ],
  },
  {
    id: 'scene',
    name: 'Scene update',
    sections: [
      ['scene.camera', 'Camera'],
      ['scene.players', 'Players and animals'],
      ['scene.bricks', 'Bricks and builds'],
      ['scene.props', 'Props, machines and furniture'],
      ['scene.effects', 'Effects'],
      ['scene.level', 'Building the level'],
    ],
  },
  {
    id: 'lighting',
    name: 'Lighting',
    sections: [
      ['light.shadows', 'Shadow maps'],
      ['light.ao', 'Ambient occlusion'],
      ['light.sun', 'Sun and lamps'],
      ['light.trace', 'Ray tracing setup'],
    ],
  },
  {
    id: 'render',
    name: 'Rendering',
    sections: [
      ['render.draw', 'Draw calls'],
      ['render.graph', 'Scene graph'],
      ['render.finish', 'Bloom and grading'],
      ['render.other', 'Other drawing work'],
    ],
  },
] as const;

export type Section = (typeof GROUPS)[number]['sections'][number][0];

/** What the graphics card spent on each pass, measured where the browser can tell. */
export const GPU_SECTIONS = [
  ['gpu.shadows', 'Shadow maps'],
  ['gpu.ao', 'Ambient occlusion'],
  ['gpu.draw', 'Scene'],
  ['gpu.finish', 'Bloom and grading'],
] as const;

/** Every section in one list: a frame's times are stored in this order. */
export const SECTIONS: readonly Section[] = GROUPS.flatMap((g) => g.sections.map((s) => s[0]));
const INDEX = new Map(SECTIONS.map((s, i) => [s, i]));
const at = (s: Section) => INDEX.get(s)!;
const OTHER = at('logic.other');
/** The graphics card pass each section's work is timed as, or -1. */
const GPU_OF = new Int8Array(SECTIONS.length).fill(-1);
GPU_OF[at('light.shadows')] = 0;
GPU_OF[at('light.ao')] = 1;
GPU_OF[at('render.draw')] = 2;
GPU_OF[at('render.finish')] = 3;
/** Sections the renderer's draws count to as they are; any other's draws are draw calls. */
const DRAWING = new Uint8Array(SECTIONS.length);
for (const s of ['light.shadows', 'light.ao', 'render.draw', 'render.finish'] as const)
  DRAWING[at(s)] = 1;

/** How many frames are kept: over ten seconds even at 240 fps. */
export const CAPACITY = 4096;
const NS = SECTIONS.length;
const NG = GPU_SECTIONS.length;

/** Marks a Rapier method already timed, so watching twice does not time it twice. */
const WATCHED = Symbol('profiled');
const watched = new WeakSet<object>();

/** Frame flags. */
export const COMPILED = 1;
export const UPLOADED = 2;

interface Memory {
  usedJSHeapSize: number;
}

/**
 * Work done once rather than every frame, as it happened (`at` is `performance.now()`, ms): the
 * loading screen's steps, the shader programs compiled ahead of drawing (see `Graphics.rewarm`),
 * and the big painted textures (see `paintedOnce`): painted, read back from the browser's
 * storage, or shared from an earlier layout in this visit.
 */
export type PerfEvent =
  | { kind: 'loading'; at: number; ms: number; step: string }
  | { kind: 'shaders'; at: number; ms: number; programs: number; cut: boolean }
  | { kind: 'texture'; at: number; ms: number; key: string; from: 'painted' | 'stored' | 'shared' }
  | { kind: 'stored'; at: number; ms: number; textures: number };

/** How many events are kept: far more than a visit makes, so none drop off in practice. */
const EVENTS = 1000;

/**
 * Times the graphics card's work with the browser's timer queries (EXT_disjoint_timer_query),
 * where it has them. Only one query runs at a time, so a pass inside another (the shadow maps
 * inside the scene's draw) pauses the outer one's and resumes it after. Results come in a few
 * frames late; queries are reused from a fixed ring, so nothing is allocated per frame.
 */
class GpuTimer {
  private static readonly RING = 256;
  private readonly queries: (WebGLQuery | null)[] = new Array<WebGLQuery | null>(
    GpuTimer.RING,
  ).fill(null);
  private readonly frames = new Float64Array(GpuTimer.RING);
  private readonly passes = new Int8Array(GpuTimer.RING);
  /** Waiting for their results: slots `head` up to (not including) `tail`, round the ring. */
  private head = 0;
  private tail = 0;
  private running = false;
  private readonly stack = new Int8Array(16);
  private depth = 0;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number },
    /** Told of each query begun, with its frame: a result for it will come. */
    private readonly started: (frame: number) => void,
  ) {}

  static create(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    started: (frame: number) => void,
  ): GpuTimer | null {
    if (!('createQuery' in gl)) return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
      TIME_ELAPSED_EXT: number;
      GPU_DISJOINT_EXT: number;
    } | null;
    return ext ? new GpuTimer(gl, ext, started) : null;
  }

  push(pass: number, frame: number): void {
    this.stop();
    if (this.depth < this.stack.length) this.stack[this.depth] = pass;
    this.depth++;
    this.run(frame);
  }

  pop(frame: number): void {
    this.stop();
    if (this.depth > 0) this.depth--;
    if (this.depth > 0 && this.depth <= this.stack.length) this.run(frame);
  }

  /** Ends whatever is running, as a frame ends. */
  reset(): void {
    this.stop();
    this.depth = 0;
  }

  /** Hands over every result that is in, oldest first, with its frame and pass: NaN if spoilt. */
  collect(write: (frame: number, pass: number, ms: number) => void): void {
    if (this.head === this.tail) return;
    const gl = this.gl;
    // A disjoint (the clock jumped: power saving, another app) spoils whatever is waiting.
    const spoilt = !!gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.head !== this.tail) {
      const q = this.queries[this.head]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      write(this.frames[this.head]!, this.passes[this.head]!, spoilt ? NaN : ns / 1e6);
      this.head = (this.head + 1) % GpuTimer.RING;
    }
  }

  private run(frame: number): void {
    const next = (this.tail + 1) % GpuTimer.RING;
    // Full: results are not coming back (a lost context). Measure nothing until they do.
    if (next === this.head) return;
    const q = (this.queries[this.tail] ??= this.gl.createQuery());
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.frames[this.tail] = frame;
    this.passes[this.tail] = this.stack[this.depth - 1]!;
    this.tail = next;
    this.running = true;
    this.started(frame);
  }

  private stop(): void {
    if (!this.running) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.running = false;
  }
}

/**
 * Where each frame's time goes, section by section, for the performance panel. A page marks
 * its frame with `frameStart` and `frameEnd`, and the code in between marks what it is doing
 * with `begin` and `end` (or `next`, for one part after another). Time counts to the innermost
 * section open, so nothing is counted twice and the sections add up to the frame; time in none
 * counts as untracked. The renderer, its shadow maps, the scene graph and Rapier are timed from
 * the outside (`watchRenderer`, `watchPhysics`), so the game's code only marks its own parts.
 *
 * Outside a frame nothing is measured: the in-tab solo server runs between frames, with the
 * same Rapier, and is counted on its own.
 */
export class Profiler {
  /** When each frame began (the animation frame's time, ms). */
  readonly start = new Float64Array(CAPACITY);
  /** How long until the next frame began (ms): NaN for the newest, until it has. */
  readonly gap = new Float32Array(CAPACITY).fill(NaN);
  /** How long the in-tab solo server ran during each frame's gap (ms). */
  readonly server = new Float32Array(CAPACITY);
  /** Each frame's time in each section (ms), `SECTIONS.length` to a frame. */
  readonly cpu = new Float32Array(CAPACITY * NS);
  /**
   * Each frame's graphics card time in each pass (ms), or NaN where it was not measured (or a
   * result was spoilt). Counts up as results come in, a few frames late: see `gpuWaiting`.
   */
  readonly gpu = new Float32Array(CAPACITY * NG).fill(NaN);
  /** How many of each frame's graphics card results are still to come in. */
  readonly gpuWaiting = new Uint16Array(CAPACITY);
  readonly calls = new Uint32Array(CAPACITY);
  readonly triangles = new Float32Array(CAPACITY);
  /** Physics steps taken in each frame. */
  readonly steps = new Uint16Array(CAPACITY);
  /** `COMPILED` and `UPLOADED`. */
  readonly flags = new Uint8Array(CAPACITY);
  /** The page's JavaScript heap at the end of each frame (MB), or NaN where not reported. */
  readonly heap = new Float32Array(CAPACITY).fill(NaN);
  /** Frames recorded so far: frame `n` is stored at `n % CAPACITY`. */
  count = 0;
  /**
   * When the browser did a full garbage collection, the kind that can take tens of ms. A
   * throwaway object is watched; once the collector frees it a callback notes the time and a
   * new one is planted. Browsers only free watched objects in full collections, so the
   * frequent small ones (a millisecond or two) are not seen.
   */
  readonly gcTimes: number[] = [];
  /** Whether to time the graphics card too: only while someone is looking (it costs a little). */
  gpuTiming = false;
  /** Whether a benchmark run is recording the graphics card's time, panel open or not. */
  gpuRecording = false;
  /** Work done once, oldest first (see `PerfEvent`). */
  readonly events: PerfEvent[] = [];

  private active = false;
  private slot = 0;
  private began = 0;
  private since = 0;
  private readonly stack = new Int16Array(64);
  private readonly gpuStack = new Uint8Array(64);
  private depth = 0;
  private timer: GpuTimer | null = null;
  private timing = false;
  private renderer: THREE.WebGLRenderer | null = null;
  private seen = { programs: 0, geometries: 0, textures: 0 };
  private gcPlanted = false;
  private readonly gcWatch = new FinalizationRegistry<null>(() => {
    this.gcTimes.push(performance.now());
    this.gcPlanted = false;
  });

  /** Whether the graphics card's time can be measured in this browser. */
  get gpuSupported(): boolean {
    return this.timer !== null;
  }

  /** The watched renderer's count of what it holds on the graphics card. */
  get resources(): { geometries: number; textures: number; programs: number } | null {
    const r = this.renderer;
    if (!r) return null;
    return { ...r.info.memory, programs: r.info.programs?.length ?? 0 };
  }

  /** Call first thing in every frame, with how long the in-tab solo server ran since the last. */
  frameStart(now: number, serverMs = 0): void {
    if (this.active) this.frameEnd();
    const n = this.count;
    if (n > 0) {
      const p = (n - 1) % CAPACITY;
      this.gap[p] = now - this.start[p]!;
      this.server[p] = this.server[p]! + serverMs;
    }
    const i = (this.slot = n % CAPACITY);
    this.start[i] = now;
    this.gap[i] = NaN;
    this.server[i] = 0;
    this.cpu.fill(0, i * NS, (i + 1) * NS);
    this.calls[i] = 0;
    this.triangles[i] = 0;
    this.steps[i] = 0;
    this.flags[i] = 0;
    this.heap[i] = NaN;
    this.timing = (this.gpuTiming || this.gpuRecording) && this.timer !== null;
    this.gpu.fill(this.timing ? 0 : NaN, i * NG, (i + 1) * NG);
    this.gpuWaiting[i] = 0;
    this.count++;
    this.timer?.collect(this.writeGpu);

    while (this.gcTimes.length && this.gcTimes[0]! < now - 60_000) this.gcTimes.shift();
    if (!this.gcPlanted) {
      this.gcWatch.register({}, null);
      this.gcPlanted = true;
    }
    this.depth = 0;
    this.active = true;
    this.began = this.since = performance.now();
  }

  /** Call last thing in every frame. */
  frameEnd(): void {
    if (!this.active) return;
    while (this.depth) this.end();
    const t = performance.now();
    const base = this.slot * NS;
    let sum = 0;
    for (let s = 0; s < NS; s++) sum += this.cpu[base + s]!;
    this.cpu[base + OTHER] = this.cpu[base + OTHER]! + Math.max(0, t - this.began - sum);
    this.timer?.reset();
    const r = this.renderer;
    if (r) {
      const programs = r.info.programs?.length ?? 0;
      const { geometries, textures } = r.info.memory;
      let flags = 0;
      if (programs > this.seen.programs) flags |= COMPILED;
      if (geometries > this.seen.geometries || textures > this.seen.textures) flags |= UPLOADED;
      this.flags[this.slot] = flags;
      this.seen.programs = programs;
      this.seen.geometries = geometries;
      this.seen.textures = textures;
    }
    const memory = (performance as Performance & { memory?: Memory }).memory;
    if (memory) this.heap[this.slot] = memory.usedJSHeapSize / 2 ** 20;
    this.active = false;
  }

  /** Notes work done once (see `PerfEvent`). */
  note(e: PerfEvent): void {
    if (this.events.length >= EVENTS) this.events.shift();
    this.events.push(e);
  }

  /** Starts timing `section`, inside whatever section is open. */
  begin(section: Section): void {
    if (!this.active) return;
    this.open(at(section));
  }

  /** Stops timing the innermost section open, and goes back to the one around it. */
  end(): void {
    if (!this.active || !this.depth) return;
    const t = performance.now();
    const s = this.stack[--this.depth]!;
    const k = this.slot * NS + s;
    this.cpu[k] = this.cpu[k]! + (t - this.since);
    this.since = t;
    if (this.gpuStack[this.depth] && this.timer) this.timer.pop(this.count - 1);
  }

  /** Ends the innermost section and begins `section` in its place. */
  next(section: Section): void {
    this.end();
    this.begin(section);
  }

  /**
   * Times what `renderer` does: its draws (with the counts of draw calls and triangles), its
   * shadow maps and the scene graph's matrices, and the graphics card's time for each pass.
   */
  watchRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers' own `this` is the timed object
    const p = this;
    if (!watched.has(scene)) {
      watched.add(scene);
      const graph = scene.updateMatrixWorld;
      scene.updateMatrixWorld = function (force) {
        if (!p.active) return graph.call(this, force);
        p.begin('render.graph');
        try {
          graph.call(this, force);
        } finally {
          p.end();
        }
      };
    }
    if (watched.has(renderer)) return;
    watched.add(renderer);
    this.renderer ??= renderer;
    this.timer ??= GpuTimer.create(renderer.getContext(), (frame) => {
      this.gpuWaiting[frame % CAPACITY]!++;
    });
    const render = renderer.render;
    renderer.render = function (s, c) {
      if (!p.active) return render.call(this, s, c);
      const info = renderer.info.render;
      // Reset as each draw starts, unless the page counts over the whole frame itself.
      const calls = renderer.info.autoReset ? 0 : info.calls;
      const triangles = renderer.info.autoReset ? 0 : info.triangles;
      const draws = !p.depth || !DRAWING[p.stack[p.depth - 1]!];
      if (draws) p.begin('render.draw');
      try {
        render.call(this, s, c);
      } finally {
        if (draws) p.end();
        p.calls[p.slot] = p.calls[p.slot]! + info.calls - calls;
        p.triangles[p.slot] = p.triangles[p.slot]! + info.triangles - triangles;
      }
    };
    const shadows = renderer.shadowMap.render;
    renderer.shadowMap.render = function (lights, s, c) {
      const idle = !this.enabled || lights.length === 0 || (!this.autoUpdate && !this.needsUpdate);
      if (!p.active || idle) return shadows.call(this, lights, s, c);
      p.begin('light.shadows');
      try {
        shadows.call(this, lights, s, c);
      } finally {
        p.end();
      }
    };
  }

  /** Times Rapier: its steps, its character controllers and the queries made of its worlds. */
  watchPhysics(R: typeof RAPIER): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers' own `this` is the timed object
    const p = this;
    const wrap = (proto: object, names: string[], section: Section, step = false) => {
      const o = proto as Record<string, unknown>;
      for (const name of names) {
        const f = o[name] as ((...a: unknown[]) => unknown) & { [WATCHED]?: true };
        if (typeof f !== 'function' || f[WATCHED]) continue;
        const timed = function (this: unknown) {
          // eslint-disable-next-line prefer-rest-params -- passed straight on, not copied
          if (!p.active) return f.apply(this, arguments as unknown as unknown[]);
          if (step) p.steps[p.slot]!++;
          p.begin(section);
          try {
            // eslint-disable-next-line prefer-rest-params -- as above
            return f.apply(this, arguments as unknown as unknown[]);
          } finally {
            p.end();
          }
        };
        (timed as unknown as { [WATCHED]: true })[WATCHED] = true;
        o[name] = timed;
      }
    };
    wrap(R.PhysicsPipeline.prototype, ['step'], 'physics.step', true);
    wrap(R.KinematicCharacterController.prototype, ['computeColliderMovement'], 'physics.move');
    wrap(
      R.World.prototype,
      [
        'castRay',
        'castRayAndGetNormal',
        'castShape',
        'intersectionWithShape',
        'intersectionsWithRay',
        'intersectionsWithShape',
        'intersectionsWithPoint',
        'projectPoint',
        'contactPair',
        'contactPairsWith',
      ],
      'physics.query',
    );
  }

  private open(s: number): void {
    if (this.depth >= this.stack.length) return;
    const t = performance.now();
    if (this.depth) {
      const k = this.slot * NS + this.stack[this.depth - 1]!;
      this.cpu[k] = this.cpu[k]! + (t - this.since);
    }
    this.since = t;
    const pass = this.timing ? GPU_OF[s]! : -1;
    this.gpuStack[this.depth] = pass >= 0 ? 1 : 0;
    this.stack[this.depth++] = s;
    if (pass >= 0) this.timer!.push(pass, this.count - 1);
  }

  private readonly writeGpu = (frame: number, pass: number, ms: number): void => {
    if (frame <= this.count - CAPACITY) return;
    const i = frame % CAPACITY;
    if (this.gpuWaiting[i]) this.gpuWaiting[i]!--;
    // A spoilt result spoils the frame's every pass: its parts would not add up.
    if (Number.isNaN(ms)) this.gpu.fill(NaN, i * NG, (i + 1) * NG);
    else this.gpu[i * NG + pass] = this.gpu[i * NG + pass]! + ms;
  };
}

/** The page's one profiler. */
export const profiler = new Profiler();
