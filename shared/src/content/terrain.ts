import type { FloorRect, LevelDef } from './house.ts';

/**
 * Ground that is not flat: heights sampled on a square grid, laid out the way the physics
 * engine's heightfield takes them, so that what is drawn, what players walk on and what the
 * map's checks and the bots work from are the very same surface. A map with terrain has its
 * ground here instead of at y = 0 (`groundHeight`).
 *
 * Between the samples each cell is two flat triangles, split along the diagonal from its
 * corner with the least x and the most z to the one with the most x and the least z, as the
 * engine splits them (`terrainHeight`).
 */
export interface TerrainDef {
  /** The grid's corner with the least x and z. */
  x0: number;
  z0: number;
  /** Metres between neighbouring samples. */
  step: number;
  /** How many samples there are along x and along z. */
  nx: number;
  nz: number;
  /** The heights, a column of z for each x in turn: the sample `(i, k)` is `heights[i * nz + k]`. */
  heights: number[];
}

/** The rectangle a terrain covers. */
export function terrainRect(t: TerrainDef): FloorRect {
  return {
    x0: t.x0,
    z0: t.z0,
    x1: t.x0 + (t.nx - 1) * t.step,
    z1: t.z0 + (t.nz - 1) * t.step,
  };
}

/** The height of the sample `(i, k)`, clamped to the grid. */
export function sampleAt(t: TerrainDef, i: number, k: number): number {
  const ci = Math.max(0, Math.min(t.nx - 1, i));
  const ck = Math.max(0, Math.min(t.nz - 1, k));
  return t.heights[ci * t.nz + ck]!;
}

/**
 * The height of the terrain's surface over (`x`, `z`), as the physics engine has it: off the
 * grid, the height at its nearest edge.
 */
export function terrainHeight(t: TerrainDef, x: number, z: number): number {
  const u = Math.max(0, Math.min(t.nx - 1, (x - t.x0) / t.step));
  const w = Math.max(0, Math.min(t.nz - 1, (z - t.z0) / t.step));
  const i = Math.min(t.nx - 2, Math.floor(u));
  const k = Math.min(t.nz - 2, Math.floor(w));
  const fx = u - i;
  const fz = w - k;
  const h00 = sampleAt(t, i, k);
  const h10 = sampleAt(t, i + 1, k);
  const h01 = sampleAt(t, i, k + 1);
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  const h11 = sampleAt(t, i + 1, k + 1);
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/** Whether a point lies over a terrain's grid (its edges included). */
export function overTerrain(t: TerrainDef, x: number, z: number): boolean {
  const r = terrainRect(t);
  return x >= r.x0 - 1e-6 && x <= r.x1 + 1e-6 && z >= r.z0 - 1e-6 && z <= r.z1 + 1e-6;
}

/** The terrain under a point: the first of the level's that it lies over, else the nearest. */
function terrainAt(terrain: TerrainDef[], x: number, z: number): TerrainDef | undefined {
  if (terrain.length < 2) return terrain[0];
  let best: TerrainDef | undefined;
  let bestD = Infinity;
  for (const t of terrain) {
    if (overTerrain(t, x, z)) return t;
    const r = terrainRect(t);
    const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
    if (d < bestD) [best, bestD] = [t, d];
  }
  return best;
}

/**
 * The height of the ground over (`x`, `z`): the terrain's, or 0 on a map whose ground is flat
 * (all of them but the island). Everything that stands, lies or walks on the ground starts from
 * here rather than from 0.
 */
export function groundHeight(level: Pick<LevelDef, 'terrain'>, x: number, z: number): number {
  const t = level.terrain?.length ? terrainAt(level.terrain, x, z) : undefined;
  return t ? terrainHeight(t, x, z) : 0;
}

/**
 * How steep the ground is at (`x`, `z`), as its rise over a metre's run (0 for flat ground, 1
 * at 45°), from the slope of the triangle under the point.
 */
export function groundSlope(level: Pick<LevelDef, 'terrain'>, x: number, z: number): number {
  if (!level.terrain?.length) return 0;
  const e = 0.05;
  const dx = (groundHeight(level, x + e, z) - groundHeight(level, x - e, z)) / (2 * e);
  const dz = (groundHeight(level, x, z + e) - groundHeight(level, x, z - e)) / (2 * e);
  return Math.hypot(dx, dz);
}

/**
 * Where a line run along the grid from `a` to `b` (in steps of the grid), `across` steps from
 * the grid's edge the other way, crosses the grid's lines and the cells' diagonals: the only
 * places along it where the ground turns.
 */
function bends(a: number, b: number, across: number): number[] {
  const out: number[] = [];
  for (let n = Math.ceil(a); n < b; n++) out.push(n);
  // Each diagonal runs where the steps along and across add up to a whole number.
  for (let n = Math.ceil(a + across); n - across < b; n++) out.push(n - across);
  return out;
}

/**
 * The lowest and highest the ground gets under a rectangle. The ground is flat triangles, so
 * it is highest and lowest at a corner of one: at a sample of the grid inside the rectangle,
 * at a corner of the rectangle, or where an edge of the rectangle crosses a triangle's side.
 */
export function groundSpan(
  level: Pick<LevelDef, 'terrain'>,
  r: FloorRect,
): { min: number; max: number } {
  const hs = [
    groundHeight(level, r.x0, r.z0),
    groundHeight(level, r.x1, r.z0),
    groundHeight(level, r.x0, r.z1),
    groundHeight(level, r.x1, r.z1),
    groundHeight(level, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2),
  ];
  for (const t of level.terrain ?? []) {
    const i0 = Math.max(0, Math.ceil((r.x0 - t.x0) / t.step - 1e-9));
    const i1 = Math.min(t.nx - 1, Math.floor((r.x1 - t.x0) / t.step + 1e-9));
    const k0 = Math.max(0, Math.ceil((r.z0 - t.z0) / t.step - 1e-9));
    const k1 = Math.min(t.nz - 1, Math.floor((r.z1 - t.z0) / t.step + 1e-9));
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) hs.push(sampleAt(t, i, k));
    const [u0, u1] = [(r.x0 - t.x0) / t.step, (r.x1 - t.x0) / t.step];
    const [w0, w1] = [(r.z0 - t.z0) / t.step, (r.z1 - t.z0) / t.step];
    for (const w of [w0, w1])
      for (const u of bends(u0, u1, w))
        hs.push(groundHeight(level, t.x0 + u * t.step, t.z0 + w * t.step));
    for (const u of [u0, u1])
      for (const w of bends(w0, w1, u))
        hs.push(groundHeight(level, t.x0 + u * t.step, t.z0 + w * t.step));
  }
  return { min: Math.min(...hs), max: Math.max(...hs) };
}

