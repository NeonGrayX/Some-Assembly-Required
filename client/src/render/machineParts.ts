import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BrickTypeId, ColourId, MachinePart } from '@sar/shared';
import { brickGeometry, brickMaterial } from './bricks.ts';
import { add, mat, metal } from './interiors.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { addDecorations, addPrints } from './prints.ts';
import { bevelBox, bevelFor } from './shapes.ts';

/**
 * What the brick works' models are built of: shared geometries and materials, the blocks, rods
 * and signs the machines are put together from, the parts as a machine shows them, and the
 * timing helpers their jobs are posed by.
 */

const geometries = new Map<string, THREE.BufferGeometry>();
/** A geometry made once and shared, by `key`. */
export function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometries.get(key);
  if (!g) geometries.set(key, (g = make()));
  return g;
}

const boxGeo = (x: number, y: number, z: number, radius: number) =>
  cached(`box:${x}:${y}:${z}:${radius}`, () => bevelBox(x, y, z, radius));
export const canGeo = (r: number, h: number, segments = 12) =>
  cached(`can:${r}:${h}:${segments}`, () => new THREE.CylinderGeometry(r, r, h, segments));

/**
 * A box from the shared geometries, centred at `x, y, z`, its edges bevelled `radius` deep: to
 * suit its size unless it says (0 for square edges, where pieces meet as one).
 */
export function block(
  parent: THREE.Object3D,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  radius = bevelFor(sx, sy, sz),
): THREE.Mesh {
  return add(parent, boxGeo(sx, sy, sz, radius), material, x, y, z);
}

/** A corner of a box: its x, y and z. */
export type Corner = [number, number, number];

/** A box like `block`, from corner `a` to the opposite corner `b`. */
export function boxBetween(
  parent: THREE.Object3D,
  [x0, y0, z0]: Corner,
  [x1, y1, z1]: Corner,
  material: THREE.Material,
  radius?: number,
): THREE.Mesh {
  const [sx, sy, sz] = [x1 - x0, y1 - y0, z1 - z0];
  return block(parent, sx, sy, sz, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, material, radius);
}

/** A cylinder lying along x from `x0` to `x1`, its axis at `y, z`. */
export function rod(
  parent: THREE.Object3D,
  r: number,
  x0: number,
  x1: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const m = add(parent, canGeo(r, x1 - x0), material, (x0 + x1) / 2, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}

/** A cylinder lying along z from `z0` to `z1`, its axis at `x, y`. */
export function rodZ(
  parent: THREE.Object3D,
  r: number,
  z0: number,
  z1: number,
  x: number,
  y: number,
  material: THREE.Material,
): THREE.Mesh {
  const m = add(parent, canGeo(r, z1 - z0), material, x, y, (z0 + z1) / 2);
  m.rotation.x = Math.PI / 2;
  return m;
}

/** An upright cylinder (or a cone's frustum) from `y0` up to `y1`, centred on `x, z`. */
export function upright(
  parent: THREE.Object3D,
  rBottom: number,
  rTop: number,
  y0: number,
  y1: number,
  x: number,
  z: number,
  material: THREE.Material,
  segments = 16,
  open = false,
): THREE.Mesh {
  const geo = cached(`up:${rBottom}:${rTop}:${y1 - y0}:${segments}:${open}`, () => {
    return new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, segments, 1, open);
  });
  return add(parent, geo, material, x, (y0 + y1) / 2, z);
}

/** A flat ring from `y0` up to `y1`, `rIn` to `rOut` across, centred on `x, z`. */
export function collar(
  parent: THREE.Object3D,
  rIn: number,
  rOut: number,
  y0: number,
  y1: number,
  x: number,
  z: number,
  material: THREE.Material,
  segments = 16,
): THREE.Mesh {
  const h = y1 - y0;
  const geo = cached(`collar:${rIn}:${rOut}:${h}:${segments}`, () => {
    const s = new THREE.Shape().absarc(0, 0, rOut, 0, Math.PI * 2);
    s.holes.push(new THREE.Path().absarc(0, 0, rIn, 0, Math.PI * 2));
    return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: segments })
      .rotateX(-Math.PI / 2)
      .translate(0, -h / 2, 0);
  });
  return add(parent, geo, material, x, (y0 + y1) / 2, z);
}

/** A light that glows `colour` when lit, and is a dull shade of it when not. */
export const lamp = (colour: number, lit: boolean) =>
  lit ? mat(colour, 0.4, 0, colour) : mat(new THREE.Color(colour).multiplyScalar(0.35).getHex());

export const clear = new THREE.MeshStandardMaterial({
  color: 0xd8eef5,
  roughness: 0.05,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/**
 * A chalkboard in a dark frame, `w` by `h`, centred on `x, y`, its back at `z` and `label`
 * chalked on its front (+z). It stands 2.3 cm out from `z`.
 */
export function chalkSign(
  g: THREE.Object3D,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  label: string,
): void {
  block(g, w + 0.04, h + 0.04, 0.015, x, y, z + 0.0075, mat(0x5a3b22, 0.8));
  block(g, w, h, 0.006, x, y, z + 0.018, mat(0x2c3a33, 0.95));
  // The chalk is drawn on a canvas, which only a browser has.
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * h) / w);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9eef0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic ${c.height * 0.6}px "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive`;
  ctx.fillText(label, c.width / 2, c.height * 0.52, c.width * 0.9);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const chalk = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 1 }),
  );
  chalk.position.set(x, y, z + 0.023);
  chalk.userData[KEEP_SEPARATE] = true;
  g.add(chalk);
}

