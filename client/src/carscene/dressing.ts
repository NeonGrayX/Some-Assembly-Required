import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import {
  bentPath,
  cbox,
  glow,
  mat,
  put,
  putSlab,
  rbox,
  rng,
  roundedOutline,
  soilBed,
  tube,
} from './kit.ts';
import { litSign, paintedSign } from './lettering.ts';
import { hingedDoor } from './gadgets.ts';
import { BRICKS } from './machines.ts';

/**
 * What a working lot has lying about, in the cars' style: a yellow skip of brick offcuts, a teal
 * portaloo, and the pellets' pallets, sacks of each colour shrink-wrapped on a timber pallet,
 * with a stack of empty pallets beside.
 *
 * Each is built standing on the origin, its front toward +x.
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
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.22, metalness: 0.9, envMapIntensity: 2.6 });
const white = () => mat(0xf1efe8, { mottle: 'paint', roughness: 0.4, clearcoat: 0.8 });
const timber = () => mat(0xb98b58, { mottle: 'plastic', roughness: 0.85 });
const sack = (colour: number) => mat(colour, { mottle: 'plastic', roughness: 0.55 });
const wrap = () =>
  mat(0xeef6f8, {
    mottle: 'none',
    roughness: 0.12,
    envMapIntensity: 2,
    transparent: true,
    opacity: 0.2,
  });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** The skip's lines: its length along the foot and the top, its width and height. */
export const SKIP = { foot: 2.2, top: 3.1, width: 1.5, height: 0.95 };

/**
 * A skip: yellow steel sloping out at its ends, ribbed down its sides, a charcoal rolled rim with
 * cyan light under it, steel lifting lugs at its ends, OFFCUTS painted on its sides, and a heap
 * of brick offcuts in it in all the game's colours.
 */
export function skip(seed = 3): THREE.Group {
  const g = new THREE.Group();
  g.name = 'skip';
  const { foot, top, width: w, height: h } = SKIP;
  const yellow = paint(BUS.yellow);
  const t = 0.05;
  // Runners under it, and its floor.
  for (const x of [-w / 2 + 0.25, w / 2 - 0.25])
    rbox(g, charcoal(), x, 0.04, 0, 0.14, 0.08, foot - 0.1, 0.02);
  cbox(g, yellow, 0, 0.08 + t / 2, 0, w, t, foot, 0.015);
  // Its sides, as the profile of its length pushed out across it.
  const side = roundedOutline(
    [
      [-foot / 2, 0.08],
      [foot / 2, 0.08],
      [top / 2, h],
      [-top / 2, h],
    ],
    0.03,
  );
  for (const s of [-1, 1])
    putSlab(g, side, t, yellow, 0.012, s * (w / 2 - t / 2), 0, 0, 0, Math.PI / 2);
  // Its ends, sloping out.
  const run = (top - foot) / 2;
  const slope = Math.hypot(run, h - 0.08);
  const lean = Math.atan2(run, h - 0.08);
  for (const s of [-1, 1])
    cbox(g, yellow, 0, (h + 0.08) / 2, s * (foot / 2 + run / 2), w - 0.02, slope, t, 0.015, [
      s * lean,
      0,
      0,
    ]);
  // Ribs down its sides, and the words.
  for (const s of [-1, 1]) {
    for (const z of [-0.75, -0.25, 0.25, 0.75])
      rbox(g, yellow, s * (w / 2 + 0.02), (h + 0.1) / 2, z, 0.04, h - 0.12, 0.07, 0.015);
    const words = paintedSign('OFFCUTS', 0x1d2326, BUS.yellow, 0.7);
    words.position.set(s * (w / 2 + 0.042), 0.55, 0);
    words.rotation.y = (s * Math.PI) / 2;
    g.add(words);
    for (const z of [-0.5, 0.5])
      cbox(g, dark(), s * (w / 2 + 0.041), 0.55, z, 0.004, 0.2, 0.06, 0.002);
  }
  // The rolled rim round its top, cyan under it along its sides.
  const V = THREE.Vector3;
  const rim = bentPath(
    [
      new V(-w / 2, h, -top / 2),
      new V(w / 2, h, -top / 2),
      new V(w / 2, h, top / 2),
      new V(-w / 2, h, top / 2),
    ],
    0.05,
    true,
  );
  tube(g, rim, 0.035, charcoal(), true);
  for (const s of [-1, 1])
    cbox(g, cyan(1.8), s * (w / 2 + 0.003), h - 0.06, 0, 0.004, 0.012, top - 0.5, 0.002);
  // The lifting lugs, out from its ends' corners.
  for (const s of [-1, 1])
    for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) {
      const lug = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 16);
      lug.rotateX(Math.PI / 2);
      put(g, lug, polished(), x, 0.68, s * (foot / 2 + run * 0.68 + 0.08));
      rbox(g, charcoal(), x, 0.68, s * (foot / 2 + run * 0.68 + 0.02), 0.12, 0.14, 0.06, 0.02);
    }
  // The heap: rubble most of the way up, offcuts of brick tumbled over it.
  const fill = 0.62;
  const reach = foot + ((top - foot) * (fill - 0.08)) / (h - 0.08);
  cbox(
    g,
    mat(0x6f6a63, { mottle: 'soil', roughness: 1 }),
    0,
    (0.13 + fill) / 2,
    0,
    w - 0.1,
    fill - 0.13,
    foot - 0.05,
    0.01,
  );
  put(
    g,
    soilBed(w - 0.12, reach - 0.12, seed),
    mat(0x6f6a63, { mottle: 'soil', roughness: 1 }),
    0,
    fill,
    0,
  );
  const rand = rng(seed);
  for (let i = 0; i < 26; i++) {
    const colour = BRICKS[Math.floor(rand() * BRICKS.length)]!;
    const [sx, sz] = rand() < 0.5 ? [0.16, 0.32] : [0.16, 0.16];
    const b = rbox(
      g,
      sack(colour),
      (rand() - 0.5) * (w - 0.45),
      fill + 0.06 + rand() * 0.12,
      (rand() - 0.5) * (reach - 0.6),
      sx,
      0.1,
      sz,
      0.015,
    );
    b.rotation.set((rand() - 0.5) * 0.8, rand() * Math.PI, (rand() - 0.5) * 0.8);
    // Its studs.
    for (let k = 0; k < (sz > 0.2 ? 2 : 1); k++) {
      const stud = new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16);
      const m = put(b, stud, sack(colour), 0, 0.06, (k - (sz > 0.2 ? 0.5 : 0)) * 0.16);
      m.castShadow = false;
    }
  }
  return g;
}

