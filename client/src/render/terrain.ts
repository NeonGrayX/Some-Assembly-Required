import * as THREE from 'three';
import { groundHeight, terrainRect, terrainTriangles } from '@sar/shared';
import type { BoxDef, FloorRect, LevelDef } from '@sar/shared';
import { NO_FILL } from './furniture.ts';
import { NO_MERGE } from './merge.ts';
import {
  DEPTH_RANGE,
  GROUND_ATTRIBUTE,
  SEA_LEVEL,
  SHORE_MAP,
  SHORE_RANGE,
  Surface,
  TERRAIN_COLOURS,
  madeOf,
} from './styles.ts';
import type { ShoreMap } from './styles.ts';
import { noise, untracedMaterial } from './surroundings.ts';

/**
 * Ground that rises and falls, and the sea round it (a level's `terrain` and `sea`): the
 * terrain drawn as the very triangles players walk on, painted sand along the shore and down
 * under the water, grass on the higher ground and rock on the steepest; and the sea, flat at its
 * level from the shore out to the horizon, its shallows, depths and foam following the shore
 * wherever it runs (see `shoreField`).
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
/** The near sea's squares, in metres: its colour (by the depth) is set at their corners. */
const SEA_CELL = 1;
/**
 * How far out the far sea's rings reach: past the camera's far plane. The first starts half a
 * metre in under the near sea's edge (which is drawn over it): meeting edge to edge, the near
 * sea's many points along the far sea's one long edge would leave pinholes between them.
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
 * round one inscribed in it), as land in the shore map.
 */
