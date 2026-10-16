import * as THREE from 'three';
import { groundHeight } from '@sar/shared';
import type { LevelDef } from '@sar/shared';
import type { AssetName, PirateAssets } from './assets.ts';
import { SHIP, SPAWN, islandLevel } from './ground.ts';
import { Solids } from './walk.ts';

/**
 * The pirate test map laid out: the island's ground and sea, the galleon in its cove with a rope
 * bridge from the beach over its side, the tavern, the shop, the cliffs behind, palms, bushes,
 * the cannon, barrels and the rest, crowded into one towering pile as in the reference picture
 * seen from low at the water to the south (see `REFERENCE_VIEW`).
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
  /** Places to walk between, in the world: the gangway's ends, and the tavern's middle. */
  marks: Record<'gangwayFoot' | 'gangwayTop' | 'tavern', THREE.Vector3>;
  /** A walk from the top of the gangway down onto the galleon's deck and along it. */
  deckWalk: THREE.Vector3[];
}

/** Where the camera stands to see the island as the reference picture does, and what it looks at. */
export const REFERENCE_VIEW = {
  position: new THREE.Vector3(1, 0.6, 27),
  target: new THREE.Vector3(1, 9.5, -3),
  fov: 42,
};

/** How much bigger than modelled each building is drawn, to stand as tall as the picture's. */
const SHIP_SCALE = 2.5;
const TAVERN_SCALE = 1.7;
const SHOP_SCALE = 1.35;
/** How deep the galleon sits in the water. */
const DRAFT = 1.6;

/** The galleon, as modelled: its waist's deck and its rails. */
const DECK = { top: 2.12, x0: -3.9, x1: 1.7, half: 1.3, rail: 1.55, railTop: 0.72 };
/**
 * Where the gangway comes aboard, as modelled: on the gunwale (its top `y`, the hull's side at
 * `z`: the starboard side, away from the guns and toward the beach) aft of the mainmast, with a gap
 * in the rail; it leaves the side `angle` toward the bow (a negative one, toward the stern) and reaches `length` (in the world)
 * down to the beach.
 */
