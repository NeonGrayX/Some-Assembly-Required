import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { cbox, glow, mat, put, rbox } from './kit.ts';
import { litSign, paintedSign } from './lettering.ts';
import { SPORT } from './sportscar.ts';

/**
 * The bus stop in the cars' style, somewhere to wait for the bus and to hide in: a shelter of
 * glass in charcoal frames between four teal posts, a charcoal roof out over its front with warm
 * light under it and a cyan strip along its lip, BUS STOP lit on its fascia; a perch seat of teal
 * slats along its back, a screen of the next buses, a lit poster in a box closing one end and a
 * glass panel the other; and beside it the stop's flag on its own post.
 *
 * Built standing on the origin, its open front facing +x (the bus), its length along z.
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
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.22, metalness: 0.9, envMapIntensity: 2.6 });
const white = () => mat(0xf1efe8, { mottle: 'paint', roughness: 0.4, clearcoat: 0.8 });
const glass = () =>
  mat(0xa8d8e6, {
    mottle: 'none',
    roughness: 0.05,
    metalness: 0.1,
    envMapIntensity: 2.4,
    transparent: true,
    opacity: 0.28,
  });
const frit = () =>
  mat(0xf1efe8, { mottle: 'none', roughness: 0.5, transparent: true, opacity: 0.55 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/**
 * The shelter's lines: its length (z), depth (x), its height clear under the roof, and how far
 * its roof reaches out over the front.
 */
export const SHELTER = { length: 2.8, depth: 1.3, clear: 2.3, overhang: 0.25 };

/** A poster lit from behind, `width` wide, facing +z. */
function poster(text: string[], ink: number, ground: number, width: number): THREE.Mesh {
  const sign = paintedSign(text, ink, ground, width);
  const m = sign.material as THREE.MeshStandardMaterial;
  m.emissive.set(0xffffff);
  m.emissiveMap = m.map;
  m.emissiveIntensity = 0.9;
  return sign;
}

/** A glass pane in the yz plane at `x`, `z0` to `z1` and `y0` to `y1`, a band of frit across it. */
function paneX(g: THREE.Group, x: number, z0: number, z1: number, y0: number, y1: number): void {
  cbox(g, glass(), x, (y0 + y1) / 2, (z0 + z1) / 2, 0.012, y1 - y0, z1 - z0, 0.004);
  cbox(g, frit(), x, 1.45, (z0 + z1) / 2, 0.016, 0.05, z1 - z0 - 0.02, 0.004);
}

/** The same, in the xy plane at `z`, from `x0` to `x1`. */
function paneZ(g: THREE.Group, z: number, x0: number, x1: number, y0: number, y1: number): void {
  cbox(g, glass(), (x0 + x1) / 2, (y0 + y1) / 2, z, x1 - x0, y1 - y0, 0.012, 0.004);
  cbox(g, frit(), (x0 + x1) / 2, 1.45, z, x1 - x0 - 0.02, 0.05, 0.016, 0.004);
}

/**
 * The stop's flag: a teal post on a bolted foot with a ring of cyan light, and on its head a
 * white plate edged in charcoal, a red ring barred in teal and BUS STOP on both faces, standing
 * across the kerb (its faces ±z) so the bus sees it coming.
 */
