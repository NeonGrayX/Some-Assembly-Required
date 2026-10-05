import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SENSITIVITY_MAX, SENSITIVITY_MIN, parseSettings } from './settings.ts';

describe('parseSettings', () => {
  it('falls back to defaults when nothing is stored or the JSON is broken', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    expect(parseSettings('{"sensitivity":1.5,"volume":0.3,"muted":true}')).toEqual({
      sensitivity: 1.5,
      volume: 0.3,
      muted: true,
    });
  });

  it('clamps out-of-range values and replaces wrong types', () => {
    expect(parseSettings('{"sensitivity":99,"volume":-1,"muted":"yes"}')).toEqual({
      sensitivity: SENSITIVITY_MAX,
      volume: 0,
      muted: false,
    });
    expect(parseSettings('{"sensitivity":0,"volume":"loud"}')).toEqual({
      ...DEFAULT_SETTINGS,
      sensitivity: SENSITIVITY_MIN,
    });
  });
});