/** The portaloo's lines: its width and depth, its body's height. */
export const LOO = { w: 1.1, d: 1.15, body: 2.15 };

/**
 * A portaloo: a teal moulded box on a charcoal skid, a white roof with a vent pipe, slits for air
 * under the roof, its door on the front between ribs, with a steel handle, a lit sign that reads
 * VACANT in green and a WC sign, and a cyan strip round its foot. A click swings the door open on what is
 * inside (a toilet with its cistern and its lid up, a roll of paper, a lamp in the roof); shut
 * with someone in, its sign reads ENGAGED in red.
 */
export function portaloo(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'portaloo';
  const { w, d, body } = LOO;
  const teal = paint(TEAL);
  rbox(g, charcoal(), 0, 0.05, 0, d + 0.06, 0.1, w + 0.06, 0.03);
  for (const s of [-1, 1])
    cbox(g, cyan(1.8), s * (d / 2 + 0.032), 0.08, 0, 0.004, 0.012, w - 0.1, 0.002);
  // The body: hollow, its back and sides, a ceiling, and its front round the doorway.
  const t = 0.04;
  const top = 0.1 + body;
  const face = d / 2;
  rbox(g, teal, -face + t / 2, 0.1 + body / 2, 0, t, body, w, 0.015);
  for (const s of [-1, 1]) rbox(g, teal, 0, 0.1 + body / 2, s * (w / 2 - t / 2), d, body, t, 0.015);
  rbox(g, teal, 0, top - t / 2, 0, d, t, w - 0.004, 0.015);
  cbox(g, dark(), 0, 0.105, 0, d - 2 * t, 0.01, w - 2 * t, 0.003);
  const [dz, dy0, dy1] = [w / 2 - 0.16, 0.16, top - 0.22];
  for (const s of [-1, 1])
    rbox(
      g,
      teal,
      face - t / 2,
      0.1 + body / 2,
      s * (dz + (w / 2 - dz) / 2),
      t,
      body,
      w / 2 - dz,
      0.01,
    );
  rbox(g, teal, face - t / 2, (dy1 + top) / 2, 0, t, top - dy1, 2 * dz + 0.01, 0.01);
  rbox(g, teal, face - t / 2, (0.1 + dy0) / 2, 0, t, dy0 - 0.1, 2 * dz + 0.01, 0.01);
  // The roof, white and out past the walls, and its vent.
  rbox(g, white(), 0, top + 0.05, 0, d + 0.08, 0.12, w + 0.08, 0.05);
  rbox(g, white(), 0, top + 0.13, 0, d - 0.2, 0.06, w - 0.2, 0.03);
  const vent = new THREE.CylinderGeometry(0.05, 0.05, 0.36, 16);
  put(g, vent, charcoal(), -d / 2 + 0.18, top + 0.24, w / 2 - 0.2);
  const cap = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 16);
  put(g, cap, charcoal(), -d / 2 + 0.18, top + 0.44, w / 2 - 0.2);
  // Air slits under the roof, on its sides.
  for (const s of [-1, 1])
    for (let k = 0; k < 4; k++)
      cbox(g, dark(), (k - 1.5) * 0.18, top - 0.16, s * (w / 2 + 0.002), 0.12, 0.03, 0.004, 0.003);
  // Ribs either side of the door.
  for (const s of [-1, 1])
    rbox(g, teal, face + 0.02, 0.1 + body / 2, s * (w / 2 - 0.08), 0.05, body - 0.1, 0.07, 0.02);
  // Inside: the toilet against the back, its cistern behind it, its seat and its lid up.
  const china = white();
  const bx = -face + t;
  rbox(g, china, bx + 0.1, 0.72, 0, 0.18, 0.34, 0.44, 0.03);
  put(g, new THREE.CylinderGeometry(0.17, 0.12, 0.36, 28), china, bx + 0.36, 0.11 + 0.18, 0);
  put(
    g,
    new THREE.TorusGeometry(0.15, 0.025, 10, 32).rotateX(Math.PI / 2),
    charcoal(),
    bx + 0.36,
    0.49,
    0,
  );
  put(
    g,
    new THREE.CircleGeometry(0.12, 24).rotateX(-Math.PI / 2),
    mat(0x3d86b5, { mottle: 'none', roughness: 0.1 }),
    bx + 0.36,
    0.42,
    0,
  );
  cbox(g, charcoal(), bx + 0.205, 0.72, 0, 0.03, 0.4, 0.34, 0.012);
  rbox(g, polished(), bx + 0.16, 0.92, 0.12, 0.05, 0.02, 0.06, 0.008);
  // A roll of paper on the side wall, and a lamp in the roof.
  const sz = -w / 2 + t;
  cbox(g, polished(), bx + 0.5, 0.82, sz + 0.03, 0.03, 0.03, 0.06, 0.008);
  put(
    g,
    new THREE.CylinderGeometry(0.055, 0.055, 0.11, 20).rotateZ(Math.PI / 2),
    china,
    bx + 0.5,
    0.82,
    sz + 0.075,
  );
  put(g, new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24), glow(0xfff1d6, 1.8), 0, top - t - 0.01, 0);
  // The door, hung at its -z edge, its handle, its lit sign and the WC sign on it.
  const vacant = litSign('VACANT', 0x2fe07a, 0.18, 2.2);
  const engaged = litSign('ENGAGED', 0xff2a20, 0.18, 2.2);
  const door = hingedDoor(
    g,
    'portaloo',
    new THREE.Vector3(face, (dy0 + dy1) / 2, -dz),
    'y',
    1.75,
    (leaf) => {
      rbox(
        leaf,
        teal,
        face - t / 2,
        (dy0 + dy1) / 2,
        0,
        t,
        dy1 - dy0 - 0.006,
        2 * dz - 0.006,
        0.01,
      );
      rbox(leaf, polished(), face + 0.03, 1.05, dz - 0.12, 0.04, 0.2, 0.05, 0.015);
      rbox(leaf, polished(), face - t - 0.02, 1.05, dz - 0.12, 0.04, 0.2, 0.05, 0.015);
      cbox(
        leaf,
        mat(0x0e1418, { mottle: 'none', roughness: 0.1 }),
        face + 0.004,
        1.32,
        dz - 0.12,
        0.006,
        0.07,
        0.22,
        0.002,
      );
      const wc = paintedSign('WC', 0xf1efe8, TEAL, 0.24);
      wc.position.set(face + 0.006, 1.8, 0);
      wc.rotation.y = Math.PI / 2;
      leaf.add(wc);
      cbox(leaf, white(), face + 0.002, 1.8, 0, 0.004, 0.2, 0.32, 0.01);
      for (const sign of [vacant, engaged]) {
        sign.position.set(face + 0.008, 1.32, dz - 0.12);
        sign.rotation.y = Math.PI / 2;
        leaf.add(sign);
      }
    },
  );
  engaged.visible = false;
  door.noise = ['click', 'thump'];
  // Someone in, shown on the sign while the door is shut.
  const was = door.update.bind(door);
  const at = new THREE.Vector3();
  door.update = (dt, who) => {
    was(dt, who);
    let busy = false;
    if (who && door.t === 0) {
      g.worldToLocal(at.copy(who));
      busy = Math.abs(at.x) < face - t && Math.abs(at.z) < w / 2 - t && at.y < 1;
    }
    vacant.visible = !busy;
    engaged.visible = busy;
  };
  return g;
}

