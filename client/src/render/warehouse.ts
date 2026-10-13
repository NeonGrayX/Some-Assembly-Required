import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { add, box, mat, metal } from './interiors.ts';

/**
 * The builders' merchant's models: a wooden pallet, steel pallet racking with stock on its
 * shelves, a forklift, an air-conditioning unit and a roller shutter. Like the other props
 * (see `props.ts`) each is built in a frame centred on its box, local -z its front, `w` wide
 * (x), `h` high and `d` deep (z), out of parts that touch and do not overlap, so no two
 * surfaces lie in the same plane and flicker.
 */

/** A shade of `colour`: `f` < 1 darker, > 1 lighter. */
const shade = (colour: number, f: number) => new THREE.Color(colour).multiplyScalar(f).getHex();

/**
 * A pallet built as a Euro pallet is, every part resting on the one under it: five deck boards
 * along its length on three cross boards, which sit on nine blocks, which stand on three
 * bottom boards along its length. The boards at its edges and down its middle are the wide
 * ones.
 */
export function pallet(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  // Made along its longer side, then turned if its box is longer the other way.
  const long = Math.max(w, d);
  const short = Math.min(w, d);
  const part = new THREE.Group();
  if (d > w) part.rotation.y = Math.PI / 2;
  g.add(part);
  const t = 0.03;
  const wide = 0.15;
  const narrow = 0.1;
  const wood = () => mat(shade(colour, 0.88 + seed() * 0.22), 0.88);
  const dark = mat(shade(colour, 0.78), 0.9);
  const [y0, y1] = [-h / 2, h / 2];
  // Across: where the three rows of blocks and the bottom boards are (edge, middle, edge).
  const rows = [
    { z: -short / 2 + narrow / 2, w: narrow },
    { z: 0, w: wide },
    { z: short / 2 - narrow / 2, w: narrow },
  ];
  // Along: where the three columns of blocks and the cross boards over them are.
  const cols = [-long / 2 + wide / 2, 0, long / 2 - wide / 2];
  for (const r of rows) box(part, long, t, r.w, 0, y0 + t / 2, r.z, wood());
  for (const x of cols)
    for (const r of rows)
      box(part, wide, y1 - y0 - 3 * t, r.w, x, (y0 + t + y1 - 2 * t) / 2, r.z, dark);
  for (const x of cols) box(part, wide, t, short, x, y1 - 1.5 * t, 0, wood());
  // The deck: wide boards at the edges and the middle, narrow ones between, evenly apart.
  const deck = [wide, narrow, wide, narrow, wide];
  const gap = (short - deck.reduce((a, b) => a + b, 0)) / (deck.length - 1);
  let z = -short / 2;
  for (const bw of deck) {
    box(part, long, t, bw, 0, y1 - t / 2, z + bw / 2, wood());
    z += bw + gap;
  }
}

