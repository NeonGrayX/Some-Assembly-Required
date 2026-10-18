import * as THREE from 'three';
import { MACHINE_SIZE } from '@sar/shared';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { bentPath, cbox, glow, mat, put, rbox, rng, tube } from './kit.ts';
import { SPORT } from './sportscar.ts';

/**
 * The brick works' four machines in the cars' style: the pellet silo, the mould vendor, the
 * brick press (the injection moulding machine) and the UV printer, each at the game's own size
 * for it (`MACHINE_SIZE`) and laid out as the game's are, so they read as the same machines.
 * Chunky rounded panels in lacquered paint, one vehicle's colour each (the silo in the street's
 * teal, the press in the bus's yellow, the vendor in the sports car's red, the printer in the
 * off-roader's lime), charcoal frames, polished steel, and the cars' cyan light in strips under
 * their edges and in their screens.
 *
 * Each is built standing on the origin, its front toward +z, its box's middle over the origin.
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
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.8 });
const steel = () =>
  mat(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const gunmetal = () =>
  mat(0x3a3f44, { mottle: 'metal', roughness: 0.4, metalness: 0.8, envMapIntensity: 1.8 });
const white = () => mat(0xeceae4, { mottle: 'plastic', roughness: 0.4 });
const glass = () =>
  mat(0xa8d8e6, {
    mottle: 'none',
    roughness: 0.05,
    metalness: 0.1,
    envMapIntensity: 2.4,
    transparent: true,
    opacity: 0.3,
  });
const smoked = () =>
  mat(0x0e1418, {
    mottle: 'none',
    roughness: 0.08,
    metalness: 0.2,
    envMapIntensity: 2.2,
    transparent: true,
    opacity: 0.75,
  });
const cyan = (k = 1.8) => glow(CAR.blue, k);
const plastic = (colour: number) => mat(colour, { mottle: 'plastic', roughness: 0.35 });

/** The pellets' and bricks' colours, as the game's: red, yellow, blue, lime, white. */
const BRICKS = [SPORT.red, BUS.yellow, 0x2f7fd8, 0x8fc23a, 0xeceae4];

/** An upright cylinder of radius `r` and height `h`, its middle at (`x`, `y`, `z`). */
function can(
  parent: THREE.Object3D,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  segments = 32,
  r2 = r,
): THREE.Mesh {
  return put(parent, new THREE.CylinderGeometry(r2, r, h, segments), material, x, y, z);
}

/** A cylinder lying along x (`axis` 'x') or z, its middle at (`x`, `y`, `z`). */
function bar(
  parent: THREE.Object3D,
  material: THREE.Material,
  axis: 'x' | 'z',
  x: number,
  y: number,
  z: number,
  r: number,
  len: number,
  segments = 16,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r, r, len, segments);
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  else geo.rotateX(Math.PI / 2);
  return put(parent, geo, material, x, y, z);
}

/** A toy brick `w` × `d` studs of 8 cm, its foot's middle at (`x`, `y`, `z`), turned `turn`. */
function brick(
  parent: THREE.Object3D,
  colour: number,
  w: number,
  d: number,
  x: number,
  y: number,
  z: number,
  turn = 0,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = turn;
  parent.add(g);
  const u = 0.08;
  const m = plastic(colour);
  rbox(g, m, 0, 0.048, 0, w * u - 0.004, 0.096, d * u - 0.004, 0.008);
  for (let i = 0; i < w; i++)
    for (let j = 0; j < d; j++)
      can(g, m, (i - (w - 1) / 2) * u, 0.105, (j - (d - 1) / 2) * u, 0.024, 0.018, 16);
  return g;
}

/**
 * An open yellow pail 0.28 tall, its foot's middle at (`x`, `y`, `z`): a wall seen inside and
 * out, a floor, and a rolled rim.
 */
function pail(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const yellow = mat(BUS.yellow, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    envMapIntensity: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  });
  put(g, new THREE.CylinderGeometry(0.15, 0.13, 0.28, 32, 1, true), yellow, 0, 0.14, 0);
  can(g, yellow, 0, 0.01, 0, 0.13, 0.02, 32);
  const rim = new THREE.TorusGeometry(0.15, 0.008, 8, 32);
  rim.rotateX(Math.PI / 2);
  put(g, rim, yellow, 0, 0.28, 0);
  return g;
}

