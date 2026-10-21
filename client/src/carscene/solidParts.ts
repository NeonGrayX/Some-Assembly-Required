import * as THREE from 'three';
import { SOLID_SHAPES, packTriangles } from '@sar/shared';
import type { SceneMesh, SceneSolid } from '@sar/shared';
import { SHAPES, TUBES } from './kit.ts';
import { intangible, madeShape, triangles } from './meshWalk.ts';

/**
 * What is solid of the car scene's models, part by part as each is made, for a map of it to be
 * met as it is drawn (see `SceneSolid`): a box as a box, a ball, a can, a cone and a capsule as
 * themselves, a tube as a chain of capsules, a ring as the can it fills, and anything else (an
 * outline pushed out, a wall with its windows cut) as the few boxes that fill it, worked out
 * on a grid a few centimetres fine. Parts too small to stand in anyone's way are left out, and
 * so is a box that lies inside another.
 */

/** A part: its shape, middle and turn, and its size (a box's) or radius and height. */
export interface SolidPart {
  shape: (typeof SOLID_SHAPES)[number];
  at: THREE.Vector3;
  turn: THREE.Quaternion;
  size?: THREE.Vector3;
  r?: number;
  h?: number;
}

/** Bolts and the like stop nobody (m, across their longest). */
const LEAST = 0.05;
/** How fine the grid a shape is filled on is, at its finest (m). */
const CELL = 0.1;
/** How many cells a shape's grid has, at most. */
const CELLS = 4000;
/** How thin a flat part (a sign, a decal) is taken to be, if it is thinner (m). */
const THIN = 0.01;
/** How far out a squashed ball's can reaches, of its half width. */
const BULGE = 0.42;
/** How long each capsule along a tube is, at most (m). */
const LINK = 0.12;
/** How long each piece of a mesh's packed triangles is (see `SceneMesh`). */
const LINE = 96;

const UP = new THREE.Vector3(0, 1, 0);

/** How wide `b` is along `axis`. */

/** Whether `o` is walked through, not into: what cannot be (see `intangible`), and grass. */
export const passable = (o: THREE.Object3D): boolean =>
  intangible(o) || !!(o as THREE.Mesh).geometry?.userData.grass;

/**
 * Every solid part of what hangs from `root`, in the world, but for what `skip` says to leave
 * out (and all that hangs from it), and what is walked through (see `passable`) or hidden.
 */
