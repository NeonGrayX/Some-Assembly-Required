import * as THREE from 'three';
import { BUS_LOW, buildBus } from './bus.ts';
import { HOVER, buildCar } from './car.ts';
import type { Car } from './car.ts';
import { buildCone } from './cone.ts';
import { buildGround, cobblePatch, coverGround } from './ground.ts';
import { buildHouse } from './house.ts';
import { buildBrickWorks } from './machines.ts';
import type { MachinePlace } from './machines.ts';
import { SPORT_LOW, buildSportsCar } from './sportscar.ts';
import { buildStreet } from './street.ts';
import type { StreetPlan } from './street.ts';
import { buildBigHouse } from './bighouse.ts';
import { buildInspector } from './inspector.ts';
import { buildLadder } from './ladder.ts';
import { closedSign, hedge, hoarding, roadBarrier } from './edges.ts';
import { powerCabinet } from './utility.ts';
import { floodlightMast } from './floodlight.ts';
import { busShelter } from './shelter.ts';
import { palletLoad, palletStack, portaloo, skip } from './dressing.ts';
import { portableSignal, roadPlate, spoilHeap, waterBarrier, worksSign } from './roadworks.ts';
import { SITE_PAD, buildJobSite } from './jobsite.ts';
import type { Ground, GroundCover, GroundLayout } from './ground.ts';
import { poweredIn } from './gadgets.ts';

/**
 * The car scene: the vehicles, the two houses, the street, the brick works' models and the
 * fittings round a job site, built where a layout stands them (see `CHEVRON_LAYOUT`). Its look
 * and its patch of mossy cobbles come from the reference picture it was first modelled after.
 */

/**
 * The house's yard: a patch of mossy cobbles as the off-roader's, round the house and out before
 * its door, given round the house (x toward its door, z along its gable) and turned with it.
 */
const HOUSE_YARD_OUTLINE: [number, number][] = [
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
];

/**
 * The big house's yard: mossy cobbles round it, out to the street's pavement before it, given
 * round the house (x along its front, z out of it).
 */
const BIG_HOUSE_YARD_OUTLINE: [number, number][] = [
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
];

/** An outline given round a place, set down there: turned with it and moved to it. */
export function placed(outline: [number, number][], at: Place): [number, number][] {
  const [c, s] = [Math.cos(at.heading), Math.sin(at.heading)];
  return outline.map(([x, z]) => [at.x + x * c + z * s, at.z - x * s + z * c]);
}

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

/** The barriers closing each end of the street, either side of its road-closed sign. */
const BARRIERS = { inset: 0.45, length: 2.6, gap: 0.7 };

/**
 * Road works dug in a lane, the lane's kerb toward -z: the barriers' line along the lane at `z`,
 * from `x0` to `x1`, and one across its `x0` end; and where the sign (if there is one), the
 * signal, the plate and the heap stand.
 */
export interface RoadWorks {
  z: number;
  x0: number;
  x1: number;
  sign?: { x: number; z: number };
  signal: { x: number; z: number };
  plate: { x: number; z: number };
  heap: { x: number; z: number };
}

/** Where something stands, and its turn about the upright. */
export interface Place {
  x: number;
  z: number;
  heading: number;
}

/** A run of hoarding or hedge: its middle, its length, and its turn (a turn of 0 runs along z). */
export interface Run extends Place {
  length: number;
}

/**
 * Where everything in the car scene stands, as a map lays it out (see `CHEVRON_LAYOUT`).
 */
export interface CarSceneLayout {
  /** Where the picture's patch of cobbles, its stones and its grass are moved to. */
  patch: { x: number; z: number };
  /** The open ground covered round the street and the yards, where not the studio's floor. */
  cover: GroundCover | null;
  /** Where the vehicles park. */
  parked: Parking[];
  house: Place;
  bigHouse: Place;
  street: StreetPlan;
  jobSite: Place;
  brickWorks: MachinePlace[];
  inspector: Place;
  powerCabinet: Place;
  /** The ladder up the big house: where it stands, its back to the wall, and its height. */
  ladder: Place & { standoff: number; height: number };
  hoardings: Run[];
  hedges: Run[];
  floodlights: Place[];
  busStop: Place;
  dressing: {
    pallets: (Place & { seed: number })[];
    stacks: Place[];
    skips: Place[];
    portaloos: Place[];
  };
  /** The road works dug in the street, if any. */
  roadWorks: RoadWorks | null;
  /** The square the ground's shadows are baked over: its middle and its side. */
  bake: { x: number; z: number; size: number };
  /** Where the player starts. */
  start: Place;
}

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
  /** How it is laid out. */
  layout: CarSceneLayout;
}

/** The vehicles, as `CarSceneOptions` names them. */
export type Vehicle = 'car' | 'sports' | 'bus';

/** A vehicle parked for a round: its middle over (`x`, `z`), turned end for end or not. */
export interface Parking {
  vehicle: Vehicle;
  x: number;
  z: number;
  turned: boolean;
}

/** How the game's map lays the scene out for a round (see `chevronLayout`). */
export interface CarSceneOptions {
  /** Where everything stands. */
  layout: CarSceneLayout;
  /** Where the vehicles park, where not as the layout has them. */
  parked?: readonly Parking[];
  /** Whether to leave out the brick works' models: the game draws its own machines there. */
  noWorks?: boolean;
}

/** How long a parking bay for a car is, and one for the bus. */
export const BAY = { short: 5.5, long: 9 };

