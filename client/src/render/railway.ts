import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, box, mat, metal } from './interiors.ts';
import { Surface, madeOf } from './styles.ts';

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
/** How far apart a track's sleepers are, centre to centre, and at least how far in the first is from its end. */
const SLEEPER_PITCH = 0.8;
const SLEEPER_IN = 0.4;
/** A sleeper's width along the track and its depth, all but its top bedded in the ballast. */
const SLEEPER = { w: 0.24, h: 0.09, proud: 0.035 };
/** How far in from a track bed's edges its top starts, the rails stopping there (the map's `TRACK_BED.toe`). */
const BALLAST_TOE = 0.25;
/** The steel base plate under a rail on each sleeper, as wide across as the rail's box. */
const BASE_PLATE = { w: 0.2, h: 0.012 };
/** A rail's foot, across. */
const RAIL_W = 0.08;

/** Where along a track `len` long (centred on 0) its sleepers lie, evenly from end to end: the same for its bed and rails. */
function sleepersAlong(len: number): number[] {
  const n = Math.max(1, Math.floor((len - 2 * SLEEPER_IN) / SLEEPER_PITCH) + 1);
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * SLEEPER_PITCH);
}

/**
 * A track's bed, its box `w` long along x: ballast heaped up off the ground with its shoulders
 * sloping down to the box's sides at the ground, and the sleepers across it bedded in its top,
 * which are the box's top. The bed ends in slopes too.
 */
export function ballast(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const stones = mat(colour, 1);
  const top = h - SLEEPER.proud;
  // A bed with its shoulders and ends sloping down to the box's edges at the ground.
  const toe = BALLAST_TOE;
  const geo = new THREE.BoxGeometry(w, top, d);
  const at = geo.getAttribute('position');
  for (let i = 0; i < at.count; i++)
    if (at.getY(i) > 0) {
      at.setX(i, at.getX(i) - Math.sign(at.getX(i)) * toe);
      at.setZ(i, at.getZ(i) - Math.sign(at.getZ(i)) * toe);
    }
  geo.computeVertexNormals();
  const bed = add(g, geo, stones, 0, -h / 2 + top / 2, 0);
  bed.castShadow = false;
  // A scatter of darker stones on top, so it reads as ballast rather than a slab.
  const dark = mat(shade(colour, 0.72), 1);
  const light = mat(shade(colour, 1.18), 1);
  let seed = Math.round(w * 977 + d * 131);
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pebble = new THREE.DodecahedronGeometry(0.035, 0);
  for (let i = 0; i < w * 14; i++) {
    const p = add(
      g,
      pebble,
      rnd() < 0.5 ? dark : light,
      (rnd() - 0.5) * (w - 2 * toe - 0.1),
      -h / 2 + top - 0.01,
      (rnd() - 0.5) * (d - 2 * toe - 0.1),
    );
    p.scale.set(0.6 + rnd(), 0.5, 0.6 + rnd());
    p.castShadow = false;
  }
  // The sleepers, their tops level with the box's.
  const timber = mat(0x5e4a36, 0.9);
  for (const x of sleepersAlong(w))
    box(g, SLEEPER.w, SLEEPER.h, d - 2 * toe - 0.1, x, h / 2 - SLEEPER.h / 2, 0, timber);
}

/**
 * A rail, its box `w` long along x standing on the sleepers: a flat-bottomed rail (foot, web
 * and head) on a steel base plate on every sleeper, clipped down either side.
 */
export function trackRail(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
): void {
  const steel = mat(colour, 0.45, 0.5);
  const bright = metal(0xa9adb1);
  const bottom = -h / 2;
  const plate = BASE_PLATE.h;
  const foot = 0.016;
  const head = 0.034;
  const web = h - plate - foot - head;
  // (The rail itself is `RAIL_W` across; the box is as wide as its base plates.)
  box(g, w, foot, RAIL_W, 0, bottom + plate + foot / 2, 0, steel);
  box(g, w, web, RAIL_W * 0.3, 0, bottom + plate + foot + web / 2, 0, steel);
  box(g, w, head - 0.006, RAIL_W * 0.62, 0, h / 2 - head / 2 - 0.003, 0, steel);
  // The running surface, polished by the wheels.
  box(g, w, 0.006, RAIL_W * 0.5, 0, h / 2 - 0.003, 0, bright);
  const dark = mat(0x2a2826, 0.6);
  // (The rail stops short of its bed's ends, so its sleepers are the bed's.)
  for (const x of sleepersAlong(w + 2 * BALLAST_TOE)) {
    box(g, BASE_PLATE.w, plate, d, x, bottom + plate / 2, 0, dark);
    for (const s of [-1, 1])
      box(g, 0.05, 0.03, 0.03, x, bottom + plate + 0.015, s * (RAIL_W / 2 + 0.025), dark);
  }
}

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
 * hub's face looks to; `centre` is the colour its centre is painted, or what it is made of.
 */
