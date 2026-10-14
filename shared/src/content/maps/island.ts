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

/** The ground's height averaged over a rectangle, to the centimetre: a pad's natural level. */
export function meanGround(r: FloorRect): number {
  let sum = 0;
  let n = 0;
  for (let x = r.x0; x <= r.x1 + 1e-9; x += 0.25)
    for (let z = r.z0; z <= r.z1 + 1e-9; z += 0.25) {
      sum += wildGround(x, z);
      n++;
    }
  return Math.round((sum / n) * 100) / 100;
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
const IRON = 0x34373c;
const BARREL = 0x9a6436;
const CRATE = 0xb5844e;
const PALM = 0x8a6a45;
const LAMP = 0x2f3336;

/** How thick a deck is, and how far its top stands over the levelled ground it is laid on. */
const DECK_T = 0.2;
const DECK_UP = 0.15;
/** The tavern's and the hut's walls. */
const WALL_H = 2.6;
/** How far the edge fences reach down, past the deepest of the sea round the island. */
const FENCE_FOOT = -1.25;
const FENCE_TOP = 1.4;

/** The shipyard's deck, where the build goes up: the job site. */
const YARD = rect(-4.4, -6.2, 1.2, -0.8);
const PLATE = { x: -1.6, z: -3.2 };
/** The tavern on the west shore, and its porch, where the harbour master inspects the build. */
const TAVERN = rect(-14, 0.4, -8.6, 4.8);
const PORCH = rect(-8.6, 0.4, -5.6, 4.8);
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
}

const SHIP_PLANS: ShipPlan[] = [
  { x: -11.8, z: -9.8, bow: -1, camp: { x: 7.6, z: -8 } },
  { x: 9.4, z: -8.2, bow: 1, camp: { x: -9.8, z: -9.4 } },
];
const SHIP = { length: 7.2, beam: 2.4 };

