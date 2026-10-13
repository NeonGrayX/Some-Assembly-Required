import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, box, mat, metal } from './interiors.ts';

/**
 * Platform 9's railway models: the tank engine, the carriages' running gear, roofs and
 * gangways, the goods wagon on the siding, the water tower's tank and the waiting room's
 * stove. Like the other props (see `props.ts`) each is built in a frame centred on its box,
 * local -z its front, `w` wide (x), `h` high and `d` deep (z).
 */

const shade = (colour: number, f: number) => new THREE.Color(colour).multiplyScalar(f).getHex();

const IRON = 0x1f1f1f;
const BRASS = 0xc9a13b;
const BUFFER_RED = 0x8a2f2f;
/** The top of a rail above the ground (see `station.ts`'s track), which wheels stand on. */
const RAIL_TOP = 0.07;

/** A cylinder of radius `r` and length `len` lying along x, centred at `x, y, z`. */
function lyingX(
  g: THREE.Object3D,
  r: number,
  len: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  segments = 20,
  r1 = r,
): THREE.Mesh {
  const m = add(g, new THREE.CylinderGeometry(r1, r, len, segments), material, x, y, z);
  m.rotation.z = -Math.PI / 2;
  return m;
}

/** A cylinder of radius `r`, `len` thick, lying along z (a wheel's axle), centred at `x, y, z`. */
function lyingZ(
  g: THREE.Object3D,
  r: number,
  len: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  segments = 20,
): THREE.Mesh {
  const m = add(g, new THREE.CylinderGeometry(r, r, len, segments), material, x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

/**
 * A railway wheel seen from outside, its axle along z: a steel tyre with the flange behind it
 * on the rail side, spokes from the hub and a balance weight. `out` is +1 or -1, the side the
 * hub's face looks to.
 */
export function railWheel(
  g: THREE.Object3D,
  r: number,
  x: number,
  y: number,
  z: number,
  out: number,
  centre = 0x2b2d30,
  thick = 0.1,
): void {
  const steel = metal(0x8f969c);
  const paint = mat(centre, 0.55);
  // Along the axle from `z`, outwards: the flange (a little bigger, on the rail side), the
  // tyre, then the painted centre standing a centimetre proud of the tyre either side, the
  // spokes and the hub on its face, and the axle's end.
  const at = (from: number, to: number) => z + out * ((from + to) / 2);
  lyingZ(g, r + 0.035, thick * 0.4, x, y, at(-0.5 * thick, -0.1 * thick), steel, 24);
  lyingZ(g, r, thick * 0.6, x, y, at(-0.1 * thick, 0.5 * thick), steel, 24);
  lyingZ(
    g,
    r * 0.86,
    thick * 0.6 + 0.02,
    x,
    y,
    at(-0.1 * thick - 0.01, 0.5 * thick + 0.01),
    paint,
    24,
  );
  const face = 0.5 * thick + 0.01;
  const spokes = r > 0.35 ? 12 : 8;
  for (let i = 0; i < spokes; i++) {
    const spoke = box(g, r * 0.72, 0.035, 0.02, x, y, at(face, face + 0.02), paint);
    spoke.rotation.z = (i * Math.PI) / spokes;
  }
  lyingZ(g, r * 0.2, 0.05, x, y, at(face, face + 0.05), paint, 14);
  lyingZ(g, r * 0.1, 0.06, x, y, at(face + 0.03, face + 0.09), steel, 10);
}

/**
 * A carriage's running gear on one side, for one axle: the wheel outside the frame, the
 * W-iron (axle guard) it runs in, the axlebox and the leaf spring over it, hung off a length
 * of solebar. Its outside face is the front (local -z).
 */
export function axleUnit(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const iron = mat(colour, 0.6);
  const bottom = -h / 2;
  const r = Math.min(h * 0.45, w / 2 - 0.02);
  const front = -d / 2;
  // The solebar along the top, the W-iron down from it either side of the axle.
  box(g, w, 0.1, d * 0.5, 0, h / 2 - 0.05, d / 4, iron);
  for (const s of [-1, 1]) {
    const leg = box(
      g,
      0.05,
      h * 0.55,
      d * 0.4,
      s * r * 0.55,
      h / 2 - 0.1 - h * 0.25,
      d * 0.25,
      iron,
    );
    leg.rotation.z = s * 0.35;
  }
  railWheel(g, r, 0, bottom + r + 0.01, front + 0.13, -1, 0x2b2d30, 0.1);
  // The axlebox on the axle's end, and the leaf spring over it with its hangers.
  box(g, 0.16, 0.18, 0.06, 0, bottom + r + 0.01, front + 0.2, iron);
  for (let i = 0; i < 4; i++)
    box(g, w * 0.7 - i * 0.1, 0.022, 0.08, 0, bottom + r + 0.12 + i * 0.024, front + 0.2, iron);
  for (const s of [-1, 1])
    box(g, 0.03, 0.14, 0.04, s * (w * 0.35 - 0.02), h / 2 - 0.17, front + 0.2, iron);
}

/**
 * A carriage's roof: a shallow arch from cantrail to cantrail, its ends rounded down, with
 * gutters along the sides, a row of ventilators down the middle and the oil-lamp tops. Its
 * flat bottom is the carriage's ceiling.
 */
export function carriageRoof(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
): void {
  const roof = mat(colour, 0.85);
  const dark = mat(shade(colour, 0.7), 0.8);
  const bottom = -h / 2;
  // The eaves board all round, then the arch over it in slices that step in at the ends.
  const eave = 0.08;
  box(g, w, eave, d, 0, bottom + eave / 2, 0, dark);
  const rise = h - eave - 0.13;
  const arch = new THREE.Shape();
  const half = d / 2 - 0.01;
  arch.moveTo(-half, 0);
  arch.lineTo(half, 0);
  arch.quadraticCurveTo(half * 0.95, rise * 1.2, 0, rise);
  arch.quadraticCurveTo(-half * 0.95, rise * 1.2, -half, 0);
  const endIn = 0.1;
  const len = w - 2 * endIn;
  const body = add(
    g,
    new THREE.ExtrudeGeometry(arch, { depth: len, bevelEnabled: false, curveSegments: 10 }),
    roof,
    -len / 2,
    bottom + eave,
    0,
  );
  body.rotation.y = Math.PI / 2;
  // The rounded ends: the same arch, lower, over the last bit of each end.
  const low = new THREE.Shape();
  low.moveTo(-half + 0.04, 0);
  low.lineTo(half - 0.04, 0);
  low.quadraticCurveTo(half * 0.9, rise * 0.85, 0, rise * 0.7);
  low.quadraticCurveTo(-half * 0.9, rise * 0.85, -half + 0.04, 0);
  for (const s of [-1, 1]) {
    const end = add(
      g,
      new THREE.ExtrudeGeometry(low, {
        depth: endIn - 0.01,
        bevelEnabled: false,
        curveSegments: 10,
      }),
      roof,
      s > 0 ? len / 2 : -w / 2 + 0.01,
      bottom + eave,
      0,
    );
    end.rotation.y = Math.PI / 2;
  }
  // Gutters along the cantrails.
  for (const s of [-1, 1])
    box(g, len - 0.02, 0.04, 0.05, 0, bottom + eave + 0.02, s * (d / 2 - 0.025), dark);
  // Torpedo ventilators and lamp tops along the ridge.
  const vents = Math.max(2, Math.round(w / 1.4));
  for (let i = 0; i < vents; i++) {
    const x = -len / 2 + (len * (i + 0.5)) / vents;
    const top = bottom + eave + rise;
    if (i % 2) {
      lyingX(g, 0.06, 0.32, x, top + 0.04, 0, mat(0x6b6b6b, 0.5, 0.3), 12);
      box(g, 0.08, 0.06, 0.06, x, top + 0.0, 0, dark);
    } else {
      add(
        g,
        new THREE.CylinderGeometry(0.06, 0.09, 0.08, 12),
        mat(0x4a4a4a, 0.5, 0.3),
        x,
        top + 0.02,
        0,
      );
      add(
        g,
        new THREE.CylinderGeometry(0.02, 0.06, 0.05, 12),
        mat(0x4a4a4a, 0.5, 0.3),
        x,
        top + 0.085,
        0,
      );
    }
  }
}

/**
 * The flexible gangway between two carriages, seen from one side: concertina folds of black
 * canvas filling the joint, from the solebar to the roof.
 */
export function gangway(g: THREE.Object3D, w: number, h: number, d: number): void {
  const canvas = mat(0x1d1d1f, 0.95);
  const fold = mat(0x262628, 0.95);
  box(g, w * 0.7, h, d * 0.6, 0, 0, d * 0.2, canvas);
  const n = Math.max(2, Math.floor(h / 0.08));
  for (let i = 0; i < n; i++)
    box(g, w, 0.03, d * 0.4, 0, -h / 2 + 0.05 + (i * (h - 0.1)) / (n - 1), -d * 0.2, fold);
}

/** A strip of livery along a carriage's side: lining, a waist band or the solebar valance. */
export function livery(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  box(g, w, h, d, 0, 0, 0, mat(colour, 0.5));
}

/**
 * The tank engine, standing on its box (the frames and running plate, `w` long along x with
 * its chimney end towards +x): six coupled wheels with their rods, side tanks along the boiler,
 * the smokebox, chimney, dome and safety valves, the cab at the back with its spectacle
 * windows and roof, and buffer beams at both ends. The boiler, cab, chimney and buffers
 * collide as boxes of their own (`collider`), which this stands in.
 */
export function locomotive(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
): void {
  const green = mat(colour, 0.45);
  const black = mat(0x18191b, 0.6);
  const red = mat(BUFFER_RED, 0.55);
  const brass = metal(BRASS);
  const steel = metal(0x9aa0a6);
  const lining = mat(0xd9b44a, 0.5);
  const bottom = -h / 2;
  const plate = h / 2;
  const x0 = -w / 2;
  // In the engine's own measures: x from the cab's back (0) to the front buffer beam (5).
  const X = (x: number) => x0 + x;
  // The frames between the wheels, and the running plate over them with its red valance.
  for (const s of [-1, 1])
    box(g, w - 0.4, h - 0.2, 0.06, 0, bottom + 0.1 + (h - 0.2) / 2, s * 0.95, red);
  box(g, w, 0.06, d - 0.1, 0, plate - 0.03, 0, black);
  for (const s of [-1, 1]) {
    box(g, w - 0.2, 0.14, 0.03, 0, plate - 0.13, s * (d / 2 - 0.065), red);
    box(g, w - 0.24, 0.02, 0.01, 0, plate - 0.13, s * (d / 2 - 0.045), lining);
  }
  // Six coupled wheels, the coupling rods between their crank pins, and the cylinders ahead.
  const wheelR = 0.45;
  const wheels = [1.7, 3, 4.3];
  for (const s of [-1, 1]) {
    for (const wx of wheels)
      railWheel(g, wheelR, X(wx), bottom + wheelR, s * 1.55, s, colour, 0.12);
    box(g, 2.75, 0.07, 0.04, X(3), bottom + wheelR - 0.16, s * 1.75, steel);
    for (const wx of wheels)
      lyingZ(g, 0.035, 0.16, X(wx), bottom + wheelR - 0.16, s * 1.705, steel, 10);
    // Sandboxes over the front wheels' splashers.
    box(g, 0.5, 0.18, 0.08, X(4.3), plate + 0.09, s * (d / 2 - 0.12), green);
  }
  // The cylinders under the smokebox, between the frames.
  for (const s of [-1, 1]) lyingX(g, 0.22, 0.7, X(4.75), bottom + 0.62, s * 0.6, black, 16);
  // The boiler: lagged in green with brass bands, the black smokebox in front with its round
  // door, the chimney, the brass dome and safety valves on top, handrails along the sides.
  const boilerY = plate + 0.75;
  const boilerR = 0.72;
  lyingX(g, boilerR, 2.75, X(3.18), boilerY, 0, green, 28);
  for (const bx of [2.0, 2.9, 3.8, 4.5])
    lyingX(g, boilerR + 0.01, 0.05, X(bx), boilerY, 0, brass, 28);
  lyingX(g, boilerR + 0.04, 0.45, X(4.78), boilerY, 0, black, 28);
  lyingX(g, boilerR - 0.06, 0.04, X(5.02), boilerY, 0, black, 28);
  lyingX(g, 0.05, 0.06, X(5.06), boilerY, 0, steel, 12);
  box(g, 0.04, 0.05, 0.4, X(5.07), boilerY - 0.25, 0, steel);
  const chimney = add(
    g,
    new THREE.CylinderGeometry(0.2, 0.17, 0.75, 18),
    black,
    X(4.4),
    boilerY + boilerR + 0.27,
    0,
  );
  chimney.castShadow = true;
  add(
    g,
    new THREE.CylinderGeometry(0.26, 0.26, 0.08, 18),
    black,
    X(4.4),
    boilerY + boilerR + 0.66,
    0,
  );
  add(
    g,
    new THREE.CylinderGeometry(0.28, 0.32, 0.32, 18),
    brass,
    X(3.2),
    boilerY + boilerR + 0.06,
    0,
  );
  add(
    g,
    new THREE.SphereGeometry(0.28, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    brass,
    X(3.2),
    boilerY + boilerR + 0.22,
    0,
  );
  for (const dz of [-0.09, 0.09])
    add(
      g,
      new THREE.CylinderGeometry(0.05, 0.07, 0.28, 12),
      brass,
      X(2.2),
      boilerY + boilerR + 0.12,
      dz,
    );
  add(
    g,
    new THREE.CylinderGeometry(0.025, 0.04, 0.22, 10),
    brass,
    X(1.95),
    boilerY + boilerR + 0.12,
    0,
  );
  for (const s of [-1, 1])
    lyingX(g, 0.015, 2.7, X(3.25), boilerY + 0.35, s * (boilerR + 0.06), steel, 8);
  // The side tanks along the boiler, lined out, with their filler caps.
  const tankH = 1.15;
  for (const s of [-1, 1]) {
    const tank = add(
      g,
      new RoundedBoxGeometry(2.1, tankH, 0.5, 2, 0.04),
      green,
      X(2.95),
      plate + tankH / 2,
      s * (d / 2 - 0.3),
    );
    tank.castShadow = true;
    box(g, 1.9, 0.02, 0.01, X(2.95), plate + tankH - 0.1, s * (d / 2 - 0.045), lining);
    box(g, 1.9, 0.02, 0.01, X(2.95), plate + 0.1, s * (d / 2 - 0.045), lining);
    for (const lx of [2.0, 3.9])
      box(g, 0.02, tankH - 0.2, 0.01, X(lx), plate + tankH / 2, s * (d / 2 - 0.045), lining);
    // The engine's number in brass on the tank's side.
    box(g, 0.5, 0.18, 0.012, X(2.95), plate + tankH / 2, s * (d / 2 - 0.044), brass);
    add(
      g,
      new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14),
      black,
      X(3.7),
      plate + tankH + 0.03,
      s * (d / 2 - 0.3),
    );
  }
  // The cab: front and back sheets with round spectacle windows, the sides with their cut-out
  // doorways, and an arched roof that overhangs them.
  const cabTop = plate + 2.2;
  const cabW = 1.8;
  const sheet = 0.06;
  const glass = mat(0x9fb8c4, 0.15, 0.2);
  for (const [cx, face] of [
    [X(sheet / 2), -1],
    [X(cabW - sheet / 2), 1],
  ] as const) {
    box(g, sheet, cabTop - plate, d - 0.2, cx, (plate + cabTop) / 2, 0, green);
    for (const s of [-1, 1]) {
      lyingX(g, 0.17, 0.02, cx + face * (sheet / 2 + 0.01), plate + 1.6, s * 0.75, brass, 18);
      lyingX(g, 0.13, 0.024, cx + face * (sheet / 2 + 0.012), plate + 1.6, s * 0.75, glass, 18);
    }
  }
  for (const s of [-1, 1]) {
    const z = s * (d / 2 - 0.1 - sheet / 2);
    // Below the doorway, the post behind it, and the sheet over it.
    box(g, cabW - 2 * sheet, 0.9, sheet, X(cabW / 2), plate + 0.45, z, green);
    box(g, 0.5, 2.2 - 0.9, sheet, X(cabW - sheet - 0.25), plate + 0.9 + (2.2 - 0.9) / 2, z, green);
    box(
      g,
      cabW - 2 * sheet - 0.5,
      0.35,
      sheet,
      X(sheet + (cabW - 2 * sheet - 0.5) / 2),
      cabTop - 0.175,
      z,
      green,
    );
    // The handrail by the doorway and the lining round the cab side.
    box(g, 0.025, 0.9, 0.025, X(sheet + 0.06), plate + 1.3, s * (d / 2 - 0.05), brass);
    box(g, cabW - 0.2, 0.02, 0.01, X(cabW / 2), plate + 0.8, s * (d / 2 - 0.1 + 0.005), lining);
  }
  // Inside the cab, through the doorway: the backhead with the firebox door glowing.
  box(g, 0.05, 1.1, 1.1, X(cabW - sheet - 0.03), plate + 0.85, 0, black);
  box(
    g,
    0.02,
    0.32,
    0.42,
    X(cabW - sheet - 0.065),
    plate + 0.6,
    0,
    mat(0xff7a1a, 0.4, 0, 0xc4440a),
  );
  for (const gx of [-0.25, 0.25])
    lyingX(g, 0.06, 0.03, X(cabW - sheet - 0.07), plate + 1.15, gx, brass, 12);
  const roofShape = new THREE.Shape();
  const rh = d / 2 + 0.02;
  roofShape.moveTo(-rh, 0);
  roofShape.lineTo(rh, 0);
  roofShape.quadraticCurveTo(rh * 0.9, 0.3, 0, 0.22);
  roofShape.quadraticCurveTo(-rh * 0.9, 0.3, -rh, 0);
  const cabRoof = add(
    g,
    new THREE.ExtrudeGeometry(roofShape, {
      depth: cabW + 0.2,
      bevelEnabled: false,
      curveSegments: 10,
    }),
    black,
    X(-0.1),
    cabTop,
    0,
  );
  cabRoof.rotation.y = Math.PI / 2;
  // Buffer beams at both ends: red, with sprung buffers, a coupling hook and lamps.
  for (const [bx, s] of [
    [0.07, -1],
    [w - 0.07, 1],
  ] as const) {
    box(g, 0.12, 0.42, d - 0.14, X(bx), bottom + 0.75, 0, red);
    // (The back ones are shorter: the carriage stands close behind.)
    const reach = s > 0 ? 0.36 : 0.22;
    for (const dz of [-0.75, 0.75]) {
      lyingX(
        g,
        0.07,
        reach - 0.06,
        X(bx) + s * (0.06 + (reach - 0.06) / 2),
        bottom + 0.8,
        dz,
        black,
        12,
      );
      lyingX(g, 0.17, 0.04, X(bx) + s * reach, bottom + 0.8, dz, steel, 18);
    }
    box(g, 0.2, 0.08, 0.1, X(bx) + s * 0.16, bottom + 0.72, 0, steel);
    add(
      g,
      new THREE.CylinderGeometry(0.1, 0.1, 0.16, 14),
      mat(0xe8e8e8, 0.4),
      X(bx) + s * 0.06,
      plate + 0.08,
      0.5,
    );
  }
  // The headlamp on the smokebox.
  lyingX(g, 0.12, 0.1, X(5.04), boilerY + 0.55, 0, mat(0xfff4c8, 0.2, 0, 0x8a7a50), 16);
}

/**
 * An open goods wagon, drawn round its body's box (whose top is the load a player stands
 * on): plank sides and ends with ironwork, the coal heaped level with their tops and a raised
 * headboard at the east end (which collides as a box of its own); under it, down to the
 * ground, the solebars and headstocks, four wheels on the rails `GAUGE` apart in W-irons with
 * springs, buffers and couplings at the ends, and the brake lever.
 */
export function wagon(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const wood = mat(colour, 0.85);
  const dark = mat(shade(colour, 0.7), 0.9);
  const iron = mat(IRON, 0.6);
  const deck = -h / 2;
  const top = h / 2;
  const ground = deck - 0.6;
  // The body: planked sides and ends with ironwork, and the coal level with their tops.
  const wall = 0.08;
  for (const s of [-1, 1]) {
    box(g, w, h, wall, 0, 0, s * (d / 2 - wall / 2), wood);
    box(g, wall, h, d - 2 * wall, s * (w / 2 - wall / 2), 0, 0, wood);
    for (let i = 1; i < 3; i++)
      box(g, w - 0.02, 0.012, 0.01, 0, deck + (i * h) / 3, s * (d / 2 + 0.005), dark);
    for (const x of [-1.5, -0.5, 0.5, 1.5])
      box(g, 0.06, h, 0.02, x * (w / 4), 0, s * (d / 2 + 0.01), iron);
  }
  box(g, w - 2 * wall, h - 0.05, d - 2 * wall, 0, -0.025, 0, mat(0x2a2826, 0.95));
  for (const [x, z, r] of [
    [-0.8, 0.3, 0.2],
    [0.2, -0.4, 0.25],
    [1.0, 0.2, 0.18],
    [-0.2, 0.5, 0.15],
  ] as const) {
    const lump = add(
      g,
      new THREE.DodecahedronGeometry(r, 0),
      mat(0x1c1b1a, 0.6, 0.2),
      x,
      top - 0.05,
      z,
    );
    lump.scale.y = 0.3;
  }
  // The headboard over the east end.
  box(g, 0.1, 0.5, d, w / 2 - 0.07, top + 0.25, 0, wood);
  for (const z of [-0.6, 0, 0.6])
    box(g, 0.02, 0.5, 0.06, w / 2 - 0.01, top + 0.25, z * (d / 2), iron);
  // Solebars and headstocks under the body.
  for (const s of [-1, 1]) box(g, w - 0.4, 0.18, 0.08, 0, deck - 0.09, s * (d / 2 - 0.1), iron);
  for (const s of [-1, 1]) box(g, 0.12, 0.22, d - 0.1, s * (w / 2 - 0.08), deck - 0.11, 0, iron);
  // Wheels on the rails, on axles in W-irons with springs over the axleboxes.
  const r = 0.3;
  const gauge = 1.1;
  // The wheels stand on the rails' tops, their flanges just inside them.
  const axle = ground + RAIL_TOP + r;
  for (const x of [-1.3, 1.3]) {
    lyingZ(g, 0.04, 2 * gauge - 0.2, x, axle, 0, iron, 10);
    for (const s of [-1, 1]) {
      railWheel(g, r, x, axle, s * (gauge - 0.02), s, IRON, 0.1);
      box(g, 0.16, 0.16, 0.08, x, axle, s * (gauge + 0.15), iron);
      for (let i = 0; i < 3; i++)
        box(g, 0.7 - i * 0.12, 0.02, 0.07, x, axle + 0.11 + i * 0.022, s * (gauge + 0.15), iron);
      for (const k of [-1, 1]) {
        const leg = box(
          g,
          0.04,
          deck - axle - 0.05,
          0.05,
          x + k * 0.22,
          (deck + axle) / 2,
          s * (d / 2 - 0.1),
          iron,
        );
        leg.rotation.z = k * 0.4;
      }
    }
  }
  // Buffers and three-link couplings at both ends.
  for (const s of [-1, 1]) {
    for (const dz of [-0.6, 0.6]) {
      lyingX(g, 0.05, 0.14, s * (w / 2 + 0.07), deck - 0.12, dz, iron, 12);
      lyingX(g, 0.12, 0.03, s * (w / 2 + 0.155), deck - 0.12, dz, metal(0x8f969c), 16);
    }
    box(g, 0.14, 0.05, 0.05, s * (w / 2 + 0.07), deck - 0.18, 0, iron);
  }
  // The brake lever along one side, white tipped.
  const lever = box(g, 1.2, 0.04, 0.03, 0.2, ground + 0.42, -(gauge + 0.2), iron);
  lever.rotation.z = 0.12;
  box(g, 0.15, 0.045, 0.035, 0.75, ground + 0.49, -(gauge + 0.2), mat(0xf2f2f2, 0.6));
}

/**
 * The water tower's tank: riveted iron hooped round, standing on its box's bottom, with a
 * conical lid, a float gauge down its side and the swinging spout reaching off its east side
 * (which collides as boxes of its own) with the canvas hose hanging from it.
 */
export function waterTank(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
): void {
  const iron = mat(colour, 0.55, 0.3);
  const dark = mat(IRON, 0.6);
  const r = Math.min(w, d) / 2 - 0.02;
  const bottom = -h / 2;
  const tankH = h - 0.35;
  add(g, new THREE.CylinderGeometry(r, r, tankH, 28), iron, 0, bottom + tankH / 2, 0);
  for (const y of [0.12, 0.45, 0.8, 1.1])
    if (y < tankH - 0.05)
      add(g, new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.05, 28), dark, 0, bottom + y, 0);
  // The lid: a shallow cone with a vent on top.
  add(g, new THREE.CylinderGeometry(0.06, r + 0.04, 0.3, 28), dark, 0, bottom + tankH + 0.15, 0);
  add(g, new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12), dark, 0, bottom + tankH + 0.32, 0);
  // The float gauge: a board with a pointer, on the side facing north.
  box(g, 0.12, tankH - 0.2, 0.03, 0, bottom + tankH / 2, r + 0.01, mat(0xe8e2d4, 0.7));
  box(g, 0.16, 0.04, 0.03, 0, bottom + tankH * 0.7, r + 0.035, mat(0xc0392b, 0.5));
}

