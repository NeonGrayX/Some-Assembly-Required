import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { describe, expect, it } from 'vitest';
import { buildCarScene } from './scene.ts';
import { noteWhereAdded, where } from './whereAdded.ts';

/**
 * Faces of two different materials lying in the same plane fight over every pixel they share:
 * which one the depth test lets through flips with the view, so a stripe or patch of one shows
 * through the other and changes as the camera turns (the grey band across the bus stop's
 * fascia, its roof's end showing through). The map is built from boxes set flush against each
 * other, so these come easily; this finds every such pair a camera could see.
 */

/**
 * How close two planes are (metres) to count as the same. Half a millimetre is about the depth
 * buffer's step 30 m from the camera; parts set further apart than this stay apart on screen.
 */
const SAME_PLANE = 0.0005;
/** Overlaps smaller than this (square metres) are a few pixels at most, even close up. */
const SMALLEST = 1e-4;

type Pt = [number, number];

/** The part of convex polygon `a` inside convex polygon `b` (Sutherland–Hodgman). */
function clip(a: Pt[], b: Pt[]): Pt[] {
  if (signedArea(b) < 0) b = [...b].reverse();
  let out = a;
  for (let i = 0; i < b.length && out.length; i++) {
    const [p, q] = [b[i]!, b[(i + 1) % b.length]!];
    const side = (s: Pt) => (q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]);
    const cut = (s: Pt, e: Pt): Pt => {
      const t = side(s) / (side(s) - side(e));
      return [s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t];
    };
    const was = out;
    out = [];
    for (let j = 0; j < was.length; j++) {
      const [s, e] = [was[j]!, was[(j + 1) % was.length]!];
      if (side(e) >= 0) {
        if (side(s) < 0) out.push(cut(s, e));
        out.push(e);
      } else if (side(s) >= 0) out.push(cut(s, e));
    }
  }
  return out;
}

function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [s, e] = [p[i]!, p[(i + 1) % p.length]!];
    a += s[0] * e[1] - e[0] * s[1];
  }
  return a / 2;
}

/** A pair of meshes fighting: how much face they share, and a spot on it a camera can see. */
interface Fight {
  a: THREE.Mesh;
  b: THREE.Mesh;
  area: number;
  at: THREE.Vector3;
  normal: THREE.Vector3;
}

/**
 * Directions spread over the half of the sphere `n` faces, tipped at least 10° off its plane
 * (a face seen more edge-on than that is a sliver).
 */
function hemisphere(n: THREE.Vector3): THREE.Vector3[] {
  const u = new THREE.Vector3(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
  u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
  const v = n.clone().cross(u);
  const dirs = [n.clone()];
  for (const tilt of [0.5, 1.0, 1.35])
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      dirs.push(
        n
          .clone()
          .multiplyScalar(Math.cos(tilt))
          .addScaledVector(u, Math.sin(tilt) * Math.cos(a))
          .addScaledVector(v, Math.sin(tilt) * Math.sin(a)),
      );
    }
  return dirs;
}

/**
 * Every pair of meshes under `root` with different materials whose faces share a plane, facing
 * the same way, over a patch a camera could see: one with open space in front of it (some
 * line of sight from it stays clear for a metre and a half, ending above the floor).
 */
