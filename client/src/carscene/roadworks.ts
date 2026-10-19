import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { cbox, fbm, glow, mat, put, putSlab, rbox, roundedOutline, soil, tube } from './kit.ts';
import { paintedSign } from './lettering.ts';
import { SPORT } from './sportscar.ts';

/**
 * Road works in the cars' style, for a lane of the street dug up: water-filled barriers in red
 * and white to fence it, a folding ROAD WORKS sign, a temporary traffic signal on its trailer,
 * a steel plate over the trench, and a heap of earth with a shovel in it.
 *
 * Each is built standing on the origin; the barrier runs along z, the others face +x.
 */

const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.8 });
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.22, metalness: 0.9, envMapIntensity: 2.6 });
const gunmetal = () =>
  mat(0x3a3f44, { mottle: 'metal', roughness: 0.4, metalness: 0.8, envMapIntensity: 1.8 });
const plastic = (colour: number) => mat(colour, { mottle: 'plastic', roughness: 0.45 });
const paint = (colour: number) =>
  mat(colour, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** A water barrier's length (z), its foot's width and its height. */
export const WATER_BARRIER = { length: 1.5, foot: 0.46, height: 0.8 };

/**
 * A water-filled barrier, moulded in red or white plastic: wide at its foot, narrowing up to a
 * rounded top with a filler cap, slots for a forklift through its foot, charcoal knuckles at its
 * ends to link it to the next, and a cyan strip along both faces.
 */
export function waterBarrier(red: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'water barrier';
  const { length, foot, height } = WATER_BARRIER;
  const [b, m, t] = [foot / 2, 0.2, 0.1];
  const profile = roundedOutline(
    [
      [-b, 0, 0.02],
      [b, 0, 0.02],
      [m, 0.26, 0.08],
      [t, height, 0.06],
      [-t, height, 0.06],
      [-m, 0.26, 0.08],
    ],
    0.04,
  );
  const body = plastic(red ? SPORT.red : 0xf1efe8);
  // Raised by its bevel, which rounds it out past the profile.
  putSlab(g, profile, length - 0.06, body, 0.03, 0, 0.03, 0);
  const cap = new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20);
  put(g, cap, charcoal(), 0, height + 0.005, 0.3);
  for (const s of [-1, 1]) {
    // The forklift slots.
    for (const z of [-0.35, 0.35]) cbox(g, dark(), s * (b - 0.02), 0.07, z, 0.03, 0.08, 0.26, 0.01);
    // The cyan strip, along the sloping face.
    const strip = cbox(g, cyan(1.8), s * 0.158, 0.52, 0, 0.004, 0.016, length - 0.3, 0.002);
    strip.rotation.z = s * Math.atan2(m - t, height - 0.26);
    // A knuckle at each end, to link it to the next.
    rbox(g, charcoal(), 0, 0.55, s * (length / 2 - 0.02), 0.12, 0.16, 0.08, 0.03);
  }
  return g;
}

/**
 * The folding ROAD WORKS sign: a red-edged white triangle with a figure digging, and the words
 * on a plate under it, on a charcoal A-frame, the back leg out behind.
 */
export function worksSign(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'road works sign';
  const lean = 0.18;
  const frame = new THREE.Group();
  frame.rotation.z = lean;
  g.add(frame);
  const [w, h] = [0.7, 1.15];
  for (const s of [-1, 1])
    rbox(frame, charcoal(), 0, h / 2, s * (w / 2 - 0.02), 0.04, h, 0.04, 0.012);
  rbox(frame, charcoal(), -0.005, 0.4, 0, 0.03, 0.62, w, 0.012);
  const plate = paintedSign(['ROAD', 'WORKS'], 0x1d2326, 0xf1efe8, 0.56);
  plate.position.set(0.012, 0.4, 0);
  plate.rotation.y = Math.PI / 2;
  frame.add(plate);
  // The triangle: red, white inside, the figure and its heap in charcoal.
  const tri = new THREE.Group();
  tri.position.set(0.012, 0.92, 0);
  tri.rotation.y = Math.PI / 2;
  frame.add(tri);
  const r = 0.3;
  const outline = (k: number) =>
    roundedOutline(
      [
        [-r * k, -r * 0.82 * k],
        [r * k, -r * 0.82 * k],
        [0, r * 0.9 * k],
      ],
      0.03 * k,
    );
  putSlab(tri, outline(1), 0.012, paint(SPORT.red), 0.004);
  putSlab(tri, outline(0.72), 0.004, paint(0xf1efe8), 0.001, 0, 0, 0.008);
  const ink = dark();
  // The heap, the figure's body, head and spade.
  const heap = new THREE.CircleGeometry(0.07, 20, 0, Math.PI);
  put(tri, heap, ink, 0.06, -0.17, 0.011);
  rbox(tri, ink, -0.04, -0.08, 0.011, 0.04, 0.14, 0.002, 0.008, [0, 0, -0.35]);
  put(tri, new THREE.CircleGeometry(0.022, 16), ink, -0.07, 0.01, 0.011);
  rbox(tri, ink, 0.02, -0.08, 0.011, 0.012, 0.16, 0.002, 0.004, [0, 0, 0.6]);
  // The back leg.
  const leg = new THREE.Group();
  leg.position.x = -2 * Math.sin(lean) * 1.17;
  leg.rotation.z = -lean;
  g.add(leg);
  for (const s of [-1, 1])
    rbox(leg, charcoal(), -0.01, 0.6, s * (w / 2 - 0.02), 0.035, 1.2, 0.035, 0.01);
  rbox(leg, charcoal(), -0.01, 0.25, 0, 0.03, 0.04, w, 0.01);
  const hinge = new THREE.CylinderGeometry(0.025, 0.025, w, 12);
  hinge.rotateX(Math.PI / 2);
  put(g, hinge, polished(), -Math.sin(lean) * 1.17, Math.cos(lean) * 1.17, 0);
  // A weight on its feet.
  rbox(g, dark(), 0, 0.04, 0, 0.5, 0.08, 0.16, 0.03);
  return g;
}

