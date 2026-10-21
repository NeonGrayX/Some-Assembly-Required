import type { Vec3 } from '../../math.ts';
import type { SolidDef } from '../house.ts';

/**
 * A level's models as they are met (see `LevelDef.meshes`): what of them was made as a box, a
 * rounded box, a ball, a can, a cone or a capsule as that shape (see `SceneSolid`), a tube as a
 * chain of capsules, and the rest as the very triangles they are drawn with, their corners
 * snapped together a couple of centimetres fine (`MESH_GRAIN`). The triangles are packed in a
 * string (see `packTriangles`), kept in pieces of a line each.
 */
export interface SceneMesh {
  shapes: SceneSolid[];
  triangles: string[];
}

/**
 * A shape of the models (see `SolidDef`), its kind first (see `SOLID_SHAPES`), then its middle,
 * x y z: a box's size, x y z (and a rounded box's radius after it), or a round one's radius and
 * height; and last, if it is turned, its turn as a quaternion, x y z w.
 */
export type SceneSolid = number[];

/** What each `SceneSolid`'s first number stands for. */
export const SOLID_SHAPES = ['box', 'ball', 'can', 'cone', 'capsule', 'roundBox'] as const;

/** How fine the triangles' corners are snapped (m). */
export const MESH_GRAIN = 0.02;

/** `s` as a level's, its middle placed by `at`. */
export function solidAt(s: SceneSolid, at: (x: number, y: number, z: number) => Vec3): SolidDef {
  const shape = SOLID_SHAPES[s[0]!]!;
  const sized = shape === 'box' || shape === 'roundBox';
  const q = s.slice(shape === 'box' ? 7 : shape === 'roundBox' ? 8 : 6);
  return {
    shape,
    at: at(s[1]!, s[2]!, s[3]!),
    ...(sized
      ? { size: { x: s[4]!, y: s[5]!, z: s[6]! }, ...(shape === 'roundBox' && { r: s[7]! }) }
      : { r: s[4]!, h: s[5] ?? 0 }),
    ...(q.length === 4 && { turn: { x: q[0]!, y: q[1]!, z: q[2]!, w: q[3]! } }),
  };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Triangles packed small: the corners' places in grid steps of `MESH_GRAIN`, and the triangles'
 * corners, each number as its difference from the one before it in variable-length bytes, the
 * bytes in base 64. The corners must lie on the grid.
 */
export function packTriangles(vertices: Float32Array, indices: Uint32Array): string {
  const bytes: number[] = [];
  const put = (n: number) => {
    let z = n >= 0 ? n * 2 : -n * 2 - 1;
    while (z > 127) {
      bytes.push((z & 127) | 128);
      z = Math.floor(z / 128);
    }
    bytes.push(z);
  };
  put(vertices.length / 3);
  put(indices.length);
  const last = [0, 0, 0];
  for (let i = 0; i < vertices.length; i++) {
    const step = Math.round(vertices[i]! / MESH_GRAIN);
    put(step - last[i % 3]!);
    last[i % 3] = step;
  }
  let prev = 0;
  for (const k of indices) {
    put(k - prev);
    prev = k;
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1] ?? 0, bytes[i + 2] ?? 0];
    const n = (a << 16) | (b << 8) | c;
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? BASE64[n & 63]! : '=';
  }
  return out;
}

/** The triangles `packTriangles` packed. */
export function unpackTriangles(s: string): { vertices: Float32Array; indices: Uint32Array } {
  const value = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64.length; i++) value[BASE64.charCodeAt(i)] = i;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((s.length / 4) * 3 - pad);
  for (let i = 0, j = 0; i < s.length; i += 4) {
    const n =
      (value[s.charCodeAt(i)]! << 18) |
      (value[s.charCodeAt(i + 1)]! << 12) |
      (Math.max(0, value[s.charCodeAt(i + 2)]!) << 6) |
      Math.max(0, value[s.charCodeAt(i + 3)]!);
    for (const b of [(n >> 16) & 255, (n >> 8) & 255, n & 255])
      if (j < bytes.length) bytes[j++] = b;
  }
  let at = 0;
  const get = () => {
    let z = 0;
    let scale = 1;
    for (;;) {
      const b = bytes[at++]!;
      z += (b & 127) * scale;
      if (b < 128) break;
      scale *= 128;
    }
    return z % 2 ? -(z + 1) / 2 : z / 2;
  };
  const vertices = new Float32Array(get() * 3);
  const indices = new Uint32Array(get());
  const last = [0, 0, 0];
  for (let i = 0; i < vertices.length; i++) {
    last[i % 3] = last[i % 3]! + get();
    vertices[i] = last[i % 3]! * MESH_GRAIN;
  }
  let prev = 0;
  for (let i = 0; i < indices.length; i++) indices[i] = prev += get();
  return { vertices, indices };
}
