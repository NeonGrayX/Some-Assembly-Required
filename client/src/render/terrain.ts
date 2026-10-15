import * as THREE from 'three';
import {
  BASEPLATE_SIZE,
  groundHeight,
  levelSites,
  terrainRect,
  terrainTriangles,
} from '@sar/shared';
import type { BoxDef, FloorRect, LevelDef } from '@sar/shared';
import { GLOW_POOL } from './daynight.ts';
import { roomSides } from './details.ts';
import { NO_FILL } from './furniture.ts';
import { NO_MERGE } from './merge.ts';
import {
  DEPTH_RANGE,
  GROUND_ATTRIBUTE,
  SEA_LEVEL,
  SHORE_MAP,
  SHORE_RANGE,
  Surface,
  madeOf,
} from './styles.ts';
import type { ShoreMap } from './styles.ts';
import { noise, untracedMaterial } from './surroundings.ts';

/**
 * Ground that rises and falls, and the sea round it (a level's `terrain` and `sea`): the
 * terrain drawn as the very triangles players walk on, painted sand along the shore and down
 * under the water, grass on the higher ground and bare earth on the steepest (the level's own
 * rocks stand on it); and the sea, flat at its level from the shore out to the horizon, its
 * shallows, depths and foam following the shore wherever it runs (see `shoreField`).
 */

/** Set on the terrain's mesh, so what looks for the ground's own mesh can tell it. */
export const TERRAIN = 'terrain';

/** How far the sea bed slopes on down past the terrain's edge, in metres. */
const SKIRT = 14;
/**
 * The rings of the sea bed out past the terrain's edge, as how far out each is: sloping down to
 * `SKIRT`, then flat on out under the far sea. Looked across at a slant, the line of sight
 * passes over the brow of the slope and on down under the far sea: without a bed there, the sky
 * showed through the near sea.
 */
const SKIRT_RINGS = [0, 1, 2.5, 4.5, 7, 10, SKIRT, 60, 260];
/** How far under the sea the sea bed lies at the skirt's end. */
const SEABED_DEPTH = 6;
/**
 * How far out past the land the near sea reaches, which is see-through over the sea bed and
 * takes shadows; past it the far sea, opaque and taking none, runs on to the horizon. Within the
 * skirt, so there is always a bed under the near sea.
 */
const NEAR_SEA = 12;
/**
 * How far out the far sea's rings reach: past the camera's far plane. The first starts half a
 * metre in under the near sea's edge (which is drawn over it), so no pinholes open between them.
 */
const SEA_RINGS = [NEAR_SEA - 0.5, 20, 35, 60, 100, 160, 260];
/**
 * The shore map's texels, in metres, and how far past the land it reaches: far enough that the
 * distance from the shore and the depth have both run up to their most (`SHORE_RANGE` and
 * `DEPTH_RANGE`) by its edges, as the water past them is drawn.
 */
const FIELD_CELL = 0.125;
const FIELD_MARGIN = 10;
/**
 * Boxes standing in the sea that the water laps round (their models fill their boxes, or a
 * round one inscribed in it), as land in the shore map when their models are not to hand.
 */
