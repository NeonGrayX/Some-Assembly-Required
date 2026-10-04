import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';

/** One brick of a target build, in baseplate grid coordinates (the baseplate top is y = 1). */
export interface TargetBrick {
  type: BrickTypeId;
  colour: ColourId;
  x: number;
  y: number;
  z: number;
  rot: Rotation;
}

/** One instruction page: the bricks added in this step. */
export interface BuildStep {
  bricks: TargetBrick[];
}

export interface TargetBuild {
  id: string;
  name: string;
  steps: BuildStep[];
}

/** Every brick of a build, tagged with the (0-based) step it belongs to. */
export function allBricks(build: TargetBuild): (TargetBrick & { step: number })[] {
  return build.steps.flatMap((s, step) => s.bricks.map((b) => ({ ...b, step })));
}