/** Cartons, paint tins and sacks standing on one shelf of a rack bay. */
function stock(
  g: THREE.Object3D,
  seed: () => number,
  x0: number,
  x1: number,
  floor: number,
  depth: number,
): void {
  const kind = Math.floor(seed() * 4);
  const room = x1 - x0;
  if (kind === 0 || room < 0.5) return;
  if (kind === 1) {
    // Cartons: a row, the odd one stacked.
    const n = Math.max(1, Math.floor(room / 0.42));
    const each = room / n;
    for (let i = 0; i < n; i++) {
      const bx = Math.min(each - 0.04, 0.4);
      const bh = 0.18 + seed() * 0.12;
      const bd = Math.min(depth - 0.06, 0.34 + seed() * 0.1);
      const cx = x0 + each * (i + 0.5);
      box(g, bx, bh, bd, cx, floor + bh / 2, 0, mat(shade(0xb08a58, 0.9 + seed() * 0.2), 0.95));
      if (seed() < 0.3 && bh < 0.22)
        box(g, bx - 0.06, 0.1, bd - 0.06, cx, floor + bh + 0.05, 0, mat(0xc29d68, 0.95));
    }
  } else if (kind === 2) {
    // Paint tins, two high, with coloured lids.
    const r = 0.075;
    const n = Math.max(1, Math.floor(room / (2 * r + 0.03)));
    const lids = [0xd7d2c8, 0xc0392b, 0x2b6cb0, 0x3b8a52];
    for (let i = 0; i < Math.min(n, 5); i++) {
      const cx = x0 + (room - Math.min(n, 5) * (2 * r + 0.03)) / 2 + r + i * (2 * r + 0.03);
      for (let row = 0; row < 2; row++) {
        const tin = new THREE.Mesh(
          new THREE.CylinderGeometry(r, r, 0.15, 12),
          mat(0xaab1b8, 0.4, 0.5),
        );
        tin.position.set(cx, floor + 0.075 + row * 0.15, 0);
        tin.castShadow = tin.receiveShadow = true;
        g.add(tin);
      }
      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(r - 0.008, r - 0.008, 0.012, 12),
        mat(lids[Math.floor(seed() * lids.length)]!, 0.6),
      );
      lid.position.set(cx, floor + 0.3 + 0.006, 0);
      g.add(lid);
    }
  } else {
    // Sacks of cement lying in a pile, the top ones across.
    const sx = Math.min(room - 0.04, 0.55);
    const sd = Math.min(depth - 0.1, 0.34);
    const cx = x0 + room / 2;
    for (let k = 0; k < 3; k++)
      add(
        g,
        new RoundedBoxGeometry(sx - k * 0.04, 0.1, sd, 2, 0.04),
        mat(k % 2 ? 0xc8c0ae : 0xd4ccb8, 0.95),
        cx,
        floor + 0.05 + k * 0.1,
        0,
      );
  }
}

/**
 * Pallet racking: blue uprights in frames every couple of metres, orange beams at three
 * levels with a board on each, stock in the bays, and plywood across the top to stand on. The
 * end uprights have a yellow guard round their feet.
 */
export function rack(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const post = mat(colour, 0.45);
  const beam = mat(0xe07b1a, 0.5);
  const guard = mat(0xf2c230, 0.6);
  const board = mat(0xb48f5a, 0.85);
  const bays = Math.max(1, Math.round(w / 2));
  const postW = 0.07;
  const postD = 0.06;
  const zf = d / 2 - 0.05;
  const deckT = 0.03;
  const foot = 0.015;
  const beamH = 0.09;
  const beamT = 0.045;
  // Uprights, with a foot plate each, the end ones in from the rack's ends far enough that
  // their guards stay inside its box (pallets are stacked right up against its end).
  const edge = 0.045;
  const postX = (i: number) => -w / 2 + edge + (i * (w - 2 * edge)) / bays;
  for (let i = 0; i <= bays; i++) {
    const x = postX(i);
    for (const z of [-zf, zf]) {
      box(g, 0.09, foot, 0.1, x, -h / 2 + foot / 2, z, post);
      box(g, postW, h - deckT - foot, postD, x, (foot - deckT) / 2, z, post);
      if (i === 0 || i === bays)
        box(g, postW + 0.01, 0.25, postD + 0.01, x, -h / 2 + foot + 0.125, z, guard);
    }
  }
  // Beams and shelves between the uprights.
  const levels = [0.14, 0.6, 1.06].filter((y) => y < h - 0.4);
  const top = h / 2 - deckT - beamH / 2;
  for (let i = 0; i < bays; i++) {
    const cx = (postX(i) + postX(i + 1)) / 2;
    const len = postX(i + 1) - postX(i) - postW;
    for (const y of [...levels.map((l) => -h / 2 + l), top])
      for (const z of [-zf, zf]) box(g, len, beamH, beamT, cx, y, z, beam);
    for (const l of levels) {
      const shelf = -h / 2 + l + beamH / 2;
      box(g, len, 0.02, zf * 2 + beamT, cx, shelf + 0.01, 0, board);
      stock(g, seed, cx - len / 2 + 0.05, cx + len / 2 - 0.05, shelf + 0.02, zf * 2);
    }
  }
  // The top: plywood the length of the rack, over the uprights.
  box(g, w, deckT, d, 0, h / 2 - deckT / 2, 0, board);
}