export function buildCarScene(options: CarSceneOptions): CarScene {
  const L = options.layout;
  const root = new THREE.Group();
  const { x: px, z: pz } = L.patch;
  const ground = buildGround({
    patch: LAYOUT.patch.map(([x, z]) => [x + px, z + pz]),
    holes: LAYOUT.holes.map((h) => ({ ...h, x: h.x + px, z: h.z + pz })),
    tufts: LAYOUT.tufts.map((t) => ({ ...t, x: t.x + px, z: t.z + pz })),
  });
  root.add(ground.root);
  if (L.cover) root.add(coverGround(L.cover));
  root.add(cobblePatch(placed(HOUSE_YARD_OUTLINE, L.house), 41).root);
  root.add(cobblePatch(placed(BIG_HOUSE_YARD_OUTLINE, L.bigHouse), 53).root);
  // The vehicles hover a little, their wheels clear of the ground.
  const car = buildCar();
  car.root.position.y = HOVER;
  root.add(car.root);
  const sports = buildSportsCar();
  sports.root.position.y = HOVER - SPORT_LOW;
  root.add(sports.root);
  const bus = buildBus();
  bus.root.position.y = HOVER - BUS_LOW;
  root.add(bus.root);
  // Parked for the round: turned end for end or not, its middle where the bay's is.
  const vehicles = { car, sports, bus };
  for (const p of options.parked ?? L.parked) {
    const v = vehicles[p.vehicle].root;
    if (p.turned) v.rotation.y += Math.PI;
    v.updateMatrixWorld(true);
    const at = new THREE.Box3().setFromObject(v).getCenter(new THREE.Vector3());
    v.position.x += p.x - at.x;
    v.position.z += p.z - at.z;
  }
  const house = buildHouse();
  house.position.set(L.house.x, 0, L.house.z);
  house.rotation.y = L.house.heading;
  root.add(house);
  const bigHouse = buildBigHouse();
  bigHouse.position.set(L.bigHouse.x, 0, L.bigHouse.z);
  bigHouse.rotation.y = L.bigHouse.heading;
  root.add(bigHouse);
  const street = buildStreet(L.street);
  root.add(street);
  const machines = options.noWorks ? new THREE.Group() : buildBrickWorks(L.brickWorks);
  root.add(machines);
  const cones: THREE.Group[] = [];
  const site = new THREE.Group();
  site.name = 'site';
  root.add(site);
  for (const [build, at] of [
    [buildJobSite, L.jobSite],
    [buildInspector, L.inspector],
  ] as const) {
    const g = build();
    g.position.set(at.x, 0, at.z);
    g.rotation.y = at.heading;
    site.add(g);
  }
  /** `o` wrapped as a fitting standing at `at`, at `y` above the ground. */
  const fitting = (o: THREE.Object3D, at: Place, y = 0) => {
    const g = new THREE.Group();
    g.name = o.name;
    o.name = 'prop';
    g.add(o);
    g.position.set(at.x, y, at.z);
    g.rotation.y = at.heading;
    site.add(g);
  };
  fitting(powerCabinet(), L.powerCabinet);
  const lad = L.ladder;
  fitting(buildLadder(lad.height, lad.standoff, 4), lad);
  // The street's ends closed: two barriers across the road, the sign between them.
  const { length, gap, inset } = BARRIERS;
  const st = L.street;
  const mid = (st.north + st.south) / 2;
  for (const x of [st.x0 + inset, st.x1 - inset]) {
    for (const s of [-1, 1])
      fitting(roadBarrier(length), { x, z: mid + s * (gap / 2 + length / 2), heading: 0 });
    fitting(closedSign(), { x, z: mid, heading: x < 0 ? Math.PI : 0 });
  }
  for (const h of L.hoardings) fitting(hoarding(h.length), h);
  for (const h of L.hedges) fitting(hedge(h.length), h);
  for (const f of L.floodlights) fitting(floodlightMast(), f);
  fitting(busShelter(), L.busStop);
  const { pallets, stacks, skips, portaloos } = L.dressing;
  for (const p of pallets) fitting(palletLoad(p.seed), p);
  for (const p of stacks) fitting(palletStack(), p);
  for (const p of skips) fitting(skip(), p);
  for (const p of portaloos) fitting(portaloo(), p);
  // The road works: red and white barriers end to end along the lane and across its west end.
  const rw = L.roadWorks;
  if (rw) {
    const bl = 1.5;
    const n = Math.floor((rw.x1 - rw.x0) / bl);
    for (let k = 0; k < n; k++)
      fitting(waterBarrier(k % 2 === 0), {
        x: rw.x0 + bl * (k + 0.5),
        z: rw.z,
        heading: Math.PI / 2,
      });
    fitting(waterBarrier(true), { x: rw.x0 - 0.3, z: rw.z - 0.3 - bl / 2, heading: 0 });
    if (rw.sign) fitting(worksSign(), { ...rw.sign, heading: Math.PI });
    fitting(portableSignal(), { ...rw.signal, heading: Math.PI });
    fitting(roadPlate(1.4, 1.3), { ...rw.plate, heading: 0 });
    fitting(spoilHeap(0.65), { ...rw.heap, heading: 0.4 });
  }
  // A cone just off each of the pad's corners.
  const c = SITE_PAD.size / 2 + 0.25;
  const js = L.jobSite;
  for (const [i, [a, b]] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].entries()) {
    const cone = buildCone();
    cone.position.set(js.x + a! * c, 0, js.z + b! * c);
    cone.rotation.y = i * 1.3;
    root.add(cone);
    cones.unshift(cone);
  }
  // The power cabinet's switch feeds the map's lights and signals (see `powered`).
  const fed = poweredIn(root);
  root.traverse((o) => {
    if (o.userData.feeds) (o.userData.feeds as ((k: number) => void)[]).push(...fed);
  });
  return {
    root,
    car,
    sports,
    bus,
    house,
    bigHouse,
    street,
    machines,
    site,
    ground,
    cones,
    layout: L,
  };
}
