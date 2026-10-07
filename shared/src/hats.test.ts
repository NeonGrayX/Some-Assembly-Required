import { describe, expect, it } from 'vitest';
import { DEFAULT_HAT, HATS, hatName, hatOr, isHatId } from './hats.ts';

describe('hats', () => {
  it('have unique ids and names, and the default is one of them', () => {
    expect(new Set(HATS.map((h) => h.id)).size).toBe(HATS.length);
    expect(new Set(HATS.map((h) => h.name)).size).toBe(HATS.length);
    expect(isHatId(DEFAULT_HAT)).toBe(true);
  });

  it('fall back to the default for anything that is not a hat', () => {
    expect(hatOr('tophat')).toBe('tophat');
    expect(hatOr('fez')).toBe(DEFAULT_HAT);
    expect(hatOr(undefined)).toBe(DEFAULT_HAT);
    expect(hatOr(3)).toBe(DEFAULT_HAT);
    expect(hatName('cone')).toBe('Traffic cone');
  });
});
