import * as THREE from 'three';
import { MACHINE_SIZE } from '@sar/shared';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import type { BrickTypeId } from '@sar/shared';
import { brickGeometry } from '../render/bricks.ts';
import { mouldTop, posedInMould } from '../render/mouldCavity.ts';
import type { MouldTop } from '../render/mouldCavity.ts';
import { HOPPER_STEP, HOPPER_STEP_SIZE } from '../render/operate.ts';
import { bentPath, boxUV, cbox, glow, mat, put, rbox, tube } from './kit.ts';
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
 * Each is built standing on the origin, its front toward +z, its box's middle over the origin,
 * with its output area just where the game's has it (see `outputSlots`); what moves as it works
 * (see `LIVE_PARTS`) is a group of its own, and each has a green start button to press.
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

/**
 * Where something a machine makes or holds goes, named for it: a place in its output area
 * (`out0`, `out1`…) or the printer's `bed`, just where the game has it (see `outputSlots`). An
 * empty marker: the brick works draws what lies there (see `CarMachineView`).
 */
function anchor(parent: THREE.Object3D, name: string, x: number, y: number, z: number): void {
  const a = new THREE.Group();
  a.name = name;
  a.position.set(x, y, z);
  parent.add(a);
}

/**
 * The names of a machine's parts that move or change as it runs, so they are kept apart from the
 * scene's still parts: the moulding machine's mould and its pellets, its clamp, safety door,
 * hopper lid and the guard over its bay; the silo's valve, auger and stack of buckets; the
 * vendor's flap and picker; the printer's gantry; each one's start button, progress bar and stack
 * light; and the layers the brick works draws what is in them and their work in (see
 * `CarMachineView`).
 */
export const LIVE_PARTS = [
  'mould',
  'pellets',
  'clamp',
  'safetyDoor',
  'lid',
  'bayFlap',
  'valve',
  'auger',
  'stack',
  'flap',
  'picker',
  'gantry',
  'button',
  'progress',
  'hopperStep',
  'lamp0',
  'lamp1',
  'lamp2',
  'fx',
  'contents',
];

/** The pellets' and bricks' colours, as the game's: red, yellow, blue, lime, white. */
export const BRICKS = [SPORT.red, BUS.yellow, 0x2f7fd8, 0x8fc23a, 0xeceae4];

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

/**
 * A pail of pellets, its foot's middle at (`x`, `y`, `z`), filled to below its rim; its handle
 * up over it, or `folded` down against its side toward +z (out from under a spout).
 */
export function bucket(
  parent: THREE.Object3D,
  colour: number,
  x: number,
  y: number,
  z: number,
  folded = false,
): void {
  const g = pail(parent, x, y, z);
  can(g, plastic(colour), 0, 0.23, 0, 0.143, 0.02, 32, 0.145);
  const V = THREE.Vector3;
  const handle = bentPath(
    folded
      ? [
          new V(-0.155, 0.27, 0),
          new V(-0.11, 0.2, 0.135),
          new V(0, 0.17, 0.17),
          new V(0.11, 0.2, 0.135),
          new V(0.155, 0.27, 0),
        ]
      : [new V(-0.15, 0.28, 0), new V(0, 0.42, 0), new V(0.15, 0.28, 0)],
    0.06,
  );
  tube(g, handle, 0.008, steel());
}

/** The stack light's lamps' colours, from the bottom: green, amber and red. */
export const STACK_LAMPS = [0x3cff7a, CAR.amber, 0xff2a20];

/**
 * A stack light: green, amber and red lamps on a charcoal post, the green lit; each lamp named
 * `lamp0`, `lamp1` and `lamp2` up the post, for the brick works to light as the machine runs.
 */
function stackLight(parent: THREE.Object3D, x: number, y: number, z: number): void {
  can(parent, charcoal(), x, y + 0.06, z, 0.025, 0.12, 16);
  STACK_LAMPS.forEach((colour, i) => {
    const m = i
      ? mat(colour, { mottle: 'none', roughness: 0.3, transparent: true, opacity: 0.6 })
      : glow(colour, 2.4);
    can(parent, m, x, y + 0.16 + i * 0.075, z, 0.045, 0.065, 24).name = `lamp${i}`;
  });
  can(parent, charcoal(), x, y + 0.4, z, 0.048, 0.02, 24);
}

/** The green of the machines' start buttons, and how brightly one glows while it is pressed. */
export const BUTTON_GREEN = 0x3cc070;

/**
 * A machine's start button: a round green cap of radius `r` in a charcoal bezel, its face
 * toward +z at (`x`, `y`, `z`). The cap is in a group named `button`, to push in, and is named
 * `buttonCap`, to light; its paint glows not at all until it is lit.
 */
function pushButton(parent: THREE.Object3D, x: number, y: number, z: number, r: number): void {
  bar(parent, charcoal(), 'z', x, y, z + 0.004, r + 0.01, 0.008, 24);
  const button = new THREE.Group();
  button.name = 'button';
  button.position.set(x, y, z + 0.008);
  parent.add(button);
  const cap = mat(BUTTON_GREEN, {
    mottle: 'plastic',
    roughness: 0.3,
    emissive: BUTTON_GREEN,
    emissiveIntensity: 0,
  });
  bar(button, cap, 'z', 0, 0, 0.008, r, 0.016, 24).name = 'buttonCap';
}

/** How wide the box the silo's start button is on is. */
const SILO_BUTTON_BOX = 0.1;

/**
 * Where the silo's parts are, in its frame: its radius and how far back its middle is, the
 * ring its body stands on, the tap and the grate under it (whose top is the silo's output area,
 * as the game has it: see `outputSlots`), and where the stack of empty buckets stands.
 */
export const SILO = (() => {
  const { x: w, z: d } = MACHINE_SIZE.silo;
  const tapZ = d / 2 - 0.1;
  return {
    r: Math.min(w, d) / 2 - 0.12,
    cz: -0.12,
    ring: { y: 1.2 },
    tap: { y: 0.99, z: tapZ },
    /** The spout's mouth, where the pellets fall from. */
    spout: { y: 0.8, z: tapZ - 0.04 },
    grate: { y: 0.5, z: tapZ - 0.04 },
    stack: { x: -w / 2 + 0.2, z: d / 2 - 0.25 },
    /** Its display's middle across and up, and how wide it is. */
    screen: { x: 0.07 + SILO_BUTTON_BOX + 0.04 + 0.065, y: 1.1, w: 0.13 },
  };
})();

