import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { tuft } from './ground.ts';
import {
  bentPath,
  cbox,
  flatSlab,
  glow,
  mat,
  type MatOptions,
  put,
  rbox,
  rng,
  soilBed,
  tube,
} from './kit.ts';
import { SPORT } from './sportscar.ts';

/**
 * The houses' insides, in the cars' style as their outsides are: pale lined walls, a warm floor,
 * charcoal furniture with teal and red cushions, white tops, steel trim, and cyan light strips
 * under their edges; round ceiling lights ringed in cyan, glowing screens, and plants.
 *
 * Every piece is built at its own origin on the floor, its front toward +z, its back (where it
 * meets a wall) at z = 0 unless it stands free; the houses place and turn them.
 */

const TEAL = 0x2c6670;

/**
 * A material that reads as lit from within the room: its own colour, a little of it glowing, as
 * the light from the ceiling would lift it where the sun through the windows does not reach.
 */
function lit(colour: number, o: MatOptions = {}, k = 0.2): THREE.MeshStandardMaterial {
  const emissive = new THREE.Color(colour).multiplyScalar(k).getHex();
  return mat(colour, { roughness: 0.7, ...o, emissive, emissiveIntensity: 1 });
}

/** The rooms' surfaces: the walls' lining, the ceilings and the floors. */
export const wallIn = () => lit(0xe4dfd5, { mottle: 'plastic', roughness: 0.9 }, 0.24);
export const ceiling = () => lit(0xdcd8d0, { mottle: 'plastic', roughness: 0.9 }, 0.3);
export const floor = () => lit(0x8a6f56, { mottle: 'plastic', roughness: 0.55 }, 0.16);

const charcoal = (side: THREE.Side = THREE.FrontSide) =>
  lit(CAR.trim, { mottle: 'plastic', roughness: 0.6, side }, 0.12);
