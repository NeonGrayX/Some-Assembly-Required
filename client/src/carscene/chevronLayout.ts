import { CHEVRON_HALF } from '@sar/shared';
import { BIG_HOUSE_BODY } from './bighouse.ts';
import { HOUSE_DOOR } from './house.ts';
import { INSPECTOR_PAD } from './inspector.ts';
import type { Rect } from './paint.ts';
import { BAY } from './scene.ts';
import type { GroundCover } from './ground.ts';
import type { CarSceneLayout, Place, RoadWorks } from './scene.ts';
import type { StreetPlan } from './street.ts';
import { BUS } from './bus.ts';

/**
 * Chevron Street, as the map plan lays it out: a square 32 m a side in three bands, the plan's
 * north toward +z (the game's maps keep their south edge, where a rival team's yard meets them,
 * toward -z). Given here as the plan draws it, north toward -z, and turned about at the end. Along the north the two houses: the big house on the
 * west, its front to the street, and the small house on the east as the site office, the quality
 * inspector in its yard on its east side, behind a short wall, the power cabinet in the alley
 * between them. Across the middle the street, closed at both ends, marked out in parking bays,
 * the zebra crossing in its middle and road works dug in one lane by it (see `ROAD_WORKS`).
 * Along the south the build lot: the job site in its middle with the brick works round it in an
 * arc, each machine facing the baseplate, the players' start in its south-west corner by the bus
 * stop, and a hoarding along its south edge, where a rival team's lot meets it.
 */

/** Half the map's side: the level's (see `chevronLayout`). */
export { CHEVRON_HALF };

/** How wide the gateway in the south hoarding is: the rival teams' gate (see `RIVAL_WALL`). */
const GATEWAY = 3.2;

/** The street: the road between z -5.4 (the houses' kerb) and 1.0 (the lot's), its middle at 0. */
const ROAD = { houses: -5.4, lot: 1.0 };

/** A bay: x0 z0 x1 z1. */
type Bay = [number, number, number, number];

/**
 * The parking bays, as the plan draws them: in the houses' lane a long one west of the crossing
 * and two short ones east of it, in the lot's lane a short one at its west end and a long one
 * east of the crossing; the road works take the stretch between them, west of the crossing.
 */
const BAYS = {
  long: [
    [-15, -5.2, -6, -2.6],
    [3, -1.8, 12, 0.8],
  ] as [number, number, number, number][],
  short: [
    [3, -5.2, 3 + BAY.short, -2.6],
    [9, -5.2, 9 + BAY.short, -2.6],
    [-14.5, -1.8, -14.5 + BAY.short, 0.8],
  ] as [number, number, number, number][],
};

/** A bay's middle. */
const bayMiddle = (b: Bay): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

const STREET: StreetPlan = {
  x0: -CHEVRON_HALF,
  x1: CHEVRON_HALF,
  // The street's own north (+z) is the plan's south: the lot's side.
  north: ROAD.lot,
  south: ROAD.houses,
  middle: (ROAD.lot + ROAD.houses) / 2,
  pavement: 2.2,
  crossing: 0,
  lamps: [
    { x: -12, side: 'south' },
    { x: 8, side: 'south' },
    { x: -7, side: 'north' },
    { x: 12, side: 'north' },
  ],
  // One in each lane, clear of the bays.
  manholes: [
    { x: -4.4, z: -3.8, lifts: true },
    { x: 13.7, z: -0.5, lifts: true },
  ],
  drains: [
    { x: -10.5, side: 'north' },
    { x: 4.5, side: 'north' },
    { x: -6.5, side: 'south' },
    { x: 10.5, side: 'south' },
  ],
  railings: [
    { x: -4.35, side: 'north', length: 2.7 },
    { x: 6.0, side: 'north', length: 2.0 },
    { x: 4.4, side: 'south', length: 2.5 },
  ],
  furniture: [
    // Before the houses: a hydrant, a pair of bins and a charging post.
    { kind: 'hydrant', x: -10, side: 'south', back: 1.5 },
    { kind: 'bin', x: -15.2, side: 'south', back: 1.7, toRoad: true },
    { kind: 'bin', x: -14.6, side: 'south', back: 1.7, toRoad: true, colour: BUS.yellow },
    { kind: 'charger', x: 14.5, side: 'south', back: 1.8, toRoad: true },
    // Along the lot: a pair of bins by the bus stop, a bench, a planter, bollards at the crossing.
    { kind: 'bin', x: -15.2, side: 'north', back: 1.75, toRoad: true },
    { kind: 'bin', x: -14.6, side: 'north', back: 1.75, toRoad: true, colour: BUS.yellow },
    { kind: 'bench', x: 5.4, side: 'north', back: 1.6, toRoad: true },
    { kind: 'planter', x: 8.2, side: 'north', back: 1.4, seed: 41 },
    { kind: 'bollard', x: -2.6, side: 'south', back: 0.42 },
    { kind: 'bollard', x: -3.25, side: 'south', back: 0.42 },
  ],
  bays: [...BAYS.long, ...BAYS.short],
  // Carried on past the map's ends by the town's (see `city.ts`).
  open: true,
};