const IN_THE_SEA: Partial<Record<NonNullable<BoxDef['model']>, 'round' | 'square'>> = {
  boulder: 'round',
  rock: 'round',
  post: 'square',
  piling: 'round',
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const grow = (r: FloorRect, by: number): FloorRect => ({
  x0: r.x0 - by,
  z0: r.z0 - by,
  x1: r.x1 + by,
  z1: r.z1 + by,
});

/** The rectangle all of a level's terrain covers (rival teams' two pieces together). */
export function landRect(level: LevelDef): FloorRect {
  const rects = (level.terrain ?? []).map(terrainRect);
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    z0: Math.min(...rects.map((r) => r.z0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    z1: Math.max(...rects.map((r) => r.z1)),
  };
}

/** How far (`x`, `z`) is out past `r` (0 inside it). */
const past = (r: FloorRect, x: number, z: number) =>
  Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

/**
 * The height of the bed under (`x`, `z`): the terrain's over it, and past its edge the skirt,
 * sloping on down from the edge's height to `SEABED_DEPTH` under the sea.
 */
export function seabedHeight(level: LevelDef, land: FloorRect, x: number, z: number): number {
  const h = groundHeight(level, x, z);
  const out = past(land, x, z);
  if (out <= 0) return h;
  const deep = (level.sea ?? h) - SEABED_DEPTH;
  return h + (Math.min(deep, h) - h) * smooth(0, SKIRT, out);
}

/**
 * How high above the sea the grass starts, on the whole (see `paintGround`): over the warm sand
 * of the beaches and the low ground behind them, where the grass grows only in patches, up to
 * the rolling grass of the hills.
 */
export const GRASS_LINE = 1.1;

/**
 * What the ground is at a point of the terrain `y` high whose normal rises `ny`: how grassy and
 * how rocky (`out`, each 0 to 1, see `GROUND_ATTRIBUTE`). Sand along the shore and on up over
 * the low ground, to a line that wanders up and down, and under the sea; grass above it, in
 * broad patches reaching down into the sand and with sandy clearings in it; rocky where it is
 * steep, a bank of bare earth where nothing grows and stones lie about; and the ground worn back
 * to sand round what players come to and along the ways between (see `wornGround`).
 */
export function paintGround(
  level: LevelDef,
  x: number,
  y: number,
  z: number,
  ny: number,
  out: { grass: number; rock: number },
): void {
  const above = y - (level.sea ?? -1e3);
  const wide = noise(x * 0.3, z * 0.3, 41) - 0.5;
  const fine = noise(x * 0.8, z * 0.8, 43) - 0.5;
  // Patches a dozen metres across: sandy clearings in the grass, or the grass reaching a little
  // further down toward the shore.
  const patch = noise(x * 0.14 + 3.3, z * 0.14 - 1.7, 47) - 0.5;
  // Where the grass starts above the sea: higher on the open beaches, lower in their hollows.
  const line = GRASS_LINE + wide * 0.6 + fine * 0.2 - patch * (patch > 0 ? 0.6 : 1.6);
  out.grass = smooth(line - 0.4, line + 0.4, above) * (1 - wornAt(level, x, z));
  const slope = ny > 0.05 ? Math.sqrt(1 - ny * ny) / ny : 20;
  out.rock = smooth(0.85, 1.15, slope + wide * 0.5);
}

/**
 * Ground worn bare by feet (see `wornGround`): rectangles worn bare out to `by` round them, and
 * the ways between them, each a line from (`ax`, `az`) to (`bx`, `bz`).
 */
export interface Worn {
  patches: { r: FloorRect; by: number }[];
  ways: { ax: number; az: number; bx: number; bz: number }[];
}

/** How far either side of its line a way is worn bare, and how far on it fades into the grass. */
const WAY = { bare: 0.45, fade: 0.6 };
/** How far round a place players come to is worn bare (see `wornGround`), and round a deck. */
const PLACE = 0.9;
const DECK_ROUND = 0.8;

const wornCache = new WeakMap<LevelDef, Worn>();

/**
 * Where a level's ground is worn bare by feet, worked out once: round the decks laid on the
 * ground, the doorways out of its buildings, the feet of its ladders and the spots players come
 * in at or go to (the catapult), and along the ways between them, the shortest that join every
 * one of those places to the rest (a minimum spanning tree), from the job site out.
 */
export function wornGround(level: LevelDef): Worn {
  const known = wornCache.get(level);
  if (known) return known;
  const patches: Worn['patches'] = [];
  const places: { x: number; z: number }[] = [];
  const place = (x: number, z: number, r: FloorRect, by: number) => {
    places.push({ x, z });
    patches.push({ r, by });
  };
  const at = (x: number, z: number): FloorRect => ({ x0: x, x1: x, z0: z, z1: z });
  for (const site of levelSites(level)) {
    const half = BASEPLATE_SIZE / 2;
    const [x, z] = [site.baseplate.x + half, site.baseplate.z + half];
    place(x, z, { x0: x - half, x1: x + half, z0: z - half, z1: z + half }, PLACE);
    place(site.spawn.x, site.spawn.z, at(site.spawn.x, site.spawn.z), PLACE * 1.4);
  }
  for (const b of level.boxes) {
    if (b.model !== 'deck') continue;
    const y0 = b.pos.y - b.size.y / 2;
    if (y0 - groundHeight(level, b.pos.x, b.pos.z) > 0.6) continue;
    const r = {
      x0: b.pos.x - b.size.x / 2,
      x1: b.pos.x + b.size.x / 2,
      z0: b.pos.z - b.size.z / 2,
      z1: b.pos.z + b.size.z / 2,
    };
    place(b.pos.x, b.pos.z, r, DECK_ROUND);
  }
  for (const s of roomSides(level)) {
    for (const d of s.doorways) {
      const u = (d.from + d.to) / 2;
      // A step out from the doorway, on the ground.
      const v = s.face - s.normal * (d.thickness + PLACE);
      const [x, z] = s.alongX ? [u, v] : [v, u];
      if (s.floor - groundHeight(level, x, z) > 0.6) continue;
      place(x, z, at(x, z), PLACE);
    }
  }
  for (const l of level.ladders) {
    if (l.pos.y - groundHeight(level, l.pos.x, l.pos.z) > 0.3) continue;
    place(l.pos.x, l.pos.z, at(l.pos.x, l.pos.z), PLACE);
  }
  if (level.catapult) {
    const c = level.catapult.pos;
    place(c.x, c.z, at(c.x, c.z), PLACE * 1.4);
  }
  // The shortest ways joining them all (Prim's), from the first job site's.
  const ways: Worn['ways'] = [];
  const linked = places.map((_, i) => i === 0);
  const best = places.map((p) => Math.hypot(p.x - places[0]!.x, p.z - places[0]!.z));
  const from = places.map(() => 0);
  for (let n = 1; n < places.length; n++) {
    let k = -1;
    for (let i = 0; i < places.length; i++) if (!linked[i] && (k < 0 || best[i]! < best[k]!)) k = i;
    linked[k] = true;
    const [a, b] = [places[from[k]!]!, places[k]!];
    ways.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    for (let i = 0; i < places.length; i++) {
      const d = Math.hypot(places[i]!.x - b.x, places[i]!.z - b.z);
      if (!linked[i] && d < best[i]!) [best[i], from[i]] = [d, k];
    }
  }
  const worn = { patches, ways };
  wornCache.set(level, worn);
  return worn;
}

/**
 * How worn bare the ground is at (`x`, `z`), from 0 to 1 (see `wornGround`): its edges wander,
 * so the ways look trodden rather than laid out.
 */
export function wornAt(level: LevelDef, x: number, z: number): number {
  if (!level.terrain?.length) return 0;
  const { patches, ways } = wornGround(level);
  const wander = (noise(x * 0.45, z * 0.45, 53) - 0.5) * 0.7;
  let worn = 0;
  for (const p of patches) {
    const d = past(p.r, x, z) + wander;
    worn = Math.max(worn, smooth(p.by + WAY.fade, p.by, d));
  }
  for (const w of ways) {
    const [dx, dz] = [w.bx - w.ax, w.bz - w.az];
    const t = Math.min(
      1,
      Math.max(0, ((x - w.ax) * dx + (z - w.az) * dz) / (dx * dx + dz * dz || 1)),
    );
    const d = Math.hypot(x - w.ax - dx * t, z - w.az - dz * t) + wander;
    worn = Math.max(worn, smooth(WAY.bare + WAY.fade, WAY.bare, d));
  }
  return worn;
}

/**
 * The level's terrain as one mesh: every piece's triangles exactly as the physics has them (see
 * `terrainTriangles`), and the sea bed round them sloping on down out of sight under the sea,
 * with smooth normals (shared across the seams between the pieces and the bed) and what the
 * ground is at each point from `paintGround`, for the shader to paint (see `Surface.Terrain`).
 * It casts shadows and takes them, ray traced too (into the sun's map from only its faces turned
 * away from the sun, see `castFromBackFaces`), and is never merged.
 */
export function terrainMesh(level: LevelDef): THREE.Mesh {
  const terrain = level.terrain ?? [];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const t of terrain) {
    const { vertices, indices: tris } = terrainTriangles(t);
    const base = positions.length / 3;
    for (const v of vertices) positions.push(v);
    for (const i of tris) indices.push(base + i);
  }

  // The bed: rings round the land, the first on its edge, on the terrain's own points.
  const land = landRect(level);
  const step = terrain[0]?.step ?? 0.5;
  const nx = Math.round((land.x1 - land.x0) / step);
  const nz = Math.round((land.z1 - land.z0) / step);
  const around = 2 * (nx + nz);
  const ringAt = (o: number, j: number): [number, number] => {
    const [x0, x1, z0, z1] = [land.x0 - o, land.x1 + o, land.z0 - o, land.z1 + o];
    const i = j % around;
    // Along the edges as the terrain's points are (an offset and whole steps), so the first
    // ring's points lie on them exactly.
    const sx = (x1 - x0) / nx;
    const sz = (z1 - z0) / nz;
    if (i < nx) return [x0 + i * sx, z0];
    if (i < nx + nz) return [x1, z0 + (i - nx) * sz];
    if (i < 2 * nx + nz) return [x1 - (i - nx - nz) * sx, z1];
    return [x0, z1 - (i - 2 * nx - nz) * sz];
  };
  const ringBase = positions.length / 3;
  for (const o of SKIRT_RINGS) {
    for (let j = 0; j < around; j++) {
      const [x, z] = ringAt(o, j);
      positions.push(x, seabedHeight(level, land, x, z), z);
    }
  }
  const at = (k: number, j: number) => ringBase + k * around + (j % around);
  const skirtFrom = indices.length;
  for (let k = 0; k + 1 < SKIRT_RINGS.length; k++) {
    for (let j = 0; j < around; j++) {
      const [a, b, c, d] = [at(k, j), at(k, j + 1), at(k + 1, j), at(k + 1, j + 1)];
      indices.push(a, c, d, a, d, b);
    }
  }
  // The rings' turn round the land may run either way: each triangle is turned to face up.
  const p = (i: number) => new THREE.Vector3().fromArray(positions, i * 3);
  for (let t = skirtFrom; t < indices.length; t += 3) {
    const [a, b, c] = [p(indices[t]!), p(indices[t + 1]!), p(indices[t + 2]!)];
    const n = b.sub(a).cross(c.sub(a));
    if (n.y < 0) [indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const normals = weldedNormals(positions, indices);

  const n = positions.length / 3;
  const ground = new Float32Array(n * 2);
  const w = { grass: 0, rock: 0 };
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    paintGround(level, x, y, z, normals[i * 3 + 1]!, w);
    ground.set([w.grass, w.rock], i * 2);
  }
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute(GROUND_ATTRIBUTE, new THREE.BufferAttribute(ground, 2));
  geometry.computeBoundingSphere();

  const material = madeOf(new THREE.MeshStandardMaterial({ roughness: 0.92 }), Surface.Terrain);
  material.userData[SEA_LEVEL] = level.sea ?? -1e3;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData[NO_FILL] = true;
  mesh.userData[NO_MERGE] = true;
  mesh.userData[TERRAIN] = true;
  castFromBackFaces(mesh);
  return mesh;
}

/**
 * How far a face may turn toward the light (the cosine) and still be drawn into its shadow map:
 * a little past side on, so that none the GPU might draw is left out.
 */
const SIDE_ON = 0.02;

/**
 * Draws only the faces of `mesh` turned away from the light into a directional light's shadow
 * map. A front-sided material casts from its back faces (three.js draws the far side into the
 * map, see `Material.shadowSide`), so those turned to the light never reach the map anyway, and
 * it is just as it was; but each was still sent to the GPU every frame, only to be culled. On
 * the island's ground that is all but a few hundred of its 19 thousand triangles. The triangles
 * are put in order once for the way the light comes from (see `facesFromLightFirst`), again only
 * if it turns, and the shadow's draw stops where those turned away end. A lamp's map (not
 * orthographic) has them all.
 */
function castFromBackFaces(mesh: THREE.Mesh): void {
  const toLight = new THREE.Vector3();
  const sortedFor = new THREE.Vector3();
  const toLocal = new THREE.Matrix4();
  let away = -1;
  mesh.onBeforeShadow = (renderer, _scene, _camera, shadowCamera, geometry) => {
    const material = mesh.material as THREE.Material;
    const fromBack =
      material.shadowSide === null &&
      material.side === THREE.FrontSide &&
      renderer.shadowMap.type !== THREE.VSMShadowMap;
    if (!fromBack || !(shadowCamera as THREE.OrthographicCamera).isOrthographicCamera) return;
    // The shadow camera looks down its own -z from the light: its +z is the way to the light.
    toLocal.copy(mesh.matrixWorld).invert();
    toLight.setFromMatrixColumn(shadowCamera.matrixWorld, 2).transformDirection(toLocal);
    if (away < 0 || toLight.dot(sortedFor) < 0.99999) {
      away = facesFromLightFirst(geometry, toLight);
      sortedFor.copy(toLight);
    }
    geometry.setDrawRange(0, away * 3);
  };
  mesh.onAfterShadow = (_renderer, _scene, _camera, _shadowCamera, geometry) => {
    geometry.setDrawRange(0, Infinity);
  };
}

/**
 * Puts an indexed geometry's triangles in order (each keeping its own winding): first every one
 * turned away from `toLight` (a direction in its own frame), or no more than `SIDE_ON` toward
 * it, then the rest. Returns how many come first.
 */
function facesFromLightFirst(geometry: THREE.BufferGeometry, toLight: THREE.Vector3): number {
  const index = geometry.index!;
  const pos = geometry.attributes.position!;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const away: number[] = [];
  const toward: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const [i, j, k] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, j).sub(a);
    c.fromBufferAttribute(pos, k).sub(a);
    const n = b.cross(c);
    (n.dot(toLight) <= SIDE_ON * n.length() ? away : toward).push(i, j, k);
  }
  const array = index.array;
  for (let t = 0; t < away.length; t++) array[t] = away[t]!;
  for (let t = 0; t < toward.length; t++) array[away.length + t] = toward[t]!;
  index.needsUpdate = true;
  return away.length / 3;
}

