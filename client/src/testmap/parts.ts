import * as THREE from 'three';
import { group, rng } from './kit.ts';
import { painted } from './paint.ts';
import { block, finish, rod } from './shape.ts';
import type { Finish } from './shape.ts';

/**
 * The building blocks of the reference picture's look, shared by the houses, the ship and the
 * props: chunky timbers cut a little askew, iron caps and straps studded with rivets wrapped
 * round their joints, rope lashings, hanging iron lanterns glowing warm, lattice windows,
 * plank doors, and roofs of chunky shingles that flare out at their eaves.
 */

export const WOOD = 0xffffff;
/** Weathered dark timbers, and pale fresh-cut ends. */
export const WOOD_DARK = 0xa4826e;
export const WOOD_PALE = 0xffe0b8;
export const IRON = 0xfff2e6;

let seeds = 1;
/** A fresh seed for a part, so no two look quite alike. */
export const nextSeed = () => (seeds = (seeds * 16807) % 2147483647);

/** A mesh of `geometry` in `material` at (`x`, `y`, `z`), turned `rx`, `ry`, `rz`. */
export function put(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

export interface TimberOptions extends Finish {
  tint?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  bevel?: number;
  /** The texture: wood grain, or boards side by side. */
  paint?: 'wood' | 'boards';
}

/** A timber `sx × sy × sz` centred at (`x`, `y`, `z`), a little uneven, its edges worn light. */
export function timber(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  o: TimberOptions = {},
): THREE.Mesh {
  const big = Math.max(sx, sy, sz);
  const geo = block(sx, sy, sz, o.paint ?? 'wood', {
    wobble: Math.min(0.035, Math.min(sx, sy, sz) * 0.09 + big * 0.004),
    seed: nextSeed(),
    vary: 0.12,
    ...o,
  });
  return put(g, geo, painted(o.paint ?? 'wood', o.tint ?? WOOD), x, y, z, o.rx, o.ry, o.rz);
}

/** A rivet's head, sticking out of a face along `n`. */
export function rivet(g: THREE.Object3D, p: THREE.Vector3, n: THREE.Vector3, r = 0.04): void {
  const geo = finish(new THREE.SphereGeometry(r, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), 'iron', {
    edge: 0,
    shade: 0,
    seed: nextSeed(),
  });
  const m = put(
    g,
    geo,
    painted('iron', 0xd8dde4, { roughness: 0.45, metalness: 0.15 }),
    p.x,
    p.y,
    p.z,
  );
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  m.castShadow = false;
}

/**
 * An iron cap wrapped round a timber's joint: a thick plate box `sx × sy × sz` at (`x`, `y`,
 * `z`) (a little bigger than the timber it holds), with rivets on its faces that look out along
 * x and z.
 */
export function ironCap(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  o: { rivets?: boolean; ry?: number; rx?: number; rz?: number } = {},
): THREE.Object3D {
  const c = group(g, x, y, z, o.ry ?? 0);
  c.rotation.x = o.rx ?? 0;
  c.rotation.z = o.rz ?? 0;
  put(
    c,
    block(sx, sy, sz, 'iron', {
      edge: 0.9,
      shade: 0.25,
      seed: nextSeed(),
      wobble: 0.008,
      bevel: 0.025,
    }),
    painted('iron', IRON, { roughness: 0.5, metalness: 0.15 }),
  );
  if (o.rivets !== false) {
    const r = Math.min(0.045, Math.min(sx, sy, sz) * 0.25);
    const rows = sy > 0.3 ? [-sy * 0.28, sy * 0.28] : [0];
    for (const yy of rows)
      for (const s of [-1, 1]) {
        if (sx > 0.18)
          rivet(c, new THREE.Vector3(s * sx * 0.27, yy, sz / 2), new THREE.Vector3(0, 0, 1), r);
        if (sz > 0.18)
          rivet(c, new THREE.Vector3(sx / 2, yy, s * sz * 0.27), new THREE.Vector3(1, 0, 0), r);
        if (sz > 0.18)
          rivet(c, new THREE.Vector3(-sx / 2, yy, s * sz * 0.27), new THREE.Vector3(-1, 0, 0), r);
      }
  }
  return c;
}

/**
 * An L-shaped iron plate on a face looking along +z (in `g`'s space), its corner at (`x`, `y`),
 * its arms `a` long going `dx` (±1) along x and `dy` (±1) along y, `w` wide.
 */
export function cornerPlate(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  a = 0.55,
  w = 0.24,
  yaw = 0,
): void {
  const c = group(g, x, y, z, yaw);
  const mat = painted('iron', IRON, { roughness: 0.5, metalness: 0.15 });
  const t = 0.05;
  const fin = () => ({ edge: 0.9, shade: 0.15, seed: nextSeed(), wobble: 0.006, bevel: 0.018 });
  put(c, block(a, w, t, 'iron', fin()), mat, dx * (a / 2 - w / 2), 0, 0);
  put(c, block(w, a, t, 'iron', fin()), mat, 0, dy * (a / 2 - w / 2), 0);
  const n = new THREE.Vector3(0, 0, 1);
  rivet(c, new THREE.Vector3(0, 0, t / 2), n);
  rivet(c, new THREE.Vector3(dx * (a - w * 0.7), 0, t / 2), n);
  rivet(c, new THREE.Vector3(0, dy * (a - w * 0.7), t / 2), n);
}

/** A few turns of rope lashed round an upright of radius `r` at height `y`. */
export function lashing(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  turns = 3,
): void {
  const mat = painted('cloth', 0xc9a87a, { roughness: 0.95 });
  for (let i = 0; i < turns; i++) {
    const geo = finish(new THREE.TorusGeometry(r + 0.03, 0.04, 6, 14), 'cloth', {
      edge: 0,
      shade: 0,
      seed: nextSeed(),
    });
    put(g, geo, mat, x, y + (i - (turns - 1) / 2) * 0.075, z, Math.PI / 2, 0, (i - 1) * 0.08);
  }
}

/** The warm glow of a lantern's light and of lit windows. */
export function glowMaterial(strength = 2.2): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffc35a,
    emissive: 0xff9d2e,
    emissiveIntensity: strength,
    roughness: 0.5,
  });
  return m;
}