const earth = () => lit(0x4a3526, { mottle: 'soil', roughness: 1 }, 0.12);
const teal = () => lit(TEAL, { mottle: 'plastic', roughness: 0.8 }, 0.18);
const red = () => lit(SPORT.red, { mottle: 'plastic', roughness: 0.6 }, 0.14);
const white = () => lit(0xeceae4, { mottle: 'plastic', roughness: 0.35 }, 0.18);
const steel = () =>
  mat(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.4 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** A wall's lining: its outline as a thin pale panel, to stand just inside the wall. */
export function lining(shape: THREE.Shape): THREE.BufferGeometry {
  return flatSlab(shape, 0.02, 0.006);
}

/** A group at (`x`, `y`, `z`) in `parent`, turned `turn` about the upright. */
export function place(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  turn = 0,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'furniture';
  g.position.set(x, y, z);
  g.rotation.y = turn;
  parent.add(g);
  return g;
}

/** A sofa `len` long: a charcoal frame and arms, teal cushions, a cyan strip under its front. */
export function sofa(g: THREE.Object3D, len: number): void {
  const d = 0.86;
  rbox(g, charcoal(), 0, 0.15, d / 2, len, 0.22, d, 0.04);
  for (const sx of [-1, 1])
    for (const z of [0.08, d - 0.08])
      cbox(g, steel(), sx * (len / 2 - 0.1), 0.02, z, 0.05, 0.04, 0.05, 0.01);
  const n = len > 1.7 ? 3 : 2;
  const inner = len - 0.32;
  for (let k = 0; k < n; k++) {
    const x = -inner / 2 + (k + 0.5) * (inner / n);
    rbox(g, teal(), x, 0.35, d / 2 + 0.06, inner / n - 0.02, 0.18, d - 0.26, 0.06);
    rbox(g, teal(), x, 0.66, 0.16, inner / n - 0.02, 0.46, 0.2, 0.07);
  }
  for (const sx of [-1, 1])
    rbox(g, charcoal(), sx * (len / 2 - 0.08), 0.42, d / 2, 0.16, 0.42, d, 0.05);
  rbox(g, red(), -inner / 2 + 0.25, 0.56, 0.32, 0.36, 0.3, 0.1, 0.05, [0.25, 0.2, 0]);
  cbox(g, cyan(), 0, 0.035, d - 0.01, len - 0.2, 0.01, 0.012, 0.003);
}

/** A low table: a white top on charcoal legs, a steel shelf under it. */
export function coffeeTable(g: THREE.Object3D, w = 1.0, d = 0.56): void {
  rbox(g, white(), 0, 0.4, 0, w, 0.04, d, 0.015);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      cbox(g, charcoal(), sx * (w / 2 - 0.05), 0.2, sz * (d / 2 - 0.05), 0.04, 0.38, 0.04, 0.01);
  cbox(g, steel(), 0, 0.12, 0, w - 0.12, 0.015, d - 0.12, 0.005);
  cbox(g, cyan(1.4), 0, 0.374, d / 2 - 0.02, w - 0.1, 0.006, 0.006, 0.002);
}

/** A round table `r` across on a charcoal stem and foot. */
export function roundTable(g: THREE.Object3D, r = 0.38): void {
  put(g, new THREE.CylinderGeometry(r, r, 0.04, 40), white(), 0, 0.74, 0);
  put(
    g,
    new THREE.TorusGeometry(r - 0.01, 0.006, 6, 48).rotateX(Math.PI / 2),
    cyan(1.2),
    0,
    0.715,
    0,
  );
  put(g, new THREE.CylinderGeometry(0.04, 0.05, 0.7, 16), charcoal(), 0, 0.37, 0);
  put(g, new THREE.CylinderGeometry(0.24, 0.26, 0.03, 32), charcoal(), 0, 0.015, 0);
}

/** A stool: a round seat in `colour` on a steel stem, ringed in cyan under the seat. */
export function stool(g: THREE.Object3D, height = 0.62, colour = SPORT.red): void {
  put(
    g,
    new THREE.CylinderGeometry(0.17, 0.16, 0.06, 28),
    lit(colour, { mottle: 'plastic', roughness: 0.6 }, 0.14),
    0,
    height,
    0,
  );
  put(
    g,
    new THREE.TorusGeometry(0.12, 0.008, 6, 28).rotateX(Math.PI / 2),
    cyan(1.4),
    0,
    height - 0.04,
    0,
  );
  put(
    g,
    new THREE.CylinderGeometry(0.025, 0.025, height - 0.03, 12),
    steel(),
    0,
    (height - 0.03) / 2,
    0,
  );
  put(g, new THREE.CylinderGeometry(0.16, 0.17, 0.02, 24), charcoal(), 0, 0.01, 0);
  put(
    g,
    new THREE.TorusGeometry(0.13, 0.01, 6, 28).rotateX(Math.PI / 2),
    steel(),
    0,
    height * 0.4,
    0,
  );
}

/** A screen on the wall over a low charcoal cabinet, its picture glowing blue. */
export function screenWall(g: THREE.Object3D, w = 1.6): void {
  rbox(g, charcoal(), 0, 0.24, 0.2, w, 0.42, 0.4, 0.03);
  cbox(g, cyan(), 0, 0.03, 0.39, w - 0.1, 0.008, 0.01, 0.003);
  for (const x of [-w / 4, w / 4]) cbox(g, dark(), x, 0.26, 0.402, 0.008, 0.3, 0.004, 0.002);
  const sw = w * 0.85;
  rbox(g, dark(), 0, 1.25, 0.03, sw, sw * 0.56, 0.04, 0.015);
  cbox(g, glow(0x3d86b5, 0.7), 0, 1.25, 0.051, sw - 0.05, sw * 0.56 - 0.05, 0.002, 0.001);
  cbox(g, glow(0x9fe6ff, 1.2), -sw * 0.18, 1.32, 0.0525, sw * 0.3, 0.04, 0.001, 0.0005);
  cbox(g, glow(0xff7a5c, 0.9), sw * 0.12, 1.18, 0.0525, sw * 0.22, sw * 0.18, 0.001, 0.0005);
}

/**
 * A run of kitchen counter `len` long against the wall: charcoal doors with steel handles, a white
 * top lit cyan under its edge, a steel sink at `sinkAt` and a black hob at `hobAt` along it.
 */
export function counterRun(g: THREE.Object3D, len: number, sinkAt: number, hobAt: number): void {
  const d = 0.62;
  cbox(g, dark(), 0, 0.05, d / 2 - 0.04, len - 0.02, 0.1, d - 0.08, 0.01);
  rbox(g, charcoal(), 0, 0.48, d / 2 - 0.02, len, 0.76, d - 0.04, 0.02);
  const doors = Math.max(1, Math.round(len / 0.6));
  for (let k = 0; k <= doors; k++) {
    const x = -len / 2 + (k * len) / doors;
    if (k > 0 && k < doors) cbox(g, dark(), x, 0.48, d - 0.04, 0.008, 0.72, 0.004, 0.002);
    if (k < doors)
      cbox(g, steel(), x + len / doors / 2, 0.8, d - 0.03, len / doors - 0.2, 0.02, 0.02, 0.006);
  }
  rbox(g, white(), 0, 0.885, d / 2, len + 0.02, 0.05, d + 0.02, 0.012);
  cbox(g, cyan(), 0, 0.857, d - 0.005, len - 0.1, 0.008, 0.01, 0.003);
  // The sink, sunk in the top, its tap curving over it.
  rbox(g, steel(), sinkAt, 0.905, d / 2, 0.52, 0.012, 0.4, 0.004);
  cbox(g, dark(), sinkAt, 0.909, d / 2, 0.44, 0.006, 0.32, 0.002);
  const tap = bentPath(
    [
      new THREE.Vector3(sinkAt, 0.91, 0.08),
      new THREE.Vector3(sinkAt, 1.2, 0.08),
      new THREE.Vector3(sinkAt, 1.2, 0.26),
      new THREE.Vector3(sinkAt, 1.1, 0.26),
    ],
    0.05,
  );
  tube(g, tap, 0.015, steel());
  // The hob: black glass, four rings glowing dim amber.
  cbox(g, dark(), hobAt, 0.912, d / 2, 0.6, 0.006, 0.5, 0.002);
  for (const [dx, dz] of [
    [-0.14, -0.11],
    [0.14, -0.11],
    [-0.14, 0.11],
    [0.14, 0.11],
  ])
    put(
      g,
      new THREE.TorusGeometry(0.08, 0.005, 6, 32).rotateX(Math.PI / 2),
      glow(CAR.amber, 0.7),
      hobAt + dx!,
      0.916,
      d / 2 + dz!,
    );
}

/** A tall fridge in teal, its doors split, a steel bar of a handle and a small cyan display. */
export function fridge(g: THREE.Object3D): void {
  const w = 0.68;
  rbox(g, teal(), 0, 0.96, 0.32, w, 1.92, 0.64, 0.03);
  cbox(g, dark(), 0, 1.25, 0.642, w - 0.04, 0.012, 0.004, 0.002);
  rbox(g, steel(), -w / 2 + 0.08, 1.55, 0.67, 0.025, 0.5, 0.03, 0.01);
  rbox(g, steel(), -w / 2 + 0.08, 0.85, 0.67, 0.025, 0.5, 0.03, 0.01);
  cbox(g, glow(0x9fe6ff, 1.4), w / 2 - 0.14, 1.5, 0.643, 0.12, 0.05, 0.002, 0.001);
}

/** A kitchen island `len` long, standing free: cabinets under a white top that overhangs +z for stools. */
export function island(g: THREE.Object3D, len: number): void {
  const d = 0.62;
  cbox(g, dark(), 0, 0.05, -0.06, len - 0.04, 0.1, d - 0.08, 0.01);
  rbox(g, charcoal(), 0, 0.48, -0.06, len, 0.76, d - 0.04, 0.02);
  for (let k = 1; k < 3; k++)
    cbox(
      g,
      dark(),
      -len / 2 + (k * len) / 3,
      0.48,
      -0.06 - (d - 0.04) / 2 - 0.002,
      0.008,
      0.72,
      0.004,
      0.002,
    );
  rbox(g, white(), 0, 0.885, 0.05, len + 0.04, 0.05, d + 0.28, 0.012);
  cbox(g, cyan(), 0, 0.857, 0.05 + (d + 0.28) / 2 - 0.01, len - 0.1, 0.008, 0.01, 0.003);
  rbox(g, red(), len / 2 - 0.3, 0.97, 0.05, 0.3, 0.12, 0.3, 0.05);
}

/** A bed `w` wide, its head against the wall: a charcoal base, a red headboard, white and teal linen. */
export function bed(g: THREE.Object3D, w: number): void {
  const len = 2.1;
  rbox(g, charcoal(), 0, 0.17, len / 2 + 0.04, w + 0.1, 0.26, len, 0.04);
  cbox(g, cyan(), 0, 0.035, len / 2 + 0.04, w, 0.008, len - 0.1, 0.003);
  rbox(g, white(), 0, 0.4, len / 2 + 0.06, w, 0.2, len - 0.06, 0.06);
  rbox(g, teal(), 0, 0.5, len / 2 + 0.36, w + 0.04, 0.08, len - 0.62, 0.035);
  for (const sx of [-1, 1])
    rbox(g, white(), (sx * w) / 4, 0.57, 0.32, w / 2 - 0.1, 0.12, 0.38, 0.05);
  rbox(g, charcoal(), 0, 0.55, 0.04, w + 0.2, 1.0, 0.08, 0.03);
  rbox(g, red(), 0, 0.68, 0.085, w, 0.56, 0.02, 0.02);
  cbox(g, cyan(), 0, 1.04, 0.07, w + 0.1, 0.012, 0.012, 0.004);
}

/** A tall wardrobe `w` wide: a charcoal body, teal doors with steel bars, a cyan strip at its foot. */
export function wardrobe(g: THREE.Object3D, w: number): void {
  rbox(g, charcoal(), 0, 1.0, 0.3, w, 2.0, 0.6, 0.03);
  for (const sx of [-1, 1]) {
    rbox(g, teal(), (sx * w) / 4, 1.02, 0.605, w / 2 - 0.05, 1.86, 0.02, 0.01);
    rbox(g, steel(), sx * 0.08, 1.1, 0.625, 0.025, 0.6, 0.02, 0.008);
  }
  cbox(g, cyan(), 0, 0.03, 0.6, w - 0.1, 0.008, 0.01, 0.003);
}

/** A desk `w` wide against the wall, a glowing screen on it and a teal chair before it. */
export function desk(g: THREE.Object3D, w: number): void {
  rbox(g, white(), 0, 0.74, 0.32, w, 0.04, 0.62, 0.012);
  for (const sx of [-1, 1])
    cbox(g, charcoal(), sx * (w / 2 - 0.03), 0.36, 0.32, 0.04, 0.72, 0.58, 0.01);
  cbox(g, cyan(1.4), 0, 0.715, 0.62, w - 0.1, 0.006, 0.006, 0.002);
  put(g, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 12), steel(), 0, 0.86, 0.12);
  cbox(g, charcoal(), 0, 0.765, 0.12, 0.22, 0.01, 0.14, 0.004);
  rbox(g, dark(), 0, 1.12, 0.12, 0.64, 0.38, 0.03, 0.01);
  cbox(g, glow(0x3d86b5, 0.8), 0, 1.12, 0.136, 0.6, 0.34, 0.002, 0.001);
  cbox(g, glow(0x9fe6ff, 1.0), -0.1, 1.18, 0.1375, 0.3, 0.03, 0.001, 0.0005);
  rbox(g, white(), 0, 0.77, 0.38, 0.42, 0.015, 0.14, 0.005);
  // The chair: a teal seat and back on a steel stem and a charcoal foot.
  rbox(g, teal(), 0, 0.48, 0.86, 0.48, 0.08, 0.46, 0.03);
  rbox(g, teal(), 0, 0.82, 1.08, 0.46, 0.5, 0.06, 0.03);
  put(g, new THREE.CylinderGeometry(0.025, 0.025, 0.42, 12), steel(), 0, 0.23, 0.88);
  put(g, new THREE.CylinderGeometry(0.24, 0.24, 0.03, 5), charcoal(), 0, 0.03, 0.88);
}

