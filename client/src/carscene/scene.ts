import * as THREE from 'three';
import { BUS_LOW, buildBus } from './bus.ts';
import { HOVER, buildCar } from './car.ts';
import type { Car } from './car.ts';
import { buildCone, fallenCone } from './cone.ts';
import { buildGround, cobblePatch, coverGround } from './ground.ts';
import { buildHouse } from './house.ts';
import { buildBrickWorks } from './machines.ts';
import type { MachinePlace } from './machines.ts';
import { buildRoad } from './road.ts';
import type { RoadLayout } from './road.ts';
import { SPORT_LOW, buildSportsCar } from './sportscar.ts';
import { STREET, buildStreet } from './street.ts';
import type { StreetPlan } from './street.ts';
import { BIG_HOUSE_BODY, buildBigHouse } from './bighouse.ts';
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
 * Where the small house stands: behind the cars' tails, its door's gable toward them, its path
 * running out toward the sports car's road; square to the street, as the game's maps stand
 * their walls. Out of the picture, as the bus is.
 */
export const HOUSE_PLACE = { x: -12.8, z: -4.4, heading: 0 };

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

/** Where the big house stands: across the street from the cars, its front to the road. */
export const BIG_HOUSE_PLACE = { x: -5.0, z: -26.6, heading: 0 };

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
 * The job site, between the cars and the brick works: the baseplate on its pad, the Done button
 * and the bell on its south side (toward the street), the corkboards on its north side, and a
 * cone at each of the pad's corners.
 */
export const JOB_SITE = { x: 6.6, z: -3.4, heading: Math.PI / 2 };

/**
 * The brick works, round the job site as the game stands its machines: apart, each on a pad of
 * its own and turned to face the baseplate, so every trip between them passes the build. The
 * silo north-east of it, the two presses east and south-east, the mould vendor south and the UV
 * printer south-west, by the bus's nose.
 */
export const BRICK_WORKS: MachinePlace[] = (
  [
    ['silo', 10.2, 0.6],
    ['press', 11.5, -2.7],
    ['press', 10.7, -7.5],
    ['dispenser', 6.6, -8.7],
    ['printer', 4.3, -7.7],
  ] as const
).map(([kind, x, z]) => ({
  kind,
  x,
  z,
  facing: Math.atan2(JOB_SITE.x - x, JOB_SITE.z - z),
}));

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
  // Its back (its -z) to the wall.
  heading: Math.PI,
  standoff: 0.53,
  height: BIG_HOUSE_BODY.eave + 0.05,
};

/**
 * What closes the map in: barriers and a road-closed sign across each end of the street, a
 * hoarding behind the brick works, and a hedge along the north past the inspector.
 */
export const EDGES = {
  barriers: { inset: 0.45, length: 2.6, gap: 0.7 },
  hoarding: { x: 13.6, z0: 2.6, z1: -10.0 },
  hedge: { z: 4.4, x0: -14.2, x1: -4.0 },
};

/**
 * The floodlight masts, for playing after dark: two by the hoarding's ends lighting the brick
 * works and the job site, one at the hedge's end lighting the inspector and the cars; each turned
 * to what it lights.
 */
const FLOODLIGHTS = [
  { x: 12.6, z: 2.2, at: JOB_SITE },
  { x: 12.6, z: -10.6, at: JOB_SITE },
  { x: -3.3, z: 4.4, at: INSPECTOR },
].map(({ x, z, at }) => ({ x, z, heading: Math.atan2(-(at.z - z), at.x - x) }));

/**
 * The bus stop, on the bus's door side by its nose: the shelter's open front to the bus, its
 * flag at the end the bus comes in from.
 */
export const BUS_STOP = { x: 1.75, z: -4.9, heading: Math.PI / 2 };

/**
 * The lot's dressing: the pellets' pallets west of the silo, by the job site's boards; the skip
 * and the portaloo south of the brick works, toward the street's end.
 */
export const DRESSING = {
  pallets: [
    { x: 6.9, z: 1.7, heading: 0.1, seed: 1 },
    { x: 6.8, z: 3.1, heading: -0.06, seed: 4 },
  ],
  stack: { x: 8.3, z: 3.3, heading: 0.3 },
  skip: { x: 8.4, z: -11.8, heading: Math.PI / 2 },
  portaloo: { x: 11.4, z: -12.6, heading: -Math.PI / 2 },
};

/**
 * Road works in the street's south lane, east of the crossing, round its manhole there: water
 * barriers along the lane's middle and across its west end, the sign and the signal out before
 * them facing the traffic, a plate over the trench and the heap dug out of it.
 */
const ROAD_WORKS: RoadWorks = {
  z: -16.8,
  x0: -1.9,
  x1: 2.6,
  sign: { x: -3.1, z: -18.6 },
  signal: { x: -2.6, z: -19.1 },
  plate: { x: 0.2, z: -17.7 },
  heap: { x: 1.2, z: -18.85 },
};

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
 * Where everything in the car scene stands: as the reference picture has it (`PICTURE`), or as
 * a map lays it out (see `CHEVRON_LAYOUT`).
 */