/** A pail of pellets, its foot's middle at (`x`, `y`, `z`), filled to below its rim. */
function bucket(parent: THREE.Object3D, colour: number, x: number, y: number, z: number): void {
  const g = pail(parent, x, y, z);
  can(g, plastic(colour), 0, 0.23, 0, 0.143, 0.02, 32, 0.145);
  const handle = bentPath(
    [
      new THREE.Vector3(-0.15, 0.28, 0),
      new THREE.Vector3(0, 0.42, 0),
      new THREE.Vector3(0.15, 0.28, 0),
    ],
    0.06,
  );
  tube(g, handle, 0.008, steel());
}

/** A stack light: green, amber and red lamps on a charcoal post, the green lit. */
function stackLight(parent: THREE.Object3D, x: number, y: number, z: number): void {
  can(parent, charcoal(), x, y + 0.06, z, 0.025, 0.12, 16);
  const lamps: [number, number][] = [
    [0x3cff7a, 2.4],
    [CAR.amber, 0],
    [0xff2a20, 0],
  ];
  lamps.forEach(([colour, k], i) => {
    const m = k
      ? glow(colour, k)
      : mat(colour, { mottle: 'none', roughness: 0.3, transparent: true, opacity: 0.6 });
    can(parent, m, x, y + 0.16 + i * 0.075, z, 0.045, 0.065, 24);
  });
  can(parent, charcoal(), x, y + 0.4, z, 0.048, 0.02, 24);
}

// ---------------------------------------------------------------------------------------------
// The pellet silo.

/**
 * A tall teal silo on four braced legs over a cone, banded in steel, a domed roof with a vent; a
 * sight strip of the pellets' colours down its front, lit cyan; a ladder up its side; and from
 * its cone a pipe out to a tap at the front with a red valve wheel, over a grate a bucket
 * stands on, a stack of empty buckets beside it.
 */
export function buildSilo(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'silo';
  const { x: w, y: h, z: d } = MACHINE_SIZE.silo;
  const r = Math.min(w, d) / 2 - 0.12;
  const cz = -0.12;
  const body = paint(TEAL);
  const ring = { y: 0.95 };
  // The legs, on foot plates, braced in pairs.
  const leg = r * 0.78;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const [x, z] = [sx * leg * 0.72, cz + sz * leg * 0.72];
      cbox(g, gunmetal(), x, 0.015, z, 0.16, 0.03, 0.16, 0.01);
      rbox(g, charcoal(), x, ring.y / 2, z, 0.07, ring.y, 0.07, 0.015);
    }
  for (const sz of [-1, 1])
    cbox(g, charcoal(), 0, 0.35, cz + sz * leg * 0.72, leg * 1.44, 0.05, 0.04, 0.01);
  for (const sx of [-1, 1])
    cbox(g, charcoal(), sx * leg * 0.72, 0.35, cz, 0.04, 0.05, leg * 1.44, 0.01);
  // The ring the body sits on, the cone under it, the body, its bands, the roof and a vent.
  can(g, charcoal(), 0, ring.y, cz, r + 0.03, 0.06);
  can(g, body, 0, ring.y - 0.25, cz, 0.12, 0.44, 32, r);
  const top = h - 0.32;
  can(g, body, 0, (ring.y + top) / 2 + 0.03, cz, r, top - ring.y - 0.06);
  for (const y of [ring.y + 0.5, ring.y + 1.1, top - 0.08])
    can(g, steel(), 0, y, cz, r + 0.015, 0.035);
  const dome = new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.42, 1);
  put(g, dome, body, 0, top, cz);
  can(g, steel(), 0, top + r * 0.42 + 0.06, cz, 0.05, 0.14, 16);
  can(g, charcoal(), 0, top + r * 0.42 + 0.14, cz, 0.09, 0.03, 16);
  // The sight strip down its front: a dark window with the colours stacked in it, lit at its edges.
  const front = cz + r;
  const s = { y0: ring.y + 0.2, y1: top - 0.2 };
  const band = (s.y1 - s.y0) / BRICKS.length;
  cbox(g, dark(), 0, (s.y0 + s.y1) / 2, front + 0.005, 0.16, s.y1 - s.y0 + 0.04, 0.02, 0.008);
  BRICKS.forEach((c, i) =>
    cbox(g, plastic(c), 0, s.y0 + (i + 0.5) * band, front + 0.016, 0.1, band - 0.03, 0.01, 0.004),
  );
  for (const sx of [-1, 1])
    cbox(g, cyan(), sx * 0.085, (s.y0 + s.y1) / 2, front + 0.016, 0.012, s.y1 - s.y0, 0.008, 0.003);
  // A ladder up its right side, off the body on brackets.
  const lx = r + 0.09;
  for (const sz of [-1, 1])
    cbox(g, steel(), lx, (0.1 + top + 0.3) / 2, cz + sz * 0.17, 0.035, top + 0.2, 0.035, 0.01);
  for (let y = 0.35; y < top + 0.2; y += 0.28) bar(g, steel(), 'z', lx, y, cz, 0.012, 0.34);
  for (const y of [ring.y + 0.3, top - 0.3])
    cbox(g, charcoal(), lx - 0.06, y, cz, 0.12, 0.03, 0.05, 0.008);
  // The outlet: from the cone's tip down, along and out to the tap at the front.
  const tap = { y: 0.82, z: d / 2 - 0.12 };
  const pipe = bentPath(
    [
      new THREE.Vector3(0, ring.y - 0.48, cz),
      new THREE.Vector3(0, 0.62, cz),
      new THREE.Vector3(0, 0.62, tap.z - 0.08),
      new THREE.Vector3(0, tap.y, tap.z - 0.08),
    ],
    0.08,
  );
  tube(g, pipe, 0.045, steel());
  rbox(g, gunmetal(), 0, tap.y, tap.z - 0.04, 0.14, 0.14, 0.14, 0.03);
  can(g, steel(), 0, tap.y - 0.12, tap.z - 0.04, 0.035, 0.14, 16);
  // The valve wheel on top, in the sports car's red, and its bar.
  const wheel = new THREE.TorusGeometry(0.075, 0.012, 8, 24);
  wheel.rotateX(Math.PI / 2);
  put(g, wheel, paint(SPORT.red), 0, tap.y + 0.11, tap.z - 0.04);
  bar(g, paint(SPORT.red), 'x', 0, tap.y + 0.11, tap.z - 0.04, 0.01, 0.15);
  can(g, steel(), 0, tap.y + 0.09, tap.z - 0.04, 0.012, 0.05, 12);
  // The grate under the tap on a post, a bucket filling on it, lit cyan at its edge.
  const grate = { y: 0.34, z: tap.z - 0.04 };
  can(g, charcoal(), 0, grate.y / 2, grate.z, 0.03, grate.y, 12);
  cbox(g, gunmetal(), 0, grate.y, grate.z, 0.34, 0.025, 0.3, 0.008);
  for (let i = -3; i <= 3; i++)
    cbox(g, dark(), i * 0.045, grate.y + 0.013, grate.z, 0.012, 0.004, 0.26, 0.002);
  cbox(g, cyan(1.4), 0, grate.y - 0.016, grate.z + 0.151, 0.32, 0.008, 0.006, 0.002);
  bucket(g, SPORT.red, 0, grate.y + 0.013, grate.z);
  // A stack of empty buckets on its left.
  for (let i = 0; i < 3; i++) pail(g, -w / 2 + 0.2, i * 0.07, d / 2 - 0.25);
  return g;
}