/**
 * A progress bar `len` long, its middle at (`x`, `y`), standing out of a face at `z`: a dark
 * track, and in it a lit bar in a group named `progress`, its origin at the bar's left end, to
 * stretch across it as the machine works. Hidden until then.
 */
function progressBar(parent: THREE.Object3D, x: number, y: number, z: number, len: number): void {
  cbox(parent, dark(), x, y, z + 0.0015, len + 0.012, 0.018, 0.003, 0.001);
  const bar = new THREE.Group();
  bar.name = 'progress';
  bar.position.set(x - len / 2, y, z + 0.0035);
  bar.visible = false;
  parent.add(bar);
  cbox(bar, glow(STACK_LAMPS[0]!, 2), len / 2, 0, 0, len, 0.01, 0.002, 0.0005);
}

// ---------------------------------------------------------------------------------------------
// The pellet silo.

/**
 * A tall teal silo on four braced legs over a cone, banded in steel, a domed roof with a vent; a
 * sight strip of the pellets' colours down its front, lit cyan; a ladder up its side; and from
 * its cone a pipe out to a tap at the front with a red valve wheel, over a grate for the bucket
 * it fills, a stack of empty buckets beside it.
 */
export function buildSilo(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'silo';
  const { y: h } = MACHINE_SIZE.silo;
  const { r, cz, ring, tap, grate } = SILO;
  const body = paint(TEAL);
  // The legs, on foot plates, braced in pairs.
  const leg = r * 0.78;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const [x, z] = [sx * leg * 0.72, cz + sz * leg * 0.72];
      cbox(g, gunmetal(), x, 0.015, z, 0.16, 0.03, 0.16, 0.01);
      rbox(g, charcoal(), x, ring.y / 2, z, 0.07, ring.y, 0.07, 0.015);
    }
  for (const sz of [-1, 1])
    cbox(g, charcoal(), 0, 0.42, cz + sz * leg * 0.72, leg * 1.44, 0.05, 0.04, 0.01);
  for (const sx of [-1, 1])
    cbox(g, charcoal(), sx * leg * 0.72, 0.42, cz, 0.04, 0.05, leg * 1.44, 0.01);
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
  // (Its lights chase up the strip while it fills a bucket.)
  for (const sx of [-1, 1])
    cbox(
      g,
      cyan(),
      sx * 0.085,
      (s.y0 + s.y1) / 2,
      front + 0.016,
      0.012,
      s.y1 - s.y0,
      0.008,
      0.003,
    ).name = 'strip';
  // A ladder up its right side, off the body on brackets.
  const lx = r + 0.09;
  for (const sz of [-1, 1])
    cbox(g, steel(), lx, (0.1 + top + 0.3) / 2, cz + sz * 0.17, 0.035, top + 0.2, 0.035, 0.01);
  for (let y = 0.35; y < top + 0.2; y += 0.28) bar(g, steel(), 'z', lx, y, cz, 0.012, 0.34);
  for (const y of [ring.y + 0.3, top - 0.3])
    cbox(g, charcoal(), lx - 0.06, y, cz, 0.12, 0.03, 0.05, 0.008);
  // The outlet: straight out of the cone's front, under its ring, into the tap's block; a clear
  // length of it in the middle, the auger in it that turns as the pellets go through; the valve
  // wheel on top clear of the ring, the spout down into the bucket's mouth.
  const [p0, p1] = [cz + 0.2, tap.z - 0.05];
  const [g0, g1] = [cz + 0.44, tap.z - 0.17];
  for (const [a, b] of [
    [p0, g0],
    [g1, p1],
  ] as const) {
    const pipe = new THREE.CylinderGeometry(0.045, 0.045, b - a, 24, 1, true);
    pipe.rotateX(Math.PI / 2);
    put(g, pipe, steel(), 0, tap.y, (a + b) / 2);
  }
  for (const z of [g0, g1]) bar(g, gunmetal(), 'z', 0, tap.y, z, 0.055, 0.025, 24);
  bar(g, glass(), 'z', 0, tap.y, (g0 + g1) / 2, 0.048, g1 - g0, 24);
  const auger = new THREE.Group();
  auger.name = 'auger';
  auger.position.set(0, tap.y, (g0 + g1) / 2);
  g.add(auger);
  bar(auger, steel(), 'z', 0, 0, 0, 0.008, g1 - g0, 8);
  const turns = 3.5;
  const helix = Array.from({ length: 57 }, (_, i) => {
    const f = i / 56;
    const a = f * turns * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 0.03, Math.sin(a) * 0.03, (f - 0.5) * (g1 - g0 - 0.02));
  });
  tube(auger, new THREE.CatmullRomCurve3(helix), 0.006, steel());
  rbox(g, gunmetal(), 0, tap.y, tap.z - 0.04, 0.14, 0.14, 0.14, 0.03);
  can(g, steel(), 0, tap.y - 0.12, tap.z - 0.04, 0.035, 0.14, 16);
  // The valve wheel on top, in the sports car's red, and its bar: it turns the tap on and off.
  const valve = new THREE.Group();
  valve.name = 'valve';
  valve.position.set(0, tap.y + 0.11, tap.z - 0.04);
  g.add(valve);
  const wheel = new THREE.TorusGeometry(0.075, 0.012, 8, 24);
  wheel.rotateX(Math.PI / 2);
  put(valve, wheel, paint(SPORT.red), 0, 0, 0);
  bar(valve, paint(SPORT.red), 'x', 0, 0, 0, 0.01, 0.15);
  can(g, steel(), 0, tap.y + 0.09, tap.z - 0.04, 0.012, 0.05, 12);
  // The start button, on a box on the tap's right.
  const bx = 0.07 + SILO_BUTTON_BOX / 2;
  rbox(g, charcoal(), bx, tap.y, tap.z - 0.04, SILO_BUTTON_BOX, 0.12, 0.1, 0.015);
  pushButton(g, bx, tap.y, tap.z + 0.01, 0.024);
  // The grate under the tap on a post, lit cyan at its edge, where the bucket fills.
  can(g, charcoal(), 0, grate.y / 2, grate.z, 0.03, grate.y, 12);
  cbox(g, gunmetal(), 0, grate.y, grate.z, 0.34, 0.025, 0.28, 0.008);
  for (let i = -3; i <= 3; i++)
    cbox(g, dark(), i * 0.045, grate.y + 0.013, grate.z, 0.012, 0.004, 0.24, 0.002);
  cbox(g, cyan(1.4), 0, grate.y - 0.016, grate.z + 0.136, 0.32, 0.008, 0.006, 0.002).name =
    'outLight';
  anchor(g, 'out0', 0, grate.y + 0.0125, grate.z);
  // The display on a post on the tap's right, beyond the button (the game draws on it).
  const sx = SILO.screen.x;
  can(g, charcoal(), sx, (SILO.screen.y - 0.08) / 2, tap.z - 0.06, 0.025, SILO.screen.y - 0.08, 12);
  rbox(g, charcoal(), sx, SILO.screen.y, tap.z - 0.04, SILO.screen.w + 0.04, 0.12, 0.08, 0.012);
  cbox(g, dark(), sx, SILO.screen.y, tap.z, SILO.screen.w, 0.08, 0.004, 0.002);
  // A stack of empty buckets on its left.
  const stack = new THREE.Group();
  stack.name = 'stack';
  g.add(stack);
  for (let i = 0; i < 3; i++) pail(stack, SILO.stack.x, i * 0.07, SILO.stack.z);
  return g;
}

