import type { Vec3 } from '../../math.ts';
import type {
  BoxDef,
  DecalDef,
  FloorRect,
  HideoutDef,
  InteriorDef,
  LadderDef,
  LevelDef,
  MachineDef,
  Paint,
  WindowDef,
} from '../house.ts';
import { MACHINE_SIZE, VACUUM_FROM_WALL, WALL_T, machineAt } from '../house.ts';
import { groundHeight, groundSpan, sampleTerrain } from '../terrain.ts';
import type { TerrainDef } from '../terrain.ts';
import {
  EAST,
  LADDER_CLEAR,
  MAILBOX_POST,
  NORTH,
  SOUTH,
  WEST,
  addGroundPageSpots,
  box,
  dogNetwork,
  drawerIn,
  firstGoodLayout,
  floorOf,
  gen,
  gridPoints,
  grow,
  headersOver,
  hideout,
  inRect,
  interiorOf,
  rect,
  ring,
  roomWalls,
  standTrashBins,
  standing,
  tidy,
} from './common.ts';
import type { Gap } from './common.ts';

/**
 * Cutlass Cove: a pirate island in a turquoise sea. Its ground is nowhere flat: sandy beaches
 * rise to rolling grass, Skull Hill stands over the north shore with its great rocks, a cove
 * cuts in from the east under a rope bridge, and a sand spit runs south to the stockade gate.
 */

/** Half the map's width: the island and the shallows round it. */
export const ISLAND_HALF = 21;
/** The sea's level. */
export const SEA = 0;
/** Metres between the terrain's samples. */
export const TERRAIN_STEP = 0.5;

// ---------------------------------------------------------------- noise

