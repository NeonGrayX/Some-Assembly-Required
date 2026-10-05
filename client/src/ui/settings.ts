import { SENSITIVITY_MAX, SENSITIVITY_MIN, saveSettings } from '../settings.ts';
import type { Settings } from '../settings.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** The settings dialog: mouse sensitivity, master volume and mute. Changes apply and save at once. */
export class SettingsPanel {
  private readonly el = $('settings');
  private readonly sensitivity = $<HTMLInputElement>('set-sensitivity');
  private readonly volume = $<HTMLInputElement>('set-volume');
  private readonly muted = $<HTMLInputElement>('set-muted');
  private readonly sensitivityOut = $('set-sensitivity-value');
  private readonly volumeOut = $('set-volume-value');

  constructor(
    private readonly settings: Settings,
    private readonly apply: (s: Settings, changed: 'sensitivity' | 'volume') => void,
  ) {
    this.sensitivity.min = String(SENSITIVITY_MIN);
    this.sensitivity.max = String(SENSITIVITY_MAX);
    this.sensitivity.step = '0.05';
    this.sensitivity.value = String(settings.sensitivity);
    this.volume.value = String(Math.round(settings.volume * 100));
    this.muted.checked = settings.muted;
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
    document.exitPointerLock();
    this.el.classList.remove('hidden');
  }

  close(): void {
    this.el.classList.add('hidden');
  }

  private changed(what: 'sensitivity' | 'volume'): void {
    this.show();
    saveSettings(this.settings);
    this.apply(this.settings, what);
  }

  private show(): void {
    this.sensitivityOut.textContent = `${this.settings.sensitivity.toFixed(2)}×`;
    this.volumeOut.textContent = this.settings.muted
      ? 'muted'
      : `${Math.round(this.settings.volume * 100)}%`;
  }
}
