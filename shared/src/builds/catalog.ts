import { CASTLE } from './castle.ts';
import { COTTAGE } from './cottage.ts';
import { GIANT_DUCK } from './duck.ts';
import { LIGHTHOUSE } from './lighthouse.ts';
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
];

/** The build with this id, or undefined. */
export function buildById(id: string): TargetBuild | undefined {
  return BUILDS.find((b) => b.id === id);
}
