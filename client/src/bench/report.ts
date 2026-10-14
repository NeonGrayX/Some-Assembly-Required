import { mapById } from '@sar/shared';
import type { BenchResult } from './bench.ts';
import { STUTTER_MS, buckets, histogram, percentile, summarize } from './stats.ts';
import type { FrameSample, Summary } from './stats.ts';

/** Graphs average over slices this long; the frame-time graph shows every frame. */
const SLICE_MS = 250;
const CHART_HEIGHT = 120;
/** Room on the right of each plot for the value labels, and under it for the time. */
const AXIS_W = 46;
const AXIS_H = 16;
const HIST_BANDS = 51;

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A round number at or above `v`: 1, 2 or 5 times a power of ten. */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)));
  return [1, 2, 5, 10].map((m) => m * p).find((n) => n >= v * 0.999)!;
}

function fmtCount(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
}

const fmtMs = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} ms`;
const fmtFps = (v: number) => `${Math.round(v)} fps`;
const fmtTime = (ms: number) => {
  const s = ms / 1000;
  return s < 60
    ? `${s.toFixed(s < 10 ? 1 : 0)} s`
    : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/**
 * At most two points per pixel column: each column keeps its highest point, so a graph of
 * thousands of frames still shows every spike without drawing them all.
 */
function thin<P extends { t: number }>(points: P[], width: number, value: (p: P) => number): P[] {
  if (points.length <= width * 2) return points;
  const t0 = points[0]!.t;
  const per = (points[points.length - 1]!.t - t0) / Math.max(1, width);
  const out: P[] = [];
  let col = -1;
  let best: P | null = null;
  for (const p of points) {
    const c = Math.floor((p.t - t0) / per);
    if (c !== col) {
      if (best) out.push(best);
      col = c;
      best = p;
    } else if (value(p) > value(best!)) best = p;
  }
  if (best) out.push(best);
  return out;
}

interface SeriesDef {
  name: string;
  colour: string;
}

interface TimeChart {
  canvas: HTMLCanvasElement;
  readout: HTMLElement;
  /** Beside each series in the legend: its value under the pointer. */
  values: HTMLElement[];
  series: SeriesDef[];
  /** Each point's time and one value per series (stacked in a 'stack' chart). */
  points: { t: number; v: number[] }[];
  kind: 'line' | 'stack';
  /** The value axis never shrinks below this. */
  floor: number;
  /** Dashed lines across the plot. */
  refs: { v: number; label: string }[];
  fmt: (v: number) => string;
  /** Marks along the bottom (garbage collections). */
  ticks?: number[];
  /** Phase names along the top. */
  labels?: boolean;
  /** Line width: thinner for a graph of every frame. */
  line: number;
  /**
   * Scale to the 99.5th percentile instead of the highest point, so a map loading (a frame of
   * seconds) does not flatten the rest; anything higher runs off the top, and the graph says so.
   */
  clip?: boolean;
}

/** A phase's stretch of the run, ms from the start. */
interface Span {
  name: string;
  from: number;
  to: number;
  frames: FrameSample[];
}

/**
 * The results of a benchmark run: the headline numbers, then frame rate, frame time, where the
 * frame went, draw calls, triangles and memory over the whole run with its phases marked, the
 * spread of frame times, and the same numbers phase by phase. Hovering a graph reads it out on
 * every graph at once; clicking a phase (in a graph or the table) zooms in on it.
 */
export class BenchReport {
  private readonly el: HTMLElement;
  private result: BenchResult | null = null;
  private spans: Span[] = [];
  private charts: TimeChart[] = [];
  private hist: {
    canvas: HTMLCanvasElement;
    readout: HTMLElement;
    counts: number[];
    hover: number | null;
  } | null = null;
  private range: [number, number] = [0, 1];
  private hoverT: number | null = null;
  private zoomed: Span | null = null;
  private zoomLabel!: HTMLElement;
  private whole!: HTMLButtonElement;
  private readonly onResize = () => this.layout();
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    this.back();
  };

  constructor(
    private readonly onAgain: () => void,
    private readonly onClose: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'bench-report';
    this.el.className = 'bench-sheet';
    this.el.hidden = true;
    document.body.append(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(result: BenchResult): void {
    this.result = result;
    this.spans = this.phaseSpans(result);
    this.zoomed = null;
    this.hoverT = null;
    this.el.replaceChildren(this.build(result));
    this.el.hidden = false;
    this.el.scrollTop = 0;
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    this.layout();
  }

  hide(): void {
    this.el.hidden = true;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
  }

  /** The app bar's Back (or Esc): puts the results away. */
  back(): void {
    this.hide();
    this.onClose();
  }

  // ---------------------------------------------------------------- building the page

  private phaseSpans(r: BenchResult): Span[] {
    const spans: Span[] = [];
    let prevEnd = 0;
    for (const f of r.frames) {
      let s = spans[spans.length - 1];
      if (!s || r.phases[f.phase] !== s.name) {
        s = { name: r.phases[f.phase] ?? '', from: prevEnd, to: f.t, frames: [] };
        spans.push(s);
      }
      s.frames.push(f);
      s.to = f.t;
      prevEnd = f.t;
    }
    return spans;
  }

  private build(r: BenchResult): HTMLElement {
    const page = document.createElement('div');
    page.className = 'bench-page';
    const all = summarize(r.frames);

    const head = document.createElement('header');
    head.className = 'bench-head box';
    const title = document.createElement('div');
    title.innerHTML = '<h2>Benchmark results</h2>';
    const meta = document.createElement('p');
    meta.className = 'bench-meta';
    const g = r.system.graphics;
    meta.textContent =
      `${new Date(r.date).toLocaleString()} · ${r.version} · ${r.system.gpu} · ` +
      `${r.system.screen} · graphics ${g.preset} (${g.style}, shadows ${g.shadows}, ` +
      `${Math.round(g.scale * 100)}% resolution${g.ao ? ', occlusion' : ''}` +
      `${g.bloom ? ', bloom' : ''})` +
      ` · ${r.maps.map((m) => mapById(m).name).join(', ')}` +
      (r.stopped ? ' · stopped early' : '');
    title.append(meta);
    const buttons = document.createElement('div');
    buttons.className = 'bench-buttons';
    buttons.append(
      this.button('Save JSON', () => this.save(r, 'json')),
      this.button('Save CSV', () => this.save(r, 'csv')),
      this.button(
        'Run again',
        () => {
          this.hide();
          this.onAgain();
        },
        true,
      ),
    );
    head.append(title, buttons);
    page.append(head);

    if (r.frames.length < 2) {
      const p = document.createElement('p');
      p.className = 'bench-note box';
      p.textContent = 'Too few frames were recorded to say anything.';
      page.append(p);
      return page;
    }

    page.append(this.tiles(all, r));

    const zoom = document.createElement('div');
    zoom.className = 'bench-zoom box';
    this.zoomLabel = document.createElement('span');
    this.whole = this.button('Whole run', () => this.zoom(null));
    zoom.append(this.zoomLabel, this.whole);
    page.append(zoom);

    const blue = css('--bench-1');
    const sliced = buckets(r.frames, SLICE_MS);
    const grid = document.createElement('div');
    grid.className = 'bench-charts';
    page.append(grid);
    const chart = (
      title: string,
      note: string,
      opts: Omit<TimeChart, 'canvas' | 'readout' | 'values'>,
    ): TimeChart => {
      const { box, canvas, readout, values } = this.chartBox(title, note, opts.series);
      grid.append(box);
      const c: TimeChart = { ...opts, canvas, readout, values };
      this.charts.push(c);
      this.hookTime(c);
      return c;
    };
    this.charts = [];
    chart('Frame rate', `averaged over ${SLICE_MS} ms`, {
      series: [{ name: 'Frame rate', colour: blue }],
      points: sliced.map((b) => ({ t: b.t, v: [b.fps] })),
      kind: 'line',
      floor: 60,
      refs: [{ v: 60, label: '60' }],
      fmt: fmtFps,
      labels: true,
      line: 2,
    });
    chart('Frame time', 'every frame; spikes are hitches', {
      series: [{ name: 'Frame time', colour: blue }],
      points: r.frames.map((f) => ({ t: f.t, v: [f.frame] })),
      kind: 'line',
      floor: 40,
      refs: [
        { v: 1000 / 60, label: '60 fps' },
        { v: STUTTER_MS, label: '30 fps' },
      ],
      fmt: fmtMs,
      ticks: r.gcs,
      line: 1,
      clip: true,
    });
    chart('Where the frame went', 'the game’s own work per frame', {
      series: [
        { name: 'Simulation', colour: blue },
        { name: 'Scene update', colour: css('--bench-2') },
        { name: 'Drawing', colour: css('--bench-3') },
        { name: 'Solo server', colour: css('--bench-4') },
      ],
      points: sliced.map((b) => ({ t: b.t, v: [b.sim, b.scene, b.draw, b.server] })),
      kind: 'stack',
      floor: 10,
      refs: [{ v: 1000 / 60, label: '16.7' }],
      fmt: fmtMs,
      line: 2,
      clip: true,
    });
    chart('Draw calls', 'every pass of a frame, shadows included', {
      series: [{ name: 'Draw calls', colour: blue }],
      points: sliced.map((b) => ({ t: b.t, v: [b.calls] })),
      kind: 'line',
      floor: 10,
      refs: [],
      fmt: fmtCount,
      line: 2,
    });
    chart('Triangles', 'drawn per frame, every pass', {
      series: [{ name: 'Triangles', colour: blue }],
      points: sliced.map((b) => ({ t: b.t, v: [b.triangles] })),
      kind: 'line',
      floor: 1000,
      refs: [],
      fmt: fmtCount,
      line: 2,
    });
    const heapKnown = sliced.every((b) => b.heap >= 0);
    chart(
      'JS memory',
      heapKnown
        ? 'heap in use; ticks are full garbage collections'
        : 'this browser does not report the heap; ticks are full garbage collections',
      {
        series: [{ name: 'Heap', colour: blue }],
        points: heapKnown ? sliced.map((b) => ({ t: b.t, v: [b.heap] })) : [],
        kind: 'line',
        floor: 10,
        refs: [],
        fmt: (v) => `${Math.round(v)} MB`,
        ticks: r.gcs,
        line: 2,
      },
    );

    // How the frame times spread out.
    const histBox = this.chartBox(
      'Frame times',
      '1 ms bands; the last holds everything slower',
      [],
    );
    histBox.box.classList.add('bench-wide');
    grid.append(histBox.box);
    this.hist = {
      canvas: histBox.canvas,
      readout: histBox.readout,
      counts: histogram(r.frames, 1, HIST_BANDS),
      hover: null,
    };
    this.hookHist();

    page.append(this.phaseTable());
    if (r.interactions.length) page.append(this.interactionTable(r));
    return page;
  }

  private button(text: string, click: () => void, primary = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn btn-primary' : 'btn';
    b.textContent = text;
    b.addEventListener('click', click);
    return b;
  }

  private tiles(s: Summary, r: BenchResult): HTMLElement {
    const box = document.createElement('div');
    box.className = 'bench-tiles';
    const tile = (label: string, value: string, note: string) => {
      const t = document.createElement('div');
      t.className = 'bench-tile box';
      t.innerHTML =
        '<span class="label"></span><span class="value"></span><span class="note"></span>';
      t.querySelector('.label')!.textContent = label;
      t.querySelector('.value')!.textContent = value;
      t.querySelector('.note')!.textContent = note;
      box.append(t);
    };
    tile('Average', fmtFps(s.avgFps), `${s.frames} frames in ${fmtTime(s.seconds * 1000)}`);
    tile('1% low', fmtFps(s.low1), '99% of frames were faster');
    tile('0.1% low', fmtFps(s.low01), '99.9% of frames were faster');
    tile('Median frame', fmtMs(s.p50), `95th ${fmtMs(s.p95)} · 99th ${fmtMs(s.p99)}`);
    tile('Worst frame', fmtMs(s.worst), `${s.stutters} frames over ${STUTTER_MS.toFixed(1)} ms`);
    tile('Game work', fmtMs(s.cpu), 'per frame, on the main thread');
    tile('Draw calls', fmtCount(s.calls), `${fmtCount(s.triangles)} triangles per frame`);
    const long = r.longTasks.length;
    tile(
      'Garbage collections',
      String(r.gcs.length),
      long ? `${long} long tasks over 50 ms` : 'full collections only',
    );
    return box;
  }

  private chartBox(
    title: string,
    note: string,
    series: SeriesDef[],
  ): { box: HTMLElement; canvas: HTMLCanvasElement; readout: HTMLElement; values: HTMLElement[] } {
    const box = document.createElement('section');
    box.className = 'bench-chart box';
    const head = document.createElement('header');
    const name = document.createElement('div');
    name.className = 'bench-chart-name';
    const h = document.createElement('h3');
    h.textContent = title;
    const small = document.createElement('small');
    small.textContent = note;
    name.append(h, small);
    const readout = document.createElement('span');
    readout.className = 'bench-readout';
    head.append(name, readout);
    box.append(head);
    // A legend for two or more series, each with its value under the pointer beside it.
    const values: HTMLElement[] = [];
    if (series.length > 1) {
      const legend = document.createElement('div');
      legend.className = 'bench-legend';
      for (const s of series) {
        const item = document.createElement('span');
        const sw = document.createElement('i');
        sw.style.background = s.colour;
        const value = document.createElement('b');
        values.push(value);
        item.append(sw, s.name, value);
        legend.append(item);
      }
      box.append(legend);
    }
    const canvas = document.createElement('canvas');
    box.append(canvas);
    return { box, canvas, readout, values };
  }

  private phaseTable(): HTMLElement {
    const wrap = document.createElement('section');
    wrap.className = 'bench-table box';
    wrap.innerHTML =
      '<h3>Phase by phase</h3><p class="bench-note">Click a phase to zoom the graphs in on it.</p>';
    const table = document.createElement('table');
    table.innerHTML =
      '<thead><tr><th>Phase</th><th>Time</th><th>Average</th><th></th><th>1% low</th>' +
      '<th>99th frame</th><th>Worst</th><th>Over 33 ms</th><th>Game work</th>' +
      '<th>Draw calls</th><th>Triangles</th></tr></thead>';
    const body = document.createElement('tbody');
    const sums = this.spans.map((s) => summarize(s.frames));
    const top = niceMax(Math.max(...sums.map((s) => s.avgFps)));
    const worstAvg = Math.min(...sums.map((s) => s.avgFps));
    this.spans.forEach((span, i) => {
      const s = sums[i]!;
      const tr = document.createElement('tr');
      if (s.avgFps === worstAvg && this.spans.length > 1) tr.classList.add('worst');
      const cells = [
        span.name,
        fmtTime(span.to - span.from),
        fmtFps(s.avgFps),
        '',
        fmtFps(s.low1),
        fmtMs(s.p99),
        fmtMs(s.worst),
        String(s.stutters),
        fmtMs(s.cpu),
        fmtCount(s.calls),
        fmtCount(s.triangles),
      ];
      for (const [k, text] of cells.entries()) {
        const td = document.createElement('td');
        if (k === 3) {
          const bar = document.createElement('i');
          bar.className = 'bench-bar';
          bar.style.width = `${(s.avgFps / top) * 100}%`;
          td.append(bar);
        } else td.textContent = text;
        tr.append(td);
      }
      tr.addEventListener('click', () => this.zoom(span));
      body.append(tr);
    });
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  private interactionTable(r: BenchResult): HTMLElement {
    const wrap = document.createElement('section');
    wrap.className = 'bench-table box';
    wrap.innerHTML =
      '<h3>What the bot did</h3><p class="bench-note">Aimed: how often the bot was looking ' +
      'at the thing it meant when it clicked.</p>';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Interaction</th><th>Tries</th><th>Aimed</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const x of r.interactions) {
      const tr = document.createElement('tr');
      for (const text of [x.label, String(x.tries), `${x.hits} of ${x.tries}`]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  // ---------------------------------------------------------------- interaction

  private hookTime(c: TimeChart): void {
    c.canvas.addEventListener('mousemove', (e) => {
      const plotW = c.canvas.clientWidth - AXIS_W;
      const f = Math.max(0, Math.min(1, e.offsetX / plotW));
      this.hoverT = this.range[0] + f * (this.range[1] - this.range[0]);
      this.drawAll();
    });
    c.canvas.addEventListener('mouseleave', () => {
      this.hoverT = null;
      this.drawAll();
    });
    c.canvas.addEventListener('click', () => {
      if (this.hoverT === null) return;
      const span = this.spans.find((s) => this.hoverT! >= s.from && this.hoverT! <= s.to);
      if (span) this.zoom(this.zoomed === span ? null : span);
    });
  }

  private hookHist(): void {
    const h = this.hist!;
    h.canvas.addEventListener('mousemove', (e) => {
      const plotW = h.canvas.clientWidth - AXIS_W;
      const band = Math.floor((e.offsetX / plotW) * HIST_BANDS);
      h.hover = band >= 0 && band < HIST_BANDS ? band : null;
      this.drawHist();
    });
    h.canvas.addEventListener('mouseleave', () => {
      h.hover = null;
      this.drawHist();
    });
  }

  private zoom(span: Span | null): void {
    this.zoomed = span;
    this.layout();
  }

  // ---------------------------------------------------------------- drawing

  private layout(): void {
    const r = this.result;
    if (!r || !r.frames.length) return;
    const span = this.zoomed;
    this.range = span ? [span.from, span.to] : [0, r.frames[r.frames.length - 1]!.t];
    this.whole.hidden = !span;
    this.zoomLabel.textContent = span
      ? `Showing ${span.name} (${fmtTime(span.from)} to ${fmtTime(span.to)})`
      : `Showing the whole run (${fmtTime(this.range[1])}). Click a graph to zoom in on that phase.`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = (canvas: HTMLCanvasElement) => {
      const w = canvas.parentElement!.clientWidth - 2 * 14;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${CHART_HEIGHT}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(CHART_HEIGHT * dpr);
    };
    for (const c of this.charts) size(c.canvas);
    if (this.hist) size(this.hist.canvas);
    this.drawAll();
    this.drawHist();
  }

  private drawAll(): void {
    for (const c of this.charts) this.drawTime(c);
  }

  private context(canvas: HTMLCanvasElement): {
    g: CanvasRenderingContext2D;
    w: number;
    h: number;
  } {
    const g = canvas.getContext('2d')!;
    const w = canvas.clientWidth;
    const h = CHART_HEIGHT;
    const dpr = canvas.width / Math.max(1, w);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = `10px ${css('--font-mono')}`;
    return { g, w, h };
  }

  private drawTime(c: TimeChart): void {
    const { g, w, h } = this.context(c.canvas);
    const plotW = w - AXIS_W;
    const top = c.labels ? 16 : 6;
    const bottom = h - AXIS_H;
    const [t0, t1] = this.range;
    const x = (t: number) => ((t - t0) / (t1 - t0)) * plotW;
    const total = (p: { v: number[] }) =>
      c.kind === 'stack' ? p.v.reduce((a, b) => a + b, 0) : Math.max(...p.v);
    const inRange = c.points.filter((p) => p.t >= t0 && p.t <= t1);
    const visible = thin(inRange, plotW, total);
    let high = Math.max(c.floor, ...c.refs.map((r) => r.v));
    let peak = 0;
    for (const p of inRange) peak = Math.max(peak, total(p));
    if (c.clip && inRange.length) {
      const sorted = inRange.map(total).sort((a, b) => a - b);
      high = Math.max(high, percentile(sorted, 0.995) * 1.15);
    } else high = Math.max(high, peak);
    const max = niceMax(high);
    const clipped = peak > max;
    const y = (v: number) => bottom - (Math.min(v, max) / max) * (bottom - top);
    const muted = css('--muted');
    const grid = css('--border');

    // Phases: alternate faint bands, a hairline between them, and names along the top.
    this.spans.forEach((s, i) => {
      if (s.to < t0 || s.from > t1) return;
      const a = Math.max(0, x(s.from));
      const b = Math.min(plotW, x(s.to));
      if (i % 2) {
        g.fillStyle = css('--surface-2');
        g.fillRect(a, top, b - a, bottom - top);
      }
      if (c.labels && b - a > 40) {
        g.fillStyle = muted;
        g.textBaseline = 'middle';
        // The map's name is in the readout and the table; the phase is what tells bands apart.
        let label = s.name.replace(/^[^:]*: /, '');
        while (label.length > 1 && g.measureText(label).width > b - a - 6)
          label = label.slice(0, -1);
        if (g.measureText(s.name.replace(/^[^:]*: /, '')).width > b - a - 6) {
          label = `${label.slice(0, -1)}…`;
        }
        g.fillText(label, a + 3, 7);
      }
    });

    // Recessive grid: zero, half and the top of the scale, labelled on the right.
    g.textBaseline = 'middle';
    for (const v of [0, max / 2, max]) {
      g.fillStyle = grid;
      g.fillRect(0, Math.round(y(v)) - 0.5, plotW, 1);
      g.fillStyle = muted;
      g.fillText(c.fmt(v).replace(/ (fps|ms|MB)$/, ''), plotW + 6, y(v));
    }
    let lastLabel = Infinity;
    for (const r of c.refs) {
      g.strokeStyle = muted;
      g.setLineDash([3, 4]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, Math.round(y(r.v)) + 0.5);
      g.lineTo(plotW, Math.round(y(r.v)) + 0.5);
      g.stroke();
      g.setLineDash([]);
      // Labels too close to the one before (both lines near the bottom) are left off.
      if (Math.abs(y(r.v) - lastLabel) < 12 || y(r.v) - 7 < top) continue;
      lastLabel = y(r.v);
      g.fillStyle = muted;
      g.textAlign = 'right';
      g.fillText(r.label, plotW - 4, y(r.v) - 7);
      g.textAlign = 'left';
    }

    // Time along the bottom.
    const span = t1 - t0;
    const step =
      [1, 2, 5, 10, 15, 30, 60, 120].map((s) => s * 1000).find((s) => span / s <= 10) ?? 300_000;
    g.fillStyle = muted;
    g.textBaseline = 'top';
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const px = x(t);
      g.fillRect(Math.round(px) - 0.5, bottom, 1, 3);
      const label = fmtTime(t);
      const lw = g.measureText(label).width;
      g.fillText(label, Math.max(0, Math.min(plotW - lw, px - lw / 2)), bottom + 4);
    }

    if (c.ticks) {
      g.fillStyle = css('--text');
      for (const t of c.ticks)
        if (t >= t0 && t <= t1) g.fillRect(Math.round(x(t)) - 0.5, bottom - 6, 1, 6);
    }

    if (visible.length > 1) {
      g.lineJoin = g.lineCap = 'round';
      if (c.kind === 'stack') {
        // Each layer filled from the one below it to its own top, with a hairline of surface
        // between them.
        const base = visible.map(() => 0);
        c.series.forEach((s, k) => {
          const tops = visible.map((p, i) => base[i]! + p.v[k]!);
          g.beginPath();
          visible.forEach((p, i) =>
            i ? g.lineTo(x(p.t), y(tops[i]!)) : g.moveTo(x(p.t), y(tops[i]!)),
          );
          for (let i = visible.length - 1; i >= 0; i--) g.lineTo(x(visible[i]!.t), y(base[i]!));
          g.closePath();
          g.fillStyle = s.colour;
          g.fill();
          g.strokeStyle = css('--surface');
          g.lineWidth = 1;
          g.beginPath();
          visible.forEach((p, i) =>
            i ? g.lineTo(x(p.t), y(tops[i]!)) : g.moveTo(x(p.t), y(tops[i]!)),
          );
          g.stroke();
          tops.forEach((v, i) => (base[i] = v));
        });
      } else {
        c.series.forEach((s, k) => {
          g.strokeStyle = s.colour;
          g.lineWidth = c.line;
          g.beginPath();
          visible.forEach((p, i) =>
            i ? g.lineTo(x(p.t), y(p.v[k]!)) : g.moveTo(x(p.t), y(p.v[k]!)),
          );
          g.stroke();
        });
      }
    } else if (!c.points.length) {
      g.fillStyle = muted;
      g.textBaseline = 'middle';
      g.fillText('No data', 8, (top + bottom) / 2);
    }

    // The readout: the latest point, or the one under the pointer with a crosshair on it.
    if (clipped) {
      // Spikes that run off the top get a tick on the top edge.
      g.fillStyle = css('--text');
      for (const p of visible)
        if (total(p) > max) g.fillRect(Math.round(x(p.t)) - 1, top - 4, 2, 4);
    }

    const phaseAt = (t: number) => this.spans.find((s) => t >= s.from && t <= s.to)?.name ?? '';
    let text = '';
    if (this.hoverT !== null && visible.length) {
      const t = this.hoverT;
      const p = visible.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
      const px = x(p.t);
      g.fillStyle = muted;
      g.fillRect(Math.round(px) - 0.5, top, 1, bottom - top);
      let acc = 0;
      c.series.forEach((s, k) => {
        acc = c.kind === 'stack' ? acc + p.v[k]! : p.v[k]!;
        g.beginPath();
        g.arc(px, y(acc), 4, 0, Math.PI * 2);
        g.fillStyle = s.colour;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = css('--surface');
        g.stroke();
      });
      c.values.forEach((el, k) => (el.textContent = c.fmt(p.v[k]!)));
      // The phase once, on the graph with the phase names; the time on every one.
      const where = c.labels ? ` · ${phaseAt(p.t)}` : '';
      text = `${fmtTime(p.t)}${where} · ${c.kind === 'stack' ? 'total ' : ''}${c.fmt(total(p))}`;
    } else if (visible.length) {
      for (const el of c.values) el.textContent = '';
      let sum = 0;
      for (const p of inRange) sum += total(p);
      text = `average ${c.fmt(sum / inRange.length)} · high ${c.fmt(peak)}`;
      if (clipped) text += ' (off the top)';
    }
    c.readout.textContent = text;
  }

  private drawHist(): void {
    const h = this.hist;
    if (!h) return;
    const { g, w, h: height } = this.context(h.canvas);
    const plotW = w - AXIS_W;
    const top = 6;
    const bottom = height - AXIS_H;
    const total = h.counts.reduce((a, b) => a + b, 0);
    const max = niceMax(Math.max(1, ...h.counts));
    const y = (v: number) => bottom - (v / max) * (bottom - top);
    const bw = plotW / HIST_BANDS;
    const muted = css('--muted');
    g.textBaseline = 'middle';
    for (const v of [0, max / 2, max]) {
      g.fillStyle = css('--border');
      g.fillRect(0, Math.round(y(v)) - 0.5, plotW, 1);
      g.fillStyle = muted;
      g.fillText(fmtCount(v), plotW + 6, y(v));
    }
    const blue = css('--bench-1');
    h.counts.forEach((n, i) => {
      if (!n) return;
      const x0 = i * bw + 1;
      const bwi = Math.max(1, bw - 2);
      const yt = Math.min(y(n), bottom - 2);
      g.fillStyle = blue;
      g.globalAlpha = h.hover === null || h.hover === i ? 1 : 0.55;
      g.beginPath();
      g.roundRect(x0, yt, bwi, bottom - yt, [Math.min(4, bwi / 2), Math.min(4, bwi / 2), 0, 0]);
      g.fill();
      g.globalAlpha = 1;
    });
    // 60 and 30 fps as dashed lines across the bands.
    for (const [ms, label] of [
      [1000 / 60, '60 fps'],
      [STUTTER_MS, '30 fps'],
    ] as const) {
      const px = Math.round((ms / HIST_BANDS) * plotW) + 0.5;
      g.strokeStyle = muted;
      g.setLineDash([3, 4]);
      g.beginPath();
      g.moveTo(px, top);
      g.lineTo(px, bottom);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = muted;
      g.fillText(label, px + 4, top + 6);
    }
    g.textBaseline = 'top';
    g.fillStyle = muted;
    for (let ms = 0; ms <= 50; ms += 10) {
      const label = ms === 50 ? '50+ ms' : `${ms}`;
      const px = ms * bw;
      g.fillText(label, Math.min(plotW - g.measureText(label).width, px), bottom + 4);
    }
    if (h.hover !== null) {
      const n = h.counts[h.hover]!;
      const band =
        h.hover === HIST_BANDS - 1 ? `${HIST_BANDS - 1}+ ms` : `${h.hover}–${h.hover + 1} ms`;
      h.readout.textContent = `${band}: ${n} frames (${((n / Math.max(1, total)) * 100).toFixed(1)}%)`;
    } else {
      const over = h.counts.slice(17).reduce((a, b) => a + b, 0);
      h.readout.textContent = `${((over / Math.max(1, total)) * 100).toFixed(1)}% of frames over 17 ms`;
    }
  }

  // ---------------------------------------------------------------- saving

  private save(r: BenchResult, kind: 'json' | 'csv'): void {
    let text: string;
    if (kind === 'json') text = JSON.stringify(r, null, 1);
    else {
      const rows = [
        't_ms,frame_ms,sim_ms,scene_ms,draw_ms,server_ms,draw_calls,triangles,heap_mb,phase',
      ];
      for (const f of r.frames) {
        const phase = `"${(r.phases[f.phase] ?? '').replace(/"/g, '""')}"`;
        rows.push(
          [f.t, f.frame, f.sim, f.scene, f.draw, f.server]
            .map((v) => v.toFixed(3))
            .concat([String(f.calls), String(f.triangles), f.heap.toFixed(1), phase])
            .join(','),
        );
      }
      text = rows.join('\n');
    }
    const blob = new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sar-benchmark-${r.date.slice(0, 19).replace(/[:T]/g, '-')}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