// ---------------------------------------------------------------------------------------------
// The mould vendor.

/** The parts the vendor's shelves show moulds for, one after another. */
const SHELF_MOULDS: BrickTypeId[] = [
  '2x4',
  'round2x2',
  'slope2x2',
  '1x2',
  '2x2',
  'plate2x3',
  'tile1x4',
  'roundplate1x1',
  '1x4',
];

/** Each part's mould's top, made once: its face and its cavity, ready for the mottle. */
const mouldTops = new Map<BrickTypeId, MouldTop>();

/**
 * A mould for `type` as the brick works hands it out: a rounded steel block, and set in its
 * top a square-edged steel plate with the part's shape sunk in it, the cavity the part is
 * moulded in, polished, tinted toward `tint` if it has one. Its foot's middle is its origin.
 */
export function mouldBlock(type: BrickTypeId, tint?: number): THREE.Group {
  const g = new THREE.Group();
  const [w, h, d] = [0.26, 0.12, 0.17];
  const plate = { w: w - 0.016, d: d - 0.016, h: 0.09 };
  rbox(g, steel(), 0, (h - plate.h + 0.01) / 2, 0, w, h - plate.h + 0.01, d, 0.02);
  let top = mouldTops.get(type);
  if (!top) {
    const rim = 0.025;
    const posed = posedInMould(
      brickGeometry(type),
      plate.w - 2 * rim,
      plate.h - 0.015,
      plate.d - 2 * rim,
    );
    top = mouldTop(posed, plate.w, plate.d, plate.h);
    posed.dispose();
    top.face = boxUV(top.face, 0.5);
    top.cavity = boxUV(top.cavity, 0.5);
    mouldTops.set(type, top);
  }
  put(g, top.face, steel(), 0, h, 0);
  const cavity = mat(
    tint === undefined
      ? 0xe4e9ec
      : new THREE.Color(0xe4e9ec).lerp(new THREE.Color(tint), 0.65).getHex(),
    {
      mottle: 'metal',
      roughness: 0.2,
      metalness: 0.55,
      envMapIntensity: 2,
    },
  );
  put(g, top.cavity, cavity, 0, h, 0);
  return g;
}

/**
 * A mould on show on a shelf, its foot's front edge at (`x`, `y`, `z`): leant back on a
 * charcoal stand so its cavity faces out through the window, tinted `colour`.
 */
