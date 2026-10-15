import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BevelCylinderGeometry } from '../render/shapes.ts';
import { KEEP_SEPARATE } from '../render/merge.ts';
import { SURFACE, Surface } from '../render/styles.ts';
import { TILE, painted } from './paint.ts';
import type { Paint } from './paint.ts';

/**
 * Shapes for the hand-painted look: rounded-off blocks and rods, a little uneven as if cut by
 * hand, with the texture laid on at its size in the world and the grain running the way asked,
 * and vertex colours that paint their worn edges light and their undersides dark (the
 * reference picture's painted highlights and soft shade, without a light needing to find them).
 */

export interface Finish {
  /** Which local axis the texture's grain (its u) runs along: the longest, if not given. */
  grain?: 0 | 1 | 2;
  /** How far, in metres, its corners are pushed about, so it looks made by hand. */
  wobble?: number;
  /** How much lighter its worn edges are painted (0 for none). */
  edge?: number;
  /** How much darker its lowest part is than its highest. */
  shade?: number;
  /** Its own random: its texture's offset, its unevenness, its tint. */
  seed?: number;
  /** How far its brightness may stray from its neighbours' (0.1 is ±10%). */
  vary?: number;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  const k = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453;
  return k - Math.floor(k);
}

type EdgeKind = 'box' | 'rod' | 'none';

/**
 * Makes `geo` ready to paint: its own vertices per face, texture coordinates at the paint's
 * size along its grain, vertex colours for worn edges and shade, and its corners nudged.
 */
export function finish(
  source: THREE.BufferGeometry,
  paint: Paint,
  o: Finish = {},
  edges: EdgeKind = 'box',
): THREE.BufferGeometry {
  const geo = source.index ? source.toNonIndexed() : source;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = box.getSize(new THREE.Vector3()).toArray();
  const grain = o.grain ?? (size.indexOf(Math.max(...size)) as 0 | 1 | 2);
  const seed = o.seed ?? 1;
  const tile = TILE[paint];
  const offU = hash3(seed, 1, 2, 3) * 7;
  const offV = hash3(seed, 4, 5, 6) * 7;
  const tint = 1 + (hash3(seed, 9, 8, 7) - 0.5) * 2 * (o.vary ?? 0.08);
  const edgeK = o.edge ?? 0.55;
  const shadeK = o.shade ?? 0.3;
  const wobble = o.wobble ?? 0;

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const face = new THREE.Vector3();
  const h = box.max.y - box.min.y || 1;
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1);
    c.fromBufferAttribute(pos, t + 2);
    face.subVectors(c, b).cross(a.clone().sub(b));
    const f = [Math.abs(face.x), Math.abs(face.y), Math.abs(face.z)];
    const axis = f.indexOf(Math.max(...f));
    const [ua, va] = axis !== grain ? [grain, 3 - axis - grain] : [(axis + 1) % 3, (axis + 2) % 3];
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      uv[i * 2] = p[ua]! / tile + offU;
      uv[i * 2 + 1] = p[va]! / tile + offV;
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));
      let e = 0;
      if (edges === 'box') e = Math.min(1, (1 - Math.max(nx, ny, nz)) / 0.25);
      else if (edges === 'rod') e = Math.max(0, 1 - Math.abs(ny - 0.7) / 0.3);
      const up = (p[1]! - box.min.y) / h;
      // Lit from above: the upward faces and edges a touch lighter still.
      const lift = nor.getY(i) > 0.5 ? 0.06 : 0;
      const v = tint * (1 - shadeK * (1 - up) ** 1.4) * (1 + edgeK * e + lift);
      col[i * 3] = v * (1 + 0.04 * e);
      col[i * 3 + 1] = v;
      col[i * 3 + 2] = v * (1 - 0.06 * e);
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (wobble > 0) {
    for (let i = 0; i < n; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const r = (k: number) => (hash3(x * 13.1, y * 17.3, z * 11.7, seed + k) - 0.5) * 2 * wobble;
      pos.setXYZ(i, x + r(1), y + r(2), z + r(3));
    }
    pos.needsUpdate = true;
  }
  return geo;
}

/**
 * A block `sx × sy × sz` centred on the origin, its edges rounded `bevel` deep (by default a
 * share of its thinnest side), painted with `paint`.
 */
export function block(
  sx: number,
  sy: number,
  sz: number,
  paint: Paint,
  o: Finish & { bevel?: number; segments?: number } = {},
): THREE.BufferGeometry {
  const bevel = o.bevel ?? Math.min(0.07, Math.min(sx, sy, sz) * 0.22);
  return finish(new RoundedBoxGeometry(sx, sy, sz, o.segments ?? 2, bevel), paint, o, 'box');
}

