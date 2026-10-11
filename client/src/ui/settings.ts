import { SENSITIVITY_MAX, SENSITIVITY_MIN, saveSettings } from '../settings.ts';
import type { MicMode, Settings } from '../settings.ts';
import { fromPreset, presetOf } from '../graphics-settings.ts';
import { freeMouse } from '../input.ts';
import type { Preset, ShadowQuality, VisualStyle } from '../graphics-settings.ts';
import { THEMES, applyTheme, currentTheme, followSystemTheme, pickTheme } from '../themes.ts';
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
  private readonly themeList = $('set-theme');
  private readonly tabs = [...this.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  /** Why the microphone cannot be used, if it cannot. */
  micProblem = '';

  constructor(
    private readonly settings: Settings,
    private readonly apply: (s: Settings, changed: SettingChange) => void,
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
    followSystemTheme(() => this.showTheme());
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
    freeMouse();
    this.el.classList.remove('hidden');
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  /** One row per theme, each with a sample of it drawn in its own colours and type. */
  private buildThemeList(): void {
    for (const t of THEMES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-opt';
      b.setAttribute('role', 'radio');
      b.dataset.pick = t.id;
      b.style.setProperty('--opt-font', OPT_FONT[t.id]);
      b.innerHTML = `<span class="theme-swatch" data-swatch="${t.id}" aria-hidden="true"><b>Aa</b><i></i></span><span><strong></strong><small></small></span><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
      b.querySelector('strong')!.textContent = t.name;
      b.querySelector('small')!.textContent = t.note;
      b.addEventListener('click', () => {
        pickTheme(t.id);
        this.showTheme();
      });
      this.themeList.append(b);
    }
    this.themeList.addEventListener('keydown', (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const opts = [...this.themeList.children] as HTMLButtonElement[];
      const at = opts.indexOf(document.activeElement as HTMLButtonElement);
      const next = opts[(Math.max(0, at) + step + opts.length) % opts.length]!;
      next.click();
      next.focus();
    });
    this.showTheme();
  }

  private showTheme(): void {
    const id = currentTheme();
    for (const b of this.themeList.querySelectorAll<HTMLButtonElement>('.theme-opt')) {
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
