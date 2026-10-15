import * as THREE from 'three';
import { Surface, madeOf } from '../render/styles.ts';

/**
 * The small toolkit the pirate test map's models are made with: materials in the game's painted
 * style (each tagged with what it is made of), parts placed in one call, a seeded random, and
 * the faceted look of the reference's rocks and leaves.
 */

const materials = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOptions {
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  flat?: boolean;
}

/** A painted material of `colour` made of `surface`, shared between parts that are alike. */
export function mat(
  colour: number,
  surface: Surface,
  o: MatOptions = {},
): THREE.MeshStandardMaterial {
  const key = JSON.stringify([colour, surface, o]);
  let m = materials.get(key);
  if (!m) {
    m = madeOf(
      new THREE.MeshStandardMaterial({
        color: colour,
        roughness: o.roughness ?? 0.85,
        metalness: o.metalness ?? 0,
        emissive: o.emissive ?? 0x000000,
        emissiveIntensity: o.emissiveIntensity ?? 1,
        side: o.side ?? THREE.FrontSide,
        vertexColors: o.vertexColors ?? false,
        flatShading: o.flat ?? false,
      }),
      surface,
    );
    materials.set(key, m);
  }
  return m;
}

/** The palette, as sRGB, picked from the reference picture. */
export const C = {
  woodDark: 0x4e3020,
  wood: 0x6e4529,
  woodLight: 0x8f5d36,
  woodPale: 0xa9784a,
  plaster: 0xd8cca0,
  plasterShade: 0xc4b98f,
  roofBlue: 0x37315f,
  roofRed: 0x8e3f2a,
  iron: 0x434850,
  ironLight: 0x6c727c,
  rock: 0x8f96a1,
  rockTop: 0xbfc3c8,
  rockDark: 0x666e7c,
  sailWhite: 0xe2d4b6,
  sailRed: 0xa9482c,
  leaf: 0xa8c444,
  leafDark: 0x6a8f2a,
  trunk: 0x8a6646,
  bush: 0x6aa22e,
  bushDark: 0x3f7a22,
  rope: 0xc6a874,
  glow: 0xffc65a,
  glass: 0x2f7a3a,
  flagBlack: 0x232226,
  flagRed: 0xb3342a,
  sack: 0xc8ae7c,
  coral: 0x9c2b25,
} as const;

/** A mesh of `geometry` in `material` at (`x`, `y`, `z`), turned by `rx`, `ry`, `rz`. */
export function part(
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

/** A group at (`x`, `y`, `z`) turned `yaw` about y, added to `parent`. */
export function group(parent: THREE.Object3D, x = 0, y = 0, z = 0, yaw = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  parent.add(g);
  return g;
}

/** A seeded random in [0, 1) (mulberry32), so the map is the same every time it loads. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same geometry with every face its own, lit flat: the faceted look of rocks and leaves. */
export function faceted(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  return out;
}

/**
 * A cylinder from `a` to `b` (radius `r`, tapering to `r2` at `b`): a beam, rope or spar laid
 * between two points.
 */
export function between(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  material: THREE.Material,
  r2 = r,
  sides = 8,
): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r2, r, len, sides, 1);
  const m = new THREE.Mesh(g, material);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/**
 * A rope sagging from `a` to `b` by `sag` metres at its middle, as a chain of short cylinders.
 */
export function rope(
  parent: THREE.Object3D,
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag: number,
  r = 0.025,
  material = mat(C.rope, Surface.Fabric),
): void {
  const n = Math.max(3, Math.ceil(a.distanceTo(b) / 0.6));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(
      a
        .clone()
        .lerp(b, t)
        .setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)),
    );
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, n * 2, r, 5, false), material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
}
