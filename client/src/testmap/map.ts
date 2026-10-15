import * as THREE from 'three';
import { groundHeight } from '@sar/shared';
import type { LevelDef } from '@sar/shared';
import { bigHouse, shop } from './buildings.ts';
import { SHIP, SPAWN, islandLevel } from './ground.ts';
import { C } from './kit.ts';
import { bush, palm, rock, tuft } from './nature.ts';
import {
  barrel,
  bottle,
  cannon,
  crate,
  lantern,
  lanternPost,
  ropeRail,
  sack,
  walkway,
} from './props.ts';
import { ENTRY_SIDE, ENTRY_X, LENGTH, beamAt, deckAt, galleon } from './ship.ts';
import { Solids } from './walk.ts';

/**
 * The pirate test map laid out: the island's ground and sea, the galleon in its cove with the
 * gangway up to it, the tall house and the shop, the great rocks behind, palms, bushes, the
 * cannon, barrels and the rest, placed to match the reference picture as seen from the sea to
 * the south (see `REFERENCE_VIEW`).
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
  /** Places to walk between, in the world: the gangway's ends, the house's stair and balcony. */
  marks: Record<'gangwayFoot' | 'gangwayTop' | 'stairFoot' | 'landing' | 'balcony', THREE.Vector3>;
  /** The way from the gangway's top down the forecastle stair, along the waist and up onto the quarterdeck. */
  deckWalk: THREE.Vector3[];
}

/** Where the camera stands to see the island as the reference picture does, and what it looks at. */
export const REFERENCE_VIEW = {
  position: new THREE.Vector3(-0.4, 1.0, 24.5),
  target: new THREE.Vector3(0.8, 8.4, -2),
  fov: 46,
};