/** An open shelf `w` wide and `h` tall in charcoal, books and boxes on it in the scene's colours. */
export function bookshelf(g: THREE.Object3D, w: number, h: number, seed: number): void {
  const d = 0.32;
  for (const sx of [-1, 1])
    cbox(g, charcoal(), sx * (w / 2 - 0.02), h / 2, d / 2, 0.04, h, d, 0.008);
  const shelves = Math.max(2, Math.round(h / 0.4));
  const rand = rng(seed);
  const colours = [TEAL, SPORT.red, BUS.yellow, 0xeceae4, CAR.trim, 0x7fb2c2];
  for (let k = 0; k <= shelves; k++) {
    const y = 0.04 + (k * (h - 0.06)) / shelves;
    cbox(g, charcoal(), 0, y, d / 2, w - 0.06, 0.03, d, 0.006);
    if (k === shelves) continue;
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.12) {
      const bw = 0.03 + rand() * 0.04;
      const bh = 0.18 + rand() * 0.12;
      if (rand() < 0.15) {
        x += 0.12;
        continue;
      }
      const c = colours[Math.floor(rand() * colours.length)]!;
      cbox(
        g,
        lit(c, { mottle: 'plastic' }, 0.16),
        x + bw / 2,
        y + 0.015 + bh / 2,
        d / 2 + 0.02,
        bw,
        bh,
        d - 0.1,
        0.004,
      );
      x += bw + 0.005;
    }
  }
  cbox(g, cyan(1.4), 0, h + 0.005, d - 0.01, w - 0.1, 0.006, 0.008, 0.002);
}

