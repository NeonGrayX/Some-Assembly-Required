/**
 * The game's clock and its random numbers. Normally they are the page's own (performance.now()
 * and Math.random). A benchmark run takes them over: the clock steps a fixed 1/60 s a frame,
 * from 0, and every random number comes from a fixed seed, so every run plays and draws the same
 * frames on any machine, however fast it is.
 */

let steered: number | null = null;

/** The game's time (ms): what it runs, times and animates by. */
export function gameNow(): number {
  return steered ?? performance.now();
}

/** Sets the game's time from now on, or (null) hands it back to the page's clock. */
export function steerClock(ms: number | null): void {
  steered = ms;
}

/** A small seeded random number generator (mulberry32): the same numbers every time. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pageRandom = Math.random;
let drawn: (() => number) | null = null;

/**
 * A random number for what is drawn (sparks, smoke, dust). Kept apart from Math.random, which
 * the sounds use too: whether the browser lets a page play sound must not change the picture.
 */
export function random(): number {
  return drawn ? drawn() : pageRandom();
}

/** Seeds everything random on the page, Math.random included; null puts the page's back. */
export function seedRandom(seed: number | null): void {
  if (seed === null) {
    drawn = null;
    Math.random = pageRandom;
    return;
  }
  drawn = seededRandom(seed);
  Math.random = seededRandom(seed ^ 0x9e3779b9);
}
