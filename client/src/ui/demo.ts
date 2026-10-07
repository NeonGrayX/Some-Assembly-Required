import { BUILDS } from '@sar/shared';
import type { Role, Room } from '@sar/shared';
import type { ClientGame } from '../net/game.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** What the demo panel is set to; remembered between visits. */
export interface DemoSettings {
  build: string;
  night: boolean;
  role: Role;
  pinned: boolean;
}

const KEY = 'sar.demo';

function load(): DemoSettings {
  const fallback: DemoSettings = {
    build: BUILDS[0]!.id,
    night: false,
    role: 'builder',
    pinned: true,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DemoSettings>;
    return {
      build: BUILDS.some((b) => b.id === saved.build) ? saved.build! : fallback.build,
      night: typeof saved.night === 'boolean' ? saved.night : fallback.night,
      role: saved.role === 'saboteur' ? 'saboteur' : 'builder',
      pinned: typeof saved.pinned === 'boolean' ? saved.pinned : fallback.pinned,
    };
  } catch {
    return fallback;
  }
}

/**
 * Demo mode's panel: pick the build, day or night, builder or saboteur, have the manuals
 * pinned to the corkboard, and finish the build in one click. It drives the solo room in this
 * tab directly, so it never exists in an online room.
 */
export class DemoPanel {
  private readonly el = $('#demo-panel');
  private readonly build = $<HTMLSelectElement>('#demo-build');
  private readonly pinned = $<HTMLInputElement>('#demo-pinned');
  private readonly settings = load();
  private room: Room | null = null;

  constructor(private readonly game: () => ClientGame | null) {
    for (const b of BUILDS) this.build.add(new Option(`${b.name} (${b.steps.length} pages)`, b.id));
    this.build.addEventListener('change', () => {
      this.settings.build = this.build.value;
      this.newRound();
    });
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('[data-night]')) {
      btn.addEventListener('click', () => this.setNight(btn.dataset.night === '1'));
    }
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('[data-role]')) {
      btn.addEventListener('click', () => this.setRole(btn.dataset.role as Role));
    }
    this.pinned.addEventListener('change', () => {
      this.settings.pinned = this.pinned.checked;
      if (this.pinned.checked) this.room?.demoPinManuals();
      this.changed();
    });
    $('#demo-finish').addEventListener('click', () => this.room?.demoFinishBuild());
    $('#demo-restart').addEventListener('click', () => this.newRound());
    this.el.querySelector('.fold')!.addEventListener('click', () => {
      const folded = this.el.classList.toggle('folded');
      this.el.querySelector('.fold')!.textContent = folded ? 'Show' : 'Hide';
    });
    this.changed();
  }

  get active(): boolean {
    return this.room !== null;
  }

  /** Takes over a newly opened solo room and starts the first round in it. */
  start(room: Room): void {
    this.room = room;
    document.body.classList.add('demo');
    this.el.classList.remove('hidden');
    this.newRound();
  }

  /** Leaves demo mode (another game was opened). */
  stop(): void {
    this.room = null;
    document.body.classList.remove('demo');
    this.el.classList.add('hidden');
  }

  newRound(): void {
    this.room?.demoRound({ ...this.settings });
    this.changed();
  }

  private setNight(night: boolean): void {
    this.settings.night = night;
    this.room?.demoNight(night);
    // The round goes on: only the lighting changes, so there is no new world to wait for.
    const g = this.game();
    if (g) g.night = night;
    this.changed();
  }

  private setRole(role: Role): void {
    this.settings.role = role;
    const g = this.game();
    if (g && g.myId >= 0) this.room?.demoRole(g.myId, role);
    this.changed();
  }

  /** Shows the current choices and remembers them. */
  private changed(): void {
    const s = this.settings;
    this.build.value = s.build;
    this.pinned.checked = s.pinned;
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('[data-night]')) {
      btn.classList.toggle('on', (btn.dataset.night === '1') === s.night);
    }
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>('[data-role]')) {
      btn.classList.toggle('on', btn.dataset.role === s.role);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // Storage can be blocked; the choices just are not remembered then.
    }
  }
}
