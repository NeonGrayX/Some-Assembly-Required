import * as THREE from 'three';
import { bevelBox, bevelCylinder } from '../render/shapes.ts';
import { Surface } from '../render/styles.ts';
import { C, between, group, mat, part, rng, rope } from './kit.ts';
import type { Solids } from './walk.ts';

/**
 * The island's props, after the reference: the great cannon on its carriage, barrels bound in
 * iron, sacks, crates, green bottles, iron lanterns glowing yellow on their brackets, flags in
 * tatters, and rope rails on posts.
 */

const iron = () => mat(C.iron, Surface.Metal, { roughness: 0.5, metalness: 0.6 });
const ironLight = () => mat(C.ironLight, Surface.Metal, { roughness: 0.45, metalness: 0.6 });
const wood = () => mat(C.wood, Surface.Wood);
const woodDark = () => mat(C.woodDark, Surface.Wood);
const woodLight = () => mat(C.woodLight, Surface.Wood);

/** A lathe turned about the z axis (pointing along -z from `z0`): `profile` is [radius, along]. */
function turned(profile: [number, number][], sides = 20): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    profile.map(([r, a]) => new THREE.Vector2(r, a)),
    sides,
  );
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * The great cannon: a long iron barrel ringed with bands and flared at the muzzle, on a stepped
 * wooden carriage strapped and bolted with iron, on four iron-rimmed wheels. It points along its
 * own -z, its foot's middle at the origin.
 */
export function cannon(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scale = 1,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  g.scale.setScalar(scale);
  // The carriage: two stepped cheeks and the bed between them.
  const bedY = 0.42;
  part(g, bevelBox(0.9, 0.18, 2.0), woodDark(), 0, bedY, 0.1);
  for (const s of [-1, 1]) {
    const cheek = group(g, s * 0.42, 0, 0);
    part(cheek, bevelBox(0.16, 0.5, 1.9), wood(), 0, bedY + 0.32, 0.12);
    part(cheek, bevelBox(0.16, 0.36, 1.1), wood(), 0, bedY + 0.72, 0.5);
    part(cheek, bevelBox(0.16, 0.24, 0.55), wood(), 0, bedY + 0.98, 0.78);
    // Iron straps round the cheek, and bolt heads.
    for (const zz of [-0.55, 0.15, 0.85])
      part(cheek, bevelBox(0.2, 0.62, 0.07), iron(), 0, bedY + 0.32, zz);
    for (const [yy, zz] of [
      [0.22, -0.4],
      [0.5, -0.4],
      [0.22, 0.5],
      [0.85, 0.45],
    ] as const)
      part(
        cheek,
        new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8),
        ironLight(),
        0,
        bedY + yy,
        zz,
        0,
        0,
        Math.PI / 2,
      );
    // The wheels: a dark iron rim on a wooden disc, with a hub.
    for (const [zz, rad] of [
      [-0.7, 0.42],
      [0.85, 0.38],
    ] as const) {
      const w = group(g, s * 0.62, rad, zz);
      part(w, bevelCylinder(rad, rad, 0.2), iron(), 0, 0, 0, 0, 0, Math.PI / 2);
      part(w, bevelCylinder(rad * 0.78, rad * 0.78, 0.24), woodDark(), 0, 0, 0, 0, 0, Math.PI / 2);
      part(
        w,
        bevelCylinder(rad * 0.3, rad * 0.34, 0.34),
        ironLight(),
        s * 0.02,
        0,
        0,
        0,
        0,
        Math.PI / 2,
      );
    }
  }
  // Axles under the bed.
  for (const zz of [-0.7, 0.85])
    part(
      g,
      new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8),
      iron(),
      0,
      zz === -0.7 ? 0.42 : 0.38,
      zz,
      0,
      0,
      Math.PI / 2,
    );
  // The barrel, laid on the cheeks and raised a little at the muzzle.
  const b = group(g, 0, bedY + 0.98, 0.55);
  b.rotation.x = 0.1;
  const profile: [number, number][] = [
    [0, 0.42],
    [0.12, 0.42],
    [0.2, 0.36],
    [0.3, 0.28],
    [0.33, 0.1],
    [0.33, 0],
    [0.31, -0.2],
    [0.29, -0.9],
    [0.26, -1.0],
    [0.25, -1.9],
    [0.22, -2.3],
    [0.23, -2.45],
    [0.3, -2.62],
    [0.3, -2.72],
    [0.2, -2.74],
    [0.17, -2.6],
    [0.17, -2.2],
  ];
  // The lathe turns about y: its "along" is y, then laid along -z.
  const barrel = turned(
    profile.map(([r, a]) => [r, -a]),
    24,
  );
  part(b, barrel, mat(0x3a3e45, Surface.Metal, { roughness: 0.42, metalness: 0.7 }));
  // Bands round it, the trunnions it rests on, and the cascabel knob at the breech.
  for (const [zz, r] of [
    [-0.05, 0.345],
    [-0.9, 0.31],
    [-1.0, 0.3],
    [-1.85, 0.27],
    [-2.42, 0.25],
  ] as const)
    part(b, new THREE.TorusGeometry(r, 0.035, 6, 24), ironLight(), 0, 0, zz);
  part(
    b,
    new THREE.CylinderGeometry(0.09, 0.09, 0.86, 10),
    iron(),
    0,
    -0.05,
    -0.75,
    0,
    0,
    Math.PI / 2,
  );
  part(b, new THREE.SphereGeometry(0.11, 12, 8), iron(), 0, 0, 0.55);
  part(b, new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8), iron(), 0, 0, 0.45, Math.PI / 2);
  // A rope coiled over the breech, and the rammer leaning on the carriage.
  const coil = new THREE.TorusGeometry(0.2, 0.05, 6, 16);
  part(g, coil, mat(C.rope, Surface.Fabric), -0.15, bedY + 0.2, 1.25, Math.PI / 2);
  part(g, coil, mat(C.rope, Surface.Fabric), -0.13, bedY + 0.3, 1.25, Math.PI / 2.2);
  if (solids) {
    // Registered in the scaled frame: its points scale, so the sizes are scaled to match.
    solids.box(g, 0, 0, 0.1, 1.5 * scale, 1.2 * scale, 2.2 * scale);
    solids.box(g, 0, 1.0, -1.2, 0.6 * scale, 0.6 * scale, 1.6 * scale);
  }
  return g;
}

