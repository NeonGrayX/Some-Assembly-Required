import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPHICS,
  PRESETS,
  fromPreset,
  parseGraphics,
  presetOf,
} from './graphics-settings.ts';

describe('graphics settings', () => {
  it('defaults to the medium preset', () => {
    expect(DEFAULT_GRAPHICS).toEqual(fromPreset('medium'));
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
    expect(parseGraphics({ scale: 0.5, shadows: 'traced', ao: true, bloom: false })).toEqual({
      preset: 'custom',
      scale: 0.5,
      shadows: 'traced',
      ao: true,
      bloom: false,
    });
    expect(parseGraphics({ scale: 7, shadows: 'rtx', ao: 'yes' })).toEqual(DEFAULT_GRAPHICS);
  });

  it('drops the world style that settings used to store', () => {
    expect(parseGraphics({ ...PRESETS.low, style: 'storybook' })).toEqual(fromPreset('low'));
    expect(parseGraphics({ ...PRESETS.high, style: 'classic' })).toEqual(fromPreset('high'));
  });

  it('gives settings saved before bloom existed the bloom of the preset they match', () => {
    const { bloom: _low, ...low } = PRESETS.low;
    expect(parseGraphics(low)).toEqual(fromPreset('low'));
    const { bloom: _high, ...high } = PRESETS.high;
    expect(parseGraphics(high)).toEqual(fromPreset('high'));
  });

  it('leaves bloom off in settings saved by hand before it existed', () => {
    expect(parseGraphics({ scale: 0.5, shadows: 'off', ao: true }).bloom).toBe(false);
  });
});
