import {
  ARENA_MODES,
  BOT_LEVELS,
  BOT_LEVEL_NAMES,
  MAPS,
  MAX_PLAYERS,
  ROUND_LENGTHS,
  isBotLevel,
  isMapId,
} from '@sar/shared';
import type { ArenaBot, ArenaMode, ChosenRole, MapId } from '@sar/shared';
import { PRESETS, VISUAL_STYLES, fromPreset } from '../graphics-settings.ts';
import type { GraphicsSettings, Preset, VisualStyle } from '../graphics-settings.ts';
import { MODE_NAMES } from '../ui/lobby.ts';
import { button, head, select, sheet } from './sheet.ts';

/** A frame-rate run: the fixed bot run over these maps, drawn with these settings. */
export interface FrameRun {
  kind: 'frames';
  maps: MapId[];
  graphics: GraphicsSettings;
}

/** Bots playing whole rounds against each other, headless and as fast as they go. */
export interface BotRun {
  kind: 'bots';
  maps: MapId[];
  mode: ArenaMode;
  seconds: number;
  rounds: number;
  bots: ArenaBot[];
}

export type BenchRun = FrameRun | BotRun;

/** What the setup page shows, remembered for next time. */
interface Choices {
  kind: BenchRun['kind'];
  maps: MapId[];
  /** 'yours': the settings the player plays with. */
  preset: Preset | 'yours';
  style: VisualStyle | 'yours';
  mode: ArenaMode;
  seconds: number;
  rounds: number;
  bots: ArenaBot[];
}

const KEY = 'sar.benchSetup';
const ALL_MAPS = MAPS.map((m) => m.id);
const MIN_BOTS = 2;
const MAX_ROUNDS = 1000;

const DEFAULTS: Choices = {
  kind: 'frames',
  maps: ALL_MAPS,
  preset: 'yours',
  style: 'yours',
  mode: 'saboteur',
  seconds: 300,
  rounds: 20,
  bots: Array.from({ length: 6 }, () => ({ level: 'normal', role: null })),
};

const ROLE_NAMES: readonly (readonly ['random' | ChosenRole, string])[] = [
  ['random', 'Dealt at random'],
  ['saboteur', 'Saboteur'],
  ['builder', 'Builder'],
];

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Saved choices, with anything unknown or out of range put back to its default. */
function load(): Choices {
  let raw: Partial<Choices> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Choices>;
  } catch {
    // Blocked or broken storage: start from the defaults.
  }
  const d = DEFAULTS;
  const maps = Array.isArray(raw.maps) ? raw.maps.filter(isMapId) : [];
  const bots = Array.isArray(raw.bots)
    ? raw.bots
        .filter((b) => b && isBotLevel(b.level))
        .slice(0, MAX_PLAYERS)
        .map((b) => ({
          level: b.level,
          role: b.role === 'saboteur' || b.role === 'builder' ? b.role : null,
        }))
    : [];
  const rounds = Math.round(Number(raw.rounds));
  return {
    kind: raw.kind === 'bots' ? 'bots' : 'frames',
    maps: maps.length ? maps : d.maps,
    preset: raw.preset && raw.preset in PRESETS ? raw.preset : d.preset,
    style: VISUAL_STYLES.includes(raw.style as VisualStyle) ? raw.style! : d.style,
    mode: ARENA_MODES.includes(raw.mode as ArenaMode) ? raw.mode! : d.mode,
    seconds: ROUND_LENGTHS.includes(raw.seconds as number) ? raw.seconds! : d.seconds,
    rounds: rounds >= 1 && rounds <= MAX_ROUNDS ? rounds : d.rounds,
    bots: bots.length >= MIN_BOTS ? bots : d.bots.map((b) => ({ ...b })),
  };
}

/**
 * What the benchmark runs, picked before it starts: the frame-rate run (which maps, drawn
 * how), or bots playing rounds against each other (the mode, the maps, how long and how many
 * rounds, and each bot's level and role). The frame-rate run itself is the same every time.
 */
