import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { cbox, glow, mat, put, rbox, rng } from './kit.ts';
import { paintedSign } from './lettering.ts';
import { SPORT } from './sportscar.ts';

/**
 * What closes the map in, in the cars' style: road-closed barriers across the street's ends with
 * their sign, a builders' hoarding round the site, and a clipped hedge in a charcoal trough.
 *
 * Each is built standing on the origin, running along z, its face toward +x.
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
const cyan = (k = 1.8) => glow(CAR.blue, k);

/**
 * A road barrier `length` long: a board striped in red and white chevrons pointing to its
 * middle, on two charcoal legs on polished steel feet, an amber blinker at each end of its top
 * and a strip of cyan light along its foot rail.
 */
export function roadBarrier(length: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'road barrier';
  const board = { y: 0.82, h: 0.3, t: 0.05 };
  for (const s of [-1, 1]) {
    const z = s * (length / 2 - 0.25);
    rbox(g, polished(), 0, 0.03, z, 0.62, 0.06, 0.16, 0.025);
    rbox(g, charcoal(), 0, 0.09, z, 0.5, 0.06, 0.12, 0.02);
    rbox(g, charcoal(), 0, (board.y + 0.12) / 2, z, 0.07, board.y - 0.12, 0.07, 0.02);
    // The blinker on top of the board's end.
    rbox(g, charcoal(), 0, board.y + board.h / 2 + 0.03, z, 0.1, 0.06, 0.1, 0.02);
    const lamp = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24);
    lamp.rotateZ(Math.PI / 2);
    put(g, lamp, glow(CAR.amber, 2.6), 0, board.y + board.h / 2 + 0.12, z);
    const rim = new THREE.TorusGeometry(0.062, 0.012, 8, 24);
    rim.rotateY(Math.PI / 2);
    put(g, rim, charcoal(), 0, board.y + board.h / 2 + 0.12, z);
  }
  // The board: white, the red chevrons laid over it on both faces.
  rbox(g, white(), 0, board.y, 0, board.t, board.h, length, 0.02);
  const red = paint(SPORT.red);
  const stripe = 0.18;
  for (let z = -length / 2 + 0.16; z < length / 2 - 0.1; z += stripe * 2) {
    const lean = z + stripe / 2 < 0 ? 0.7 : -0.7;
    for (const s of [-1, 1]) {
      const bar = cbox(
        g,
        red,
        s * (board.t / 2 + 0.001),
        board.y,
        z + stripe / 2,
        0.004,
        board.h * 1.18,
        stripe * 0.75,
        0.002,
      );
      bar.rotation.x = lean;
    }
  }
  // Trim the stripes' ends with a charcoal edge top and bottom.
  for (const y of [board.y - board.h / 2, board.y + board.h / 2])
    rbox(g, charcoal(), 0, y, 0, board.t + 0.02, 0.04, length + 0.02, 0.015);
  // A foot rail between the legs, lit along its face.
  rbox(g, charcoal(), 0, 0.3, 0, 0.05, 0.06, length - 0.5, 0.02);
  for (const s of [-1, 1]) cbox(g, cyan(2), s * 0.027, 0.3, 0, 0.004, 0.012, length - 0.7, 0.002);
  return g;
}

/**
 * The road-closed sign: a red disc with a white bar on a teal post, ROAD CLOSED on a white plate
 * under it, a bolted charcoal foot, a cyan ring of light round the post.
 */
export function closedSign(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'road closed sign';
  rbox(g, charcoal(), 0, 0.04, 0, 0.42, 0.08, 0.42, 0.03);
  const post = new THREE.CylinderGeometry(0.04, 0.05, 1.9, 20);
  put(g, post, paint(TEAL), 0, 1.03);
  const ring = new THREE.CylinderGeometry(0.052, 0.052, 0.03, 20, 1, true);
  put(g, ring, cyan(2.2), 0, 0.5);
  for (const s of [-1, 1]) {
    const disc = new THREE.CylinderGeometry(0.32, 0.32, 0.02, 40);
    disc.rotateZ(Math.PI / 2);
    put(g, disc, paint(SPORT.red), s * 0.06, 1.62, 0);
    const rim = new THREE.TorusGeometry(0.32, 0.015, 8, 40);
    rim.rotateY(Math.PI / 2);
    put(g, rim, white(), s * 0.06, 1.62, 0);
    cbox(g, white(), s * 0.072, 1.62, 0, 0.004, 0.1, 0.42, 0.01);
  }
  for (const s of [-1, 1]) {
    const plate = paintedSign(['ROAD', 'CLOSED'], 0x1d2326, 0xf1efe8, 0.5);
    plate.position.set(s * 0.052, 1.08, 0);
    plate.rotation.y = (s * Math.PI) / 2;
    g.add(plate);
  }
  cbox(g, charcoal(), 0, 1.08, 0, 0.1, 0.34, 0.54, 0.02);
  return g;
}