export function solidParts(
  root: THREE.Object3D,
  skip: (o: THREE.Object3D) => boolean,
): SolidPart[] {
  root.updateMatrixWorld(true);
  const parts: SolidPart[] = [];
  const take = (o: THREE.Object3D) => {
    if (skip(o) || passable(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) parts.push(...partsOf(mesh));
    o.children.forEach(take);
  };
  take(root);
  return pruned(parts);
}

/** `mesh`'s solid parts, in the world. */
export function partsOf(mesh: THREE.Mesh): SolidPart[] {
  const geo = mesh.geometry;
  const span = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  if (Math.max(span.x, span.y, span.z) < LEAST) return [];
  if (TUBES.has(geo)) return links(mesh);
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const s = new THREE.Vector3();
  mesh.matrixWorld.decompose(at, turn, s);
  geo.computeBoundingBox();
  const bounds = geo.boundingBox!;
  const ext = bounds.getSize(new THREE.Vector3());
  const middle = bounds.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const made = SHAPES.get(geo) ?? geo;
  const p = (made as THREE.BufferGeometry & { parameters?: Record<string, number> }).parameters;
  const same = (a: number, b: number, by = 1e-3) =>
    Math.abs(a - b) <= by * Math.max(1, Math.abs(a));
  const whole = (angle: number | undefined, full: number) =>
    angle === undefined || angle >= full - 1e-3;
  const even = same(s.x, s.y) && same(s.y, s.z);
  const round = (shape: SolidPart['shape'], r: number, h: number, q = turn): SolidPart => ({
    shape,
    at: middle,
    turn: q.clone(),
    r,
    h,
  });
  /**
   * Something round about one of its own axes, as its bounds show (a disc stood on its edge, a
   * wheel's tyre, a ring), `wide` across and `deep` along that axis: the can it fills, or null.
   */
  const roundAbout = (wide: number, deep: number): SolidPart | null => {
    for (const axis of ['y', 'x', 'z'] as const) {
      const [u, v] = (['x', 'y', 'z'] as const).filter((a) => a !== axis);
      if (!same(ext[u!], wide, 0.02) || !same(ext[v!], wide, 0.02) || !same(ext[axis], deep, 0.02))
        continue;
      if (!same(s[u!], s[v!])) return null;
      const up = new THREE.Quaternion().setFromUnitVectors(UP, AXES[axis]);
      return round('can', (wide / 2) * s[u!], deep * s[axis], turn.clone().multiply(up));
    }
    return null;
  };
  if (p) {
    switch (made.type) {
      case 'BoxGeometry':
      case 'RoundedBoxGeometry': {
        // A box as made, unless it was turned in the making, when it is found as anything is.
        const made = [p.width!, p.height!, p.depth!].sort((a, b) => a - b);
        const got = [ext.x, ext.y, ext.z].sort((a, b) => a - b);
        if (made.every((d, i) => same(d, got[i]!, 0.01)))
          return [{ shape: 'box', at: middle, turn, size: ext.clone().multiply(s) }];
        break;
      }
      case 'SphereGeometry':
      case 'IcosahedronGeometry':
        if (even && whole(p.phiLength, 2 * Math.PI) && whole(p.thetaLength, Math.PI))
          return [round('ball', p.radius! * s.x * (made.type === 'SphereGeometry' ? 1 : 0.95), 0)];
        // A ball squashed or cut (a bush, a heap): the can it mostly fills, up its own y.
        return [round('can', BULGE * Math.min(ext.x * s.x, ext.z * s.z), ext.y * s.y)];
      case 'CylinderGeometry': {
        if (!whole(p.thetaLength, 2 * Math.PI)) break;
        if (same(p.radiusTop!, p.radiusBottom!)) {
          const can = roundAbout(2 * p.radiusTop!, p.height!);
          if (can) return [can];
        } else if (same(s.x, s.z) && same(ext.y, p.height!, 0.01)) {
          // A cone as made, its point up or down.
          if (p.radiusTop === 0) return [round('cone', p.radiusBottom! * s.x, p.height! * s.y)];
          if (p.radiusBottom === 0) {
            const over = new THREE.Quaternion().setFromAxisAngle(AXES.x, Math.PI);
            return [
              round('cone', p.radiusTop! * s.x, p.height! * s.y, turn.clone().multiply(over)),
            ];
          }
        }
        break;
      }
      case 'CapsuleGeometry': {
        const length = (p.length ?? p.height)!;
        if (even && same(ext.y, length + 2 * p.radius!, 0.01))
          return [round('capsule', p.radius! * s.x, length * s.y)];
        break;
      }
      case 'TorusGeometry': {
        // A ring as the can it fills.
        if (!whole(p.arc, 2 * Math.PI)) break;
        const can = roundAbout(2 * (p.radius! + p.tube!), 2 * p.tube!);
        if (can) return [can];
        break;
      }
    }
  }
  return filled(mesh);
}

/** Each axis, a unit long. */
const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * Anything else: found on a grid square to the way it lies (its own axes, or the way its
 * corners spread if that fits it closer), every cell its surface passes through and every cell
 * shut inside it filled, as the few boxes the cells make (a doorway in a wall stays open, and so
 * does the cabin of a car with no roof); or one box, if it fills its bounds.
 */
function filled(mesh: THREE.Mesh): SolidPart[] {
  const t = trianglesOf(mesh.geometry, mesh.matrixWorld);
  const turn = new THREE.Quaternion();
  mesh.matrixWorld.decompose(new THREE.Vector3(), turn, new THREE.Vector3());
  // Its own axes, or its spread's, whichever holds it in less.
  let frame = { turn, ...spanIn(t, turn) };
  const spread = spreadOf(t);
  if (spread) {
    const other = { turn: spread, ...spanIn(t, spread) };
    if (volumeOf(other.size) < 0.97 * volumeOf(frame.size)) frame = other;
  }
  const { min, size } = frame;
  const toWorld = (v: THREE.Vector3) => v.applyQuaternion(frame.turn);
  const whole = (): SolidPart[] => {
    const at = toWorld(min.clone().addScaledVector(size, 0.5));
    const thick = size.clone().max(new THREE.Vector3(THIN, THIN, THIN));
    return [{ shape: 'box', at, turn: frame.turn, size: thick }];
  };
  // The grid: cells as near cubes as fit, CELL across at the finest and CELLS of them at most,
  // fitted to its bounds.
  const across = (cell: number) =>
    [size.x, size.y, size.z].map((w) => Math.max(1, Math.round(w / cell))) as [
      number,
      number,
      number,
    ];
  let n = across(CELL);
  for (let cell = CELL; n[0] * n[1] * n[2] > CELLS; cell *= 1.1) n = across(cell);
  const step = new THREE.Vector3(size.x / n[0], size.y / n[1], size.z / n[2]);
  const solid = cellsOf(t, frame.turn, min, step, n);
  let count = 0;
  for (const c of solid) count += c;
  if (count >= 0.9 * solid.length) return whole();
  return merged(solid, n).map(([i0, j0, k0, i1, j1, k1]) => ({
    shape: 'box',
    at: toWorld(
      new THREE.Vector3(
        min.x + ((i0 + i1) / 2) * step.x,
        min.y + ((j0 + j1) / 2) * step.y,
        min.z + ((k0 + k1) / 2) * step.z,
      ),
    ),
    turn: frame.turn,
    size: new THREE.Vector3((i1 - i0) * step.x, (j1 - j0) * step.y, (k1 - k0) * step.z),
  }));
}

const volumeOf = (v: THREE.Vector3) =>
  Math.max(v.x, THIN) * Math.max(v.y, THIN) * Math.max(v.z, THIN);

/** The triangles of `geo` placed by `m`, nine numbers each. */
function trianglesOf(geo: THREE.BufferGeometry, m: THREE.Matrix4): Float64Array {
  const pos = geo.attributes.position!;
  const index = geo.index;
  const n = index ? index.count : pos.count;
  const out = new Float64Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(m);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/** Where the corners `t` lie, along the axes turned by `turn`: the least, and how far on. */
function spanIn(
  t: Float64Array,
  turn: THREE.Quaternion,
): { min: THREE.Vector3; size: THREE.Vector3 } {
  const back = turn.clone().invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < t.length; i += 3)
    box.expandByPoint(v.set(t[i]!, t[i + 1]!, t[i + 2]!).applyQuaternion(back));
  return { min: box.min, size: box.getSize(new THREE.Vector3()) };
}

/** The axes the corners `t` spread out along, most first, as a turn; null if there are none. */
function spreadOf(t: Float64Array): THREE.Quaternion | null {
  const n = t.length / 3;
  if (n < 3) return null;
  const mean = [0, 0, 0];
  for (let i = 0; i < t.length; i++) mean[i % 3]! += t[i]! / n;
  const c = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < t.length; i += 3)
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) c[a]![b]! += (t[i + a]! - mean[a]!) * (t[i + b]! - mean[b]!);
  const axes = eigenvectors(c);
  const [x, y] = axes.map((e) => new THREE.Vector3(e[0], e[1], e[2]).normalize());
  const z = new THREE.Vector3().crossVectors(x!, y!);
  if (z.lengthSq() < 0.5) return null;
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x!, y!, z));
}

