import * as THREE from 'three';
import { buildCar } from './car.ts';
import type { Car } from './car.ts';
import { buildCone, fallenCone } from './cone.ts';
import { buildGround } from './ground.ts';
import { buildSportsCar } from './sportscar.ts';
import type { Ground, GroundLayout } from './ground.ts';

/**
 * The car scene, laid out as the reference picture shows it: the car on a patch of mossy cobbles
 * in a pale studio, warning cones round it (one knocked over), and the camera where the picture
 * was taken from. The car faces +x; the picture looks at its nose and its left side (-z).
 */

/** The camera of the reference picture. */
export const REFERENCE_VIEW = {
  position: new THREE.Vector3(7.24, 3.95, -7.76),
  target: new THREE.Vector3(0.167, 0.959, -0.071),
  fov: 29,
};

/**
 * Where the red sports car is parked: beside the off-roader, on the picture's camera side and a
 * little behind it, parallel to it, so from the picture's camera the two stand side by side.
 */
export const SPORTS_PLACE = { x: -2.9, z: -3.9, heading: 0 };

/** A view that takes in both cars, the free view's starting point. */
export const PAIR_VIEW = {
  position: new THREE.Vector3(9.6, 5.6, -12.2),
  target: new THREE.Vector3(-1.2, 0.7, -2.0),
  fov: 29,
};

/**
 * Where the studio's key light comes from: high behind the car and on the picture's right, so the
 * bonnet and the side facing the camera are lit, the nose is not, and the car's shadow falls out
 * ahead of its nose, to the picture's left.
 */
export const KEY_LIGHT = new THREE.Vector3(-0.72, 0.62, -0.3).normalize();

/**
 * The key as it falls on the car itself: further round toward the camera than its shadow on the
 * floor says, so the flank facing the camera is lit as strongly as the bonnet and the nose falls
 * into shade, as the picture paints it.
 */
export const CAR_LIGHT = new THREE.Vector3(-0.35, 0.55, -0.76).normalize();

/**
 * The ground, measured off the picture: the patch's outline round its edge, the single stones in
 * their holes, the grass, and the cones.
 */
export const LAYOUT: GroundLayout = {
  patch: [
    [2.16, 1.7],
    [2.81, 0.74],
    [3.11, -0.21],
    [3.0, -0.92],
    [2.78, -1.52],
    [2.48, -1.78],
    [2.3, -2.1],
    [1.79, -2.17],
    [1.35, -2.24],
    [-0.01, -2.03],
    [-2.49, -1.41],
    [-3.11, -0.98],
    [-2.94, -0.04],
    [-0.78, 0.6],
    [0.21, 0.92],
    [1.4, 1.22],
  ],
  holes: [
    [2.55, 2.48, 0.2],
    [3.69, 0.77, 0.12],
    [3.92, -0.47, 0.18],
    [3.56, -1.14, 0.16],
    [1.76, -2.53, 0.17],
    [2.47, -2.54, 0.12],
    [2.33, -3.0, 0.22],
    [-1.12, -2.38, 0.18],
    [-0.73, -2.97, 0.12],
  ].map(([x, z, r]) => ({ x: x!, z: z!, r: r! })),
  tufts: [
    [2.2, 0.55, 0.26],
    [1.94, -1.2, 0.24],
    [1.28, -1.33, 0.28],
    [-0.45, -1.12, 0.24],
    [-1.74, -0.99, 0.26],
    [0.6, -1.5, 0.2],
  ].map(([x, z, size]) => ({ x: x!, z: z!, size: size! })),
};

/** Where the cones stand: two upright, one knocked over, its tip pointing away from the car. */
export const CONES = {
  upright: [
    { x: 2.92, z: -2.1 },
    { x: -2.79, z: -1.95 },
  ],
  fallen: { x: 2.86, z: 1.3, heading: -0.53 },
};

export interface CarScene {
  root: THREE.Group;
  car: Car;
  sports: Car;
  ground: Ground;
  cones: THREE.Group[];
}

export function buildCarScene(): CarScene {
  const root = new THREE.Group();
  const ground = buildGround(LAYOUT);
  root.add(ground.root);
  const car = buildCar();
  root.add(car.root);
  const sports = buildSportsCar();
  sports.root.position.set(SPORTS_PLACE.x, 0, SPORTS_PLACE.z);
  sports.root.rotation.y = SPORTS_PLACE.heading;
  root.add(sports.root);
  const cones: THREE.Group[] = [];
  for (const p of CONES.upright) {
    const c = buildCone();
    c.position.set(p.x, 0, p.z);
    // One of its floating signs turned to the picture's camera, as there.
    c.rotation.y = Math.atan2(REFERENCE_VIEW.position.x - p.x, REFERENCE_VIEW.position.z - p.z);
    root.add(c);
    cones.push(c);
  }
  const f = fallenCone(CONES.fallen.heading);
  f.position.set(CONES.fallen.x, 0, CONES.fallen.z);
  root.add(f);
  cones.push(f);
  return { root, car, sports, ground, cones };
}