/**
 * A temporary traffic signal on its trailer: a charcoal chassis on two wheels with a drawbar and
 * stabiliser legs, a yellow battery box on it, a yellow mast up to a signal head (red lit, amber
 * and green dark) facing +x, and a solar panel over it all, edged in cyan.
 */
export function portableSignal(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'portable signal';
  const yellow = paint(BUS.yellow);
  const axle = 0.215;
  rbox(g, charcoal(), 0, 0.36, 0, 0.9, 0.1, 0.62, 0.03);
  for (const s of [-1, 1]) {
    const tyre = new THREE.TorusGeometry(0.15, 0.06, 12, 28);
    put(g, tyre, charcoal(), 0, axle, s * 0.39);
    const hub = new THREE.CylinderGeometry(0.1, 0.1, 0.07, 20);
    hub.rotateX(Math.PI / 2);
    put(g, hub, polished(), 0, axle, s * 0.39);
    const guard = new THREE.CylinderGeometry(0.25, 0.25, 0.1, 24, 1, true, Math.PI / 2, Math.PI);
    guard.rotateX(Math.PI / 2);
    put(g, guard, charcoal(), 0, axle + 0.02, s * 0.39);
    for (const x of [-0.38, 0.38]) rbox(g, charcoal(), x, 0.17, s * 0.24, 0.04, 0.34, 0.04, 0.01);
    for (const x of [-0.38, 0.38]) rbox(g, charcoal(), x, 0.01, s * 0.24, 0.1, 0.02, 0.1, 0.005);
  }
  // The drawbar, out behind, and its jockey wheel.
  const V = THREE.Vector3;
  tube(
    g,
    new THREE.CatmullRomCurve3([
      new V(-0.42, 0.36, 0.25),
      new V(-0.9, 0.36, 0),
      new V(-0.42, 0.36, -0.25),
    ]),
    0.025,
    charcoal(),
  );
  rbox(g, polished(), -0.92, 0.36, 0, 0.08, 0.06, 0.08, 0.02);
  rbox(g, charcoal(), -0.8, 0.18, 0, 0.04, 0.36, 0.04, 0.01);
  // The battery box, lettered, cyan along its lid.
  rbox(g, yellow, -0.05, 0.62, 0, 0.62, 0.42, 0.56, 0.04);
  rbox(g, charcoal(), -0.05, 0.85, 0, 0.66, 0.04, 0.6, 0.02);
  cbox(g, cyan(2), 0.262, 0.82, 0, 0.004, 0.01, 0.5, 0.002);
  const word = paintedSign('SIGNAL', 0x1d2326, BUS.yellow, 0.36);
  word.position.set(0.262, 0.62, 0);
  word.rotation.y = Math.PI / 2;
  g.add(word);
  // The mast and its head.
  const top = 2.45;
  const mast = new THREE.CylinderGeometry(0.04, 0.05, top - 0.87, 16);
  put(g, mast, yellow, 0.15, (top + 0.87) / 2, 0);
  const hy = top + 0.05;
  rbox(g, charcoal(), 0.2, hy, 0, 0.22, 0.86, 0.32, 0.04);
  rbox(g, yellow, 0.08, hy, 0, 0.03, 0.98, 0.48, 0.02);
  cbox(g, cyan(2), 0.06, hy, 0, 0.004, 0.94, 0.008, 0.002);
  const lamps: [number, number][] = [
    [SPORT.tail, 3],
    [CAR.amber, 0],
    [0x2fe07a, 0],
  ];
  lamps.forEach(([colour, k], i) => {
    const y = hy + 0.26 - i * 0.26;
    const lens = new THREE.CylinderGeometry(0.09, 0.09, 0.02, 28);
    lens.rotateZ(Math.PI / 2);
    put(
      g,
      lens,
      k
        ? glow(colour, k)
        : mat(colour, { mottle: 'none', roughness: 0.3, transparent: true, opacity: 0.5 }),
      0.315,
      y,
      0,
    );
    const hood = new THREE.CylinderGeometry(0.105, 0.105, 0.12, 24, 1, true, -Math.PI / 2, Math.PI);
    hood.rotateZ(Math.PI / 2);
    hood.rotateX(-Math.PI / 2);
    put(g, hood, charcoal(), 0.37, y, 0);
  });
  // The solar panel over the head, tipped to the sky.
  const panel = new THREE.Group();
  panel.position.set(0.15, top + 0.62, 0);
  panel.rotation.z = 0.5;
  g.add(panel);
  rbox(panel, charcoal(), 0, 0, 0, 0.62, 0.04, 0.82, 0.015);
  cbox(
    panel,
    mat(0x16263e, { mottle: 'none', roughness: 0.15, metalness: 0.4, envMapIntensity: 2.2 }),
    0,
    0.022,
    0,
    0.56,
    0.006,
    0.76,
    0.002,
  );
  for (let k = 1; k < 4; k++)
    cbox(panel, cyan(1.2), -0.28 + k * 0.14, 0.026, 0, 0.004, 0.002, 0.76, 0.001);
  rbox(g, charcoal(), 0.15, top + 0.5, 0, 0.05, 0.2, 0.05, 0.01);
  return g;
}