/**
 * A barrel `h` high, its staves bellied out (painted upright as boards), bound with iron hoops,
 * its lid of boards; lying on its side when `lying`.
 */
export function barrel(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  h = 0.95,
  yaw = 0,
  lying = false,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const inner = group(g, 0, lying ? h * 0.36 : 0, 0);
  if (lying) inner.rotation.z = Math.PI / 2;
  if (lying) inner.position.x = -h / 2;
  const r = h * 0.36;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(Math.PI * t)), t * h));
  }
  part(inner, new THREE.LatheGeometry(pts, 18), mat(0x8b5a33, Surface.Wood, { roughness: 0.85 }));
  part(
    inner,
    new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.03, 18),
    mat(0x7a4c2b, Surface.Wood),
    0,
    h - 0.03,
    0,
  );
  for (const t of [0.08, 0.3, 0.7, 0.92]) {
    const rr = r * (0.86 + 0.14 * Math.sin(Math.PI * t)) + 0.012;
    part(
      inner,
      new THREE.CylinderGeometry(rr, rr, 0.06, 18, 1, true),
      mat(0x3e434b, Surface.Metal, { roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
      0,
      t * h,
      0,
    );
  }
  if (solids) {
    if (lying) solids.box(g, 0, 0, 0, h, r * 2, r * 2);
    else solids.post(g, 0, 0, r * 0.95, 0, h);
  }
  return g;
}

/** A wooden crate of boards on a frame, `s` on a side. */
export function crate(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  s = 0.7,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  part(g, bevelBox(s * 0.94, s * 0.94, s * 0.94), mat(C.woodPale, Surface.Wood), 0, s / 2, 0);
  const frame = woodDark();
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      part(
        g,
        bevelBox(0.08, s, 0.08),
        frame,
        (sx * s) / 2 - sx * 0.04,
        s / 2,
        (sz * s) / 2 - sz * 0.04,
      );
  for (const yy of [0.04, s - 0.04]) {
    part(g, bevelBox(s, 0.08, 0.08), frame, 0, yy, s / 2 - 0.04);
    part(g, bevelBox(s, 0.08, 0.08), frame, 0, yy, -s / 2 + 0.04);
    part(g, bevelBox(0.08, 0.08, s), frame, s / 2 - 0.04, yy, 0);
    part(g, bevelBox(0.08, 0.08, s), frame, -s / 2 + 0.04, yy, 0);
  }
  if (solids) solids.box(g, 0, 0, 0, s, s, s);
  return g;
}

/** A sack of sacking slumped on the ground, tied at its neck. */
export function sack(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  s = 0.6,
  yaw = 0,
  seed = 1,
): THREE.Group {
  const r = rng(seed);
  const g = group(parent, x, y, z, yaw);
  const body = new THREE.SphereGeometry(s * 0.5, 14, 10);
  const pos = body.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    const k = py < 0 ? 1.15 : 1 - (py / (s * 0.5)) * 0.25;
    pos.setXYZ(i, pos.getX(i) * k * (1 + (r() - 0.5) * 0.06), py * 0.85, pos.getZ(i) * k);
  }
  body.computeVertexNormals();
  part(g, body, mat(C.sack, Surface.Fabric), 0, s * 0.42, 0);
  part(
    g,
    new THREE.CylinderGeometry(s * 0.12, s * 0.2, s * 0.2, 10),
    mat(C.sack, Surface.Fabric),
    0,
    s * 0.88,
    0,
  );
  part(
    g,
    new THREE.TorusGeometry(s * 0.14, 0.02, 5, 12),
    mat(C.rope, Surface.Fabric),
    0,
    s * 0.84,
    0,
    Math.PI / 2,
  );
  part(
    g,
    new THREE.ConeGeometry(s * 0.18, s * 0.18, 8),
    mat(C.sack, Surface.Fabric),
    0,
    s * 1.05,
    0,
    Math.PI,
  );
  return g;
}

