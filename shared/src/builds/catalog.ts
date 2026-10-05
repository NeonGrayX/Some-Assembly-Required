import { GIANT_DUCK } from './duck.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { ROCKET } from './rocket.ts';
import type { TargetBuild } from './types.ts';

/** Every model a round can be about. The level's bins hand out the bricks of all of them. */
export const BUILDS: readonly TargetBuild[] = [LIGHTHOUSE, ROCKET, GIANT_DUCK];

/** The build with this id, or undefined. */
export function buildById(id: string): TargetBuild | undefined {
  return BUILDS.find((b) => b.id === id);
}