/**
 * Smooth normals for an indexed mesh, the faces round each point weighted by their area, and
 * every point at the same place given the same normal: where the terrain's pieces meet each
 * other and the sea bed, their points are their own, but the ground runs on smoothly over them.
 */
function weldedNormals(positions: number[], indices: number[]): Float32Array {
  const keyOf = (i: number) =>
    `${Math.round(positions[i * 3]! * 1000)},${Math.round(positions[i * 3 + 2]! * 1000)}`;
  const n = positions.length / 3;
  const keys = Array.from({ length: n }, (_, i) => keyOf(i));
  const sums = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < indices.length; t += 3) {
    const [i, j, k] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    a.fromArray(positions, i * 3);
    b.fromArray(positions, j * 3).sub(a);
    c.fromArray(positions, k * 3).sub(a);
    // The cross product's length is twice the face's area: weighted by it.
    const face = b.cross(c);
    for (const v of [i, j, k]) {
      const key = keys[v]!;
      const sum = sums.get(key);
      if (sum) sum.add(face);
      else sums.set(key, face.clone());
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = sums.get(keys[i]!)?.normalize() ?? new THREE.Vector3(0, 1, 0);
    out.set([s.x, s.y, s.z], i * 3);
  }
  return out;
}

/**
 * Works out the level's shore map (see `ShoreMap`) when it has a sea: over its land and the
 * sea round it, how far each point of the sea is from the nearest shore (where the ground, or
 * anything standing in the sea, comes out of it) and how deep it is there. The distance is
 * exact, from a distance transform of which texels are dry.
 *
 * What stands in the sea is taken from `standing`, the models drawn for the level's boxes, where
 * each crosses the waterline: so a mooring post, a great rock, a ship's hull or the foot of a
 * fence post is ringed with foam, as near its own outline as the map's texels go. Without them,
 * from the level's boxes of rock and posts (see `IN_THE_SEA`). Null without a sea.
 */
