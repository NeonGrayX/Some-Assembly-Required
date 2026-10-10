import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPHICS,
  PRESETS,
  fromPreset,
  parseGraphics,
  presetOf,
} from './graphics-settings.ts';

describe('graphics settings', () => {
  it('defaults to the medium preset in the realistic style', () => {
    expect(DEFAULT_GRAPHICS).toEqual(fromPreset('medium'));
    expect(DEFAULT_GRAPHICS.style).toBe('realistic');
    expect(parseGraphics(undefined)).toEqual(DEFAULT_GRAPHICS);
    expect(parseGraphics('nonsense')).toEqual(DEFAULT_GRAPHICS);
  });

  it('recognises a preset, and calls anything else custom', () => {
    for (const p of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      expect(presetOf(PRESETS[p])).toBe(p);
    }
    expect(presetOf({ ...PRESETS.ultra, scale: 0.5 })).toBe('custom');
  });

  it('keeps valid values and replaces broken ones', () => {
    expect(parseGraphics({ scale: 0.5, shadows: 'traced', ao: true })).toEqual({
      preset: 'custom',
      scale: 0.5,
      shadows: 'traced',
      ao: true,
      style: 'realistic',
    });
    expect(parseGraphics({ ...PRESETS.low, style: 'retro' })).toEqual(fromPreset('low', 'retro'));
    expect(parseGraphics({ style: 'oil painting' }).style).toBe('realistic');
    expect(parseGraphics({ scale: 7, shadows: 'rtx', ao: 'yes' })).toEqual(DEFAULT_GRAPHICS);
  });
});
