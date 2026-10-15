import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Surface } from '../render/styles.ts';
import { C, group, mat, part, rng } from './kit.ts';
import { painted } from './paint.ts';
import { put } from './parts.ts';
import { finish, rod } from './shape.ts';
import type { Solids } from './walk.ts';

/**
 * The island's growing things and stone: palms with broad, ragged, bright fronds; leafy bushes;
 * and great grey rocks cut in big flat faces with their edges worn light, as in the reference.
 */

const colour = new THREE.Color();

/** Paints a geometry's vertices from `pick(x, y, z, normal y)` (sRGB hex), for vertex colours. */
function paint(
  g: THREE.BufferGeometry,
  pick: (x: number, y: number, z: number, ny: number, i: number) => number,
): void {
  const pos = g.attributes.position!;
  const nor = g.attributes.normal;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colour.set(pick(pos.getX(i), pos.getY(i), pos.getZ(i), nor ? nor.getY(i) : 0, i));
    out.set([colour.r, colour.g, colour.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
}

/**
 * A great rock: the hull of a scatter of points round a squared-off slab, so it is cut into a
 * few big flat faces, as the reference's are; its edges rounded off and worn light, its faces
 * brushed with painted stone, lighter where they turn up to the sky and cooler down its sides
 * and under it. `sx × sy × sz`, resting on its foot.
 */
export function rock(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  seed: number,
  yaw = 0,
  tilt = 0,
): THREE.Group {
  const r = rng(seed);
  const g = group(parent, x, y, z, yaw);
  const points: THREE.Vector3[] = [];
  const n = Math.max(sx, sy, sz) > 6 ? 24 : 15;
  for (let i = 0; i < n; i++) {
    // Toward the slab's surface: each point pushed out to its box's sides in one of its axes.
    const p = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    const axis = Math.floor(r() * 3);
    p.setComponent(axis, Math.sign(p.getComponent(axis)) * (0.78 + r() * 0.22));
    // The corners cut off, so it is a rock and not a box.
    const corner = Math.abs(p.x) + Math.abs(p.y) * 0.8 + Math.abs(p.z);
    if (corner > 2.3) p.multiplyScalar(2.3 / corner);
    // Narrower toward its top, as weathered stacks are.
    const up = (p.y + 1) / 2;
    p.x *= 1 - up * 0.14;
    p.z *= 1 - up * 0.1;
    points.push(new THREE.Vector3(p.x * sx * 0.5, (p.y + 1) * 0.5 * sy, p.z * sz * 0.5));
  }
  for (const [a, b] of [
    [-0.42, -0.4],
    [0.45, -0.38],
    [0.4, 0.42],
    [-0.44, 0.4],
  ] as const)
    points.push(new THREE.Vector3(a * sx, -0.05 * sy, b * sz));
  // Only a little uneven: deeper dents shade themselves into dark streaks.
  const geo = roundedHull(new ConvexGeometry(points), Math.min(0.18, Math.min(sx, sy, sz) * 0.025));
  const m = put(g, geo, painted('stone', 0xdcdcdc, { roughness: 0.9 }));
  m.rotation.z = tilt;
  if (solids) solids.box(g, 0, 0, 0, sx * 0.72, sy * 0.9, sz * 0.72);
  return g;
}

/**
 * A convex hull made ready to paint as a hand-made rock: each face cut into small triangles, so
 * its edges can be rounded (their normals bent toward their neighbours') and painted light while
 * its faces stay flat; textured with stone; lit from above in its vertex colours.
 */
function roundedHull(hull: THREE.BufferGeometry, wobble: number): THREE.BufferGeometry {
  const src = hull.attributes.position as THREE.BufferAttribute;
  const k = 5;
  const pos: number[] = [];
  const flat: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const at = (i: number, j: number) =>
    new THREE.Vector3()
      .addScaledVector(a, 1 - (i + j) / k)
      .addScaledVector(b, i / k)
      .addScaledVector(c, j / k);
  for (let t = 0; t < src.count; t += 3) {
    a.fromBufferAttribute(src, t);
    b.fromBufferAttribute(src, t + 1);
    c.fromBufferAttribute(src, t + 2);
    const nrm = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k - i; j++) {
        const tris = [[at(i, j), at(i + 1, j), at(i, j + 1)]];
        if (i + j < k - 1) tris.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
        for (const tri of tris) {
          for (const p of tri) {
            pos.push(p.x, p.y, p.z);
            flat.push(nrm);
          }
        }
      }
  }
  // Each point's faces: where they differ, it is on an edge.
  const key = (i: number) =>
    `${Math.round(pos[i * 3]! * 1000)},${Math.round(pos[i * 3 + 1]! * 1000)},${Math.round(pos[i * 3 + 2]! * 1000)}`;
  const sums = new Map<string, THREE.Vector3>();
  const count = pos.length / 3;
  for (let i = 0; i < count; i++) {
    const kk = key(i);
    const s = sums.get(kk) ?? new THREE.Vector3();
    s.add(flat[i]!);
    sums.set(kk, s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const normals = new Float32Array(count * 3);
  const edge = new Float32Array(count);
  const shift = new Map<string, THREE.Vector3>();
  for (let i = 0; i < count; i++) {
    const kk = key(i);
    const smooth = sums.get(kk)!.clone().normalize();
    const f = flat[i]!;
    const e = Math.min(1, (1 - f.dot(smooth)) * 10);
    edge[i] = e;
    const n = f
      .clone()
      .lerp(smooth, 0.6 * e)
      .normalize();
    normals.set([n.x, n.y, n.z], i * 3);
    // The edges pulled in a little, so they read rounded, and the whole a touch uneven.
    if (!shift.has(kk)) {
      const h =
        Math.sin(pos[i * 3]! * 12.9 + pos[i * 3 + 1]! * 78.2 + pos[i * 3 + 2]! * 37.7) * 43758.5;
      shift.set(
        kk,
        smooth.clone().multiplyScalar(-wobble * e * 2 + (h - Math.floor(h) - 0.5) * wobble),
      );
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const done = finish(geo, 'stone', { edge: 0, shade: 0.35, seed: 5, vary: 0 }, 'none');
  const p = done.attributes.position as THREE.BufferAttribute;
  const col = done.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < count; i++) {
    const s = shift.get(key(i))!;
    const ny = normals[i * 3 + 1]!;
    const lit = (ny > 0.45 ? 1.08 : ny < -0.3 ? 0.7 : 0.96) * (1 + 0.4 * edge[i]!);
    col.setXYZ(
      i,
      col.getX(i) * lit * 1.02,
      col.getY(i) * lit,
      col.getZ(i) * lit * (ny < 0.2 ? 1.06 : 0.98),
    );
    p.setXYZ(i, p.getX(i) + s.x, p.getY(i) + s.y, p.getZ(i) + s.z);
  }
  return done;
}

/**
 * A palm: a ringed trunk curving up `height` metres, leaning toward `lean` (a yaw), with a crown
 * of broad drooping leaves, bright yellow-green, cupped along their ribs and split here and
 * there at their edges, as the reference's are.
 */
export function palm(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  height: number,
  lean: number,
  bend: number,
  seed: number,
): THREE.Group {
  const r = rng(seed);
  const g = group(parent, x, y, z, lean);
  const spine = (t: number) =>
    new THREE.Vector3(
      Math.sin(t * 3 + seed) * 0.12 * height * t,
      t * height,
      -bend * height * t * t,
    );
  const rings = Math.round(height / 0.38);
  const bark = painted('wood', 0xd9c0a6, { roughness: 0.95 });
  for (let i = 0; i < rings; i++) {
    const [t0, t1] = [i / rings, (i + 1) / rings];
    const [p0, p1] = [spine(t0), spine(t1)];
    const rad = 0.27 * (1 - t0 * 0.4);
    const seg = rod(rad * 1.12, rad * 0.86, p0.distanceTo(p1) * 1.06, 'wood', {
      seed: seed * 31 + i,
      sides: 9,
      edge: 0.6,
      shade: 0.45,
      bevel: 0.03,
      vary: 0.14,
    });
    const m = put(g, seg, bark);
    m.position.copy(p0).lerp(p1, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
  }
  if (solids) solids.post(g, 0, 0, 0.3, 0, height);
  const top = spine(1);
  put(
    g,
    finish(
      new THREE.IcosahedronGeometry(0.32, 1),
      'wood',
      { edge: 0, shade: 0.4, seed: seed + 2, wobble: 0.05 },
      'none',
    ),
    painted('wood', 0x9c7a5c),
    top.x,
    top.y - 0.05,
    top.z,
  );
  const nut = painted('wood', 0x7a5a40, { roughness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r();
    put(
      g,
      finish(new THREE.IcosahedronGeometry(0.16, 1), 'wood', { edge: 0, seed: seed + i }, 'none'),
      nut,
      top.x + Math.cos(a) * 0.22,
      top.y - 0.28,
      top.z + Math.sin(a) * 0.22,
    );
  }
  const leaves = 7 + Math.floor(r() * 3);
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + r() * 0.5;
    const len = height * (0.36 + r() * 0.1) + 1.4;
    const droop = 0.9 + r() * 0.6;
    const up = i % 3 === 0 ? 0.75 : 0.35;
    leaf(g, top, a, len, droop, up, seed * 13 + i);
  }
  return g;
}

/**
 * One broad leaf from `base` toward yaw `a`, `len` long: rising by `up` then drooping by
 * `droop` (radians over its length), widest past its middle, cupped along its rib, its edges
 * split in a few places; painted leaf, darker by its rib and its foot, light at its rim.
 */
function leaf(
  parent: THREE.Object3D,
  base: THREE.Vector3,
  a: number,
  len: number,
  droop: number,
  up: number,
  seed: number,
) {
  const r = rng(seed);
  const segs = 12;
  const across = [-1, -0.55, 0, 0.55, 1];
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const rib: THREE.Vector3[] = [];
  const p = base.clone();
  for (let i = 0; i <= segs; i++) {
    rib.push(p.clone());
    const t = i / segs;
    const pitch = up - (up + droop) * t ** 1.2;
    p.addScaledVector(dir, (len / segs) * Math.cos(pitch)).add(
      new THREE.Vector3(0, (len / segs) * Math.sin(pitch), 0),
    );
  }
  // Where the edge is split: a few places along each side.
  const splits = new Set<string>();
  for (let k = 0; k < 4; k++)
    splits.add(`${2 + Math.floor(r() * (segs - 3))},${r() < 0.5 ? 0 : 3}`);
  const width = (t: number) =>
    len *
    0.2 *
    Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.05)) ** 0.6 *
    (0.5 + 0.5 * Math.min(1, t * 4));
  const twist = (r() - 0.5) * 0.5;
  const grid: THREE.Vector3[][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = width(t);
    const row: THREE.Vector3[] = [];
    for (const s of across) {
      const cup = (1 - Math.abs(s)) * 0 + Math.abs(s) ** 1.6 * w * 0.35;
      const sway = s * twist * w * 0.3;
      row.push(
        rib[i]!.clone()
          .addScaledVector(side, s * w)
          .add(new THREE.Vector3(0, cup + sway, 0)),
      );
    }
    grid.push(row);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const push = (i: number, j: number) => {
    const v = grid[i]![j]!;
    pos.push(v.x, v.y, v.z);
    const t = i / segs;
    const s = across[j]!;
    uv.push((t * len) / 1.2, (s * width(t)) / 1.2 + 0.5);
    // Dark at its foot and by its rib, bright toward its rim and tip.
    const k = (0.55 + 0.45 * Math.min(1, t * 2.5)) * (0.78 + 0.42 * Math.abs(s)) * (1 + 0.2 * t);
    col.push(k * 1.02, k, k * 0.92);
  };
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < across.length - 1; j++) {
      const outer = j === 0 ? 0 : j === across.length - 2 ? 3 : -1;
      if (outer >= 0 && splits.has(`${i},${outer}`)) continue;
      push(i, j);
      push(i + 1, j);
      push(i + 1, j + 1);
      push(i, j);
      push(i + 1, j + 1);
      push(i, j + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // Lit as if it faced up, both sides: a leaf's underside is shaded by the leaf, not flipped.
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++)
    if (nor.getY(i) < 0) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  put(parent, geo, painted('leaf', 0xffffff, { side: THREE.DoubleSide, roughness: 0.6 }));
}

/**
 * A leafy bush: a few soft lumps of painted leaves, lighter where they face up into the sun,
 * dark beneath, in `hex` (green, or the coral bush's red).
 */
export function bush(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  size: number,
  seed: number,
  hex: number = C.bush,
): THREE.Group {
  const r = rng(seed);
  const g = group(parent, x, y, z, r() * 6);
  const clumps = 3 + Math.floor(r() * 3);
  const tint = new THREE.Color(hex);
  // The moss texture is green; a red bush is tinted from it, greys and all.
  const red = tint.r > tint.g;
  const material = painted('moss', red ? 0xff5a48 : 0xffffff, { roughness: 0.85 });
  for (let c = 0; c < clumps; c++) {
    const a = r() * Math.PI * 2;
    const d = c === 0 ? 0 : size * (0.38 + r() * 0.25);
    const rad = size * (c === 0 ? 0.6 : 0.38 + r() * 0.16);
    const geo = new THREE.IcosahedronGeometry(rad, 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const h = Math.sin(v.x * 9.1 + v.y * 7.3 + v.z * 5.7 + seed) * 0.5 + 0.5;
      v.multiplyScalar(1 + (h - 0.5) * 0.22);
      if (v.y < -rad * 0.3) v.y = -rad * 0.3;
      p.setXYZ(i, v.x, v.y * 0.85, v.z);
    }
    geo.computeVertexNormals();
    const done = finish(
      geo,
      'moss',
      { edge: 0, shade: 0.55, seed: seed * 7 + c, vary: 0.1 },
      'none',
    );
    const col = done.attributes.color as THREE.BufferAttribute;
    const nor = done.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) {
      const lit = 0.85 + 0.4 * Math.max(0, nor.getY(i));
      col.setXYZ(i, col.getX(i) * lit, col.getY(i) * lit, col.getZ(i) * lit);
    }
    put(g, done, material, Math.cos(a) * d, rad * 0.55, Math.sin(a) * d);
  }
  return g;
}

/** Many small geometries (with the same attributes) as one. */
export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(parts[0]!.attributes);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = parts[0]!.attributes[name]!.itemSize;
    const total = parts.reduce((n, p) => n + p.attributes[name]!.count, 0);
    const arr = new Float32Array(total * size);
    let at = 0;
    for (const p of parts) {
      const a = p.attributes[name]!;
      for (let i = 0; i < a.count; i++)
        for (let c = 0; c < size; c++) arr[(at + i) * size + c] = a.getComponent(i, c);
      at += a.count;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/** A tuft of grass: a fan of blades, bright at their tips. */
export function tuft(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  size: number,
  seed: number,
): void {
  const r = rng(seed);
  const blades: THREE.BufferGeometry[] = [];
  const n = 9 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const h = size * (0.6 + r() * 0.6);
    const lean = 0.25 + r() * 0.5;
    const w = 0.035 * size * 4;
    const b = new THREE.BufferGeometry();
    const tipX = Math.cos(a) * h * lean;
    const tipZ = Math.sin(a) * h * lean;
    const sx = -Math.sin(a) * w;
    const sz = Math.cos(a) * w;
    b.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-sx, 0, -sz, sx, 0, sz, tipX, h, tipZ], 3),
    );
    paint(b, (_x, yy) => (yy > 0.01 ? 0x9fd24a : 0x4f8a26));
    blades.push(b);
  }
  const m = mergeAll(blades);
  m.computeVertexNormals();
  const mesh = part(
    parent,
    m,
    mat(0xffffff, Surface.Auto, { vertexColors: true, side: THREE.DoubleSide }),
    x,
    y,
    z,
  );
  mesh.castShadow = false;
}
