import * as THREE from 'three';

/**
 * Finds surfaces drawn on top of one another: two faces of different meshes lying in the same
 * plane (or within `gap` of it), facing the same way, and overlapping. The depth buffer cannot
 * tell such faces apart, so they flicker through each other as the camera moves ("z-fighting").
 */

/** A triangle in the world, with its plane. */
interface Tri {
  mesh: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  n: THREE.Vector3;
  d: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface Fight {
  a: THREE.Mesh;
  b: THREE.Mesh;
  /** How much of their faces lies on top of each other (m²). */
  area: number;
  /** How far apart the faces are (m). */
  gap: number;
  /** A point where they overlap, in the world. */
  at: THREE.Vector3;
}

/** The world-space triangles of a mesh's front faces (both sides of double-sided ones). */
function trianglesOf(mesh: THREE.Mesh, index: number, out: Tri[]): void {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  if (!pos) return;
  const idx = g.getIndex();
  const count = idx ? idx.count : pos.count;
  const m = mesh.matrixWorld;
  const flip = m.determinant() < 0;
  const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const grp of groups) {
    // One material draws every group (a box's six faces each have one).
    const material = Array.isArray(mesh.material) ? mats[grp.materialIndex ?? 0] : mesh.material;
    if (!material || !material.visible || material.transparent || !material.colorWrite) continue;
    const side = material.side;
    for (let i = grp.start; i < Math.min(count, grp.start + grp.count); i += 3) {
      const v = [0, 1, 2].map((k) =>
        new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m),
      );
      if (flip) v.reverse();
      const n = new THREE.Vector3()
        .subVectors(v[1]!, v[0]!)
        .cross(new THREE.Vector3().subVectors(v[2]!, v[0]!));
      const len = n.length();
      if (len < 1e-9) continue;
      n.divideScalar(len);
      const faces = side === THREE.DoubleSide ? [1, -1] : side === THREE.BackSide ? [-1] : [1];
      for (const s of faces) {
        const nn = n.clone().multiplyScalar(s);
        out.push({
          mesh: index,
          a: v[0]!,
          b: v[1]!,
          c: v[2]!,
          n: nn,
          d: nn.dot(v[0]!),
          min: v[0]!.clone().min(v[1]!).min(v[2]!),
          max: v[0]!.clone().max(v[1]!).max(v[2]!),
        });
      }
    }
  }
}

/** The area of the overlap of two triangles lying in (nearly) one plane with normal `n`. */
function overlapArea(p: Tri, q: Tri): { area: number; at: THREE.Vector3 } {
  // Project onto the plane: two axes across the normal.
  const n = p.n;
  const u = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
  const v = n.clone().cross(u);
  const to2 = (w: THREE.Vector3) => [w.dot(u), w.dot(v)] as [number, number];
  const ccw = (poly: [number, number][]) => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i]!;
      const [x1, y1] = poly[(i + 1) % poly.length]!;
      s += x0 * y1 - x1 * y0;
    }
    return s < 0 ? poly.reverse() : poly;
  };
  let subject = ccw([p.a, p.b, p.c].map(to2));
  const clip = ccw([q.a, q.b, q.c].map(to2));
  for (let i = 0; i < clip.length && subject.length; i++) {
    const [ax, ay] = clip[i]!;
    const [bx, by] = clip[(i + 1) % clip.length]!;
    const inside = ([x, y]: [number, number]) =>
      (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-12;
    const next: [number, number][] = [];
    for (let j = 0; j < subject.length; j++) {
      const s = subject[j]!;
      const e = subject[(j + 1) % subject.length]!;
      const si = inside(s);
      const ei = inside(e);
      if (si !== ei) {
        const dx = e[0] - s[0];
        const dy = e[1] - s[1];
        const den = (bx - ax) * dy - (by - ay) * dx;
        const t = den === 0 ? 0 : ((by - ay) * (s[0] - ax) - (bx - ax) * (s[1] - ay)) / den;
        next.push([s[0] + t * dx, s[1] + t * dy]);
      }
      if (ei) next.push(e);
    }
    subject = next;
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < subject.length; i++) {
    const [x0, y0] = subject[i]!;
    const [x1, y1] = subject[(i + 1) % subject.length]!;
    area += x0 * y1 - x1 * y0;
    cx += x0;
    cy += y0;
  }
  const k = subject.length || 1;
  const at = u
    .clone()
    .multiplyScalar(cx / k)
    .add(v.clone().multiplyScalar(cy / k))
    .add(n.clone().multiplyScalar(p.d));
  return { area: Math.abs(area) / 2, at };
}

/** Solid boxes, to tell whether a point is buried inside one of them. */
class Solids {
  private readonly cells = new Map<string, { inverse: THREE.Matrix4; half: THREE.Vector3 }[]>();
  private static readonly CELL = 0.5;