function shelfMould(
  parent: THREE.Object3D,
  type: BrickTypeId,
  colour: number,
  x: number,
  y: number,
  z: number,
): void {
  const lean = 1.05;
  const d = 0.17;
  const m = mouldBlock(type, colour);
  m.rotation.x = lean;
  m.position.set(x, y + (d / 2) * Math.sin(lean), z - (d / 2) * Math.cos(lean));
  parent.add(m);
  // The stand: a block behind its foot's back edge, up to it.
  const rise = d * Math.sin(lean);
  cbox(parent, charcoal(), x, y + rise / 2, z - d * Math.cos(lean) - 0.03, 0.18, rise, 0.06, 0.008);
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
  const { front, win, hatch, picker } = VENDOR;
  // The window: a well into the cabinet behind glass in a steel frame, three shelves of moulds
  // in it. The cabinet is its back, and a shell round the well's opening to the front.
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
  // The control column's, round the hatch a mould drops into: open, lined dark, a tray its floor
  // (the vendor's output area, as the game has it: see `outputSlots`).
  const cx = hatch.x;
  const [hx0, hx1] = [cx - hatch.w / 2, cx + hatch.w / 2];
  const [hy0, hy1] = [hatch.y - hatch.h / 2, hatch.y + hatch.h / 2];
  shell(win.x1 + 0.02, hw, win.y0 - 0.04, hy0, 0.03);
  shell(win.x1 + 0.02, hw, hy1, win.y1 + 0.04, 0.03);
  shell(win.x1 + 0.02, hx0, hy0, hy1, 0.01);
  shell(hx1, hw, hy0, hy1, 0.01);
  const hz = front - hatch.depth;
  cbox(g, dark(), cx, hatch.y, hz - 0.01, hatch.w, hatch.h, 0.02, 0.004);
  for (const sx of [-1, 1])
    cbox(
      g,
      dark(),
      cx + sx * (hatch.w / 2 - 0.005),
      hatch.y,
      (hz + front) / 2,
      0.01,
      hatch.h,
      hatch.depth,
      0.002,
    );
  cbox(g, dark(), cx, hy1 - 0.005, (hz + front) / 2, hatch.w, 0.01, hatch.depth, 0.002);
  cbox(g, steel(), cx, hy0 + 0.004, (hz + front) / 2, hatch.w - 0.02, 0.008, hatch.depth, 0.002);
  anchor(g, 'out0', cx, hy0 + 0.008, (hz + front) / 2);
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
    const y = VENDOR.shelf(i);
    cbox(g, white(), wx, y, shelf.z, ww - 0.04, 0.025, 0.3, 0.006);
    cbox(g, cyan(1.2), wx, y - 0.005, shelf.z + 0.152, ww - 0.06, 0.012, 0.006, 0.002).name =
      'strip';
    for (let j = 0; j < 3; j++)
      shelfMould(
        g,
        SHELF_MOULDS[i * 3 + j]!,
        BRICKS[(i * 3 + j) % BRICKS.length]!,
        VENDOR.column(j),
        y + 0.013,
        shelf.z + 0.08,
      );
  }
  cbox(g, cyan(2.2), wx, win.y1 - 0.04, shelf.z, ww - 0.06, 0.02, 0.04, 0.005);
  // The picker that fetches a mould off its shelf: a carriage on a rail along the window's top,
  // in front of the shelves, and an arm that reaches down from it to a shelf, a gripper on its
  // end. It waits at the right, by the column.
  cbox(g, steel(), wx, picker.y + 0.035, picker.z, ww - 0.02, 0.012, 0.012, 0.003);
  const carriage = new THREE.Group();
  carriage.name = 'picker';
  carriage.position.set(picker.park, picker.y, picker.z);
  g.add(carriage);
  cbox(carriage, charcoal(), 0, 0.012, 0, 0.09, 0.04, 0.026, 0.008);
  cbox(carriage, cyan(1.6), 0, -0.009, 0.0135, 0.07, 0.006, 0.002, 0.001).name = 'strip';
  const arm = new THREE.Group();
  arm.name = 'arm';
  carriage.add(arm);
  cbox(arm, steel(), 0, -0.5, 0, 0.014, 1, 0.014, 0.002);
  arm.scale.y = picker.reach;
  const grip = new THREE.Group();
  grip.name = 'grip';
  grip.position.y = -picker.reach;
  carriage.add(grip);
  cbox(grip, charcoal(), 0, 0, 0, 0.11, 0.018, 0.022, 0.005);
  for (const sx of [-1, 1]) cbox(grip, steel(), sx * 0.05, -0.025, 0, 0.008, 0.04, 0.018, 0.002);
  cbox(g, glass(), wx, (win.y0 + win.y1) / 2, front + 0.012, ww, wh, 0.008, 0.003);
  // The control column: the screen, a keypad, the hatch's flap and tray, the lamp.
  cbox(g, charcoal(), cx, h - 0.42, front + 0.01, 0.34, 0.26, 0.02, 0.012);
  cbox(g, cyan(1.4), cx, h - 0.42, front + 0.022, 0.28, 0.2, 0.004, 0.004).name = 'screen';
  cbox(g, white(), cx - 0.06, h - 0.38, front + 0.025, 0.1, 0.015, 0.002, 0.001);
  progressBar(g, cx, h - 0.49, front + 0.025, 0.22);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++) {
      const [x, y] = [cx - 0.07 + i * 0.07, h - 0.63 - j * 0.055];
      // The key at the bottom right is the green one that starts it.
      if (j === 3 && i === 2) {
        rbox(g, charcoal(), x, y, front + 0.008, 0.056, 0.046, 0.006, 0.003);
        const key = new THREE.Group();
        key.name = 'button';
        key.position.set(x, y, front + 0.015);
        g.add(key);
        const cap = mat(BUTTON_GREEN, {
          mottle: 'plastic',
          roughness: 0.3,
          emissive: BUTTON_GREEN,
          emissiveIntensity: 0,
        });
        rbox(key, cap, 0, 0, 0, 0.05, 0.04, 0.02, 0.008).name = 'buttonCap';
      } else rbox(g, steel(), x, y, front + 0.015, 0.05, 0.04, 0.02, 0.008);
    }
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
  // The flap hangs from the hatch's top, a little open at its foot; it swings out as a mould
  // drops in behind it, and up as one is taken.
  const flap = new THREE.Group();
  flap.name = 'flap';
  flap.position.set(cx, hy1 - 0.01, front + 0.018);
  flap.rotation.x = FLAP_REST;
  g.add(flap);
  cbox(flap, smoked(), 0, -(hatch.h - 0.04) / 2, 0, hatch.w - 0.02, hatch.h - 0.04, 0.008, 0.003);
  // The lamp over it, lit while a mould waits behind it.
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
  ).name = 'hatchLamp';
  for (let i = 0; i < 4; i++)
    cbox(g, dark(), cx, 0.22 + i * 0.035, front + 0.003, 0.24, 0.012, 0.006, 0.002);
  // A sign panel over it all, its edge lit cyan.
  cbox(g, charcoal(), 0, h - 0.08, front + 0.012, w - 0.14, 0.1, 0.02, 0.01);
  BRICKS.forEach((c, i) => brick(g, c, 2, 1, -0.4 + i * 0.2, h - 0.12, front + 0.06, 0));
  cbox(g, cyan(), 0, h - 0.135, front + 0.025, w - 0.18, 0.008, 0.004, 0.002);
  return g;
}

/** How far the vendor's hatch flap hangs open at rest, swung out at its foot. */
export const FLAP_REST = -0.12;

/**
 * Where the vendor's parts are, in its frame: the plane of its front, the window, the hatch in
 * its control column (its tray the vendor's output area, as the game has it: see
 * `outputSlots`), its shelves and the moulds' places on them, and the picker over them.
 */
