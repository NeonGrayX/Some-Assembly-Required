import { CASTLE } from './castle.ts';
import { COTTAGE } from './cottage.ts';
import { GIANT_DUCK } from './duck.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
import { MANGA_SHOP } from './mangashop.ts';
import { PYRAMID } from './pyramid.ts';
import { RACE_CAR } from './racecar.ts';
import { ROBOT } from './robot.ts';
import { ROCKET } from './rocket.ts';
import { SNOWMAN } from './snowman.ts';
import { CHRISTMAS_TREE } from './tree.ts';
import type { TargetBuild } from './types.ts';

/** Every model a round can be about. The level's bins hand out the bricks of all of them. */
export const BUILDS: readonly TargetBuild[] = [
  LIGHTHOUSE,
  ROCKET,
  GIANT_DUCK,
  SNOWMAN,
  ROBOT,
  RACE_CAR,
  COTTAGE,
  CHRISTMAS_TREE,
  PYRAMID,
  CASTLE,
  MANGA_SHOP,
];

/**
 * Builds imported from build files in this tab. Only demo mode adds them, so only the in-tab solo
 * room ever plays them; a server never has any.
 */
const imported = new Map<string, TargetBuild>();

/** Adds an imported build, replacing one imported earlier with the same id. */
export function addImportedBuild(build: TargetBuild): void {
  if (BUILDS.some((b) => b.id === build.id)) throw new Error(`"${build.id}" is a built-in build`);
  imported.set(build.id, build);
}

export function importedBuilds(): TargetBuild[] {
  return [...imported.values()];
}

/** The build with this id, built in or imported, or undefined. */
export function buildById(id: string): TargetBuild | undefined {
  return BUILDS.find((b) => b.id === id) ?? imported.get(id);
}
