import * as THREE from 'three';
import { SHAPES } from './kit.ts';
import type { SolidPart } from './solidParts.ts';

/**
 * The car scene's models as what is solid in them: what is not to be walked into, their
 * triangles, and the shapes they were made as, for working out Chevron Street's solids (see
 * `solidParts`).
 */

/** Whether `o` is not to be walked into: only light (a cone's hologram), or a decal on the ground. */
export function intangible(o: THREE.Object3D): boolean {
  if (o.name === 'hologram' || !o.visible) return true;
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.every((m) => !m.depthWrite);
}

/**
 * The triangles of `o` and what hangs from it, in `frame`'s space (the world if null), but for
 * what `skip` says to leave out (and all that hangs from it), and the parts `apart` takes on
 * itself (if given).
 */
export function triangles(
  o: THREE.Object3D,
  frame: THREE.Matrix4 | null,
  skip: (o: THREE.Object3D) => boolean,
  apart?: (mesh: THREE.Mesh) => boolean,
): { vertices: Float32Array; indices: Uint32Array } {
  const meshes: THREE.Mesh[] = [];
  const take = (node: THREE.Object3D, top: boolean) => {
    if ((!top && skip(node)) || intangible(node)) return;
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && !apart?.(mesh)) meshes.push(mesh);
    for (const c of node.children) take(c, false);
  };
  take(o, true);
  let [nv, ni] = [0, 0];
  for (const mesh of meshes) {
    const count = mesh.geometry.attributes.position!.count;
    nv += count;
    ni += mesh.geometry.index?.count ?? count;
  }
  const vertices = new Float32Array(nv * 3);
  const indices = new Uint32Array(ni);
  const m = new THREE.Matrix4();
  let [v, k] = [0, 0];
  for (const mesh of meshes) {
    m.copy(mesh.matrixWorld);
    if (frame) m.premultiply(frame);
    const e = m.elements;
    const pos = mesh.geometry.attributes.position!;
    const base = v;
    for (let i = 0; i < pos.count; i++, v++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      vertices[v * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      vertices[v * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      vertices[v * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    const index = mesh.geometry.index;
    if (index) for (let i = 0; i < index.count; i++) indices[k++] = base + index.getX(i);
    else for (let i = 0; i < pos.count; i++) indices[k++] = base + i;
  }
  return weld(vertices, indices);
}

/**
 * `mesh` as the shape it was made as, in the world, if it was made as a box, a ball, a can, a
 * cone or a capsule, its corners still where that shape has them (not moved or turned after it
 * was made), and is placed in the world unsheared (see `SolidPart`). Else null.
 */
export function madeShape(mesh: THREE.Mesh): SolidPart | null {
  const made = SHAPES.get(mesh.geometry) ?? mesh.geometry;
  const p = (made as THREE.BufferGeometry & { parameters?: Record<string, number> }).parameters;
  if (!p) return null;
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const s = new THREE.Vector3();
  mesh.matrixWorld.decompose(at, turn, s);
  const again = new THREE.Matrix4().compose(at, turn, s).elements;
  if (mesh.matrixWorld.elements.some((e, i) => Math.abs(e - again[i]!) > 1e-4)) return null;
  const round = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(a));
  const whole = (angle: number | undefined, full: number) =>
    angle === undefined || angle >= full - 1e-3;
  const drawn = mesh.geometry;
  if (!drawn.boundingBox) drawn.computeBoundingBox();
  const { min, max } = drawn.boundingBox!;
  // Whether its corners reach `x` and `z` out from its upright and `y` up and down from its
  // middle: a box's exactly, a round one's sides within the few flats it is drawn with.
  const spans = (x: number, y: number, z: number) =>
    round(min.y, -y) &&
    round(max.y, y) &&
    [
      [min.x, max.x, x],
      [min.z, max.z, z],
    ].every(
      ([lo, hi, r]) =>
        hi! <= r! * 1.001 + 1e-6 && lo! >= -r! * 1.001 - 1e-6 && hi! - lo! >= r! * 1.8,
    );
  const sized = () => new THREE.Vector3(p.width! * s.x, p.height! * s.y, p.depth! * s.z);
  const boxed = () =>
    [min.x, min.y, min.z].every((v, i) => round(v, -[p.width!, p.height!, p.depth!][i]! / 2)) &&
    [max.x, max.y, max.z].every((v, i) => round(v, [p.width!, p.height!, p.depth!][i]! / 2));
  switch (made.type) {
    case 'BoxGeometry':
      if (boxed()) return { shape: 'box', at, turn, size: sized() };
      break;
    case 'RoundedBoxGeometry':
      if (boxed())
        return {
          shape: 'roundBox',
          at,
          turn,
          size: sized(),
          r: p.radius! * Math.min(s.x, s.y, s.z),
        };
      break;
    case 'SphereGeometry':
      if (
        spans(p.radius!, p.radius!, p.radius!) &&
        round(s.x, s.y) &&
        round(s.y, s.z) &&
        whole(p.phiLength, 2 * Math.PI) &&
        whole(p.thetaLength, Math.PI)
      )
        return { shape: 'ball', at, turn, r: p.radius! * s.x };
      break;
    case 'CylinderGeometry': {
      const r = Math.max(p.radiusTop!, p.radiusBottom!);
      if (!spans(r, p.height! / 2, r) || !round(s.x, s.z) || !whole(p.thetaLength, 2 * Math.PI))
        break;
      if (round(p.radiusTop!, p.radiusBottom!))
        return { shape: 'can', at, turn, r: p.radiusTop! * s.x, h: p.height! * s.y };
      if (p.radiusTop! === 0)
        return { shape: 'cone', at, turn, r: p.radiusBottom! * s.x, h: p.height! * s.y };
      break;
    }
    case 'CapsuleGeometry':
      if (
        spans(p.radius!, (p.length ?? p.height)! / 2 + p.radius!, p.radius!) &&
        round(s.x, s.z) &&
        round(s.x, s.y)
      )
        return { shape: 'capsule', at, turn, r: p.radius! * s.x, h: (p.length ?? p.height)! * s.y };
      break;
  }
  return null;
}

/** How fine (m) the colliders keep the models' shapes: corners closer than this are one. */
const GRAIN = 0.02;

/**
 * `vertices` snapped to a grid `GRAIN` fine and those that fall together made one, and the
 * triangles that are left with no area (a rounded edge's bevels, mostly) dropped: much the same
 * shape in far fewer triangles.
 */
function weld(
  vertices: Float32Array,
  indices: Uint32Array,
): { vertices: Float32Array; indices: Uint32Array } {
  const at = new Map<number, number>();
  const kept: number[] = [];
  const remap = new Uint32Array(vertices.length / 3);
  // Each corner's grid cell as one number: within 1.3 km of the middle either way, each way.
  const span = 1 << 17;
  for (let i = 0; i < remap.length; i++) {
    const x = Math.round(vertices[i * 3]! / GRAIN);
    const y = Math.round(vertices[i * 3 + 1]! / GRAIN);
    const z = Math.round(vertices[i * 3 + 2]! / GRAIN);
    const key = ((x + span / 2) * span + (y + span / 2)) * span + (z + span / 2);
    let n = at.get(key);
    if (n === undefined) {
      n = kept.length / 3;
      at.set(key, n);
      kept.push(x * GRAIN, y * GRAIN, z * GRAIN);
    }
    remap[i] = n;
  }
  const out = new Uint32Array(indices.length);
  let k = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [remap[indices[t]!]!, remap[indices[t + 1]!]!, remap[indices[t + 2]!]!];
    if (a === b || b === c || a === c) continue;
    out[k++] = a;
    out[k++] = b;
    out[k++] = c;
  }
  return { vertices: new Float32Array(kept), indices: out.slice(0, k) };
}