const BIG_HOUSE: Place = { x: -9.5, z: -11.6, heading: 0 };
/** The site office: its door's gable (its +x) to the street. */
const OFFICE: Place = { x: 8.1, z: -13.6, heading: -Math.PI / 2 };
/** The job site, its corkboards on its west and its Done button and bell on its east. */
const JOB_SITE: Place = { x: 0, z: 9.5, heading: 0 };

/** The quality inspector, in the office's yard on its east side, a build carried in from the street. */
const INSPECTOR: Place = { x: 13.2, z: -12.4, heading: -Math.PI / 2 };
/** The power cabinet, in the alley between the houses, its doors to the street. */
const POWER: Place = { x: 2.6, z: -14.6, heading: -Math.PI / 2 };

/** The back of each pavement: the lot's and the houses'. */
const BACK = { lot: ROAD.lot + STREET.pavement, houses: ROAD.houses - STREET.pavement };

/**
 * A path of slabs a metre or more wide from under the houses' pavement out to `z`, its middle
 * at `x`.
 */
function path(x: number, z: number, wide = 1): Rect {
  const z1 = BACK.houses + 0.2;
  return [x - wide / 2, z, wide, z1 - z];
}

/**
 * The open ground: the lot gravelled from under its pavement to the hoarding, cut off straight
 * at the map's south edge, where a rival team's lot meets it; ruts worn in from the gateway to
 * the job site and round to the pallets by the start. Lawns all round the houses, under the
 * yards' cobbles, out to the hedges, and paths over them from the pavement to the office's door,
 * up to the inspector's pad, and up the alley to the power cabinet. Past the map's other edges
 * they are brushed out over the floor.
 */
const COVER: GroundCover = {
  gravel: {
    outline: square(-CHEVRON_HALF - 0.6, BACK.lot - 0.3, CHEVRON_HALF + 0.6, CHEVRON_HALF + 0.8),
    tracks: [
      [
        [0.3, CHEVRON_HALF + 1],
        [0.2, 14.5],
        [0, JOB_SITE.z + 1.1],
      ],
      [
        [-0.5, CHEVRON_HALF + 1],
        [-0.8, 16.0],
        [-1.6, 15.35],
        [-3.0, 15.1],
        [-5.5, 15.0],
        [-9.5, 14.6],
        [-11.1, 14.0],
        [-12.2, 13.0],
      ],
    ],
    rect: [
      -CHEVRON_HALF - 1.3,
      BACK.lot - 0.6,
      2 * CHEVRON_HALF + 2.6,
      CHEVRON_HALF - BACK.lot + 0.6,
    ],
  },
  lawns: [
    {
      outline: square(
        -CHEVRON_HALF - 0.6,
        -CHEVRON_HALF - 0.6,
        CHEVRON_HALF + 0.6,
        BACK.houses + 0.3,
      ),
      rect: [
        -CHEVRON_HALF - 1.3,
        -CHEVRON_HALF - 1.3,
        2 * CHEVRON_HALF + 2.6,
        CHEVRON_HALF + BACK.houses + 1.9,
      ],
    },
  ],
  paths: [
    // Into the office's cobbles before its door.
    path(OFFICE.x - HOUSE_DOOR.at, OFFICE.z + 2.8),
    // Wide enough for a build carried in, to just under the pad's edge.
    path(INSPECTOR.x, INSPECTOR.z + INSPECTOR_PAD.size / 2 - 0.1, 1.5),
    path(POWER.x, POWER.z + 0.3),
  ],
};