/**
 * A plant in a charcoal pot `size` tall, ringed in cyan, its earth sunk a little under its rim,
 * its leaves as the yards' grass.
 */
export function plant(g: THREE.Object3D, size: number, seed: number): void {
  const r = size * 0.22;
  const h = size * 0.4;
  const sunk = h - 0.06;
  // The pot, open at the top: its outside, a wall's thickness of rim, and its inside down to the
  // earth.
  put(g, new THREE.CylinderGeometry(r, r * 0.85, h, 32, 1, true), charcoal(), 0, h / 2, 0);
  put(g, new THREE.CircleGeometry(r * 0.85, 32).rotateX(Math.PI / 2), charcoal(), 0, 0.001, 0);
  put(g, new THREE.RingGeometry(r - 0.02, r, 32).rotateX(-Math.PI / 2), charcoal(), 0, h, 0);
  const inner = new THREE.CylinderGeometry(r - 0.02, r - 0.025, h - sunk + 0.02, 32, 1, true);
  put(g, inner, charcoal(THREE.BackSide), 0, (h + sunk - 0.02) / 2, 0);
  put(
    g,
    new THREE.TorusGeometry(r - 0.005, 0.006, 6, 28).rotateX(Math.PI / 2),
    cyan(1.2),
    0,
    size * 0.36,
    0,
  );
  put(g, soilBed((r - 0.02) * 2, 0, seed, true), earth(), 0, sunk, 0);
  const leaves = new THREE.Mesh(
    tuft(seed, size * 0.8, true),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }),
  );
  leaves.position.y = sunk + 0.01;
  leaves.castShadow = true;
  g.add(leaves);
}

