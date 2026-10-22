import {
  CAPACITY,
  COMPILED,
  GPU_SECTIONS,
  GROUPS,
  SECTIONS,
  UPLOADED,
  profiler,
} from '../profiler.ts';

/** How far back the graphs reach. */
const WINDOW_MS = 10_000;
/** Frames are averaged over slices this long for the frame rate, so a slow frame still dips. */
const SLICE_MS = 100;
const WIDTH = 280;
const HEIGHT = 64;
/** Room on the right of the plot for the axis labels. */
const AXIS = 30;
const PLOT = WIDTH - AXIS;
/** The time a frame has at 60 fps, dashed across the frame time graph. */
const BUDGET = 1000 / 60;
/** The rows under the frame time graph marking what may have caused a hitch. */
const LANES = ['gc', 'sh', 'up'] as const;
const LANE = 6;
const STORE = 'sar.perf.open';
/** Where the card was dragged to, and whether it shows one column or two. */
const LAYOUT = 'sar.perf.layout';
/** Kept clear between the card and the window's edges. */
const EDGE = 8;
/** How much of the card stays on screen when it is dragged towards an edge: its title bar. */
const GRIP = 40;

const NS = SECTIONS.length;
const NG = GPU_SECTIONS.length;

interface Point {
  at: number;
  v: number;
}

interface Line {
  canvas: HTMLCanvasElement;
  colour: string;
  unit: string;
  /** The value axis never shrinks below this, so a steady 60 fps does not look jumpy. */
  floor: number;
  points: Point[];
}

interface Series {
  name: string;
  colour: string;
  value: (i: number) => number;
  avg: HTMLElement;
  max: HTMLElement;
}

/** A graph of frames' times, each frame's parts stacked: where each frame's time went. */
interface Stack {
  canvas: HTMLCanvasElement;
  height: number;
  series: Series[];
  floor: number;
  /** The frame time graph, with the 60 fps budget and the hitch lanes. */
  overview: boolean;
  heads: [HTMLElement, HTMLElement];
  /** The frame drawn in each pixel column: the one with the most time in it. */
  columns: Int32Array;
  /** The most time in a frame over the window, as `avgMax` last found it. */
  peak: number;
}

/**
 * Where the card sits, measured from the window's nearer edges, so it grows away from them: a card
 * dragged to the bottom right opens its graphs upwards and its second column leftwards.
 */
interface Spot {
  h: 'left' | 'right';
  x: number;
  v: 'top' | 'bottom';
  y: number;
}

interface Layout {
  /** Null until the card is first dragged: it sits where the page's styles put it. */
  spot: Spot | null;
  columns: 1 | 2;
}

/** One collapsible graph: its summary line and what draws it while it is open. */
interface Group {
  id: string;
  el: HTMLDetailsElement;
  readout: HTMLElement;
  draw: (now: number) => void;
  summary: (now: number) => string;
}

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A round number at or above `v`: 1, 2 or 5 times a power of ten. */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-3)));
  return [1, 2, 5, 10].map((m) => m * p).find((n) => n >= v)!;
}

const ms = (v: number) => (v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : `${Math.round(v)}`);

/** The time of the frame at `i`, with the server's and the browser's left out. */
function cpuTotal(i: number): number {
  let sum = 0;
  for (let s = 0; s < NS; s++) sum += profiler.cpu[i * NS + s]!;
  return sum;
}

/** What the frame at `i` waited on that the game does not do: the browser, the driver, others. */
function outside(i: number): number {
  return Math.max(0, profiler.gap[i]! - cpuTotal(i) - profiler.server[i]!);
}

/**
 * Click the fps counter for the last ten seconds of frames: the frame rate, where each frame's
 * time went (physics, game logic, the scene, lighting, rendering, the solo server, and what is
 * outside the game), and a graph for each of those broken down further, with the graphics
 * card's time, ping and memory. Each graph folds away; hover any of them to read one moment.
 * The card drags by its title bar and shows the whole frame beside its breakdowns, or all in one
 * column.
 */
export class PerfPanel {
  private readonly el: HTMLElement;
  /** The graphs: the whole frame in the first column, its breakdowns in the second. */
  private readonly cols: HTMLElement;
  private readonly sides: [HTMLElement, HTMLElement];
  /** The column the next group goes in. */
  private side = 0;
  private layout: Layout = { spot: null, columns: 2 };
  private readonly groups: Group[] = [];
  private readonly fps: Line;
  private readonly ping: Line;
  private readonly heap: Line;
  private readonly graphics: Line;
  private readonly slowest: HTMLElement;
  /** Where the pointer is over a graph (px from the left of the plot), for every graph alike. */
  private hoverX: number | null = null;
  private lastDraw = 0;
  private isOpen = false;
  /** The frames in the window: `from` up to (not including) `to`, as the profiler counts them. */
  private from = 0;
  private to = 0;