/** A green glass bottle with a cork, standing (or lying, `lying`). */
export function bottle(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  h = 0.32,
  lying = false,
  yaw = 0,
): void {
  const g = group(parent, x, y, z, yaw);
  const r = h * 0.2;
  const pts = [
    [0, 0],
    [r, 0],
    [r * 1.05, h * 0.08],
    [r, h * 0.55],
    [r * 0.45, h * 0.72],
    [r * 0.36, h * 0.92],
    [r * 0.42, h * 0.95],
    [r * 0.4, h],
    [0, h],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const m = part(
    g,
    new THREE.LatheGeometry(pts, 12),
    mat(C.glass, Surface.Plastic, { roughness: 0.15, emissive: 0x0c3a12, emissiveIntensity: 0.6 }),
  );
  part(
    m,
    new THREE.CylinderGeometry(r * 0.32, r * 0.32, h * 0.1, 8),
    mat(0x9b7650, Surface.Wood),
    0,
    h + 0.02,
    0,
  );
  if (lying) {
    g.rotation.z = Math.PI / 2;
    g.position.y += r;
  }
}

/**
 * An iron lantern: a square cage with a pointed cap and a ring to hang it by, its glass glowing
 * yellow behind the bars. Its foot at the origin, `s` high.
 */
export function lantern(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  s = 0.5,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  const w = s * 0.55;
  const frame = mat(0x2e3238, Surface.Metal, { roughness: 0.55, metalness: 0.6 });
  part(g, bevelBox(w * 1.15, s * 0.08, w * 1.15), frame, 0, s * 0.04, 0);
  part(g, bevelBox(w * 1.2, s * 0.06, w * 1.2), frame, 0, s * 0.68, 0);
  const glow = new THREE.MeshStandardMaterial({
    color: 0xffd27a,
    emissive: C.glow,
    emissiveIntensity: 2.6,
    roughness: 0.4,
  });
  part(g, new THREE.BoxGeometry(w * 0.9, s * 0.58, w * 0.9), glow, 0, s * 0.37, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      part(
        g,
        new THREE.BoxGeometry(s * 0.05, s * 0.62, s * 0.05),
        frame,
        (sx * w) / 2,
        s * 0.37,
        (sz * w) / 2,
      );
  // A cross bar over each pane.
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const f = group(g, Math.sin(a) * w * 0.46, 0, Math.cos(a) * w * 0.46, a);
    part(f, new THREE.BoxGeometry(s * 0.035, s * 0.58, s * 0.03), frame, 0, s * 0.37, 0);
    part(f, new THREE.BoxGeometry(w * 0.9, s * 0.035, s * 0.03), frame, 0, s * 0.4, 0);
  }
  part(g, new THREE.ConeGeometry(w * 0.82, s * 0.3, 4), frame, 0, s * 0.86, 0, 0, Math.PI / 4);
  part(g, new THREE.TorusGeometry(s * 0.08, s * 0.02, 6, 12), frame, 0, s * 1.06, 0);
  return g;
}

/**
 * A lantern on a post: an upright with an arm out at the top braced by a strut, the lantern
 * hanging from the arm's end. Its foot at the origin, the arm reaching along -z.
 */
export function lanternPost(
  parent: THREE.Object3D,
  solids: Solids | null,
  x: number,
  y: number,
  z: number,
  h = 2.4,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  part(g, bevelBox(0.18, h, 0.18), woodDark(), 0, h / 2 - 0.1, 0);
  part(g, bevelBox(0.14, 0.14, 0.9), woodDark(), 0, h - 0.17, -0.36);
  between(
    g,
    new THREE.Vector3(0, h - 0.65, -0.05),
    new THREE.Vector3(0, h - 0.2, -0.5),
    0.045,
    woodDark(),
  );
  part(g, bevelBox(0.2, 0.08, 0.2), iron(), 0, h - 0.05, 0);
  part(g, bevelBox(0.17, 0.17, 0.08), iron(), 0, h - 0.17, -0.78);
  between(
    g,
    new THREE.Vector3(0, h - 0.22, -0.7),
    new THREE.Vector3(0, h - 0.42, -0.7),
    0.012,
    iron(),
  );
  lantern(g, 0, h - 0.95, -0.7, 0.52);
  if (solids) solids.post(g, 0, 0, 0.14, -0.5, h);
  return g;
}

/**
 * A flag on a pole: cloth waving out along +x from the pole's top, its fly end torn into
 * tatters.
 */
export function flag(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  hex: number,
  yaw = 0,
  seed = 3,
): THREE.Group {
  const r = rng(seed);
  const g = group(parent, x, y, z, yaw);
  const cols = 10;
  const rows = 5;
  const positions: number[] = [];
  const indices: number[] = [];
  const tatter = Array.from({ length: rows + 1 }, () => 0.7 + r() * 0.3);
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const u = i / cols;
      const vv = j / rows;
      const len = u * w * (u > 0.6 ? 0.6 / 0.6 + (tatter[j]! - 1) * ((u - 0.6) / 0.4) : 1);
      positions.push(len, -vv * h * (1 - u * 0.12), Math.sin(u * 7 + vv * 1.5) * 0.12 * u);
    }
  }
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      // Cuts in the fly end, between some rows.
      if (i > cols * 0.7 && (j === 1 || j === 3) && r() < 0.6) continue;
      indices.push(a, a + rows + 1, a + 1, a + 1, a + rows + 1, a + rows + 2);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  part(g, geo, mat(hex, Surface.Fabric, { side: THREE.DoubleSide }));
  return g;
}