/** The eigenvectors of the symmetric 3 × 3 `m`, by Jacobi's turns. */
function eigenvectors(m: number[][]): number[][] {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p]![q]! ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p]![q]!) < 1e-15) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cos = 1 / Math.sqrt(tt * tt + 1);
        const sin = tt * cos;
        for (let k = 0; k < 3; k++) {
          const [akp, akq] = [a[k]![p]!, a[k]![q]!];
          a[k]![p] = cos * akp - sin * akq;
          a[k]![q] = sin * akp + cos * akq;
        }
        for (let k = 0; k < 3; k++) {
          const [apk, aqk] = [a[p]![k]!, a[q]![k]!];
          a[p]![k] = cos * apk - sin * aqk;
          a[q]![k] = sin * apk + cos * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const [vkp, vkq] = [v[k]![p]!, v[k]![q]!];
          v[k]![p] = cos * vkp - sin * vkq;
          v[k]![q] = sin * vkp + cos * vkq;
        }
      }
  }
  // Columns of `v`, by their eigenvalue, largest first.
  return [0, 1, 2]
    .sort((i, j) => a[j]![j]! - a[i]![i]!)
    .map((i) => [v[0]![i]!, v[1]![i]!, v[2]![i]!]);
}

/**
 * Which cells of an `n` grid of `step` cells from `min` (in the axes turned by `turn`) the
 * triangles `t` fill: those their surface passes through, and those it shuts in, which no way
 * through cells it does not pass through leads out of.
 */