/**
 * An iron lantern hanging with its top at (`x`, `y`, `z`): a pyramid roof with a ring to hang
 * it by, four corner bars round a glowing glass, and a base, chunky like the picture's.
 */
export function hangingLantern(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  s = 1,
  chain = 0.25,
): THREE.Group {
  const l = group(g, x, y, z);
  l.scale.setScalar(s);
  const iron = painted('iron', IRON, { roughness: 0.5, metalness: 0.15 });
  const fin = (k = 0) => ({ edge: 0.8, shade: 0.2, seed: nextSeed() + k, bevel: 0.015 });
  if (chain > 0)
    put(l, rod(0.018, 0.018, chain, 'iron', { sides: 5, edge: 0 }), iron, 0, -chain / 2, 0);
  const top = -chain;
  put(
    l,
    finish(new THREE.TorusGeometry(0.06, 0.018, 5, 10), 'iron', fin()),
    iron,
    0,
    top - 0.04,
    0,
  );
  // The roof: a squat four-sided pyramid with a lip.
  put(
    l,
    finish(new THREE.ConeGeometry(0.24, 0.2, 4, 1), 'iron', { ...fin(), edge: 0.4 }),
    iron,
    0,
    top - 0.17,
    0,
    0,
    Math.PI / 4,
  );
  put(l, block(0.36, 0.06, 0.36, 'iron', fin()), iron, 0, top - 0.29, 0);
  // Glass, bars and base.
  const glass = glowMaterial(2.6);
  put(l, new THREE.BoxGeometry(0.22, 0.3, 0.22), glass, 0, top - 0.48, 0).castShadow = false;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    put(l, block(0.05, 0.36, 0.05, 'iron', fin()), iron, sx * 0.13, top - 0.48, sz * 0.13);
  for (const s of [-1, 1]) {
    put(l, block(0.3, 0.035, 0.03, 'iron', fin()), iron, 0, top - 0.48, s * 0.13);
    put(l, block(0.03, 0.035, 0.3, 'iron', fin()), iron, s * 0.13, top - 0.48, 0);
  }
  put(l, block(0.32, 0.07, 0.32, 'iron', fin()), iron, 0, top - 0.68, 0);
  put(
    l,
    finish(new THREE.ConeGeometry(0.1, 0.1, 4, 1), 'iron', fin()),
    iron,
    0,
    top - 0.76,
    0,
    Math.PI,
    Math.PI / 4,
  );
  return l;
}

/**
 * An iron bracket sticking out of a wall along +z (in `g`'s space) from (`x`, `y`, `z`), `len`
 * long, with a lantern hanging from its end.
 */