export class BenchSetup {
  private readonly el = sheet('bench-setup');
  private choices = load();
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    this.close();
  };

  constructor(
    /** The graphics settings the player plays with. */
    private readonly current: () => GraphicsSettings,
    private readonly onStart: (run: BenchRun) => void,
  ) {}

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.render();
    this.el.hidden = false;
    this.el.scrollTop = 0;
    window.addEventListener('keydown', this.onKey);
  }

  hide(): void {
    this.el.hidden = true;
    window.removeEventListener('keydown', this.onKey);
  }

  private close(): void {
    this.hide();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.choices));
    } catch {
      // Not remembered, then.
    }
  }

  /** Changes the choices and draws the page again. */
  private set(change: Partial<Choices>): void {
    Object.assign(this.choices, change);
    this.save();
    this.render();
  }

  /** The run the choices describe. */
  private run(): BenchRun {
    const c = this.choices;
    const maps = ALL_MAPS.filter((m) => c.maps.includes(m));
    if (c.kind === 'bots') {
      return {
        kind: 'bots',
        maps,
        mode: c.mode,
        seconds: c.seconds,
        rounds: c.rounds,
        bots: c.bots.map((b) => ({ ...b })),
      };
    }
    const mine = this.current();
    const style = c.style === 'yours' ? mine.style : c.style;
    const graphics = c.preset === 'yours' ? { ...mine, style } : fromPreset(c.preset, style);
    return { kind: 'frames', maps, graphics };
  }

  private render(): void {
    const c = this.choices;
    const page = document.createElement('div');
    page.className = 'bench-page';
    const start = button(
      'Start',
      () => {
        this.hide();
        this.onStart(this.run());
      },
      true,
    );
    const ok = c.maps.length > 0;
    start.disabled = !ok;
    page.append(
      head(
        'Benchmark',
        c.kind === 'frames'
          ? 'The same run every time, so results compare between computers and versions. ' +
              'Pick the maps it visits and the graphics it draws them with.'
          : 'Bots play whole rounds against each other with nothing drawn, as fast as this ' +
              'computer goes, one round per core at a time. More rounds give steadier numbers.',
        [start, button('Close', () => this.close())],
      ).head,
    );

    const tabs = document.createElement('div');
    tabs.className = 'bench-tabs';
    for (const [kind, text] of [
      ['frames', 'Frame rate'],
      ['bots', 'Bots against bots'],
    ] as const) {
      const b = button(text, () => this.set({ kind }), c.kind === kind);
      b.setAttribute('aria-pressed', String(c.kind === kind));
      tabs.append(b);
    }
    page.append(tabs);

    const grid = document.createElement('div');
    grid.className = 'bench-form';
    grid.append(this.mapsBox(ok));
    if (c.kind === 'frames') grid.append(this.graphicsBox());
    else grid.append(this.roundsBox(), this.botsBox());
    page.append(grid);
    this.el.replaceChildren(page);
  }

  private box(title: string, note: string): HTMLElement {
    const box = document.createElement('section');
    box.className = 'bench-box';
    const h = document.createElement('h3');
    h.textContent = title;
    box.append(h);
    if (note) {
      const p = document.createElement('p');
      p.className = 'bench-note';
      p.textContent = note;
      box.append(p);
    }
    return box;
  }

  private mapsBox(ok: boolean): HTMLElement {
    const c = this.choices;
    const box = this.box(
      'Maps',
      ok
        ? c.kind === 'frames'
          ? 'Visited in this order.'
          : 'Rounds go round these in turn.'
        : 'Pick at least one map.',
    );
    const list = document.createElement('div');
    list.className = 'bench-checks';
    for (const m of MAPS) {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = c.maps.includes(m.id);
      cb.addEventListener('change', () =>
        this.set({
          maps: cb.checked ? [...c.maps, m.id] : c.maps.filter((id) => id !== m.id),
        }),
      );
      l.append(cb, ` ${m.name}`);
      list.append(l);
    }
    const all = c.maps.length === ALL_MAPS.length;
    const toggle = button(all ? 'None' : 'All', () => this.set({ maps: all ? [] : ALL_MAPS }));
    toggle.classList.add('bench-small');
    box.append(list, toggle);
    return box;
  }

  private graphicsBox(): HTMLElement {
    const c = this.choices;
    const mine = this.current();
    const box = this.box('Graphics', 'Your own settings come back once the run ends.');
    box.append(
      select(
        'Quality',
        [
          ['yours', `Your settings (${mine.preset})`],
          ...(Object.keys(PRESETS) as Preset[]).map((p) => [p, cap(p)] as const),
        ],
        c.preset,
        (preset) => this.set({ preset }),
      ),
      select(
        'Look',
        [['yours', `Your look (${mine.style})`], ...VISUAL_STYLES.map((s) => [s, cap(s)] as const)],
        c.style,
        (style) => this.set({ style }),
      ),
    );
    return box;
  }

  private roundsBox(): HTMLElement {
    const c = this.choices;
    const box = this.box('Rounds', '');
    const rounds = document.createElement('label');
    rounds.className = 'bench-field';
    const span = document.createElement('span');
    span.textContent = 'Rounds';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(MAX_ROUNDS);
    input.value = String(c.rounds);
    // Kept as it is typed, so a change elsewhere that redraws the page does not lose it.
    const take = () => {
      const n = Math.round(Number(input.value));
      if (input.value && Number.isFinite(n)) c.rounds = Math.min(MAX_ROUNDS, Math.max(1, n));
      this.save();
    };
    input.addEventListener('input', take);
    input.addEventListener('change', () => {
      take();
      input.value = String(c.rounds);
    });
    rounds.append(span, input);
    box.append(
      select(
        'Mode',
        ARENA_MODES.map((m) => [m, cap(MODE_NAMES[m])] as const),
        c.mode,
        (mode) => this.set({ mode }),
      ),
      select(
        'Round length',
        ROUND_LENGTHS.map((s) => [String(s), `${s / 60} minutes`] as const),
        String(c.seconds),
        (s) => this.set({ seconds: Number(s) }),
      ),
      rounds,
    );
    return box;
  }

  private botsBox(): HTMLElement {
    const c = this.choices;
    const box = this.box(
      `Bots (${c.bots.length})`,
      c.mode === 'coop'
        ? 'Plain co-op has no roles: everyone builds.'
        : 'A role left to chance is dealt like a player’s. Bots not picked as saboteurs build.',
    );
    box.classList.add('bench-wide');
    c.bots.forEach((bot, i) => {
      const row = document.createElement('div');
      row.className = 'bench-bot';
      const name = document.createElement('span');
      name.textContent = `Bot ${i + 1}`;
      const level = select(
        'Level',
        BOT_LEVELS.map((l) => [l, BOT_LEVEL_NAMES[l]] as const),
        bot.level,
        (level) => {
          bot.level = level;
          this.save();
        },
      );
      const role = select('Role', ROLE_NAMES, bot.role ?? 'random', (r) => {
        bot.role = r === 'random' ? null : r;
        this.save();
      });
      role.querySelector('select')!.disabled = c.mode === 'coop';
      const remove = button('Remove', () => this.set({ bots: c.bots.filter((b) => b !== bot) }));
      remove.classList.add('bench-small');
      remove.disabled = c.bots.length <= MIN_BOTS;
      row.append(name, level, role, remove);
      box.append(row);
    });
    const add = button('Add bot', () =>
      this.set({ bots: [...c.bots, { ...(c.bots[c.bots.length - 1] ?? DEFAULTS.bots[0]!) }] }),
    );
    add.classList.add('bench-small');
    add.disabled = c.bots.length >= MAX_PLAYERS;
    box.append(add);
    return box;
  }
}
