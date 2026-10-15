import * as THREE from 'three';
import { groundHeight } from '@sar/shared';
import type { LevelDef } from '@sar/shared';
import type { AssetName, PirateAssets } from './assets.ts';
import { SHIP, SPAWN, islandLevel } from './ground.ts';
import { Solids } from './walk.ts';

/**
 * The pirate test map laid out: the island's ground and sea, the galleon in its cove with a rope
 * bridge up to its deck, the tavern with a rope bridge up to its balcony, the shop, the cliffs
 * behind, palms, bushes, the cannon, barrels and the rest, placed to match the reference
 * picture as seen from the sea to the south (see `REFERENCE_VIEW`).
 *
 * The models are the Blender assets (see `assets.ts`). What players bump into and stand on is
 * laid out here by hand, so it is there without them too (the tests have no models).
 */

export interface IslandMap {
  /** Everything that stands still, to be drawn (the ground and sea are added by the page). */
  root: THREE.Group;
  /** What players bump into and stand on. */
  solids: Solids;
  /** The map as a level: its ground and sea, for the game's terrain and water. */
  level: LevelDef;
  ground: (x: number, z: number) => number;
  spawn: { x: number; z: number };
  /**
   * Places to walk between, in the world: the gangway's ends, the tavern's bridge and balcony,
   * and the tavern's middle.
   */
  marks: Record<
    'gangwayFoot' | 'gangwayTop' | 'stairFoot' | 'landing' | 'balcony' | 'tavern',
    THREE.Vector3
  >;
  /** A walk along the galleon's deck from where the gangway comes aboard. */
  deckWalk: THREE.Vector3[];
}

/** Where the camera stands to see the island as the reference picture does, and what it looks at. */
export const REFERENCE_VIEW = {
  position: new THREE.Vector3(-0.4, 1.0, 24.5),
  target: new THREE.Vector3(0.8, 8.4, -2),
  fov: 46,
};

/** How much bigger than modelled each building is drawn, to stand as tall as the picture's. */
const SHIP_SCALE = 1.8;
const TAVERN_SCALE = 1.7;
const SHOP_SCALE = 1.35;
/** How deep the galleon sits in the water. */
const DRAFT = 1.6;

/** The galleon, as modelled: its waist's deck, the gangway's place on it, its rails. */
const DECK = { top: 2.12, x0: -3.9, x1: 1.7, half: 1.3, rail: 1.55, railTop: 0.72 };
const ENTRY = { x: -3.1, gap: 0.8 };
/** The tavern, as modelled: its walls, and the balcony on its +x side. */
const TAVERN = { half: 1.85, height: 7.5, balcony: { x0: 1.7, x1: 2.7, half: 1.3, top: 2.83 } };

/** A frame at (`x`, `y`, `z`) turned `yaw`, for laying out solids in an asset's own space. */
function frame(parent: THREE.Object3D, x: number, y: number, z: number, yaw: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  parent.add(g);
  g.updateMatrixWorld(true);
  return g;
}

