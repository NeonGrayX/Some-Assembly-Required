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