  constructor(meshes: THREE.Mesh[]) {
    const box = new THREE.Box3();
    for (const m of meshes) {
      const g = m.geometry;
      const material = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!/^(Box|RoundedBox)Geometry$/.test(g.type) || !material || material.transparent) continue;
      g.computeBoundingBox();
      const local = g.boundingBox!;
      // A rounded box is only solid inside its rounded edges: count its inner box alone.
      const radius = g.type === 'RoundedBoxGeometry' ? 0.05 : 0;
      const half = local.getSize(new THREE.Vector3()).multiplyScalar(0.5).subScalar(radius);
      if (half.x <= 0 || half.y <= 0 || half.z <= 0) continue;
      const centre = local.getCenter(new THREE.Vector3());
      const inverse = new THREE.Matrix4()
        .multiplyMatrices(m.matrixWorld, new THREE.Matrix4().makeTranslation(centre))
        .invert();
      const entry = { inverse, half };
      box.copy(local).applyMatrix4(m.matrixWorld);
      const C = Solids.CELL;
      for (let x = Math.floor(box.min.x / C); x <= Math.floor(box.max.x / C); x++)
        for (let y = Math.floor(box.min.y / C); y <= Math.floor(box.max.y / C); y++)
          for (let z = Math.floor(box.min.z / C); z <= Math.floor(box.max.z / C); z++) {
            const key = `${x},${y},${z}`;
            let cell = this.cells.get(key);
            if (!cell) this.cells.set(key, (cell = []));
            cell.push(entry);
          }
    }
  }

  /** Whether `p` lies inside one of the boxes, more than `skin` in from its faces. */
  contains(p: THREE.Vector3, skin = 1e-4): boolean {
    const C = Solids.CELL;
    const cell = this.cells.get(
      `${Math.floor(p.x / C)},${Math.floor(p.y / C)},${Math.floor(p.z / C)}`,
    );
    if (!cell) return false;
    const q = new THREE.Vector3();
    return cell.some(({ inverse, half }) => {
      q.copy(p).applyMatrix4(inverse);
      return (
        Math.abs(q.x) < half.x - skin &&
        Math.abs(q.y) < half.y - skin &&
        Math.abs(q.z) < half.z - skin
      );
    });
  }
}

/**
 * Every pair of meshes under `root` with faces on top of one another, more than `minArea` of
 * them (m²), at most `gap` apart. Where both lie inside some other solid box (two boards' ends
 * buried in the post they meet, or a can's base on the shelf it stands on), nothing shows, so
 * that much is not counted.
 */
export function coplanarFights(
  meshes: THREE.Mesh[],
  {
    gap = 0.0006,
    minArea = 2e-6,
    ground,
  }: {
    gap?: number;
    minArea?: number;
    /** The height of the ground, if there is one: undersides lying on it are never seen. */
    ground?: number;
  } = {},
): Fight[] {
  const all: Tri[] = [];
  meshes.forEach((m, i) => trianglesOf(m, i, all));
  const tris =
    ground === undefined
      ? all
      : all.filter((t) => !(t.n.y < -0.99 && Math.abs(-t.d - ground) < 0.002));
  // Faces that could fight point the same way: bucket by a coarse normal, then sweep along
  // their distance from the origin.
  const buckets = new Map<string, Tri[]>();
  for (const t of tris) {
    const key = `${Math.round(t.n.x * 40)},${Math.round(t.n.y * 40)},${Math.round(t.n.z * 40)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(t);
  }
  const solids = new Solids(meshes);
  const pairs = new Map<string, Fight>();
  for (const b of buckets.values()) {
    b.sort((p, q) => p.d - q.d);
    for (let i = 0; i < b.length; i++) {
      const p = b[i]!;
      for (let j = i + 1; j < b.length; j++) {
        const q = b[j]!;
        if (q.d - p.d > gap) break;
        if (p.mesh === q.mesh || p.n.dot(q.n) < 0.9995) continue;
        const e = gap + 1e-6;
        if (
          p.max.x < q.min.x - e ||
          q.max.x < p.min.x - e ||
          p.max.y < q.min.y - e ||
          q.max.y < p.min.y - e ||
          p.max.z < q.min.z - e ||
          q.max.z < p.min.z - e
        )
          continue;
        const { area, at } = overlapArea(p, q);
        if (area < 1e-9) continue;
        // Just in front of the faces: buried in something there, they never show.
        if (solids.contains(at.clone().addScaledVector(p.n, 0.0015))) continue;
        const [lo, hi] = p.mesh < q.mesh ? [p.mesh, q.mesh] : [q.mesh, p.mesh];
        const key = `${lo}:${hi}`;
        const f = pairs.get(key);
        if (f) {
          f.area += area;
          f.gap = Math.max(f.gap, Math.abs(q.d - p.d));
        } else
          pairs.set(key, { a: meshes[lo]!, b: meshes[hi]!, area, gap: Math.abs(q.d - p.d), at });
      }
    }
  }
  return [...pairs.values()].filter((f) => f.area >= minArea);
}

/** The visible, solid meshes under `root`. */
export function solidMeshes(root: THREE.Object3D): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
    for (let v: THREE.Object3D | null = o; v; v = v.parent) if (!v.visible) return;
    out.push(o);
  });
  return out;
}
