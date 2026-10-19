import * as THREE from 'three';

/** About how many cells the cavity's depth is sampled in, at most, whatever the part's size. */
const CELLS = 6000;
/** And how many along the part's longer side, at least, so small parts show their studs too. */
const ACROSS = 96;

/** The top of a mould block: its flat face and sides, and the cavity sunk in it. */
export interface MouldTop {
  /** The flat face round the cavity, its sides down to `skirt` below it and its bottom. */
  face: THREE.BufferGeometry;
  /** The cavity's walls and floor. */
  cavity: THREE.BufferGeometry;
  /** How deep the cavity goes at its deepest. */
  depth: number;
}

/**
 * The top of a mould block for `part`: a slab `w` × `d` round the origin, its face at y = 0 and
 * `skirt` thick, with the part's shape sunk into its face as the part would leave it pressed in
 * upside down, the way a mould's cavity is: as deep as the part is tall, its studs holes in
 * the cavity's floor, mirrored front to back. `part` is posed as the mould makes it, its foot
 * at y = 0 and its middle over the origin, and must fit inside the face.
 *
 * The cavity is the part's top seen from above, sampled on a fine grid: whatever the part's
 * underside is like, and whatever its shape, the cavity follows its outside.
 */
export function mouldTop(
  part: THREE.BufferGeometry,
  w: number,
  d: number,
  skirt: number,
): MouldTop {
  const pos = part.attributes.position as THREE.BufferAttribute;
  part.computeBoundingBox();
  const bb = part.boundingBox!;
  const bottom = bb.min.y;
  // The grid: over the part's footprint seen from above, mirrored in z, a cell spare round it.
  const [sx, sz] = [bb.max.x - bb.min.x, bb.max.z - bb.min.z];
  const cell = Math.max(Math.max(sx, sz) / ACROSS, Math.sqrt((sx * sz) / CELLS));
  const nx = Math.ceil(sx / cell) + 2;
  const nz = Math.ceil(sz / cell) + 2;
  const gx0 = Math.max(-w / 2, (bb.min.x + bb.max.x) / 2 - (nx * cell) / 2);
  const gz0 = Math.max(-d / 2, -(bb.min.z + bb.max.z) / 2 - (nz * cell) / 2);
  const [cx, cz] = [Math.min(w, nx * cell) / nx, Math.min(d, nz * cell) / nz];
  const deep = new Float32Array((nx + 1) * (nz + 1));

  // Each of the part's faces drawn onto the grid from above, keeping the highest at each point.
  const index = part.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const p = [0, 1, 2].map(() => new THREE.Vector3());
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      p[k]!.fromBufferAttribute(pos, at(t, k));
      p[k]!.z = -p[k]!.z;
    }
    const [a, b, c] = p as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(area) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - gx0) / cx - 1e-6));
    const i1 = Math.min(nx, Math.floor((Math.max(a.x, b.x, c.x) - gx0) / cx + 1e-6));
    const j0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - gz0) / cz - 1e-6));
    const j1 = Math.min(nz, Math.floor((Math.max(a.z, b.z, c.z) - gz0) / cz + 1e-6));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const [x, z] = [gx0 + i * cx, gz0 + j * cz];
        const u = ((b.x - x) * (c.z - z) - (b.z - z) * (c.x - x)) / area;
        const v = ((c.x - x) * (a.z - z) - (c.z - z) * (a.x - x)) / area;
        const s = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || s < -1e-6) continue;
        const h = u * a.y + v * b.y + s * c.y - bottom;
        const n = j * (nx + 1) + i;
        if (h > deep[n]!) deep[n] = h;
      }
  }

  const face: number[] = [];
  const cavity: number[] = [];
  const tri = (out: number[], ...pts: number[][]) => {
    for (const q of pts) out.push(...q);
  };
  /** A flat rectangle of the face, from (`x0`, `z0`) to (`x1`, `z1`). */
  const flat = (x0: number, z0: number, x1: number, z1: number) => {
    if (x1 - x0 < 1e-7 || z1 - z0 < 1e-7) return;
    tri(face, [x0, 0, z0], [x0, 0, z1], [x1, 0, z0]);
    tri(face, [x1, 0, z0], [x0, 0, z1], [x1, 0, z1]);
  };
  /** A rectangle from `a` to `b` to `c` to `e`, the way round it is seen from outside. */
  const quad = (a: number[], b: number[], c: number[], e: number[]) => {
    tri(face, a, b, c);
    tri(face, a, c, e);
  };
  // The grid's cells: those that go down at a corner are the cavity's, the rest the face's.
  const node = (i: number, j: number) => [gx0 + i * cx, -deep[j * (nx + 1) + i]!, gz0 + j * cz];
  let depth = 0;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const [a, b, c, e] = [node(i, j), node(i + 1, j), node(i, j + 1), node(i + 1, j + 1)];
      const low = Math.min(a[1]!, b[1]!, c[1]!, e[1]!);
      depth = Math.max(depth, -low);
      const out = low < -1e-6 ? cavity : face;
      tri(out, a, c, b);
      tri(out, b, c, e);
    }
  // The face round the grid, its sides and its bottom.
  const [gx1, gz1] = [gx0 + nx * cx, gz0 + nz * cz];
  const [hw, hd] = [w / 2, d / 2];
  flat(-hw, -hd, gx0, hd);
  flat(gx1, -hd, hw, hd);
  flat(gx0, -hd, gx1, gz0);
  flat(gx0, gz1, gx1, hd);
  const y = -skirt;
  quad([-hw, y, hd], [hw, y, hd], [hw, 0, hd], [-hw, 0, hd]);
  quad([hw, y, -hd], [-hw, y, -hd], [-hw, 0, -hd], [hw, 0, -hd]);
  quad([hw, y, hd], [hw, y, -hd], [hw, 0, -hd], [hw, 0, hd]);
  quad([-hw, y, -hd], [-hw, y, hd], [-hw, 0, hd], [-hw, 0, -hd]);
  quad([-hw, y, -hd], [hw, y, -hd], [hw, y, hd], [-hw, y, hd]);

  const geometry = (v: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    // Each face its own normal: crisp edges where the cavity's walls meet its floor.
    g.computeVertexNormals();
    return g;
  };
  return { face: geometry(face), cavity: geometry(cavity), depth };
}