export interface CarSceneLayout {
  /** Where the picture's patch of cobbles, its stones and its grass are moved to. */
  patch: { x: number; z: number };
  /** The stretches of road under parked vehicles, past the street's. */
  roads: RoadLayout[];
  /** The open ground covered round the street and the yards, where not the studio's floor. */
  cover: GroundCover | null;
  /** Where the vehicles park, where not as the picture has them. */
  parked: Parking[];
  house: Place;
  bigHouse: Place;
  street: StreetPlan;
  /** The cones standing about, and the one knocked over. */
  cones: { upright: Place[]; fallen: Place | null };
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

/** The car scene as the reference picture has it, the rest of it round about. */
export const PICTURE: CarSceneLayout = {
  patch: { x: 0, z: 0 },
  roads: [ROAD, BUS_ROAD],
  cover: null,
  parked: [],
  house: HOUSE_PLACE,
  bigHouse: BIG_HOUSE_PLACE,
  street: STREET,
  cones: {
    // One of each one's floating signs turned to the picture's camera, as there.
    upright: CONES.upright.map((p) => ({
      ...p,
      heading: Math.atan2(REFERENCE_VIEW.position.x - p.x, REFERENCE_VIEW.position.z - p.z),
    })),
    fallen: CONES.fallen,
  },
  jobSite: JOB_SITE,
  brickWorks: BRICK_WORKS,
  inspector: INSPECTOR,
  powerCabinet: POWER_CABINET,
  ladder: BIG_LADDER,
  hoardings: [
    {
      x: EDGES.hoarding.x,
      z: (EDGES.hoarding.z0 + EDGES.hoarding.z1) / 2,
      length: EDGES.hoarding.z0 - EDGES.hoarding.z1,
      heading: Math.PI,
    },
  ],
  hedges: [
    {
      x: (EDGES.hedge.x0 + EDGES.hedge.x1) / 2,
      z: EDGES.hedge.z,
      length: EDGES.hedge.x1 - EDGES.hedge.x0,
      heading: Math.PI / 2,
    },
  ],
  floodlights: FLOODLIGHTS,
  busStop: BUS_STOP,
  dressing: {
    pallets: DRESSING.pallets,
    stacks: [DRESSING.stack],
    skips: [DRESSING.skip],
    portaloos: [DRESSING.portaloo],
  },
  roadWorks: ROAD_WORKS,
  bake: { x: -3.0, z: -9.5, size: 42 },
  start: { x: 3.0, z: -12.3, heading: 0.2 },
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
  /** Where everything stands: as the picture has it unless given. */
  layout?: CarSceneLayout;
  /** Where the vehicles park, where not as the picture has them. */
  parked?: readonly Parking[];
  /** Whether to leave out the brick works' models: the game draws its own machines there. */
  noWorks?: boolean;
}

/** How long a parking bay for a car is, and one for the bus. */
export const BAY = { short: 5.5, long: 9 };

export function buildCarScene(options: CarSceneOptions = {}): CarScene {
  const L = options.layout ?? PICTURE;
  const root = new THREE.Group();
  const { x: px, z: pz } = L.patch;
  const ground = buildGround({
    patch: LAYOUT.patch.map(([x, z]) => [x + px, z + pz]),
    holes: LAYOUT.holes.map((h) => ({ ...h, x: h.x + px, z: h.z + pz })),
    tufts: LAYOUT.tufts.map((t) => ({ ...t, x: t.x + px, z: t.z + pz })),
  });
  root.add(ground.root);
  if (L.cover) root.add(coverGround(L.cover));
  for (const r of L.roads) root.add(buildRoad(r));
  root.add(cobblePatch(placed(HOUSE_YARD_OUTLINE, L.house), 41).root);
  root.add(cobblePatch(placed(BIG_HOUSE_YARD_OUTLINE, L.bigHouse), 53).root);
  // The vehicles hover a little, their wheels clear of the ground.
  const car = buildCar();
  car.root.position.y = HOVER;
  root.add(car.root);
  const sports = buildSportsCar();
  sports.root.position.set(SPORTS_PLACE.x, HOVER - SPORT_LOW, SPORTS_PLACE.z);
  sports.root.rotation.y = SPORTS_PLACE.heading;
  root.add(sports.root);
  const bus = buildBus();
  bus.root.position.set(BUS_PLACE.x, HOVER - BUS_LOW, BUS_PLACE.z);
  bus.root.rotation.y = BUS_PLACE.heading;
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
  for (const p of L.cones.upright) {
    const c = buildCone();
    c.position.set(p.x, 0, p.z);
    c.rotation.y = p.heading;
    root.add(c);
    cones.push(c);
  }
  if (L.cones.fallen) {
    const f = fallenCone(L.cones.fallen.heading);
    f.position.set(L.cones.fallen.x, 0, L.cones.fallen.z);
    root.add(f);
    cones.push(f);
  }
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
  const { length, gap, inset } = EDGES.barriers;
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
    // Ahead of the others, so the knocked-over one stays last.
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
