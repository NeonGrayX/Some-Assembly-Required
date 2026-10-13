import type * as THREE from 'three';

/**
 * What lights and shadows see but the camera does not: your own builder while the camera is in
 * close (first person, or pulled in against a wall). Hidden this way rather than made invisible,
 * it still casts its shadow, and the headlamp on its brow still shines.
 */
export const UNSEEN = 1;

/**
 * Moves an object and everything drawn on it out of the camera's sight, or back into it. Lights
 * on it stay where they are: the camera only counts the lights in its own layers.
 */
export function setUnseen(root: THREE.Object3D, unseen: boolean): void {
  root.traverse((o) => {
    if (!(o as THREE.Light).isLight) o.layers.set(unseen ? UNSEEN : 0);
  });
}

/**
 * How far above the floor under it (the ground, or a room's floor) each flat thing laid on a
 * floor is drawn. Two flat things in one plane flicker through each other as the camera moves
 * ("z-fighting"), so each gets a height of its own, in the order they cover each other.
 *
 * The see-through layers (a lamp's baked shadows and its warm pool) write no depth, so between
 * themselves their heights do not decide which shows: their `renderOrder` does (see
 * `bakeLampShadows`). Their heights only keep them over the solid floors.
 */
export const FLOOR_LAYERS = {
  /** The faint grid over the ground. */
  grid: 0.001,
  /** A room's floor, over the ground (or the slab) it is laid on. */
  roomFloor: 0.004,
  /** A ceiling lamp's baked shadows, over its room's floor. */
  lampShadows: 0.006,
  /** A ceiling lamp's warm pool of light, over its room's floor. */
  lampPool: 0.008,
  /** A garden lamp's warm pool of light, on the ground or decking under it. */
  gardenPool: 0.012,
  /**
   * The undersides of the painted lines round a job site and an inspector's pad: a hair off
   * the floor, out of the plane of the pad's underside.
   */
  marking: 0.0015,
  /**
   * How thick the inspector's pad and the painted lines are: their tops stand over every layer
   * above, so they never lie in one of those planes.
   */
  padThickness: 0.012,
} as const;
