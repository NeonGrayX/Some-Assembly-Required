/** Player preferences that stay on this device. */
export interface Settings {
  /** Multiplier on the base mouse speed. */
  sensitivity: number;
  /** Master volume, 0..1. */
  volume: number;
  muted: boolean;
}

export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;

export const DEFAULT_SETTINGS: Settings = { sensitivity: 1, volume: 1, muted: false };

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
  };
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    // Storage can be blocked; settings then last until the tab closes.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // See above.
  }
}
