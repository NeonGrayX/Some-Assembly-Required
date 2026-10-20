import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { dimmable, powered } from './gadgets.ts';
import { cbox, glow, mat, put, rbox } from './kit.ts';
import { SPORT } from './sportscar.ts';

/**
 * A floodlight mast in the cars' style, to light the lot after dark: a tall teal mast on a
 * concrete block and a bolted charcoal flange, a yellow and charcoal sleeve round its foot, a
 * hatch with a steel lock, a cyan ring of light low down; at its head a charcoal
 * frame carrying four lamps in two rows, each a charcoal housing on a steel yoke, tipped down,
 * glowing warm white and edged in cyan; and a red warning lamp on its top.
 *
 * Built standing on the origin, its lamps facing +x.
 */

const TEAL = 0x2c6670;

const paint = (colour: number) =>
  mat(colour, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const concrete = () => mat(0x9a9c9c, { mottle: 'plastic', roughness: 0.85 });
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.22, metalness: 0.9, envMapIntensity: 2.6 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** The mast: its foot's block, its height to the head frame, and its radius at foot and head. */
export const MAST = { block: 0.32, height: 6.8, foot: 0.13, head: 0.085 };

/** The lamps' warm white, and how far they are tipped down. */
const LAMP = { colour: 0xfff1d6, tilt: 0.5 };

/** One lamp at (`y`, `z`) on the head frame: housing, lens, yoke and cyan edge, tipped down. */
function lamp(g: THREE.Group, y: number, z: number, lens: THREE.Material): void {
  const yoke = new THREE.Group();
  yoke.position.set(0.12, y, z);
  g.add(yoke);
  for (const s of [-1, 1]) rbox(yoke, polished(), 0, 0, s * 0.23, 0.12, 0.06, 0.025, 0.01);
  const head = new THREE.Group();
  head.position.x = 0.06;
  head.rotation.z = -LAMP.tilt;
  yoke.add(head);
  rbox(head, charcoal(), 0, 0, 0, 0.16, 0.34, 0.42, 0.04);
  // Fins on its back.
  for (let k = -2; k <= 2; k++) cbox(head, charcoal(), -0.1, k * 0.06, 0, 0.05, 0.02, 0.38, 0.006);
  cbox(head, lens, 0.082, 0, 0, 0.004, 0.27, 0.35, 0.002);
  // The lens's grille, and its cyan edge.
  for (let k = -1; k <= 1; k++)
    cbox(head, charcoal(), 0.086, k * 0.07, 0, 0.004, 0.008, 0.35, 0.002);
  for (const s of [-1, 1]) {
    cbox(head, cyan(2.2), 0.084, s * 0.155, 0, 0.004, 0.008, 0.4, 0.002);
    cbox(head, cyan(2.2), 0.084, 0, s * 0.2, 0.004, 0.31, 0.008, 0.002);
  }
}

export function floodlightMast(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'floodlight mast';
  const { block, height, foot, head } = MAST;
  // The block it is set in, and the bolted flange on it.
  rbox(g, concrete(), 0, block / 2, 0, 0.72, block, 0.72, 0.04);
  rbox(g, charcoal(), 0, block + 0.02, 0, 0.44, 0.04, 0.44, 0.015);
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      const bolt = new THREE.CylinderGeometry(0.022, 0.022, 0.04, 8);
      put(g, bolt, polished(), a * 0.16, block + 0.05, b * 0.16);
    }
  cbox(g, cyan(1.6), 0.362, block - 0.06, 0, 0.004, 0.012, 0.6, 0.002);
  const y0 = block + 0.04;
  const mast = new THREE.CylinderGeometry(head, foot, height - y0, 28);
  put(g, mast, paint(TEAL), 0, (height + y0) / 2);
  const r = (y: number) => foot + ((head - foot) * (y - y0)) / (height - y0);
  // Its sleeve: yellow between two charcoal rings, a charcoal band round its middle.
  const sleeve = new THREE.CylinderGeometry(r(0.9) + 0.008, r(0.4) + 0.008, 0.5, 28);
  put(g, sleeve, paint(BUS.yellow), 0, 0.65);
  for (const y of [0.4, 0.65, 0.9]) {
    const ring = new THREE.CylinderGeometry(r(y) + 0.014, r(y) + 0.014, 0.05, 28);
    put(g, ring, charcoal(), 0, y);
  }
  // The ring of light, and steel bands up it.
  const glowRing = new THREE.TorusGeometry(r(1.2) + 0.006, 0.012, 8, 32);
  glowRing.rotateX(Math.PI / 2);
  put(g, glowRing, cyan(2.2), 0, 1.2);
  // The top one's foot a little below the lower crossbar's, not in the same plane.
  for (const y of [3.2, height - 0.104]) {
    const band = new THREE.CylinderGeometry(r(y) + 0.01, r(y) + 0.01, 0.06, 28);
    put(g, band, polished(), 0, y);
  }
  // The hatch, on its back away from the lamps: a cover proud of the mast, edged in charcoal,
  // and a steel lock.
  const back = -r(1.62);
  rbox(g, charcoal(), back - 0.004, 1.62, 0, 0.03, 0.5, 0.15, 0.012);
  rbox(g, paint(TEAL), back - 0.012, 1.62, 0, 0.03, 0.46, 0.12, 0.012);
  const lock = new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12);
  lock.rotateZ(Math.PI / 2);
  put(g, lock, polished(), back - 0.03, 1.66, 0);

  // The head frame: a crossbar for each row of lamps on a charcoal collar, a cap on the top.
  rbox(g, charcoal(), 0, height + 0.05, 0, 0.24, 0.22, 0.24, 0.04);
  const rows = [height + 0.42, height - 0.08];
  for (const y of rows) {
    rbox(g, charcoal(), 0.02, y, 0, 0.1, 0.1, 1.24, 0.03);
    cbox(g, cyan(2), 0.072, y - 0.03, 0, 0.004, 0.01, 1.1, 0.002);
  }
  for (const s of [-1, 1])
    rbox(g, charcoal(), 0.02, rows[1]! + 0.25, s * 0.6, 0.08, 0.6, 0.06, 0.02);
  rbox(g, paint(TEAL), 0, height + 0.25, 0, 0.12, 0.5, 0.12, 0.03);
  // Its lamps' lenses and its beacon, fed by the mains (see `powered`).
  const lit = dimmable(glow(LAMP.colour, 3.4), glow(SPORT.tail, 3));
  const [lens, beaconLens] = lit.mats;
  powered(g, lit.set);
  for (const y of rows) for (const s of [-1, 1]) lamp(g, y, s * 0.31, lens);
  // The red warning lamp on top.
  rbox(g, charcoal(), 0, rows[0]! + 0.12, 0, 0.12, 0.08, 0.12, 0.02);
  const beacon = new THREE.SphereGeometry(0.05, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  put(g, beacon, beaconLens, 0, rows[0]! + 0.16);
  return g;
}