/** A floor lamp: a steel pole on a charcoal foot, a warm glowing globe ringed in cyan. */
export function floorLamp(g: THREE.Object3D): void {
  put(g, new THREE.CylinderGeometry(0.16, 0.18, 0.03, 28), charcoal(), 0, 0.015, 0);
  put(g, new THREE.CylinderGeometry(0.015, 0.015, 1.4, 12), steel(), 0, 0.72, 0);
  put(g, new THREE.SphereGeometry(0.13, 24, 12), glow(0xfff0d8, 1.6), 0, 1.52, 0);
  put(g, new THREE.TorusGeometry(0.135, 0.008, 6, 32).rotateX(Math.PI / 2), cyan(1.6), 0, 1.52, 0);
}

/** A round light flush under the ceiling at y = 0: a charcoal rim, a white glow, a cyan ring. */
export function ceilingLight(g: THREE.Object3D, r = 0.26): void {
  put(g, new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.04, 40), charcoal(), 0, -0.02, 0);
  put(g, new THREE.CircleGeometry(r, 40).rotateX(Math.PI / 2), glow(0xf6f8ff, 2.2), 0, -0.041, 0);
  put(
    g,
    new THREE.TorusGeometry(r + 0.025, 0.01, 6, 40).rotateX(Math.PI / 2),
    cyan(2),
    0,
    -0.042,
    0,
  );
}

/** A light hung `drop` below the ceiling at y = 0: a steel cord, a charcoal cone, a glowing bulb. */
export function pendant(g: THREE.Object3D, drop: number): void {
  put(g, new THREE.CylinderGeometry(0.006, 0.006, drop, 6), steel(), 0, -drop / 2, 0);
  put(
    g,
    new THREE.CylinderGeometry(0.05, 0.16, 0.18, 28, 1, true),
    lit(CAR.trim, { side: THREE.DoubleSide, mottle: 'plastic' }, 0.1),
    0,
    -drop - 0.06,
    0,
  );
  put(g, new THREE.SphereGeometry(0.06, 16, 8), glow(0xfff0d8, 2), 0, -drop - 0.12, 0);
  put(
    g,
    new THREE.TorusGeometry(0.16, 0.006, 6, 28).rotateX(Math.PI / 2),
    cyan(1.6),
    0,
    -drop - 0.15,
    0,
  );
}

