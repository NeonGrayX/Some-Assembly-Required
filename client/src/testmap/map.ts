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
 * seen from low on the beach to the south, through a wide lens (see `REFERENCE_VIEW`).
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
  position: new THREE.Vector3(0.5, 1.7, 20),
  target: new THREE.Vector3(-0.5, 7.3, -2),
  fov: 54,
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
const ENTRY = { x: 1.3, y: 2.96, z: 1.45, gap: 0.8, angle: 0.6, length: 7.5 };
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
  // The ground under something `r` round (`x`, `z`) at its lowest, for it to stand on: on a
  // slope its uphill side sinks into the sand instead of its downhill side hanging in the air.
  const low = (x: number, z: number, r: number) => {
    let h = ground(x, z);
    for (let i = 0; i < 8; i++)
      h = Math.min(h, ground(x + Math.cos(i * 0.785) * r, z + Math.sin(i * 0.785) * r));
    return h;
  };
  const root = new THREE.Group();
  root.name = 'pirate-island';
  const solids = new Solids();
  // A model, if the models are loaded.
  const put = (name: AssetName, x: number, y: number, z: number, yaw = 0, scale = 1) =>
    assets?.has(name) ? assets.place(root, name, x, y, z, yaw, scale) : null;
  // Grass in `n` tufts about `r` round (`x`, `z`): at the feet of rocks, barrels, palms and the
  // buildings' corners, the only grass the picture has.
  const tufts = (x: number, z: number, r: number, n = 3) => {
    for (let i = 0; i < n; i++) {
      const a = i * 2.4 + x * 1.7 + z;
      const d = r * (0.85 + 0.3 * Math.sin(a * 3.1));
      const [gx, gz] = [x + Math.cos(a) * d, z + Math.sin(a) * d];
      put('GrassTuft', gx, at(gx, gz, 0.02), gz, a, 1.5 + 0.5 * Math.sin(a * 1.7));
    }
  };
  const corners = (g: THREE.Object3D, half: number) => {
    for (const [cx, cz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      const c = g.localToWorld(new THREE.Vector3(cx * half, 0, cz * half));
      tufts(c.x, c.z, 0.4);
    }
  };

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
  const tyaw = -0.6;
  const t = TAVERN_SCALE;
  const ty = at(tx, tz, 0.05);
  const tavern = frame(root, tx, ty, tz, tyaw);
  put('Tavern', tx, ty, tz, tyaw, t);
  solids.box(tavern, 0, 0, 0, TAVERN.half * 2 * t, TAVERN.height * t, TAVERN.half * 2 * t);
  const b = TAVERN.balcony;
  const top = b.top * t;
  const bx = ((b.x0 + b.x1) / 2) * t;
  solids.box(tavern, bx, 0, 0, (b.x1 - b.x0) * t, top, b.half * 2 * t);
  corners(tavern, TAVERN.half * t);

  // The shop, tucked in behind the tavern's right.
  const sx = 10.5;
  const sz = -2.6;
  const syaw = -1.0;
  const sy = at(sx, sz, 0.05);
  put('Shack', sx, sy, sz, syaw, SHOP_SCALE);
  const shop = frame(root, sx, sy, sz, syaw);
  solids.box(shop, 0, 0, 0, 3.4 * SHOP_SCALE, 5, 3.4 * SHOP_SCALE);
  corners(shop, 1.7 * SHOP_SCALE);

  // The great cliffs right behind the buildings, towering over their roofs, and the boulders and
  // rocks about the beach. What players bump into is a little smaller than each model (its size
  // at scale 1 below, footprint and height).
  const BULK: Record<string, readonly [number, number, number]> = {
    CliffRocks: [5.6, 4.4, 5.6],
    Boulder: [1.3, 1.15, 1.38],
    Rock: [0.62, 0.62, 0.4],
  };
  for (const [name, x, z, yaw, scale] of [
    ['CliffRocks', 7.0, -11.5, 0.2, 3.4],
    ['CliffRocks', 14.5, -6.0, -2.3, 2.2],
    ['CliffRocks', 5.5, -16.0, 2.9, 1.8],
    ['Boulder', -11.8, 5.0, 0.8, 2.0],
    ['Boulder', 13.5, 3.5, 0.3, 1.8],
    ['Boulder', -4.6, 4.6, 0.5, 1.2],
    ['Boulder', -9.0, 2.0, 2.1, 1.8],
    ['Boulder', -6.6, 0.6, 1.2, 1.5],
    ['Rock', -6.5, 8.0, -0.3, 2.2],
    ['Rock', 9.5, 7.2, 0.4, 2.0],
    ['Rock', -4.3, 11.2, 0.1, 1.6],
  ] as const) {
    const y = at(x, z, 0.15);
    put(name, x, y, z, yaw, scale);
    const [w, d, h] = BULK[name]!;
    solids.box(frame(root, x, y, z, yaw), 0, 0, 0, w * scale * 0.7, h * scale, d * scale * 0.7);
    tufts(x, z, w * scale * 0.45, name === 'CliffRocks' ? 6 : 4);
  }

  // Palms, crowding in front of the ship's stern and between the buildings.
  for (const [x, z, yaw, scale] of [
    [-6.5, 3.5, 0.6, 1.6],
    [-10.0, 6.0, 2.4, 1.3],
    [-3.2, 2.2, 2.6, 1.9],
    [5.4, 2.4, 1.7, 2.0],
    [12.5, 0.5, -1.4, 1.6],
    [-13.5, 3.0, 0.5, 1.2],
    [-6.2, 10.2, 1.1, 1.3],
    [-8.4, 0.2, 2.0, 1.7],
    [-4.8, -0.6, 0.3, 1.5],
  ] as const) {
    const y = at(x, z, 0.1);
    put('PalmTree', x, y, z, yaw, scale);
    solids.post(root, x, z, 0.25 * scale, y, y + 3);
    tufts(x, z, 0.5);
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
    [1.0, 11.8, 1.4],
  ] as const)
    put('Bush', x, at(x, z, 0.05), z, x * 1.3, s);
  for (const [x, z, s] of [
    [-5.8, 8.2, 1.8],
    [8.6, 9.0, 1.5],
    [-9.0, 6.6, 1.6],
  ] as const)
    put('RedBush', x, at(x, z, 0.03), z, x, s);

  // How tall a barrel stands, as modelled.
  const barrelTop = assets?.has('Barrel') ? assets.box('Barrel').max.y : 0.77;

  // The cannon on the beach before the tavern, its muzzle to the left, and what is piled round
  // it.
  const [cx, cz, cyaw] = [3.4, 9.2, Math.PI + 0.25];
  const cy = at(cx, cz, 0.05);
  const cannon = put('Cannon', cx, cy, cz, cyaw, 1.4);
  if (cannon) tilt(cannon, ground, [-0.3, 1.9], [-0.8, 0.8]);
  solids.box(frame(root, cx, cy, cz, cyaw), 1.4, 0, 0, 4.2, 1.8, 2.5);
  tufts(cx, cz, 1.5, 4);
  for (const [x, z, yaw, lying] of [
    [-1.4, 8.2, 0.4, false],
    [-2.3, 8.9, 1.0, false],
    [-1.0, 10.4, 0.2, true],
    [5.8, 8.4, 0.3, false],
    [6.6, 9.2, 1.2, false],
    [10.2, 2.6, 0.5, false],
    [5.0, 10.4, 0.3, false],
  ] as const) {
    const scale = 1.3;
    if (lying) {
      const y = low(x, z, 0.4 * scale) + 0.33 * scale;
      const barrel = put('Barrel', x, y, z, yaw, scale);
      barrel?.rotateX(Math.PI / 2).translateY(-0.45 * scale);
      solids.post(root, x, z, 0.45 * scale, y - 0.33 * scale, y + 0.33 * scale);
    } else {
      const y = low(x, z, 0.38 * scale);
      put('Barrel', x, y, z, yaw, scale);
      solids.post(root, x, z, 0.4 * scale, y, y + barrelTop * scale);
    }
    tufts(x, z, 0.65, 2);
  }
  // On the barrel's lid.
  put('Lantern', 5.8, low(5.8, 8.4, 0.38 * 1.3) + barrelTop * 1.3 - 0.01, 8.4, 0.4, 1.5);
  for (const [x, z, yaw] of [
    [7.0, 8.0, 0.4],
    [3.8, 3.2, 1.2],
    [-3.0, 8.0, 2.4],
  ] as const)
    put('Sack', x, low(x, z, 0.3 * 1.3), z, yaw, 1.3);
  put('RopeCoil', 7.4, low(7.4, 10.4, 0.4 * 1.4), 10.4, 0.6, 1.4);
  put('RopeCoil', -2.6, low(-2.6, 10.0, 0.4 * 1.2), 10.0, 2.2, 1.2);
  for (const [x, z, yaw] of [
    [4.8, 11.2, 0],
    [5.05, 11.4, 1],
    [6.4, 10.9, 2],
    [-0.6, 11.4, 3],
    [-3.6, 9.6, 4],
  ] as const)
    put('Bottle', x, low(x, z, 0.1), z, yaw, 1.3);
  // The bell and the sign either side of the gangway's foot, and a flag on the shop's side.
  const beside = new THREE.Vector3(foot.z - entry.z, 0, entry.x - foot.x).setLength(1.6);
  const [bell, sign] = [foot.clone().add(beside), foot.clone().sub(beside)];
  put('ShipBell', bell.x, low(bell.x, bell.z, 0.45), bell.z, SHIP.yaw, 1.4);
  put('Sign', sign.x, low(sign.x, sign.z, 0.3), sign.z, SHIP.yaw + Math.PI / 2, 1.6);
  put('Flag', 11.2, low(11.2, 1.6, 0.1), 1.6, -0.3, 1.6);

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
 * `model` (placed, turned about y) tipped to lie on the ground: its own x and z axes along the
 * slope under the corners of its footprint from `xs[0]` to `xs[1]` and `zs[0]` to `zs[1]` (in its
 * own space, scaled), and lowered or raised to stand on it.
 */
function tilt(
  model: THREE.Object3D,
  ground: (x: number, z: number) => number,
  xs: [number, number],
  zs: [number, number],
): void {
  const k = model.scale.x;
  const [c, s] = [Math.cos(model.rotation.y), Math.sin(model.rotation.y)];
  const h = (lx: number, lz: number) =>
    ground(model.position.x + (lx * c + lz * s) * k, model.position.z + (-lx * s + lz * c) * k);
  const [x0, x1] = xs;
  const [z0, z1] = zs;
  const along = (h(x1, z0) + h(x1, z1) - h(x0, z0) - h(x0, z1)) / 2;
  const across = (h(x0, z1) + h(x1, z1) - h(x0, z0) - h(x1, z0)) / 2;
  model.rotation.order = 'YXZ';
  model.rotation.z = Math.atan2(along, (x1 - x0) * k);
  model.rotation.x = -Math.atan2(across, (z1 - z0) * k);
  model.position.y = (h(x0, z0) + h(x0, z1) + h(x1, z0) + h(x1, z1)) / 4 - 0.03;
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