/** A pallet's lines: its length (z), width (x) and height. */
export const PALLET = { l: 1.2, w: 1.0, h: 0.14 };

/** A timber pallet at height `y` in `g`: runners, blocks, stringers and deck boards. */
function pallet(g: THREE.Group, y: number, turn = 0): void {
  const p = new THREE.Group();
  p.position.y = y;
  p.rotation.y = turn;
  g.add(p);
  const { l, w, h } = PALLET;
  const wood = timber();
  for (const x of [-w / 2 + 0.05, 0, w / 2 - 0.05]) {
    cbox(p, wood, x, 0.011, 0, 0.1, 0.022, l, 0.006);
    for (const z of [-l / 2 + 0.06, 0, l / 2 - 0.06])
      cbox(p, wood, x, 0.06, z, 0.1, 0.076, 0.12, 0.008);
  }
  for (const z of [-l / 2 + 0.06, 0, l / 2 - 0.06]) cbox(p, wood, 0, 0.108, z, w, 0.02, 0.1, 0.006);
  for (let k = 0; k < 7; k++) {
    const z = -l / 2 + 0.05 + (k * (l - 0.1)) / 6;
    cbox(p, wood, 0, h - 0.011, z, w, 0.022, 0.1, 0.006);
  }
}

/**
 * A pallet of pellets: sacks of the game's five colours in `layers` layers of four, PELLETS
 * printed on each where it faces the front, all shrink-wrapped.
 */