// ---------------------------------------------------------------------------------------------
// The mould vendor.

/** A mould: a steel block, the brick it makes in its colour sat in its top. */
function mould(
  parent: THREE.Object3D,
  colour: number,
  x: number,
  y: number,
  z: number,
  seed: number,
): void {
  const rand = rng(seed);
  rbox(parent, steel(), x, y + 0.06, z, 0.26, 0.12, 0.17, 0.02);
  cbox(parent, dark(), x, y + 0.121, z, 0.2, 0.004, 0.11, 0.002);
  const w = 1 + Math.floor(rand() * 3);
  brick(parent, colour, w, 1, x, y + 0.1, z, 0);
}

/**
 * A vending machine for moulds, in red: a plinth, a cabinet with a window on three shelves of
 * moulds under a cyan strip light, and a control column to its right with a glowing screen, a
 * keypad, and the hatch a mould drops into under a smoked flap, an amber lamp over it.
 */
export function buildMouldVendor(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dispenser';
  const { x: w, y: h, z: d } = MACHINE_SIZE.dispenser;
  const red = paint(SPORT.red);
  const [hw, hd] = [w / 2, d / 2];
  // The plinth, and the cabinet round its window and column.
  cbox(g, charcoal(), 0, 0.06, 0, w - 0.04, 0.12, d - 0.04, 0.02);
  cbox(g, cyan(), 0, 0.13, hd - 0.02, w - 0.12, 0.012, 0.01, 0.003);
  const front = hd - 0.03 + 0.003;
  // The window: a well into the cabinet behind glass in a steel frame, three shelves of moulds
  // in it. The cabinet is its back, and a shell round the well's opening to the front.
  const win = { x0: -hw + 0.1, x1: hw - 0.48, y0: 0.4, y1: h - 0.22 };
  const wx = (win.x0 + win.x1) / 2;
  const ww = win.x1 - win.x0;
  const wh = win.y1 - win.y0;
  const well = front - 0.38;
  const [y0, my] = [0.12, (win.y0 + win.y1) / 2];
  rbox(g, red, 0, (y0 + h) / 2, (-hd + well) / 2, w, h - y0, well + hd, 0.06);
  const shell = (x0: number, x1: number, ya: number, yb: number, r: number) =>
    rbox(
      g,
      red,
      (x0 + x1) / 2,
      (ya + yb) / 2,
      (well - 0.04 + front) / 2,
      x1 - x0,
      yb - ya,
      front - well + 0.04,
      r,
    );
  shell(-hw, hw, y0, win.y0 - 0.02, 0.06);
  shell(-hw, hw, win.y1 + 0.02, h, 0.06);
  shell(-hw, win.x0 - 0.02, win.y0 - 0.04, win.y1 + 0.04, 0.03);
  shell(win.x1 + 0.02, hw, win.y0 - 0.04, win.y1 + 0.04, 0.03);
  cbox(g, dark(), wx, my, well + 0.01, ww, wh, 0.02, 0.004);
  for (const [sx, sy, px, py] of [
    [ww + 0.06, 0.04, wx, win.y0 - 0.01],
    [ww + 0.06, 0.04, wx, win.y1 + 0.01],
    [0.04, wh, win.x0 - 0.01, (win.y0 + win.y1) / 2],
    [0.04, wh, win.x1 + 0.01, (win.y0 + win.y1) / 2],
  ] as const)
    cbox(g, steel(), px, py, front + 0.01, sx, sy, 0.03, 0.01);
  // The shelves sit inside the well; their moulds stand on them, a price strip lit along each.
  const shelf = { z: front - 0.2 };
  for (let i = 0; i < 3; i++) {
    const y = win.y0 + 0.08 + i * (wh / 3);
    cbox(g, white(), wx, y, shelf.z, ww - 0.04, 0.025, 0.3, 0.006);
    cbox(g, cyan(1.2), wx, y - 0.005, shelf.z + 0.152, ww - 0.06, 0.012, 0.006, 0.002);
    for (let j = 0; j < 3; j++)
      mould(
        g,
        BRICKS[(i * 3 + j) % BRICKS.length]!,
        wx + (j - 1) * (ww / 3),
        y + 0.013,
        shelf.z,
        7 + i * 3 + j,
      );
  }
  cbox(g, cyan(2.2), wx, win.y1 - 0.04, shelf.z, ww - 0.06, 0.02, 0.04, 0.005);
  cbox(g, glass(), wx, (win.y0 + win.y1) / 2, front + 0.012, ww, wh, 0.008, 0.003);
  // The control column: the screen, a keypad, the hatch with its flap and tray, the lamp.
  const cx = hw - 0.25;
  cbox(g, charcoal(), cx, h - 0.42, front + 0.01, 0.34, 0.26, 0.02, 0.012);
  cbox(g, cyan(1.4), cx, h - 0.42, front + 0.022, 0.28, 0.2, 0.004, 0.004);
  cbox(g, white(), cx - 0.06, h - 0.38, front + 0.025, 0.1, 0.015, 0.002, 0.001);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++)
      rbox(
        g,
        j === 3 && i === 2 ? paint(0x3cc070) : steel(),
        cx - 0.07 + i * 0.07,
        h - 0.66 - j * 0.055,
        front + 0.015,
        0.05,
        0.04,
        0.02,
        0.008,
      );
  const hatch = { y: 0.75, w: 0.3, h: 0.24 };
  cbox(g, dark(), cx, hatch.y, front - 0.06, hatch.w, hatch.h, 0.14, 0.01);
  cbox(
    g,
    steel(),
    cx,
    hatch.y - hatch.h / 2 - 0.015,
    front + 0.02,
    hatch.w + 0.06,
    0.03,
    0.06,
    0.01,
  );
  cbox(
    g,
    steel(),
    cx,
    hatch.y + hatch.h / 2 + 0.012,
    front + 0.01,
    hatch.w + 0.06,
    0.024,
    0.03,
    0.008,
  );
  const flap = cbox(
    g,
    smoked(),
    cx,
    hatch.y + 0.01,
    front + 0.018,
    hatch.w - 0.02,
    hatch.h - 0.04,
    0.008,
    0.003,
  );
  flap.rotation.x = -0.12;
  rbox(
    g,
    glow(CAR.amber, 2.2),
    cx,
    hatch.y + hatch.h / 2 + 0.06,
    front + 0.012,
    0.09,
    0.025,
    0.02,
    0.008,
  );
  for (let i = 0; i < 4; i++)
    cbox(g, dark(), cx, 0.22 + i * 0.035, front + 0.003, 0.24, 0.012, 0.006, 0.002);
  // A sign panel over it all, its edge lit cyan.
  cbox(g, charcoal(), 0, h - 0.08, front + 0.012, w - 0.14, 0.1, 0.02, 0.01);
  BRICKS.forEach((c, i) => brick(g, c, 2, 1, -0.4 + i * 0.2, h - 0.12, front + 0.06, 0));
  cbox(g, cyan(), 0, h - 0.135, front + 0.025, w - 0.18, 0.008, 0.004, 0.002);
  return g;
}