/**
 * Rope rails on posts along `points` (each a post): two ropes sagging between each pair, as the
 * rope fence round the beach and the walkway's sides are.
 */
export function ropeRail(
  parent: THREE.Object3D,
  solids: Solids | null,
  points: THREE.Vector3[],
  h = 1.05,
): void {
  for (const p of points) {
    part(
      parent,
      bevelBox(0.15, h + 0.3, 0.15),
      woodDark(),
      p.x,
      p.y + (h + 0.3) / 2 - 0.3,
      p.z,
      0,
      (p.x * 7) % 1,
    );
    part(parent, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8), woodLight(), p.x, p.y + h, p.z);
    if (solids) solids.post(parent, p.x, p.z, 0.1, p.y - 0.3, p.y + h);
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i]!, points[i + 1]!];
    for (const yy of [h - 0.08, h * 0.55])
      rope(parent, a.clone().setY(a.y + yy), b.clone().setY(b.y + yy), 0.12, 0.028);
  }
}

/** A board hung from an iron bracket, as a shop sign. */
export function sign(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): THREE.Group {
  const g = group(parent, x, y, z, yaw);
  part(g, bevelBox(0.9, 0.08, 0.08), iron(), 0.45, 0, 0);
  for (const sx of [0.15, 0.75])
    between(g, new THREE.Vector3(sx, 0, 0), new THREE.Vector3(sx, -0.2, 0), 0.012, iron());
  part(g, bevelBox(0.8, 0.5, 0.07), mat(C.woodPale, Surface.Wood), 0.45, -0.45, 0, 0, 0, 0.05);
  part(g, bevelBox(0.84, 0.06, 0.09), woodDark(), 0.45, -0.22, 0, 0, 0, 0.05);
  return g;
}

/** Planks laid as a walkway from `a` to `b` (their middles, on top), `w` wide. */
export function walkway(
  parent: THREE.Object3D,
  solids: Solids | null,
  a: THREE.Vector3,
  b: THREE.Vector3,
  w: number,
): THREE.Group {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const g = group(parent, a.x, a.y, a.z, yaw);
  const n = Math.round(len / 0.34);
  const r = rng(Math.round(a.x * 100));
  const rise = b.y - a.y;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const plank = part(
      g,
      bevelBox(w * (0.9 + r() * 0.1), 0.07, 0.28),
      mat([C.woodLight, C.woodPale, C.wood][i % 3]!, Surface.Wood),
      (r() - 0.5) * 0.08,
      rise * t - 0.035,
      len * t,
      0,
      (r() - 0.5) * 0.08,
    );
    plank.rotation.x = -Math.atan2(rise, len);
  }
  // The two stringers under the planks.
  for (const s of [-1, 1])
    between(
      g,
      new THREE.Vector3((s * w) / 2.6, -0.12, 0),
      new THREE.Vector3((s * w) / 2.6, rise - 0.12, len),
      0.06,
      woodDark(),
    );
  if (solids) solids.ramp(g, 0, len / 2, w, len, 0, rise);
  return g;
}