  constructor(
    status: HTMLElement,
    /** Measured round trips, or null in a solo game (no network to measure). */
    private readonly pings: () => { at: number; ms: number }[] | null,
    /** False on pages without a game, which have no server or ping to show. */
    private readonly inGame = true,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.hidden = true;
    this.cols = this.card();
    this.sides = [document.createElement('div'), document.createElement('div')];
    for (const side of this.sides) side.className = 'perf-col';
    this.cols.append(...this.sides);
    let shown: string[] = ['fps', 'frame'];
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as unknown;
      if (Array.isArray(saved)) shown = saved.filter((s): s is string => typeof s === 'string');
    } catch {
      // Private browsing or blocked storage: the default graphs open.
    }
    const slot = (k: number) => css(`--perf-${k + 1}`);
    const rest = css('--perf-rest');

    // Frame rate.
    const fpsBody = this.group('fps', 'Frame rate', css('--perf-fps'), shown, (now) => {
      this.fps.points = this.frameRates(now);
      this.drawLine(this.fps, now);
    });
    this.fps = this.line(fpsBody, css('--perf-fps'), 'fps', 60);
    this.groups.at(-1)!.summary = () => {
      const p = this.fps.points;
      if (!p.length) return '';
      return `now ${Math.round(p.at(-1)!.v)} · low ${Math.round(Math.min(...p.map((x) => x.v)))} fps`;
    };

    // Where the whole frame went: each group's total, stacked.
    const groupSeries = GROUPS.map((g, k) => {
      const from = SECTIONS.indexOf(g.sections[0][0]);
      const to = from + g.sections.length;
      return {
        name: g.name,
        colour: slot(k),
        value: (i: number) => {
          let sum = 0;
          for (let s = from; s < to; s++) sum += profiler.cpu[i * NS + s]!;
          return sum;
        },
      };
    });
    const frameParts = [
      ...groupSeries,
      ...(inGame
        ? [{ name: 'Solo server', colour: slot(5), value: (i: number) => profiler.server[i]! }]
        : []),
      { name: 'Outside the game', colour: rest, value: outside },
    ];
    const frameBody = this.group('frame', 'Frame time', '', shown, (now) =>
      this.drawStack(frame, now),
    );
    const frame = this.stack(frameBody, frameParts, 20, true);
    this.groups.at(-1)!.summary = () => this.avgMax(frame);
    this.note(
      frameBody,
      'Dashed: the 60 fps budget. Outside the game: the browser, garbage collection, waiting ' +
        'on the graphics card, other tabs. Ticks under it: gc a full garbage collection, sh a ' +
        'shader compiled, up new textures or geometry sent to the graphics card.',
    );
    this.slowest = this.note(frameBody, '');
    this.slowest.className = 'perf-slowest';

    // Each group on its own, section by section, beside the whole frame.
    this.side = 1;
    for (const [k, g] of GROUPS.entries()) {
      const from = SECTIONS.indexOf(g.sections[0][0]);
      const parts = g.sections.map(([id, name], j) => ({
        name,
        colour: id === 'logic.other' ? rest : slot(j),
        value: (i: number) => profiler.cpu[i * NS + from + j]!,
      }));
      const body = this.group(g.id, g.name, slot(k), shown, (now) => {
        this.drawStack(chart, now);
        extra.textContent = this.extra(g.id, chart);
      });
      const chart = this.stack(body, parts, 2, false);
      const extra = this.note(body, '');
      // Shown once there is something in it: a page without physics has no physics graph.
      const group = this.groups.at(-1)!;
      group.el.hidden = true;
      group.summary = () => {
        const text = this.avgMax(chart);
        if (chart.peak > 0) group.el.hidden = false;
        return text;
      };
    }