export function bracketLantern(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  len = 0.6,
  yaw = 0,
  s = 1,
): void {
  const b = group(g, x, y, z, yaw);
  const iron = painted('iron', IRON, { roughness: 0.5, metalness: 0.15 });
  put(
    b,
    block(0.2, 0.3, 0.06, 'iron', { edge: 0.9, seed: nextSeed(), bevel: 0.02 }),
    iron,
    0,
    0,
    0.03,
  );
  rivet(b, new THREE.Vector3(0, 0.08, 0.06), new THREE.Vector3(0, 0, 1));
  rivet(b, new THREE.Vector3(0, -0.08, 0.06), new THREE.Vector3(0, 0, 1));
  put(
    b,
    block(0.06, 0.07, len, 'iron', { edge: 0.8, seed: nextSeed(), bevel: 0.015 }),
    iron,
    0,
    0.06,
    len / 2,
  );
  // A brace beneath, and a curl at the end.
  const brace = block(0.05, 0.05, len * 0.75, 'iron', {
    edge: 0.8,
    seed: nextSeed(),
    bevel: 0.012,
  });
  put(b, brace, iron, 0, -0.12, len * 0.38, Math.atan2(0.2, len * 0.7));
  put(
    b,
    finish(new THREE.TorusGeometry(0.05, 0.018, 5, 10), 'iron', { edge: 0, seed: nextSeed() }),
    iron,
    0,
    0.1,
    len - 0.02,
    0,
    Math.PI / 2,
  );
  hangingLantern(b, 0, 0.03, len - 0.06, s, 0.12);
}

/**
 * A window in a wall facing +z (in `g`'s space), its middle at (`x`, `y`, `z`): warm glowing
 * glass crossed by a dark diamond lattice, in a heavy frame with a sill, iron at its corners.
 */
export function latticeWindow(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  yaw = 0,
  frame = 0.17,
): THREE.Group {
  const f = group(g, x, y, z, yaw);
  put(f, new THREE.PlaneGeometry(w, h), glowMaterial(1.6), 0, 0, 0.02).castShadow = false;
  const bar = painted('iron', 0x8a8070, { roughness: 0.6 });
  const step = 0.19;
  const geos: THREE.BufferGeometry[] = [];
  const n = Math.ceil((w + h) / step) + 1;
  for (let k = -n; k <= n; k++)
    for (const s of [-1, 1]) {
      const pts: THREE.Vector2[] = [];
      for (const xx of [-w / 2, w / 2]) {
        const yy = xx * s - k * step;
        if (Math.abs(yy) <= h / 2) pts.push(new THREE.Vector2(xx, yy));
      }
      for (const yy of [-h / 2, h / 2]) {
        const xx = (yy + k * step) * s;
        if (Math.abs(xx) <= w / 2) pts.push(new THREE.Vector2(xx, yy));
      }
      if (pts.length < 2) continue;
      const [a, b] = [pts[0]!, pts[1]!];
      const len = a.distanceTo(b);
      if (len < 0.05) continue;
      const geo = new THREE.BoxGeometry(len, 0.035, 0.03);
      geo.rotateZ(Math.atan2(b.y - a.y, b.x - a.x));
      geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, 0.05);
      geos.push(geo.toNonIndexed());
    }
  if (geos.length) {
    const merged = finish(mergeList(geos), 'iron', { edge: 0, shade: 0.1, seed: nextSeed() });
    put(f, merged, bar).castShadow = false;
  }
  const t = { tint: WOOD_DARK, wobble: 0.02 };
  timber(f, 0, h / 2 + frame / 2, 0.06, w + frame * 2 + 0.06, frame, 0.2, t);
  timber(f, 0, -h / 2 - frame / 2, 0.1, w + frame * 2 + 0.22, frame * 1.1, 0.3, {
    tint: WOOD,
    wobble: 0.02,
  });
  for (const s of [-1, 1]) timber(f, (s * (w + frame)) / 2, 0, 0.06, frame, h, 0.2, t);
  timber(f, 0, 0, 0.07, 0.07, h, 0.08, t);
  timber(f, 0, 0, 0.07, w, 0.07, 0.08, t);
  // Iron at the frame's top corners.
  for (const s of [-1, 1])
    cornerPlate(f, (s * (w + frame)) / 2, h / 2 + frame / 2, 0.17, -s, -1, 0.34, 0.12);
  return f;
}