function flag(g: THREE.Group, x: number, z: number): void {
  // The plate, its middle at (`px`, `py`), on top of the post right under it.
  const [px, py] = [x + 0.3, 2.38];
  const foot = py - 0.37;
  rbox(g, charcoal(), px, 0.03, z, 0.26, 0.06, 0.26, 0.02);
  const post = new THREE.CylinderGeometry(0.04, 0.048, foot - 0.04, 20);
  put(g, post, paint(TEAL), px, 0.06 + (foot - 0.04) / 2);
  const ring = new THREE.TorusGeometry(0.05, 0.01, 8, 24);
  ring.rotateX(Math.PI / 2);
  put(g, ring, cyan(2.2), px, 0.6);
  // A steel collar at the post's head, and the bracket the plate sits in.
  const collar = new THREE.CylinderGeometry(0.052, 0.052, 0.06, 20);
  put(g, collar, polished(), px, foot - 0.06);
  rbox(g, charcoal(), px, foot - 0.01, z, 0.3, 0.04, 0.08, 0.015);
  rbox(g, charcoal(), px, py, z, 0.62, 0.74, 0.05, 0.03);
  rbox(g, white(), px, py, z, 0.56, 0.68, 0.06, 0.025);
  for (const s of [-1, 1]) {
    const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.006, 36);
    disc.rotateX(Math.PI / 2);
    put(g, disc, paint(SPORT.red), px, py + 0.1, z + s * 0.031);
    const inner = new THREE.CylinderGeometry(0.11, 0.11, 0.006, 36);
    inner.rotateX(Math.PI / 2);
    put(g, inner, white(), px, py + 0.1, z + s * 0.033);
    const bar = paintedSign('BUS', 0xf1efe8, TEAL, 0.4);
    bar.position.set(px, py + 0.1, z + s * 0.042);
    bar.rotation.y = s < 0 ? Math.PI : 0;
    g.add(bar);
    const words = paintedSign(['BUS', 'STOP'], 0x1d2326, 0xf1efe8, 0.32);
    words.position.set(px, py - 0.2, z + s * 0.031);
    words.rotation.y = s < 0 ? Math.PI : 0;
    g.add(words);
  }
}

