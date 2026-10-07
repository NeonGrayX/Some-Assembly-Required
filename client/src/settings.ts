import { DEFAULT_GRAPHICS, parseGraphics } from './graphics-settings.ts';
import type { GraphicsSettings } from './graphics-settings.ts';

/** Player preferences that stay on this device. */
export interface Settings {
  /** Multiplier on the base mouse speed. */
  sensitivity: number;
  /** Master volume, 0..1. */
  volume: number;
  muted: boolean;
  /** How voice chat uses your microphone. */
  mic: MicMode;
  /** Volume of other players' voices, 0..1 (on top of the master volume). */
  voiceVolume: number;
  graphics: GraphicsSettings;
}

/** How voice chat uses your microphone: never, always, or while the talk key is held. */
export type MicMode = 'off' | 'open' | 'push';
const MIC_MODES: readonly MicMode[] = ['off', 'open', 'push'];

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  volume: 1,
  muted: false,
  mic: 'push',
  voiceVolume: 1,
  graphics: DEFAULT_GRAPHICS,
};

const KEY = 'sar.settings';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Reads settings from stored JSON, falling back to defaults for anything missing or broken. */
export function parseSettings(json: string | null): Settings {
  let raw: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const parsed: unknown = json ? JSON.parse(json) : null;
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch {
    // Corrupt storage: start over from the defaults.
  }
  return {
    sensitivity: clamp(
      num(raw.sensitivity, DEFAULT_SETTINGS.sensitivity),
      SENSITIVITY_MIN,
      SENSITIVITY_MAX,
    ),
    volume: clamp(num(raw.volume, DEFAULT_SETTINGS.volume), 0, 1),
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_SETTINGS.muted,
    mic: MIC_MODES.includes(raw.mic as MicMode) ? (raw.mic as MicMode) : DEFAULT_SETTINGS.mic,
    voiceVolume: clamp(num(raw.voiceVolume, DEFAULT_SETTINGS.voiceVolume), 0, 1),
    graphics: parseGraphics(raw.graphics),
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    // Storage can be blocked; settings then last until the tab closes.
    return { ...DEFAULT_SETTINGS, graphics: { ...DEFAULT_GRAPHICS } };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // See above.
  }
}