// ---------------------------------------------------------------------------------------------
// The brick press.

/**
 * An injection moulding machine, its body in the bus's yellow on a charcoal bed: the clamp at
 * its left (a cylinder housing, the ram, the moving and fixed platens on four steel tie bars,
 * a mould between them behind a glass safety door), a bay in the bed's front the bricks drop
 * into, and at its right the injection unit: a barrel in heater bands glowing amber, a clear
 * hopper of pellets over it, and a housing with a lit control panel and a stack light.
 */
export function buildBrickPress(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'press';
  const { x: w, z: d } = MACHINE_SIZE.press;
  const [hw, hd] = [w / 2, d / 2];
  const yellow = paint(BUS.yellow);
  // Feet and the bed, a cyan strip along its foot.
  for (const x of [-hw + 0.2, 0, hw - 0.2])
    for (const z of [-hd + 0.15, hd - 0.15]) cbox(g, gunmetal(), x, 0.05, z, 0.14, 0.1, 0.14, 0.01);
  const bed = { y0: 0.1, y1: 0.62 };
  rbox(g, charcoal(), 0, (bed.y0 + bed.y1) / 2, 0, w - 0.06, bed.y1 - bed.y0, d - 0.08, 0.04);
  cbox(g, cyan(), 0, bed.y0 + 0.04, hd - 0.035, w - 0.2, 0.012, 0.01, 0.003);
  cbox(g, yellow, 0, bed.y1 - 0.06, hd - 0.035, w - 0.16, 0.06, 0.012, 0.006);
  // The bay under the mould: a dark recess with a tray, bricks waiting in it.
  const mx = -0.35;
  const bay = { w: 0.6, y0: 0.2, y1: 0.48 };
  cbox(g, dark(), mx, (bay.y0 + bay.y1) / 2, hd - 0.17, bay.w, bay.y1 - bay.y0, 0.3, 0.01);
  cbox(g, steel(), mx, bay.y0 - 0.01, hd - 0.04, bay.w + 0.06, 0.03, 0.07, 0.008);
  for (const sx of [-1, 1])
    cbox(
      g,
      steel(),
      mx + sx * (bay.w / 2 + 0.015),
      (bay.y0 + bay.y1) / 2,
      hd - 0.04,
      0.03,
      bay.y1 - bay.y0,
      0.06,
      0.008,
    );
  brick(g, SPORT.red, 2, 1, mx - 0.15, bay.y0 + 0.005, hd - 0.15, 0.2);
  brick(g, SPORT.red, 2, 1, mx + 0.13, bay.y0 + 0.005, hd - 0.17, -0.3);
  // The clamp: the cylinder housing at the end, the ram, two platens and the tie bars.
  const top = bed.y1;
  const axis = { y: top + 0.36, z: -0.02 };
  rbox(g, yellow, -hw + 0.25, axis.y, axis.z, 0.42, 0.62, 0.66, 0.08);
  cbox(g, cyan(1.4), -hw + 0.25, axis.y - 0.31, axis.z + 0.334, 0.36, 0.01, 0.006, 0.002);
  bar(g, steel(), 'x', -hw + 0.6, axis.y, axis.z, 0.07, 0.36, 24);
  const platens = [mx - 0.32, mx + 0.32];
  rbox(g, gunmetal(), platens[0]!, axis.y, axis.z, 0.1, 0.66, 0.62, 0.02);
  rbox(g, gunmetal(), platens[1]!, axis.y, axis.z, 0.12, 0.7, 0.66, 0.02);
  for (const sy of [-1, 1])
    for (const sz of [-1, 1])
      bar(
        g,
        steel(),
        'x',
        (-hw + 0.46 + platens[1]! + 0.06) / 2,
        axis.y + sy * 0.25,
        axis.z + sz * 0.24,
        0.025,
        platens[1]! + 0.06 + hw - 0.46,
      );
  // The mould between them, its two halves: steel, a red cavity line where they meet.
  rbox(g, steel(), mx - 0.12, axis.y, axis.z, 0.2, 0.38, 0.36, 0.02);
  rbox(g, steel(), mx + 0.12, axis.y, axis.z, 0.2, 0.38, 0.36, 0.02);
  cbox(g, dark(), mx, axis.y, axis.z, 0.03, 0.34, 0.32, 0.004);
  // The safety door before the mould: glass in a charcoal frame, a steel handle, sliding in a
  // track on the bed under a rail held up on two posts.
  const door = { z: hd - 0.08, y0: top + 0.05, y1: top + 0.74, x0: -hw + 0.5, x1: mx + 0.44 };
  const dx = (door.x0 + door.x1) / 2;
  const dw = door.x1 - door.x0;
  cbox(g, glass(), dx, (door.y0 + door.y1) / 2, door.z, dw, door.y1 - door.y0, 0.01, 0.003);
  for (const y of [door.y0, door.y1])
    cbox(g, charcoal(), dx, y, door.z, dw + 0.04, 0.04, 0.04, 0.01);
  for (const x of [door.x0, door.x1])
    cbox(g, charcoal(), x, (door.y0 + door.y1) / 2, door.z, 0.04, door.y1 - door.y0, 0.04, 0.01);
  rbox(g, steel(), door.x1 - 0.08, (door.y0 + door.y1) / 2, door.z + 0.04, 0.03, 0.26, 0.03, 0.012);
  const run = { x0: door.x0 - 0.06, x1: door.x1 + 0.36 };
  const rx = (run.x0 + run.x1) / 2;
  cbox(g, gunmetal(), rx, top + 0.015, door.z, run.x1 - run.x0, 0.03, 0.06, 0.006);
  cbox(g, gunmetal(), rx, door.y1 + 0.05, door.z - 0.01, run.x1 - run.x0, 0.03, 0.05, 0.008);
  for (const x of [run.x0, run.x1])
    cbox(
      g,
      gunmetal(),
      x,
      (top + door.y1 + 0.065) / 2,
      door.z - 0.01,
      0.04,
      door.y1 + 0.065 - top,
      0.05,
      0.008,
    );
  cbox(g, yellow, dx, door.y1 + 0.13, door.z - 0.02, 0.5, 0.12, 0.03, 0.01);
  cbox(g, dark(), dx, door.y1 + 0.13, door.z - 0.002, 0.44, 0.07, 0.004, 0.002);
  BRICKS.slice(0, 3).forEach((c, i) =>
    brick(g, c, 2, 1, dx - 0.13 + i * 0.13, door.y1 + 0.105, door.z + 0.01, 0),
  );
  // The injection unit: a carriage, the barrel in its heater bands, a nozzle into the platen.
  const ux = { x0: platens[1]! + 0.06, x1: hw - 0.6 };
  cbox(g, gunmetal(), (ux.x0 + ux.x1) / 2, top + 0.06, axis.z, ux.x1 - ux.x0, 0.12, 0.3, 0.02);
  bar(g, steel(), 'x', (ux.x0 + ux.x1) / 2, axis.y - 0.05, axis.z, 0.07, ux.x1 - ux.x0, 24);
  for (let i = 0; i < 4; i++)
    bar(
      g,
      glow(CAR.amber, 1.6),
      'x',
      ux.x0 + 0.1 + i * ((ux.x1 - ux.x0 - 0.2) / 3),
      axis.y - 0.05,
      axis.z,
      0.085,
      0.07,
      24,
    );
  // The hopper over the barrel's back: a throat on the barrel up into a clear cone and drum with
  // red pellets in it, a lid.
  const hx = ux.x1 - 0.12;
  const hy = axis.y + 0.18;
  cbox(g, gunmetal(), hx, axis.y + 0.03, axis.z, 0.16, 0.05, 0.16, 0.01);
  can(g, steel(), hx, (axis.y + 0.05 + hy + 0.06) / 2, axis.z, 0.05, hy + 0.01 - axis.y, 16);
  can(g, glass(), hx, hy + 0.15, axis.z, 0.06, 0.2, 32, 0.17);
  can(g, glass(), hx, hy + 0.37, axis.z, 0.17, 0.24, 32);
  can(g, plastic(SPORT.red), hx, hy + 0.2, axis.z, 0.06, 0.12, 24, 0.13);
  can(g, plastic(SPORT.red), hx, hy + 0.34, axis.z, 0.15, 0.16, 24);
  can(g, steel(), hx, hy + 0.25, axis.z, 0.175, 0.025, 32);
  can(g, charcoal(), hx, hy + 0.5, axis.z, 0.18, 0.03, 32);
  // The housing at the right end: motor and controls, a lit panel on its front.
  const house = { x: hw - 0.3, w: 0.56, h: 0.74 };
  rbox(g, yellow, house.x, top + house.h / 2, -0.02, house.w, house.h, d - 0.18, 0.07);
  cbox(g, charcoal(), house.x, top + 0.5, hd - 0.1 + 0.005, 0.42, 0.36, 0.02, 0.015);
  cbox(g, cyan(1.4), house.x, top + 0.56, hd - 0.1 + 0.017, 0.34, 0.16, 0.004, 0.004);
  for (let i = 0; i < 3; i++)
    can(
      g,
      i === 2 ? paint(SPORT.red) : steel(),
      house.x - 0.1 + i * 0.1,
      top + 0.38,
      hd - 0.1 + 0.02,
      0.025,
      0.02,
      16,
    ).rotateX(Math.PI / 2);
  for (let i = 0; i < 4; i++)
    cbox(g, dark(), house.x, top + 0.12 + i * 0.04, hd - 0.1 + 0.002, 0.36, 0.014, 0.006, 0.002);
  stackLight(g, house.x + 0.15, top + house.h, -0.15);
  return g;
}