/**
 * A forklift facing -z: a yellow chassis on four wheels, the dashboard and steering wheel in
 * front of the driver, the seat on the engine cover, the dark counterweight at the back with
 * the gas bottle on it, and an overhead guard on four posts with lamps and a beacon. In front
 * of it the mast stands on its pivots with the tilt rams reaching back to the dashboard, the
 * lift ram and chains up its middle, and the carriage with its backrest and two forks at the
 * bottom. The mast and forks stand where `merchant.ts` puts the collisions for them (1.3 and
 * 1.9 m ahead of the middle), so they reach out of this model's box.
 */
export function forklift(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const yellow = mat(colour, 0.5);
  const dark = metal(0x2b2d30);
  const black = mat(0x1d1f22, 0.85);
  const grey = mat(0x3a3f44, 0.6);
  const chrome = metal(0xb0b6bc);
  const bottom = -h / 2;
  const top = h / 2;
  const clear = 0.12;
  // Lengthwise: the dashboard at the front, the driver's floor, the engine cover under the seat
  // and the counterweight at the back, in from the box's ends.
  const front = -d / 2 + 0.1;
  const dashBack = front + 0.38;
  const seatFront = -0.05;
  const weightFront = 0.62;
  const back = d / 2 - 0.02;
  const half = w / 2 - 0.21;
  const deck = bottom + 0.42;
  // The chassis under it all, between the wheels.
  box(
    g,
    half * 2,
    deck - bottom - clear,
    weightFront - front,
    0,
    (bottom + clear + deck) / 2,
    (front + weightFront) / 2,
    yellow,
  );
  // The dashboard, sloping back to a black panel with its gauges, and the steering column.
  box(
    g,
    half * 2,
    top + 0.15 - deck,
    dashBack - front,
    0,
    (deck + top + 0.15) / 2,
    (front + dashBack) / 2,
    yellow,
  );
  box(g, half * 2 - 0.2, 0.012, 0.22, 0, top + 0.156, (front + dashBack) / 2, black);
  for (const x of [-0.18, 0.18]) {
    const gauge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.012, 14),
      mat(0xe8e8e8, 0.3),
    );
    gauge.position.set(x, top + 0.168, (front + dashBack) / 2);
    g.add(gauge);
  }
  const column = box(g, 0.06, 0.42, 0.06, 0, top + 0.3, dashBack + 0.05, dark);
  column.rotation.x = -0.45;
  const steering = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 20), black);
  steering.position.set(0, top + 0.5, dashBack + 0.14);
  steering.rotation.x = Math.PI / 2 - 0.45;
  steering.castShadow = true;
  g.add(steering);
  // The driver's floor: a ribbed mat, and the pedals at the front of it.
  box(
    g,
    half * 2 - 0.06,
    0.02,
    seatFront - dashBack,
    0,
    deck + 0.01,
    (dashBack + seatFront) / 2,
    black,
  );
  for (const x of [-0.15, 0.05, 0.2]) {
    const pedal = box(g, 0.08, 0.02, 0.12, x, deck + 0.09, dashBack + 0.08, dark);
    pedal.rotation.x = 0.6;
  }
  // The engine cover with louvres down its sides, and the seat on it.
  box(
    g,
    half * 2,
    top - deck,
    weightFront - seatFront,
    0,
    (deck + top) / 2,
    (seatFront + weightFront) / 2,
    yellow,
  );
  for (const s of [-1, 1])
    for (let i = 0; i < 4; i++)
      box(g, 0.01, 0.025, 0.4, s * (half + 0.005), deck + 0.08 + i * 0.07, 0.3, black);
  add(g, new RoundedBoxGeometry(0.5, 0.1, 0.46, 2, 0.04), black, 0, top + 0.05, 0.2);
  const seatBack = add(
    g,
    new RoundedBoxGeometry(0.5, 0.48, 0.1, 2, 0.04),
    black,
    0,
    top + 0.33,
    0.45,
  );
  seatBack.rotation.x = -0.12;
  // The counterweight, rounded, with a tow pin and a black and yellow stripe at its back, and
  // the gas bottle strapped on it.
  add(
    g,
    new RoundedBoxGeometry(w - 0.24, top + 0.2 - (bottom + 0.1), back - weightFront, 3, 0.08),
    grey,
    0,
    (bottom + 0.1 + top + 0.2) / 2,
    (weightFront + back) / 2,
  );
  for (let i = 0; i < 5; i++) {
    const stripe = box(
      g,
      0.12,
      0.08,
      0.008,
      -0.4 + i * 0.2,
      bottom + 0.32,
      back + 0.004,
      i % 2 ? black : yellow,
    );
    stripe.rotation.z = 0.6;
  }
  box(g, 0.14, 0.08, 0.06, 0, bottom + 0.2, back + 0.02, dark);
  const bottle = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.15, 0.5, 4, 14),
    mat(0xd8dcdf, 0.35, 0.4),
  );
  bottle.rotation.z = Math.PI / 2;
  bottle.position.set(0, top + 0.37, back - 0.2);
  bottle.castShadow = true;
  g.add(bottle);
  box(g, 0.06, 0.06, 0.06, 0.45, top + 0.37, back - 0.2, mat(0x2f7a3a, 0.5));
  for (const x of [-0.2, 0.2]) box(g, 0.03, 0.34, 0.32, x, top + 0.32, back - 0.2, dark);
  // Wheels: big drive wheels at the front, smaller steering wheels behind, with hubs and
  // mudguards over them.
  const wheel = (r: number, z: number, s: number) => {
    const x = s * (w / 2 - 0.1);
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.18, 18), mat(0x1c1c1e, 0.9));
    tyre.rotation.z = Math.PI / 2;
    tyre.position.set(x, bottom + r, z);
    tyre.castShadow = tyre.receiveShadow = true;
    g.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.01, 14), yellow);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x + s * 0.095, bottom + r, z);
    g.add(hub);
    box(g, 0.2, 0.03, r * 2 + 0.12, x, bottom + 2 * r + 0.04, z, black);
  };
  for (const s of [-1, 1]) {
    wheel(0.3, -0.6, s);
    wheel(0.22, 0.75, s);
    // The step up on each side, between the wheels.
    box(g, 0.14, 0.03, 0.4, s * (half + 0.07), deck - 0.1, 0.06, black);
  }
  // The overhead guard: posts up from the dashboard and the counterweight, a frame and slats.
  const guardTop = top + 1.15;
  const guardFront = front + 0.15;
  const guardBack = back - 0.42;
  for (const [z, from] of [
    [guardFront, top + 0.15],
    [guardBack, top + 0.2],
  ] as const)
    for (const s of [-1, 1])
      box(g, 0.06, guardTop - from, 0.06, s * (half - 0.03), (guardTop + from) / 2, z, dark);
  for (const s of [-1, 1])
    box(
      g,
      0.06,
      0.05,
      guardBack - guardFront + 0.06,
      s * (half - 0.03),
      guardTop + 0.025,
      (guardFront + guardBack) / 2,
      dark,
    );
  for (const z of [guardFront, guardBack])
    box(g, half * 2 - 0.12, 0.05, 0.06, 0, guardTop + 0.025, z, dark);
  for (let i = 1; i < 6; i++)
    box(
      g,
      half * 2 - 0.12,
      0.03,
      0.03,
      0,
      guardTop + 0.025,
      guardFront + ((guardBack - guardFront) * i) / 6,
      dark,
    );
  // Work lamps on the front posts and an amber beacon on the roof.
  for (const s of [-1, 1]) {
    box(g, 0.1, 0.08, 0.06, s * (half - 0.03), guardTop - 0.15, guardFront - 0.06, dark);
    box(
      g,
      0.08,
      0.06,
      0.01,
      s * (half - 0.03),
      guardTop - 0.15,
      guardFront - 0.095,
      mat(0xfff4c8, 0.2, 0, 0x6b6450),
    );
  }
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.1, 12),
    mat(0xff9a1a, 0.3, 0, 0x7a3a00),
  );
  beacon.position.set(half - 0.12, guardTop + 0.1, guardBack - 0.05);
  g.add(beacon);

  // The mast: outer and inner channels with ties across, on pivots at the front of the
  // chassis, the tilt rams from the dashboard, and the lift ram and chains up the middle.
  const mastZ = -1.3;
  const mastFoot = bottom + 0.03;
  const mastH = 2.75;
  const mastMid = mastFoot + mastH / 2;
  for (const s of [-1, 1]) {
    box(g, 0.1, mastH, 0.18, s * 0.5, mastMid, mastZ + 0.02, dark);
    box(g, 0.08, mastH - 0.15, 0.12, s * 0.38, mastMid + 0.05, mastZ - 0.02, dark);
    // The pivot bracket at its foot, back to the chassis.
    box(
      g,
      0.08,
      0.14,
      front - (mastZ + 0.11),
      s * 0.42,
      bottom + 0.3,
      (front + mastZ + 0.11) / 2,
      dark,
    );
    // The tilt ram, from the dashboard's face out to the mast.
    const from = new THREE.Vector3(s * 0.32, top + 0.05, front);
    const to = new THREE.Vector3(s * 0.32, bottom + 1.2, mastZ + 0.11);
    const len = from.distanceTo(to);
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 10), dark);
    ram.position.copy(from).add(to).multiplyScalar(0.5);
    ram.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    ram.castShadow = true;
    g.add(ram);
  }
  for (const y of [mastFoot + 0.15, mastMid + 0.2, mastFoot + mastH - 0.05])
    box(g, 0.9, 0.08, 0.14, 0, y, mastZ + 0.02, dark);
  const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 10), chrome);
  lift.position.set(0, mastFoot + 0.25 + 0.95, mastZ + 0.04);
  lift.castShadow = true;
  g.add(lift);
  for (const s of [-1, 1])
    box(g, 0.04, mastH - 0.5, 0.02, s * 0.2, mastMid + 0.1, mastZ - 0.1, black);
  // The carriage: plates across the mast's face with the load backrest above, and the forks
  // hanging off it down to their blades along the ground.
  const carriageZ = mastZ - 0.15;
  for (const y of [bottom + 0.2, bottom + 0.55]) box(g, 1.0, 0.1, 0.05, 0, y, carriageZ, dark);
  for (const x of [-0.45, -0.15, 0.15, 0.45])
    box(g, 0.04, 0.7, 0.03, x, bottom + 0.95, carriageZ, dark);
  box(g, 1.0, 0.05, 0.03, 0, bottom + 1.3, carriageZ, dark);
  for (const s of [-1, 1]) {
    box(g, 0.12, 0.55, 0.05, s * 0.3, bottom + 0.3, carriageZ - 0.05, dark);
    box(g, 0.12, 0.05, 0.86, s * 0.3, bottom + 0.05, -1.92, dark);
    const tip = box(g, 0.12, 0.03, 0.08, s * 0.3, bottom + 0.04, -2.37, dark);
    tip.rotation.x = 0.25;
  }
}