const ENTRY = { x: 1.3, y: 2.96, z: -1.45, gap: 0.8, angle: -1.0, length: 7.5 };
/** Which side of the ship the gangway is on: +1 or -1, along its own z. */
const SIDE = Math.sign(ENTRY.z);
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
  rail(DECK.x0, DECK.x1, -SIDE);
  rail(DECK.x0, ENTRY.x - ENTRY.gap / 2, SIDE);
  rail(ENTRY.x + ENTRY.gap / 2, DECK.x1, SIDE);
  for (const x of [DECK.x0 - 0.15, DECK.x1 + 0.15])
    solids.box(ship, x * k, 0, 0, 0.3 * k, deck + 1.2 * k, DECK.rail * 2 * k);

  // The gangway: a rope bridge from the beach up onto the gunwale, and a short one inboard down
  // to the deck.
  const entry = ship.localToWorld(new THREE.Vector3(ENTRY.x * k, ENTRY.y * k, ENTRY.z * k));
  const out = new THREE.Vector3(-Math.sin(ENTRY.angle), 0, SIDE * Math.cos(ENTRY.angle));
  const foot = entry
    .clone()
    .addScaledVector(out.transformDirection(ship.matrixWorld), ENTRY.length);
  foot.y = at(foot.x, foot.z) + 0.04;
  bridge(root, solids, assets, foot, entry, 1.1);
  // The step over the gunwale between them.
  solids.box(frame(root, entry.x, entry.y - 0.3, entry.z, SHIP.yaw), 0, 0, 0, 1.4, 0.3, 0.8);
  const inboard = ship.localToWorld(new THREE.Vector3(ENTRY.x * k, deck + 0.02, -SIDE * 0.1 * k));
  bridge(root, solids, assets, entry, inboard, 1.1);
  const aboard = ship.localToWorld(new THREE.Vector3(ENTRY.x * k, deck + 0.02, -SIDE * 0.6 * k));

  // The tavern, and the balcony at its side.
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

  // The shop, tucked in behind the tavern's right.
  const sx = 8.6;
  const sz = -1.6;
  const syaw = -0.6;
  const sy = at(sx, sz, 0.05);
  put('Shack', sx, sy, sz, syaw, SHOP_SCALE);
  solids.box(frame(root, sx, sy, sz, syaw), 0, 0, 0, 3.4 * SHOP_SCALE, 5, 3.4 * SHOP_SCALE);

  // The great cliffs right behind the buildings, towering over their roofs, and the boulders and
  // rocks about the beach. What players bump into is a little smaller than each model (its size
  // at scale 1 below, footprint and height).
  const BULK: Record<string, readonly [number, number, number]> = {
    CliffRocks: [5.6, 4.4, 5.6],
    Boulder: [1.3, 1.15, 1.38],
    Rock: [0.62, 0.62, 0.4],
  };
  for (const [name, x, z, yaw, scale] of [
    ['CliffRocks', 6.5, -11.0, 0.2, 3.4],
    ['CliffRocks', 14.5, -6.0, -2.3, 2.2],
    ['CliffRocks', 3.5, -13.5, 2.9, 1.8],
    ['Boulder', -11.8, 5.0, 0.8, 2.0],
    ['Boulder', 13.5, 3.5, 0.3, 1.8],
    ['Boulder', -4.6, 4.6, 0.5, 1.2],
    ['Rock', -6.5, 8.0, -0.3, 2.2],
    ['Rock', 9.5, 7.2, 0.4, 2.0],
    ['Rock', 2.5, 8.6, 0.1, 1.6],
  ] as const) {
    const y = at(x, z, 0.15);
    put(name, x, y, z, yaw, scale);
    const [w, d, h] = BULK[name]!;
    solids.box(frame(root, x, y, z, yaw), 0, 0, 0, w * scale * 0.7, h * scale, d * scale * 0.7);
  }

  // Palms, crowding in front of the ship's stern and between the buildings.
  for (const [x, z, yaw, scale] of [
    [-6.5, 3.5, 0.6, 1.6],
    [-10.0, 6.0, 2.4, 1.3],
    [-3.2, 2.2, 2.6, 1.9],
    [5.4, 2.4, 1.7, 2.0],
    [12.5, 0.5, -1.4, 1.6],
    [-13.5, 3.0, 0.5, 1.2],
  ] as const) {
    const y = at(x, z, 0.1);
    put('PalmTree', x, y, z, yaw, scale);
    solids.post(root, x, z, 0.25 * scale, y, y + 3);
  }

  // Bushes round the buildings' feet, and the red ones on the beach.
  for (const [x, z, s] of [
    [-8.2, 7.0, 1.8],
    [-4.8, 6.4, 1.6],
    [-1.8, 3.4, 2.0],
    [4.6, 4.2, 1.8],
    [7.2, 3.2, 1.6],
    [11.4, 3.6, 2.0],
    [14.4, 1.0, 1.6],
    [-11.0, 3.4, 1.6],
    [2.0, 7.2, 1.4],
  ] as const)
    put('Bush', x, at(x, z, 0.05), z, x * 1.3, s);
  for (const [x, z, s] of [
    [-5.8, 8.2, 1.8],
    [8.4, 6.0, 1.5],
  ] as const)
    put('RedBush', x, at(x, z, 0.03), z, x, s);

  // The cannon before the tavern, its muzzle to the left, and what is piled round it.
  const [cx, cz, cyaw] = [2.6, 5.0, Math.PI + 0.25];
  const cy = at(cx, cz, 0.05);
  put('Cannon', cx, cy, cz, cyaw, 1.4);
  solids.box(frame(root, cx, cy, cz, cyaw), 1.4, 0, 0, 4.2, 1.8, 2.5);
  for (const [x, z, yaw, lying] of [
    [-1.6, 4.4, 0.4, false],
    [-2.6, 5.2, 1.0, false],
    [-1.0, 7.2, 0.2, true],
    [5.8, 4.8, 0.3, false],
    [6.6, 5.7, 1.2, false],
    [10.2, 2.6, 0.5, false],
    [4.0, 6.4, 0.3, false],
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
  put('Lantern', 5.8, at(5.8, 4.8) + 0.91 * 1.3, 4.8, 0.4, 1.5);
  for (const [x, z, yaw] of [
    [7.2, 4.4, 0.4],
    [3.8, 3.2, 1.2],
    [-3.4, 6.4, 2.4],
  ] as const)
    put('Sack', x, at(x, z), z, yaw, 1.3);
  put('RopeCoil', 6.8, at(6.8, 6.8), 6.8, 0.6, 1.4);
  put('RopeCoil', -2.4, at(-2.4, 7.6), 7.6, 2.2, 1.2);
  for (const [x, z, yaw] of [
    [1.4, 7.4, 0],
    [1.65, 7.55, 1],
    [5.0, 7.6, 2],
    [-0.8, 8.0, 3],
    [-4.0, 7.2, 4],
  ] as const)
    put('Bottle', x, at(x, z), z, yaw, 1.3);
  // The bell and the sign either side of the gangway's foot, and a flag on the shop's side.
  const beside = new THREE.Vector3(foot.z - entry.z, 0, entry.x - foot.x).setLength(1.6);
  const [bell, sign] = [foot.clone().add(beside), foot.clone().sub(beside)];
  put('ShipBell', bell.x, at(bell.x, bell.z), bell.z, SHIP.yaw, 1.4);
  put('Sign', sign.x, at(sign.x, sign.z), sign.z, SHIP.yaw + Math.PI / 2, 1.6);
  put('Flag', 11.2, at(11.2, 1.6), 1.6, -0.3, 1.6);

  // A rope fence along the beach at the left.
  const fence = [
    [-14.2, 5.0],
    [-13.4, 6.6],
    [-12.0, 7.6],
    [-10.4, 8.2],
    [-8.8, 8.4],
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
      tavern: tavern.localToWorld(new THREE.Vector3(0, 0, 0)),
    },
    deckWalk: [
      entry,
      aboard,
      ship.localToWorld(new THREE.Vector3((DECK.x0 + 0.6) * k, deck + 0.02, 0)),
      ship.localToWorld(
        new THREE.Vector3((DECK.x0 + 0.6) * k, deck + 0.02, -SIDE * DECK.half * 0.8 * k),
      ),
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
