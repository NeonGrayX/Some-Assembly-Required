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

/** A pallet: five deck boards over nine blocks on three bottom boards. */
export function pallet(
  g: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  colour: number,
  seed: () => number,
): void {
  const t = 0.024;
  const boards = 5;
  const bw = 0.2;
  const gap = (w - boards * bw) / (boards - 1);
  for (let i = 0; i < boards; i++)
    box(
      g,
      bw,
      t,
      d,
      -w / 2 + bw / 2 + i * (bw + gap),
      h / 2 - t / 2,
      0,
      mat(shade(colour, 0.9 + seed() * 0.2), 0.88),
    );
  const dark = mat(shade(colour, 0.78), 0.9);
  const xs = [-w / 2 + 0.07, 0, w / 2 - 0.07];
  const zs = [-d / 2 + 0.06, 0, d / 2 - 0.06];
  for (const x of xs) {
    box(g, 0.14, t, d, x, -h / 2 + t / 2, 0, mat(shade(colour, 0.85 + seed() * 0.15), 0.9));
    for (const z of zs) box(g, 0.14, h - 2 * t, 0.12, x, 0, z, dark);
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
 * A forklift facing -z: a yellow body on four wheels, a dark counterweight behind, a seat and
 * steering wheel, an overhead guard, and in front of it the mast, carriage and forks. The mast
 * and forks stand where `merchant.ts` puts the collisions for them (1.3 and 1.9 m ahead of
 * the middle), so they reach out of this model's box.
 */
export function forklift(g: THREE.Object3D, w: number, h: number, d: number, colour: number): void {
  const yellow = mat(colour, 0.5);
  const dark = metal(0x2b2d30);
  const grey = mat(0x3a3f44, 0.6);
  const bottom = -h / 2;
  const clear = 0.18;
  // The body and the counterweight behind it, both up to the top of the box.
  const bodyZ0 = -d / 2 + 0.285;
  const bodyZ1 = d / 2 - 0.45;
  box(
    g,
    w - 0.3,
    h - clear,
    bodyZ1 - bodyZ0,
    0,
    (bottom + clear + h / 2) / 2,
    (bodyZ0 + bodyZ1) / 2,
    yellow,
  );
  box(g, w - 0.4, h - clear, 0.45, 0, (bottom + clear + h / 2) / 2, d / 2 - 0.225, grey);
  // Wheels: big ones at the front, small ones behind, outside the body.
  const wheel = (r: number, z: number, x: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.15, 16), mat(0x1c1c1e, 0.9));
    m.rotation.z = Math.PI / 2;
    m.position.set(x, bottom + r, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  for (const s of [-1, 1]) {
    wheel(0.3, -0.6, s * (w / 2 - 0.075));
    wheel(0.22, 0.75, s * (w / 2 - 0.075));
  }
  // The seat, its back, and the steering wheel on its column.
  box(g, 0.46, 0.1, 0.46, 0, h / 2 + 0.05, 0.18, mat(0x1f2328, 0.8));
  box(g, 0.46, 0.45, 0.08, 0, h / 2 + 0.325, 0.46, mat(0x1f2328, 0.8));
  const column = box(g, 0.05, 0.5, 0.05, 0, h / 2 + 0.25, -0.38, dark);
  column.rotation.x = -0.5;
  const steering = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 16), dark);
  steering.position.set(0, h / 2 + 0.5, -0.53);
  steering.rotation.x = -0.5;
  steering.castShadow = true;
  g.add(steering);
  // The overhead guard: posts and a grille of bars.
  const guardTop = h / 2 + 1.15;
  for (const [x, z, up] of [
    [-0.52, -0.55, 1.15],
    [0.52, -0.55, 1.15],
    [-0.52, 0.5, 1.15],
    [0.52, 0.5, 1.15],
  ] as const)
    box(g, 0.05, up, 0.05, x, h / 2 + up / 2, z, dark);
  for (let i = 0; i < 6; i++) box(g, 0.03, 0.04, 1.1, -0.5 + i * 0.2, guardTop + 0.02, -0.02, dark);
  for (const z of [-0.55, 0.5]) box(g, 1.1, 0.03, 0.05, 0, guardTop + 0.055, z, dark);
  // The mast: two uprights with cross pieces, a carriage and a lifting ram.
  const mastZ = -1.3;
  const mastMid = 1.0;
  for (const s of [-1, 1]) box(g, 0.1, 2.8, 0.2, s * 0.5, mastMid, mastZ, dark);
  for (const y of [mastMid - 1.35, mastMid + 1.35]) box(g, 0.9, 0.08, 0.2, 0, y, mastZ, dark);
  const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 10), metal(0xb0b6bc));
  ram.position.set(0, mastMid, mastZ + 0.02);
  ram.castShadow = true;
  g.add(ram);
  box(g, 0.95, 0.55, 0.06, 0, -0.025, mastZ - 0.16, dark);
  // The forks lie out in front of the carriage, low.
  for (const s of [-1, 1]) {
    box(g, 0.12, 0.06, 0.86, s * 0.3, -0.21, -1.92, dark);
    box(g, 0.12, 0.3, 0.04, s * 0.3, -0.06, -1.51, dark);
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