export function buildIsland(): IslandMap {
  const level = islandLevel();
  const ground = (x: number, z: number) => groundHeight(level, x, z);
  const at = (x: number, z: number, sink = 0) => ground(x, z) - sink;
  const root = new THREE.Group();
  root.name = 'pirate-island';
  const solids = new Solids();

  // The galleon in the cove, its bow toward the beach on the left, and the gangway from the
  // beach up to the gap in its rail by the forecastle.
  const ship = galleon(root, solids, SHIP.x, 0, SHIP.z, SHIP.yaw);
  ship.updateMatrixWorld(true);
  const entry = new THREE.Vector3(
    ENTRY_X,
    deckAt(ENTRY_X / (LENGTH / 2)),
    ENTRY_SIDE * (beamAt(ENTRY_X / (LENGTH / 2)) * 0.95 + 0.15),
  ).applyMatrix4(ship.matrixWorld);
  const foot = new THREE.Vector3(-11.6, 0, 1.6);
  foot.y = at(foot.x, foot.z) + 0.04;
  walkway(root, solids, foot, entry, 1.3);
  // Rope rails along both sides of the gangway, on posts, with a lantern at its foot.
  const across = new THREE.Vector3(entry.z - foot.z, 0, foot.x - entry.x).normalize();
  for (const s of [-1, 1]) {
    const side = across.clone().multiplyScalar(s * 0.78);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 4; i++) {
      const p = foot
        .clone()
        .lerp(entry, i / 4)
        .add(side);
      if (i === 0) p.y = at(p.x, p.z);
      else p.y -= 0.05;
      pts.push(p);
    }
    ropeRail(root, null, pts, 1.0);
  }

  // The tall house and the shop.
  const house = bigHouse(root, solids, 1.6, at(1.6, -0.5, 0.05), -0.5, 0.54);
  house.updateMatrixWorld(true);
  const stairFoot = house.localToWorld((house.userData.stairFoot as THREE.Vector3).clone());
  const landing = house.localToWorld((house.userData.landing as THREE.Vector3).clone());
  const balcony = house.localToWorld((house.userData.balcony as THREE.Vector3).clone());
  shop(root, solids, 12.2, at(12.2, 1.4, 0.05), 1.4, -0.32);

  // The great rocks at the back, and the smaller ones about the beach.
  rock(root, solids, 13.5, at(13.5, -14, 0.6), -14, 14, 25, 10, 3, 0.25, 0.04);
  rock(root, solids, 15.6, at(15.6, -5.5, 0.5), -5.5, 7.5, 13.5, 6, 5, -0.4, -0.05);
  rock(root, solids, 6.5, at(6.5, -9.5, 0.4), -9.5, 6, 10, 5, 9, 0.6);
  rock(root, solids, 20.5, at(20.5, 1.5, 0.3), 1.5, 4.5, 5, 4, 12, 0.3);
  rock(root, solids, -14.2, at(-14.2, -0.4, 0.3), -0.4, 4.2, 5.5, 3.5, 15, 0.8, 0.08);
  rock(root, solids, -14.6, at(-14.6, 4.2, 0.3), 4.2, 3.2, 3.8, 2.8, 17, 0.2);
  rock(root, solids, -6.4, at(-6.4, 5.2, 0.25), 5.2, 2.2, 2.6, 1.9, 21, 0.5);
  rock(root, solids, -5.0, at(-5.0, 9.6, 0.2), 9.6, 1.6, 1.5, 1.4, 23, -0.3);
  rock(root, solids, -10.0, at(-10.0, 9.0, 0.2), 9.0, 1.5, 1.3, 1.4, 25, 0.9);
  rock(root, solids, 4.6, at(4.6, 11.0, 0.15), 11.0, 1.1, 0.8, 1.0, 27, 0.1);
  rock(root, solids, 15.6, at(15.6, 8.6, 0.2), 8.6, 2.2, 2.0, 1.9, 29, 1.1);
  rock(root, solids, 11.6, at(11.6, 9.4, 0.15), 9.4, 1.0, 0.8, 0.9, 31, 0.4);

  // Palms.
  palm(root, solids, -11.6, at(-11.6, 7.4, 0.1), 7.4, 3.8, 0.6, 0.5, 41);
  palm(root, solids, -7.4, at(-7.4, 6.6, 0.1), 6.6, 4.6, -0.9, 0.3, 43);
  palm(root, solids, -2.6, at(-2.6, 4.4, 0.1), 4.4, 6.6, -0.5, 0.2, 45);
  palm(root, solids, 8.0, at(8.0, 0.6, 0.1), 0.6, 7.6, 1.7, 0.22, 47);
  palm(root, solids, 17.6, at(17.6, 5.4, 0.1), 5.4, 4.8, -1.4, 0.3, 49);
  palm(root, solids, -6.0, at(-6.0, 1.2, 0.1), 1.2, 5.6, 0.5, 0.22, 51);
  palm(root, solids, 15.0, at(15.0, -1.5, 0.1), -1.5, 7.0, 0.3, 0.15, 53);

  // Bushes, and the dark red one on the beach.
  for (const [x, z, s, seed] of [
    [-8.6, 8.4, 0.9, 61],
    [-3.8, 9.4, 0.8, 62],
    [3.0, 9.4, 0.75, 63],
    [6.2, 6.4, 1.1, 64],
    [-12.8, 5.6, 1.0, 65],
    [-15.6, 7.6, 0.8, 66],
    [9.6, 6.8, 0.7, 67],
    [15.4, 6.2, 1.0, 68],
    [-5.2, 3.6, 0.9, 69],
    [-1.0, 2.0, 1.0, 70],
    [19.6, 5.6, 0.9, 71],
    [-9.4, 3.6, 0.8, 73],
  ] as const)
    bush(root, x, at(x, z, 0.15), z, s, seed);
  bush(root, -6.2, at(-6.2, 10.4, 0.1), 10.4, 0.7, 72, C.coral);

  // Grass in tufts round the feet of things.
  const tufts: [number, number][] = [
    [-9.0, 7.6],
    [-7.2, 8.8],
    [-4.2, 10.2],
    [-2.6, 8.4],
    [1.2, 10.4],
    [2.4, 7.4],
    [4.9, 9.6],
    [5.6, 7.3],
    [8.1, 4.8],
    [9.8, 5.4],
    [12.6, 5.6],
    [14.8, 7.0],
    [16.6, 5.8],
    [-12.0, 7.6],
    [-14.5, 6.0],
    [-16.8, 8.2],
    [-0.4, 6.0],
    [-3.4, 6.6],
    [10.6, 3.7],
    [6.0, 3.4],
    [-5.0, 6.2],
    [0.2, 11.2],
  ];
  tufts.forEach(([x, z], i) => tuft(root, x, at(x, z), z, 0.35 + (i % 3) * 0.08, 80 + i));

  // The cannon on the beach, its muzzle to the left, and what is piled round it.
  cannon(root, solids, 0.9, at(0.9, 10.0, 0.05), 10.0, 1.95, 1.12);
  barrel(root, solids, -2.3, at(-2.3, 9.9), 9.9, 0.95, 0.4);
  barrel(root, solids, -3.2, at(-3.2, 8.9), 8.9, 0.95, 1.0);
  barrel(root, solids, -1.6, at(-1.6, 11.2), 11.2, 0.95, 0.2, true);
  barrel(root, solids, 3.9, at(3.9, 9.6), 9.6, 1.05, 0.3);
  lantern(root, 3.9, at(3.9, 9.6) + 1.05, 9.6, 0.5, 0.4);
  barrel(root, solids, 4.6, at(4.6, 8.6), 8.6, 0.9, 1.2);
  barrel(root, solids, 9.7, at(9.7, 4.6), 4.6, 0.9, 0.5);
  crate(root, solids, 5.4, at(5.4, 7.2), 7.2, 0.75, 0.3);
  crate(root, solids, 5.35, at(5.35, 7.2) + 0.75, 7.2, 0.55, 0.9);
  sack(root, 5.2, at(5.2, 9.8), 9.8, 0.65, 0.4, 1);
  sack(root, 2.4, at(2.4, 7.6), 7.6, 0.6, 1.2, 2);
  sack(root, -1.2, at(-1.2, 8.0), 8.0, 0.55, 2.4, 3);
  for (const [x, z, lying] of [
    [2.6, 11.4, false],
    [2.85, 11.55, false],
    [-0.9, 11.9, true],
    [5.9, 10.5, false],
    [0.1, 12.0, false],
    [-4.0, 9.5, false],
    [8.8, 5.7, true],
  ] as const)
    bottle(root, x, at(x, z), z, 0.34, lying, x);
  // Lanterns on posts: by the gangway, on the beach and by the shop.
  lanternPost(root, solids, -10.6, at(-10.6, 3.3), 3.3, 2.6, 0.9);
  lanternPost(root, solids, -4.4, at(-4.4, 6.2), 6.2, 2.8, -0.4);
  lanternPost(root, solids, -0.6, at(-0.6, 6.6), 6.6, 2.6, 0.2);
  lanternPost(root, solids, 8.8, at(8.8, 3.6), 3.6, 2.6, -2.2);

  // A rope fence along the beach at the left, on posts, leading to the gangway.
  const fence = [
    [-13.6, 9.0],
    [-11.8, 8.6],
    [-10.2, 7.0],
    [-9.4, 5.0],
    [-9.6, 3.0],
  ].map(([x, z]) => new THREE.Vector3(x!, at(x!, z!), z!));
  ropeRail(root, solids, fence, 1.0);

  return {
    root,
    solids,
    level,
    ground,
    spawn: SPAWN,
    marks: { gangwayFoot: foot, gangwayTop: entry, stairFoot, landing, balcony },
    deckWalk: [
      entry,
      ...(ship.userData.foreStair as THREE.Vector3[]).slice().reverse(),
      ...(ship.userData.quarterStair as THREE.Vector3[]),
    ].map((p, i) => (i === 0 ? p.clone() : ship.localToWorld(p.clone()))),
  };
}