/**
 * A round rod along y, `len` long, `r0` round at its foot and `r1` at its top, its rims rounded
 * off, painted with `paint` (grain along it).
 */
export function rod(
  r0: number,
  r1: number,
  len: number,
  paint: Paint,
  o: Finish & { sides?: number; bevel?: number } = {},
): THREE.BufferGeometry {
  const g = new BevelCylinderGeometry(
    r1,
    r0,
    len,
    o.sides ?? Math.max(6, Math.round(6 + Math.max(r0, r1) * 30)),
    o.bevel ?? Math.min(r0, r1) * 0.3,
  );
  return finish(g, paint, { grain: 1, ...o }, 'rod');
}

/**
 * Bakes every painted mesh under `root` (at the origin, unturned) into one mesh per material
 * and shadow setting: the map is hundreds of beams, and a draw call each would be too many.
 * The game's own `mergeStatic` leaves textured meshes alone, so this does it for them.
 */
export function mergePainted(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { geos: THREE.BufferGeometry[]; mesh: THREE.Mesh }>();
  const gone: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o.userData[KEEP_SEPARATE]) return;
    o.children.forEach(visit);
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material;
    if (Array.isArray(o.material) || !m.userData.paint) return;
    const g = o.geometry;
    if (!g.attributes.uv || !g.attributes.color || !g.attributes.normal || g.index) return;
    const key = `${m.uuid}|${o.castShadow}|${o.receiveShadow}`;
    let group = groups.get(key);
    if (!group) {
      const mesh = new THREE.Mesh(undefined, m);
      mesh.castShadow = o.castShadow;
      mesh.receiveShadow = o.receiveShadow;
      groups.set(key, (group = { geos: [], mesh }));
    }
    const baked = g.clone();
    for (const name of Object.keys(baked.attributes))
      if (!['position', 'normal', 'uv', 'color'].includes(name)) baked.deleteAttribute(name);
    baked.applyMatrix4(o.matrixWorld);
    group.geos.push(baked);
    gone.push(o);
  };
  visit(root);
  for (const o of gone) o.removeFromParent();
  for (const { geos, mesh } of groups.values()) {
    mesh.geometry = mergeGeometries(geos, false)!;
    mesh.geometry.computeBoundingSphere();
    root.add(mesh);
  }
}

/** Each texture's average colour, linear, for matching a plain colour's brightness to it. */
const AVERAGE: Partial<Record<Paint, number>> = {
  wood: 0.12,
  boards: 0.1,
  iron: 0.17,
  cloth: 0.75,
};

/**
 * Repaints the plain meshes under `root` (wood, iron, cloth, and any coloured per vertex as
 * boards) with the hand-painted textures, each as bright as its colour was. For models built
 * before the textures were, so the whole map is painted alike.
 */
export function repaint(root: THREE.Object3D, grain?: 0 | 1 | 2): void {
  const seen = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const m = o.material as THREE.MeshStandardMaterial;
    if (!(m instanceof THREE.MeshStandardMaterial) || m.userData.paint || m.map) return;
    if (m.emissive.getHex() !== 0) return;
    const surface = m.userData[SURFACE] as Surface | undefined;
    const paint: Paint | null = m.vertexColors
      ? 'boards'
      : surface === Surface.Wood
        ? 'wood'
        : surface === Surface.Metal
          ? 'iron'
          : surface === Surface.Fabric
            ? 'cloth'
            : null;
    if (!paint) return;
    const old = o.geometry;
    let geo = seen.get(old);
    if (!geo) {
      const before = old.index ? old.toNonIndexed() : old.clone();
      const colours = m.vertexColors
        ? (before.attributes.color as THREE.BufferAttribute | undefined)
        : undefined;
      geo = finish(
        before,
        paint,
        { edge: 0, shade: 0.3, seed: seen.size + 1, grain: m.vertexColors ? grain : undefined },
        'none',
      );
      if (colours) {
        const col = geo.attributes.color as THREE.BufferAttribute;
        // Their brightness only: the texture gives the wood its hue.
        for (let i = 0; i < col.count; i++) {
          const l = colours.getX(i) * 0.2126 + colours.getY(i) * 0.7152 + colours.getZ(i) * 0.0722;
          col.setXYZ(i, col.getX(i) * l, col.getY(i) * l, col.getZ(i) * l);
        }
      }
      seen.set(old, geo);
    }
    const c = m.color;
    const lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    const average = AVERAGE[paint]!;
    o.geometry = geo;
    o.material = painted(paint, paint === 'cloth' ? c.getHex() : 0xffffff, {
      side: m.side,
      roughness: m.roughness,
      metalness: Math.min(m.metalness, 0.2),
      bright: m.vertexColors
        ? 1 / average
        : paint === 'cloth'
          ? 1 / average
          : Math.min(3, Math.max(0.3, lum / average)),
    });
  });
}
