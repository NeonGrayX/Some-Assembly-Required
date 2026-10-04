export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const conj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function rotate(q: Quat, v: Vec3): Vec3 {
  const p = mulQuat(mulQuat(q, { ...v, w: 0 }), conj(q));
  return v3(p.x, p.y, p.z);
}

/** Rotation by `angle` radians around the vertical axis. */
export function yawQuat(angle: number): Quat {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

/** Heading of a rotation around the vertical axis, in radians. */
export function yawOf(q: Quat): number {
  const f = rotate(q, v3(0, 0, -1));
  return Math.atan2(-f.x, -f.z);
}

/** Rotation from `q` to `target` as an axis scaled by angle (radians). */
export function rotationError(q: Quat, target: Quat): Vec3 {
  let e = mulQuat(target, conj(q));
  if (e.w < 0) e = { x: -e.x, y: -e.y, z: -e.z, w: -e.w };
  const s = Math.sqrt(e.x * e.x + e.y * e.y + e.z * e.z);
  if (s < 1e-6) return v3();
  const angle = 2 * Math.atan2(s, e.w);
  return v3((e.x / s) * angle, (e.y / s) * angle, (e.z / s) * angle);
}

/** Small seeded PRNG (mulberry32) so the server and tests can be deterministic. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