/**
 * An air-conditioning unit: a casing on four feet, louvres down both sides, a fan under a
 * grille on top and an isolator switch on the front.
 */
export function acUnit(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const body = mat(colour, 0.55);
  const dark = mat(0x3a3f44, 0.6);
  const foot = 0.06;
  const lid = 0.04;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      box(g, 0.1, foot, 0.1, sx * (w / 2 - 0.1), -h / 2 + foot / 2, sz * (d / 2 - 0.1), dark);
  // The casing stops short of the box's front, so the isolator switch on it stays inside the
  // box the unit collides as.
  const recess = 0.06;
  box(g, w, h - foot - lid, d - recess, 0, (foot - lid) / 2, recess / 2, body);
  // Louvres down both sides.
  const slats = Math.floor((h - foot - lid - 0.2) / 0.06);
  for (const s of [-1, 1])
    for (let i = 0; i < slats; i++)
      box(g, 0.01, 0.025, d * 0.7, s * (w / 2 + 0.005), -h / 2 + foot + 0.12 + i * 0.06, 0, dark);
  // The fan: a dark disc, four blades and a hub, under two rings and spokes.
  const top = h / 2 - lid;
  const r = Math.min(w, d) * 0.4;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 24), dark);
  disc.position.set(0, top + 0.01, 0);
  g.add(disc);
  for (let i = 0; i < 4; i++) {
    const blade = box(g, r * 0.8, 0.008, 0.1, 0, top + 0.024, 0, mat(0x9aa0a6, 0.4));
    blade.position.set(
      Math.cos((i * Math.PI) / 2) * r * 0.42,
      top + 0.024,
      Math.sin((i * Math.PI) / 2) * r * 0.42,
    );
    blade.rotation.y = (-i * Math.PI) / 2;
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), metal(0xc4c9cd));
  hub.position.set(0, top + 0.038, 0);
  g.add(hub);
  for (const rr of [r * 0.5, r]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.006, 6, 28), metal(0xc4c9cd));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, top + 0.05, 0);
    g.add(ring);
  }
  // The isolator switch on the front.
  box(g, 0.12, 0.14, 0.04, -w * 0.25, 0, -d / 2 + recess - 0.02, mat(0xe8e8e8, 0.5));
  box(g, 0.04, 0.04, 0.02, -w * 0.25, 0.02, -d / 2 + recess - 0.05, mat(0xc0392b, 0.5));
}