export function shoreField(level: LevelDef, standing?: THREE.Object3D[]): ShoreMap | null {
  if (level.sea === undefined || !level.terrain?.length) return null;
  const sea = level.sea;
  const land = landRect(level);
  const r = grow(land, FIELD_MARGIN);
  const w = Math.ceil((r.x1 - r.x0) / FIELD_CELL);
  const h = Math.ceil((r.z1 - r.z0) / FIELD_CELL);
  const depth = new Float32Array(w * h);
  /**
   * Squared distances, in texels, from the shore (0 on dry land, as good as endless at sea to
   * start with), and from whatever stands in the sea, apart: its foam is narrower.
   */
  const d2 = new Float64Array(w * h);
  const t2 = new Float64Array(w * h);
  const FAR = 1e12;
  t2.fill(FAR);
  for (let j = 0; j < h; j++) {
    const z = r.z0 + (j + 0.5) * FIELD_CELL;
    for (let i = 0; i < w; i++) {
      const x = r.x0 + (i + 0.5) * FIELD_CELL;
      const under = sea - seabedHeight(level, land, x, z);
      depth[j * w + i] = under;
      d2[j * w + i] = under > 0 ? FAR : 0;
    }
  }
  for (const o of standing ?? []) {
    waterline(o, sea, (x, z) => {
      const i = Math.floor((x - r.x0) / FIELD_CELL);
      const j = Math.floor((z - r.z0) / FIELD_CELL);
      if (i >= 0 && j >= 0 && i < w && j < h) t2[j * w + i] = 0;
    });
  }
  for (const b of standing ? [] : level.boxes) {
    const shape = b.model && IN_THE_SEA[b.model];
    if (!shape || b.tiltX) continue;
    if (b.pos.y - b.size.y / 2 > sea || b.pos.y + b.size.y / 2 < sea) continue;
    const [hx, hz] = [b.size.x / 2, b.size.z / 2];
    const i0 = Math.max(0, Math.floor((b.pos.x - hx - r.x0) / FIELD_CELL));
    const i1 = Math.min(w - 1, Math.ceil((b.pos.x + hx - r.x0) / FIELD_CELL));
    const j0 = Math.max(0, Math.floor((b.pos.z - hz - r.z0) / FIELD_CELL));
    const j1 = Math.min(h - 1, Math.ceil((b.pos.z + hz - r.z0) / FIELD_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const u = (r.x0 + (i + 0.5) * FIELD_CELL - b.pos.x) / hx;
        const v = (r.z0 + (j + 0.5) * FIELD_CELL - b.pos.z) / hz;
        // A round rock's foot is narrower than its box at the waterline.
        const inside = shape === 'round' ? u * u + v * v < 0.8 : Math.abs(u) < 1 && Math.abs(v) < 1;
        if (inside) t2[j * w + i] = 0;
      }
    }
  }
  distanceTransform(d2, w, h);
  distanceTransform(t2, w, h);

  const data = new Uint8Array(w * h * 4);
  // From the texel's middle to the nearest dry texel's, less the half a texel the shore lies in
  // from it; as its square root, for finer steps near the shore, where the foam is.
  const shore = (d: number) => {
    const dist = d === 0 ? 0 : Math.max(0, (Math.sqrt(d) - 0.5) * FIELD_CELL);
    return Math.round(Math.sqrt(Math.min(1, dist / SHORE_RANGE)) * 255);
  };
  for (let k = 0; k < w * h; k++) {
    data[k * 4] = shore(d2[k]!);
    data[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, depth[k]!) / DEPTH_RANGE) * 255);
    data[k * 4 + 2] = shore(t2[k]!);
    data[k * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return {
    texture,
    rect: { x0: r.x0, z0: r.z0, x1: r.x0 + w * FIELD_CELL, z1: r.z0 + h * FIELD_CELL },
  };
}

