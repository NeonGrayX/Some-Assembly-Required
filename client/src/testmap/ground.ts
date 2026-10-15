import { groundHeight } from '@sar/shared';
import type { LevelDef, TerrainDef } from '@sar/shared';
import { noise } from '../render/surroundings.ts';

/**
 * The pirate test map's island: a low bank of sand in the sea, a cove behind it where the
 * galleon is moored, and a grassy rise at the back under the great rocks. Its ground goes
 * through the game's own terrain and sea (sand, grass and banks painted from the shape, the sea
 * foaming along its shore), from a level that is nothing but that ground: the map has no game
 * on it.
 */

/** The sea's level. */
export const SEA = 0;
/** The sand's level over most of the island. */
export const PLATEAU = 0.85;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far inside an oval round (`cx`, `cz`) with radii `rx`, `rz` a point is, in metres, near enough. */
const inOval = (x: number, z: number, cx: number, cz: number, rx: number, rz: number, turn = 0) => {
  const [dx, dz] = [x - cx, z - cz];
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  return (1 - Math.hypot((dx * c - dz * s) / rx, (dx * s + dz * c) / rz)) * Math.min(rx, rz);
};

/** Where the galleon lies: its middle at the waterline, and its heading (its bow toward -x turned so). */
export const SHIP = { x: -4.5, z: -13, yaw: 0.78 };

/** How far inland (`x`, `z`) is (negative out at sea), in metres. */
export function inland(x: number, z: number): number {
  const wobble = (noise(x * 0.18, z * 0.18, 7) - 0.5) * 2.4;
  let d = Math.max(
    inOval(x, z, 1, -2, 21, 13.5),
    inOval(x, z, 13, -6, 11, 12),
    inOval(x, z, -12, 4.5, 8, 5),
    inOval(x, z, -16.5, 7.5, 4, 3),
  );
  // The cove behind, where the ship lies.
  d = Math.min(d, -inOval(x, z, SHIP.x, SHIP.z, 14, 5.4, SHIP.yaw));
  return d + wobble;
}

/** The island's height over (`x`, `z`), before it is sampled onto the grid. */
export function islandHeight(x: number, z: number): number {
  const d = inland(x, z);
  let h = -2.6 + (PLATEAU + 2.6) * smooth(-7, 3.5, d);
  // Soft drifts in the sand.
  h += (noise(x * 0.35, z * 0.35, 11) - 0.5) * 0.25 * smooth(0, 4, d);
  // The rise at the back, under the rocks.
  const rise = Math.exp(-(((x - 13) / 8) ** 2) - ((z + 9) / 6) ** 2);
  h += 2.4 * rise * smooth(0, 3, d);
  return h;
}

const STEP = 0.5;
const X0 = -36;
const Z0 = -30;
const NX = 145;
const NZ = 117;

function terrain(): TerrainDef {
  const heights: number[] = [];
  for (let i = 0; i < NX; i++)
    for (let k = 0; k < NZ; k++) heights.push(islandHeight(X0 + i * STEP, Z0 + k * STEP));
  return { x0: X0, z0: Z0, step: STEP, nx: NX, nz: NZ, heights };
}

/** Where a player starts: on the beach in front of the cannon. */
export const SPAWN = { x: -1.5, z: 10.5 };

/**
 * The map as a level, for the game's terrain and sea to be drawn from: its ground and sea and
 * nothing else (the job site, spawn and so on, which the ground wears bare round, all at the
 * spawn on the beach).
 */
export function islandLevel(): LevelDef {
  const t = terrain();
  const at = { x: SPAWN.x, y: groundHeight({ terrain: [t] }, SPAWN.x, SPAWN.z), z: SPAWN.z };
  return {
    floorSize: 64,
    terrain: [t],
    sea: SEA,
    boxes: [],
    decals: [],
    machines: [],
    baseplate: { x: at.x - 0.4, y: at.y, z: at.z - 0.4 },
    inspector: { pos: at, size: { x: 0.5, z: 0.5 } },
    doneButton: at,
    bell: at,
    board: { pos: at, facing: 0 },
    pageSpots: [],
    hideouts: [],
    ladders: [],
    meetingSeats: [],
    lights: [],
    interiors: [],
    spawn: at,
    dog: { points: [at], links: [], start: 0, treatJar: at },
    vacuum: { pos: at, facing: 0 },
  };
}