/** Turned from (`x`, `z`) to face `at`. */
const facing = (x: number, z: number, at: Place) => Math.atan2(at.x - x, at.z - z);
/** Turned from (`x`, `z`) to light `at` (a mast's lamps look along its +x). */
const lighting = (x: number, z: number, at: Place) => Math.atan2(-(at.z - z), at.x - x);

/** The brick works' machines, in the order the plan stands them. */
const KINDS = ['silo', 'press', 'press', 'dispenser', 'printer'] as const;

const PLAN: CarSceneLayout = {
  // The picture's patch of mossy cobbles where the lot meets the street, by the crossing.
  patch: { x: 0, z: 5.6 },
  cover: COVER,
  // Parked as the bays first take them; a round parks them afresh (see `chevronLayout`). The
  // bus with its door to the kerb.
  parked: [
    { vehicle: 'car', ...xz(bayMiddle(BAYS.short[2]!)), turned: false },
    { vehicle: 'sports', ...xz(bayMiddle(BAYS.short[0]!)), turned: false },
    { vehicle: 'bus', ...xz(bayMiddle(BAYS.long[0]!)), turned: true },
  ],
  house: OFFICE,
  bigHouse: BIG_HOUSE,
  street: STREET,
  jobSite: JOB_SITE,
  // The silo and the mould vendor west of the job site, the presses east, the printer south,
  // beside the gateway.
  brickWorks: (
    [
      [-6.5, 6.4],
      [6.9, 6.4],
      [-6.7, 12.6],
      [6.9, 12.6],
      [3.2, 14.3],
    ] as const
  ).map(([x, z], i) => ({ kind: KINDS[i]!, x, z, facing: facing(x, z, JOB_SITE) })),
  // In the office's yard on its east side (on the right of it, seen from the street), a build
  // carried in from the street; its screen and short wall behind the pad, on the north, clear of
  // the vacuum's dock on the office's east wall and of the hedges.
  inspector: INSPECTOR,
  powerCabinet: POWER,
  // Up the big house's east gable, by its back corner, its back to the wall.
  ladder: {
    x: BIG_HOUSE.x + BIG_HOUSE_BODY.depth + 0.62,
    z: BIG_HOUSE.z - BIG_HOUSE_BODY.half + 0.25,
    heading: Math.PI / 2,
    standoff: 0.53,
    height: BIG_HOUSE_BODY.eave + 0.05,
  },
  // The site's hoarding along the lot's south edge, a gateway in its middle where a rival team's
  // lot meets this one, and down its sides; hedges round the houses.
  hoardings: [
    ...[-1, 1].map((s) => ({
      x: (s * (CHEVRON_HALF + GATEWAY / 2)) / 2,
      z: CHEVRON_HALF - 0.2,
      length: CHEVRON_HALF - GATEWAY / 2,
      heading: Math.PI / 2,
    })),
    { x: -CHEVRON_HALF + 0.2, z: 9.6, length: 12.4, heading: 0 },
    { x: CHEVRON_HALF - 0.2, z: 9.6, length: 12.4, heading: Math.PI },
  ],
  hedges: [
    { x: 0, z: -CHEVRON_HALF + 0.3, length: 2 * CHEVRON_HALF - 0.6, heading: Math.PI / 2 },
    { x: -CHEVRON_HALF + 0.3, z: -11.75, length: 7.5, heading: 0 },
    { x: CHEVRON_HALF - 0.3, z: -11.75, length: 7.5, heading: 0 },
  ],
  floodlights: [
    { x: -4.5, z: 4.0, at: JOB_SITE },
    { x: 4.6, z: 15.0, at: JOB_SITE },
  ].map(({ x, z, at }) => ({ x, z, heading: lighting(x, z, at) })),
  // On the lot's pavement by the start, its open front to the road.
  busStop: { x: -11.6, z: 2.3, heading: Math.PI / 2 },
  dressing: {
    pallets: [
      { x: -12.6, z: 10.1, heading: 0.1, seed: 1 },
      { x: -12.5, z: 11.5, heading: -0.06, seed: 4 },
    ],
    stacks: [{ x: -11.0, z: 12.6, heading: 0.3 }],
    skips: [{ x: 13.4, z: 13.8, heading: Math.PI / 2 }],
    portaloos: [{ x: 14.5, z: 5.0, heading: Math.PI }],
  },
  roadWorks: null,
  bake: { x: 0, z: 0, size: 2 * CHEVRON_HALF + 4 },
  start: { x: -12, z: 5.8, heading: facing(-12, 5.8, JOB_SITE) + Math.PI },
};