export function busShelter(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bus shelter';
  const { length: L, depth: D, clear, overhang } = SHELTER;
  const [back, front] = [-D / 2, D / 2];
  const teal = paint(TEAL);
  // The posts at its corners, on bolted feet.
  for (const x of [back + 0.04, front - 0.04])
    for (const z of [-L / 2 + 0.04, L / 2 - 0.04]) {
      rbox(g, charcoal(), x, 0.02, z, 0.18, 0.04, 0.18, 0.015);
      rbox(g, teal, x, (clear + 0.04) / 2, z, 0.08, clear - 0.04, 0.08, 0.025);
    }
  // The roof: charcoal, out past the front, a teal skin over it, warm light under it and cyan
  // along its lip.
  const [rx0, rx1] = [back - 0.08, front + overhang];
  const roofY = clear + 0.06;
  rbox(g, charcoal(), (rx0 + rx1) / 2, roofY, 0, rx1 - rx0, 0.12, L + 0.24, 0.04);
  rbox(g, teal, (rx0 + rx1) / 2 - 0.02, roofY + 0.07, 0, rx1 - rx0 - 0.1, 0.03, L + 0.1, 0.012);
  cbox(g, glow(0xfff1d6, 2.6), 0.05, clear - 0.002, 0, 0.32, 0.008, L - 0.6, 0.003);
  for (const s of [-1, 1])
    cbox(g, cyan(2), 0.05 + s * 0.2, clear - 0.002, 0, 0.012, 0.008, L - 0.5, 0.002);
  // The fascia along its front, BUS STOP lit on it, the street's name painted behind.
  rbox(g, teal, rx1 - 0.03, roofY - 0.02, 0, 0.06, 0.26, L + 0.24, 0.02);
  cbox(g, cyan(2.2), rx1 + 0.002, roofY - 0.14, 0, 0.004, 0.01, L + 0.1, 0.002);
  const lit = litSign('BUS STOP', CAR.blue, 0.95, 2.6);
  lit.position.set(rx1 + 0.002, roofY - 0.02, 0);
  lit.rotation.y = Math.PI / 2;
  g.add(lit);
  const name = paintedSign('CHEVRON STREET', 0xf1efe8, TEAL, 1.2);
  name.position.set(rx1 - 0.062, roofY - 0.02, 0);
  name.rotation.y = -Math.PI / 2;
  g.add(name);
  // The back: rails top and foot, a mullion, two panes; cyan along its foot rail.
  const [y0, y1] = [0.18, clear - 0.12];
  for (const y of [0.12, clear - 0.08])
    rbox(g, charcoal(), back + 0.04, y, 0, 0.06, 0.08, L - 0.1, 0.02);
  rbox(g, teal, back + 0.04, (y0 + y1) / 2, 0, 0.05, y1 - y0, 0.05, 0.015);
  for (const s of [-1, 1])
    paneX(g, back + 0.04, s > 0 ? 0.03 : -L / 2 + 0.08, s > 0 ? L / 2 - 0.08 : -0.03, y0, y1);
  cbox(g, cyan(1.6), back + 0.072, 0.12, 0, 0.004, 0.012, L - 0.3, 0.002);
  // The +z end: a pane in its frame.
  for (const y of [0.12, clear - 0.08])
    rbox(g, charcoal(), 0, y, L / 2 - 0.04, D - 0.1, 0.08, 0.06, 0.02);
  paneZ(g, L / 2 - 0.04, back + 0.08, front - 0.08, y0, y1);
  // The -z end: a poster in a lit charcoal box, short of the front post.
  const [bx0, bx1] = [back + 0.08, front - 0.14];
  const bz = -L / 2 + 0.06;
  rbox(g, charcoal(), (bx0 + bx1) / 2, 1.1, bz, bx1 - bx0, 1.7, 0.14, 0.03);
  for (const s of [-1, 1]) {
    const ad = poster(['BRICKS', 'BY THE', 'BUCKET'], 0x1d2326, BUS.yellow, bx1 - bx0 - 0.16);
    ad.position.set((bx0 + bx1) / 2, 1.2, bz + s * 0.072);
    ad.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(ad);
    const strip = litSign('ALL COLOURS', 0xf1efe8, 0.5, 1.6);
    strip.position.set((bx0 + bx1) / 2, 0.55, bz + s * 0.072);
    strip.rotation.y = s > 0 ? 0 : Math.PI;
    g.add(strip);
  }
  // The perch seat along the back: teal slats on charcoal brackets, cyan under its edge.
  const seat = { y: 0.62, x0: back + 0.08, x1: back + 0.4, len: L - 0.9 };
  for (const z of [-seat.len / 2 + 0.15, seat.len / 2 - 0.15]) {
    rbox(
      g,
      charcoal(),
      (seat.x0 + seat.x1) / 2,
      seat.y - 0.05,
      z,
      seat.x1 - seat.x0,
      0.06,
      0.05,
      0.015,
    );
    rbox(g, charcoal(), seat.x0 + 0.03, seat.y - 0.2, z, 0.05, 0.3, 0.05, 0.015);
  }
  for (let k = 0; k < 3; k++) {
    const x = seat.x0 + 0.06 + k * 0.11;
    rbox(g, teal, x, seat.y, 0, 0.09, 0.04, seat.len, 0.015);
  }
  cbox(g, cyan(1.6), seat.x1 + 0.002, seat.y - 0.03, 0, 0.004, 0.01, seat.len - 0.2, 0.002);
  // The screen of the next buses, on the back's mullion over the seat's end.
  const sz = L / 2 - 0.5;
  rbox(g, charcoal(), back + 0.1, 1.62, sz, 0.08, 0.36, 0.56, 0.02);
  const face = new THREE.Group();
  face.position.set(back + 0.142, 1.62, sz);
  face.rotation.y = Math.PI / 2;
  g.add(face);
  for (const [text, colour, y] of [
    ['7 BRICK WORKS', CAR.blue, 0.09],
    ['2 MIN', CAR.amber, -0.02],
    ['12 HOUSES', CAR.blue, -0.11],
  ] as const) {
    const line = litSign(text, colour, text.length * 0.034, 2.2);
    line.position.set(-0.24 + (text.length * 0.034) / 2, y, 0);
    face.add(line);
  }
  flag(g, front + 0.1, -L / 2 - 0.45);
  return g;
}