    // The graphics card, pass by pass.
    const gpuBody = this.group('gpu', 'Graphics card', '', shown, (now) => {
      if (profiler.gpuSupported) this.drawStack(gpu, now);
    });
    const gpu = this.stack(
      gpuBody,
      GPU_SECTIONS.map(([, name], j) => ({
        name,
        colour: slot(j),
        value: (i: number) => profiler.gpu[i * NG + j]! || 0,
      })),
      2,
      false,
    );
    const gpuNote = this.note(gpuBody, '');
    this.groups.at(-1)!.summary = () => {
      const supported = profiler.gpuSupported;
      gpu.canvas.parentElement!.hidden = !supported;
      gpuNote.textContent = supported
        ? 'Timed only while this panel is open; each pass comes in a few frames late.'
        : /\bFirefox\//.test(navigator.userAgent)
          ? 'Firefox only lets pages time the graphics card with ' +
            'webgl.enable-privileged-extensions turned on in about:config (then reload). It ' +
            'applies to every site, so turn it off again afterwards.'
          : 'This browser does not report how long the graphics card takes.';
      return supported ? this.avgMax(gpu) : 'not reported';
    };

    // Ping, in a game.
    const pingBody = this.group('net', 'Network', css('--perf-ping'), shown, (now) => {
      const pings = this.pings();
      if (pings) {
        while (pings.length && pings[0]!.at < now - WINDOW_MS) pings.shift();
        this.ping.points = pings.map((p) => ({ at: p.at, v: p.ms }));
        this.drawLine(this.ping, now);
      }
    });
    this.ping = this.line(pingBody, css('--perf-ping'), 'ms', 50);
    const noPing = this.note(pingBody, 'Solo game: no network, so no ping.');
    this.groups.at(-1)!.summary = () => {
      const solo = this.pings() === null;
      this.ping.canvas.parentElement!.hidden = solo;
      noPing.hidden = !solo;
      const p = this.ping.points;
      if (solo || !p.length) return solo ? 'solo' : '';
      return `now ${Math.round(p.at(-1)!.v)} · high ${Math.round(Math.max(...p.map((x) => x.v)))} ms`;
    };
    this.groups.at(-1)!.el.hidden = !inGame;

    // Memory: the JavaScript heap where the browser reports it (only Chromium does), and an
    // estimate of what is on the graphics card, counted the same in every browser.
    const heapBody = this.group('memory', 'Memory', css('--perf-fps'), shown, (now) => {
      this.heap.points = this.memoryPoints(now, profiler.heap);
      this.drawLine(this.heap, now);
      this.graphics.points = this.memoryPoints(now, profiler.graphics);
      this.drawLine(this.graphics, now);
      const r = profiler.resources;
      const g = profiler.graphicsMemory;
      const mb = (b: number) => {
        const v = b / 2 ** 20;
        return `${v < 10 ? v.toFixed(1) : Math.round(v)} MB`;
      };
      memNote.textContent =
        (g
          ? `${mb(g.textures)} in textures and render targets, ${mb(g.buffers)} in geometry, ` +
            `${mb(g.renderbuffers + g.canvas)} in the screen and its depth and multisample ` +
            'buffers. '
          : '') +
        (r
          ? `${r.geometries} geometries, ${r.textures} textures, ${r.programs} shader programs.`
          : '');
    });
    const heapLabel = this.note(heapBody, 'JavaScript heap');
    this.heap = this.line(heapBody, css('--perf-fps'), 'MB', 100);
    const noHeap = this.note(
      heapBody,
      'This browser does not report its JavaScript memory (only Chrome, Edge and other ' +
        'Chromium browsers do).',
    );
    const graphicsLabel = this.note(heapBody, 'Graphics card, estimated from what was uploaded');
    this.graphics = this.line(heapBody, css('--perf-3'), 'MB', 100);
    const memNote = this.note(heapBody, '');
    this.groups.at(-1)!.summary = () => {
      // The last frame finished: this one's readings are taken as it ends.
      const at = (profiler.count - 2 + CAPACITY) % CAPACITY;
      const heap = profiler.heap[at];
      const graphics = profiler.graphics[at];
      const reported = !!this.heap.points.length;
      this.heap.canvas.parentElement!.hidden = heapLabel.hidden = !reported;
      noHeap.hidden = reported;
      this.graphics.canvas.parentElement!.hidden = graphicsLabel.hidden =
        !this.graphics.points.length;
      const parts: string[] = [];
      if (heap !== undefined && !Number.isNaN(heap)) parts.push(`${Math.round(heap)} MB`);
      if (graphics !== undefined && !Number.isNaN(graphics))
        parts.push(`~${Math.round(graphics)} MB graphics`);
      return parts.join(' · ');
    };

