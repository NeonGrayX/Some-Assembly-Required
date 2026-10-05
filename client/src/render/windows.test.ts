import { describe, expect, it } from 'vitest';
import { WINDOWS } from '@sar/shared';
import { HOUSE_WINDOWS } from './details.ts';

describe('windows', () => {
  it('are where the furniture layouts keep tall furniture away from', () => {
    expect(HOUSE_WINDOWS).toEqual(WINDOWS);
  });
});