export const VENDOR = (() => {
  const { x: w, y: h, z: d } = MACHINE_SIZE.dispenser;
  const [hw, hd] = [w / 2, d / 2];
  const front = hd - 0.03 + 0.003;
  const win = { x0: -hw + 0.1, x1: hw - 0.48, y0: 0.4, y1: h - 0.22 };
  const ww = win.x1 - win.x0;
  const wx = (win.x0 + win.x1) / 2;
  return {
    front,
    win,
    hatch: { x: hw - 0.27, y: 0.962, w: 0.3, h: 0.24, depth: 0.28 },
    /** The top of shelf `i` (from the bottom). */
    shelf: (i: number) => win.y0 + 0.08 + i * ((win.y1 - win.y0) / 3),
    /** The middle of the moulds in column `j` across a shelf (from the left). */
    column: (j: number) => wx + (j - 1) * (ww / 3),
    /**
     * The picker's carriage: how high it runs, how far forward, where it waits, and how far its
     * arm reaches down while it waits.
     */
    picker: { y: win.y1 - 0.1, z: front - 0.028, park: win.x1 - 0.07, reach: 0.06 },
  };
})();

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
  const { bed, mx, bay, face, axis, platens, door, hopper } = PRESS;
  // Feet and the bed, a cyan strip along its foot.
  for (const x of [-hw + 0.2, 0, hw - 0.2])
    for (const z of [-hd + 0.15, hd - 0.15]) cbox(g, gunmetal(), x, 0.05, z, 0.14, 0.1, 0.14, 0.01);
  // The bay under the mould: a recess in the bed's front, lined dark, a steel tray its floor
  // with room for three bricks side by side (the press's output area, as the game has it: see
  // `outputSlots`). The bed is built round it.
  const back = face - bay.depth;
  const ym = (bed.y0 + bed.y1) / 2;
  const bh = bed.y1 - bed.y0;
  rbox(g, charcoal(), 0, ym, (-face + back) / 2, w - 0.06, bh, back + face, 0.04);
  const [bx0, bx1] = [mx - bay.w / 2, mx + bay.w / 2];
  const front = (x0: number, x1: number, y0: number, y1: number) =>
    cbox(
      g,
      charcoal(),
      (x0 + x1) / 2,
      (y0 + y1) / 2,
      (back + face) / 2,
      x1 - x0,
      y1 - y0,
      bay.depth,
    );
  front(-hw + 0.03, bx0, bed.y0, bed.y1);
  front(bx1, hw - 0.03, bed.y0, bed.y1);
  front(bx0, bx1, bed.y0, bay.y0);
  front(bx0, bx1, bay.y1, bed.y1);
  cbox(g, cyan(), 0, bed.y0 + 0.04, hd - 0.035, w - 0.2, 0.012, 0.01, 0.003);
  cbox(g, yellow, 0, bed.y1 - 0.06, hd - 0.035, w - 0.16, 0.06, 0.012, 0.006);
  cbox(g, dark(), mx, (bay.y0 + bay.y1) / 2, back + 0.01, bay.w, bay.y1 - bay.y0, 0.02, 0.004);
  for (const sx of [-1, 1])
    cbox(
      g,
      dark(),
      mx + sx * (bay.w / 2 - 0.005),
      (bay.y0 + bay.y1) / 2,
      (back + face) / 2,
      0.01,
      bay.y1 - bay.y0,
      bay.depth,
      0.002,
    );
  cbox(g, dark(), mx, bay.y1 - 0.005, (back + face) / 2, bay.w, 0.01, bay.depth, 0.002);
  // A light along the bay's ceiling, lit while parts wait in it.
  cbox(g, cyan(0.6), mx, bay.y1 - 0.012, face - 0.03, bay.w - 0.04, 0.006, 0.012, 0.002).name =
    'outLight';
  cbox(g, steel(), mx, bay.y0 + 0.004, (back + face) / 2, bay.w - 0.02, 0.008, bay.depth, 0.002);
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
  for (let i = 0; i < 3; i++)
    anchor(g, `out${i}`, mx + (i - 1) * bay.step, bay.y0 + 0.008, (back + face) / 2);
  // A clear guard over the bay's mouth, hung from its top: it swings in as a part is taken.
  const guard = new THREE.Group();
  guard.name = 'bayFlap';
  guard.position.set(mx, bay.y1 - 0.004, hd - 0.008);
  g.add(guard);
  const gh = bay.y1 - bay.y0 - 0.03;
  cbox(guard, glass(), 0, -gh / 2, 0, bay.w - 0.01, gh, 0.006, 0.002);
  cbox(guard, steel(), 0, -gh + 0.008, 0.002, bay.w - 0.03, 0.016, 0.01, 0.003);
  // The clamp: the cylinder housing at the end, the ram, two platens and the tie bars. The ram
  // and the moving platen draw back together to open the mould.
  const top = bed.y1;
  rbox(g, yellow, -hw + 0.22, axis.y, axis.z, 0.36, 0.62, 0.66, 0.08);
  cbox(g, cyan(1.4), -hw + 0.22, axis.y - 0.31, axis.z + 0.334, 0.3, 0.01, 0.006, 0.002);
  const clamp = new THREE.Group();
  clamp.name = 'clamp';
  g.add(clamp);
  // Out of the housing, and into the platen a little, its end not flush with the platen's face.
  const ram = { x0: -hw + 0.36, x1: platens[0] - 0.03 };
  bar(clamp, steel(), 'x', (ram.x0 + ram.x1) / 2, axis.y, axis.z, 0.07, ram.x1 - ram.x0, 24);
  rbox(clamp, gunmetal(), platens[0], axis.y, axis.z, 0.1, 0.66, 0.62, 0.02);
  rbox(g, gunmetal(), platens[1], axis.y, axis.z, 0.12, 0.7, 0.66, 0.02);
  const tie = { x0: -hw + 0.38, x1: platens[1] + 0.056 };
  for (const sy of [-1, 1])
    for (const sz of [-1, 1])
      // Ending just inside the fixed platen's back, not flush with it.
      bar(
        g,
        steel(),
        'x',
        (tie.x0 + tie.x1) / 2,
        axis.y + sy * 0.25,
        axis.z + sz * 0.24,
        0.025,
        tie.x1 - tie.x0,
      );
  // Under the mould, a chute down through the bed for the parts it makes, out of sight to the
  // bay's ceiling.
  cbox(g, dark(), mx, top + 0.003, axis.z, 0.24, 0.006, 0.3, 0.002);
  cbox(g, steel(), mx, top + 0.006, axis.z + 0.155, 0.26, 0.008, 0.012, 0.002);
  // The mould between them, once one is put in, its two halves on the platens: steel, a dark
  // line where they meet. The half on the moving platen (`mouldA`) goes with it.
  const loaded = new THREE.Group();
  loaded.name = 'mould';
  g.add(loaded);
  const halfA = new THREE.Group();
  halfA.name = 'mouldA';
  loaded.add(halfA);
  const meet = mx - 0.01;
  rbox(
    halfA,
    steel(),
    (platens[0] + 0.05 + meet) / 2,
    axis.y,
    axis.z,
    meet - platens[0] - 0.05,
    0.38,
    0.36,
    0.02,
  );
  rbox(
    loaded,
    steel(),
    (meet + 0.02 + platens[1] - 0.06) / 2,
    axis.y,
    axis.z,
    platens[1] - 0.06 - meet - 0.02,
    0.38,
    0.36,
    0.02,
  );
  cbox(loaded, dark(), meet + 0.01, axis.y, axis.z, 0.02, 0.34, 0.32, 0.004);
  // The safety door before the mould: glass in a charcoal frame, a steel handle at its left end
  // (it is pushed open by it), sliding to the right in a track on the bed under a rail held up on two posts.
  const slide = new THREE.Group();
  slide.name = 'safetyDoor';
  g.add(slide);
  const dx = (door.x0 + door.x1) / 2;
  const dw = door.x1 - door.x0;
  cbox(slide, glass(), dx, (door.y0 + door.y1) / 2, door.z, dw, door.y1 - door.y0, 0.01, 0.003);
  for (const y of [door.y0, door.y1])
    cbox(slide, charcoal(), dx, y, door.z, dw + 0.04, 0.04, 0.04, 0.01);
  for (const x of [door.x0, door.x1])
    cbox(
      slide,
      charcoal(),
      x,
      (door.y0 + door.y1) / 2,
      door.z,
      0.04,
      door.y1 - door.y0,
      0.04,
      0.01,
    );
  rbox(
    slide,
    steel(),
    door.x0 + 0.08,
    (door.y0 + door.y1) / 2,
    door.z + 0.04,
    0.03,
    0.26,
    0.03,
    0.012,
  );
  const run = { x0: door.x0 - 0.06, x1: door.x1 + door.slide + 0.06 };
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
    brick(g, c, 2, 1, dx - 0.165 + i * 0.165, door.y1 + 0.105, door.z + 0.01, 0),
  );
  // The injection unit: a carriage, the barrel in its heater bands, a nozzle into the platen.
  // The bands glow brighter while it injects.
  const ux = { x0: platens[1] + 0.06, x1: hw - 0.6 };
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
    ).name = 'heat';
  // The hopper over the barrel's back: a throat on the barrel up into a clear cone and drum, the
  // pellets poured in (red to begin with), a lid hinged at its back.
  const { x: hx, y: hy } = hopper;
  cbox(g, gunmetal(), hx, axis.y + 0.03, axis.z, 0.16, 0.05, 0.16, 0.01);
  can(g, steel(), hx, (axis.y + 0.05 + hy + 0.06) / 2, axis.z, 0.05, hy + 0.01 - axis.y, 16);
  can(g, glass(), hx, hy + 0.15, axis.z, 0.06, 0.2, 32, 0.17);
  can(g, glass(), hx, hy + 0.37, axis.z, 0.17, 0.24, 32);
  const pellets = new THREE.Group();
  pellets.name = 'pellets';
  g.add(pellets);
  const red = plastic(SPORT.red);
  can(pellets, red, hx, hy + 0.2, axis.z, 0.06, 0.12, 24, 0.13);
  can(pellets, red, hx, hy + 0.34, axis.z, 0.15, 0.16, 24);
  can(g, steel(), hx, hy + 0.25, axis.z, 0.175, 0.025, 32);
  const lid = new THREE.Group();
  lid.name = 'lid';
  lid.position.set(hx, hy + 0.5, axis.z - 0.18);
  g.add(lid);
  can(lid, charcoal(), 0, 0, 0.18, 0.18, 0.03, 32);
  cbox(lid, steel(), 0, 0.025, 0.355, 0.06, 0.02, 0.05, 0.006);
  // The housing at the right end: motor and controls, a lit panel on its front with a progress
  // bar under its screen, and its buttons: the green one starts it.
  const house = { x: hw - 0.3, w: 0.56, h: 0.74 };
  const pz = hd - 0.1;
  rbox(g, yellow, house.x, top + house.h / 2, -0.02, house.w, house.h, d - 0.18, 0.07);
  cbox(g, charcoal(), house.x, top + 0.5, pz + 0.005, 0.42, 0.36, 0.02, 0.015);
  cbox(g, cyan(1.4), house.x, top + 0.58, pz + 0.017, 0.34, 0.12, 0.004, 0.004).name = 'screen';
  progressBar(g, house.x, top + 0.49, pz + 0.015, 0.32);
  for (let i = 0; i < 3; i++) {
    const [x, y] = [house.x - 0.1 + i * 0.1, top + 0.38];
    if (i === 1) pushButton(g, x, y, pz + 0.015, 0.025);
    else
      can(g, i === 2 ? paint(SPORT.red) : steel(), x, y, pz + 0.02, 0.025, 0.02, 16).rotateX(
        Math.PI / 2,
      );
  }
  for (let i = 0; i < 4; i++)
    cbox(g, dark(), house.x, top + 0.12 + i * 0.04, pz + 0.002, 0.36, 0.014, 0.006, 0.002);
  stackLight(g, house.x + 0.15, top + house.h, -0.15);
  hopperStep(g, hopper.x, PRESS.face);
  return g;
}