// ---------------------------------------------------------------------------------------------
// The UV printer.

/**
 * A desk printer for bricks, in the off-roader's lime: a stand on charcoal legs, the cabinet with
 * a cyan stripe, its bed ruled in a grid with a brick on it, towers at its ends holding the
 * gantry over the bed's back, the print head parked on it with its UV lamp glowing violet
 * underneath, ink bottles on the left tower and a little screen on the right.
 */
export function buildUVPrinter(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'printer';
  const { x: w, y: h, z: d } = MACHINE_SIZE.printer;
  const [hw, hd] = [w / 2, d / 2];
  const lime = paint(CAR.lime);
  // The stand: legs, feet and a shelf.
  const stand = 0.62;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      rbox(g, charcoal(), sx * (hw - 0.08), stand / 2, sz * (hd - 0.08), 0.06, stand, 0.06, 0.015);
      cbox(g, gunmetal(), sx * (hw - 0.08), 0.01, sz * (hd - 0.08), 0.1, 0.02, 0.1, 0.006);
    }
  cbox(g, charcoal(), 0, 0.18, 0, w - 0.1, 0.03, d - 0.1, 0.008);
  bucket(g, BRICKS[2]!, -0.3, 0.195, 0);
  // The cabinet, its stripe, and the bed on top.
  const cab = { y0: stand, y1: stand + 0.22 };
  rbox(g, lime, 0, (cab.y0 + cab.y1) / 2, 0, w, cab.y1 - cab.y0, d, 0.05);
  cbox(g, cyan(), 0, cab.y0 + 0.03, hd + 0.002, w - 0.12, 0.012, 0.006, 0.003);
  cbox(g, charcoal(), 0, cab.y0 + 0.12, hd + 0.003, 0.5, 0.08, 0.008, 0.006);
  BRICKS.forEach((c, i) =>
    cbox(g, plastic(c), -0.16 + i * 0.08, cab.y0 + 0.12, hd + 0.009, 0.05, 0.04, 0.004, 0.002),
  );
  const bed = { y: cab.y1 + 0.005, x0: -hw + 0.24, x1: hw - 0.24, z0: -hd + 0.18, z1: hd - 0.06 };
  const bx = (bed.x0 + bed.x1) / 2;
  const bz = (bed.z0 + bed.z1) / 2;
  cbox(g, gunmetal(), bx, bed.y, bz, bed.x1 - bed.x0, 0.012, bed.z1 - bed.z0, 0.004);
  for (let x = bed.x0 + 0.1; x < bed.x1 - 0.05; x += 0.1)
    cbox(g, dark(), x, bed.y + 0.007, bz, 0.004, 0.002, bed.z1 - bed.z0 - 0.02, 0.001);
  for (let z = bed.z0 + 0.1; z < bed.z1 - 0.05; z += 0.1)
    cbox(g, dark(), bx, bed.y + 0.007, z, bed.x1 - bed.x0 - 0.02, 0.002, 0.004, 0.001);
  const part = brick(g, 0xeceae4, 4, 2, bx + 0.05, bed.y + 0.006, bz + 0.05, 0);
  // A print on the part's side: a little picture in the scene's colours.
  cbox(part, plastic(TEAL), -0.04, 0.05, 0.081, 0.12, 0.05, 0.002, 0.001);
  cbox(part, plastic(SPORT.red), 0.06, 0.05, 0.081, 0.06, 0.05, 0.002, 0.001);
  // The towers at its ends, the gantry over the bed's back, the head parked on it.
  const tower = { w: 0.2, h: h - cab.y1 };
  for (const sx of [-1, 1])
    rbox(
      g,
      lime,
      sx * (hw - tower.w / 2 - 0.02),
      cab.y1 + tower.h / 2,
      -0.04,
      tower.w,
      tower.h,
      d - 0.14,
      0.04,
    );
  const gy = h - 0.08;
  const gz = bed.z0 + 0.06;
  rbox(g, gunmetal(), 0, gy, gz, w - 0.36, 0.08, 0.1, 0.02);
  cbox(g, steel(), 0, gy - 0.05, gz + 0.04, w - 0.4, 0.015, 0.015, 0.004);
  const head = { x: bed.x0 + 0.2 };
  rbox(g, charcoal(), head.x, gy - 0.02, gz + 0.06, 0.14, 0.16, 0.14, 0.03);
  cbox(g, glow(0x9a6bff, 2.6), head.x, gy - 0.105, gz + 0.06, 0.1, 0.01, 0.1, 0.004);
  cbox(g, cyan(1.4), head.x, gy + 0.02, gz + 0.131, 0.1, 0.01, 0.004, 0.002);
  // Ink bottles on the left tower; a little screen and a button on the right.
  const lx = -hw + tower.w / 2 + 0.02;
  [0x2fd0e8, 0xe83fa0, BUS.yellow, 0x15181a].forEach((c, i) => {
    const z = -0.2 + i * 0.1;
    can(g, glass(), lx, h + 0.06, z, 0.035, 0.12, 16);
    can(g, plastic(c), lx, h + 0.045, z, 0.03, 0.08, 16);
    can(g, charcoal(), lx, h + 0.13, z, 0.02, 0.02, 12);
  });
  const rx = hw - tower.w / 2 - 0.02;
  cbox(g, charcoal(), rx, cab.y1 + tower.h * 0.6, hd - 0.1, 0.16, 0.12, 0.02, 0.01);
  cbox(g, cyan(1.4), rx, cab.y1 + tower.h * 0.6, hd - 0.088, 0.13, 0.09, 0.004, 0.004);
  can(g, paint(0x3cc070), rx, cab.y1 + tower.h * 0.25, hd - 0.08, 0.025, 0.02, 16).rotateX(
    Math.PI / 2,
  );
  return g;
}

