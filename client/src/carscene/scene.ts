import * as THREE from 'three';
import { buildBus } from './bus.ts';
import { HOVER, buildCar } from './car.ts';
import type { Car } from './car.ts';
import { buildCone, fallenCone } from './cone.ts';
import { buildGround, cobblePatch } from './ground.ts';
import { buildHouse } from './house.ts';
import { buildBrickWorks } from './machines.ts';
import { buildRoad } from './road.ts';
import type { RoadLayout } from './road.ts';
import { buildSportsCar } from './sportscar.ts';
import { STREET, buildStreet } from './street.ts';
import { BIG_HOUSE_BODY, buildBigHouse } from './bighouse.ts';
import { buildInspector } from './inspector.ts';
import { buildLadder } from './ladder.ts';
import { closedSign, hedge, hoarding, roadBarrier } from './edges.ts';
import { powerCabinet } from './utility.ts';
import { SITE_PAD, buildJobSite } from './jobsite.ts';
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

/**
 * The stretch of road under the sports car: running along x with it, the car astride its dashed
 * middle, its near edge running in under the cobble patch's rim, a kerb along its far side.
 */
export const ROAD: RoadLayout = {
  outline: [
    [-6.9, -2.55],
    [-5.0, -2.48],
    [-3.0, -2.52],
    [-1.2, -2.5],
    [0.3, -2.58],
    [0.85, -2.9],
    [1.05, -3.6],
    [0.8, -4.3],
    [0.95, -5.0],
    [0.6, -5.72],
    [-1.5, -5.78],
    [-4.0, -5.74],
    [-6.5, -5.8],
    [-7.15, -5.2],
    [-7.0, -4.1],
    [-7.3, -3.3],
  ],
  middle: SPORTS_PLACE.z,
  edges: [-2.8, -5.45],
  kerb: { x0: -6.3, x1: 0.4, z: -5.84 },
};

/**
 * Where the school bus is parked: out beyond the sports car's kerb, on a stretch of road of its
 * own, parallel to the cars, level with the picture's camera, so it stays out of the picture.
 */
export const BUS_PLACE = { x: -2.6, z: -8.3, heading: 0 };

/** The bus's road: no middle line, its near edge running up to the sports car's kerb. */
export const BUS_ROAD: RoadLayout = {
  outline: [
    [-8.6, -6.1],
    [-6.0, -6.04],
    [-3.5, -6.08],
    [-1.0, -6.05],
    [1.4, -6.1],
    [2.3, -6.4],
    [2.6, -7.3],
    [2.4, -8.3],
    [2.7, -9.3],
    [2.3, -10.35],
    [0.2, -10.5],
    [-2.5, -10.42],
    [-5.0, -10.5],
    [-7.6, -10.45],
    [-8.7, -9.8],
    [-8.5, -8.6],
    [-8.9, -7.4],
    [-8.7, -6.6],
  ],
  edges: [-6.4, -10.2],
};

/**
 * Where the small house stands: behind the cars' tails, its door's gable toward them and turned a
 * little to the free view's camera, its path running out toward the sports car's road. Out of
 * the picture, as the bus is.
 */
export const HOUSE_PLACE = { x: -12.8, z: -4.4, heading: 0.22 };

/**
 * The house's yard: a patch of mossy cobbles as the off-roader's, round the house and out before
 * its door, given round the house (x toward its door, z along its gable) and turned with it.
 */
export const HOUSE_YARD: [number, number][] = (
  [
    [-2.5, -2.3],
    [-1.2, -2.75],
    [0.6, -2.6],
    [2.0, -2.9],
    [2.9, -2.2],
    [3.5, -1.5],
    [3.6, -0.5],
    [3.0, 0.3],
    [2.6, 0.9],
    [2.5, 2.1],
    [1.4, 2.75],
    [-0.4, 2.6],
    [-2.0, 2.8],
    [-2.7, 1.6],
    [-2.45, 0.2],
    [-2.8, -1.0],
  ] as [number, number][]
).map(([x, z]) => {
  const [c, s] = [Math.cos(HOUSE_PLACE.heading), Math.sin(HOUSE_PLACE.heading)];
  return [HOUSE_PLACE.x + x * c + z * s, HOUSE_PLACE.z - x * s + z * c];
});