/**
 * A builders' hoarding `length` long: teal lacquered panels 2.2 m high between charcoal posts,
 * a yellow and charcoal hazard band along its top, a cyan strip at its foot, and a banner with
 * the game's name hung on its face.
 */
export function hoarding(length: number, banner = true): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hoarding';
  const h = 2.2;
  const bays = Math.max(1, Math.round(length / 2.4));
  const bay = length / bays;
  for (let k = 0; k <= bays; k++) {
    const z = -length / 2 + k * bay;
    rbox(g, charcoal(), 0, 0.06, z, 0.6, 0.12, 0.2, 0.03);
    rbox(g, charcoal(), 0, h / 2 + 0.05, z, 0.12, h + 0.1, 0.12, 0.03);
    const cap = new THREE.SphereGeometry(0.06, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    put(g, cap, polished(), 0, h + 0.1, z);
  }
  for (let k = 0; k < bays; k++) {
    const z = -length / 2 + (k + 0.5) * bay;
    rbox(g, paint(TEAL), 0, 0.12 + (h - 0.12) / 2, z, 0.05, h - 0.12, bay - 0.14, 0.02);
    // Its seams: two upright grooves across each panel.
    for (const t of [-1 / 3, 1 / 3])
      for (const s of [-1, 1])
        cbox(
          g,
          mat(0x1e3038, { mottle: 'none', roughness: 0.85 }),
          s * 0.026,
          0.12 + (h - 0.12) / 2,
          z + t * (bay - 0.14),
          0.004,
          h - 0.2,
          0.012,
          0.002,
        );
  }
  // The hazard band along the top, both faces: yellow with charcoal stripes.
  const band = 0.16;
  for (const s of [-1, 1]) {
    cbox(g, paint(BUS.yellow), s * 0.03, h - band / 2 - 0.04, 0, 0.006, band, length - 0.1, 0.003);
    for (let z = -length / 2 + 0.15; z < length / 2 - 0.1; z += 0.3) {
      const bar = cbox(
        g,
        charcoal(),
        s * 0.034,
        h - band / 2 - 0.04,
        z,
        0.004,
        band * 1.25,
        0.08,
        0.002,
      );
      bar.rotation.x = 0.7;
    }
    cbox(g, cyan(1.8), s * 0.03, 0.16, 0, 0.004, 0.012, length - 0.2, 0.002);
  }
  if (banner) {
    const sign = paintedSign(
      ['SOME ASSEMBLY', 'REQUIRED'],
      0xf1efe8,
      0x1d2326,
      Math.min(3.2, length * 0.6),
    );
    sign.position.set(0.075, 1.2, 0);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    const back = sign.clone();
    back.position.x = -0.075;
    back.rotation.y = -Math.PI / 2;
    g.add(back);
  }
  return g;
}

/**
 * A clipped hedge `length` long in a charcoal trough: a block of leaves, its top and sides
 * bulging in rounded clumps, two greens mottled together, and a cyan strip along the trough.
 */
export function hedge(length: number, seed = 5): THREE.Group {
  const g = new THREE.Group();
  g.name = 'hedge';
  const [w, trough, h] = [0.7, 0.42, 1.25];
  rbox(g, charcoal(), 0, trough / 2, 0, w + 0.1, trough, length + 0.1, 0.05);
  for (const s of [-1, 1])
    cbox(
      g,
      cyan(1.4),
      s * ((w + 0.1) / 2 + 0.002),
      trough - 0.08,
      0,
      0.004,
      0.012,
      length - 0.1,
      0.002,
    );
  const leaves = [0x4f7d3a, 0x3f6a30, 0x5d8c44].map((c) =>
    mat(c, { mottle: 'paint', roughness: 0.85 }),
  );
  rbox(
    g,
    leaves[1]!,
    0,
    trough + (h - trough) / 2 - 0.02,
    0,
    w - 0.08,
    h - trough,
    length - 0.08,
    0.16,
  );
  const rand = rng(seed);
  // Clumps along its top and down its sides.
  for (let z = -length / 2 + 0.2; z < length / 2 - 0.15; z += 0.28) {
    for (const [x, y, r] of [
      [0, h - 0.04, 0.24],
      [(w / 2 - 0.1) * (rand() < 0.5 ? -1 : 1), h - 0.3, 0.2],
      [-(w / 2 - 0.12), trough + 0.35 + rand() * 0.2, 0.18],
      [w / 2 - 0.12, trough + 0.35 + rand() * 0.2, 0.18],
    ] as const) {
      const clump = new THREE.IcosahedronGeometry(r * (0.85 + rand() * 0.3), 1);
      const m = put(g, clump, leaves[Math.floor(rand() * 3)]!, x, y, z + (rand() - 0.5) * 0.1);
      m.scale.set(1, 0.75, 1);
      m.rotation.y = rand() * Math.PI;
    }
  }
  return g;
}
