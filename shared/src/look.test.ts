import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, FACES, HATS, SHIRTS, hatName, hatOr, isHatId, lookOr } from './look.ts';

describe('looks', () => {
  it('have unique ids and names, and the defaults are among them', () => {
    for (const list of [HATS, FACES, SHIRTS]) {
      expect(new Set(list.map((h) => h.id)).size).toBe(list.length);
      expect(new Set(list.map((h) => h.name)).size).toBe(list.length);
    }
    expect(isHatId(DEFAULT_LOOK.hat)).toBe(true);
    expect(lookOr(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
  });

  it('fall back to the defaults for anything that is not a choice', () => {
    expect(hatOr('tophat')).toBe('tophat');
    expect(hatOr('fez')).toBe(DEFAULT_LOOK.hat);
    expect(hatOr(undefined)).toBe(DEFAULT_LOOK.hat);
    expect(hatOr(3)).toBe(DEFAULT_LOOK.hat);
    expect(hatName('cone')).toBe('Traffic cone');
    expect(lookOr({ hat: 'crown', face: 'grin', shirt: 'nope' })).toEqual({
      hat: 'crown',
      face: 'grin',
      shirt: 'plain',
    });
    expect(lookOr(null)).toEqual(DEFAULT_LOOK);
    expect(lookOr('hat')).toEqual(DEFAULT_LOOK);
  });
});