    // On the page itself rather than in the HUD, so it can float over the game's other panels.
    document.body.append(this.el);
    status.title = 'Click for frame rate and where the time goes, over the last 10 seconds';
    status.addEventListener('click', () => this.toggle());
    window.addEventListener('resize', () => this.place());
    // A graph opened or a column added can push the card past the window's edge.
    new ResizeObserver(() => this.place()).observe(this.el);
  }

  /** The title bar, which drags the card, and the box the graphs go in, which scrolls. */
  private card(): HTMLElement {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT) ?? 'null') as Partial<Layout> | null;
      if (saved?.columns === 1) this.layout.columns = 1;
      const spot = saved?.spot;
      if (
        spot &&
        (spot.h === 'left' || spot.h === 'right') &&
        (spot.v === 'top' || spot.v === 'bottom') &&
        Number.isFinite(spot.x) &&
        Number.isFinite(spot.y)
      )
        this.layout.spot = spot;
    } catch {
      // Private browsing or blocked storage: the card starts where it always did.
    }

    const bar = document.createElement('div');
    bar.className = 'perf-bar';
    bar.title = 'Drag to move. Double-click to put it back.';
    const title = document.createElement('strong');
    title.textContent = 'Performance';
    const choice = document.createElement('span');
    choice.className = 'perf-columns';
    choice.append('columns');
    const buttons = ([1, 2] as const).map((n) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(n);
      b.title = n === 1 ? 'One column' : 'Two columns side by side';
      b.addEventListener('click', () => {
        this.layout.columns = n;
        this.applyColumns(buttons);
        this.save();
      });
      return b;
    });
    choice.append(...buttons);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'perf-close';
    close.textContent = '×';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close the performance graphs');
    close.addEventListener('click', () => this.toggle());
    bar.append(title, choice, close);

    let grab: { id: number; dx: number; dy: number; w: number; h: number } | null = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('button')) return;
      const r = this.el.getBoundingClientRect();
      grab = {
        id: e.pointerId,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
        w: r.width,
        h: r.height,
      };
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('dragging');
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!grab || e.pointerId !== grab.id) return;
      const { innerWidth: W, innerHeight: H } = window;
      const left = Math.max(EDGE, Math.min(e.clientX - grab.dx, W - grab.w - EDGE));
      const top = Math.max(EDGE, Math.min(e.clientY - grab.dy, H - GRIP));
      const right = left + grab.w / 2 > W / 2;
      const bottom = top + grab.h / 2 > H / 2;
      this.layout.spot = {
        h: right ? 'right' : 'left',
        x: right ? W - left - grab.w : left,
        v: bottom ? 'bottom' : 'top',
        y: bottom ? H - top - grab.h : top,
      };
      this.place();
    });
    const drop = (e: PointerEvent) => {
      if (!grab || e.pointerId !== grab.id) return;
      grab = null;
      bar.classList.remove('dragging');
      this.save();
    };
    bar.addEventListener('pointerup', drop);
    bar.addEventListener('pointercancel', drop);
    bar.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('button')) return;
      this.layout.spot = null;
      this.place();
      this.save();
    });

    const scroll = document.createElement('div');
    scroll.className = 'perf-scroll';
    const cols = document.createElement('div');
    cols.className = 'perf-cols';
    scroll.append(cols);
    this.el.append(bar, scroll);
    this.applyColumns(buttons, cols);
    this.place();
    return cols;
  }

  private applyColumns(buttons: HTMLButtonElement[], cols = this.cols): void {
    cols.classList.toggle('two', this.layout.columns === 2);
    buttons.forEach((b, k) =>
      b.setAttribute('aria-pressed', String(k + 1 === this.layout.columns)),
    );
  }

  /** Puts the card where it was dragged, kept on screen with its title bar in reach. */
  private place(): void {
    const s = this.el.style;
    const spot = this.layout.spot;
    if (!spot) {
      s.left = s.right = s.top = s.bottom = s.maxHeight = '';
      // Where the page puts it can be past the right edge of a narrow window, as on a phone.
      const r = this.el.getBoundingClientRect();
      if (r.right > window.innerWidth) {
        s.left = `${Math.max(0, window.innerWidth - r.width - EDGE)}px`;
      }
      return;
    }
    const { innerWidth: W, innerHeight: H } = window;
    const x = Math.max(0, Math.min(spot.x, W - this.el.offsetWidth - EDGE));
    s.left = spot.h === 'left' ? `${x}px` : 'auto';
    s.right = spot.h === 'right' ? `${x}px` : 'auto';
    const y = Math.max(0, Math.min(spot.y, H - GRIP));
    s.top = spot.v === 'top' ? `${y}px` : 'auto';
    s.bottom = spot.v === 'bottom' ? `${y}px` : 'auto';
    s.maxHeight = `${H - y - EDGE}px`;
  }

  private save(): void {
    try {
      localStorage.setItem(LAYOUT, JSON.stringify(this.layout));
    } catch {
      // Not remembered, that is all.
    }
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.el.hidden = !this.isOpen;
    profiler.gpuTiming = this.isOpen;
    this.lastDraw = 0;
  }

  /** Frames drawn per second over the last second, for the status line. */
  currentFps(now: number): number {
    const p = profiler;
    const last = p.count - 1;
    if (last < 1) return 0;
    let n = last;
    while (n > Math.max(0, p.count - CAPACITY) && p.start[(n - 1) % CAPACITY]! >= now - 1000) n--;
    const span = p.start[last % CAPACITY]! - p.start[n % CAPACITY]!;
    return span > 0 ? ((last - n) * 1000) / span : 0;
  }

  /**
   * Call at the start of every frame, with how long the in-tab solo server ran since the last
   * one; then mark the frame's parts with the profiler, and call `done` at its end.
   */
  frame(now: number, serverMs = 0): void {
    profiler.frameStart(now, serverMs);
    if (!this.isOpen || now - this.lastDraw < 100) return;
    this.lastDraw = now;
    profiler.begin('logic.perf');
    this.findWindow(now);
    for (const g of this.groups) {
      if (g.el.open && !g.el.hidden) g.draw(now);
      g.readout.textContent = g.summary(now);
    }
    this.slowest.textContent = this.describeSlowest(now);
    profiler.end();
  }

  /** Call at the end of every frame. */
  done(): void {
    profiler.frameEnd();
  }

  /** The frames that reach into the last ten seconds, finished ones only. */
  private findWindow(now: number): void {
    const p = profiler;
    const first = Math.max(0, p.count - CAPACITY);
    let n = p.count - 1;
    while (n > first) {
      const i = (n - 1) % CAPACITY;
      if (p.start[i]! + (p.gap[i]! || 0) < now - WINDOW_MS) break;
      n--;
    }
    this.from = n;
    // The newest frame is still going: its gap is not known yet.
    this.to = Math.max(n, p.count - 1);
  }

  private group(
    id: string,
    title: string,
    colour: string,
    shown: string[],
    draw: (now: number) => void,
  ): HTMLElement {
    const el = document.createElement('details');
    el.open = shown.includes(id);
    const summary = document.createElement('summary');
    const name = document.createElement('span');
    name.className = 'perf-name';
    if (colour) {
      const swatch = document.createElement('i');
      swatch.style.background = colour;
      name.append(swatch);
    }
    name.append(title);
    const readout = document.createElement('span');
    readout.className = 'perf-readout';
    summary.append(name, readout);
    const body = document.createElement('div');
    body.className = 'perf-body';
    el.append(summary, body);
    el.addEventListener('toggle', () => {
      this.lastDraw = 0;
      try {
        const open = this.groups.filter((g) => g.el.open).map((g) => g.id);
        localStorage.setItem(STORE, JSON.stringify(open));
      } catch {
        // Not remembered, that is all.
      }
    });
    this.sides[this.side]!.append(el);
    this.groups.push({ id, el, readout, draw, summary: () => '' });
    return body;
  }

  private note(body: HTMLElement, text: string): HTMLElement {
    const p = document.createElement('p');
    p.className = 'perf-note';
    p.textContent = text;
    body.append(p);
    return p;
  }

  private canvas(body: HTMLElement, height: number): HTMLCanvasElement {
    const box = document.createElement('div');
    const canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WIDTH * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${height}px`;
    const time = document.createElement('div');
    time.className = 'perf-time';
    time.innerHTML = '<span>−10 s</span><span>now</span>';
    box.append(canvas, time);
    body.append(box);
    canvas.addEventListener('mousemove', (e) => {
      this.hoverX = Math.min(e.offsetX, PLOT - 1);
      this.lastDraw = 0;
    });
    canvas.addEventListener('mouseleave', () => {
      this.hoverX = null;
      this.lastDraw = 0;
    });
    return canvas;
  }

  private line(body: HTMLElement, colour: string, unit: string, floor: number): Line {
    return { canvas: this.canvas(body, HEIGHT), colour, unit, floor, points: [] };
  }

  private stack(
    body: HTMLElement,
    parts: { name: string; colour: string; value: (i: number) => number }[],
    floor: number,
    overview: boolean,
  ): Stack {
    const height = HEIGHT + 16 + (overview ? LANES.length * LANE + 4 : 0);
    const canvas = this.canvas(body, height);
    const table = document.createElement('table');
    table.className = 'perf-legend';
    const head = table.createTHead().insertRow();
    head.insertCell().textContent = 'ms';
    const heads: [HTMLElement, HTMLElement] = [head.insertCell(), head.insertCell()];
    const rows = table.createTBody();
    const series = parts.map((p) => {
      const row = rows.insertRow();
      const name = row.insertCell();
      const swatch = document.createElement('i');
      swatch.style.background = p.colour;
      name.append(swatch, p.name);
      return { ...p, avg: row.insertCell(), max: row.insertCell() };
    });
    body.append(table);
    return {
      canvas,
      height,
      series,
      floor,
      overview,
      heads,
      columns: new Int32Array(PLOT),
      peak: 0,
    };
  }

  /** The sum of a stack's parts in the frame at `i`. */
  private total(c: Stack, i: number): number {
    let sum = 0;
    for (const s of c.series) sum += s.value(i);
    return sum;
  }

  /** Average and most per frame over the window, of a stack's whole. */
  private avgMax(c: Stack): string {
    let sum = 0;
    let most = 0;
    for (let n = this.from; n < this.to; n++) {
      const t = this.total(c, n % CAPACITY);
      sum += t;
      most = Math.max(most, t);
    }
    const count = this.to - this.from;
    c.peak = most;
    return count ? `avg ${ms(sum / count)} · max ${ms(most)} ms` : '';
  }

  /** What else there is to say about a group: at the frame hovered, else the newest. */
  private extra(id: string, c: Stack): string {
    const hovered = this.hoverX === null ? -1 : c.columns[this.hoverX]!;
    const i = hovered >= 0 ? hovered : (profiler.count - 2 + CAPACITY) % CAPACITY;
    if (profiler.count < 2) return '';
    if (id === 'physics') {
      const steps = profiler.steps[i]!;
      return `${steps} physics ${steps === 1 ? 'step' : 'steps'} in this frame.`;
    }
    if (id === 'render') {
      const t = profiler.triangles[i]!;
      const tris = t >= 1e6 ? `${(t / 1e6).toFixed(2)}M` : `${Math.round(t / 1e3)}k`;
      return `${profiler.calls[i]} draw calls, ${tris} triangles in this frame (shadow maps included).`;
    }
    if (id === 'lighting') return 'The graphics card’s share of these is under Graphics card.';
    return '';
  }

  private describeSlowest(now: number): string {
    const p = profiler;
    const gaps: number[] = [];
    let worst = -1;
    for (let n = this.from; n < this.to; n++) {
      const i = n % CAPACITY;
      gaps.push(p.gap[i]!);
      if (worst < 0 || p.gap[i]! > p.gap[worst]!) worst = i;
    }
    if (worst < 0) return '';
    gaps.sort((a, b) => a - b);
    const usual = gaps[Math.floor(gaps.length / 2)]!;
    const slow = (i: number) => p.gap[i]! > 20 && p.gap[i]! > 2 * usual;
    // The collector's callback runs shortly after it finishes, so look a little past the gap.
    const withGc = (i: number) =>
      p.gcTimes.some((t) => t > p.start[i]! && t < p.start[i]! + p.gap[i]! + 150);
    let slowCount = 0;
    let gcCount = 0;
    for (let n = this.from; n < this.to; n++) {
      const i = n % CAPACITY;
      if (!slow(i)) continue;
      slowCount++;
      if (withGc(i)) gcCount++;
    }
    const collections = p.gcTimes.filter((t) => t > now - WINDOW_MS).length;
    if (!slowCount) {
      return `No slow frames in the last 10 seconds. ${collections} full garbage collections.`;
    }
    const i = worst;
    const parts = [
      ...GROUPS.map((g) => {
        const from = SECTIONS.indexOf(g.sections[0][0]);
        let sum = 0;
        for (let s = from; s < from + g.sections.length; s++) sum += p.cpu[i * NS + s]!;
        return [g.name, sum] as const;
      }),
      ...(this.inGame ? [['Solo server', p.server[i]!] as const] : []),
      ['Outside the game', outside(i)] as const,
    ];
    const [mostName, most] = parts.reduce((a, b) => (b[1] > a[1] ? b : a));
    const causes = [
      withGc(i) && 'a full garbage collection',
      p.flags[i]! & COMPILED && 'a shader compiling',
      p.flags[i]! & UPLOADED && 'new textures or geometry',
    ].filter(Boolean);
    return (
      `Slowest frame ${((now - p.start[i]!) / 1000).toFixed(1)} s ago: ${ms(p.gap[i]!)} ms, most ` +
      `of it ${mostName.toLowerCase()} (${ms(most)}). ` +
      parts
        .filter(([, v]) => v >= 0.05)
        .map(([name, v]) => `${name} ${ms(v)}`)
        .join(' · ') +
      '.' +
      (causes.length ? ` With ${causes.join(' and ')}.` : '') +
      ` ${slowCount} slow in 10 s, ${gcCount} of them with a full garbage collection.`
    );
  }

  /** Average frame rate in each slice of the window, from the frames that ended in it. */
  private frameRates(now: number): Point[] {
    const p = profiler;
    const points: Point[] = [];
    let n = this.from;
    for (let end = now - WINDOW_MS + SLICE_MS; end <= now + 1e-6; end += SLICE_MS) {
      let total = 0;
      let count = 0;
      for (; n < this.to; n++) {
        const i = n % CAPACITY;
        if (p.start[i]! + p.gap[i]! > end) break;
        total += p.gap[i]!;
        count++;
      }
      if (count) points.push({ at: end, v: 1000 / (total / count) });
    }
    return points;
  }

  /** A memory reading at the end of each slice of the window, where there is one. */
  private memoryPoints(now: number, values: Float32Array): Point[] {
    const p = profiler;
    const points: Point[] = [];
    let n = this.from;
    for (let end = now - WINDOW_MS + SLICE_MS; end <= now + 1e-6; end += SLICE_MS) {
      let v = NaN;
      for (; n <= this.to && n < p.count; n++) {
        const i = n % CAPACITY;
        if (p.start[i]! > end) break;
        v = values[i]!;
      }
      if (!Number.isNaN(v)) points.push({ at: end, v });
    }
    return points;
  }

  /** The grid, labelled on the right, for a plot from `top` to `bottom` up to `max`. */
  private grid(g: CanvasRenderingContext2D, max: number, top: number, bottom: number): void {
    const y = (v: number) => bottom - (v / max) * (bottom - top);
    g.font = '10px ui-monospace, monospace';
    g.textBaseline = 'middle';
    for (const v of [0, max / 2, max]) {
      g.fillStyle = css('--perf-grid');
      g.fillRect(0, Math.round(y(v)) - 0.5, PLOT, 1);
      g.fillStyle = css('--perf-muted');
      g.fillText(String(v), PLOT + 6, y(v));
    }
  }

  private context(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D {
    const g = canvas.getContext('2d')!;
    const dpr = canvas.width / WIDTH;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, WIDTH, height);
    return g;
  }

  private drawStack(c: Stack, now: number): void {
    const p = profiler;
    const g = this.context(c.canvas, c.height);
    const top = 6;
    const bottom = HEIGHT + 10;
    const x = (at: number) => ((at - (now - WINDOW_MS)) / WINDOW_MS) * PLOT;

    // Each pixel column shows the frame with the most time in it, over every column the frame
    // lasted, so a long frame is as wide as it was long and a spike is never averaged away.
    const cols = c.columns.fill(-1);
    const most = new Float32Array(PLOT);
    for (let n = this.from; n < this.to; n++) {
      const i = n % CAPACITY;
      const t = this.total(c, i);
      const a = Math.max(0, Math.floor(x(p.start[i]!)));
      const b = Math.min(PLOT - 1, Math.floor(x(p.start[i]! + p.gap[i]!)));
      for (let k = a; k <= b; k++) {
        if (cols[k]! < 0 || t > most[k]!) {
          cols[k] = i;
          most[k] = t;
        }
      }
    }
    const max = niceMax(Math.max(c.floor, ...most));
    const y = (v: number) => bottom - (Math.min(v, max) / max) * (bottom - top);
    this.grid(g, max, top, bottom);

    const base = new Float32Array(PLOT);
    for (const s of c.series) {
      g.fillStyle = s.colour;
      for (let k = 0; k < PLOT; k++) {
        const i = cols[k]!;
        if (i < 0) continue;
        const v = s.value(i);
        if (!(v > 0)) continue;
        const y0 = y(base[k]!);
        base[k] = base[k]! + v;
        const y1 = y(base[k]!);
        if (y0 - y1 > 0.01) g.fillRect(k, y1, 1, y0 - y1);
      }
    }

    if (c.overview) {
      // The 60 fps budget, dashed.
      if (BUDGET <= max) {
        g.strokeStyle = css('--perf-text');
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(0, Math.round(y(BUDGET)) + 0.5);
        g.lineTo(PLOT, Math.round(y(BUDGET)) + 0.5);
        g.stroke();
        g.setLineDash([]);
      }
      // What may have caused a hitch, each in its own row of ticks under the graph.
      const lane = (row: number) => bottom + 8 + row * LANE;
      g.font = '9px ui-monospace, monospace';
      g.textBaseline = 'middle';
      LANES.forEach((label, row) => {
        g.fillStyle = css('--perf-grid');
        g.fillRect(0, lane(row) + LANE / 2 - 0.5, PLOT, 1);
        g.fillStyle = css('--perf-muted');
        g.fillText(label, PLOT + 6, lane(row) + LANE / 2);
      });
      g.fillStyle = css('--perf-text');
      for (const t of p.gcTimes)
        if (t > now - WINDOW_MS) g.fillRect(Math.round(x(t)) - 0.5, lane(0), 1, LANE - 1);
      for (let n = this.from; n <= this.to && n < p.count; n++) {
        const i = n % CAPACITY;
        const at = Math.round(x(p.start[i]!)) - 0.5;
        if (p.flags[i]! & COMPILED) g.fillRect(at, lane(1), 1, LANE - 1);
        if (p.flags[i]! & UPLOADED) g.fillRect(at, lane(2), 1, LANE - 1);
      }
    }

    // Hover: a crosshair on the frame under the pointer, its parts in the legend.
    const hovered = this.hoverX === null ? -1 : cols[this.hoverX]!;
    if (this.hoverX !== null) {
      g.fillStyle = css('--perf-muted');
      g.fillRect(Math.round(this.hoverX) - 0.5, top, 1, bottom - top);
    }
    if (hovered >= 0) {
      c.heads[0].textContent = `${((p.start[hovered]! - now) / 1000).toFixed(1)} s`;
      c.heads[1].textContent = '';
      for (const s of c.series) {
        s.avg.textContent = ms(s.value(hovered));
        s.max.textContent = '';
      }
      return;
    }
    c.heads[0].textContent = 'avg';
    c.heads[1].textContent = 'max';
    const count = this.to - this.from;
    for (const s of c.series) {
      let sum = 0;
      let high = 0;
      for (let n = this.from; n < this.to; n++) {
        const v = s.value(n % CAPACITY);
        sum += v;
        high = Math.max(high, v);
      }
      s.avg.textContent = count ? ms(sum / count) : '';
      s.max.textContent = count ? ms(high) : '';
    }
  }

  private drawLine(c: Line, now: number): void {
    const g = this.context(c.canvas, HEIGHT);
    const top = 6;
    const bottom = HEIGHT - 6;
    const max = niceMax(Math.max(c.floor, ...c.points.map((p) => p.v)));
    const x = (at: number) => ((at - (now - WINDOW_MS)) / WINDOW_MS) * PLOT;
    const y = (v: number) => bottom - (Math.min(v, max) / max) * (bottom - top);
    this.grid(g, max, top, bottom);

    // Garbage collections as small ticks along the bottom of the frame rate and memory graphs.
    if (c === this.fps || c === this.heap) {
      g.fillStyle = css('--perf-text');
      for (const t of profiler.gcTimes)
        if (t > now - WINDOW_MS) g.fillRect(Math.round(x(t)) - 0.5, bottom - 5, 1, 5);
    }

    if (c.points.length > 1) {
      g.strokeStyle = c.colour;
      g.lineWidth = 2;
      g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      c.points.forEach((p, i) => (i ? g.lineTo(x(p.at), y(p.v)) : g.moveTo(x(p.at), y(p.v))));
      g.stroke();
    }

    // Hover: a crosshair on the nearest sample, its value beside it.
    if (this.hoverX !== null && c.points.length) {
      const at = now - WINDOW_MS + (this.hoverX / PLOT) * WINDOW_MS;
      const p = c.points.reduce((a, b) => (Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a));
      const px = x(p.at);
      g.fillStyle = css('--perf-muted');
      g.fillRect(Math.round(px) - 0.5, top, 1, bottom - top);
      g.beginPath();
      g.arc(px, y(p.v), 4, 0, Math.PI * 2);
      g.fillStyle = c.colour;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = css('--perf-surface');
      g.stroke();
      const text = `${((p.at - now) / 1000).toFixed(1)} s: ${Math.round(p.v)} ${c.unit}`;
      g.font = '10px ui-monospace, monospace';
      g.textBaseline = 'top';
      const w = g.measureText(text).width;
      const tx = Math.min(Math.max(0, px - w / 2), PLOT - w);
      g.fillStyle = css('--perf-surface');
      g.fillRect(tx - 2, 0, w + 4, 12);
      g.fillStyle = css('--perf-text');
      g.fillText(text, tx, 1);
    }
  }
}
