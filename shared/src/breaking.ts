import type { BrickGrid, Connection } from './grid.ts';

/** Impacts gentler than this (velocity change in m/s) never break anything. */
export const BREAK_MIN_SEVERITY = 2.2;
/** Strength of a connection is BASE + PER_STUD * shared studs, in m/s of velocity change. */
export const BREAK_BASE = 1.8;
export const BREAK_PER_STUD = 0.45;

export function connectionStrength(c: Connection): number {
  return BREAK_BASE + BREAK_PER_STUD * c.studs;
}

/**
 * Decides which connections snap during an impact of the given severity (velocity change,
 * m/s). Weak joints (few shared studs) go first. `rng` adds some luck so the same knock
 * does not always break the same joint.
 */
export function planBreaks(grid: BrickGrid, severity: number, rng: () => number): Connection[] {
  if (severity < BREAK_MIN_SEVERITY || grid.size < 2) return [];
  return grid.connections().filter((c) => connectionStrength(c) < severity * (0.8 + 0.4 * rng()));
}