/** Same pseudo-random numbers every time, from a seed. */
export function rng(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

/**
 * Loose pellets heaped over a disc of radius `r` lying on y = 0: one geometry of many little
 * beads, shared by every heap that size.
 */
export function pelletHeap(r: number): THREE.BufferGeometry {
  return cached(`heap:${r}`, () => {
    const rand = rng(Math.round(r * 1e4) + 7);
    const bead = 0.011;
    const count = Math.min(140, Math.round((r / bead) ** 2 * 0.9));
    const beads: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (r - bead);
      // A little higher in the middle, like a heap.
      const y = (1 - d / r) * bead * 1.5 + rand() * bead * 0.5;
      beads.push(
        new THREE.SphereGeometry(bead, 6, 4)
          .scale(1, 0.7, 1)
          .translate(Math.cos(a) * d, y, Math.sin(a) * d),
      );
    }
    return mergeGeometries(beads)!;
  });
}

/**
 * Pellets of `colour` filling a round space of radius `r` up to `y`, heaped on top: the top
 * centimetre of them and the heap, as a group standing at `y`.
 */
export function pelletTop(g: THREE.Object3D, r: number, y: number, colour: ColourId): THREE.Group {
  const plastic = brickMaterial(colour);
  const top = new THREE.Group();
  top.position.y = y;
  g.add(top);
  const disc = upright(top, r, r, -0.01, 0, 0, 0, plastic, 20);
  const heap = add(top, pelletHeap(r), plastic, 0, 0, 0);
  for (const m of [disc, heap]) m.userData[KEEP_SEPARATE] = true;
  return top;
}

export const teal = mat(0x2f8f83, 0.5);
export const tealDark = mat(0x23706a, 0.55);
export const machineGrey = mat(0x5d646b, 0.6);
export const panelGrey = mat(0x3a3f44, 0.6);
export const darkMetal = metal(0x2b2d30);
export const steel = metal(0xb0b6bc);
export const screen = mat(0x4fc3f7, 0.3, 0, 0x1e6fb5);
export const smoked = new THREE.MeshStandardMaterial({
  color: 0x2a3036,
  roughness: 0.15,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/**
 * A part as it lies on a printer's bed, its pictures on it: at its own size if it fits in the
 * room there (`w` across, `d` deep, `room` high), smaller if not, its foot's middle on the bed's
 * top at (`x`, `top`, `z`).
 */
export function bedPart(
  p: MachinePart,
  svgs: Record<string, string>,
  bed: { top: number; x: number; z: number; w: number; d: number; room: number },
): THREE.Mesh {
  const geo = brickGeometry(p.type);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const k = Math.min(1, bed.w / size.x, bed.d / size.z, bed.room / size.y);
  const part = new THREE.Mesh(geo, brickMaterial(p.colour));
  part.scale.setScalar(k);
  const mid = bb.getCenter(new THREE.Vector3()).multiplyScalar(k);
  part.position.set(bed.x - mid.x, bed.top + 0.001 - bb.min.y * k, bed.z - mid.z);
  addDecorations(part, p.type);
  if (p.prints) addPrints(part, p.type, p.prints, svgs);
  return part;
}

/** From when to when something happens (seconds). */
export type Span = readonly [number, number];

/** How far `t` is from `a` to `b`, from 0 to 1. */
export function span(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Eased in and out. */
export function ease(x: number): number {
  return x * x * (3 - 2 * x);
}

/** A part in `colour`, at most `size` across, centred on its origin. */
function partModel(type: BrickTypeId, colour: ColourId, size: number): THREE.Group {
  const geo = brickGeometry(type);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const dims = bb.getSize(new THREE.Vector3());
  const part = new THREE.Mesh(geo, brickMaterial(colour));
  part.position.copy(bb.getCenter(new THREE.Vector3()).negate());
  part.castShadow = true;
  addDecorations(part, type);
  const inner = new THREE.Group();
  inner.add(part);
  inner.scale.setScalar(1 / Math.max(dims.x, dims.y, dims.z));
  const g = new THREE.Group();
  g.add(inner);
  g.scale.setScalar(size);
  return g;
}

/** How big (at most, across) a part is drawn in a moulding machine's bay. */
const BAY_PART = 0.13;

/**
 * A part in `colour` as it lies in a moulding machine's bay, `BAY_PART` across at most, the
 * right way up, its origin the middle of its bottom. Its one child is the part about its own
 * middle, to turn it by.
 */
export function lyingPart(type: BrickTypeId, colour: ColourId): THREE.Group {
  const geo = brickGeometry(type);
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const part = partModel(type, colour, BAY_PART);
  part.position.y = (BAY_PART * size.y) / Math.max(size.x, size.y, size.z) / 2;
  const g = new THREE.Group();
  g.add(part);
  return g;
}

/** Throws away the geometries made for what is under `o` alone (see `ownMesh`). */
export function disposeOwn(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh && c.userData.own) c.geometry.dispose();
  });
}

/** A mesh with a geometry of its own (thrown away when it is rebuilt), at height `y`. */
export function ownMesh(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  y: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  m.userData.own = true;
  return m;
}
