import { SENSITIVITY_MAX, SENSITIVITY_MIN, saveSettings } from '../settings.ts';
import type { MicMode, Settings } from '../settings.ts';
import { fromPreset, presetOf } from '../graphics-settings.ts';
import type { Preset, ShadowQuality, VisualStyle } from '../graphics-settings.ts';
import { THEMES, THEME_MENU, applyTheme, currentTheme, pickTheme } from '../themes.ts';
import type { ThemeId } from '../themes.ts';

export type SettingChange = 'sensitivity' | 'volume' | 'mic' | 'voice' | 'graphics';

/** Each theme's name in the picker is set in that theme's display face, as in the style guide. */
const OPT_FONT: Record<ThemeId, string> = {
  pop: '"Bricolage Grotesque", system-ui, sans-serif',
  bauhaus: 'Jost, Futura, sans-serif',
  blueprint: '"Space Grotesk", Arial, sans-serif',
  arcade: 'Silkscreen, monospace',
  broadsheet: 'Fraunces, Georgia, serif',
  washi: '"Shippori Mincho", Georgia, serif',
  cyberpunk: '"Bricolage Grotesque", "Arial Narrow", sans-serif',
  horizon: 'Frutiger, "Segoe UI", "Noto Sans", Arial, sans-serif',
  bricks: '"Bricolage Grotesque", "Arial Narrow", sans-serif',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The settings dialog, in two tabs: Appearance (the interface's theme, and the 3D world's graphics
 * style and quality) and Gameplay (mouse sensitivity, master volume and mute, and voice chat).
 * Changes apply and save at once.
 */
export class SettingsPanel {
  private readonly el = $('settings');
  private readonly sensitivity = $<HTMLInputElement>('set-sensitivity');
  private readonly volume = $<HTMLInputElement>('set-volume');
  private readonly muted = $<HTMLInputElement>('set-muted');
  private readonly sensitivityOut = $('set-sensitivity-value');
  private readonly volumeOut = $('set-volume-value');
  private readonly mic = $<HTMLSelectElement>('set-mic');
  private readonly voice = $<HTMLInputElement>('set-voice');
  private readonly voiceOut = $('set-voice-value');
  private readonly micNote = $('set-mic-note');
  private readonly style = $<HTMLSelectElement>('set-style');
  private readonly preset = $<HTMLSelectElement>('set-preset');
  private readonly scale = $<HTMLSelectElement>('set-scale');
  private readonly shadows = $<HTMLSelectElement>('set-shadows');
  private readonly ao = $<HTMLInputElement>('set-ao');
  private readonly themePicker = $('set-theme');
  private readonly themeBtn = this.themePicker.querySelector<HTMLButtonElement>('.theme-btn')!;
  private readonly themeMenu = $('set-theme-menu');
  private readonly tabs = [...this.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  /** Why the microphone cannot be used, if it cannot. */
  micProblem = '';

  constructor(
    private readonly settings: Settings,
    private readonly apply: (s: Settings, changed: SettingChange) => void,
    /** Frees the mouse from the game, for the dialog. */
    private readonly freeMouse: () => void,
  ) {
    this.sensitivity.min = String(SENSITIVITY_MIN);
    this.sensitivity.max = String(SENSITIVITY_MAX);
    this.sensitivity.step = '0.05';
    this.sensitivity.value = String(settings.sensitivity);
    this.volume.value = String(Math.round(settings.volume * 100));
    this.muted.checked = settings.muted;
    this.mic.value = settings.mic;
    this.voice.value = String(Math.round(settings.voiceVolume * 100));
    this.show();

    this.sensitivity.addEventListener('input', () => {
      settings.sensitivity = Number(this.sensitivity.value);
      this.changed('sensitivity');
    });
    this.volume.addEventListener('input', () => {
      settings.volume = Number(this.volume.value) / 100;
      // Moving the slider is a clear sign they want sound again.
      settings.muted = false;
      this.muted.checked = false;
      this.changed('volume');
    });
    this.muted.addEventListener('change', () => {
      settings.muted = this.muted.checked;
      this.changed('volume');
    });
    this.mic.addEventListener('change', () => {
      settings.mic = this.mic.value as MicMode;
      this.changed('mic');
    });
    this.style.addEventListener('change', () => {
      settings.graphics = { ...settings.graphics, style: this.style.value as VisualStyle };
      this.changed('graphics');
    });
    this.preset.addEventListener('change', () => {
      settings.graphics = fromPreset(this.preset.value as Preset, settings.graphics.style);
      this.changed('graphics');
    });
    const custom = () => {
      const g = {
        scale: Number(this.scale.value),
        shadows: this.shadows.value as ShadowQuality,
        ao: this.ao.checked,
      };
      settings.graphics = { preset: presetOf(g), ...g, style: settings.graphics.style };
      this.changed('graphics');
    };
    for (const el of [this.scale, this.shadows, this.ao]) {
      el.addEventListener('change', custom);
    }
    this.voice.addEventListener('input', () => {
      settings.voiceVolume = Number(this.voice.value) / 100;
      this.changed('voice');
    });

    // index.html already showed the theme; this also colours the browser's bar to match.
    applyTheme(currentTheme());
    this.buildThemeList();
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.selectTab(tab));
      tab.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        const next =
          this.tabs[(this.tabs.indexOf(tab) + step + this.tabs.length) % this.tabs.length]!;
        this.selectTab(next);
        next.focus();
      });
    }

    for (const b of document.querySelectorAll('[data-open-settings]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.open();
      });
    }
    this.el.querySelector('.close')!.addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  open(): void {
    this.freeMouse();
    this.el.classList.remove('hidden');
  }

  close(): void {
    this.closeThemeMenu();
    this.el.classList.add('hidden');
  }

  /**
   * The theme picker, as in the style guide: one button showing the current theme, which opens
   * a menu with one row per theme, each a sample drawn in that theme's own colours and type.
   */
  private buildThemeList(): void {
    THEME_MENU.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-opt';
      b.setAttribute('role', 'radio');
      b.dataset.pick = t.id;
      b.style.setProperty('--opt-font', OPT_FONT[t.id]);
      b.style.setProperty('--i', String(i));
      b.innerHTML = `<span class="theme-swatch" data-swatch="${t.id}" aria-hidden="true"><b>Aa</b><i></i></span><span><strong></strong><small></small></span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
      b.querySelector('strong')!.textContent = t.name;
      b.querySelector('small')!.textContent = t.note;
      b.addEventListener('click', () => {
        pickTheme(t.id);
        this.showTheme();
        this.closeThemeMenu(true);
      });
      this.themeMenu.append(b);
    });
    this.themeBtn.addEventListener('click', () => {
      if (this.themeMenu.hidden) this.openThemeMenu();
      else this.closeThemeMenu();
    });
    this.themeBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      this.openThemeMenu();
    });
    // Arrow keys try the themes out as they go, as the list did; Enter or a click keeps one.
    this.themeMenu.addEventListener('keydown', (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const opts = [...this.themeMenu.children] as HTMLButtonElement[];
      const at = opts.indexOf(document.activeElement as HTMLButtonElement);
      const next = opts[(Math.max(0, at) + step + opts.length) % opts.length]!;
      pickTheme(next.dataset.pick as ThemeId);
      this.showTheme();
      next.focus();
    });
    // Esc closes the menu, not the whole dialog behind it.
    this.themePicker.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.themeMenu.hidden) return;
      e.stopPropagation();
      e.preventDefault();
      this.closeThemeMenu(true);
    });
    this.themePicker.addEventListener('focusout', (e) => {
      if (!this.themePicker.contains(e.relatedTarget as Node | null)) this.closeThemeMenu();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.themePicker.contains(e.target as Node)) this.closeThemeMenu();
    });
    window.addEventListener('resize', () => this.placeThemeMenu());
    this.el.querySelector('.dialog')!.addEventListener('scroll', () => this.closeThemeMenu());
    this.showTheme();
  }

  private openThemeMenu(): void {
    if (!this.themeMenu.hidden) return;
    this.themeMenu.hidden = false;
    this.themeBtn.setAttribute('aria-expanded', 'true');
    this.placeThemeMenu();
    this.themeMenu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }

  private closeThemeMenu(refocus = false): void {
    if (this.themeMenu.hidden) return;
    this.themeMenu.hidden = true;
    this.themeBtn.setAttribute('aria-expanded', 'false');
    if (refocus) this.themeBtn.focus();
  }

  /**
   * Puts the open menu under the button, its right edge on the button's, or over the button when
   * there is more room above; it scrolls if even that is too short (a phone held sideways).
   */
  private placeThemeMenu(): void {
    if (this.themeMenu.hidden) return;
    const r = this.themeBtn.getBoundingClientRect();
    const gap = 8;
    const edge = 12;
    const below = innerHeight - r.bottom - gap - edge;
    const above = r.top - gap - edge;
    const m = this.themeMenu.style;
    m.maxHeight = '';
    m.top = m.bottom = '';
    const tall = this.themeMenu.scrollHeight;
    if (tall <= below || below >= above) {
      m.top = `${r.bottom + gap}px`;
      m.maxHeight = `${below}px`;
    } else {
      m.bottom = `${innerHeight - r.top + gap}px`;
      m.maxHeight = `${above}px`;
    }
    const w = this.themeMenu.offsetWidth;
    m.left = `${Math.max(edge, Math.min(r.right - w, innerWidth - w - edge))}px`;
  }

  private showTheme(): void {
    const id = currentTheme();
    const t = THEMES.find((x) => x.id === id)!;
    this.themeBtn.querySelector<HTMLElement>('.theme-swatch')!.dataset.swatch = id;
    this.themeBtn.querySelector('.theme-name')!.textContent = t.name;
    this.themeBtn.style.setProperty('--opt-font', OPT_FONT[id]);
    this.themeBtn.setAttribute('aria-label', `Theme: ${t.name}`);
    for (const b of this.themeMenu.querySelectorAll<HTMLButtonElement>('.theme-opt')) {
      const on = b.dataset.pick === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  private selectTab(tab: HTMLButtonElement): void {
    for (const t of this.tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')!).hidden = !on;
    }
  }

  private changed(what: SettingChange): void {
    this.show();
    saveSettings(this.settings);
    this.apply(this.settings, what);
  }

  private show(): void {
    this.sensitivityOut.textContent = `${this.settings.sensitivity.toFixed(2)}×`;
    this.volumeOut.textContent = this.settings.muted
      ? 'muted'
      : `${Math.round(this.settings.volume * 100)}%`;
    this.voiceOut.textContent = `${Math.round(this.settings.voiceVolume * 100)}%`;
    const g = this.settings.graphics;
    this.style.value = g.style;
    this.preset.value = g.preset;
    this.scale.value = String(g.scale);
    this.shadows.value = g.shadows;
    this.ao.checked = g.ao;
    this.micNote.textContent = this.micProblem;
    this.micNote.classList.toggle('hidden', !this.micProblem);
  }

  /** Shows (or clears) a problem with the microphone under the voice settings. */
  setMicProblem(problem: string): void {
    if (problem === this.micProblem) return;
    this.micProblem = problem;
    this.show();
  }
}