function mergeList(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of geos) count += g.attributes.position!.count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    nor.set(g.attributes.normal!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/**
 * A plank door facing +z (in `g`'s space), its foot's middle at (`x`, `y`, `z`): rough boards of
 * different lengths, iron straps with rivets, a ring, in a heavy frame.
 */
export function plankDoor(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  yaw = 0,
  double = false,
): void {
  const d = group(g, x, y, z, yaw);
  const n = Math.max(3, Math.round(w / 0.24));
  const r = rng(Math.round(w * 100 + h * 10 + x * 7));
  for (let i = 0; i < n; i++) {
    const tint = [WOOD, WOOD_DARK, 0xe8c8a8][Math.floor(r() * 3)]!;
    const hh = h - r() * 0.08;
    timber(d, -w / 2 + (i + 0.5) * (w / n), hh / 2, 0, w / n - 0.015, hh, 0.1, {
      tint,
      grain: 1,
      bevel: 0.025,
    });
  }
  const leaves = double ? [-w / 4, w / 4] : [0];
  for (const cx of leaves)
    for (const yy of [0.35, h - 0.4]) {
      const sw = double ? w / 2 - 0.12 : w - 0.16;
      ironCap(d, cx, yy, 0.07, sw, 0.12, 0.04, { rivets: false });
      for (const k of [-0.35, 0, 0.35])
        rivet(d, new THREE.Vector3(cx + k * sw, yy, 0.095), new THREE.Vector3(0, 0, 1), 0.03);
    }
  const ringMat = painted('iron', IRON, { roughness: 0.5, metalness: 0.15 });
  for (const cx of double ? [-0.14, 0.14] : [w * 0.28])
    put(
      d,
      finish(new THREE.TorusGeometry(0.08, 0.02, 6, 12), 'iron', { edge: 0, seed: nextSeed() }),
      ringMat,
      cx,
      h * 0.5,
      0.1,
    );
  const f = 0.2;
  timber(d, 0, h + f / 2, 0.03, w + f * 2 + 0.2, f, 0.26, { tint: WOOD_DARK });
  for (const s of [-1, 1])
    timber(d, (s * (w + f)) / 2, h / 2, 0.03, f, h, 0.24, { tint: WOOD_DARK });
}

/**
 * Chunky shingles over one slope of a roof, in `g`'s space: from its ridge at (x = 0, `ridgeY`)
 * down toward `side` (±1) along x at `pitch` radians, flattening toward the eave by `flare`
 * radians (the reference's swept-out eaves), `slope` metres long, from `z0` to `z1`.
 * `tints` are the shingles' colours, each picked at random.
 */
export function shingleSlope(
  g: THREE.Object3D,
  ridgeY: number,
  pitch: number,
  flare: number,
  slope: number,
  z0: number,
  z1: number,
  side: 1 | -1,
  tints: number[],
  seed: number,
  paint: 'wood' | 'stone' = 'stone',
): { eave: THREE.Vector2 } {
  const r = rng(seed);
  const rowStep = 0.42;
  const rows = Math.ceil(slope / rowStep);
  const across = 0.62;
  const byTint = tints.map(() => [] as THREE.BufferGeometry[]);
  let px = 0;
  let py = ridgeY;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (let row = 0; row < rows; row++) {
    const t = row / rows;
    const a = pitch - flare * t * t;
    px += side * Math.cos(a) * rowStep;
    py -= Math.sin(a) * rowStep;
    const off = row % 2 ? across / 2 : 0;
    for (let z = z0 - 0.1 + off; z < z1 + 0.15; z += across) {
      const w = across + 0.04 + r() * 0.06;
      const len = 0.64 + r() * 0.08;
      const geo = block(len, 0.13 + r() * 0.04, w, paint, {
        seed: Math.floor(r() * 1e6),
        edge: 0.75,
        shade: 0.35,
        wobble: 0.025,
        bevel: 0.05,
        grain: 0,
        segments: 1,
      });
      e.set((r() - 0.5) * 0.12, (r() - 0.5) * 0.16, -side * a + (r() - 0.5) * 0.1, 'XYZ');
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(px, py + 0.06, z), q, new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(m);
      byTint[Math.floor(r() * tints.length)]!.push(geo);
    }
  }
  tints.forEach((tint, i) => {
    if (!byTint[i]!.length) return;
    put(g, mergeAttrs(byTint[i]!), painted(paint, tint, { roughness: 0.7 }));
  });
  return { eave: new THREE.Vector2(px, py) };
}

/** Geometries with the same attributes (position, normal, uv, colour), joined. */
export function mergeAttrs(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'uv', 'color'];
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geos[0]!.attributes[name]!.itemSize;
    let count = 0;
    for (const g of geos) count += g.attributes[name]!.count;
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const g of geos) {
      arr.set(g.attributes[name]!.array as Float32Array, o);
      o += g.attributes[name]!.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/** A pennant `w × h` flying along +x from a pole top at (`x`, `y`, `z`), swallow-tailed, rippled. */
export function pennant(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  tint: number,
  yaw = 0,
): void {
  const geo = new THREE.PlaneGeometry(w, h, 10, 3);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) + w / 2) / w;
    const v = p.getY(i) / h;
    let px = p.getX(i) + w / 2;
    // The swallow tail: the middle of the free end cut back.
    if (u > 0.7) px -= (1 - Math.abs(v) * 2) * (u - 0.7) * w * 0.6;
    p.setXYZ(i, px, p.getY(i) * (1 - u * 0.25) - u * u * h * 0.3, Math.sin(u * 7) * 0.12 * u);
  }
  geo.computeVertexNormals();
  const f = finish(geo, 'cloth', { edge: 0, shade: 0.2, seed: nextSeed() }, 'none');
  const m = put(
    g,
    f,
    painted('cloth', tint, { side: THREE.DoubleSide, roughness: 0.9 }),
    x,
    y - h / 2,
    z,
    0,
    yaw,
  );
  m.castShadow = true;
}
