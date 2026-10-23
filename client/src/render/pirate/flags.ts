import * as THREE from 'three';
import { add } from '../interiors.ts';
import { KEEP_SEPARATE } from '../merge.ts';
import { hex, put } from '../nature.ts';
import { bevelCylinder } from '../shapes.ts';
import { Surface } from '../styles.ts';
import { FLAG, iron, lathe, made, times } from './kit.ts';
import type { Column, Turn } from './kit.ts';

/** Flags with the skull and crossbones, and the flagpole they fly from. */

/** The skull and crossbones, painted once on a canvas every pirate flag shares. */
let jollyRoger: THREE.CanvasTexture | null | undefined;

function skullTexture(): THREE.CanvasTexture | null {
  if (jollyRoger !== undefined) return jollyRoger;
  // Drawn on a canvas, which only a browser has.
  if (typeof document === 'undefined') return (jollyRoger = null);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 168;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1c1b1f';
  x.fillRect(0, 0, 256, 168);
  const bone = '#efe5cc';
  x.fillStyle = bone;
  x.strokeStyle = bone;
  x.lineCap = 'round';
  // The crossbones, behind the skull, knobbly at their ends.
  x.lineWidth = 16;
  for (const [a, b, e, f] of [
    [70, 46, 186, 140],
    [186, 46, 70, 140],
  ] as const) {
    x.beginPath();
    x.moveTo(a, b);
    x.lineTo(e, f);
    x.stroke();
    for (const [px, py] of [
      [a, b],
      [e, f],
    ] as const) {
      const dx = px < 128 ? -1 : 1;
      x.beginPath();
      x.arc(px + dx * 2, py - 9, 11, 0, Math.PI * 2);
      x.arc(px + dx * 6, py + 7, 11, 0, Math.PI * 2);
      x.fill();
    }
  }
  // The skull: its dome, its jaw, and the dark of its eyes, nose and teeth.
  x.beginPath();
  x.arc(128, 74, 44, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.roundRect(100, 92, 56, 42, 10);
  x.fill();
  x.fillStyle = '#1c1b1f';
  for (const ex of [110, 146]) {
    x.beginPath();
    x.ellipse(ex, 80, 13, 15, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.beginPath();
  x.moveTo(128, 96);
  x.lineTo(121, 110);
  x.lineTo(135, 110);
  x.fill();
  x.fillRect(107, 119, 42, 3);
  for (const tx of [115, 124, 133, 142]) x.fillRect(tx, 114, 3, 18);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return (jollyRoger = texture);
}

let flagCloth: THREE.Material | null = null;

/**
 * A pirate flag `fw` long and `fh` deep flying from a pole at the origin out along +x, its
 * head at y = 0: black with the skull and crossbones, rippling, and ragged at its free end.
 */
export function pirateFlag(fw: number, fh: number, seed: () => number): THREE.Mesh {
  const cols = 12;
  const rows = 6;
  const geometry = new THREE.PlaneGeometry(fw, fh, cols, rows);
  geometry.translate(fw / 2, -fh / 2, 0);
  const pos = geometry.attributes.position!;
  const phase = seed() * Math.PI * 2;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    // (Clamped: the hoist's x can come out a hair under 0, and a power of that is NaN.)
    const t = Math.min(1, Math.max(0, x / fw));
    // Ripples running out along it, deeper toward its free end, which droops a little and is
    // torn ragged.
    const z = 0.09 * t ** 0.7 * Math.sin((x / fw) * Math.PI * 2.4 + phase - y * 1.5);
    const ragged = t > 0.99 ? -(0.03 + 0.08 * Math.abs(Math.sin(y * 37 + phase))) * fw : 0;
    pos.setXYZ(k, x + ragged, y - 0.06 * fh * t * t, z);
  }
  geometry.computeVertexNormals();
  const texture = skullTexture();
  flagCloth ??= texture
    ? new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.95,
        side: THREE.DoubleSide,
      })
    : made(FLAG, Surface.Fabric, 0.95, 0, true);
  const flag = new THREE.Mesh(geometry, flagCloth);
  flag.castShadow = flag.receiveShadow = true;
  // (Painted on a canvas: drawn as it is, not merged.)
  flag.userData[KEEP_SEPARATE] = !!texture;
  return flag;
}

/** A turned timber pole from `y0` to `y1`, `r0` round at its foot and `r1` at its top. */
export function pole(
  r0: number,
  r1: number,
  y0: number,
  y1: number,
  colour: number,
  seed: () => number,
) {
  const wood = hex(colour);
  const columns: Column[] = Array.from({ length: 10 }, (_, i) => ({
    a: (i / 10) * Math.PI * 2,
    out: 0.96 + seed() * 0.04,
    shade: 0.82 + seed() * 0.3,
  }));
  // Its taper and its colour run straight from its foot to its top, so between the rings a
  // sixth of the way in from each end (where its normals turn to its ends') one band draws it,
  // its colours blending along it as rings between would have.
  const ring = (f: number): Turn => ({
    y: y0 + (y1 - y0) * f,
    r: r0 + (r1 - r0) * f,
    colour: times(wood, 0.8 + 0.25 * f),
    relief: 1,
  });
  return lathe(
    [
      { y: y0, r: 0, colour: times(wood, 0.5) },
      ring(0),
      ring(1 / 6),
      ring(5 / 6),
      ring(1),
      { y: y1, r: 0, colour: wood.clone().lerp(hex(0xd9c29a), 0.4) },
    ],
    columns,
  );
}

/** How far a flagpole's flag flies out from the pole, for the pole's height. */
export const flagFly = (h: number): number => Math.min(1.1, h * 0.28);

/**
 * A flagpole, the box: a timber pole with an iron collar at its foot and a ball on its top,
 * and a pirate flag flying from it out over -x, beyond the box.
 */
export function flagpoleModel(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const r = Math.min(w, d) / 2;
  put(g, pole(r * 0.85, r * 0.55, -h / 2, h / 2 - 0.07, colour, seed), Surface.Auto);
  add(g, bevelCylinder(r * 0.98, r, 0.12, 10), iron(), 0, -h / 2 + 0.08, 0);
  add(g, new THREE.SphereGeometry(r * 0.75, 10, 8), iron(), 0, h / 2 - r * 0.6, 0);
  const flag = pirateFlag(flagFly(h), Math.min(0.7, h * 0.18), seed);
  flag.rotation.y = Math.PI;
  flag.position.set(-r * 0.4, h / 2 - 0.14, 0);
  g.add(flag);
}
