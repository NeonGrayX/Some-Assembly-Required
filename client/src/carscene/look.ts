import * as THREE from 'three';
import type { Grade } from '../render/finish.ts';
import { FLOOR, GROUND_LIGHT } from './ground.ts';
import { BACKDROP } from './studio.ts';

/**
 * How the car scene is lit and graded, as car-test.html draws it after the reference picture:
 * a key light high on one side with soft shadows, the studio's light all round (and its
 * reflections in the paint and glass), a softbox on the camera's side, a pale warm floor greying
 * off into the studio's backdrop, and a soft grade. The game lights every level just so, and
 * draws a level built of the car scene's models in the studio too (see `View`); `NIGHT` is the
 * same studio with its lights down. The key
 * shines from `CAR_LIGHT`, the ground's baked shadows fall from `KEY_LIGHT` (see `scene.ts`).
 */
export interface CarLook {
  /** The colour behind everything, and the backdrop's sweep, floor to top, and its pool. */
  background: number;
  sweep: { low: number; top: number; pool: [number, number, number] };
  /** The floor's own colour round the middle. */
  floor: number;
  /** The studio's light all round, and its reflections. */
  environment: number;
  hemi: { sky: number; ground: number; intensity: number };
  /** The key: its colour and strength. */
  key: { colour: number; intensity: number };
  /** The softbox on the camera's side: no shadow. */
  fill: { colour: number; intensity: number };
  /** The light the ground's own shader lays on it (see `GROUND_LIGHT`). */
  ground: { key: [number, number, number]; ambient: [number, number, number] };
  grade: Grade;
}

export const DAY: CarLook = {
  background: 0x828589,
  sweep: { low: 0xa4a3a2, top: 0x363e48, pool: [0.08, 0.085, 0.09] },
  floor: 0xe8e3dc,
  environment: 1.4,
  hemi: { sky: 0xe6ecf2, ground: 0x6a6058, intensity: 0.6 },
  key: { colour: 0xfff6ea, intensity: 2.8 },
  fill: { colour: 0xf2f4f6, intensity: 0.35 },
  ground: { key: [1.08, 1.06, 1.02], ambient: [0.38, 0.38, 0.39] },
  // The picture's grade: rich colour, little contrast, the lamps blooming, deep corner shading,
  // and its corners darkened well.
  grade: {
    saturation: 1.0,
    contrast: 0.05,
    lift: 0,
    bloom: 0.16,
    threshold: 1.2,
    vignette: 0.2,
    ao: 1.6,
  },
};

/** The studio after dark: a cold dim moon for its key, the backdrop deep blue, the lamps bright. */
export const NIGHT: CarLook = {
  background: 0x0c1428,
  sweep: { low: 0x1c2638, top: 0x070b16, pool: [0.01, 0.012, 0.02] },
  floor: 0x8a8e96,
  environment: 0.08,
  hemi: { sky: 0x3a4c78, ground: 0x141820, intensity: 0.35 },
  key: { colour: 0xaabbe0, intensity: 0.35 },
  fill: { colour: 0x8090b0, intensity: 0.05 },
  ground: { key: [0.12, 0.14, 0.2], ambient: [0.07, 0.08, 0.12] },
  grade: { ...DAY.grade, bloom: 0.3, threshold: 0.9 },
};

/** How soft the key's shadows' edges are, whatever the graphics settings: it is a big light. */
export const SOFT_SHADOWS = 4;

/** Where the softbox is, from what it lights: on the camera's side, low. */
export const FILL_FROM = new THREE.Vector3(1.5, 2, -6);

/**
 * Pales the floor all over `area` (a map's, `size` a side round `x`, `z`), the key's light
 * across it, and fades it into the backdrop past it: soon past it, or with a town round it
 * (`town`), half faded `past` metres beyond the map's edge and more sharply.
 */
export function floorOver(
  area: { x: number; z: number; size: number },
  town?: { past: number; sharpness: number },
): void {
  const { x, z, size } = area;
  FLOOR.centre.value.set(x, z);
  if (town) FLOOR.range.value.set(size / 2 + town.past, town.sharpness);
  else FLOOR.range.value.set(size * 0.6, 1.6);
  FLOOR.pool.value.set(0.78, 0.62, -size, -size * 0.25);
  FLOOR.poolDark.value = 0.48;
}

/** Sets the studio's backdrop, the floor's colour and the ground's light to `look`. */
export function setStudio(look: CarLook): void {
  BACKDROP.low.value.set(look.sweep.low);
  BACKDROP.top.value.set(look.sweep.top);
  BACKDROP.pool.value.setRGB(...look.sweep.pool);
  FLOOR.near.value.set(look.floor);
  GROUND_LIGHT.keyColour.value.setRGB(...look.ground.key);
  GROUND_LIGHT.ambient.value.setRGB(...look.ground.ambient);
  GROUND_LIGHT.keyDark.value = 0.95;
  GROUND_LIGHT.skyDark.value = 0.9;
}

/** Lights the key, the softbox and the light all round as `look` has them. */
export function setLights(
  look: CarLook,
  lights: {
    scene: THREE.Scene;
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
  },
): void {
  const { scene, hemi, key, fill } = lights;
  (scene.background as THREE.Color).set(look.background);
  scene.environmentIntensity = look.environment;
  hemi.color.set(look.hemi.sky);
  hemi.groundColor.set(look.hemi.ground);
  hemi.intensity = look.hemi.intensity;
  key.color.set(look.key.colour);
  key.intensity = look.key.intensity;
  fill.color.set(look.fill.colour);
  fill.intensity = look.fill.intensity;
}