/**
 * `part` as a mould makes it: upright, its studs holes in the cavity's floor, unless lying on
 * its back shows it a good deal bigger; turned across or not, whichever shows it bigger. As big
 * as fits `x` across, `z` front to back and `y` deep, its foot at y = 0 and its middle over the
 * origin. A new geometry.
 */
export function posedInMould(
  part: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  part.computeBoundingBox();
  const s = part.boundingBox!.getSize(new THREE.Vector3());
  const fit = (a: number, b: number, c: number) =>
    Math.max(Math.min(x / a, z / c, y / b), Math.min(x / c, z / a, y / b));
  const turned = (a: number, c: number) => Math.min(x / c, z / a) > Math.min(x / a, z / c);
  const upK = fit(s.x, s.y, s.z);
  const lyingK = fit(s.x, s.z, s.y);
  const lying = lyingK > upK * 1.6;
  const k = lying ? lyingK : upK;
  const posed = part.clone();
  posed.scale(k, k, k);
  if (lying) posed.rotateX(-Math.PI / 2);
  if (lying ? turned(s.x, s.y) : turned(s.x, s.z)) posed.rotateY(Math.PI / 2);
  posed.computeBoundingBox();
  const bb = posed.boundingBox!;
  const mid = bb.getCenter(new THREE.Vector3());
  posed.translate(-mid.x, -bb.min.y, -mid.z);
  return posed;
}