function xz([x, z]: [number, number]): { x: number; z: number } {
  return { x, z };
}

/** The outline of the rectangle from (`x0`, `z0`) to (`x1`, `z1`). */
function square(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

/** Turned half round about the middle. */
const turn = <T extends { x: number; z: number; heading: number }>(p: T): T => ({
  ...p,
  x: -p.x,
  z: -p.z,
  heading: p.heading + Math.PI,
});
const turnBay = (b: Bay): Bay => [-b[2], -b[3], -b[0], -b[1]];
const turnPoint = ([x, z]: [number, number]): [number, number] => [-x, -z];
const turnRect = (r: Rect): Rect => [-r[0] - r[2], -r[1] - r[3], r[2], r[3]];
const other = { north: 'south', south: 'north' } as const;

/** The layout as the plan draws it, turned half round about the middle. */
function halfTurn(L: CarSceneLayout): CarSceneLayout {
  const s = L.street;
  return {
    ...L,
    patch: { x: -L.patch.x, z: -L.patch.z },
    cover: L.cover && {
      gravel: {
        outline: L.cover.gravel.outline.map(turnPoint),
        tracks: L.cover.gravel.tracks.map((t) => t.map(turnPoint)),
        rect: turnRect(L.cover.gravel.rect),
      },
      lawns: L.cover.lawns.map((l) => ({
        outline: l.outline.map(turnPoint),
        rect: turnRect(l.rect),
      })),
      paths: L.cover.paths.map(turnRect),
    },
    parked: L.parked.map((p) => ({ ...p, x: -p.x, z: -p.z, turned: !p.turned })),
    house: turn(L.house),
    bigHouse: turn(L.bigHouse),
    street: {
      ...s,
      x0: -s.x1,
      x1: -s.x0,
      north: -s.south,
      south: -s.north,
      middle: -s.middle,
      crossing: -s.crossing,
      lamps: s.lamps.map((l) => ({ x: -l.x, side: other[l.side] })),
      manholes: s.manholes.map((m) => ({ ...m, x: -m.x, z: -m.z })),
      drains: s.drains.map((d) => ({ x: -d.x, side: other[d.side] })),
      railings: s.railings.map((r) => ({ ...r, x: -r.x, side: other[r.side] })),
      furniture: s.furniture.map((f) => ({ ...f, x: -f.x, side: other[f.side] })),
      bays: s.bays.map(turnBay),
    },
    jobSite: turn(L.jobSite),
    brickWorks: L.brickWorks.map((m) => ({
      ...m,
      x: -m.x,
      z: -m.z,
      facing: m.facing + Math.PI,
    })),
    inspector: turn(L.inspector),
    powerCabinet: turn(L.powerCabinet),
    ladder: turn(L.ladder),
    hoardings: L.hoardings.map(turn),
    hedges: L.hedges.map(turn),
    floodlights: L.floodlights.map(turn),
    busStop: turn(L.busStop),
    dressing: {
      pallets: L.dressing.pallets.map(turn),
      stacks: L.dressing.stacks.map(turn),
      skips: L.dressing.skips.map(turn),
      portaloos: L.dressing.portaloos.map(turn),
    },
    bake: { ...L.bake, x: -L.bake.x, z: -L.bake.z },
    start: turn(L.start),
  };
}

/**
 * The car scene's road works, in place of cones and barriers in the empty bays:
 * dug in the lot's lane between the crossing and the short bay at the lane's end, the water
 * barriers along the lane's middle (a little toward the kerb, clear of a bus parked across the
 * middle line) and across its end by the crossing, the signal out before them (no sign), the
 * plate over the trench and the heap by the kerb, as the picture has them. Given as the map has
 * it (after the half turn), where the lot's kerb is toward -z as the picture's lane's is.
 */
const ROAD_WORKS: RoadWorks = {
  z: 1.7,
  x0: 4.0,
  x1: 8.5,
  signal: { x: 3.3, z: -0.4 },
  plate: { x: 6.1, z: 0.8 },
  heap: { x: 7.1, z: -0.15 },
};

export const CHEVRON_LAYOUT: CarSceneLayout = { ...halfTurn(PLAN), roadWorks: ROAD_WORKS };

/** The parking bays, as the map has them: the long ones the bus's, the short ones the cars'. */
export const CHEVRON_BAYS = { long: BAYS.long.map(turnBay), short: BAYS.short.map(turnBay) };