/** A hash of a whole-numbered point, in [0, 1). */
function hash(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, in [0, 1). */
function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 at `a`, 1 at `b`, easing in and out between (either way round). */
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- the shape of the land

/** The middle of the island's main body, which its shore is measured round. */
const MIDDLE = { x: -0.5, z: 1.5 };

/**
 * How far inland a point is from the shore, in metres (negative out at sea): the island's
 * rounded body with a ragged shore, the sand spit down to the south gate, and the cove cut in
 * from the east coast.
 */
export function inland(x: number, z: number): number {
  const dx = x - MIDDLE.x;
  const dz = z - MIDDLE.z;
  const th = Math.atan2(dz, dx);
  const r =
    15.6 + 1.2 * Math.sin(3 * th + 0.7) + 0.8 * Math.sin(5 * th + 2.1) + 0.5 * Math.sin(7 * th + 4);
  let s = r - Math.hypot(dx, dz);
  // The spit: a sandbar from the south shore to the gate, wavering a little.
  const sz = Math.min(-9, Math.max(-ISLAND_HALF - 1, z));
  const spit = 3.8 + 0.4 * Math.sin(z * 0.9) - Math.hypot(x - 0.3 * Math.sin(z * 0.3), z - sz);
  s = Math.max(s, spit);
  s += (noise(x * 0.3, z * 0.3, 3) - 0.5) * 1.4;
  // The cove, an inlet from the east coast.
  const cove = Math.hypot((x - 14) / 7.5, (z - 1.6) / 2);
  return Math.min(s, (cove - 1) * 3);
}

/** A hill: an oval rising to `h` in its middle, its sides easing down to nothing at its edge. */
interface Hill {
  x: number;
  z: number;
  rx: number;
  rz: number;
  h: number;
}

/**
 * Skull Hill over the north shore and its shoulder, the east knoll, the rise south of the cove,
 * the west knoll by the tavern, the hump in the middle and the dunes down the spit.
 */
const HILLS: Hill[] = [
  { x: -6, z: 11, rx: 11, rz: 9, h: 3.4 },
  { x: -2.5, z: 13.5, rx: 4.5, rz: 3.5, h: 0.8 },
  { x: 10.5, z: 9.5, rx: 6.5, rz: 5.5, h: 1.9 },
  { x: 9, z: -4, rx: 6, rz: 5, h: 1.1 },
  { x: -10, z: -6.5, rx: 4.5, rz: 4, h: 1.2 },
  { x: -3, z: 2.5, rx: 5, rz: 4, h: 0.7 },
  { x: 4, z: -10, rx: 3.5, rz: 3, h: 0.6 },
  { x: -1.2, z: -14.5, rx: 2.2, rz: 2.6, h: 0.45 },
  { x: 1.4, z: -18.2, rx: 2, rz: 2.2, h: 0.35 },
];

/**
 * The ground before anything is built on it: under the sea a shelf shelving down to a metre
 * deep, then the beach rising from the water, the grass above it, the hills, and a roll to it
 * all everywhere.
 */
export function wildGround(x: number, z: number): number {
  const s = inland(x, z);
  if (s < 0) return SEA - 1.05 * smooth(0, 6, -s);
  const land = smooth(-0.3, 1.5, s);
  let h = SEA + 0.5 * smooth(0, 4, s) + 0.9 * smooth(3, 10, s);
  for (const hill of HILLS) {
    const q = Math.hypot((x - hill.x) / hill.rx, (z - hill.z) / hill.rz);
    h += land * hill.h * smooth(1, 0, q);
  }
  h +=
    land *
    ((noise(x * 0.2, z * 0.2, 11) - 0.5) * 1.3 +
      (noise(x * 0.55, z * 0.55, 17) - 0.5) * 0.45 +
      (noise(x * 1.3, z * 1.3, 23) - 0.5) * 0.08);
  return h;
}

/**
 * Ground levelled for something built on it (a deck, a floor, a machine's platform): within
 * `r` it is eased to `y`, and over `fall` metres beyond its edge back to the wild ground.
 */
export interface Pad {
  r: FloorRect;
  y: number;
  fall: number;
}

/** The lowest a pad is levelled to: above the sea, so nothing built stands in the water. */
const PAD_LOW = SEA + 0.3;

/**
 * The ground's height averaged over a rectangle, to the centimetre: a pad's natural level, or
 * just above the sea where the ground there dips into it.
 */
export function meanGround(r: FloorRect): number {
  let sum = 0;
  let n = 0;
  for (let x = r.x0; x <= r.x1 + 1e-9; x += 0.25)
    for (let z = r.z0; z <= r.z1 + 1e-9; z += 0.25) {
      sum += wildGround(x, z);
      n++;
    }
  return Math.max(PAD_LOW, Math.round((sum / n) * 100) / 100);
}

/** How far in from the south edge the ground is made the same either side of the middle. */
const SEAM = 2;

/**
 * The island's ground with its pads levelled, as terrain. Along the south edge it is eased to
 * the same height at `x` as at `-x`, so that rival teams' copy of the island, turned half round
 * about the middle of that edge, meets it without a step (see `rivalLevel`).
 */
export function islandTerrain(pads: Pad[]): TerrainDef {
  const half = ISLAND_HALF;
  const levelled = (x: number, z: number) => {
    let h = wildGround(x, z);
    for (const p of pads) {
      const dx = Math.max(p.r.x0 - x, 0, x - p.r.x1);
      const dz = Math.max(p.r.z0 - z, 0, z - p.r.z1);
      const w = smooth(p.fall, 0, Math.hypot(dx, dz));
      h = h * (1 - w) + p.y * w;
    }
    return h;
  };
  return sampleTerrain({ x0: -half, z0: -half, x1: half, z1: half }, TERRAIN_STEP, (x, z) => {
    const h = levelled(x, z);
    const w = smooth(-half + SEAM, -half, z);
    if (w === 0) return h;
    // (Added the same way round at x and at -x, so the two are equal to the last bit.)
    const mirror = levelled(-x, z);
    const even = x < 0 ? (mirror + h) / 2 : (h + mirror) / 2;
    return h * (1 - w) + even * w;
  });
}

// ---------------------------------------------------------------- what stands on it

const GRASS = 0x6fae3f;
const PLANK = 0x9c6b3e;
const TIMBER: Paint = { colour: 0x8b5a2f, surface: 'planks' };
const DARK_TIMBER: Paint = { colour: 0x5e3b20, surface: 'wood' };
const ROOF: Paint = { colour: 0x7b4526, surface: 'roof' };
const FLOORBOARDS: Paint = { colour: 0xa47648, surface: 'planks' };
const ROCK = 0x8f949b;
const ROPE = 0xc9a66b;
/** Old iron, rusting: the anchors. */
const RUSTY = 0x4a4642;
/** The plaster between the upper storeys' timbers. */
const PLASTER: Paint = { colour: 0xe9dcb8, surface: 'wall' };
/** Old mooring posts, weathered grey-brown. */
const PILING = 0x6f5638;
/** The tavern porch's roof boards, darker than the decking under them. */
const PORCH_ROOF = 0x6e4428;
const IRON = 0x34373c;
const BARREL = 0x9a6436;
const CRATE = 0xb5844e;
const PALM = 0x8a6a45;

/** How thick a deck is, and how far its top stands over the levelled ground it is laid on. */
const DECK_T = 0.2;
const DECK_UP = 0.15;
/** The tavern's and the hut's walls, and the tops of their doorways. */
const WALL_H = 2.6;
const DOOR_H = 2.2;
/**
 * The upper storey over the tavern's and the hut's walls: how high it is, how far it juts out
 * past the walls' outer faces all round, and how far the gable's eaves reach on past it. (A
 * gable roof's model standing on no plain walls, as on a storey, takes its walls to stand that
 * far in from its edges.)
 */
const STOREY_H = 2;
const JETTY = 0.22;
const EAVES = 0.4;
/**
 * The unseen walls round the map's edge: from past the deepest of the sea round the island to
 * well over a jump from anything near them.
 */
const EDGE_FOOT = -1.25;
const EDGE_TOP = 3;
/**
 * The mooring posts marking the edge out in the sea: how far in from it their outer faces
 * stand (the least, and how much further at most), how far on along it each stands from the
 * last (the least, and how much further at most), and how high over the sea their tops are
 * (the least, and how much more at most), or a broken stump's.
 */
export const PILING_IN = { least: 0.5, more: 2 };
export const PILING_EVERY = { least: 2.5, more: 2.5 };
export const PILING_TOP = { least: 1.2, more: 0.6 };
export const STUMP_TOP = { least: 0.25, more: 0.25 };
/** How far apart the middles of mooring posts lashed together stand. */
const LASHED = 0.5;
/** The stockade's rope fence either side of the gate, out into the shallows. */
const STOCKADE_TO = 5.5;
/**
 * A lantern's timber post: how thick, and how high its top stands over the ground at its foot or
 * under its lantern, whichever is higher (the lantern hangs on a short chain from an arm off the
 * top, out past the post on its front side, about `reach` out).
 */
export const LANTERN_POST = { thick: 0.22, height: 2.9, reach: 0.65 };
/** A coil of rope lying on the ground, and an anchor lying on its side: their boxes. */
const ROPE_COIL = { x: 0.7, y: 0.18 };
const ANCHOR = { long: 1.4, y: 0.35, across: 0.9 };

/** The shipyard's deck, where the build goes up: the job site. */
const YARD = rect(-4.4, -6.2, 1.2, -0.8);
const PLATE = { x: -1.6, z: -3.2 };
/** The tavern on the west shore, and its porch, where the harbour master inspects the build. */
const TAVERN = rect(-14, 0.4, -8.6, 4.8);
const PORCH = rect(-8.6, 0.4, -5.6, 4.8);
/** The harbour master's square on the porch: its middle, and its side. */
const INSPECTOR = { x: -7.1, z: 1.65, size: 2.4 };
/** Where the vacuum leans on the tavern's back wall. */
const VACUUM_AT = { x: -12, z: TAVERN.z1 + WALL_T / 2 + VACUUM_FROM_WALL };
/** The yard's two corkboards, along its south side. */
const BOARDS = [
  { x: -2.7, z: -5.6 },
  { x: -0.5, z: -5.6 },
];
/** The captain's hut on the east knoll, over the cove. */
const HUT = rect(8.4, 7.2, 12.4, 10.6);
/** The lookout's platform on top of Skull Hill. */
const LOOKOUT = rect(-7.5, 9.1, -4.9, 11.7);
/** How high the lookout's deck stands over the hill top. */
const LOOKOUT_UP = 2.5;
/** The rope bridge over the cove: along z at `x`, from bank to bank. */
const BRIDGE = { x: 11.6, z0: -1.8, z1: 5, width: 1.3, segments: 8 };
const SPAWN = { x: 1.4, z: -14.6 };
const CATAPULT_AT = { x: -1.4, z: -17.6 };
/** The cannon by the lookout, looking out to sea over the north cliffs, and its size. */
const CANNON_AT = { x: -3.2, z: 12.4 };
const CANNON = { x: 1.1, y: 1, z: 2.2 };
const GATE_Z = -20.2;

/**
 * A slot for one machine of the brick works, round the shipyard: the middle of its back and the
 * way it faces (its front, where its user stands, turned toward the yard).
 */
interface MachineSlot {
  x: number;
  z: number;
  facing: number;
}

const MACHINE_SLOTS: MachineSlot[] = [
  { x: -10.8, z: -3.2, facing: Math.PI / 2 },
  { x: -5.6, z: -11.2, facing: 0 },
  { x: 4, z: -10.4, facing: 0 },
  { x: 7.6, z: -2.6, facing: -Math.PI / 2 },
  { x: -1.2, z: 6.2, facing: Math.PI },
];

/** Room in front of a machine for its user, on its deck. */
const MACHINE_STAND = 1.5;

/** The beached ship: which beach it lies on, its middle, and the way its bow points. */
interface ShipPlan {
  x: number;
  z: number;
  bow: 1 | -1;
  /** Where the castaways' camp is, on the beach the ship is not. */
  camp: { x: number; z: number };
  /**
   * What lies on the beach by it: crates by its stern, a coil of rope, and an anchor if there is
   * sand enough.
   */
  beach: {
    crates: { x: number; z: number };
    coil: { x: number; z: number };
    anchor?: { x: number; z: number };
  };
}

const SHIP_PLANS: ShipPlan[] = [
  {
    x: -13,
    z: -10,
    bow: -1,
    camp: { x: 7.6, z: -8 },
    beach: { crates: { x: -9.1, z: -7.35 }, coil: { x: -11.4, z: -6.4 } },
  },
  {
    x: 11.6,
    z: -8.2,
    bow: 1,
    camp: { x: -9.8, z: -9.4 },
    beach: {
      crates: { x: 7.3, z: -5.6 },
      coil: { x: 8.6, z: -4.7 },
      anchor: { x: 10.5, z: -4 },
    },
  },
];
/**
 * The ship's hull: its length and beam, and how high its deck stands over the highest ground
 * under it.
 */
export const SHIP = { length: 9.6, beam: 3.1, freeboard: 2 };
/** How high the bulwarks round the ship's deck stand. */
const BULWARK = 0.7;
/**
 * What stands on the ship's deck, each along it from its middle toward the bow (`u`) and across
 * it toward the landward side (`v`, north): the mainmast a little aft of the middle and the
 * shorter foremast toward the bow, each its height over the deck; the cannons looking out to
 * sea through their gun ports; and the gap in the landward bulwark where the ladder comes up.
 */
const MAINMAST = { u: -0.5, height: 7.8, thick: 0.32 };
const FOREMAST = { u: 2.9, height: 6, thick: 0.26 };
const GUNS = [1.4, -2.6];
const SHIP_LADDER = -2.2;
/** How far the bow and its bowsprit reach on past the front of the hull's box. */
const BOW_REACH = 3.4;

/**
 * The great rocks, each its box (sunk `BIG_ROCK_SINK` into the ground under its lowest side):
 * two in Skull Hill's steep south face, behind the tavern and under the lookout, two breaking
 * up the cliffs over the north shore either side of the lookout, and one either side of the
 * cove's mouth, standing in the shallows.
 */
const BIG_ROCKS = [
  { x: -10.2, z: 7.6, s: { x: 3, y: 4.8, z: 2.2 } },
  { x: -6.2, z: 6.5, s: { x: 2.8, y: 4.4, z: 2 } },
  { x: -9.6, z: 13.9, s: { x: 3.8, y: 5.6, z: 3 } },
  { x: 0.2, z: 14.2, s: { x: 3.2, y: 5, z: 2.8 } },
  { x: 17.2, z: 4.2, s: { x: 3, y: 4, z: 2.6 } },
  { x: 17.6, z: -1.6, s: { x: 3, y: 4, z: 3 } },
];
const BIG_ROCK_SINK = 0.6;
/**
 * A rock of an outcrop (see `OUTCROPS`): its middle, its width (along x) and depth (along z),
 * and how far its top stands over the highest ground under it (under it, where its back is
 * buried in the hill and the slope runs out onto its top).
 */
export interface OutcropRock {
  x: number;
  z: number;
  w: number;
  d: number;
  up: number;
}

/**
 * The outcrops: rocks heaped over the island's steepest ground, so that from the beaches and
 * the sea its cliffs are piles of big faceted rocks rather than bare earth. Each is sunk
 * `OUTCROP_SINK` under the lowest ground under it, so it shows only its downhill faces and its
 * top; the rocks of a heap run into each other and into the great rocks, as heaped rocks do.
 * They are over Skull Hill's north cliffs between and beside the great rocks there, lower
 * under the cannon so it looks out over them, and round the north-east corner of the knoll the
 * hut stands on, where it drops into the sea. Only where the ground is too steep to walk, or
 * leads nowhere: on the hill's gentler west side and its south face behind the tavern, rocks
 * would stand across the ways up it, and the bare banks of earth are left there. One that
 * would stand where anything else is built is left out.
 */
export const OUTCROPS: OutcropRock[] = [
  // Skull Hill's north cliffs, west of the great rock there.
  { x: -12, z: 14.2, w: 1.4, d: 2.2, up: 0.2 },
  // Between the two great rocks over the north shore, tall and low by turns, and stepping
  // down under the cannon.
  { x: -7.3, z: 14.5, w: 2, d: 2, up: 0.8 },
  { x: -5.65, z: 14.6, w: 2.2, d: 1.6, up: -0.6 },
  { x: -3.55, z: 15, w: 2.1, d: 1.4, up: 0 },
  { x: -1.9, z: 15.3, w: 1.6, d: 1.2, up: -0.6 },
  // Round the knoll the hut stands on: its north-east corner, over the sea.
  { x: 10.55, z: 12.8, w: 1.1, d: 1.4, up: 0 },
  { x: 12, z: 12.75, w: 2.4, d: 1.6, up: 0 },
  { x: 14.65, z: 10.6, w: 1.8, d: 2.4, up: 0.2 },
];
/** How far an outcrop's rock is sunk under the lowest ground under it. */
const OUTCROP_SINK = 0.5;
/**
 * Palms along the shores, and boulders about the hills, the cliffs and the cove. A palm whose
 * spot is taken grows a step or so to one side of it instead (`PALM_STEPS`), where that is
 * clear.
 */
const PALMS = [
  { x: -15.2, z: 8.3 },
  { x: -15.3, z: 10.6 },
  { x: -14.6, z: 12.7 },
  { x: -14.1, z: 14.7 },
  { x: 4.6, z: 16.6 },
  { x: -5.4, z: -13.6 },
  { x: -2.6, z: -13 },
  { x: 4.8, z: -14.6 },
  { x: 7, z: -12.7 },
  { x: 8.2, z: 2.4 },
  { x: 6.2, z: 2.6 },
  { x: 3.8, z: 3.4 },
  { x: 2.6, z: 6.3 },
  { x: 8.3, z: 15 },
  { x: 4.4, z: 10.2 },
  { x: 0.8, z: 10.8 },
];
const PALM_STEPS = [
  [0.7, 0],
  [-0.7, 0],
  [0, 0.7],
  [0, -0.7],
  [1.4, 0],
  [-1.4, 0],
  [0, 1.4],
  [0, -1.4],
];
/**
 * The room a palm takes, in parts of its height: its longest fronds, leaning out with it, reach
 * `crown` of it from its foot and most of them `fronds` of it, drooping to `droop` metres under
 * its top; and its trunk leans out to `lean` of it (and `trunk` metres more for its girth).
 */
const PALM_ROOM = { crown: 0.55, fronds: 0.42, droop: 1.9, lean: 0.15, trunk: 0.3 };

const BOULDERS = [
  { x: -11.6, z: 12.4, s: { x: 2.4, y: 2, z: 2 } },
  { x: -8.2, z: 14.4, s: { x: 2.8, y: 2.2, z: 2.2 } },
  { x: -1.4, z: 15.2, s: { x: 2, y: 1.6, z: 1.8 } },
  { x: 5.2, z: 13.8, s: { x: 1.8, y: 1.4, z: 1.6 } },
  { x: -11.2, z: 7.6, s: { x: 1.8, y: 1.6, z: 1.6 } },
  { x: -2.4, z: 10, s: { x: 2.2, y: 1.8, z: 1.8 } },
  { x: 14.6, z: 5.4, s: { x: 1.6, y: 1.2, z: 1.4 } },
  { x: 16.2, z: -1.4, s: { x: 2, y: 1.6, z: 1.8 } },
  { x: -3.6, z: -15.8, s: { x: 1.4, y: 1, z: 1.2 } },
  { x: 3.4, z: -12.6, s: { x: 1.6, y: 1.2, z: 1.4 } },
  { x: -14.6, z: -4.8, s: { x: 1.8, y: 1.4, z: 1.6 } },
  { x: 6.6, z: 9.8, s: { x: 1.6, y: 1.3, z: 1.5 } },
];
/** Where a treasure chest may lie half buried. */
const CHEST_SLOTS = [
  { x: 2.5, z: 15.7, facing: SOUTH },
  { x: 14.6, z: -0.6, facing: WEST },
  { x: 5.4, z: 6.2, facing: SOUTH },
  { x: -13, z: -3.8, facing: EAST },
  { x: 2.8, z: -6.6, facing: SOUTH },
];

/**
 * Old mooring posts out in the sea along the map's edges, in from the walls nobody sees there:
 * a ragged line of them round it, each a few metres on from the last and wandering nearer the
 * edge or further in, now and then two or three lashed together and now and then one broken
 * off to a stump just over the water. Each is as thick and as tall as a hash of where it stands
 * makes it, its foot down in the sea bed and its top 1.2 to 1.8 m over the sea (a stump's a
 * quarter to half a metre). None stands on land, where the spit runs out to the edge, nor in
 * or close by anything already out in the sea (`clearOf`).
 */
function edgePilings(ground: Pick<LevelDef, 'terrain'>, clearOf: FloorRect[]): BoxDef[] {
  const out: BoxDef[] = [];
  const half = ISLAND_HALF;
  // The walk round the edge, the middle of the way the posts wander between, out from the
  // middle of the map: its corner, and how far round the four sides it is.
  const mid = half - PILING_IN.least - PILING_IN.more / 2 - 0.25;
  const round = 8 * mid;
  /** The point `p` metres round from the south-west corner, and the way out from it. */
  const along = (p: number) => {
    const t = -mid + (p % (2 * mid));
    return [
      { x: t, z: -mid, ox: 0, oz: -1 },
      { x: mid, z: t, ox: 1, oz: 0 },
      { x: -t, z: mid, ox: 0, oz: 1 },
      { x: -mid, z: -t, ox: -1, oz: 0 },
    ][Math.floor(p / (2 * mid)) % 4]!;
  };
  /** The posts placed so far, each with the group it is lashed into. */
  const placed: { x: number; z: number; group: number }[] = [];
  let group = 0;
  for (let p = hash(1, 2, 43) * PILING_EVERY.least; p < round - 1; group++) {
    const i = Math.round(p * 10);
    const { x, z, ox, oz } = along(p);
    // In from the edge as a slow wander round it would have it, and a little either way.
    const wander = noise(p * 0.2, 0.5, 41) + (hash(i, 0, 47) - 0.5) * 0.35;
    const inset = PILING_IN.least + PILING_IN.more * clamp01(wander * 1.4 - 0.2);
    const kind = hash(i, 1, 47);
    // Lashed together: two side by side along the line, or three in a knot.
    const lashed =
      kind < 0.14
        ? [
            [0, 0],
            [1, 0],
          ]
        : kind < 0.22
          ? [
              [0, 0],
              [1, 0],
              [0.5, -0.87],
            ]
          : [[0, 0]];
    const stump = lashed.length === 1 && kind > 0.86;
    for (const [a, b] of lashed) {
      // (Those lashed together a little thinner, to stand side by side.)
      const w =
        (lashed.length > 1 ? 0.36 : 0.4) +
        (lashed.length > 1 ? 0.1 : 0.14) * hash(i, 2 + a!, 31 + Math.round(b! * 10));
      // Out toward the edge as far as its inset has it (its outer face there), a lashed one in
      // from that toward the island; and along the line, the group about its middle, kept as
      // far from the edge round a corner.
      const outward = half - inset - w / 2 + b! * LASHED;
      const sideways = (a! - 0.5 * (lashed.length - 1)) * LASHED;
      const most = half - PILING_IN.least - w / 2;
      const clampTo = (v: number) => Math.max(-most, Math.min(most, v));
      const qx = ox ? ox * outward : clampTo(x + sideways);
      const qz = oz ? oz * outward : clampTo(z + sideways);
      const r = rect(qx - w / 2, qz - w / 2, qx + w / 2, qz + w / 2);
      const under = groundSpan(ground, r);
      if (under.max > SEA - 0.1) continue;
      if (clearOf.some((c) => overlaps(grow(r, 0.5), c))) continue;
      // Clear of every other group's posts by a stride, and its own by a hand's breadth.
      const near = placed.some((o) =>
        o.group === group
          ? Math.hypot(o.x - qx, o.z - qz) < LASHED - 0.01
          : Math.hypot(o.x - qx, o.z - qz) < 1.6,
      );
      if (near) continue;
      const top = stump
        ? SEA + STUMP_TOP.least + STUMP_TOP.more * hash(i, 3, 37)
        : SEA + PILING_TOP.least + PILING_TOP.more * hash(i, 4 + a!, 37 + Math.round(b! * 10));
      const foot = under.min - 0.3;
      out.push(standing(r, top - foot, PILING, foot, { model: 'piling' }));
      placed.push({ x: qx, z: qz, group });
    }
    p += PILING_EVERY.least + PILING_EVERY.more * hash(i, 5, 53);
  }
  return out;
}

/** Whether two rectangles overlap (touching does not count). */
const overlaps = (a: FloorRect, b: FloorRect) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/**
 * The upper storey over a room's walls, which stand on `y0`, its front (and its door's side)
 * looking `front`, and the gable roof `roofH` high on top of it, its eaves out over the jetty.
 */
function upperStorey(r: FloorRect, y0: number, front: BoxDef['front'], roofH: number): BoxDef[] {
  const storey = grow(r, WALL_T / 2 + JETTY);
  const top = y0 + WALL_H + STOREY_H;
  return [
    standing(storey, STOREY_H, PLASTER, y0 + WALL_H, { model: 'storey', front }),
    standing(grow(storey, EAVES), roofH, ROOF, top, { model: 'gableRoof' }),
  ];
}

export function islandLayout(seed: number): LevelDef {
  return firstGoodLayout('island', seed, tryLayout);
}

/** One try at a layout from a seed, before the checks (see `mapProblems`). */
export function tryLayout(seed: number): LevelDef {
  const g = gen(seed);
  const ship = g.pick(SHIP_PLANS);
  const kinds = g.shuffle(['silo', 'press', 'dispenser', 'press', 'printer'] as const);
  const ids = { silo: [2], press: [1, 3], dispenser: [5], printer: [4] };

  // ---- the ground, levelled under what is built on it

  /** A machine on its slot, and the deck under it and in front of it. */
  const machines: MachineDef[] = [];
  const machineDecks: FloorRect[] = [];
  MACHINE_SLOTS.forEach((slot, i) => {
    const kind = kinds[i]!;
    const size = MACHINE_SIZE[kind];
    const out = { x: Math.round(Math.sin(slot.facing)), z: Math.round(Math.cos(slot.facing)) };
    const side = { x: out.z, z: -out.x };
    const c = { x: slot.x + (out.x * size.z) / 2, z: slot.z + (out.z * size.z) / 2 };
    machines.push(machineAt(kind, ids[kind].shift()!, tidy(c.x), tidy(c.z), slot.facing));
    // From a little behind its back to its front and the room to stand there, and a little
    // past its sides.
    const back = { x: slot.x - out.x * 0.25, z: slot.z - out.z * 0.25 };
    const front = {
      x: slot.x + out.x * (size.z + MACHINE_STAND),
      z: slot.z + out.z * (size.z + MACHINE_STAND),
    };
    const w = size.x / 2 + 0.3;
    machineDecks.push(
      rect(
        Math.min(back.x, front.x) - Math.abs(side.x) * w,
        Math.min(back.z, front.z) - Math.abs(side.z) * w,
        Math.max(back.x, front.x) + Math.abs(side.x) * w,
        Math.max(back.z, front.z) + Math.abs(side.z) * w,
      ),
    );
  });
  const hutPad = grow(HUT, WALL_T / 2 + 0.2);
  const tavernPad = rect(TAVERN.x0 - WALL_T / 2 - 0.2, TAVERN.z0 - 0.3, PORCH.x1, TAVERN.z1 + 0.3);
  const catapultPad = rect(
    CATAPULT_AT.x - 0.7,
    CATAPULT_AT.z - 2.5,
    CATAPULT_AT.x + 0.7,
    CATAPULT_AT.z + 1.3,
  );
  // The hill cannon's ground, levelled: the hill is steep there, and on the wild ground its
  // back wheels would be buried.
  const cannonPad = rect(
    CANNON_AT.x - CANNON.x / 2 - 0.05,
    CANNON_AT.z - CANNON.z / 2 - 0.05,
    CANNON_AT.x + CANNON.x / 2 + 0.05,
    CANNON_AT.z + CANNON.z / 2 + 0.05,
  );
  const pads: Pad[] = [
    { r: YARD, y: meanGround(YARD), fall: 2.2 },
    { r: tavernPad, y: meanGround(tavernPad), fall: 2 },
    { r: hutPad, y: meanGround(hutPad), fall: 1.8 },
    { r: catapultPad, y: meanGround(catapultPad), fall: 1.4 },
    { r: cannonPad, y: meanGround(cannonPad), fall: 1.2 },
    ...machineDecks.map((r) => ({ r, y: meanGround(r), fall: 1.6 })),
  ];
  const terrain = islandTerrain(pads);
  const ground = { terrain: [terrain] };
  const G = (x: number, z: number) => groundHeight(ground, x, z);
  /** The lowest the ground gets under a rectangle. */
  const low = (r: FloorRect) => groundSpan(ground, r).min;
  const padY = (r: FloorRect) => pads.find((p) => p.r === r)!.y;

  const boxes: BoxDef[] = [];
  const hideouts: HideoutDef[] = [];
  const pageSpots: Vec3[] = [];
  const lights: Vec3[] = [];
  const windows: WindowDef[] = [];
  const decals: DecalDef[] = [];
  const interiors: InteriorDef[] = [];
  const ladders: LadderDef[] = [];
  const dogPoints: Vec3[] = [];
  /** Ground the scenery (palms, boulders, barrels) keeps off: what is built, and the ways about. */
  const keepOff: FloorRect[] = [];
  let id = 1;
  const next = () => id++;

  /** Decking over a rectangle with its top at `top`. */
  const deck = (r: FloorRect, top: number, t = DECK_T): BoxDef =>
    standing(r, t, PLANK, top - t, { model: 'deck' });
  /** A timber post from below the ground up to `top`. */
  const post = (x: number, z: number, top: number, thick = 0.2): BoxDef => {
    const foot = low(rect(x - thick / 2, z - thick / 2, x + thick / 2, z + thick / 2)) - 0.15;
    return box(x, (foot + top) / 2, z, thick, top - foot, thick, DARK_TIMBER, { model: 'post' });
  };
  /**
   * A ship's lantern on its timber post, standing on the ground, the lantern hung out on its
   * arm toward `front`: over the way it lights, clear of walls, roofs and rails. The post is as
   * tall as it must be to hang the lantern well over the ground under its arm, which may rise
   * ahead of it.
   */
  const lantern = (x: number, z: number, front: NonNullable<BoxDef['front']>): BoxDef => {
    const t = LANTERN_POST.thick;
    const fx = front === '+x' ? 1 : front === '-x' ? -1 : 0;
    const fz = front === '+z' ? 1 : front === '-z' ? -1 : 0;
    const y0 = low(rect(x - t / 2, z - t / 2, x + t / 2, z + t / 2)) - 0.12;
    const under = Math.max(
      ...[0, 0.3, 0.6, LANTERN_POST.reach + 0.1].map((u) => G(x + fx * u, z + fz * u)),
    );
    const h = under + LANTERN_POST.height - y0;
    return box(x, y0 + h / 2, z, t, h, t, DARK_TIMBER, { model: 'lanternPost', front });
  };
  /** A barrel standing on `y0`, or on the ground. */
  const barrel = (x: number, z: number, y0?: number): BoxDef => {
    const foot = y0 ?? low(rect(x - 0.3, z - 0.3, x + 0.3, z + 0.3)) - 0.04;
    return box(x, foot + 0.4, z, 0.6, 0.8, 0.6, BARREL, { model: 'barrel' });
  };
  /** A crate `s` on a side standing on `y0`, or on the ground. */
  const crate = (x: number, z: number, s: number, y0?: number): BoxDef => {
    const foot = y0 ?? low(rect(x - s / 2, z - s / 2, x + s / 2, z + s / 2)) - 0.04;
    return box(x, foot + s / 2, z, s, s, s, CRATE, { model: 'crate' });
  };
  /**
   * A coil of rope lying on `y0`, or on the ground: there a little into it where the ground
   * slopes, rather than lifted off it on its low side.
   */
  const ropeCoil = (x: number, z: number, y0?: number): BoxDef => {
    const { x: w, y: h } = ROPE_COIL;
    const r = rect(x - w / 2, z - w / 2, x + w / 2, z + w / 2);
    const foot = y0 ?? (low(r) + G(x, z)) / 2 - 0.03;
    return box(x, foot + h / 2, z, w, h, w, ROPE, { model: 'ropeCoil' });
  };
  /** An anchor lying on the ground, its shank along the way its crown points (`front`). */
  const anchor = (x: number, z: number, front: NonNullable<BoxDef['front']>): BoxDef => {
    const { long, y: h, across } = ANCHOR;
    const alongX = front === '-x' || front === '+x';
    const [w, d] = alongX ? [long, across] : [across, long];
    const r = rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
    const foot = (low(r) + G(x, z)) / 2 - 0.06;
    return box(x, foot + h / 2, z, w, h, d, RUSTY, { model: 'anchor', front });
  };

  // ---- the edges: walls nobody sees round the map, out in the sea (and across the end of the
  // spit, which runs out to the south one); the old mooring posts in the sea marking where they
  // run go in last, round whatever else is out there. The south one is where rival teams'
  // islands meet: their dividing wall goes unseen too.

  const half = ISLAND_HALF;
  const edgeH = EDGE_TOP - EDGE_FOOT;
  const edgeY = (EDGE_FOOT + EDGE_TOP) / 2;
  const unseen = { model: 'collider' } as const;
  boxes.push(
    box(0, edgeY, -half + 0.15, 2 * half, edgeH, 0.3, DARK_TIMBER, {
      ...unseen,
      role: 'southFence',
    }),
    box(0, edgeY, half - 0.15, 2 * half, edgeH, 0.3, DARK_TIMBER, unseen),
    box(-half + 0.15, edgeY, 0, 0.3, edgeH, 2 * half - 0.6, DARK_TIMBER, unseen),
    box(half - 0.15, edgeY, 0, 0.3, edgeH, 2 * half - 0.6, DARK_TIMBER, unseen),
  );
  const edges = boxes.length;

  // ---- the shipyard: the job site's deck, with the bell, the Done button and the corkboards

  const yardTop = tidy(padY(YARD) + DECK_UP);
  boxes.push(deck(YARD, yardTop));
  keepOff.push(grow(YARD, 1.2));
  const meetingSeats = ring(PLATE.x, PLATE.z, 4.5, 10, 0, 0.3).map((p) => ({
    ...p,
    y: tidy(inRect(YARD, p.x, p.z) ? yardTop : G(p.x, p.z)),
  }));
  // Lanterns at two of its corners, hung out toward the deck.
  boxes.push(
    lantern(YARD.x1 + 0.4, YARD.z1 + 0.4, '-x'),
    lantern(YARD.x0 - 0.4, YARD.z0 - 0.4, '+z'),
  );
  // Stores at the yard's corners: a crate with a barrel by it, and the shipwright's toolbox.
  boxes.push(
    box(YARD.x0 + 0.42, yardTop + 0.35, YARD.z1 - 0.42, 0.7, 0.7, 0.7, CRATE, { model: 'crate' }),
  );
  pageSpots.push({ x: YARD.x0 + 0.42, y: tidy(yardTop + 0.72), z: YARD.z1 - 0.42 });
  boxes.push(barrel(YARD.x0 + 1.35, YARD.z1 - 0.45, yardTop));
  hideouts.push(hideout(next(), 'toolbox', YARD.x1 - 0.5, YARD.z1 - 0.5, SOUTH, yardTop));
  dogPoints.push(...ring(PLATE.x, PLATE.z, 6.2, 12, 0, 0.1));

  // ---- the brick works on their decks round the yard

  for (const r of machineDecks) {
    const top = tidy(padY(r) + DECK_UP);
    boxes.push(deck(r, top));
    keepOff.push(grow(r, 0.8));
  }
  for (const [i, m] of machines.entries()) m.pos.y = tidy(padY(machineDecks[i]!) + DECK_UP);

  // ---- the tavern: the bar with the treat jar, a table, a dresser and a cupboard; on its
  // porch the harbour master inspects the build

  const tavernY = tidy(padY(tavernPad));
  const porchTop = tidy(tavernY + DECK_UP);
  // Its door onto the porch, far enough from the corner for the open doors to fold flat inside.
  const tavernDoor: Gap = { side: 'e', at: 3.5, width: 1.1 };
  boxes.push(
    ...roomWalls(TAVERN, WALL_H, TIMBER, [tavernDoor], { y0: tavernY }),
    ...headersOver(TAVERN, WALL_H, TIMBER, [tavernDoor], DOOR_H, tavernY),
    ...upperStorey(TAVERN, tavernY, '+x', 2.1),
    deck(rect(TAVERN.x1 + WALL_T / 2, PORCH.z0, PORCH.x1, PORCH.z1), porchTop),
  );
  // The porch's roof on posts standing on its outer corners, from the tavern's wall out, tucked
  // in under the upper storey's jetty: boards on bearers, which look as they are from below.
  const porchRoof = tavernY + WALL_H - 0.16;
  for (const z of [PORCH.z0 + 0.15, PORCH.z1 - 0.15])
    boxes.push(
      standing(
        rect(PORCH.x1 - 0.24, z - 0.09, PORCH.x1 - 0.06, z + 0.09),
        porchRoof - porchTop,
        DARK_TIMBER,
        porchTop,
        { model: 'post' },
      ),
    );
  boxes.push(
    standing(
      rect(TAVERN.x1 + WALL_T / 2, PORCH.z0 - 0.1, PORCH.x1 + 0.1, PORCH.z1 + 0.1),
      0.12,
      PORCH_ROOF,
      porchRoof,
      { model: 'deck' },
    ),
  );
  interiors.push(interiorOf(TAVERN, WALL_H, tavernY));
  // The floor between the walls' inner faces, where the doors and the trim are fitted.
  decals.push(floorOf(grow(TAVERN, -WALL_T / 2), FLOORBOARDS, tavernY));
  lights.push({ x: -11.3, y: tidy(tavernY + 2.3), z: 2.6 });
  windows.push(
    { x: -10.4, z: TAVERN.z0, y: tavernY, alongX: true },
    { x: TAVERN.x0, z: 1.6, y: tavernY, alongX: false },
  );
  const bar = box(-11.8, tavernY + 0.45, TAVERN.z1 - 0.45, 2.8, 0.9, 0.6, DARK_TIMBER, {
    model: 'counter',
  });
  boxes.push(bar);
  hideouts.push(drawerIn(next(), bar, -0.8), drawerIn(next(), bar, 0.8));
  const treatJar = { x: -10.7, y: tidy(tavernY + 0.9), z: TAVERN.z1 - 0.45 };
  pageSpots.push({ x: -12.8, y: tidy(tavernY + 0.92), z: TAVERN.z1 - 0.45 });
  boxes.push(box(-10.2, tavernY + 0.375, 2, 1.2, 0.75, 0.8, TIMBER, { model: 'table' }));
  pageSpots.push({ x: -9.9, y: tidy(tavernY + 0.77), z: 2 });
  hideouts.push(hideout(next(), 'cabinet', TAVERN.x0 + 0.35, 3.2, EAST, tavernY));
  // On the porch: a rug before the door (far enough out for its fold to clear the wall), and
  // barrels by it, one with a page on its lid.
  hideouts.push(hideout(next(), 'rug', -7.35, 3.9, EAST, porchTop, { x: 1, y: 0.02, z: 1.4 }));
  boxes.push(
    barrel(PORCH.x1 - 0.6, PORCH.z1 - 0.6, porchTop),
    barrel(PORCH.x1 - 0.6, PORCH.z1 - 1.3, porchTop),
  );
  pageSpots.push({ x: PORCH.x1 - 0.6, y: tidy(porchTop + 0.82), z: PORCH.z1 - 0.6 });
  // A lantern on the way up from the yard, out past the porch's corner.
  boxes.push(lantern(PORCH.x1 + 0.7, PORCH.z0 - 0.7, '-z'));
  keepOff.push(grow(tavernPad, 1));
  dogPoints.push({ x: PORCH.x1 + 1, y: 0, z: 2.6 }, { x: -11, y: 0, z: TAVERN.z0 - 1 });

  // ---- the captain's hut on the east knoll: a bunk, a sea chest and a cupboard

  const hutY = tidy(padY(hutPad));
  // Its door, like the tavern's clear of the corner for its doors to open flat inside.
  const hutDoor: Gap = { side: 's', at: 9.7, width: 1.1 };
  boxes.push(
    ...roomWalls(HUT, WALL_H, TIMBER, [hutDoor], { y0: hutY }),
    ...headersOver(HUT, WALL_H, TIMBER, [hutDoor], DOOR_H, hutY),
    ...upperStorey(HUT, hutY, '-z', 1.8),
  );
  interiors.push(interiorOf(HUT, WALL_H, hutY));
  decals.push(floorOf(grow(HUT, -WALL_T / 2), FLOORBOARDS, hutY));
  lights.push({ x: 10.4, y: tidy(hutY + 2.2), z: 8.9 });
  windows.push({ x: HUT.x0, z: 8.4, y: hutY, alongX: false });
  boxes.push(box(11, hutY + 0.25, HUT.z1 - 0.5, 1.9, 0.5, 0.8, DARK_TIMBER, { model: 'bed' }));
  hideouts.push(
    hideout(next(), 'cushion', 11, HUT.z1 - 0.5, SOUTH, hutY + 0.5, { x: 1.2, y: 0.1, z: 0.6 }),
    hideout(next(), 'cabinet', HUT.x1 - 0.35, 8, WEST, hutY, { x: 1, y: 0.7, z: 0.45 }),
    hideout(next(), 'chest', HUT.x0 + 0.75, 9.6, EAST, hutY),
  );
  boxes.push(box(11.3, hutY + 0.375, 9.3, 0.8, 0.75, 0.6, TIMBER, { model: 'table' }));
  pageSpots.push({ x: 11.3, y: tidy(hutY + 0.77), z: 9.3 });
  // (Its door has the lantern on the wall beside it.)
  boxes.push(barrel(HUT.x1 + 0.55, HUT.z0 + 0.4));
  keepOff.push(grow(hutPad, 1));
  dogPoints.push({ x: 9.4, y: 0, z: HUT.z0 - 1.2 });

  // ---- the lookout on top of Skull Hill: a railed deck on stilts up a ladder, a cannon by it

  const lookC = { x: (LOOKOUT.x0 + LOOKOUT.x1) / 2, z: (LOOKOUT.z0 + LOOKOUT.z1) / 2 };
  const lookTop = tidy(G(lookC.x, lookC.z) + LOOKOUT_UP);
  for (const dx of [-1.05, 1.05])
    for (const dz of [-1.05, 1.05])
      boxes.push(post(lookC.x + dx, lookC.z + dz, lookTop - DECK_T, 0.24));
  boxes.push(deck(LOOKOUT, lookTop));
  const rail = (r: FloorRect) => standing(r, 0.9, DARK_TIMBER, lookTop, { model: 'rail' });
  const t = 0.06;
  boxes.push(
    rail(rect(LOOKOUT.x0, LOOKOUT.z1 - t, LOOKOUT.x1, LOOKOUT.z1)),
    rail(rect(LOOKOUT.x0, LOOKOUT.z0 + t, LOOKOUT.x0 + t, LOOKOUT.z1 - t)),
    rail(rect(LOOKOUT.x1 - t, LOOKOUT.z0 + t, LOOKOUT.x1, LOOKOUT.z1 - t)),
    rail(rect(LOOKOUT.x0, LOOKOUT.z0, lookC.x - 0.75, LOOKOUT.z0 + t)),
    rail(rect(lookC.x + 0.75, LOOKOUT.z0, LOOKOUT.x1, LOOKOUT.z0 + t)),
  );
  // The ladder up its south side, between its bearers.
  const lookFoot = { x: lookC.x, z: LOOKOUT.z0 - 0.35 };
  const lookFootY = tidy(G(lookFoot.x, lookFoot.z));
  for (const dx of [-0.4, 0.4]) boxes.push(post(lookC.x + dx, LOOKOUT.z0 - 0.05, lookTop, 0.1));
  ladders.push({
    pos: { x: lookFoot.x, y: lookFootY, z: lookFoot.z },
    width: 0.8,
    height: tidy(lookTop - lookFootY + LADDER_CLEAR),
    facing: NORTH,
  });
  hideouts.push(hideout(next(), 'chest', LOOKOUT.x1 - 0.55, LOOKOUT.z1 - 0.5, SOUTH, lookTop));
  pageSpots.push({ x: LOOKOUT.x0 + 0.6, y: tidy(lookTop + 0.05), z: LOOKOUT.z1 - 0.6 });
  boxes.push(
    box(LOOKOUT.x0 + 0.2, lookTop + 1.9, LOOKOUT.z1 - 0.2, 0.12, 3.8, 0.12, DARK_TIMBER, {
      model: 'flagpole',
    }),
  );
  boxes.push(
    box(
      CANNON_AT.x,
      tidy(padY(cannonPad) - 0.02 + CANNON.y / 2),
      CANNON_AT.z,
      CANNON.x,
      CANNON.y,
      CANNON.z,
      IRON,
      { model: 'cannon', front: '+z' },
    ),
  );
  keepOff.push(grow(LOOKOUT, 1.6), grow(cannonPad, 0.7));

  // ---- the rope bridge over the cove

  const span = BRIDGE.z1 - BRIDGE.z0;
  const seg = span / BRIDGE.segments;
  const ends = [G(BRIDGE.x, BRIDGE.z0 + seg / 2) + 0.1, G(BRIDGE.x, BRIDGE.z1 - seg / 2) + 0.1];
  let lastTop = ends[0]!;
  const tops: number[] = [];
  for (let i = 0; i < BRIDGE.segments; i++) {
    const u = (i + 0.5) / BRIDGE.segments;
    const z = BRIDGE.z0 + (i + 0.5) * seg;
    const arch = ends[0]! + (ends[1]! - ends[0]!) * u + 0.55 * Math.sin(Math.PI * u);
    const under = groundSpan(
      ground,
      rect(BRIDGE.x - BRIDGE.width / 2, z - seg / 2, BRIDGE.x + BRIDGE.width / 2, z + seg / 2),
    ).max;
    let top = Math.max(arch, under + 0.08);
    top = Math.min(lastTop + 0.22, Math.max(lastTop - 0.22, top));
    tops.push(tidy(top));
    lastTop = top;
  }
  tops.forEach((top, i) => {
    const z0 = BRIDGE.z0 + i * seg;
    boxes.push(
      deck(rect(BRIDGE.x - BRIDGE.width / 2, z0, BRIDGE.x + BRIDGE.width / 2, z0 + seg), top, 0.12),
    );
    for (const s of [-1, 1])
      boxes.push(
        box(
          BRIDGE.x + s * (BRIDGE.width / 2 - 0.06),
          top + 0.45,
          z0 + seg / 2,
          0.12,
          0.9,
          seg,
          ROPE,
          {
            model: 'ropeRail',
          },
        ),
      );
  });
  pageSpots.push({ x: BRIDGE.x, y: tidy(tops[3]! + 0.01), z: BRIDGE.z0 + 3.5 * seg });
  for (const z of [BRIDGE.z0 - 0.15, BRIDGE.z1 + 0.15])
    for (const s of [-1, 1])
      boxes.push(post(BRIDGE.x + s * (BRIDGE.width / 2 + 0.1), z, G(BRIDGE.x, z) + 1.3, 0.16));
  // A lantern at either end, hung out over the way onto it.
  boxes.push(
    lantern(BRIDGE.x - 1.2, BRIDGE.z0 - 0.6, '+x'),
    lantern(BRIDGE.x + 1.2, BRIDGE.z1 + 0.6, '-x'),
  );
  keepOff.push(rect(BRIDGE.x - 1.8, BRIDGE.z0 - 1.6, BRIDGE.x + 1.8, BRIDGE.z1 + 1.6));
  dogPoints.push(
    { x: BRIDGE.x, y: 0, z: BRIDGE.z0 - 1.4 },
    { x: BRIDGE.x, y: 0, z: BRIDGE.z1 + 1.4 },
  );

  // ---- the ship, beached on one of the south shores, up a rope ladder; and on the other the
  // castaways' camp: a fire ring, logs to sit on and a barrel

  const hull = rect(
    ship.x - SHIP.length / 2,
    ship.z - SHIP.beam / 2,
    ship.x + SHIP.length / 2,
    ship.z + SHIP.beam / 2,
  );
  /** A point on the ship, `u` along it toward the bow from its middle and `v` to landward. */
  const onShip = (u: number, v = 0) => ({ x: ship.x + ship.bow * u, z: ship.z + v });
  const under = groundSpan(ground, hull);
  const shipDeck = tidy(Math.max(under.max, SEA) + SHIP.freeboard);
  const keel = under.min - 0.4;
  boxes.push(
    box(
      ship.x,
      (keel + shipDeck) / 2,
      ship.z,
      SHIP.length,
      shipDeck - keel,
      SHIP.beam,
      DARK_TIMBER,
      {
        model: 'hull',
        front: ship.bow > 0 ? '+x' : '-x',
      },
    ),
  );
  // Its masts, from the deck: the mainmast and the foremast, shorter, toward the bow.
  for (const m of [MAINMAST, FOREMAST]) {
    const at = onShip(m.u);
    boxes.push(
      box(at.x, shipDeck + m.height / 2, at.z, m.thick, m.height, m.thick, DARK_TIMBER, {
        model: 'mast',
      }),
    );
  }
  // Its cannons, looking out to sea over the south side through gaps in the bulwark.
  for (const u of GUNS)
    boxes.push(
      box(onShip(u).x, shipDeck + 0.38, hull.z0 + 0.7, 0.8, 0.76, 1.4, IRON, {
        model: 'cannon',
        front: '-z',
      }),
    );
  // Its bow, drawn sweeping out ahead of the hull's box to the stem, stops whoever wades into
  // it across its broad half. (From the keel: on the deck it would be taken for a bulwark.)
  const prow = { length: 0.9, width: SHIP.beam * 0.8 };
  boxes.push(
    box(
      ship.x + ship.bow * (SHIP.length + prow.length) * 0.5,
      (keel + shipDeck + BULWARK) / 2,
      ship.z,
      prow.length,
      shipDeck + BULWARK - keel,
      prow.width,
      DARK_TIMBER,
      { model: 'collider' },
    ),
  );
  // Its bulwarks round the deck, drawn with the hull: cut for the gun ports, and open where
  // the ladder comes up.
  const shipFoot = { x: onShip(SHIP_LADDER).x, z: hull.z1 + 0.35 };
  const bulwark = (x0: number, z0: number, x1: number, z1: number) =>
    standing(rect(x0, z0, x1, z1), BULWARK, DARK_TIMBER, shipDeck, { model: 'collider' });
  const bw = 0.08;
  /** The stretches of a side between gaps half `gap` wide about each of `at` (along x). */
  const between = (at: number[], gap: number): [number, number][] => {
    const cuts = at.sort((a, b) => a - b);
    const out: [number, number][] = [];
    let from = hull.x0;
    for (const c of cuts) {
      out.push([from, c - gap]);
      from = c + gap;
    }
    out.push([from, hull.x1]);
    return out;
  };
  for (const [x0, x1] of between(
    GUNS.map((u) => onShip(u).x),
    0.4,
  ))
    boxes.push(bulwark(x0, hull.z0, x1, hull.z0 + bw));
  for (const [x0, x1] of between([shipFoot.x], 0.75)) {
    // (The ends across the stern and the bow run the length of the sides between them.)
    boxes.push(
      bulwark(Math.max(x0, hull.x0 + bw), hull.z1 - bw, Math.min(x1, hull.x1 - bw), hull.z1),
    );
  }
  boxes.push(
    bulwark(hull.x0, hull.z0 + bw, hull.x0 + bw, hull.z1),
    bulwark(hull.x1 - bw, hull.z0 + bw, hull.x1, hull.z1),
  );
  // On the deck: a sea chest by the landward bulwark between the masts (with room behind it
  // for its lid to swing back), a page by the stern, barrels lashed at the stern's landward
  // corner, a crate and a coil of rope forward.
  const chestAt = onShip(1.2, SHIP.beam / 2 - bw - 0.6);
  hideouts.push(hideout(next(), 'chest', chestAt.x, chestAt.z, SOUTH, shipDeck));
  const pageAt = onShip(-3.9, -0.6);
  pageSpots.push({ x: tidy(pageAt.x), y: tidy(shipDeck + 0.01), z: tidy(pageAt.z) });
  for (const [u, v] of [
    [-4.3, 0.95],
    [-3.65, 1.05],
  ] as const) {
    const at = onShip(u, v);
    boxes.push(barrel(at.x, at.z, shipDeck));
  }
  const crateAt = onShip(3.95, 0.85);
  const coilAt = onShip(3.85, -0.75);
  boxes.push(crate(crateAt.x, crateAt.z, 0.6, shipDeck), ropeCoil(coilAt.x, coilAt.z, shipDeck));
  // The rope ladder up its landward (north) side, a lantern hung out over the foot of it.
  const shipFootY = tidy(G(shipFoot.x, shipFoot.z));
  ladders.push({
    pos: { x: tidy(shipFoot.x), y: shipFootY, z: tidy(shipFoot.z) },
    width: 0.8,
    height: tidy(shipDeck - shipFootY + LADDER_CLEAR),
    facing: SOUTH,
  });
  const lampAt = onShip(SHIP_LADDER + 1.35, SHIP.beam / 2 + 0.9);
  boxes.push(lantern(lampAt.x, lampAt.z, ship.bow > 0 ? '-x' : '+x'));
  // Out ahead of the bow, where the stem and the bowsprit reach.
  const bowReach =
    ship.bow > 0
      ? rect(hull.x1, hull.z0, hull.x1 + BOW_REACH, hull.z1)
      : rect(hull.x0 - BOW_REACH, hull.z0, hull.x0, hull.z1);
  keepOff.push(
    grow(hull, 1.6),
    rect(shipFoot.x - 1.2, shipFoot.z - 0.4, shipFoot.x + 1.2, shipFoot.z + 1.8),
    bowReach,
  );
  const camp = ship.camp;
  for (const [i, s] of ring(camp.x, camp.z, 0.55, 8, 0, 0.2).entries()) {
    const w = 0.26 + ((i * 5) % 3) * 0.03;
    const y0 = low(rect(s.x - w / 2, s.z - w / 2, s.x + w / 2, s.z + w / 2)) - 0.05;
    boxes.push(box(s.x, y0 + 0.11, s.z, w, 0.22, w * 0.9, ROCK, { model: 'rock' }));
  }
  for (const [dx, dz, alongX] of [
    [0, 1.6, true],
    [1.6, -0.4, false],
    [-1.6, -0.4, false],
  ] as const) {
    const lx = camp.x + dx;
    const lz = camp.z + dz;
    const r = alongX
      ? rect(lx - 0.9, lz - 0.2, lx + 0.9, lz + 0.2)
      : rect(lx - 0.2, lz - 0.9, lx + 0.2, lz + 0.9);
    boxes.push(
      standing(r, 0.4, PALM, low(r) - 0.06, { model: 'log', front: alongX ? '-z' : '-x' }),
    );
  }
  boxes.push(barrel(camp.x + 1.4, camp.z + 1.5));
  pageSpots.push({
    x: tidy(camp.x + 1.4),
    y: tidy(low(rect(camp.x + 1.1, camp.z + 1.2, camp.x + 1.7, camp.z + 1.8)) + 0.78),
    z: tidy(camp.z + 1.5),
  });
  keepOff.push(rect(camp.x - 2.4, camp.z - 1.8, camp.x + 2.4, camp.z + 2.6));
  dogPoints.push({ x: camp.x, y: 0, z: camp.z - 1.6 });

  // ---- the gate at the end of the spit, the bottle post beside it, and the catapult

  const gateX = 2.4;
  const gatePost = 0.26;
  const gatePosts = [-gateX, gateX].map((x) => post(x, GATE_Z, G(x, GATE_Z) + 2.6, gatePost));
  const lintel = Math.max(...gatePosts.map((b) => b.pos.y + b.size.y / 2));
  boxes.push(...gatePosts, box(0, lintel + 0.18, GATE_Z, 5.2, 0.36, 0.26, DARK_TIMBER));
  // The stockade: a rope fence from each gate post out into the shallows, so the way on along
  // the spit is through the gate (and, for rival teams, through the gap in their wall).
  for (const s of [-1, 1]) {
    const from = gateX + gatePost / 2;
    const r =
      s < 0
        ? rect(-STOCKADE_TO, GATE_Z - 0.1, -from, GATE_Z + 0.1)
        : rect(from, GATE_Z - 0.1, STOCKADE_TO, GATE_Z + 0.1);
    const under = groundSpan(ground, r);
    const foot = under.min - 0.2;
    boxes.push(standing(r, under.max + 1.15 - foot, ROPE, foot, { model: 'ropeFence' }));
  }
  const bottle = { x: 2.6, z: -18.4 };
  const bottleY = low(rect(bottle.x - 0.05, bottle.z - 0.05, bottle.x + 0.05, bottle.z + 0.05));
  hideouts.push(hideout(next(), 'mailbox', bottle.x, bottle.z, WEST, tidy(bottleY + MAILBOX_POST)));
  boxes.push(
    box(
      bottle.x,
      (bottleY - 0.15 + bottleY + MAILBOX_POST) / 2,
      bottle.z,
      0.08,
      MAILBOX_POST + 0.15,
      0.08,
      DARK_TIMBER,
      { model: 'post' },
    ),
  );
  // A lantern by the way to the gate, hung out toward it, clear of the catapult.
  boxes.push(lantern(-3.2, -18.3, '-z'));
  keepOff.push(
    rect(-3.2, -half, 3.6, -16.6),
    grow(catapultPad, 1),
    rect(SPAWN.x - 2, SPAWN.z - 2, SPAWN.x + 2, SPAWN.z + 2),
  );

  // ---- the outcrops over the steep ground, clear of everything so far

  const rocks: FloorRect[] = [];
  for (const o of OUTCROPS) {
    const r = rect(o.x - o.w / 2, o.z - o.d / 2, o.x + o.w / 2, o.z + o.d / 2);
    if (keepOff.some((k) => overlaps(r, k))) continue;
    const under = groundSpan(ground, r);
    const foot = under.min - OUTCROP_SINK;
    const top = under.max + o.up;
    boxes.push(box(o.x, (foot + top) / 2, o.z, o.w, top - foot, o.d, ROCK, { model: 'boulder' }));
    rocks.push(r);
  }
  keepOff.push(...rocks.map((r) => grow(r, 0.2)));

  // ---- treasure chests half buried about the island

  for (const c of g.shuffle(CHEST_SLOTS).slice(0, 2)) {
    const y0 = low(rect(c.x - 0.45, c.z - 0.45, c.x + 0.45, c.z + 0.45)) - 0.05;
    hideouts.push(hideout(next(), 'chest', c.x, c.z, c.facing, tidy(y0)));
    keepOff.push(rect(c.x - 1.4, c.z - 1.4, c.x + 1.4, c.z + 1.4));
  }

  // ---- the great rocks, then the palms and the boulders kept off everything else

  for (const b of BIG_ROCKS) {
    const r = rect(b.x - b.s.x / 2, b.z - b.s.z / 2, b.x + b.s.x / 2, b.z + b.s.z / 2);
    const foot = low(r) - BIG_ROCK_SINK;
    boxes.push(box(b.x, foot + b.s.y / 2, b.z, b.s.x, b.s.y, b.s.z, ROCK, { model: 'boulder' }));
    keepOff.push(grow(r, 0.4));
  }

  // ---- the clutter of a harbour about the buildings, the yard, the camp and the gate:
  // stacked crates, barrels in twos and threes, coils of rope and an old anchor or two. Each
  // lot goes down only where it is clear of everything standing and of the ground players
  // need: doorways, ladders, page spots, seats, the boards, the inspector's pad, the vacuum,
  // the catapult, the spawn and the ways onto the bridge.

  const footOf = (b: BoxDef) =>
    rect(
      b.pos.x - b.size.x / 2,
      b.pos.z - b.size.z / 2,
      b.pos.x + b.size.x / 2,
      b.pos.z + b.size.z / 2,
    );
  const around = (p: { x: number; z: number }, r: number) =>
    rect(p.x - r, p.z - r, p.x + r, p.z + r);
  /** Whether a box stands on the ground, rather than up over it where things go under it. */
  const grounded = (b: BoxDef) => b.pos.y - b.size.y / 2 < groundSpan(ground, footOf(b)).max + 1.2;
  /**
   * A hiding place, with room round it, and in front of it to open it and get at it (but not
   * behind it, where it may back onto a wall).
   */
  const getAt = (h: HideoutDef) => {
    const out = { x: Math.round(-Math.sin(h.facing)), z: Math.round(-Math.cos(h.facing)) };
    const [hx, hz] = out.x ? [h.size.z / 2, h.size.x / 2] : [h.size.x / 2, h.size.z / 2];
    /** How far it reaches out from its middle toward `x, z`. */
    const room = (x: number, z: number, half: number) =>
      half + (x === out.x && z === out.z ? 1 : x === -out.x && z === -out.z ? 0.05 : 0.3);
    return rect(
      h.pos.x - room(-1, 0, hx),
      h.pos.z - room(0, -1, hz),
      h.pos.x + room(1, 0, hx),
      h.pos.z + room(0, 1, hz),
    );
  };
  /**
   * What stands on the ground, each with its top: a piece of clutter may stand on one (a crate
   * on a deck) but not in it. (Backed onto a wall, or set down by a deck, is fine.)
   */
  const standingThings = boxes
    .slice(edges)
    .filter(grounded)
    .map((b) => ({
      r: grow(footOf(b), b.role === 'wall' || b.model === 'deck' ? 0.05 : 0.25),
      top: b.pos.y + b.size.y / 2,
    }));
  const claimed: FloorRect[] = [
    ...hideouts.map(getAt),
    ...ladders.map((l) => around(l.pos, 1.2)),
    ...pageSpots.map((p) => around(p, 0.6)),
    ...meetingSeats.map((p) => around(p, 0.6)),
    rect(hutDoor.at - 1, HUT.z0 - 2, hutDoor.at + 1, HUT.z0),
    ...BOARDS.map((b) => rect(b.x - 1.15, b.z - 1.5, b.x + 1.15, b.z + 1.5)),
    around(VACUUM_AT, 1.4),
    grow(
      rect(
        INSPECTOR.x - INSPECTOR.size / 2,
        INSPECTOR.z - INSPECTOR.size / 2,
        INSPECTOR.x + INSPECTOR.size / 2,
        INSPECTOR.z + INSPECTOR.size / 2,
      ),
      0.5,
    ),
    around(SPAWN, 2),
    grow(catapultPad, 0.7),
    rect(BRIDGE.x - 1.8, BRIDGE.z0 - 1.6, BRIDGE.x + 1.8, BRIDGE.z1 + 1.6),
  ];
  /** Stands a lot of clutter, every piece of it, if all of it is clear and on dry ground. */
  const lot = (...pieces: BoxDef[]) => {
    const ok = pieces.every((b) => {
      const r = footOf(b);
      const foot = b.pos.y - b.size.y / 2;
      return (
        claimed.every((c) => !overlaps(r, c)) &&
        standingThings.every((t) => t.top < foot + 0.02 || !overlaps(r, t.r)) &&
        groundSpan(ground, r).min > SEA + 0.05
      );
    });
    if (!ok) return;
    boxes.push(...pieces);
    for (const b of pieces) keepOff.push(grow(footOf(b), 0.6));
  };
  /** A crate with a smaller one on top of it, the top one set back a little toward `dx, dz`. */
  const crates = (x: number, z: number, s: number, dx = 0, dz = 0): BoxDef[] => {
    const bottom = crate(x, z, s);
    const top = s * 0.72;
    return [
      bottom,
      crate(x + dx * (s - top) * 0.5, z + dz * (s - top) * 0.5, top, bottom.pos.y + s / 2),
    ];
  };
  // By the tavern: a stack of crates and a barrel at its south-west corner, three barrels
  // along its west wall north of the window, and an old anchor on the beach under the window.
  lot(
    ...crates(TAVERN.x0 - 0.62, TAVERN.z0 - 0.42, 0.75, 1, 1),
    barrel(TAVERN.x0 - 0.55, TAVERN.z0 + 0.48),
  );
  lot(barrel(TAVERN.x0 - 0.5, 3.95), barrel(TAVERN.x0 - 0.5, 4.6), barrel(TAVERN.x0 - 1.12, 4.27));
  lot(anchor(TAVERN.x0 - 1.25, 2.05, '-z'));
  // Off the porch's south edge, a coil of rope.
  lot(ropeCoil(PORCH.x0 + 1, PORCH.z0 - 0.85));
  // A crate in the yard's south-east corner, and barrels off its west side.
  lot(crate(YARD.x1 - 0.26, YARD.z0 + 0.28, 0.5, yardTop));
  lot(barrel(YARD.x0 - 0.55, -3.55), barrel(YARD.x0 - 0.56, -2.9));
  // A crate by the hut's west wall, north of its window.
  lot(crate(HUT.x0 - 0.5, HUT.z1 - 0.45, 0.7));
  /**
   * Whether a palm `h` high with its foot at `x, foot, z` has room for its crown and its leaning
   * trunk: nothing standing in the reach of its fronds at their height, nor near its trunk. (A
   * building's trim and a lantern's arm reach out past their boxes, a ship's bulwarks stand up
   * over its deck, its yards reach out over its sides and its bowsprit and stays out ahead of it;
   * the ships here lie east and west.)
   */
  const palmRoom = (x: number, z: number, foot: number, h: number) => {
    const top = foot + h;
    /** How far off a thing from `lo` to `hi` up must keep: a building beyond any frond. */
    const reach = (lo: number, hi: number, building: boolean) =>
      Math.max(
        hi > top - PALM_ROOM.droop && lo < top + 0.8
          ? (building ? PALM_ROOM.crown : PALM_ROOM.fronds) * h + 0.1
          : 0,
        hi > foot ? PALM_ROOM.lean * h + PALM_ROOM.trunk : 0,
      );
    const gap = (r: FloorRect) =>
      Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
    const building = (b: BoxDef) =>
      b.role === 'wall' || b.model === 'storey' || b.model === 'gableRoof';
    const out = (b: BoxDef) =>
      b.model === 'mast'
        ? { x: 0.3, z: 2.2 }
        : b.model === 'lanternPost'
          ? { x: LANTERN_POST.reach + 0.15, z: LANTERN_POST.reach + 0.15 }
          : building(b) || b.model === 'hull'
            ? { x: 0.3, z: 0.3 }
            : { x: 0, z: 0 };
    const things = [
      ...boxes
        .slice(edges)
        .filter((b) => b.model !== 'palm')
        .map((b) => {
          const r = footOf(b);
          const o = out(b);
          return {
            r: rect(r.x0 - o.x, r.z0 - o.z, r.x1 + o.x, r.z1 + o.z),
            lo: b.pos.y - b.size.y / 2,
            hi: b.pos.y + b.size.y / 2 + (b.model === 'hull' ? 1.2 : 0),
            building: building(b),
          };
        }),
      { r: bowReach, lo: shipDeck - 1, hi: shipDeck + FOREMAST.height, building: false },
      ...machines.map((m) => ({
        r: around(m.pos, Math.max(m.size.x, m.size.z) / 2),
        lo: m.pos.y,
        hi: m.pos.y + m.size.y,
        building: false,
      })),
    ];
    return things.every((t) => gap(t.r) >= reach(t.lo, t.hi, t.building));
  };
  // At the castaways' camp, what they saved from the wreck: a crate by the logs and a coil of
  // rope behind them; and a palm leaning over it all.
  lot(crate(camp.x - 1.75, camp.z + 1.6, 0.7), ropeCoil(camp.x + 0.1, camp.z + 2.55));
  {
    const [x, z, h] = [camp.x + 1.9, camp.z + 3.3, 5.6];
    const foot = low(rect(x - 0.18, z - 0.18, x + 0.18, z + 0.18)) - 0.2;
    if (palmRoom(x, z, foot, h))
      lot(box(x, foot + h / 2, z, 0.36, h, 0.36, PALM, { model: 'palm' }));
  }
  // On the beach by the ship: crates and a barrel by its stern, a coil of rope, an anchor.
  {
    const { crates: c, coil, anchor: a } = ship.beach;
    lot(...crates(c.x, c.z, 0.7, ship.bow, -1), barrel(c.x - ship.bow * 0.75, c.z + 0.15));
    lot(ropeCoil(coil.x, coil.z));
    if (a) lot(anchor(a.x, a.z, ship.bow > 0 ? '+x' : '-x'));
  }
  // At the gate: crates against the stockade inside it, east of the way, and a barrel to the
  // west of it under the lantern.
  lot(...crates(3.4, GATE_Z + 0.75, 0.7, -1, 1));
  lot(barrel(-3.15, GATE_Z + 0.7));

  const clear = (r: FloorRect) =>
    keepOff.every((k) => k.x1 <= r.x0 || k.x0 >= r.x1 || k.z1 <= r.z0 || k.z0 >= r.z1);
  for (const b of BOULDERS) {
    const x = b.x + g.range(-0.3, 0.3);
    const z = b.z + g.range(-0.3, 0.3);
    const r = rect(x - b.s.x / 2, z - b.s.z / 2, x + b.s.x / 2, z + b.s.z / 2);
    if (!clear(grow(r, 0.4))) continue;
    const foot = low(r) - b.s.y * 0.25;
    boxes.push(box(x, foot + b.s.y / 2, z, b.s.x, b.s.y, b.s.z, ROCK, { model: 'boulder' }));
    keepOff.push(grow(r, 0.6));
  }
  for (const p of PALMS)
    for (const [dx, dz] of [[0, 0], ...g.shuffle(PALM_STEPS)]) {
      const x = p.x + dx! + g.range(-0.35, 0.35);
      const z = p.z + dz! + g.range(-0.35, 0.35);
      const r = rect(x - 0.2, z - 0.2, x + 0.2, z + 0.2);
      // On dry sand or grass, or at the very edge of the water, with room for its crown: a
      // short one, if a tall one has none.
      const foot = low(r) - 0.2;
      const h = [g.range(4.6, 6.2), 4.6].find((t) => palmRoom(x, z, foot, t));
      if (!clear(grow(r, 0.5)) || G(x, z) < SEA - 0.1 || h === undefined) continue;
      boxes.push(box(x, foot + h / 2, z, 0.36, h, 0.36, PALM, { model: 'palm' }));
      keepOff.push(grow(r, 0.8));
      break;
    }

  // ---- and last the mooring posts out in the sea, round what stands there already.

  boxes.push(...edgePilings(ground, [...boxes.slice(edges).map(footOf), bowReach]));

  const level: LevelDef = {
    floorSize: 2 * half,
    groundColour: GRASS,
    groundSurface: 'grass',
    terrain: [terrain],
    sea: SEA,
    boxes,
    decals,
    machines,
    baseplate: { x: PLATE.x - 0.8, y: yardTop, z: PLATE.z - 0.8 },
    inspector: {
      pos: { x: INSPECTOR.x, y: porchTop, z: INSPECTOR.z },
      size: { x: INSPECTOR.size, z: INSPECTOR.size },
    },
    doneButton: { x: PLATE.x - 1.8, y: yardTop, z: PLATE.z + 1.4 },
    bell: { x: PLATE.x + 1.8, y: yardTop, z: PLATE.z + 1.4 },
    board: { pos: { x: BOARDS[0]!.x, y: tidy(yardTop + 1.3), z: BOARDS[0]!.z }, facing: 0 },
    moreBoards: [{ pos: { x: BOARDS[1]!.x, y: tidy(yardTop + 1.3), z: BOARDS[1]!.z }, facing: 0 }],
    pageSpots,
    hideouts,
    ladders,
    meetingSeats,
    lights,
    interiors,
    windows,
    spawn: { x: SPAWN.x, y: tidy(G(SPAWN.x, SPAWN.z) + 1), z: SPAWN.z },
    dog: { points: [], links: [], start: 0, treatJar },
    // The vacuum leans on the tavern's back wall.
    vacuum: {
      pos: { x: VACUUM_AT.x, y: tavernY, z: VACUUM_AT.z },
      facing: NORTH,
    },
    catapult: {
      pos: { x: CATAPULT_AT.x, y: tidy(padY(catapultPad)), z: CATAPULT_AT.z },
      facing: NORTH,
    },
  };
  // Room for every page of the longest manual.
  addGroundPageSpots(level);
  // The dog's walks: over the island on a grid, with rings round the yard and points by the
  // doors, the bridge and the camp. It lives by the tavern.
  level.dog = dogNetwork(
    level,
    [...gridPoints(rect(-16, -20, 18, 16), 2.2), ...dogPoints],
    { x: -5, y: 0, z: 1.2 },
    treatJar,
    // Short walks, from one point to the next over the hills, rather than long ones across.
    3.6,
  );
  // Barrels for bricks nobody needs, about the island and in the buildings.
  standTrashBins(level, {
    outdoor: { model: 'barrelBin', colours: [0x9a6436, 0x7e4f2a, 0xa8743f] },
    indoor: { model: 'barrelBin', colours: [0x8a5a32, 0x6e4526] },
  });
  return level;
}