/** Palms along the shores, and boulders about the hills, the cliffs and the cove. */
const PALMS = [
  { x: -14.6, z: -2.4 },
  { x: -15, z: 6.4 },
  { x: -12.8, z: -6.9 },
  { x: -7.2, z: -12.2 },
  { x: -2.6, z: -13 },
  { x: 2.7, z: -17 },
  { x: 6.3, z: -11.6 },
  { x: 11.8, z: -5.4 },
  { x: 14.2, z: -2.6 },
  { x: 8.2, z: 2.4 },
  { x: 15.6, z: 5.8 },
  { x: 4, z: 12.8 },
  { x: 14, z: 10 },
  { x: 3.8, z: 3.4 },
  { x: -6.8, z: 6.4 },
  { x: -10.4, z: -12.4 },
];
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
  { x: -9, z: 7.2, facing: SOUTH },
  { x: 14.6, z: -0.6, facing: WEST },
  { x: 5.4, z: 6.2, facing: SOUTH },
  { x: -13, z: -3.8, facing: EAST },
  { x: 2.8, z: -6.6, facing: SOUTH },
];

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
  const pads: Pad[] = [
    { r: YARD, y: meanGround(YARD), fall: 2.2 },
    { r: tavernPad, y: meanGround(tavernPad), fall: 2 },
    { r: hutPad, y: meanGround(hutPad), fall: 1.8 },
    { r: catapultPad, y: meanGround(catapultPad), fall: 1.4 },
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
  /** A lantern on its post, standing on the ground. */
  const lantern = (x: number, z: number, h = 2.4): BoxDef => {
    const y0 = low(rect(x - 0.15, z - 0.15, x + 0.15, z + 0.15)) - 0.05;
    return box(x, y0 + h / 2, z, 0.3, h, 0.3, LAMP, { model: 'lampPost' });
  };
  /** A barrel standing on `y0`, or on the ground. */
  const barrel = (x: number, z: number, y0?: number): BoxDef => {
    const foot = y0 ?? low(rect(x - 0.3, z - 0.3, x + 0.3, z + 0.3)) - 0.04;
    return box(x, foot + 0.4, z, 0.6, 0.8, 0.6, BARREL, { model: 'barrel' });
  };

  // ---- the edges: a fence of posts and rope out in the shallows all round

  const half = ISLAND_HALF;
  const fenceH = FENCE_TOP - FENCE_FOOT;
  const fenceY = (FENCE_FOOT + FENCE_TOP) / 2;
  boxes.push(
    box(0, fenceY, -half + 0.15, 2 * half, fenceH, 0.3, ROPE, {
      model: 'ropeFence',
      role: 'southFence',
    }),
    box(0, fenceY, half - 0.15, 2 * half, fenceH, 0.3, ROPE, { model: 'ropeFence' }),
    box(-half + 0.15, fenceY, 0, 0.3, fenceH, 2 * half - 0.6, ROPE, { model: 'ropeFence' }),
    box(half - 0.15, fenceY, 0, 0.3, fenceH, 2 * half - 0.6, ROPE, { model: 'ropeFence' }),
  );

  // ---- the shipyard: the job site's deck, with the bell, the Done button and the corkboards

  const yardTop = tidy(padY(YARD) + DECK_UP);
  boxes.push(deck(YARD, yardTop));
  keepOff.push(grow(YARD, 1.2));
  const meetingSeats = ring(PLATE.x, PLATE.z, 4.5, 10, 0, 0.3).map((p) => ({
    ...p,
    y: tidy(inRect(YARD, p.x, p.z) ? yardTop : G(p.x, p.z)),
  }));
  boxes.push(lantern(YARD.x1 + 0.4, YARD.z1 + 0.4), lantern(YARD.x0 - 0.4, YARD.z0 - 0.4));
  // Stores at the yard's corners: a crate with a barrel by it, and the shipwright's toolbox.
  boxes.push(
    box(YARD.x0 + 0.5, yardTop + 0.35, YARD.z1 - 0.5, 0.7, 0.7, 0.7, CRATE, { model: 'crate' }),
  );
  pageSpots.push({ x: YARD.x0 + 0.5, y: tidy(yardTop + 0.72), z: YARD.z1 - 0.5 });
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
  boxes.push(
    ...roomWalls(TAVERN, WALL_H, TIMBER, [{ side: 'e', at: 4, width: 1.1 }], { y0: tavernY }),
    standing(grow(TAVERN, 0.45), 1.5, ROOF, tavernY + WALL_H, { model: 'gableRoof' }),
    deck(rect(TAVERN.x1 + WALL_T / 2, PORCH.z0, PORCH.x1, PORCH.z1), porchTop),
  );
  // The porch's roof on posts standing on its outer corners, out from under the tavern's eaves.
  for (const z of [PORCH.z0 + 0.15, PORCH.z1 - 0.15])
    boxes.push(
      standing(
        rect(PORCH.x1 - 0.24, z - 0.09, PORCH.x1 - 0.06, z + 0.09),
        tavernY + WALL_H - porchTop,
        DARK_TIMBER,
        porchTop,
        { model: 'post' },
      ),
    );
  boxes.push(
    standing(
      rect(TAVERN.x1 + 0.45, PORCH.z0 - 0.1, PORCH.x1 + 0.1, PORCH.z1 + 0.1),
      0.12,
      ROOF,
      tavernY + WALL_H,
    ),
  );
  interiors.push(interiorOf(TAVERN, WALL_H, tavernY));
  decals.push(floorOf(TAVERN, FLOORBOARDS, tavernY));
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
  // On the porch: a rug before the door, and barrels by it, one with a page on its lid.
  hideouts.push(hideout(next(), 'rug', -7.6, 3.9, EAST, porchTop, { x: 1, y: 0.02, z: 1.4 }));
  boxes.push(
    barrel(PORCH.x1 - 0.6, PORCH.z1 - 0.6, porchTop),
    barrel(PORCH.x1 - 0.6, PORCH.z1 - 1.3, porchTop),
  );
  pageSpots.push({ x: PORCH.x1 - 0.6, y: tidy(porchTop + 0.82), z: PORCH.z1 - 0.6 });
  boxes.push(lantern(PORCH.x1 + 0.5, PORCH.z0 - 0.3));
  keepOff.push(grow(tavernPad, 1));
  dogPoints.push({ x: PORCH.x1 + 1, y: 0, z: 2.6 }, { x: -11, y: 0, z: TAVERN.z0 - 1 });

  // ---- the captain's hut on the east knoll: a bunk, a sea chest and a cupboard

  const hutY = tidy(padY(hutPad));
  boxes.push(
    ...roomWalls(HUT, WALL_H, TIMBER, [{ side: 's', at: 9.4, width: 1.1 }], { y0: hutY }),
    standing(grow(HUT, 0.4), 1.3, ROOF, hutY + WALL_H, { model: 'gableRoof' }),
  );
  interiors.push(interiorOf(HUT, WALL_H, hutY));
  decals.push(floorOf(HUT, FLOORBOARDS, hutY));
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
  boxes.push(barrel(HUT.x1 + 0.55, HUT.z0 + 0.4), lantern(8.8, HUT.z0 - 0.6));
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
  const cannonAt = { x: -3.2, z: 12.4 };
  boxes.push(
    box(
      cannonAt.x,
      low(rect(cannonAt.x - 0.45, cannonAt.z - 0.9, cannonAt.x + 0.45, cannonAt.z + 0.9)) + 0.38,
      cannonAt.z,
      0.9,
      0.8,
      1.8,
      IRON,
      {
        model: 'cannon',
        front: '+z',
      },
    ),
  );
  keepOff.push(
    grow(LOOKOUT, 1.6),
    rect(cannonAt.x - 1.2, cannonAt.z - 1.6, cannonAt.x + 1.2, cannonAt.z + 1.6),
  );

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
          BRIDGE.x + s * (BRIDGE.width / 2 - 0.03),
          top + 0.45,
          z0 + seg / 2,
          0.06,
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
  boxes.push(lantern(BRIDGE.x - 1.2, BRIDGE.z0 - 0.6), lantern(BRIDGE.x + 1.2, BRIDGE.z1 + 0.6));
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
  const span3 = groundSpan(ground, hull);
  // Where the deck's cannon looks out over the south side, through a gap in the bulwark.
  const gunport = ship.x + ship.bow * 2.3;
  const shipDeck = tidy(Math.max(span3.max, 0) + 1.7);
  const keel = span3.min - 0.4;
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
    box(ship.x - ship.bow * 0.4, shipDeck + 3.2, ship.z, 0.28, 6.4, 0.28, DARK_TIMBER, {
      model: 'mast',
    }),
    box(gunport, shipDeck + 0.38, hull.z0 + 0.7, 0.8, 0.76, 1.4, IRON, {
      model: 'cannon',
      front: '-z',
    }),
    barrel(ship.x - ship.bow * 2.6, ship.z + 0.5, shipDeck),
  );
  // Its bulwarks round the deck, drawn with the hull, open where the ladder comes up.
  const shipFoot = { x: ship.x - ship.bow * 1.4, z: hull.z1 + 0.35 };
  const bulwark = (r: FloorRect) => standing(r, 0.7, DARK_TIMBER, shipDeck, { model: 'collider' });
  const bw = 0.08;
  boxes.push(
    bulwark(rect(hull.x0, hull.z0, gunport - 0.4, hull.z0 + bw)),
    bulwark(rect(gunport + 0.4, hull.z0, hull.x1, hull.z0 + bw)),
    bulwark(rect(hull.x0, hull.z0 + bw, hull.x0 + bw, hull.z1)),
    bulwark(rect(hull.x1 - bw, hull.z0 + bw, hull.x1, hull.z1)),
    bulwark(rect(hull.x0 + bw, hull.z1 - bw, shipFoot.x - 0.75, hull.z1)),
    bulwark(rect(shipFoot.x + 0.75, hull.z1 - bw, hull.x1 - bw, hull.z1)),
  );
  hideouts.push(hideout(next(), 'chest', ship.x + ship.bow * 1.2, ship.z + 0.55, NORTH, shipDeck));
  pageSpots.push({ x: tidy(ship.x - ship.bow * 1.6), y: tidy(shipDeck + 0.01), z: ship.z - 0.4 });
  // The rope ladder up its landward (north) side.
  const shipFootY = tidy(G(shipFoot.x, shipFoot.z));
  ladders.push({
    pos: { x: tidy(shipFoot.x), y: shipFootY, z: tidy(shipFoot.z) },
    width: 0.8,
    height: tidy(shipDeck - shipFootY + LADDER_CLEAR),
    facing: SOUTH,
  });
  keepOff.push(
    grow(hull, 1.6),
    rect(shipFoot.x - 1.2, shipFoot.z - 0.4, shipFoot.x + 1.2, shipFoot.z + 1.8),
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

  const gatePosts = [-2.4, 2.4].map((x) => post(x, GATE_Z, G(x, GATE_Z) + 2.6, 0.26));
  const lintel = Math.max(...gatePosts.map((b) => b.pos.y + b.size.y / 2));
  boxes.push(...gatePosts, box(0, lintel + 0.18, GATE_Z, 5.2, 0.36, 0.26, DARK_TIMBER));
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
  boxes.push(lantern(-2.3, -18.2));
  keepOff.push(
    rect(-3.2, -half, 3.6, -16.6),
    grow(catapultPad, 1),
    rect(SPAWN.x - 2, SPAWN.z - 2, SPAWN.x + 2, SPAWN.z + 2),
  );

  // ---- treasure chests half buried about the island

  for (const c of g.shuffle(CHEST_SLOTS).slice(0, 2)) {
    const y0 = low(rect(c.x - 0.45, c.z - 0.45, c.x + 0.45, c.z + 0.45)) - 0.05;
    hideouts.push(hideout(next(), 'chest', c.x, c.z, c.facing, tidy(y0)));
    keepOff.push(rect(c.x - 1.4, c.z - 1.4, c.x + 1.4, c.z + 1.4));
  }

  // ---- the palms and the boulders, kept off everything else

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
  for (const p of PALMS) {
    const x = p.x + g.range(-0.35, 0.35);
    const z = p.z + g.range(-0.35, 0.35);
    const r = rect(x - 0.2, z - 0.2, x + 0.2, z + 0.2);
    if (!clear(grow(r, 0.5)) || G(x, z) < SEA - 0.2) continue;
    const h = g.range(4.6, 6.2);
    const foot = low(r) - 0.2;
    boxes.push(box(x, foot + h / 2, z, 0.36, h, 0.36, PALM, { model: 'palm' }));
    keepOff.push(grow(r, 0.8));
  }

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
    inspector: { pos: { x: -7.1, y: porchTop, z: 1.65 }, size: { x: 2.4, z: 2.4 } },
    doneButton: { x: PLATE.x - 1.8, y: yardTop, z: PLATE.z + 1.4 },
    bell: { x: PLATE.x + 1.8, y: yardTop, z: PLATE.z + 1.4 },
    board: { pos: { x: -2.7, y: tidy(yardTop + 1.3), z: -5.6 }, facing: 0 },
    moreBoards: [{ pos: { x: -0.5, y: tidy(yardTop + 1.3), z: -5.6 }, facing: 0 }],
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
      pos: { x: -12, y: tavernY, z: TAVERN.z1 + WALL_T / 2 + VACUUM_FROM_WALL },
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