/**
 * Where the meshes under `root` cross the level `y`: every point along the lines their
 * triangles cut across it, a texel of the shore map apart at most, handed to `mark` (`x`, `z`).
 * Meshes wholly above or below it are passed over without looking at their triangles, and so
 * are see-through ones, which the sea does not lap round: a lantern's pool of light draped over
 * the ground (down under the water where the shore shelves away under it), a glow, a pane.
 */
export function waterline(
  root: THREE.Object3D,
  y: number,
  mark: (x: number, z: number) => void,
): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const cut: THREE.Vector3[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.attributes.position : undefined;
    if (!pos) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every((m) => m.transparent || m.userData[GLOW_POOL])) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    box.copy(geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    if (box.min.y > y || box.max.y < y) return;
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    for (let k = 0; k + 2 < count; k += 3) {
      for (let v = 0; v < 3; v++) {
        tri[v]!.fromBufferAttribute(pos, index ? index.getX(k + v) : k + v);
        tri[v]!.applyMatrix4(mesh.matrixWorld);
      }
      cut.length = 0;
      for (let v = 0; v < 3; v++) {
        const [a, b] = [tri[v]!, tri[(v + 1) % 3]!];
        if (a.y < y === b.y < y) continue;
        cut.push(a.clone().lerp(b, (y - a.y) / (b.y - a.y)));
      }
      if (cut.length < 2) continue;
      const [a, b] = [cut[0]!, cut[1]!];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (FIELD_CELL * 0.5)));
      for (let s = 0; s <= n; s++) mark(a.x + ((b.x - a.x) * s) / n, a.z + ((b.z - a.z) * s) / n);
    }
  });
}

