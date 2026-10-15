import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Surface } from '../render/styles.ts';
import { C, faceted, group, mat, part, rng } from './kit.ts';
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

/** A shade of `hex` lighter (`by` > 0) or darker, in sRGB. */
function shade(hex: number, by: number): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + by)));
  return c.getHex();
}

/**
 * A great rock: the hull of a scatter of points round a squared-off slab, so it is cut into a
 * few big flat faces, as the reference's are; light grey where its faces turn up to the sky,
 * cooler and darker down its sides and under it, `sx × sy × sz` and resting on its foot.
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
  const n = Math.max(sx, sy, sz) > 6 ? 26 : 16;
  for (let i = 0; i < n; i++) {
    // Toward the slab's surface: each point pushed out to its box's sides in one of its axes.
    const p = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    const axis = Math.floor(r() * 3);
    p.setComponent(axis, Math.sign(p.getComponent(axis)) * (0.75 + r() * 0.25));
    // The corners cut off, so it is a rock and not a box.
    const corner = Math.abs(p.x) + Math.abs(p.y) * 0.8 + Math.abs(p.z);
    if (corner > 2.3) p.multiplyScalar(2.3 / corner);
    // Narrower toward its top, as weathered stacks are.
    const up = (p.y + 1) / 2;
    p.x *= 1 - up * 0.14;
    p.z *= 1 - up * 0.1;
    points.push(new THREE.Vector3(p.x * sx * 0.5, (p.y + 1) * 0.5 * sy, p.z * sz * 0.5));
  }
  // A flat foot, a little under the ground.
  for (const [a, b] of [
    [-0.42, -0.4],
    [0.45, -0.38],
    [0.4, 0.42],
    [-0.44, 0.4],
  ] as const)
    points.push(new THREE.Vector3(a * sx, -0.05 * sy, b * sz));
  const shape = new ConvexGeometry(points);
  shape.computeVertexNormals();
  paint(shape, (_x, py, _z, ny, i) => {
    const face = Math.floor(i / 3);
    const vary = rng(seed * 97 + face)();
    const base = ny > 0.55 ? C.rockTop : ny < -0.2 ? C.rockDark : C.rock;
    return shade(base, (vary - 0.5) * 0.07 + (py / sy - 0.5) * 0.06);
  });
  const m = part(g, shape, mat(0xffffff, Surface.Wall, { vertexColors: true, roughness: 0.92 }));
  m.rotation.z = tilt;
  if (solids) solids.box(g, 0, 0, 0, sx * 0.72, sy * 0.9, sz * 0.72);
  return g;
}

/**
 * A palm: a ringed trunk curving up `height` metres, leaning toward `lean` (a yaw), with a crown
 * of drooping fronds, each a broad blade cut into ragged leaflets, folded along its rib.
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
  // The trunk: rings stacked along a curve, each a little wider at its foot.
  const spine = (t: number) => new THREE.Vector3(0, t * height, -bend * height * t * t);
  const rings = Math.round(height / 0.42);
  const bark = mat(C.trunk, Surface.Wood, { roughness: 0.95 });
  const barkDark = mat(shade(C.trunk, -0.08), Surface.Wood, { roughness: 0.95 });
  for (let i = 0; i < rings; i++) {
    const [t0, t1] = [i / rings, (i + 1) / rings];
    const [a, b] = [spine(t0), spine(t1)];
    const rad = 0.24 * (1 - t0 * 0.45);
    const seg = new THREE.CylinderGeometry(rad * 0.82, rad * 1.08, a.distanceTo(b) * 1.04, 9);
    const m = part(g, seg, i % 2 ? bark : barkDark);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  }
  if (solids) solids.post(g, 0, 0, 0.28, 0, height);
  const top = spine(1);
  // A knot of husk and a few coconuts under the crown.
  part(
    g,
    new THREE.IcosahedronGeometry(0.28, 0),
    mat(shade(C.trunk, -0.12), Surface.Wood),
    top.x,
    top.y - 0.05,
    top.z,
  );
  const nut = mat(0x5a3d22, Surface.Wood, { roughness: 0.7 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r();
    part(
      g,
      faceted(new THREE.IcosahedronGeometry(0.15, 1)),
      nut,
      top.x + Math.cos(a) * 0.2,
      top.y - 0.25,
      top.z + Math.sin(a) * 0.2,
    );
  }
  const fronds = 9 + Math.floor(r() * 3);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r() * 0.4;
    const len = height * (0.42 + r() * 0.12) + 1.0;
    const droop = 0.55 + r() * 0.5;
    const up = i % 3 === 0 ? 0.65 : 0.25;
    frond(g, top, a, len, droop, up, seed * 13 + i);
  }
  return g;
}

/**
 * One frond from `base` toward yaw `a`, `len` long: rising by `up` then drooping by `droop`
 * (radians over its length), a blade cut into leaflets along both sides, folded into a V.
 */