function cellsOf(
  t: Float64Array,
  turn: THREE.Quaternion,
  min: THREE.Vector3,
  step: THREE.Vector3,
  n: [number, number, number],
): Uint8Array {
  // A cell more all round, outside it, to find the outside from.
  const [nx, ny, nz] = [n[0] + 2, n[1] + 2, n[2] + 2];
  const at = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  const surface = new Uint8Array(nx * ny * nz);
  const back = turn.clone().invert();
  const [a, b, c, p] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ];
  const fine = Math.min(step.x, step.y, step.z) * 0.4;
  const cellOf = (v: number, lo: number, d: number, m: number) =>
    Math.min(m, Math.max(1, Math.floor((v - lo) / d) + 1));
  for (let i = 0; i < t.length; i += 9) {
    a.set(t[i]!, t[i + 1]!, t[i + 2]!).applyQuaternion(back);
    b.set(t[i + 3]!, t[i + 4]!, t[i + 5]!).applyQuaternion(back);
    c.set(t[i + 6]!, t[i + 7]!, t[i + 8]!).applyQuaternion(back);
    const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    const m = Math.min(400, Math.max(1, Math.ceil(longest / fine)));
    for (let u = 0; u <= m; u++)
      for (let v = 0; u + v <= m; v++) {
        p.copy(a)
          .addScaledVector(b.clone().sub(a), u / m)
          .addScaledVector(c.clone().sub(a), v / m);
        surface[
          at(
            cellOf(p.x, min.x, step.x, n[0]),
            cellOf(p.y, min.y, step.y, n[1]),
            cellOf(p.z, min.z, step.z, n[2]),
          )
        ] = 1;
      }
  }
  // The outside: every cell the surface does not pass through that the grid's edge leads to.
  const outside = new Uint8Array(nx * ny * nz);
  const todo: number[] = [at(0, 0, 0)];
  outside[at(0, 0, 0)] = 1;
  while (todo.length) {
    const q = todo.pop()!;
    const k = q % nz;
    const j = Math.floor(q / nz) % ny;
    const i = Math.floor(q / (nz * ny));
    for (const [di, dj, dk] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      const [ii, jj, kk] = [i + di, j + dj, k + dk];
      if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
      const r = at(ii, jj, kk);
      if (outside[r] || surface[r]) continue;
      outside[r] = 1;
      todo.push(r);
    }
  }
  const solid = new Uint8Array(n[0] * n[1] * n[2]);
  for (let i = 0; i < n[0]; i++)
    for (let j = 0; j < n[1]; j++)
      for (let k = 0; k < n[2]; k++)
        solid[(i * n[1] + j) * n[2] + k] = outside[at(i + 1, j + 1, k + 1)] ? 0 : 1;
  return solid;
}

/**
 * The cells that are in, as boxes of them (first corner and the one past the last, i j k
 * each): each grown as far as it goes along x, then y, then z.
 */
function merged(
  inside: Uint8Array,
  [nx, ny, nz]: [number, number, number],
): [number, number, number, number, number, number][] {
  const at = (i: number, j: number, k: number) => (i * ny + j) * nz + k;
  const left = inside.slice();
  const boxes: [number, number, number, number, number, number][] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        if (!left[at(i, j, k)]) continue;
        let i1 = i + 1;
        while (i1 < nx && left[at(i1, j, k)]) i1++;
        const row = (jj: number, kk: number) => {
          for (let ii = i; ii < i1; ii++) if (!left[at(ii, jj, kk)]) return false;
          return true;
        };
        let j1 = j + 1;
        while (j1 < ny && row(j1, k)) j1++;
        let k1 = k + 1;
        const layer = (kk: number) => {
          for (let jj = j; jj < j1; jj++) if (!row(jj, kk)) return false;
          return true;
        };
        while (k1 < nz && layer(k1)) k1++;
        for (let ii = i; ii < i1; ii++)
          for (let jj = j; jj < j1; jj++) for (let kk = k; kk < k1; kk++) left[at(ii, jj, kk)] = 0;
        boxes.push([i, j, k, i1, j1, k1]);
      }
  return boxes;
}

