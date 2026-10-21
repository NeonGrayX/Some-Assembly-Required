import type { MapId } from '@sar/shared';
import type * as THREE from 'three';
import type { GraphicsSettings } from '../graphics-settings.ts';
import {
  CAPACITY,
  COMPILED,
  GPU_SECTIONS,
  GROUPS,
  SECTIONS,
  UPLOADED,
  profiler,
} from '../profiler.ts';
import type { PerfEvent } from '../profiler.ts';
import { BenchBot } from './bot.ts';
import type { BotHost, Tally } from './bot.ts';
import type { FrameSample } from './stats.ts';

/** Everything a finished (or stopped) run measured. */
export interface BenchResult {
  date: string;
  version: string;
  stopped: boolean;
  /** The maps the run visited, in order. */
  maps: MapId[];
  frames: FrameSample[];
  phases: string[];
  /** What each frame's `parts` are, in order: the performance panel's sections. */
  parts: { id: string; name: string; group: string }[];
  /** What each frame's `gpu` passes are, in order. */
  gpuPasses: { id: string; name: string }[];
  /**
   * Work done once: the loading screen's steps, shaders compiled ahead of drawing, and the big
   * painted textures (painted, read back from the browser, or shared). `t` is ms from the start
   * of the run, negative for what happened before it (as the page loaded).
   */
  work: (PerfEvent & { t: number })[];
  /** When the browser did a full garbage collection, ms from the start. */
  gcs: number[];
  /** Tasks over 50 ms the browser reported (Chromium only), ms from the start. */
  longTasks: { t: number; ms: number }[];
  interactions: { label: string; tries: number; hits: number }[];
  system: {
    gpu: string;
    browser: string;
    screen: string;
    pixelRatio: number;
    cores: number;
    graphics: GraphicsSettings;
    /** Whether the browser can time the graphics card (EXT_disjoint_timer_query). */
    gpuTimed: boolean;
  };
}

/** Frames' graphics card times come in a few frames late; they are read this many frames on. */
const GPU_LAG = 120;
/** Times kept to the microsecond: the profiler's single floats would print to 17 digits. */
const round = (v: number) => Math.round(v * 1000) / 1000;

/** The run's names for the profiler's sections and passes. */
const PARTS = GROUPS.flatMap((g) => g.sections.map(([id, name]) => ({ id, name, group: g.name })));
const NS = SECTIONS.length;
const NG = GPU_SECTIONS.length;

/** Where the time of one frame went, as the game's frame loop measured it. */
export interface FrameWork {
  started: number;
  simulated: number;
  synced: number;
  done: number;
  /** The in-tab solo server since the frame before. */
  server: number;
}

function gpuName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

/**
 * A benchmark run: the bot plays while every frame is recorded, with a line at the top saying
 * what it is doing. It is the same run every time on each map it visits, and the player cannot
 * steer it (see `Input.driven`), so runs on different machines and builds compare. Esc stops it
 * early; what was recorded so far is still reported.
 */