/**
 * The spout off the water tower: the pipe out of the tank's side, the elbow and the leather
 * hose hanging down from it, in its own box.
 */
export function tankSpout(g: THREE.Object3D, w: number, h: number): void {
  const dark = mat(IRON, 0.6);
  const leather = mat(0x4a3220, 0.85);
  const top = h / 2 - 0.08;
  lyingX(g, 0.07, w, 0, top, 0, dark, 14);
  add(g, new THREE.SphereGeometry(0.09, 12, 8), dark, w / 2 - 0.1, top, 0);
  const hoseH = h - 0.25;
  add(
    g,
    new THREE.CylinderGeometry(0.07, 0.09, hoseH, 14),
    leather,
    w / 2 - 0.1,
    top - 0.08 - hoseH / 2,
    0,
  );
}

/**
 * A pot-bellied stove: four cast legs, the round belly with its door and a glow behind the
 * grille, the cooking top with its rim, and the flue pipe from it up to the ceiling (which
 * collides as a box of its own).
 */
export function stove(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const iron = mat(colour, 0.5, 0.4);
  const r = Math.min(w, d) / 2 - 0.04;
  const bottom = -h / 2;
  const legH = 0.18;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      box(g, 0.06, legH, 0.06, sx * r * 0.6, bottom + legH / 2, sz * r * 0.6, iron);
  add(
    g,
    new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.06, 20),
    iron,
    0,
    bottom + legH + 0.03,
    0,
  );
  const belly = add(
    g,
    new THREE.SphereGeometry(r, 20, 14),
    iron,
    0,
    bottom + legH + 0.06 + r * 0.9,
    0,
  );
  belly.scale.y = 0.95;
  const topY = bottom + legH + 0.06 + r * 1.8;
  add(
    g,
    new THREE.CylinderGeometry(r * 0.55, r * 0.75, h - (topY - bottom) - 0.06, 20),
    iron,
    0,
    (topY + h / 2 - 0.06) / 2,
    0,
  );
  add(g, new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.06, 20), iron, 0, h / 2 - 0.03, 0);
  // The door on the front, with the fire glowing through its grille.
  const doorY = bottom + legH + 0.06 + r * 0.9;
  box(g, 0.3, 0.24, 0.03, 0, doorY, -r - 0.005, iron);
  for (let i = 0; i < 4; i++)
    box(
      g,
      0.2,
      0.02,
      0.012,
      0,
      doorY - 0.06 + i * 0.04,
      -r - 0.024,
      mat(0xff7a1a, 0.4, 0, 0xc4440a),
    );
  box(g, 0.06, 0.03, 0.04, 0.1, doorY, -r - 0.035, metal(BRASS));
}

/** A flue pipe: a round iron pipe up its box, with a collar where it leaves the stove. */
export function flue(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const iron = mat(colour, 0.5, 0.4);
  const r = Math.min(w, d) / 2 - 0.01;
  add(g, new THREE.CylinderGeometry(r, r, h, 14), iron, 0, 0, 0);
  add(g, new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.06, 14), iron, 0, -h / 2 + 0.05, 0);
  add(g, new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.05, 14), iron, 0, h / 2 - 0.4, 0);
}