/**
 * The step under the press's hopper, in its bed at `x` (the bed's front at `z`), slid in out
 * of sight: a tread on two cheeks, striped yellow at its front edge, in a group named
 * `hopperStep` to slide out and stand on to pour pellets in.
 */
function hopperStep(parent: THREE.Object3D, x: number, z: number): void {
  const step = new THREE.Group();
  step.name = 'hopperStep';
  parent.add(step);
  const { w, d } = HOPPER_STEP_SIZE;
  const top = HOPPER_STEP;
  // (Its front a hair inside the bed's, slid in, but for the stripe along it.)
  const mid = z - 0.004 - d / 2;
  cbox(step, gunmetal(), x, top - 0.02, mid, w, 0.04, d, 0.006);
  for (const s of [-1, 1])
    cbox(
      step,
      charcoal(),
      x + s * (w / 2 - 0.015),
      (top - 0.04) / 2,
      mid,
      0.03,
      top - 0.04,
      d,
      0.006,
    );
  cbox(step, paint(BUS.yellow), x, top - 0.02, z, w, 0.03, 0.012, 0.003);
  for (let i = -4; i <= 4; i++)
    cbox(step, dark(), x + i * 0.05, top + 0.002, mid, 0.012, 0.004, d - 0.04, 0.002);
}

