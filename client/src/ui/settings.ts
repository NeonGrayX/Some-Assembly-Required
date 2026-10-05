import { SENSITIVITY_MAX, SENSITIVITY_MIN, saveSettings } from '../settings.ts';
import type { MicMode, Settings } from '../settings.ts';

export type SettingChange = 'sensitivity' | 'volume' | 'mic' | 'voice';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * The settings dialog: mouse sensitivity, master volume and mute, and voice chat. Changes apply
 * and save at once.
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
    this.voice.addEventListener('input', () => {
      settings.voiceVolume = Number(this.voice.value) / 100;
      this.changed('voice');
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