/** A tube (see `TUBES`) as a chain of capsules along its path, in the world. */
function links(mesh: THREE.Mesh): SolidPart[] {
  const { path, radius } = TUBES.get(mesh.geometry)!;
  const m = mesh.matrixWorld;
  const scale = new THREE.Vector3().setFromMatrixScale(m);
  const r = radius * Math.max(scale.x, scale.y, scale.z);
  const n = Math.max(1, Math.ceil(path.getLength() / LINK));
  const points = path.getSpacedPoints(n).map((p) => p.applyMatrix4(m));
  // Where it runs straight on, one capsule all the way along, no further off its line than
  // a fraction of the tube's thickness.
  const ends = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [ends[ends.length - 1]!, points[i]!];
    const line = new THREE.Line3(a, b);
    const off = points
      .slice(points.indexOf(a) + 1, i)
      .some((q) => line.closestPointToPoint(q, true, new THREE.Vector3()).distanceTo(q) > r * 0.3);
    if (off) ends.push(points[i - 1]!);
  }
  ends.push(points[points.length - 1]!);
  const out: SolidPart[] = [];
  for (let i = 0; i + 1 < ends.length; i++) {
    const [a, b] = [ends[i]!, ends[i + 1]!];
    const along = b.clone().sub(a);
    const len = along.length();
    if (len < 1e-4) continue;
    out.push({
      shape: 'capsule',
      at: a.clone().add(b).multiplyScalar(0.5),
      turn: new THREE.Quaternion().setFromUnitVectors(UP, along.divideScalar(len)),
      r,
      h: len,
    });
  }
  return out;
}

/** Half a part's extents, in its own axes: the box it fills. */
function halfOf(p: SolidPart): THREE.Vector3 {
  if (p.size) return p.size.clone().multiplyScalar(0.5);
  const r = p.r ?? 0;
  const h = (p.h ?? 0) / 2;
  if (p.shape === 'ball') return new THREE.Vector3(r, r, r);
  return new THREE.Vector3(r, h + (p.shape === 'capsule' ? r : 0), r);
}

/** The corners of the box `p` fills, in the world. */
export function cornersOf(p: SolidPart): THREE.Vector3[] {
  const h = halfOf(p);
  const out: THREE.Vector3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        out.push(new THREE.Vector3(sx * h.x, sy * h.y, sz * h.z).applyQuaternion(p.turn).add(p.at));
  return out;
}

/** The longest a turned part's pieces are cut to in `coverOf`, and the most pieces it is cut into. */
const PIECE = 0.3;
const PIECES = 64;

/**
 * Boxes square to the axes round the box `p` fills, in the world: one if it is square to them
 * too, or if it is turned, one round each piece of it cut along its own axes, so that a banister
 * running up a stair is covered by a stair of boxes, not by one round all the air beside it.
 */
export function coverOf(p: SolidPart): THREE.Box3[] {
  const h = halfOf(p);
  const turned = new THREE.Matrix4().makeRotationFromQuaternion(p.turn).elements;
  const square = [0, 1, 2, 4, 5, 6, 8, 9, 10].every((e) => {
    const v = Math.abs(turned[e]!);
    return v < 1e-3 || v > 1 - 1e-3;
  });
  if (square) return [new THREE.Box3().setFromPoints(cornersOf(p))];
  let piece = PIECE;
  const cuts = () => [h.x, h.y, h.z].map((v) => Math.max(1, Math.ceil((2 * v) / piece)));
  while (cuts().reduce((a, b) => a * b) > PIECES) piece *= 1.25;
  const [nx, ny, nz] = cuts() as [number, number, number];
  const out: THREE.Box3[] = [];
  const step = new THREE.Vector3((2 * h.x) / nx, (2 * h.y) / ny, (2 * h.z) / nz);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) {
        const at = new THREE.Vector3(
          -h.x + (i + 0.5) * step.x,
          -h.y + (j + 0.5) * step.y,
          -h.z + (k + 0.5) * step.z,
        )
          .applyQuaternion(p.turn)
          .add(p.at);
        const half = step.clone().multiplyScalar(0.5);
        out.push(
          new THREE.Box3().setFromPoints(
            cornersOf({ shape: 'box', at, turn: p.turn, size: half.multiplyScalar(2) }),
          ),
        );
      }
  return out;
}

/** `parts` but for each that lies inside a box among them, to a centimetre. */
function pruned(parts: SolidPart[]): SolidPart[] {
  const volume = (p: SolidPart) => {
    const h = halfOf(p);
    return h.x * h.y * h.z;
  };
  const order = [...parts].sort((a, b) => volume(b) - volume(a));
  // The boxes kept so far, by the metre-square columns their bounds cross.
  const GRID = 1;
  const columns = new Map<
    string,
    { inverse: THREE.Quaternion; at: THREE.Vector3; half: THREE.Vector3 }[]
  >();
  const kept: SolidPart[] = [];
  for (const p of order) {
    const corners = cornersOf(p);
    const span = new THREE.Box3().setFromPoints(corners);
    const key = (x: number, z: number) => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
    const near = columns.get(key(span.min.x, span.min.z)) ?? [];
    const inside = near.some((b) =>
      corners.every((c) => {
        const l = c.clone().sub(b.at).applyQuaternion(b.inverse);
        return (
          Math.abs(l.x) <= b.half.x + 0.01 &&
          Math.abs(l.y) <= b.half.y + 0.01 &&
          Math.abs(l.z) <= b.half.z + 0.01
        );
      }),
    );
    if (inside) continue;
    kept.push(p);
    if (p.shape !== 'box') continue;
    const entry = { inverse: p.turn.clone().invert(), at: p.at, half: halfOf(p) };
    for (let x = Math.floor(span.min.x / GRID); x <= Math.floor(span.max.x / GRID); x++)
      for (let z = Math.floor(span.min.z / GRID); z <= Math.floor(span.max.z / GRID); z++) {
        const k = `${x},${z}`;
        if (!columns.has(k)) columns.set(k, []);
        columns.get(k)!.push(entry);
      }
  }
  return kept;
}