/** Each machine's own builder, by the game's name for its kind. */
export const MACHINE_MODELS = {
  silo: buildSilo,
  press: buildBrickPress,
  dispenser: buildMouldVendor,
  printer: buildUVPrinter,
};

/**
 * The four in a row along -z from `z`, `gap` apart, their fronts along x = `front` turned to -x,
 * on a concrete pad edged in hazard yellow along their fronts.
 */
export function buildBrickWorks(at: { front: number; z: number; gap: number }): THREE.Group {
  const root = new THREE.Group();
  root.name = 'brickWorks';
  let z = at.z;
  for (const [kind, build] of Object.entries(MACHINE_MODELS) as [
    keyof typeof MACHINE_MODELS,
    () => THREE.Group,
  ][]) {
    const size = MACHINE_SIZE[kind];
    const m = build();
    // Turned a quarter, its width runs along z and its depth back along +x.
    m.position.set(at.front + size.z / 2, PAD, z - size.x / 2);
    m.rotation.y = -Math.PI / 2;
    root.add(m);
    z -= size.x + at.gap;
  }
  const z1 = at.z + 0.6;
  const z0 = z + at.gap - 0.6;
  const deep = Math.max(...Object.values(MACHINE_SIZE).map((s) => s.z));
  const [x0, x1] = [at.front - 1.0, at.front + deep + 0.5];
  const pad = cbox(
    root,
    mat(0x9a9c9c, { mottle: 'plastic', roughness: 0.85 }),
    (x0 + x1) / 2,
    PAD / 2,
    (z0 + z1) / 2,
    x1 - x0,
    PAD,
    z1 - z0,
    0.01,
  );
  pad.name = 'pad';
  cbox(
    root,
    paint(BUS.yellow),
    at.front - 0.35,
    PAD + 0.001,
    (z0 + z1) / 2,
    0.08,
    0.002,
    z1 - z0 - 0.3,
    0.001,
  );
  // Hazard chevrons along the pad's front edge.
  for (let zz = z0 + 0.25; zz < z1 - 0.2; zz += 0.3)
    cbox(root, charcoal(), x0 + 0.08, PAD + 0.001, zz, 0.1, 0.002, 0.14, 0.001, [0, 0.6, 0]);
  cbox(root, cyan(1.4), x0 + 0.004, PAD - 0.012, (z0 + z1) / 2, 0.006, 0.008, z1 - z0 - 0.1, 0.002);
  return root;
}

/** How thick the brick works' pad is: the machines stand on it. */
const PAD = 0.04;