/**
 * Squared Euclidean distances on a `w` by `h` grid, in place: each cell's to the nearest cell
 * that starts at 0 (Felzenszwalb and Huttenlocher's two passes of lower envelopes of parabolas,
 * down the columns and then along the rows).
 */
export function distanceTransform(f: Float64Array, w: number, h: number): void {
  const n = Math.max(w, h);
  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const pass = (count: number) => {
    // Where each parabola is the lowest: the ones in `v`, from `z[k]` to `z[k + 1]`.
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    const cross = (q: number, p: number) => (line[q]! + q * q - (line[p]! + p * p)) / (2 * (q - p));
    for (let q = 1; q < count; q++) {
      let s = cross(q, v[k]!);
      while (s <= z[k]!) s = cross(q, v[--k]!);
      v[++k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < count; q++) {
      while (z[k + 1]! < q) k++;
      const p = v[k]!;
      out[q] = (q - p) * (q - p) + line[p]!;
    }
  };
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) line[j] = f[j * w + i]!;
    pass(h);
    for (let j = 0; j < h; j++) f[j * w + i] = out[j]!;
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) line[i] = f[j * w + i]!;
    pass(w);
    for (let i = 0; i < w; i++) f[j * w + i] = out[i]!;
  }
}

/** The open sea's blue (the water's colour is painted, see `paintedDetail`). */
const DEEP = new THREE.Color(0x1b5a9c);