/** Millimetres are plenty. */
const mm = (v: number) => Math.round(v * 1000) / 1000;

/** `p` as `chevronScene.ts` keeps it (see `SceneSolid`). */
export function sceneSolid(p: SolidPart): SceneSolid {
  const q = p.turn.clone().normalize();
  let size = p.size?.clone();
  // A box turned only by quarters about the axes is a box square to them, its sides swapped.
  if (size) {
    const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    const axes = [0, 1, 2].map((c) => [e[c * 4]!, e[c * 4 + 1]!, e[c * 4 + 2]!]);
    if (axes.every((a) => a.some((v) => Math.abs(Math.abs(v) - 1) < 1e-4))) {
      const s = [size.x, size.y, size.z];
      const out = [0, 0, 0];
      axes.forEach((a, c) => (out[a.findIndex((v) => Math.abs(Math.abs(v) - 1) < 1e-4)] = s[c]!));
      size = new THREE.Vector3(out[0], out[1], out[2]);
      q.identity();
    }
  }
  // A round thing standing upright needs no turn.
  if (!size && (p.shape === 'ball' || new THREE.Vector3(0, 1, 0).applyQuaternion(q).y > 1 - 1e-6))
    q.identity();
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const turned = Math.abs(q.x) > 1e-4 || Math.abs(q.y) > 1e-4 || Math.abs(q.z) > 1e-4;
  const quat = (v: number) => Math.round(v * 10000) / 10000;
  return [
    SOLID_SHAPES.indexOf(p.shape),
    mm(p.at.x),
    mm(p.at.y),
    mm(p.at.z),
    ...(size
      ? [mm(size.x), mm(size.y), mm(size.z), ...(p.shape === 'roundBox' ? [mm(p.r!)] : [])]
      : p.shape === 'ball'
        ? [mm(p.r!)]
        : [mm(p.r!), mm(p.h!)]),
    ...(turned ? [quat(q.x), quat(q.y), quat(q.z), quat(q.w)] : []),
  ];
}

/**
 * What hangs from `root` as it is met (see `SceneMesh`), in `frame`'s space (the world if
 * null), but for what `skip` says to leave out (and all that hangs from it), and what is walked
 * through (see `passable`): as the car scene's walker meets it (see `MeshWalker`).
 */
export function sceneMesh(
  root: THREE.Object3D,
  frame: THREE.Matrix4 | null,
  skip: (o: THREE.Object3D) => boolean,
): SceneMesh {
  root.updateMatrixWorld(true);
  const shapes: SceneSolid[] = [];
  const into = (p: SolidPart): SolidPart => {
    if (!frame) return p;
    const m = new THREE.Matrix4().compose(p.at, p.turn, new THREE.Vector3(1, 1, 1));
    m.premultiply(frame);
    const [at, turn] = [new THREE.Vector3(), new THREE.Quaternion()];
    m.decompose(at, turn, new THREE.Vector3());
    return { ...p, at, turn };
  };
  const apart = (mesh: THREE.Mesh) => {
    if (TUBES.has(mesh.geometry)) {
      for (const link of links(mesh)) shapes.push(sceneSolid(into(link)));
      return true;
    }
    const part = madeShape(mesh);
    if (part) shapes.push(sceneSolid(into(part)));
    return !!part;
  };
  const { vertices, indices } = triangles(root, frame, (o) => skip(o) || passable(o), apart);
  const packed = packTriangles(vertices, indices);
  const pieces: string[] = [];
  for (let i = 0; i < packed.length; i += LINE) pieces.push(packed.slice(i, i + LINE));
  return { shapes, triangles: pieces };
}