/**
 * Where the press's parts are, in its frame: its bed, the mould's middle across (over the bay
 * in the bed's front, the press's output area: see `outputSlots`), the bay and the bed's front
 * face round it, the clamp's axis and its platens, the safety door and how far it slides open,
 * and the hopper.
 */
export const PRESS = (() => {
  const { x: w, z: d } = MACHINE_SIZE.press;
  const [hw, hd] = [w / 2, d / 2];
  const bed = { y0: 0.1, y1: 0.62 };
  const mx = -hw + 0.9;
  const axis = { y: bed.y1 + 0.36, z: -0.02 };
  const ux1 = hw - 0.6;
  return {
    bed,
    mx,
    bay: { w: 3 * 0.16, step: 0.16, y0: 0.252, y1: 0.5, depth: 0.29 },
    face: hd - 0.04,
    axis,
    /** The moving platen's middle and the fixed one's. */
    platens: [mx - 0.32, mx + 0.32] as const,
    /** How far the moving platen draws back to open the mould. */
    open: 0.12,
    door: {
      z: hd - 0.08,
      y0: bed.y1 + 0.05,
      y1: bed.y1 + 0.74,
      x0: -hw + 0.5,
      x1: mx + 0.44,
      slide: 0.68,
    },
    hopper: { x: ux1 - 0.12, y: axis.y + 0.18 },
  };
})();

// ---------------------------------------------------------------------------------------------
// The UV printer.

/**
 * A desk printer for bricks, in the off-roader's lime: a stand on charcoal legs, the cabinet with
 * a cyan stripe, its bed ruled in a grid for the part to print on, towers at its ends holding the
 * gantry over the bed's back, the print head parked on it with its UV lamp glowing violet
 * underneath, ink bottles on the left tower and a little screen on the right.
 */
export function buildUVPrinter(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'printer';
  const { x: w, y: h, z: d } = MACHINE_SIZE.printer;
  const [hw, hd] = [w / 2, d / 2];
  const lime = paint(CAR.lime);
  const { stand, cab, bed, tower, gantry } = PRINTER;
  // The stand: legs, feet and a shelf.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      rbox(g, charcoal(), sx * (hw - 0.08), stand / 2, sz * (hd - 0.08), 0.06, stand, 0.06, 0.015);
      cbox(g, gunmetal(), sx * (hw - 0.08), 0.01, sz * (hd - 0.08), 0.1, 0.02, 0.1, 0.006);
    }
  cbox(g, charcoal(), 0, 0.18, 0, w - 0.1, 0.03, d - 0.1, 0.008);
  bucket(g, BRICKS[2]!, -0.3, 0.195, 0);
  // The cabinet, its stripe, and the bed on top.
  rbox(g, lime, 0, (cab.y0 + cab.y1) / 2, 0, w, cab.y1 - cab.y0, d, 0.05);
  cbox(g, cyan(), 0, cab.y0 + 0.03, hd + 0.002, w - 0.12, 0.012, 0.006, 0.003);
  cbox(g, charcoal(), 0, cab.y0 + 0.12, hd + 0.003, 0.5, 0.08, 0.008, 0.006);
  BRICKS.forEach((c, i) =>
    cbox(g, plastic(c), -0.16 + i * 0.08, cab.y0 + 0.12, hd + 0.009, 0.05, 0.04, 0.004, 0.002),
  );
  const bx = (bed.x0 + bed.x1) / 2;
  const bz = (bed.z0 + bed.z1) / 2;
  cbox(g, gunmetal(), bx, bed.y, bz, bed.x1 - bed.x0, 0.012, bed.z1 - bed.z0, 0.004);
  for (let x = bed.x0 + 0.1; x < bed.x1 - 0.05; x += 0.1)
    cbox(g, dark(), x, bed.y + 0.007, bz, 0.004, 0.002, bed.z1 - bed.z0 - 0.02, 0.001);
  for (let z = bed.z0 + 0.1; z < bed.z1 - 0.05; z += 0.1)
    cbox(g, dark(), bx, bed.y + 0.007, z, bed.x1 - bed.x0 - 0.02, 0.002, 0.004, 0.001);
  anchor(g, 'bed', bed.part.x, bed.y + 0.006, bed.part.z);
  // The towers at its ends, rails along their tops, and the gantry riding on them over the bed,
  // parked at its back: it runs forward and back over the bed as it prints, the head across it.
  for (const sx of [-1, 1]) {
    const x = sx * (hw - tower.w / 2 - 0.02);
    rbox(g, lime, x, cab.y1 + tower.h / 2, tower.z, tower.w, tower.h, tower.d, 0.04);
    cbox(g, steel(), sx * gantry.rail, h + 0.006, tower.z, 0.02, 0.012, tower.d - 0.06, 0.003);
  }
  const rig = new THREE.Group();
  rig.name = 'gantry';
  rig.position.z = gantry.z;
  g.add(rig);
  const gy = gantry.y;
  for (const sx of [-1, 1])
    cbox(rig, charcoal(), sx * gantry.rail, h + 0.03, 0, 0.05, 0.036, 0.1, 0.008);
  rbox(rig, gunmetal(), 0, gy, 0, 2 * gantry.rail + 0.04, 0.06, 0.08, 0.02);
  cbox(rig, steel(), 0, gy - 0.035, 0.04, 2 * gantry.rail - 0.04, 0.015, 0.015, 0.004);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.x = gantry.park;
  rig.add(head);
  rbox(head, charcoal(), 0, gy - 0.07, 0.07, 0.14, 0.12, 0.12, 0.03);
  cbox(head, glow(0x9a6bff, 2.6), 0, gy - 0.135, 0.07, 0.1, 0.01, 0.09, 0.004).name = 'uv';
  // The lamp's light down onto the bed, seen only while it prints.
  const beam = mat(0x9a6bff, {
    mottle: 'none',
    emissive: 0x9a6bff,
    emissiveIntensity: 1.5,
    transparent: true,
    opacity: 0.22,
  });
  const reach = gy - 0.14 - PRINTER.bed.y;
  const ray = cbox(head, beam, 0, gy - 0.14 - reach / 2, 0.07, 0.09, reach, 0.08, 0.002);
  ray.name = 'uvBeam';
  ray.castShadow = false;
  ray.visible = false;
  cbox(head, cyan(1.4), 0, gy - 0.05, 0.131, 0.1, 0.01, 0.004, 0.002);
  // Ink bottles on the left tower; a little screen with a progress bar, and the start button,
  // on the right.
  const lx = -hw + tower.w / 2 + 0.02;
  [0x2fd0e8, 0xe83fa0, BUS.yellow, 0x15181a].forEach((c, i) => {
    const z = -0.2 + i * 0.1;
    can(g, glass(), lx, h + 0.06, z, 0.035, 0.12, 16);
    can(g, plastic(c), lx, h + 0.045, z, 0.03, 0.08, 16);
    can(g, charcoal(), lx, h + 0.13, z, 0.02, 0.02, 12);
  });
  const rx = hw - tower.w / 2 - 0.02;
  const face = tower.z + tower.d / 2;
  // The screen's panel stands a little proud of the tower, its face clear of the tower's.
  const panel = face + 0.005;
  cbox(g, charcoal(), rx, cab.y1 + tower.h * 0.6, panel - 0.01, 0.16, 0.12, 0.02, 0.01);
  cbox(
    g,
    cyan(1.4),
    rx,
    cab.y1 + tower.h * 0.6 + 0.01,
    panel + 0.002,
    0.13,
    0.07,
    0.004,
    0.004,
  ).name = 'screen';
  progressBar(g, rx, cab.y1 + tower.h * 0.6 - 0.034, panel, 0.11);
  pushButton(g, rx, cab.y1 + tower.h * 0.2, face, 0.025);
  return g;
}

