import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONE_SHADES, HOLOGRAM, ORANGE, triangle } from './cone.ts';
import { cbox, glow, mat, put, rbox, rng } from './kit.ts';
import { letterPixels, paintedSign } from './lettering.ts';
import { Clockwork, addGadget, signalLens } from './gadgets.ts';
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

/** A road barrier's foot: a turned metal skirt as the cones' are, a slot for light under its band. */
function barrierFoot(r: number): THREE.BufferGeometry {
  const pts = [
    [0, 0],
    [r - 0.01, 0],
    [r, 0.01],
    [r, 0.04],
    [r - 0.008, 0.045],
    [r - 0.025, 0.048],
    [r - 0.025, 0.064],
    [r - 0.005, 0.068],
    [r - 0.004, 0.1],
    [r - 0.02, 0.112],
    [0.06, 0.15],
    [0.05, 0.16],
    [0, 0.16],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, 40);
}

/** A board `t × h × l`, its glossy colour shading up it from amber to deep red, as a cone's. */
function shadedBoard(t: number, h: number, l: number): THREE.Mesh {
  const geo = new RoundedBoxGeometry(t, h, l, 3, 0.025);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const [low, mid, high] = [CONE_SHADES.low, CONE_SHADES.mid, CONE_SHADES.high].map(
    (c) => new THREE.Color(c),
  );
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.max(0, Math.min(1, pos.getY(i) / h + 0.5));
    if (k < 0.5) c.copy(low!).lerp(mid!, k / 0.5);
    else c.copy(mid!).lerp(high!, (k - 0.5) / 0.5);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(
    geo,
    mat(0xffffff, {
      roughness: 0.2,
      vertexColors: true,
      mottle: 'none',
      envMapIntensity: 2.4,
      clearcoat: 1,
      clearcoatRoughness: 0.01,
    }),
  );
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** `text` in the cones' hologram yellow, only its letters' pixels lit, `height` tall, facing +z. */
function hologramText(text: string, height: number): THREE.Mesh {
  const m = new THREE.Mesh(letterPixels(text, height), glow(HOLOGRAM, 2.6));
  m.castShadow = false;
  return m;
}

/**
 * A road barrier `length` long, in the cones' style: two turned metal feet with a line of orange
 * light in a slot under each one's band, polished posts up to a glossy board shading from amber
 * at its foot to deep red at its top, chevrons in the cones' dark collar red pointing to its
 * middle, dark metal bands along its edges, an orange blinker on each end, a polished rail
 * between its posts lit orange; and floating over it, as round a cone, a hologram in yellow:
 * ROAD CLOSED between two warning triangles and broken lines of light.
 */
/** How many barriers have been built, to set each one's blinkers going at its own time. */
let barriers = 0;

export function roadBarrier(length: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'road barrier';
  const board = { y: 0.82, h: 0.3, t: 0.06 };
  const metal = mat(0xaab2b8, {
    mottle: 'metal',
    roughness: 0.32,
    metalness: 0.6,
    envMapIntensity: 2,
  });
  const band = mat(0x3a3e42, { mottle: 'metal', roughness: 0.4, metalness: 0.5 });
  const r = 0.21;
  // Its blinkers, flashing by turns, each barrier at its own time.
  const blinkers = [signalLens(ORANGE, 2.8), signalLens(ORANGE, 2.8)];
  const phase = (barriers++ * 0.37) % 1;
  addGadget(
    g,
    new Clockwork((time) => {
      const on = Math.floor(time * 1.6 + phase * 2) % 2;
      blinkers.forEach((b, i) => b.set(i === on ? 1 : 0.08));
    }),
  );
  for (const s of [-1, 1]) {
    const z = s * (length / 2 - 0.25);
    put(g, barrierFoot(r), metal, 0, 0, z);
    const slot = new THREE.CylinderGeometry(r - 0.022, r - 0.022, 0.016, 40, 1, true);
    put(g, slot, glow(ORANGE, 2.6), 0, 0.056, z);
    const post = new THREE.CylinderGeometry(0.032, 0.038, board.y - 0.16, 20);
    put(g, post, polished(), 0, 0.16 + (board.y - 0.16) / 2 - 0.02, z);
    // The blinker on top of the board's end.
    const top = board.y + board.h / 2;
    rbox(g, band, 0, top + 0.03, z, 0.1, 0.06, 0.1, 0.02);
    const lamp = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24);
    lamp.rotateZ(Math.PI / 2);
    put(g, lamp, blinkers[(s + 1) / 2]!.mat, 0, top + 0.12, z);
    const rim = new THREE.TorusGeometry(0.062, 0.012, 8, 24);
    rim.rotateY(Math.PI / 2);
    put(g, rim, metal, 0, top + 0.12, z);
  }
  const face = shadedBoard(board.t, board.h, length);
  face.position.y = board.y;
  g.add(face);
  // The chevrons, on both faces, pointing to its middle.
  const collar = mat(CONE_SHADES.collar, {
    roughness: 0.2,
    mottle: 'none',
    envMapIntensity: 2.4,
    clearcoat: 1,
    clearcoatRoughness: 0.01,
  });
  const stripe = 0.18;
  for (let z = -length / 2 + 0.16; z < length / 2 - 0.1; z += stripe * 2) {
    const lean = z + stripe / 2 < 0 ? 0.7 : -0.7;
    for (const s of [-1, 1]) {
      const bar = cbox(
        g,
        collar,
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
  // Dark metal bands trimming the stripes' ends top and bottom.
  for (const y of [board.y - board.h / 2, board.y + board.h / 2])
    rbox(g, band, 0, y, 0, board.t + 0.02, 0.04, length + 0.02, 0.015);
  // The rail between the posts, lit orange along its faces.
  const rail = new THREE.CylinderGeometry(0.026, 0.026, length - 0.5, 16);
  rail.rotateX(Math.PI / 2);
  put(g, rail, polished(), 0, 0.32, 0);
  for (const s of [-1, 1])
    cbox(g, glow(ORANGE, 2.2), s * 0.027, 0.32, 0, 0.004, 0.01, length - 0.7, 0.002);

  // The hologram, floating over it and tipped a little: the words on both faces, a broken line
  // of light over and under them, and a warning triangle at each end.
  const holo = new THREE.Group();
  holo.name = 'hologram';
  holo.position.y = board.y + board.h / 2 + 0.42;
  holo.rotation.z = 0.08;
  g.add(holo);
  const tall = 0.11;
  const w = ((11 * 6 - 1) / 7) * tall;
  for (const s of [-1, 1]) {
    const words = hologramText('ROAD CLOSED', tall);
    words.position.x = s * 0.002;
    words.rotation.y = (s * Math.PI) / 2;
    holo.add(words);
  }
  const dashes = 9;
  const span = w + 0.5;
  const dash = new THREE.BoxGeometry(0.008, 0.012, (span / dashes) * 0.62);
  for (const [y, turn] of [
    [0.11, 0],
    [-0.11, 0.5],
  ] as const)
    for (let i = 0; i < dashes; i++) {
      const d = new THREE.Mesh(dash, glow(HOLOGRAM, 2.2));
      d.position.set(0, y, -span / 2 + ((i + turn + 0.25) * span) / dashes);
      d.castShadow = false;
      holo.add(d);
    }
  const sign = triangle();
  for (const e of [-1, 1])
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(sign, glow(HOLOGRAM, 2.6));
      t.position.set(s * 0.003, 0, e * (w / 2 + 0.17));
      t.scale.setScalar(1.7);
      t.rotation.y = (s * Math.PI) / 2;
      t.castShadow = false;
      holo.add(t);
    }
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