export function railWheel(
  g: THREE.Object3D,
  r: number,
  x: number,
  y: number,
  z: number,
  out: number,
  centre: number | THREE.Material,
  thick = 0.1,
): void {
  const steel = metal(0x8f969c);
  const paint = typeof centre === 'number' ? mat(centre, 0.55) : centre;
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
  railWheel(
    g,
    r,
    0,
    bottom + r + 0.01,
    front + 0.13,
    -1,
    madeOf(mat(0x2b2d30, 0.55), Surface.Metal),
    0.1,
  );
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
  // Six coupled wheels on the rails (their gauge, the map's), the coupling rods outside them
  // between their crank pins, and the cylinders ahead.
  const wheelR = 0.45;
  const wheels = [1.7, 3, 4.3];
  const gauge = 1.1;
  for (const s of [-1, 1]) {
    for (const wx of wheels)
      railWheel(g, wheelR, X(wx), bottom + wheelR, s * (gauge - 0.02), s, colour, 0.12);
    box(g, 2.75, 0.07, 0.04, X(3), bottom + wheelR - 0.16, s * (gauge + 0.2), steel);
    for (const wx of wheels)
      lyingZ(g, 0.035, 0.12, X(wx), bottom + wheelR - 0.16, s * (gauge + 0.12), steel, 10);
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
  // Wheels on the rails, on axles held in W-irons under the solebars, which carry the body
  // and run over the axleboxes, wide of it: the rails are wider apart than the body. The body
  // stands high enough over the rails (the map's `WAGON_DECK`) for the wheels to turn under
  // the solebars.
  const r = 0.3;
  const gauge = 1.1;
  // The rails' tops, which the wheels stand on, the flanges just inside them.
  const railTop = deck - 0.75;
  const axle = railTop + r;
  const sole = gauge + 0.15;
  const soleH = 0.12;
  for (const s of [-1, 1]) box(g, w - 0.1, soleH, 0.08, 0, deck - soleH / 2, s * sole, iron);
  // Headstocks across the ends, solebar to solebar, and the floor out to them under the body.
  for (const s of [-1, 1])
    box(g, 0.12, 0.22, 2 * sole + 0.08, s * (w / 2 - 0.06), deck - 0.11, 0, iron);
  box(g, w - 0.24, 0.03, 2 * sole - 0.08, 0, deck - 0.015, 0, dark);
  for (const x of [-1.3, 1.3]) {
    lyingZ(g, 0.04, 2 * sole, x, axle, 0, iron, 10);
    for (const s of [-1, 1]) {
      railWheel(g, r, x, axle, s * (gauge - 0.02), s, IRON, 0.1);
      // The axlebox, and the leaf spring over it up against the solebar.
      const boxTop = axle + 0.08;
      box(g, 0.16, 0.16, 0.09, x, axle, s * sole, iron);
      const leaves = 3;
      const leaf = (deck - soleH - boxTop) / leaves;
      for (let i = 0; i < leaves; i++)
        box(g, 0.62 - i * 0.14, leaf, 0.07, x, boxTop + leaf * (i + 0.5), s * sole, iron);
      // The spring's ends hung from the solebar by shackles.
      for (const k of [-1, 1])
        box(
          g,
          0.03,
          deck - soleH - boxTop,
          0.05,
          x + k * 0.3,
          (deck - soleH + boxTop) / 2,
          s * sole,
          iron,
        );
      // The W-iron: two legs from the solebar down either side of the axlebox.
      for (const k of [-1, 1]) {
        const top = { x: x + k * 0.28, y: deck - soleH };
        const foot = { x: x + k * 0.09, y: axle - 0.08 };
        const len = Math.hypot(top.x - foot.x, top.y - foot.y);
        const leg = box(
          g,
          0.04,
          len,
          0.05,
          (top.x + foot.x) / 2,
          (top.y + foot.y) / 2,
          s * (sole + 0.065),
          iron,
        );
        leg.rotation.z = Math.atan2(top.x - foot.x, top.y - foot.y) * -1;
      }
      box(g, 0.22, 0.03, 0.05, x, axle - 0.095, s * (sole + 0.065), iron);
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
  // The brake lever along one side, white tipped: pivoted on a bracket under the solebar at
  // one end, and held in its guide, which hangs from the solebar too, at the other.
  const out = -(sole + 0.055);
  const pivot = { x: -0.35, y: deck - soleH - 0.14 };
  const tip = { x: 0.75, y: deck - soleH - 0.06 };
  const len = Math.hypot(tip.x - pivot.x, tip.y - pivot.y);
  const lever = box(
    g,
    len,
    0.04,
    0.03,
    (pivot.x + tip.x) / 2,
    (pivot.y + tip.y) / 2,
    out - 0.03,
    iron,
  );
  lever.rotation.z = Math.atan2(tip.y - pivot.y, tip.x - pivot.x);
  box(g, 0.15, 0.045, 0.035, tip.x - 0.06, tip.y - 0.005, out - 0.03, mat(0xf2f2f2, 0.6));
  box(
    g,
    0.05,
    deck - soleH - pivot.y + 0.02,
    0.03,
    pivot.x,
    (deck - soleH + pivot.y) / 2,
    out,
    iron,
  );
  lyingZ(g, 0.025, 0.08, pivot.x, pivot.y, out - 0.02, iron, 8);
  box(g, 0.03, 0.12, 0.03, tip.x - 0.2, deck - soleH - 0.06, out, iron);
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
 * A cast-iron box stove: short feet, a plinth, the firebox with a moulded top plate, the door
 * on its front with the fire glowing through its glass, and the flue collar up from the top to
 * where the flue pipe (which collides as a box of its own) carries on to the ceiling.
 */
export function stove(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const iron = mat(colour, 0.5, 0.4);
  const dark = mat(shade(colour, 0.7), 0.6, 0.3);
  const bottom = -h / 2;
  const legH = 0.1;
  const W = w - 0.1;
  const D = d - 0.12;
  // The feet, under the plinth's corners.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      box(
        g,
        0.07,
        legH + 0.01,
        0.07,
        sx * (W / 2 - 0.05),
        bottom + legH / 2 + 0.005,
        sz * (D / 2 - 0.05),
        iron,
      );
  // The plinth, a little wider than the firebox on it.
  const plinth = 0.05;
  box(g, W + 0.02, plinth, D + 0.02, 0, bottom + legH + plinth / 2, 0, iron);
  // The firebox, its top plate standing out round it.
  const boxBottom = bottom + legH + plinth - 0.005;
  const boxH = 0.62;
  const boxTop = boxBottom + boxH;
  box(g, W, boxH, D, 0, boxBottom + boxH / 2, 0, iron);
  const plate = 0.04;
  box(g, W + 0.04, plate, D + 0.04, 0, boxTop + plate / 2 - 0.005, 0, iron);
  // The door on the front: a frame proud of the firebox, the glass glowing in it, a handle.
  const doorW = W * 0.72;
  const doorH = boxH * 0.68;
  const doorY = boxBottom + boxH * 0.47;
  const front = -D / 2;
  box(g, doorW, doorH, 0.03, 0, doorY, front - 0.005, dark);
  // Smoky glass, the embers along its bottom and flames licking up from them.
  const glassW = doorW - 0.1;
  const glassH = doorH - 0.1;
  const glassFront = front - 0.03;
  box(g, glassW, glassH, 0.012, 0, doorY, front - 0.024, mat(0x2a160c, 0.2, 0, 0x3a1606));
  const glassBottom = doorY - glassH / 2;
  box(
    g,
    glassW - 0.02,
    0.05,
    0.004,
    0,
    glassBottom + 0.035,
    glassFront - 0.003,
    mat(0xff5a10, 0.4, 0, 0xd8400a),
  );
  for (const [x, fh, c] of [
    [-0.09, 0.12, 0xff8a1e],
    [-0.02, 0.19, 0xffb03a],
    [0.05, 0.15, 0xff8a1e],
    [0.11, 0.09, 0xff7015],
  ] as const)
    box(g, 0.045, fh, 0.004, x, glassBottom + 0.06 + fh / 2, glassFront - 0.004, mat(c, 0.4, 0, c));
  box(g, 0.03, 0.12, 0.03, doorW / 2 - 0.04, doorY, front - 0.04, metal(BRASS));
  // The air vent under the door.
  box(g, doorW * 0.6, 0.03, 0.012, 0, boxBottom + 0.05, front - 0.004, dark);
  // The flue collar, from the top plate up to where the pipe carries on.
  const collarY0 = boxTop + plate - 0.01;
  add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.04, 20), iron, 0, collarY0 + 0.02, 0);
  const pipeH = h / 2 - (collarY0 + 0.03);
  // Open-ended, so it meets the flue pipe end to end with no caps lying on each other.
  const pipe = new THREE.CylinderGeometry(0.07, 0.07, pipeH, 16, 1, true);
  add(g, pipe, iron, 0, collarY0 + 0.03 + pipeH / 2, 0);
}

/** A flue pipe: a round iron pipe up its box, with a collar where it leaves the stove. */
export function flue(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const iron = mat(colour, 0.5, 0.4);
  const r = Math.min(w, d) / 2 - 0.01;
  add(g, new THREE.CylinderGeometry(r, r, h, 14), iron, 0, 0, 0);
  add(g, new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.06, 14), iron, 0, -h / 2 + 0.05, 0);
  add(g, new THREE.CylinderGeometry(r + 0.015, r + 0.015, 0.05, 14), iron, 0, h / 2 - 0.4, 0);
}
