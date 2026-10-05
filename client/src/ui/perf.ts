/** How far back the graphs reach. */
const WINDOW_MS = 10_000;
/** Frames are averaged over slices this long, so a single slow frame still shows as a dip. */
const SLICE_MS = 100;
const WIDTH = 280;
const HEIGHT = 64;
/** Room on the right of the plot for the axis labels. */
const AXIS = 30;

interface Point {
  at: number;
  v: number;
}

interface Chart {
  canvas: HTMLCanvasElement;
  readout: HTMLElement;
  colour: string;
  unit: string;
  /** The value axis never shrinks below this, so a steady 60 fps does not look jumpy. */
  floor: number;
  points: Point[];
  hoverX: number | null;
}

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A round number at or above `v`: 1, 2 or 5 times a power of ten. */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return [1, 2, 5, 10].map((m) => m * p).find((n) => n >= v)!;
}

/**
 * Click the fps counter for frame rate and ping over the last ten seconds. Frame rate is
 * measured from how long frames took, so hitches show up as dips rather than averaging out.
 */
export class PerfPanel {
  private readonly el: HTMLElement;
  private readonly fps: Chart;
  private readonly ping: Chart;
  private readonly noPing: HTMLElement;
  private frames: number[] = [];
  private lastDraw = 0;
  private isOpen = false;

  constructor(
    status: HTMLElement,
    /** Measured round trips, or null in a solo game (no network to measure). */
    private readonly pings: () => { at: number; ms: number }[] | null,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.hidden = true;
    this.fps = this.chart('Frame rate', 'fps', css('--perf-fps'), 60);
    this.ping = this.chart('Ping', 'ms', css('--perf-ping'), 50);
    this.noPing = document.createElement('p');
    this.noPing.className = 'perf-empty';
    this.noPing.textContent = 'Solo game: no network, so no ping.';
    this.el.append(this.noPing);
    status.after(this.el);
    status.title = 'Click for frame rate and ping over the last 10 seconds';
    status.addEventListener('click', () => this.toggle());
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.el.hidden = !this.isOpen;
    this.lastDraw = 0;
  }

  /** Frames drawn per second over the last second, for the status line. */
  currentFps(now: number): number {
    const f = this.frames;
    let i = f.length - 1;
    while (i > 0 && f[i - 1]! >= now - 1000) i--;
    const span = f[f.length - 1]! - f[i]!;
    return span > 0 ? ((f.length - 1 - i) * 1000) / span : 0;
  }

  /** Call once per rendered frame. */
  frame(now: number): void {
    this.frames.push(now);
    const from = now - WINDOW_MS - SLICE_MS;
    let drop = 0;
    while (drop < this.frames.length && this.frames[drop]! < from) drop++;
    if (drop) this.frames.splice(0, drop);
    if (!this.isOpen || now - this.lastDraw < 100) return;
    this.lastDraw = now;

    this.fps.points = this.frameRates(now);
    const pings = this.pings();
    if (pings) {
      while (pings.length && pings[0]!.at < now - WINDOW_MS) pings.shift();
      this.ping.points = pings.map((p) => ({ at: p.at, v: p.ms }));
    }
    this.ping.canvas.parentElement!.hidden = pings === null;
    this.noPing.hidden = pings !== null;
    this.draw(this.fps, now);
    if (pings) this.draw(this.ping, now);
  }

  /** Average frame rate in each slice of the window, from the frames that ended in it. */
  private frameRates(now: number): Point[] {
    const points: Point[] = [];
    let i = 1;
    for (let end = now - WINDOW_MS + SLICE_MS; end <= now + 1e-6; end += SLICE_MS) {
      let total = 0;
      let count = 0;
      for (; i < this.frames.length && this.frames[i]! <= end; i++) {
        total += this.frames[i]! - this.frames[i - 1]!;
        count++;
      }
      if (count) points.push({ at: end, v: 1000 / (total / count) });
    }
    return points;
  }

  private chart(title: string, unit: string, colour: string, floor: number): Chart {
    const box = document.createElement('section');
    const head = document.createElement('header');
    const name = document.createElement('span');
    name.className = 'perf-name';
    const swatch = document.createElement('i');
    swatch.style.background = colour;
    name.append(swatch, title);
    const readout = document.createElement('span');
    readout.className = 'perf-readout';
    head.append(name, readout);
    const canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${WIDTH}px`;
    canvas.style.height = `${HEIGHT}px`;
    const time = document.createElement('div');
    time.className = 'perf-time';
    time.innerHTML = '<span>−10 s</span><span>now</span>';
    box.append(head, canvas, time);
    this.el.append(box);
    const c: Chart = { canvas, readout, colour, unit, floor, points: [], hoverX: null };
    canvas.addEventListener('mousemove', (e) => {
      c.hoverX = e.offsetX;
      this.lastDraw = 0;
    });
    canvas.addEventListener('mouseleave', () => {
      c.hoverX = null;
      this.lastDraw = 0;
    });
    return c;
  }

  private draw(c: Chart, now: number): void {
    const g = c.canvas.getContext('2d')!;
    const dpr = c.canvas.width / WIDTH;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, WIDTH, HEIGHT);
    const plotW = WIDTH - AXIS;
    const top = 6;
    const bottom = HEIGHT - 6;
    const max = niceMax(Math.max(c.floor, ...c.points.map((p) => p.v)));
    const x = (at: number) => ((at - (now - WINDOW_MS)) / WINDOW_MS) * plotW;
    const y = (v: number) => bottom - (Math.min(v, max) / max) * (bottom - top);

    // Recessive grid: zero, half and the top of the scale, labelled on the right.
    g.font = '10px ui-monospace, monospace';
    g.textBaseline = 'middle';
    for (const v of [0, max / 2, max]) {
      g.fillStyle = css('--perf-grid');
      g.fillRect(0, Math.round(y(v)) - 0.5, plotW, 1);
      g.fillStyle = css('--perf-muted');
      g.fillText(String(v), plotW + 6, y(v));
    }

    if (c.points.length > 1) {
      g.strokeStyle = c.colour;
      g.lineWidth = 2;
      g.lineJoin = g.lineCap = 'round';
      g.beginPath();
      c.points.forEach((p, i) => (i ? g.lineTo(x(p.at), y(p.v)) : g.moveTo(x(p.at), y(p.v))));
      g.stroke();
    }

    // Hover: a crosshair on the nearest sample and its value in the header.
    const last = c.points[c.points.length - 1];
    const fmt = (v: number) => `${Math.round(v)} ${c.unit}`;
    let text = last ? `now ${fmt(last.v)}` : '';
    if (c.points.length) {
      const low = Math.min(...c.points.map((p) => p.v));
      const high = Math.max(...c.points.map((p) => p.v));
      text += c.unit === 'fps' ? ` · low ${Math.round(low)}` : ` · high ${Math.round(high)}`;
    }
    if (c.hoverX !== null && c.points.length) {
      const at = now - WINDOW_MS + (c.hoverX / plotW) * WINDOW_MS;
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
      text = `${((p.at - now) / 1000).toFixed(1)} s: ${fmt(p.v)}`;
    }
    c.readout.textContent = text;
  }
}
