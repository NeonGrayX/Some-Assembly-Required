import { BOT_LEVEL_NAMES, BUILDS, arenaGames, mapById, summarizeArena } from '@sar/shared';
import type { ArenaGame, ArenaResult } from '@sar/shared';
import { MODE_NAMES } from '../ui/lobby.ts';
import type { ArenaJob, ArenaNews } from './arena.worker.ts';
import type { BotRun } from './setup.ts';
import { button, download, head, sheet, stamp, table, tiles } from './sheet.ts';

/** Everything a bot run played, as it is saved. */
export interface ArenaReport {
  date: string;
  version: string;
  stopped: boolean;
  run: BotRun;
  /** Rounds played at once. */
  workers: number;
  /** Real seconds the run took. */
  seconds: number;
  rounds: ArenaResult[];
}

const REASONS: Record<string, string> = {
  done: 'build finished',
  time: 'time ran out',
  votes: 'voted out',
  none: 'stopped',
};

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–');
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const buildName = (id: string) => BUILDS.find((b) => b.id === id)?.name ?? id;

/** Redraws the results at most this often while rounds come in. */
const REDRAW_MS = 500;

/**
 * Bots against bots: rounds played headless in workers, as many at once as the computer has
 * cores to spare, each as fast as it goes. The page fills in as rounds finish: who won, how
 * fast the build went up, who was caught, and how each level did on each side.
 */
