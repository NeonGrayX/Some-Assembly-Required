import type { BrickTypeId, ColourId, Facing, Rotation } from '../bricks.ts';

/**
 * One brick of a target build, in baseplate grid coordinates (the baseplate top is y = 1). A
 * `face` means it is clipped sideways onto side studs (see parts.ts).
 */
export interface TargetBrick {
  type: BrickTypeId;
  colour: ColourId;
  x: number;
  y: number;
  z: number;
  rot: Rotation;
  face?: Facing;
}

/** One instruction page: the bricks added in this step. */
export interface BuildStep {
  bricks: TargetBrick[];
}

/** How a manual's picture is shot: quarter turns of the model, and how close the camera is. */
export interface PageView {
  /** 0 to 3, default 0. */
  turn?: number;
  /** 0.5 to 2, default 1. */
  zoom?: number;
}

/** Extras an instruction page can carry besides its bricks (see docs/07-build-file-format.md). */
export interface PageLayout {
  view?: PageView;
  /** One line printed under the picture. */
  note?: string;
}

export interface TargetBuild {
  id: string;
  name: string;
  steps: BuildStep[];
  author?: string;
  description?: string;
  /** How the box art is shot. */
  cover?: PageView;
  /** Per step, in step order; missing entries print the plain page. */
  pages?: PageLayout[];
}

/** Every brick of a build, tagged with the (0-based) step it belongs to. */
export function allBricks(build: TargetBuild): (TargetBrick & { step: number })[] {
  return build.steps.flatMap((s, step) => s.bricks.map((b) => ({ ...b, step })));
}