/** How far a shutter's guides run down from its housing: the height of the bay. */
const BAY_HEIGHT = 3.2;

/**
 * A roller shutter in two kinds of box. One as tall as the bay is the curtain let down:
 * ribbed slats with a yellow bottom bar and a lock. A short one over the opening is its
 * housing; it carries the guides that run down both sides of the bay, which show whether the
 * curtain is down or up.
 */
export function shutter(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const steel = metal(0x6c747c);
  if (h > 1.5) {
    const inner = w - 0.16;
    const skirt = 0.14;
    box(g, inner, h - skirt, d * 0.5, 0, skirt / 2, 0, mat(colour, 0.5, 0.3));
    // The ribs stop just short of the curtain's ends, so their ends and its do not share a
    // plane and flicker through each other.
    for (let y = -h / 2 + skirt + 0.06; y < h / 2 - 0.03; y += 0.09)
      box(g, inner - 0.006, 0.018, d * 0.5 + 0.02, 0, y, 0, mat(shade(colour, 0.88), 0.5, 0.3));
    box(g, inner, skirt, d * 0.6, 0, -h / 2 + skirt / 2, 0, mat(0xf2c230, 0.6));
    box(g, 0.12, 0.03, 0.05, 0, -h / 2 + skirt / 2, -d * 0.3 - 0.025, mat(0x1d1d1d, 0.5));
    return;
  }
  box(g, w, h, d, 0, 0, 0, mat(colour, 0.5, 0.3));
  box(g, w - 0.16, 0.04, d + 0.02, 0, -h / 2 + 0.12, 0, mat(0xf2c230, 0.6));
  for (const s of [-1, 1])
    box(g, 0.08, BAY_HEIGHT, d + 0.04, s * (w / 2 - 0.04), -h / 2 - BAY_HEIGHT / 2, 0, steel);
}