export function palletLoad(seed = 1, layers = 3): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pellet pallet';
  pallet(g, 0);
  const { l, w, h } = PALLET;
  const rand = rng(seed);
  const [sl, sw, sh] = [0.56, 0.46, 0.16];
  for (let k = 0; k < layers; k++) {
    const y = h + sh / 2 + k * (sh + 0.005);
    for (const a of [-1, 1])
      for (const b of [-1, 1]) {
        const colour = BRICKS[Math.floor(rand() * BRICKS.length)]!;
        const [x, z, sx, sz] = [(a * w) / 4, (b * l) / 4, sw, sl];
        rbox(g, sack(colour), x, y, z, sx, sh, sz, 0.06);
        if (a > 0) {
          const label = paintedSign('PELLETS', 0x1d2326, 0xf1efe8, 0.3);
          label.position.set(x + sx / 2 + 0.003, y, z);
          label.rotation.y = Math.PI / 2;
          g.add(label);
        }
      }
  }
  const tall = layers * (sh + 0.005);
  rbox(g, wrap(), 0, h + tall / 2, 0, w + 0.03, tall + 0.02, l + 0.03, 0.05);
  return g;
}

/** A stack of `count` empty pallets, each a little askew. */
export function palletStack(count = 5, seed = 2): THREE.Group {
  const g = new THREE.Group();
  g.name = 'pallet stack';
  const rand = rng(seed);
  for (let k = 0; k < count; k++) pallet(g, k * PALLET.h, (rand() - 0.5) * 0.08);
  return g;
}