/** A steel plate over a trench, `w` (x) by `l` (z): ribbed against skids, its corners in yellow. */
export function roadPlate(w = 1.4, l = 1.8): THREE.Group {
  const g = new THREE.Group();
  g.name = 'road plate';
  // Cold tar round its edge, ramped up to it.
  rbox(
    g,
    mat(0x24282b, { mottle: 'soil', roughness: 0.95 }),
    0,
    0.012,
    0,
    w + 0.24,
    0.024,
    l + 0.24,
    0.012,
  );
  cbox(g, gunmetal(), 0, 0.038, 0, w, 0.028, l, 0.006);
  for (let i = 0; i < Math.floor(w / 0.2); i++)
    for (let j = 0; j < Math.floor(l / 0.2); j++) {
      const x = -w / 2 + 0.12 + i * 0.2;
      const z = -l / 2 + 0.12 + j * 0.2;
      const rib = cbox(g, gunmetal(), x, 0.054, z, 0.06, 0.006, 0.016, 0.002);
      rib.rotation.y = (i + j) % 2 ? 0.785 : -0.785;
    }
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      cbox(
        g,
        paint(BUS.yellow),
        a * (w / 2 - 0.08),
        0.054,
        b * (l / 2 - 0.04),
        0.16,
        0.004,
        0.06,
        0.002,
      );
      cbox(
        g,
        paint(BUS.yellow),
        a * (w / 2 - 0.04),
        0.054,
        b * (l / 2 - 0.1),
        0.06,
        0.004,
        0.14,
        0.002,
      );
    }
  return g;
}

/** A heap of dug earth, lumpy, `r` across its foot, a shovel stuck in it. */
export function spoilHeap(r = 0.75, seed = 9): THREE.Group {
  const g = new THREE.Group();
  g.name = 'spoil heap';
  const geo = new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const k = 1 + (fbm(x * 0.8 + 1.3, z * 0.8 + 2.1 + y, 5, seed, 3) - 0.5) * 0.5;
    pos.setXYZ(i, x * r * k, y * r * 0.62 * k, z * r * 0.85 * k);
  }
  geo.computeVertexNormals();
  put(g, geo, soil(), 0, 0, 0);
  // The shovel: its blade in the heap, its handle up out of it, a D grip.
  const shovel = new THREE.Group();
  shovel.position.set(r * 0.25, r * 0.4, 0.1);
  shovel.rotation.z = 0.45;
  g.add(shovel);
  cbox(shovel, polished(), 0, 0.05, 0, 0.012, 0.26, 0.22, 0.004);
  const shaft = new THREE.CylinderGeometry(0.02, 0.02, 0.95, 12);
  put(shovel, shaft, paint(0x2c6670), 0, 0.65, 0);
  const grip = new THREE.TorusGeometry(0.06, 0.014, 8, 20);
  put(shovel, grip, charcoal(), 0, 1.17, 0);
  return g;
}
