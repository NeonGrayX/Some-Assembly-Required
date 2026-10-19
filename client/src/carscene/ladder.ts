import * as THREE from 'three';
import { CAR } from './car.ts';
import { bentPath, cbox, glow, mat, put, rbox, tube } from './kit.ts';

/**
 * A fixed ladder in the cars' style, for climbing onto a roof: two polished steel stiles, charcoal
 * rungs ribbed for grip with steel caps at their ends, a cyan strip of light up each stile's outer
 * face, charcoal brackets holding it off the wall behind it, rubber feet, and grab rails bending
 * over the top, out past the roof's edge, to step off between.
 *
 * Built standing on the origin, its rungs along x, the wall behind it at -z (`standoff` back).
 * `height` is to its top rung; its rails go on `rise` over that (`LADDER_RAIL` unless given).
 */

const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const steel = () =>
  mat(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const rubber = () => mat(0x1d1e1f, { mottle: 'plastic', roughness: 0.9 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** Its width between the stiles' middles, how far apart its rungs are, and the rails' rise. */
export const LADDER = { width: 0.46, pitch: 0.28 };
export const LADDER_RAIL = 1.0;

export function buildLadder(
  height: number,
  standoff: number,
  brackets = 3,
  rise = LADDER_RAIL,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ladder';
  const half = LADDER.width / 2;
  const s = 0.045;
  for (const side of [-1, 1]) {
    const x = side * half;
    rbox(g, rubber(), x, 0.03, 0, 0.09, 0.06, 0.09, 0.02);
    rbox(g, steel(), x, height / 2 + 0.03, 0, s, height - 0.06, s * 1.4, 0.014);
    cbox(g, cyan(2), x + side * (s / 2 + 0.002), height / 2, 0, 0.004, height - 0.4, 0.012, 0.002);
    // The grab rail: up from the stile's head, over and down toward the roof behind.
    const rail = bentPath(
      [
        new THREE.Vector3(x, height - 0.05, 0),
        new THREE.Vector3(x, height + rise, 0),
        new THREE.Vector3(x, height + rise, -standoff * 0.7),
        new THREE.Vector3(x, height + rise - 0.35, -standoff * 0.7),
      ],
      0.16,
    );
    tube(g, rail, s / 2, steel());
  }
  // The rungs, from a step up off the ground to the top.
  const rungs = Math.floor((height - 0.25) / LADDER.pitch) + 1;
  for (let k = 0; k < rungs; k++) {
    const y = height - k * LADDER.pitch;
    const rung = new THREE.CylinderGeometry(0.019, 0.019, LADDER.width - s, 14);
    rung.rotateZ(Math.PI / 2);
    put(g, rung, charcoal(), 0, y, 0);
    for (let r = -2; r <= 2; r++) {
      const rib = new THREE.TorusGeometry(0.02, 0.004, 6, 14);
      rib.rotateY(Math.PI / 2);
      put(g, rib, charcoal(), r * 0.07, y, 0);
    }
  }
  // Brackets back to the wall, evenly up it, each a charcoal arm and a plate on the wall.
  for (let k = 0; k < brackets; k++) {
    const y = 0.6 + ((height - 0.9) * k) / Math.max(1, brackets - 1);
    for (const side of [-1, 1]) {
      const x = side * half;
      rbox(g, charcoal(), x, y, -standoff / 2, 0.04, 0.05, standoff, 0.012);
      rbox(g, charcoal(), x, y, -standoff + 0.01, 0.12, 0.16, 0.02, 0.008);
      for (const b of [-0.05, 0.05]) {
        const bolt = new THREE.CylinderGeometry(0.01, 0.01, 0.012, 8);
        bolt.rotateX(Math.PI / 2);
        put(g, bolt, steel(), x, y + b, -standoff + 0.024);
      }
    }
  }
  return g;
}