export class BotArena {
  private readonly el = sheet('bench-arena');
  private workers: Worker[] = [];
  private games: ArenaGame[] = [];
  private results: (ArenaResult | undefined)[] = [];
  /** How far each round being played is, by index. */
  private playing = new Map<number, number>();
  private next = 0;
  /** Rounds played at once. */
  private count = 0;
  private run: BotRun | null = null;
  private startedAt = 0;
  private endedAt = 0;
  private stopped = false;
  private error = '';
  private drawnAt = 0;
  private redraw = 0;
  private bar!: HTMLElement;
  private meta!: HTMLElement;
  private body!: HTMLElement;
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (this.running) this.stop();
    else this.close();
  };

  constructor(
    /** Back to the setup page. */
    private readonly onSetup: () => void,
  ) {}

  /** Rounds are being played (nothing else needs drawing meanwhile). */
  get running(): boolean {
    return this.workers.length > 0;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  start(run: BotRun): void {
    this.cancel();
    this.run = run;
    this.games = arenaGames(run);
    this.results = [];
    this.playing.clear();
    this.next = 0;
    this.stopped = false;
    this.error = '';
    this.startedAt = performance.now();
    this.endedAt = 0;
    const cores = navigator.hardwareConcurrency || 2;
    this.count = Math.max(1, Math.min(this.games.length, cores - 1));
    for (let i = 0; i < this.count; i++) {
      const w = new Worker(new URL('./arena.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<ArenaNews>) => this.hear(w, e.data);
      w.onerror = (e) => this.fail(e.message || 'A worker stopped.');
      this.workers.push(w);
      this.hand(w);
    }
    this.el.hidden = false;
    this.el.scrollTop = 0;
    window.addEventListener('keydown', this.onKey);
    this.draw();
  }

  /** Stops the rounds still being played; the ones finished are kept. */
  stop(): void {
    if (!this.running) return;
    this.stopped = true;
    this.end();
  }

  /** The app bar's Back: stops any rounds still being played and puts the page away. */
  back(): void {
    this.cancel();
  }

  /** Stops and puts the page away. */
  cancel(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.close();
  }

  private close(): void {
    this.el.hidden = true;
    window.removeEventListener('keydown', this.onKey);
    window.clearTimeout(this.redraw);
  }

  private hand(w: Worker): void {
    if (this.next >= this.games.length) return;
    const index = this.next++;
    this.playing.set(index, 0);
    w.postMessage({ index, game: this.games[index]! } satisfies ArenaJob);
  }

  private hear(w: Worker, news: ArenaNews): void {
    if (!this.running) return;
    if (news.kind === 'progress') {
      this.playing.set(news.index, news.done);
      this.progress();
      return;
    }
    if (news.kind === 'error') return this.fail(news.message);
    this.playing.delete(news.index);
    this.results[news.index] = news.result;
    this.hand(w);
    if (this.results.filter(Boolean).length === this.games.length) this.end();
    else this.soon();
  }

  private fail(message: string): void {
    this.error = message;
    this.stopped = true;
    this.end();
  }

  private end(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.playing.clear();
    this.endedAt = performance.now();
    this.draw();
  }

  private get finished(): ArenaResult[] {
    return this.results.filter((r): r is ArenaResult => !!r);
  }

  private report(): ArenaReport {
    return {
      date: new Date().toISOString(),
      version: __APP_VERSION__,
      stopped: this.stopped,
      run: this.run!,
      workers: this.count,
      seconds: ((this.endedAt || performance.now()) - this.startedAt) / 1000,
      rounds: this.finished,
    };
  }

  /** Redraws soon, not on every round. */
  private soon(): void {
    window.clearTimeout(this.redraw);
    const wait = Math.max(0, this.drawnAt + REDRAW_MS - performance.now());
    this.redraw = window.setTimeout(() => this.draw(), wait);
  }

  private metaText(): string {
    const run = this.run!;
    const done = this.finished.length;
    const wall = ((this.endedAt || performance.now()) - this.startedAt) / 1000;
    const played = this.finished.reduce((s, r) => s + r.took, 0);
    const speed = wall > 1 && played ? ` · ${Math.round(played / wall)}× real time` : '';
    const state = this.running
      ? `${done} of ${this.games.length} rounds · ${this.playing.size} playing at once`
      : `${done} of ${this.games.length} rounds${this.stopped ? ', stopped' : ''}`;
    return (
      `${state} · ${clock(wall)}${speed} · ${MODE_NAMES[run.mode]}, ` +
      `${run.seconds / 60} minute rounds, ${run.bots.length} bots, ` +
      `${run.maps.map((m) => mapById(m).name).join(', ')}` +
      (this.error ? ` · ${this.error}` : '')
    );
  }

  private progress(): void {
    let done = this.finished.length;
    for (const d of this.playing.values()) done += d;
    this.bar.style.width = `${(done / Math.max(1, this.games.length)) * 100}%`;
    this.meta.textContent = this.metaText();
  }

  private draw(): void {
    window.clearTimeout(this.redraw);
    this.drawnAt = performance.now();
    const page = document.createElement('div');
    page.className = 'bench-page';
    const run = this.run!;
    const buttons = this.running
      ? [button('Stop', () => this.stop(), true)]
      : [
          button('Save JSON', () => this.save('json')),
          button('Save CSV', () => this.save('csv')),
          button('Run again', () => this.start(run), true),
          button('Change settings', () => {
            this.close();
            this.onSetup();
          }),
        ];
    const top = head('Bots against bots', '', buttons);
    this.meta = top.meta;
    page.append(top.head);
    const track = document.createElement('div');
    track.className = 'bench-progress';
    track.hidden = !this.running;
    this.bar = document.createElement('div');
    track.append(this.bar);
    top.head.append(track);
    this.body = document.createElement('div');
    page.append(this.body);
    this.fill();
    if (!this.finished.length) {
      const p = document.createElement('p');
      p.className = 'bench-note box';
      p.textContent = this.running
        ? 'The first rounds are being played.'
        : 'No round finished, so there is nothing to show.';
      this.body.append(p);
    }
    this.el.replaceChildren(page);
    this.progress();
  }

  private fill(): void {
    const rs = this.finished;
    if (!rs.length) return;
    const run = this.run!;
    const s = summarizeArena(rs);
    const n = rs.length;
    const wins = (side: string) => s.wins[side] ?? 0;
    const saboteurSeats = s.groups
      .filter((g) => g.side === 'saboteurs')
      .reduce((t, g) => t + g.seats, 0);
    const builderSeats = s.groups
      .filter((g) => g.side === 'builders')
      .reduce((t, g) => t + g.seats, 0);
    const reasons = (Object.entries(s.reasons) as [string, number][])
      .map(([r, c]) => `${c} ${REASONS[r] ?? r}`)
      .join(' · ');
    const items: [string, string, string][] =
      run.mode === 'coop'
        ? [['Builds finished', pct(wins('builders'), n), `${wins('builders')} of ${n} rounds`]]
        : [
            ['Builders won', pct(wins('builders'), n), `${wins('builders')} of ${n} rounds`],
            ['Saboteurs won', pct(wins('saboteurs'), n), `${wins('saboteurs')} of ${n} rounds`],
          ];
    items.push(
      ['How rounds ended', String(n), reasons],
      [
        'Build time',
        s.buildTime === null ? '–' : clock(s.buildTime),
        'on average, in rounds the build was finished',
      ],
      ['Build at the end', pct(s.built, 1), 'of the bricks right, on average'],
    );
    if (run.mode !== 'coop') {
      items.push(
        ['Saboteurs caught', String(s.saboteursCaught), `voted off, of ${saboteurSeats} saboteurs`],
        [
          'Innocents sent home',
          String(s.innocentsSentHome),
          `voted off, of ${builderSeats} builders`,
        ],
      );
    }
    items.push(
      ['Meetings', (s.meetings / n).toFixed(1), 'a round, on average'],
      ['Breaks', (s.breaks / n).toFixed(1), 'times a round the build broke'],
    );
    this.body.append(tiles(items));

    const groups = [...s.groups].sort(
      (a, b) =>
        a.side.localeCompare(b.side) ||
        Object.keys(BOT_LEVEL_NAMES).indexOf(a.level) -
          Object.keys(BOT_LEVEL_NAMES).indexOf(b.level),
    );
    this.body.append(
      table(
        'By level and side',
        ['Bots', 'Seats', 'Won', 'Sent home'],
        groups.map((g) => [
          `${BOT_LEVEL_NAMES[g.level]} ${g.side === 'saboteurs' ? 'saboteurs' : 'builders'}`,
          String(g.seats),
          `${pct(g.wins, g.seats)} (${g.wins})`,
          `${pct(g.sentHome, g.seats)} (${g.sentHome})`,
        ]),
      ),
      table(
        'Rounds',
        ['Round', 'Map', 'Build', 'Winner', 'Ended', 'Took', 'Built', 'Meetings', 'Breaks'],
        this.results.flatMap((r, i) =>
          r
            ? [
                [
                  String(i + 1),
                  mapById(r.map).name,
                  buildName(r.build),
                  r.winner,
                  REASONS[r.reason] ?? r.reason,
                  clock(r.took),
                  pct(r.correct, r.total),
                  String(r.meetings),
                  String(r.breaks),
                ],
              ]
            : [],
        ),
      ),
    );
  }

  private save(kind: 'json' | 'csv'): void {
    const r = this.report();
    let text: string;
    if (kind === 'json')
      text = JSON.stringify({ ...r, summary: summarizeArena(r.rounds) }, null, 1);
    else {
      const rows = [
        'round,seed,map,build,winner,reason,took_s,correct,total,meetings,breaks,bot,level,role,won,sent_home',
      ];
      r.rounds.forEach((g, i) =>
        g.seats.forEach((seat, b) =>
          rows.push(
            [
              i + 1,
              g.seed,
              g.map,
              g.build,
              g.winner,
              g.reason,
              g.took,
              g.correct,
              g.total,
              g.meetings,
              g.breaks,
              b + 1,
              seat.level,
              seat.role,
              seat.won,
              seat.sentHome,
            ].join(','),
          ),
        ),
      );
      text = rows.join('\n');
    }
    download(
      text,
      `sar-bots-${stamp(r.date)}.${kind}`,
      kind === 'json' ? 'application/json' : 'text/csv',
    );
  }
}
