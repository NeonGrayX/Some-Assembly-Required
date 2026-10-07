import {
  BUILDS,
  BUILD_FILE_EXTENSION,
  HOUSE,
  addImportedBuild,
  binColours,
  buildById,
  importedBuilds,
  parseBuildFile,
  stringifyBuildFile,
} from '@sar/shared';
import type { Role, Room, TargetBuild } from '@sar/shared';
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
/** Imported build files, kept as their text so they come back after a reload. */
const FILES_KEY = 'sar.demo.builds';

function savedFiles(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FILES_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Reads build files imported on an earlier visit back in, before the settings are loaded. */
function restoreImports(): void {
  for (const text of Object.values(savedFiles())) {
    const r = parseBuildFile(text, binColours(HOUSE));
    if (r.ok && !BUILDS.some((b) => b.id === r.build.id)) addImportedBuild(r.build);
  }
}

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
      build: buildById(saved.build ?? '') ? saved.build! : fallback.build,
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
  private readonly file = $<HTMLInputElement>('#demo-file');
  private readonly fileMsg = $('#demo-file-msg');
  private readonly power = $<HTMLButtonElement>('#demo-power');
  private readonly settings: DemoSettings;
  private room: Room | null = null;

  constructor(private readonly game: () => ClientGame | null) {
    restoreImports();
    this.settings = load();
    this.listBuilds();
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
    $('#demo-clear').addEventListener('click', () => this.room?.demoClearPieces());
    this.power.addEventListener('click', () => {
      if (this.powerOn()) this.room?.demoPowerCut();
      else this.room?.demoPowerRestore();
    });
    $('#demo-import').addEventListener('click', () => this.file.click());
    this.file.addEventListener('change', () => void this.importFile());
    $('#demo-export').addEventListener('click', () => this.exportBuild());
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

  /** Keeps the power button saying what it will do next; called every frame. */
  update(): void {
    const label = this.powerOn() ? 'Power cut' : 'Power restore';
    if (this.power.textContent !== label) this.power.textContent = label;
  }

  private powerOn(): boolean {
    return this.game()?.sim.power.on ?? true;
  }

  /** The built-in builds, then the imported ones. */
  private listBuilds(): void {
    this.build.replaceChildren();
    const option = (b: TargetBuild, tag = '') =>
      new Option(`${b.name}${tag} (${b.steps.length} pages)`, b.id);
    for (const b of BUILDS) this.build.add(option(b));
    for (const b of importedBuilds()) this.build.add(option(b, ', imported'));
  }

  /**
   * Reads a build file the player picked, adds the build to the list and starts a round with
   * it, its manual pinned to the corkboard.
   */
  private async importFile(): Promise<void> {
    const picked = this.file.files?.[0];
    this.file.value = '';
    if (!picked) return;
    const r = parseBuildFile(await picked.text(), binColours(HOUSE));
    if (!r.ok) {
      const more = r.problems.length > 6 ? `\n…and ${r.problems.length - 6} more` : '';
      this.message(
        `Could not import ${picked.name}:\n${r.problems.slice(0, 6).join('\n')}${more}`,
        true,
      );
      return;
    }
    const build = this.makeRoom(r.build);
    addImportedBuild(build);
    const files = savedFiles();
    files[build.id] = stringifyBuildFile(build);
    try {
      localStorage.setItem(FILES_KEY, JSON.stringify(files));
    } catch {
      // Storage can be blocked; the build is just gone after a reload then.
    }
    this.listBuilds();
    this.message(
      build.id === r.build.id
        ? `Imported ${build.name}.`
        : `Imported ${build.name} as "${build.id}", since a built-in build has that id.`,
    );
    this.settings.build = build.id;
    this.settings.pinned = true;
    this.newRound();
  }

  /**
   * Gives an imported build an id and a name no built-in build has. Importing the same id again
   * replaces the earlier import.
   */
  private makeRoom(build: TargetBuild): TargetBuild {
    const builtIn = (id: string) => BUILDS.some((b) => b.id === id);
    const id = builtIn(build.id) ? `custom-${build.id}`.slice(0, 32) : build.id;
    const taken = new Set(
      [...BUILDS, ...importedBuilds()].filter((b) => b.id !== id).map((b) => b.name),
    );
    let name = build.name;
    for (let n = 2; taken.has(name); n++) name = `${build.name.slice(0, 15)} (${n})`;
    return { ...build, id, name };
  }

  /** Saves the build picked in the panel, with its manual, as a build file. */
  private exportBuild(): void {
    const build = buildById(this.settings.build);
    if (!build) return;
    const blob = new Blob([stringifyBuildFile(build)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${build.id}${BUILD_FILE_EXTENSION}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.message(`Exported ${build.name} to ${a.download}.`);
  }

  private message(text: string, error = false): void {
    this.fileMsg.textContent = text;
    this.fileMsg.classList.toggle('error', error);
    this.fileMsg.classList.remove('hidden');
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
