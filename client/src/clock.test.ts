import { afterEach, describe, expect, it } from 'vitest';
import { gameNow, random, seedRandom, seededRandom, steerClock } from './clock.ts';

describe('the game clock and its random numbers', () => {
  afterEach(() => {
    steerClock(null);
    seedRandom(null);
  });

  it('runs on the page clock until steered, and back after', () => {
    expect(Math.abs(gameNow() - performance.now())).toBeLessThan(50);
    steerClock(1000 / 60);
    expect(gameNow()).toBe(1000 / 60);
    steerClock(null);
    expect(Math.abs(gameNow() - performance.now())).toBeLessThan(50);
  });

  it('gives the same numbers from the same seed', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const xs = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(seededRandom(8)()).not.toBe(xs[0]);
  });

  it('seeds what is drawn and Math.random apart, and puts Math.random back', () => {
    const page = Math.random;
    seedRandom(1);
    const drawn = [random(), random()];
    const other = [Math.random(), Math.random()];
    seedRandom(1);
    // Sounds taking numbers in between do not change what is drawn.
    Math.random();
    expect([random(), random()]).toEqual(drawn);
    expect(other).not.toEqual(drawn);
    seedRandom(null);
    expect(Math.random).toBe(page);
  });
});