function frond(
  parent: THREE.Object3D,
  base: THREE.Vector3,
  a: number,
  len: number,
  droop: number,
  up: number,
  seed: number,
) {
  const r = rng(seed);
  const segs = 8;
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  // The rib, as points bending down from `up` to below level.
  const rib: THREE.Vector3[] = [];
  const p = base.clone();
  for (let i = 0; i <= segs; i++) {
    rib.push(p.clone());
    const t = i / segs;
    const pitch = up - (up + droop) * t;
    p.addScaledVector(dir, (len / segs) * Math.cos(pitch)).add(
      new THREE.Vector3(0, (len / segs) * Math.sin(pitch), 0),
    );
  }
  const light = new THREE.Color(C.leaf);
  const dark = new THREE.Color(C.leafDark);
  const tipCol = new THREE.Color(0xd8e86a);
  const push = (v: THREE.Vector3, c: THREE.Color) => {
    positions.push(v.x, v.y, v.z);
    colours.push(c.r, c.g, c.b);
    return positions.length / 3 - 1;
  };
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const t1 = (i + 1) / segs;
    // The blade's half width: broad in the middle, to a point at the tip, with ragged cuts.
    const w = (u: number) =>
      len * 0.24 * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.7 * (u < 0.08 ? u / 0.08 : 1);
    const [a0, a1] = [rib[i]!, rib[i + 1]!];
    const fold = 0.85;
    for (const s of [-1, 1]) {
      // Each segment's leaflet: from the rib out and back along toward the tip, a notch between.
      const cut = 0.75 + r() * 0.25;
      const out0 = a0
        .clone()
        .addScaledVector(side, s * w(t) * 0.35)
        .add(new THREE.Vector3(0, -fold * w(t) * 0.3, 0));
      const tip = a1
        .clone()
        .addScaledVector(dir, len * 0.06)
        .addScaledVector(side, s * w(t1) * cut)
        .add(new THREE.Vector3(0, -fold * w(t1) * cut * 0.6 - 0.05, 0));
      const ribC = dark.clone().lerp(light, 0.35);
      const edgeC = light.clone().lerp(tipCol, t * 0.7);
      const i0 = push(a0, ribC);
      const i1 = push(a1, ribC);
      const i2 = push(out0, edgeC.clone().lerp(dark, 0.25));
      const i3 = push(tip, edgeC);
      indices.push(i0, i2, i3, i0, i3, i1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  part(
    parent,
    g,
    mat(0xffffff, Surface.Auto, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 }),
  );
}

/**
 * A leafy bush: a few rounded clumps, each a ball of broad leaves set round a dark core, lighter
 * where they face up into the sun.
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
  const leaves: THREE.BufferGeometry[] = [];
  const core = mat(shade(hex, -0.14), Surface.Auto, { roughness: 0.9 });
  for (let c = 0; c < clumps; c++) {
    const a = r() * Math.PI * 2;
    const d = c === 0 ? 0 : size * (0.35 + r() * 0.25);
    const rad = size * (c === 0 ? 0.55 : 0.36 + r() * 0.14);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const cy = rad * 0.75;
    part(g, faceted(new THREE.IcosahedronGeometry(rad * 0.82, 1)), core, cx, cy, cz);
    const n = Math.round(14 + rad * 40);
    for (let i = 0; i < n; i++) {
      // Spread evenly over the clump's upper part (a Fibonacci spiral), each leaf facing out.
      const k = (i + 0.5) / n;
      const yy = 1 - k * 1.45;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const phi = i * 2.39996 + c;
      const nrm = new THREE.Vector3(Math.cos(phi) * rr, yy, Math.sin(phi) * rr).normalize();
      const leaf = new THREE.BufferGeometry();
      const L = rad * (0.55 + r() * 0.25);
      const W = L * 0.42;
      leaf.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [0, 0, 0, W, L * 0.45, 0.05, 0, L, 0, -W, L * 0.45, 0.05],
          3,
        ),
      );
      leaf.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
      const spin = new THREE.Quaternion().setFromAxisAngle(nrm, r() * Math.PI * 2);
      // Leaning out from the clump, its tip lifted a little.
      const tiltQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.9);
      m.compose(
        new THREE.Vector3(cx, cy, cz).addScaledVector(nrm, rad * 0.62),
        spin.multiply(q).multiply(tiltQ),
        new THREE.Vector3(1, 1, 1),
      );
      leaf.applyMatrix4(m);
      const up = nrm.y;
      const tone = shade(hex, -0.06 + up * 0.12 + (r() - 0.5) * 0.08);
      paint(leaf, () => tone);
      leaves.push(leaf.toNonIndexed());
    }
  }
  const merged = mergeAll(leaves);
  merged.computeVertexNormals();
  part(
    g,
    merged,
    mat(0xffffff, Surface.Auto, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }),
  );
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