/** Where the big house stands: across the street from the cars, its front to the road. */
export const BIG_HOUSE_PLACE = { x: -5.0, z: -26.6 };

/**
 * The big house's yard: mossy cobbles round it, out to the street's pavement before it, given
 * round the house (x along its front, z out of it).
 */
export const BIG_HOUSE_YARD: [number, number][] = (
  [
    [-5.4, 4.68],
    [-3.0, 4.72],
    [-0.9, 4.7],
    [0.9, 4.72],
    [3.2, 4.68],
    [5.5, 4.7],
    [5.9, 3.0],
    [5.6, 1.0],
    [6.0, -1.0],
    [5.4, -3.2],
    [5.6, -4.1],
    [3.0, -4.25],
    [0.5, -4.0],
    [-2.0, -4.3],
    [-4.6, -4.0],
    [-5.7, -3.4],
    [-5.5, -1.2],
    [-6.0, 0.8],
    [-5.6, 2.8],
  ] as [number, number][]
).map(([x, z]) => [BIG_HOUSE_PLACE.x + x, BIG_HOUSE_PLACE.z + z]);

/**
 * A view that takes in the off-roader, the sports car, the bus, both houses and the street: the
 * free view's start.
 */
export const SHOWCASE_VIEW = {
  position: new THREE.Vector3(20.0, 15.0, 4.0),
  target: new THREE.Vector3(-5.0, 1.0, -13.0),
  fov: 46,
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

/**
 * The brick works, east of the cars: the silo, the brick press, the mould vendor and the UV
 * printer in a row along z on a concrete pad, their fronts turned west toward the cars (out of
 * the reference picture's view, which looks west from in front of them).
 */
export const BRICK_WORKS = { front: 10.4, z: 1.0, gap: 0.85 };

/**
 * The job site, between the cars and the brick works: the baseplate on its pad, the Done button
 * and the bell on its south side (toward the street), and a cone at each of the pad's corners.
 */
export const JOB_SITE = { x: 6.6, z: -3.4, heading: Math.PI / 2 };

/**
 * The quality inspector, out before the small house: a build is carried in to it from the east,
 * from the job site past the cars' tails, its screen and its short wall on the house's side.
 */
export const INSPECTOR = { x: -8.3, z: 0.9, heading: 0 };

/**
 * The power cabinet, the map's electrical panel: round the back of the small house, out of sight
 * of the job site, standing free at the yard's edge, its doors turned away from the house.
 */
export const POWER_CABINET = { x: -17.3, z: -2.6, heading: Math.PI };

/**
 * The ladder up the big house's back wall to its eaves, between the windows, held off the wall
 * past its gutter.
 */
const BIG_LADDER = {
  x: BIG_HOUSE_PLACE.x + 1.3,
  z: BIG_HOUSE_PLACE.z - BIG_HOUSE_BODY.half - 0.62,
  standoff: 0.53,
  height: BIG_HOUSE_BODY.eave + 0.05,
};

/**
 * What closes the map in: barriers and a road-closed sign across each end of the street, a
 * hoarding behind the brick works, and a hedge along the north past the inspector.
 */
const EDGES = {
  barriers: { inset: 0.45, length: 2.6, gap: 0.7 },
  hoarding: { x: 13.6, z0: 2.6, z1: -10.0 },
  hedge: { z: 4.4, x0: -14.2, x1: -4.0 },
};

export interface CarScene {
  root: THREE.Group;
  car: Car;
  sports: Car;
  bus: Car;
  house: THREE.Group;
  bigHouse: THREE.Group;
  street: THREE.Group;
  /** The brick works' machines, each named for its kind, on their pad. */
  machines: THREE.Group;
  /**
   * What the map adds for a round, each its own group: the job site and the inspector (a pad
   * named 'pad' and their fittings named 'prop'), the power cabinet, the ladder, and the barriers,
   * hoarding and hedge round the edges.
   */
  site: THREE.Group;
  ground: Ground;
  cones: THREE.Group[];
}

export function buildCarScene(): CarScene {
  const root = new THREE.Group();
  const ground = buildGround(LAYOUT);
  root.add(ground.root);
  root.add(buildRoad(ROAD));
  root.add(buildRoad(BUS_ROAD));
  root.add(cobblePatch(HOUSE_YARD, 41).root);
  root.add(cobblePatch(BIG_HOUSE_YARD, 53).root);
  // The vehicles hover a little, their wheels clear of the ground.
  const car = buildCar();
  car.root.position.y = HOVER;
  root.add(car.root);
  const sports = buildSportsCar();
  sports.root.position.set(SPORTS_PLACE.x, HOVER, SPORTS_PLACE.z);
  sports.root.rotation.y = SPORTS_PLACE.heading;
  root.add(sports.root);
  const bus = buildBus();
  bus.root.position.set(BUS_PLACE.x, HOVER, BUS_PLACE.z);
  bus.root.rotation.y = BUS_PLACE.heading;
  root.add(bus.root);
  const house = buildHouse();
  house.position.set(HOUSE_PLACE.x, 0, HOUSE_PLACE.z);
  house.rotation.y = HOUSE_PLACE.heading;
  root.add(house);
  const bigHouse = buildBigHouse();
  bigHouse.position.set(BIG_HOUSE_PLACE.x, 0, BIG_HOUSE_PLACE.z);
  root.add(bigHouse);
  const street = buildStreet();
  root.add(street);
  const machines = buildBrickWorks(BRICK_WORKS);
  root.add(machines);
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
  const site = new THREE.Group();
  site.name = 'site';
  root.add(site);
  for (const [build, at] of [
    [buildJobSite, JOB_SITE],
    [buildInspector, INSPECTOR],
  ] as const) {
    const g = build();
    g.position.set(at.x, 0, at.z);
    g.rotation.y = at.heading;
    site.add(g);
  }
  /** `o` wrapped as a fitting standing at (`x`, `y`, `z`), turned `heading`. */
  const fitting = (o: THREE.Object3D, x: number, z: number, heading: number, y = 0) => {
    const g = new THREE.Group();
    g.name = o.name;
    o.name = 'prop';
    g.add(o);
    g.position.set(x, y, z);
    g.rotation.y = heading;
    site.add(g);
  };
  fitting(powerCabinet(), POWER_CABINET.x, POWER_CABINET.z, POWER_CABINET.heading);
  // The ladder's back (its -z) to the wall.
  fitting(
    buildLadder(BIG_LADDER.height, BIG_LADDER.standoff, 4),
    BIG_LADDER.x,
    BIG_LADDER.z,
    Math.PI,
  );
  // The street's ends closed: two barriers across the road, the sign between them.
  const { length, gap, inset } = EDGES.barriers;
  const mid = (STREET.north + STREET.south) / 2;
  for (const x of [STREET.x0 + inset, STREET.x1 - inset]) {
    for (const s of [-1, 1]) fitting(roadBarrier(length), x, mid + s * (gap / 2 + length / 2), 0);
    fitting(closedSign(), x, mid, x < 0 ? Math.PI : 0);
  }
  const { x: hx, z0, z1 } = EDGES.hoarding;
  fitting(hoarding(z0 - z1), hx, (z0 + z1) / 2, Math.PI);
  const { z: ez, x0, x1 } = EDGES.hedge;
  fitting(hedge(x1 - x0), (x0 + x1) / 2, ez, Math.PI / 2);
  // A cone just off each of the pad's corners.
  const c = SITE_PAD.size / 2 + 0.25;
  for (const [i, [a, b]] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].entries()) {
    const cone = buildCone();
    cone.position.set(JOB_SITE.x + a! * c, 0, JOB_SITE.z + b! * c);
    cone.rotation.y = i * 1.3;
    root.add(cone);
    // Ahead of the others, so the knocked-over one stays last.
    cones.unshift(cone);
  }
  return { root, car, sports, bus, house, bigHouse, street, machines, site, ground, cones };
}