/**
 * A terrain turned half round about the point (0, `zm`), as rival teams' copy of a yard is
 * (see `rivalLevel`). The engine splits every cell along the same diagonal either way round,
 * so the copy's surface is the original's, turned.
 */
export function turnedTerrain(t: TerrainDef, zm: number): TerrainDef {
  const r = terrainRect(t);
  const heights = new Array<number>(t.heights.length);
  for (let i = 0; i < t.nx; i++)
    for (let k = 0; k < t.nz; k++)
      heights[i * t.nz + k] = t.heights[(t.nx - 1 - i) * t.nz + (t.nz - 1 - k)]!;
  return { ...t, x0: -r.x1, z0: 2 * zm - r.z1, heights };
}

/**
 * Samples `height` on a grid over `r` every `step` metres, as a terrain. Heights are rounded
 * to the millimetre, which the engine's single-precision floats hold alike everywhere.
 */
export function sampleTerrain(
  r: FloorRect,
  step: number,
  height: (x: number, z: number) => number,
): TerrainDef {
  const nx = Math.round((r.x1 - r.x0) / step) + 1;
  const nz = Math.round((r.z1 - r.z0) / step) + 1;
  const heights: number[] = [];
  for (let i = 0; i < nx; i++)
    for (let k = 0; k < nz; k++)
      heights.push(Math.round(height(r.x0 + i * step, r.z0 + k * step) * 1000) / 1000);
  return { x0: r.x0, z0: r.z0, step, nx, nz, heights };
}

/**
 * Whether a point is under the sea: the ground there lies below the sea's level by more than a
 * wet foot. Players wade through it slowly, as through a lake (see `LevelDef.water`), and the
 * dog keeps out.
 */
export function inSea(
  level: Pick<LevelDef, 'terrain' | 'sea'>,
  x: number,
  z: number,
  margin = 0.05,
): boolean {
  return level.sea !== undefined && groundHeight(level, x, z) < level.sea - margin;
}

/**
 * A terrain as a triangle mesh: its samples as points, and every cell as the two triangles the
 * physics engine splits it into, turned to face up. The physics world takes the terrain as
 * this mesh, and the client draws the very same triangles.
 */
export function terrainTriangles(t: TerrainDef): { vertices: Float32Array; indices: Uint32Array } {
  const vertices = new Float32Array(t.nx * t.nz * 3);
  for (let i = 0; i < t.nx; i++)
    for (let k = 0; k < t.nz; k++) {
      const n = i * t.nz + k;
      vertices[n * 3] = t.x0 + i * t.step;
      vertices[n * 3 + 1] = t.heights[n]!;
      vertices[n * 3 + 2] = t.z0 + k * t.step;
    }
  const indices = new Uint32Array((t.nx - 1) * (t.nz - 1) * 6);
  let j = 0;
  for (let i = 0; i < t.nx - 1; i++)
    for (let k = 0; k < t.nz - 1; k++) {
      const v00 = i * t.nz + k;
      const v10 = v00 + t.nz;
      const v01 = v00 + 1;
      const v11 = v10 + 1;
      indices.set([v00, v01, v10, v11, v10, v01], j);
      j += 6;
    }
  return { vertices, indices };
}

/** The lowest the terrain goes anywhere. */
export function terrainFloor(t: TerrainDef): number {
  let lo = Infinity;
  for (const h of t.heights) lo = Math.min(lo, h);
  return lo;
}