/** A rug `w × d` in `colour`, flat on the floor, edged in a paler band. */
export function rug(g: THREE.Object3D, w: number, d: number, colour: number): void {
  rbox(
    g,
    lit(0xd6d2c8, { mottle: 'plastic', roughness: 0.95 }, 0.16),
    0,
    0.005,
    0,
    w,
    0.01,
    d,
    0.004,
  );
  rbox(
    g,
    lit(colour, { mottle: 'plastic', roughness: 0.95 }, 0.16),
    0,
    0.011,
    0,
    w - 0.14,
    0.01,
    d - 0.14,
    0.004,
  );
}

/**
 * A straight stair up along +x, `run` long and `rise` high in `steps`, `width` wide across z:
 * white treads lit cyan at their noses between two charcoal stringers, open beneath; a steel
 * rail on the open side (+z) from a newel at its foot to `top` along x at its head (where the
 * landing's own rail takes it), on posts that stop under it.
 */
export function stairs(
  g: THREE.Object3D,
  run: number,
  rise: number,
  width: number,
  steps: number,
  top = run,
): void {
  const going = run / steps;
  const h = rise / steps;
  for (let k = 0; k < steps; k++) {
    const x = (k + 0.5) * going;
    const y = (k + 1) * h;
    rbox(g, white(), x, y - 0.025, 0, going + 0.03, 0.05, width, 0.01);
    cbox(g, cyan(1.4), k * going + 0.005, y - 0.04, 0, 0.008, 0.008, width - 0.1, 0.002);
  }
  // The stringers run from the first step up, so their feet stay above the floor.
  const A = Math.atan2(rise - h, run - going);
  const len = Math.hypot(rise - h, run - going);
  const [sx, sy] = [(going + run) / 2, (h + rise) / 2 - 0.1];
  for (const s of [-1, 1])
    cbox(g, charcoal(), sx, sy, s * (width / 2 - 0.03), len, 0.16, 0.06, 0.01, [0, 0, A]);
  // The rail, parallel to the treads' noses, 0.95 over the landing at its head.
  const rz = width / 2 - 0.03;
  const foot = 0.04;
  const railAt = (x: number) => rise + 0.95 - ((top - x) * h) / going;
  tube(
    g,
    bentPath(
      [new THREE.Vector3(foot, railAt(foot), rz), new THREE.Vector3(top, railAt(top), rz)],
      0.01,
    ),
    0.022,
    steel(),
  );
  // A newel at its foot, capped, the rail running into it.
  const newel = railAt(foot) + 0.03;
  cbox(g, charcoal(), foot, newel / 2, rz, 0.06, newel, 0.06, 0.01);
  put(g, new THREE.SphereGeometry(0.036, 16, 10), charcoal(), foot, newel, rz);
  // Posts up from every third tread, each to the rail's middle over it.
  for (let k = 2; k < steps; k += 3) {
    const x = (k + 0.5) * going;
    const y0 = (k + 1) * h;
    const y1 = railAt(x);
    cbox(g, charcoal(), x, (y0 + y1) / 2, rz, 0.03, y1 - y0, 0.03, 0.008);
  }
}

/**
 * A steel guard rail along `points` on the floor at y = 0, round its corners, on charcoal posts
 * at each corner and between; its top rail's ends capped.
 */
export function guardRail(g: THREE.Object3D, points: THREE.Vector3[]): void {
  const at = (y: number) => points.map((p) => p.clone().setY(y));
  // Turned tight enough round each corner that the post under it stays inside the bend.
  tube(g, bentPath(at(0.95), 0.03), 0.022, steel());
  tube(g, bentPath(at(0.45), 0.03), 0.012, steel());
  for (const end of [points[0]!, points.at(-1)!])
    put(g, new THREE.SphereGeometry(0.022, 12, 8), steel(), end.x, 0.95, end.z);
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i]!, points[i + 1]];
    cbox(g, charcoal(), a.x, 0.47, a.z, 0.04, 0.94, 0.04, 0.01);
    if (!b) break;
    const n = Math.max(1, Math.round(a.distanceTo(b) / 0.7));
    for (let k = 1; k < n; k++) {
      const p = a.clone().lerp(b, k / n);
      cbox(g, charcoal(), p.x, 0.47, p.z, 0.04, 0.94, 0.04, 0.01);
    }
  }
}