/**
 * Where the printer's parts are, in its frame: the stand, the cabinet on it, the bed (and the
 * part's place on it), the towers at its ends, and the gantry: how high its bar is, where it is
 * parked and how far forward it runs, the rails it runs on, and where the head waits along it.
 */
export const PRINTER = (() => {
  const { x: w, y: h, z: d } = MACHINE_SIZE.printer;
  const [hw, hd] = [w / 2, d / 2];
  const stand = 0.62;
  const cab = { y0: stand, y1: stand + 0.22 };
  const bed = { y: cab.y1 + 0.005, x0: -hw + 0.24, x1: hw - 0.24, z0: -hd + 0.18, z1: hd - 0.06 };
  const tower = { w: 0.2, h: h - cab.y1, z: -0.04, d: d - 0.14 };
  return {
    stand,
    cab,
    bed: {
      ...bed,
      part: { x: (bed.x0 + bed.x1) / 2 + 0.05, z: (bed.z0 + bed.z1) / 2 + 0.05 },
    },
    tower,
    gantry: {
      y: h + 0.07,
      z: bed.z0 + 0.06,
      /** How far forward of where it is parked it runs as it prints. */
      reach: 0.36,
      rail: hw - tower.w - 0.02 + 0.025,
      park: bed.x0 + 0.2,
    },
  };
})();

/** Each machine's own builder, by the game's name for its kind. */
export const MACHINE_MODELS = {
  silo: buildSilo,
  press: buildBrickPress,
  dispenser: buildMouldVendor,
  printer: buildUVPrinter,
};

/** Where a machine stands: its kind, its middle on the ground, and the way its front faces. */
export interface MachinePlace {
  kind: keyof typeof MACHINE_MODELS;
  x: number;
  z: number;
  /** Its turn about the upright: its front (+z) turned toward (sin, cos) of this. */
  facing: number;
}

/** How far a machine's pad reaches out past its sides and back, and before its front. */
const PAD_MARGIN = { side: 0.3, back: 0.25, front: 0.95 };

/**
 * A machine's own pad, in the machine's frame (front +z): concrete under it and out before its
 * front, a yellow line across where its user stands, hazard chevrons along its front edge, and a
 * strip of cyan light under that edge.
 */
export function machinePad(size: { x: number; z: number }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pad';
  const w = size.x + 2 * PAD_MARGIN.side;
  const z0 = -size.z / 2 - PAD_MARGIN.back;
  const z1 = size.z / 2 + PAD_MARGIN.front;
  const concrete = mat(0x9a9c9c, { mottle: 'plastic', roughness: 0.85 });
  cbox(g, concrete, 0, PAD / 2, (z0 + z1) / 2, w, PAD, z1 - z0, 0.01);
  cbox(g, paint(BUS.yellow), 0, PAD + 0.001, size.z / 2 + 0.3, w - 0.3, 0.002, 0.08, 0.001);
  for (let x = -w / 2 + 0.25; x < w / 2 - 0.2; x += 0.3)
    cbox(g, charcoal(), x, PAD + 0.001, z1 - 0.08, 0.14, 0.002, 0.1, 0.001, [0, 0.6, 0]);
  cbox(g, cyan(1.4), 0, PAD - 0.012, z1 - 0.004, w - 0.1, 0.008, 0.006, 0.002);
  return g;
}

/**
 * The brick works: each machine where `places` says, turned its way, on a pad of its own (named
 * 'pad', turned with it), the machines named for their kinds.
 */
export function buildBrickWorks(places: MachinePlace[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'brickWorks';
  for (const { kind, x, z, facing } of places) {
    const size = MACHINE_SIZE[kind];
    const pad = machinePad(size);
    pad.position.set(x, 0, z);
    pad.rotation.y = facing;
    root.add(pad);
    const m = MACHINE_MODELS[kind]();
    m.position.set(x, PAD, z);
    m.rotation.y = facing;
    root.add(m);
  }
  return root;
}

/** How thick the brick works' pad is: the machines stand on it. */
export const PAD = 0.04;