const IN_THE_SEA: Partial<Record<NonNullable<BoxDef['model']>, 'round' | 'square'>> = {
  boulder: 'round',
  rock: 'round',
  post: 'square',
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

const colours = {
  sand: new THREE.Color(TERRAIN_COLOURS.sand),
  wet: new THREE.Color(TERRAIN_COLOURS.wet),
  seabed: new THREE.Color(TERRAIN_COLOURS.seabed),
  grass: new THREE.Color(TERRAIN_COLOURS.grass),
  rock: new THREE.Color(TERRAIN_COLOURS.rock),
  /** The grass's shade in its hollows and sunny patches, for the plain styles. */
  hollow: new THREE.Color(0x5f9a34),
  sunny: new THREE.Color(0xb3cf4c),
};
const _grass = new THREE.Color();

/**
 * What the ground is at a point of the terrain `y` high whose normal rises `ny`: how grassy and
 * how rocky (`out`, each 0 to 1, see `GROUND_ATTRIBUTE`), and its colour as the classic style
 * shows it (`colour`). Sand along the shore, to a line that wanders up and down the beach, and
 * under the sea; grass above it; rock where it is steep.
 */
export function paintGround(
  level: LevelDef,
  x: number,
  y: number,
  z: number,
  ny: number,
  out: { grass: number; rock: number },
  colour: THREE.Color,
): void {
  const above = y - (level.sea ?? -1e3);
  const wide = noise(x * 0.3, z * 0.3, 41) - 0.5;
  const fine = noise(x * 0.8, z * 0.8, 43) - 0.5;
  // Where the grass starts above the sea: higher on the open beaches, lower in their hollows.
  const line = 0.5 + wide * 0.5 + fine * 0.18;
  out.grass = smooth(line - 0.12, line + 0.12, above);
  const slope = ny > 0.05 ? Math.sqrt(1 - ny * ny) / ny : 20;
  out.rock = smooth(0.85, 1.15, slope + wide * 0.5);
  // Under the sea, greener and darker the deeper (as `terrainPick` paints it).
  colour
    .copy(colours.sand)
    .lerp(colours.wet, 1 - smooth(0.04, 0.14, above))
    .lerp(colours.seabed, smooth(0, 0.9, -above))
    .multiplyScalar(1 - 0.6 * smooth(1.2, 5, -above));
  _grass
    .copy(colours.hollow)
    .lerp(colours.grass, smooth(-0.3, 0.1, wide + fine))
    .lerp(colours.sunny, smooth(0.15, 0.45, wide + fine) * 0.6);
  colour.lerp(_grass, out.grass).lerp(colours.rock, out.rock);
}

/**
 * The level's terrain as one mesh: every piece's triangles exactly as the physics has them (see
 * `terrainTriangles`), and the sea bed round them sloping on down out of sight under the sea,
 * with smooth normals (shared across the seams between the pieces and the bed), painted by
 * `paintGround`. It casts shadows and takes them, ray traced too, and is never merged.
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
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

  const n = positions.length / 3;
  const colour = new Float32Array(n * 3);
  const ground = new Float32Array(n * 2);
  const c = new THREE.Color();
  const w = { grass: 0, rock: 0 };
  for (let i = 0; i < n; i++) {
    const [x, y, z] = [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
    paintGround(level, x, y, z, normals[i * 3 + 1]!, w, c);
    colour.set([c.r, c.g, c.b], i * 3);
    ground.set([w.grass, w.rock], i * 2);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  geometry.setAttribute(GROUND_ATTRIBUTE, new THREE.BufferAttribute(ground, 2));
  geometry.computeBoundingSphere();

  const material = madeOf(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
    Surface.Terrain,
  );
  material.userData[SEA_LEVEL] = level.sea ?? -1e3;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData[NO_FILL] = true;
  mesh.userData[NO_MERGE] = true;
  mesh.userData[TERRAIN] = true;
  return mesh;
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

/** A level's shore map, and the distances in it for the styles drawn from vertex colours. */
export interface Shores extends ShoreMap {
  /** How far (`x`, `z`) is out from the nearest shore, in metres: 0 on land, far past the map. */
  distance(x: number, z: number): number;
}

/**
 * Works out the level's shore map (see `ShoreMap`) when it has a sea: over its land and the
 * sea round it, how far each point of the sea is from the nearest shore (where the ground or a
 * rock standing in the sea comes out of it) and how deep it is there. The distance is exact,
 * from a distance transform of which texels are dry. Null without a sea.
 */
export function shoreField(level: LevelDef): Shores | null {
  if (level.sea === undefined || !level.terrain?.length) return null;
  const sea = level.sea;
  const land = landRect(level);
  const r = grow(land, FIELD_MARGIN);
  const w = Math.ceil((r.x1 - r.x0) / FIELD_CELL);
  const h = Math.ceil((r.z1 - r.z0) / FIELD_CELL);
  const depth = new Float32Array(w * h);
  /** Squared distances, in texels: 0 on dry land, as good as endless at sea to start with. */
  const d2 = new Float64Array(w * h);
  const FAR = 1e12;
  for (let j = 0; j < h; j++) {
    const z = r.z0 + (j + 0.5) * FIELD_CELL;
    for (let i = 0; i < w; i++) {
      const x = r.x0 + (i + 0.5) * FIELD_CELL;
      const under = sea - seabedHeight(level, land, x, z);
      depth[j * w + i] = under;
      d2[j * w + i] = under > 0 ? FAR : 0;
    }
  }
  for (const b of level.boxes) {
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
        if (inside) d2[j * w + i] = 0;
      }
    }
  }
  distanceTransform(d2, w, h);

  const data = new Uint8Array(w * h * 2);
  const dists = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) {
    // From the texel's middle to the nearest dry texel's, less the half a texel the shore lies
    // in from it.
    const dist = d2[k]! === 0 ? 0 : Math.max(0, (Math.sqrt(d2[k]!) - 0.5) * FIELD_CELL);
    dists[k] = dist;
    // The square root of the distance: finer steps near the shore, where the foam is.
    data[k * 2] = Math.round(Math.sqrt(Math.min(1, dist / SHORE_RANGE)) * 255);
    data[k * 2 + 1] = Math.round(Math.min(1, Math.max(0, depth[k]!) / DEPTH_RANGE) * 255);
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGFormat, THREE.UnsignedByteType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return {
    texture,
    rect: { x0: r.x0, z0: r.z0, x1: r.x0 + w * FIELD_CELL, z1: r.z0 + h * FIELD_CELL },
    distance: (x, z) => {
      const i = Math.floor((x - r.x0) / FIELD_CELL);
      const j = Math.floor((z - r.z0) / FIELD_CELL);
      return i < 0 || j < 0 || i >= w || j >= h ? 1e3 : dists[j * w + i]!;
    },
  };
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

const SHALLOW = new THREE.Color(0x46c4bd);
const DEEP = new THREE.Color(0x1b5a9c);

/**
 * The sea round the level's land, flat at its level: the near sea, see-through over the sea bed,
 * coloured turquoise in the shallows and blue over the deep (for the styles that do not paint
 * it from `field`, the painted one's shore map), taking shadows; and the far sea, opaque and
 * taking none, in rings out past where the camera sees. The painted style paints both from
 * `field` alike. Drawn a hair nearer the camera than it is, so where the beach runs out level
 * with it the water wins rather than flickering with the sand.
 */
export function seaMeshes(level: LevelDef, field: Shores | null): THREE.Mesh[] {
  const sea = level.sea ?? 0;
  const land = landRect(level);
  const near = grow(land, NEAR_SEA);
  const nx = Math.round((near.x1 - near.x0) / SEA_CELL);
  const nz = Math.round((near.z1 - near.z0) / SEA_CELL);
  const positions: number[] = [];
  const colour: number[] = [];
  const c = new THREE.Color();
  for (let k = 0; k <= nz; k++) {
    for (let i = 0; i <= nx; i++) {
      const x = near.x0 + i * SEA_CELL;
      const z = near.z0 + k * SEA_CELL;
      const under = sea - seabedHeight(level, land, x, z);
      // As the painted water's (see `paintedDetail`): turquoise along the shore.
      const out = field?.distance(x, z) ?? 1e3;
      c.copy(SHALLOW).lerp(DEEP, Math.max(smooth(1.2, 7, out), smooth(0.4, 2.8, under)));
      // Opaque at its edge, where the far sea goes on.
      const edge = Math.min(i, k, nx - i, nz - k);
      const alpha = Math.max(0.72 + 0.16 * smooth(0.2, 3, under), smooth(3, 0, edge));
      positions.push(x, sea, z);
      colour.push(c.r, c.g, c.b, alpha);
    }
  }
  const indices: number[] = [];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const a = k * (nx + 1) + i;
      // Wound to face up.
      indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const nearGeometry = new THREE.BufferGeometry();
  nearGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  nearGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 4));
  nearGeometry.setIndex(indices);
  flatNormals(nearGeometry);
  const nearMaterial = madeOf(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      // A hair nearer again than the far sea, over the edge of it under this.
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
      new THREE.MeshStandardMaterial({
        color: DEEP,
        roughness: 0.15,
        metalness: 0.1,
        // Brought as near as the near sea is, or the cartoon style inked the step where they meet.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
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