export function buildIsland(assets: PirateAssets | null = null): IslandMap {
  const level = islandLevel();
  const ground = (x: number, z: number) => groundHeight(level, x, z);
  const at = (x: number, z: number, sink = 0) => ground(x, z) - sink;
  const root = new THREE.Group();
  root.name = 'pirate-island';
  const solids = new Solids();
  // A model, if the models are loaded.
  const put = (name: AssetName, x: number, y: number, z: number, yaw = 0, scale = 1) =>
    assets?.place(root, name, x, y, z, yaw, scale) ?? null;

  // The galleon in the cove, its bow toward the beach on the left.
  const k = SHIP_SCALE;
  const ship = frame(root, SHIP.x, -DRAFT, SHIP.z, SHIP.yaw);
  put('PirateShip', SHIP.x, -DRAFT, SHIP.z, SHIP.yaw, k);
  const deck = DECK.top * k;
  const waist = (DECK.x1 - DECK.x0) * k;
  const mid = ((DECK.x0 + DECK.x1) / 2) * k;
  solids.box(ship, mid, 0, 0, waist, deck, DECK.half * 2 * k);
  // Its rails, with a gap where the gangway comes aboard; the raised bow and stern at its ends.
  const rail = (x0: number, x1: number, side: number) =>
    solids.box(
      ship,
      ((x0 + x1) / 2) * k,
      deck,
      side * DECK.rail * k,
      (x1 - x0) * k,
      DECK.railTop * k,
      0.2,
    );
  rail(DECK.x0, DECK.x1, -1);
  rail(DECK.x0, ENTRY.x - ENTRY.gap / 2, 1);
  rail(ENTRY.x + ENTRY.gap / 2, DECK.x1, 1);
  for (const x of [DECK.x0 - 0.15, DECK.x1 + 0.15])
    solids.box(ship, x * k, 0, 0, 0.3 * k, deck + 1.2 * k, DECK.rail * 2 * k);

  // The gangway: a rope bridge from the beach up to the gap in the rail.
  const entry = ship.localToWorld(new THREE.Vector3(ENTRY.x * k, deck + 0.02, DECK.half * k));
  const foot = new THREE.Vector3(-9.6, 0, 0.6);
  foot.y = at(foot.x, foot.z) + 0.04;
  const gangway = bridge(root, solids, assets, foot, entry, 1.1);

  // The tavern, and the rope bridge up to its balcony.
  const tx = 1.6;
  const tz = -0.5;
  const tyaw = 0.3;
  const t = TAVERN_SCALE;
  const ty = at(tx, tz, 0.05);
  const tavern = frame(root, tx, ty, tz, tyaw);
  put('Tavern', tx, ty, tz, tyaw, t);
  solids.box(tavern, 0, 0, 0, TAVERN.half * 2 * t, TAVERN.height * t, TAVERN.half * 2 * t);
  const b = TAVERN.balcony;
  const top = b.top * t;
  const bx = ((b.x0 + b.x1) / 2) * t;
  solids.box(tavern, bx, 0, 0, (b.x1 - b.x0) * t, top, b.half * 2 * t);
  const landing = tavern.localToWorld(new THREE.Vector3(bx, top + 0.02, (b.half - 0.3) * t));
  const balcony = tavern.localToWorld(new THREE.Vector3(bx, top + 0.02, -(b.half - 0.4) * t));
  const stairTop = tavern.localToWorld(new THREE.Vector3(bx, top + 0.02, b.half * t));
  const stairFoot = tavern.localToWorld(new THREE.Vector3(bx, 0, b.half * t + 6.2));
  stairFoot.y = at(stairFoot.x, stairFoot.z) + 0.04;
  bridge(root, solids, assets, stairFoot, stairTop, 1.0);

  // The shop.
  const sx = 12.2;
  const sz = 1.4;
  const syaw = -0.32;
  const sy = at(sx, sz, 0.05);
  put('Shack', sx, sy, sz, syaw, SHOP_SCALE);
  solids.box(frame(root, sx, sy, sz, syaw), 0, 0, 0, 3.4 * SHOP_SCALE, 5, 3.4 * SHOP_SCALE);

  // The great cliffs at the back, and the boulders and rocks about the beach.
  for (const [name, x, z, yaw, scale, w, d, h] of [
    ['CliffRocks', 12.5, -13.5, 0.2, 3.2, 18, 14, 18],
    ['CliffRocks', 18.5, -5.5, -2.3, 2.0, 12, 9, 11],
    ['CliffRocks', 5.5, -10.5, 2.9, 1.6, 9, 7, 9],
    ['Boulder', 20.5, 1.5, 0.3, 2.6, 3.4, 3, 3.6],
    ['Boulder', -14.2, -0.4, 0.8, 2.6, 3.4, 3, 3.6],
    ['Boulder', -14.6, 4.2, 2.2, 2.0, 2.6, 2.2, 2.8],
    ['Boulder', -6.4, 5.2, 0.5, 1.4, 1.8, 1.6, 2],
    ['Rock', -5.0, 9.6, -0.3, 2.6, 1.6, 1.6, 1],
    ['Rock', -10.0, 9.0, 0.9, 2.6, 1.6, 1.6, 1],
    ['Rock', 4.6, 11.0, 0.1, 2.0, 1.2, 1.2, 0.8],
    ['Boulder', 15.6, 8.6, 1.1, 1.3, 1.6, 1.4, 1.8],
    ['Rock', 11.6, 9.4, 0.4, 2.0, 1.2, 1.2, 0.8],
  ] as const) {
    const y = at(x, z, 0.15);
    put(name, x, y, z, yaw, scale);
    solids.box(frame(root, x, y, z, yaw), 0, 0, 0, w * 0.7, h, d * 0.7);
  }

  // Palms.
  for (const [x, z, yaw, scale] of [
    [-11.6, 7.4, 0.6, 1.2],
    [-7.4, 6.6, 2.4, 1.4],
    [-2.6, 4.4, 2.6, 1.9],
    [8.0, 0.6, 1.7, 2.1],
    [17.6, 5.4, -1.4, 1.4],
    [-6.0, 1.2, 0.5, 1.6],
    [15.0, -1.5, 0.3, 2.0],
  ] as const) {
    const y = at(x, z, 0.1);
    put('PalmTree', x, y, z, yaw, scale);
    solids.post(root, x, z, 0.25 * scale, y, y + 3);
  }

  // Bushes, and the red ones on the beach.
  for (const [x, z, s] of [
    [-8.6, 8.4, 1.8],
    [-3.8, 9.4, 1.6],
    [3.0, 9.4, 1.5],
    [6.2, 6.4, 2.2],
    [-12.8, 5.6, 2.0],
    [-15.6, 7.6, 1.6],
    [9.6, 6.8, 1.4],
    [15.4, 6.2, 2.0],
    [-5.2, 3.6, 1.8],
    [-1.0, 2.0, 2.0],
    [19.6, 5.6, 1.8],
    [-9.4, 3.6, 1.6],
  ] as const)
    put('Bush', x, at(x, z, 0.05), z, x * 1.3, s);
  for (const [x, z, s] of [
    [-6.2, 10.4, 2.0],
    [7.4, 9.8, 1.6],
  ] as const)
    put('RedBush', x, at(x, z, 0.03), z, x, s);

  // The cannon on the beach, its muzzle to the left, and what is piled round it.
  const cy = at(0.9, 10.0, 0.05);
  put('Cannon', 0.9, cy, 10.0, Math.PI + 0.25, 1.4);
  solids.box(frame(root, 0.9, cy, 10.0, Math.PI + 0.25), 1.4, 0, 0, 4.2, 1.8, 2.5);
  for (const [x, z, yaw, lying] of [
    [-2.3, 9.9, 0.4, false],
    [-3.2, 8.9, 1.0, false],
    [-1.6, 11.2, 0.2, true],
    [3.9, 9.6, 0.3, false],
    [4.6, 8.6, 1.2, false],
    [9.7, 4.6, 0.5, false],
    [5.4, 7.2, 0.3, false],
  ] as const) {
    const scale = 1.3;
    if (lying) {
      const y = at(x, z) + 0.33 * scale;
      const barrel = put('Barrel', x, y, z, yaw, scale);
      barrel?.rotateX(Math.PI / 2).translateY(-0.45 * scale);
      solids.post(root, x, z, 0.45 * scale, y - 0.33 * scale, y + 0.33 * scale);
    } else {
      const y = at(x, z);
      put('Barrel', x, y, z, yaw, scale);
      solids.post(root, x, z, 0.4 * scale, y, y + 0.91 * scale);
    }
  }
  put('Lantern', 3.9, at(3.9, 9.6) + 0.91 * 1.3, 9.6, 0.4, 1.5);
  for (const [x, z, yaw] of [
    [5.2, 9.8, 0.4],
    [2.4, 7.6, 1.2],
    [-1.2, 8.0, 2.4],
  ] as const)
    put('Sack', x, at(x, z), z, yaw, 1.3);
  put('RopeCoil', 6.0, at(6.0, 8.4), 8.4, 0.6, 1.4);
  put('RopeCoil', -3.0, at(-3.0, 11.2), 11.2, 2.2, 1.2);
  for (const [x, z, yaw] of [
    [2.6, 11.4, 0],
    [2.85, 11.55, 1],
    [5.9, 10.5, 2],
    [0.1, 12.0, 3],
    [-4.0, 9.5, 4],
  ] as const)
    put('Bottle', x, at(x, z), z, yaw, 1.3);
  // The bell and the sign by the gangway, and a flag on the shop's side.
  put('ShipBell', -7.6, at(-7.6, 2.2), 2.2, 0.6, 1.4);
  put('Sign', -11.0, at(-11.0, 3.0), 3.0, 0.8, 1.6);
  put('Flag', 10.0, at(10.0, 3.6), 3.6, -0.3, 1.6);

  // A rope fence along the beach at the left, leading to the gangway.
  const fence = [
    [-15.0, 9.4],
    [-13.6, 9.0],
    [-11.8, 8.6],
    [-10.6, 7.4],
    [-10.0, 5.6],
    [-10.2, 3.8],
  ].map(([x, z]) => new THREE.Vector3(x!, at(x!, z!), z!));
  for (let i = 0; i + 1 < fence.length; i++) {
    const [a, c] = [fence[i]!, fence[i + 1]!];
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const yaw = Math.atan2(-(c.z - a.z), c.x - a.x);
    const f = put('RopeFence', a.x, a.y, a.z, yaw);
    f?.scale.set(len / 1.6, 1.1, 1);
    solids.post(root, a.x, a.z, 0.12, a.y, a.y + 1.1);
  }

  return {
    root,
    solids,
    level,
    ground,
    spawn: SPAWN,
    marks: {
      gangwayFoot: foot,
      gangwayTop: entry,
      stairFoot,
      landing,
      balcony,
      tavern: tavern.localToWorld(new THREE.Vector3(0, 0, 0)),
    },
    deckWalk: [
      gangway,
      ship.localToWorld(new THREE.Vector3(ENTRY.x * k, deck + 0.02, 0)),
      ship.localToWorld(new THREE.Vector3((DECK.x1 - 0.6) * k, deck + 0.02, 0)),
      ship.localToWorld(new THREE.Vector3((DECK.x1 - 0.6) * k, deck + 0.02, -DECK.half * 0.8 * k)),
    ],
  };
}

/**
 * A rope bridge from `a` up to `b` (where its deck starts and ends), `w` wide, walked on as a
 * ramp. Its top end, where it comes aboard.
 */
function bridge(
  root: THREE.Object3D,
  solids: Solids,
  assets: PirateAssets | null,
  a: THREE.Vector3,
  b: THREE.Vector3,
  w: number,
): THREE.Vector3 {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const rise = b.y - a.y;
  const g = frame(root, a.x, a.y, a.z, yaw);
  solids.ramp(g, 0, len / 2, w, len, 0, rise);
  if (assets) {
    // The model runs along its +x from 0 to 4.3, its deck sagging 0.5 to 0.8 above its foot.
    const model = assets.place(g, 'RopeBridge', 0, -0.62, 0, -Math.PI / 2);
    model.rotation.order = 'YZX';
    model.rotation.z = Math.atan2(rise, len);
    model.scale.set(Math.hypot(len, rise) / 4.3, 1, w / 1.2);
  }
  return b.clone();
}