function fights(root: THREE.Object3D): Fight[] {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });

  // Every face in the world, filed by its plane.
  const tris: { mesh: number; p: THREE.Vector3[]; n: THREE.Vector3; d: number }[] = [];
  const planes = new Map<string, number[]>();
  const [ab, ac] = [new THREE.Vector3(), new THREE.Vector3()];
  meshes.forEach((m, mesh) => {
    const pos = m.geometry.getAttribute('position');
    const index = m.geometry.getIndex();
    const count = index ? index.count : pos.count;
    const at = (i: number) =>
      new THREE.Vector3()
        .fromBufferAttribute(pos, index ? index.getX(i) : i)
        .applyMatrix4(m.matrixWorld);
    for (let i = 0; i + 2 < count; i += 3) {
      const p = [at(i), at(i + 1), at(i + 2)];
      const n = ab.subVectors(p[1]!, p[0]!).cross(ac.subVectors(p[2]!, p[0]!)).clone();
      if (n.length() < 2e-6) continue;
      n.normalize();
      const d = n.dot(p[0]!);
      const key = `${Math.round(n.x * 100)} ${Math.round(n.y * 100)} ${Math.round(n.z * 100)} ${Math.round(d / SAME_PLANE)}`;
      let list = planes.get(key);
      if (!list) planes.set(key, (list = []));
      list.push(tris.push({ mesh, p, n, d }) - 1);
    }
  });

  // Shared patches, pair by pair: where they are and how big.
  const shared = new Map<
    string,
    { area: number; spots: { at: THREE.Vector3; n: THREE.Vector3 }[] }
  >();
  for (const [key, list] of planes) {
    // A plane and the next one along, so faces either side of a rounding step still meet.
    const [nx, ny, nz, dq] = key.split(' ').map(Number) as [number, number, number, number];
    const near = [...list, ...(planes.get(`${nx} ${ny} ${nz} ${dq + 1}`) ?? [])];
    if (new Set(near.map((t) => tris[t]!.mesh)).size < 2) continue;
    const n = tris[near[0]!]!.n;
    const u = new THREE.Vector3(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0);
    u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
    const v = n.clone().cross(u);
    const flat = near.map((t) => tris[t]!.p.map((p): Pt => [p.dot(u), p.dot(v)]));
    // Swept along the plane's first axis, so only faces whose bounds overlap are compared.
    const bounds = flat.map((f) => [
      Math.min(f[0]![0], f[1]![0], f[2]![0]),
      Math.min(f[0]![1], f[1]![1], f[2]![1]),
      Math.max(f[0]![0], f[1]![0], f[2]![0]),
      Math.max(f[0]![1], f[1]![1], f[2]![1]),
    ]);
    const order = flat.map((_, i) => i).sort((i, j) => bounds[i]![0]! - bounds[j]![0]!);
    let active: number[] = [];
    for (const j of order) {
      const bj = bounds[j]!;
      active = active.filter((i) => bounds[i]![2]! >= bj[0]!);
      for (const i of active) {
        const bi = bounds[i]!;
        if (bi[1]! > bj[3]! || bj[1]! > bi[3]!) continue;
        // Faces both from the next plane along are compared with that one.
        if (i >= list.length && j >= list.length) continue;
        const [s, t] = [tris[near[i]!]!, tris[near[j]!]!];
        if (s.mesh === t.mesh || Math.abs(s.d - t.d) > SAME_PLANE || s.n.dot(t.n) < 0.9999)
          continue;
        const [ma, mb] = [meshes[s.mesh]!.material, meshes[t.mesh]!.material] as THREE.Material[];
        // Decals drawn over a surface on purpose say so.
        if (
          ma === mb ||
          ma!.polygonOffset ||
          mb!.polygonOffset ||
          !ma!.depthWrite ||
          !mb!.depthWrite
        )
          continue;
        const patch = clip(flat[i]!, flat[j]!);
        const area = patch.length > 2 ? Math.abs(signedArea(patch)) : 0;
        if (area < 1e-7) continue;
        const [cx, cy] = patch.reduce(
          (m, p) => [m[0] + p[0] / patch.length, m[1] + p[1] / patch.length],
          [0, 0],
        );
        const at = u.clone().multiplyScalar(cx).addScaledVector(v, cy).addScaledVector(n, s.d);
        const pair = s.mesh < t.mesh ? `${s.mesh} ${t.mesh}` : `${t.mesh} ${s.mesh}`;
        let e = shared.get(pair);
        if (!e) shared.set(pair, (e = { area: 0, spots: [] }));
        e.area += area;
        e.spots.push({ at, n: s.n });
      }
      active.push(j);
    }
  }

  // Which of them a camera could see: every face of the map in one tree, blocking a line of
  // sight whichever way it is turned.
  const all = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.p.forEach((p, k) => p.toArray(all, i * 9 + k * 3)));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(all, 3));
  const tree = new MeshBVH(geometry);
  const ray = new THREE.Ray();
  const clear = 1.5;
  const open = (at: THREE.Vector3, n: THREE.Vector3) =>
    hemisphere(n).some((dir) => {
      ray.origin.copy(at).addScaledVector(n, 0.0005);
      ray.direction.copy(dir);
      if (ray.at(clear, new THREE.Vector3()).y < 0.3) return false;
      return !tree.raycastFirst(ray, THREE.DoubleSide, 0, clear);
    });
  const found: Fight[] = [];
  for (const [pair, { area, spots }] of shared) {
    if (area < SMALLEST) continue;
    const [a, b] = pair.split(' ').map((i) => meshes[Number(i)]!) as [THREE.Mesh, THREE.Mesh];
    // A dozen of its patches, spread through it, are enough to tell.
    const step = Math.max(1, Math.floor(spots.length / 12));
    const seen = spots.filter((_, i) => i % step === 0).find((s) => open(s.at, s.n));
    if (seen) found.push({ a, b, area, at: seen.at, normal: seen.n });
  }
  return found.sort((x, y) => y.area - x.area);
}

describe('the car scene, as the reference picture lays it out', () => {
  it('has no faces of different materials fighting in the same plane', () => {
    const restore = noteWhereAdded();
    const root = buildCarScene().root;
    restore();
    const found = fights(root);
    const v = (x: THREE.Vector3) => `${x.x.toFixed(2)} ${x.y.toFixed(2)} ${x.z.toFixed(2)}`;
    const report = found.map(
      (f) =>
        `${(f.area * 1e4).toFixed(1)} cm² at ${v(f.at)} facing ${v(f.normal)}\n  ${where(f.a)}\n  ${where(f.b)}`,
    );
    expect(report).toEqual([]);
  }, 180_000);
});