export class Benchmark {
  readonly bot: BenchBot;
  private readonly input: BotHost['input'];
  private readonly frames: FrameSample[] = [];
  /** The profiler's number for each recorded frame whose graphics card time is still to read. */
  private readonly gpuWaiting: { frame: FrameSample; n: number }[] = [];
  private readonly gcs: number[] = [];
  private readonly longTasks: { t: number; ms: number }[] = [];
  private gcPlanted = false;
  private readonly gcWatch = new FinalizationRegistry<null>(() => {
    if (this.start) this.gcs.push(performance.now() - this.start);
    this.gcPlanted = false;
  });
  private observer: PerformanceObserver | null = null;
  private start = 0;
  private last = 0;
  private finished = false;
  private stopped = false;
  private readonly hud: HTMLElement;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    this.stopped = true;
    this.finish();
  };

  constructor(
    host: BotHost,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly graphics: GraphicsSettings,
    private readonly maps: readonly MapId[],
    private readonly onDone: (result: BenchResult) => void,
  ) {
    this.bot = new BenchBot(host, maps);
    this.input = host.input;
    this.input.driven = true;
    this.hud = document.createElement('div');
    this.hud.id = 'bench-hud';
    document.body.append(this.hud);
    document.body.classList.add('benchmarking');
    window.addEventListener('keydown', this.onKey);
    // Draw calls and triangles are added up over every pass of a frame (shadows, occlusion,
    // ink), and cleared before the frame instead of before each pass.
    renderer.info.autoReset = false;
    profiler.gpuRecording = true;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (this.start) this.longTasks.push({ t: e.startTime - this.start, ms: e.duration });
        }
      });
      this.observer.observe({ type: 'longtask', buffered: false });
    } catch {
      // Not in this browser.
      this.observer = null;
    }
  }

  /** Call every frame after the keyboard is read and before the game ticks. */
  drive(now: number): void {
    if (this.finished) return;
    if (!this.start) this.start = this.last = now;
    // Capped as the game caps a frame's step, so a stall does not skip a whole move.
    this.bot.step(Math.min(0.25, (now - this.last) / 1000));
    if (this.bot.done) this.finish();
  }

  /** Call just before the frame is drawn. */
  beforeDraw(): void {
    this.renderer.info.reset();
  }

  /** Call at the very end of every frame. */
  sample(now: number, w: FrameWork): void {
    if (this.finished || !this.start) return;
    const frame = now - this.last;
    this.last = now;
    if (frame <= 0) return;
    const info = this.renderer.info.render;
    const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
    // The profiler's frame just ended (see main's frame loop): its parts are all in.
    const n = profiler.count - 1;
    const i = n % CAPACITY;
    const parts = new Array<number>(NS);
    for (let s = 0; s < NS; s++) parts[s] = round(profiler.cpu[i * NS + s]!);
    const flags = profiler.flags[i]!;
    const held = profiler.resources;
    const sample: FrameSample = {
      t: w.done - this.start,
      frame,
      sim: w.simulated - w.started,
      scene: w.synced - w.simulated,
      draw: w.done - w.synced,
      server: w.server,
      calls: info.calls,
      triangles: info.triangles,
      heap: memory ? memory.usedJSHeapSize / 2 ** 20 : -1,
      phase: Math.max(0, this.bot.phase),
      parts,
      gpu: [],
      steps: profiler.steps[i]!,
      compiled: !!(flags & COMPILED),
      uploaded: !!(flags & UPLOADED),
      programs: held?.programs ?? 0,
      geometries: held?.geometries ?? 0,
      textures: held?.textures ?? 0,
    };
    this.frames.push(sample);
    if (profiler.gpuSupported) this.gpuWaiting.push({ frame: sample, n });
    this.readGpu(n - GPU_LAG);
    if (!this.gcPlanted) {
      this.gcWatch.register({}, null);
      this.gcPlanted = true;
    }
    const secs = Math.floor((w.done - this.start) / 1000);
    const text =
      `Benchmark · ${this.bot.phaseName} · ${Math.floor(secs / 60)}:` +
      `${String(secs % 60).padStart(2, '0')} · Esc stops it`;
    if (this.hud.textContent !== text) this.hud.textContent = text;
  }

  /** Fills in the graphics card's times of the frames waiting, up to the profiler's `upTo`. */
  private readGpu(upTo: number): void {
    const w = this.gpuWaiting;
    let k = 0;
    // Older than the profiler keeps are lost; they stay unmeasured.
    for (; k < w.length && w[k]!.n <= upTo; k++) {
      const { frame, n } = w[k]!;
      if (n <= profiler.count - CAPACITY) continue;
      const base = (n % CAPACITY) * NG;
      const gpu = Array.from(profiler.gpu.subarray(base, base + NG), round);
      if (!gpu.some(Number.isNaN)) frame.gpu = gpu;
    }
    w.splice(0, k);
  }

  /** Leaves without a report (the player went back to the menu). */
  cancel(): void {
    this.finished = true;
    this.cleanUp();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.cleanUp();
    // The newest few frames' times may not be in yet; those stay unmeasured.
    this.readGpu(Infinity);
    const interactions = [...this.bot.tally].map(([label, t]: [string, Tally]) => ({
      label,
      ...t,
    }));
    this.onDone({
      date: new Date().toISOString(),
      version: __APP_VERSION__,
      stopped: this.stopped,
      maps: [...this.maps],
      // The first frame's gap counts from before the run.
      frames: this.frames.slice(1),
      phases: [...this.bot.phases],
      parts: PARTS,
      gpuPasses: GPU_SECTIONS.map(([id, name]) => ({ id, name })),
      work: profiler.events.map((e) => ({
        ...e,
        t: round(e.at - this.start),
        at: round(e.at),
        ms: round(e.ms),
      })),
      gcs: this.gcs,
      longTasks: this.longTasks,
      interactions,
      system: {
        gpu: gpuName(this.renderer),
        browser: navigator.userAgent,
        screen: `${screen.width}×${screen.height}, drawn at ${this.renderer.domElement.width}×${this.renderer.domElement.height}`,
        pixelRatio: window.devicePixelRatio,
        cores: navigator.hardwareConcurrency ?? 0,
        graphics: { ...this.graphics },
        gpuTimed: profiler.gpuSupported,
      },
    });
  }

  private cleanUp(): void {
    this.bot.stop();
    this.input.driven = false;
    this.observer?.disconnect();
    profiler.gpuRecording = false;
    this.renderer.info.autoReset = true;
    window.removeEventListener('keydown', this.onKey);
    this.hud.remove();
    document.body.classList.remove('benchmarking');
  }
}