/**
 * The sea round the level's land, flat at its level: the near sea, see-through over the sea bed
 * and taking shadows, and the far sea, opaque and taking none, in rings out past where the
 * camera sees. Both are painted from `field` (the shore map) alike: turquoise in the shallows,
 * blue over the deep, foam along the shore. The near sea is drawn a hair nearer the camera
 * than it is, so where the beach runs out level with it the water wins rather than flickering
 * with the sand, and over the edge of the far sea under its own.
 */
export function seaMeshes(level: LevelDef, field: ShoreMap | null): THREE.Mesh[] {
  const sea = level.sea ?? 0;
  const land = landRect(level);
  const near = grow(land, NEAR_SEA);
  // One sheet (wound to face up): the shader paints all there is to it.
  const nearGeometry = new THREE.BufferGeometry();
  nearGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [near.x0, sea, near.z0, near.x1, sea, near.z0, near.x0, sea, near.z1, near.x1, sea, near.z1],
      3,
    ),
  );
  nearGeometry.setIndex([0, 2, 1, 1, 2, 3]);
  flatNormals(nearGeometry);
  const nearMaterial = madeOf(
    new THREE.MeshStandardMaterial({
      color: DEEP,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    }),
    Surface.Water,
  );
  if (field) nearMaterial.userData[SHORE_MAP] = field;
  const nearSea = new THREE.Mesh(nearGeometry, nearMaterial);
  nearSea.receiveShadow = true;

  // The far sea: frames round the near one, each a ring further out.
  const far: number[] = [];
  for (let k = 0; k + 1 < SEA_RINGS.length; k++) {
    const a = grow(land, SEA_RINGS[k]!);
    const b = grow(land, SEA_RINGS[k + 1]!);
    // Round the frame: its outer corners and inner corners, in turn.
    const outer = [
      [b.x0, b.z0],
      [b.x1, b.z0],
      [b.x1, b.z1],
      [b.x0, b.z1],
    ];
    const inner = [
      [a.x0, a.z0],
      [a.x1, a.z0],
      [a.x1, a.z1],
      [a.x0, a.z1],
    ];
    for (let s = 0; s < 4; s++) {
      const [o0, o1, i0, i1] = [outer[s]!, outer[(s + 1) % 4]!, inner[s]!, inner[(s + 1) % 4]!];
      // Wound to face up.
      far.push(o0[0]!, sea, o0[1]!, i0[0]!, sea, i0[1]!, o1[0]!, sea, o1[1]!);
      far.push(o1[0]!, sea, o1[1]!, i0[0]!, sea, i0[1]!, i1[0]!, sea, i1[1]!);
    }
  }
  const farGeometry = new THREE.BufferGeometry();
  farGeometry.setAttribute('position', new THREE.Float32BufferAttribute(far, 3));
  flatNormals(farGeometry);
  const farMaterial = untracedMaterial(
    madeOf(
      new THREE.MeshStandardMaterial({ color: DEEP, roughness: 0.15, metalness: 0.1 }),
      Surface.Water,
    ),
    false,
  );
  if (field) farMaterial.userData[SHORE_MAP] = field;
  const farSea = new THREE.Mesh(farGeometry, farMaterial);
  // Drawn after the level, which hides much of it.
  farSea.renderOrder = 1;

  for (const m of [nearSea, farSea]) {
    m.userData[NO_FILL] = true;
    m.userData[NO_MERGE] = true;
    m.geometry.computeBoundingSphere();
  }
  return [nearSea, farSea];
}

/** Normals straight up, for a flat sheet of water (made to face up). */
function flatNormals(geometry: THREE.BufferGeometry): void {
  const n = geometry.attributes.position!.count;
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}
