import type { TargetBrick } from '../builds/types.ts';

/** How far up or down a bot looks at most (radians). */
export const MAX_PITCH = 1.45;
/** How far from the eye things can be clicked (the sim's reach, less a little). */
export const REACH = 2.5;
/** How far a jump lifts the eye that a bot counts on to click on something (the top is ~0.8). */
export const JUMP_LIFT = 0.6;

/** A brick of a build told apart by its part and where and how it sits, whatever its colour. */
export const brickKey = (b: TargetBrick) =>
  `${b.type}|${b.x}|${b.y}|${b.z}|${b.rot}|${b.face ?? ''}|${b.orient ?? ''}`;
