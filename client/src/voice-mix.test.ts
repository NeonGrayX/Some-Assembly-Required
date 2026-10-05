import { describe, expect, it } from 'vitest';
import { SCREAM_GAIN, VOICE_RANGE, voiceMix } from './voice-mix.ts';
import type { Hearing } from './voice-mix.ts';

const near: Hearing = {
  together: false,
  distance: 3,
  walls: 0,
  speakerHome: false,
  listenerHome: false,
  screaming: false,
};

describe('voice mix', () => {
  it('is clear and placed in the world up close', () => {
    expect(voiceMix(near)).toEqual({ gain: 1, cutoff: 20_000, spatial: true });
  });

  it('fades out with distance and is silent out of range', () => {
    const at = (distance: number) => voiceMix({ ...near, distance }).gain;
    expect(at(VOICE_RANGE - 3)).toBeGreaterThan(0);
    expect(at(VOICE_RANGE - 3)).toBeLessThan(1);
    expect(at(VOICE_RANGE + 1)).toBe(0);
  });

  it('muffles voices behind walls, more with every wall', () => {
    const one = voiceMix({ ...near, walls: 1 });
    const two = voiceMix({ ...near, walls: 2 });
    expect(one.cutoff).toBeLessThan(2000);
    expect(two.cutoff).toBeLessThan(one.cutoff);
    expect(two.gain).toBeLessThan(one.gain);
    expect(one.gain).toBeLessThan(1);
  });

  it('lets a scream through louder and further', () => {
    const scream = voiceMix({ ...near, screaming: true });
    expect(scream.gain).toBe(SCREAM_GAIN);
    expect(voiceMix({ ...near, distance: VOICE_RANGE + 5, screaming: true }).gain).toBeGreaterThan(
      0,
    );
    expect(voiceMix({ ...near, walls: 1, screaming: true }).cutoff).toBeGreaterThan(
      voiceMix({ ...near, walls: 1 }).cutoff,
    );
  });

  it('puts everyone in one room in meetings and the lobby, walls or not', () => {
    expect(voiceMix({ ...near, together: true, distance: 40, walls: 3 })).toEqual({
      gain: 1,
      cutoff: 20_000,
      spatial: false,
    });
  });

  it('keeps players sent home out of the job site, but lets them listen in', () => {
    expect(voiceMix({ ...near, speakerHome: true }).gain).toBe(0);
    expect(voiceMix({ ...near, speakerHome: true, together: true }).gain).toBe(0);
    expect(voiceMix({ ...near, listenerHome: true }).gain).toBe(1);
    expect(
      voiceMix({ ...near, speakerHome: true, listenerHome: true, distance: 50 }),
    ).toMatchObject({
      gain: 1,
      spatial: false,
    });
  });
});
