import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { groundMaterial, mix, polygonField, tuft } from './ground.ts';
import type { Field } from './ground.ts';
import {
  bentPath,
  cbox,
  fbm,
  glow,
  hash,
  mat,
  noise,
  put,
  putFlatSlab,
  putSlab,
  rbox,
  rng,
  roundRect,
  roundedOutline,
  slab,
  soil,
  soilBed,
  tube,
} from './kit.ts';
import { COVER_RADIUS, GRATE, coverIron, grateIron } from './castiron.ts';
import { SPORT } from './sportscar.ts';
import { Surface, madeOf } from '../render/styles.ts';
import {
  MOVING,
  Toggle,
  addGadget,
  dimmable,
  hingedDoor,
  powered,
  sound,
  waterMaterial,
} from './gadgets.ts';
import type { Gadget } from './gadgets.ts';
import { litSign } from './lettering.ts';

/**
 * A stretch of street, fitted out in the cars' style: two lanes of worn asphalt with their lines
 * and a zebra crossing, raised pavements of square slabs behind kerbs with a cyan strip of light
 * set in them, and on the pavements street lamps with glowing pods, traffic lights for the
 * crossing with their walk signals and push buttons, tactile paving at the crossing, guard
 * railings, bins, a bench, a hydrant, bollards, a charging post, a planter, and drains and
 * manholes in the road. The street furniture is painted in a deep teal on charcoal, its edges
 * catching polished steel and the cyan of the cars' lamps.
 *
 * Laid out in the scene's own coordinates, running along x.
 */

/** The street's lines: its ends along x, and across it (z) its kerbs and pavements' backs. */
export const STREET = {
  x0: -12.6,
  x1: 3.6,
  /** The road between the kerbs' faces, and its middle. */
  north: -13.3,
  south: -19.7,
  middle: -16.5,
  /** How deep each pavement is, kerb to back. */
  pavement: 2.2,
  /** The zebra crossing's middle along x. */
  crossing: -4.5,
};

/** The kerb's height, and the pavement's top just under it. */
const KERB = { height: 0.15, depth: 0.22 };
const PAVE = 0.146;

/** The street furniture's paint, its worn edges, and its other colours. */
const TEAL = 0x2c6670;

/** How far each lane's stop line is from the crossing's middle: a metre and more short of it. */
const STOP = 2.8;
const paint = () =>
  mat(TEAL, {
    mottle: 'paint',
    roughness: 0.42,
    metalness: 0.2,
    envMapIntensity: 1.4,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
  });
const charcoal = () => mat(CAR.trim, { mottle: 'plastic', roughness: 0.6 });
const gunmetal = () =>
  mat(0x3a3f44, { mottle: 'metal', roughness: 0.4, metalness: 0.8, envMapIntensity: 1.8 });
const polished = () =>
  mat(0xdde2e6, { mottle: 'metal', roughness: 0.3, metalness: 0.7, envMapIntensity: 2.4 });
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.9 });
/** Cast iron, for the manholes' frames: a diamond tread worn bright on top. */
const iron = () =>
  mat(0x6c7379, { mottle: 'cast', roughness: 0.32, metalness: 0.9, envMapIntensity: 1.8 });
const glass = () =>
  mat(0x0e1418, { mottle: 'none', roughness: 0.08, metalness: 0.2, envMapIntensity: 2.2 });
const concrete = () => mat(0x8f918f, { mottle: 'plastic', roughness: 0.85 });
const kerbStone = () => mat(0xa3a7aa, { mottle: 'plastic', roughness: 0.75 });

/** A group at (`x`, `z`) on the pavement's top, turned `turn` about the upright. */
function at(parent: THREE.Object3D, x: number, z: number, turn = 0, y = PAVE): THREE.Group {
  const g = new THREE.Group();
  g.name = 'prop';
  g.position.set(x, y, z);
  g.rotation.y = turn;
  parent.add(g);
  return g;
}

/** Turns that face a prop's +x toward the road from the north and south pavements. */
const TO_ROAD = { north: Math.PI / 2, south: -Math.PI / 2 };

// ---------------------------------------------------------------------------------------------
// The ground: asphalt, kerbs and pavements.

/** The road's asphalt and paint, over `rect` (x0, z0, w, d), its ends broken off raggedly. */
function asphalt(field: Field, rect: [number, number, number, number], perMetre: number) {
  const [x0, z0, w, d] = rect;
  const W = Math.round(w * perMetre);
  const H = Math.round(d * perMetre);
  const data = new Uint8Array(W * H * 4);
  const darkA = [0x3a, 0x40, 0x47];
  const midA = [0x52, 0x59, 0x61];
  const lightA = [0x6c, 0x72, 0x7a];
  const fleck = [0x9a, 0x9e, 0xa2];
  const crack = [0x16, 0x18, 0x1a];
  const moss = [0x3a, 0x4c, 0x22];
  const white = [0xe2, 0xdf, 0xd6];
  const wet = [0x4a, 0x4e, 0x50];
  const wash = [0x9a, 0x94, 0x8c];
  const { north, south, middle, crossing } = STREET;
  const band = (v: number, c: number, half: number) =>
    Math.max(0, Math.min(1, (half - Math.abs(v - c)) * perMetre * 0.5 + 0.5));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      const z = z0 + (1 - (j + 0.5) / H) * d;
      const rough = (fbm(x * 0.1, z * 0.35, 8, 143, 4) - 0.5) * 0.9;
      const streak = (noise(x * 0.25, z * 14, 1000, 145) - 0.5) * 0.6;
      const f = field(x, z) + rough + streak * 0.6;
      const k = (j * W + i) * 4;
      if (f > 0.7) {
        data[k + 3] = 0;
        continue;
      }
      let c: number[];
      let a = 1;
      if (f > 0) {
        // Its broken ends brushed out over the floor, as the other roads' are.
        const broken = noise(x * 3, z * 14, 1000, 147);
        if (f < 0.25) {
          c = wet.map((v) => v * (0.85 + 0.3 * broken));
          a = 0.85 * Math.min(1, (0.25 - f) / 0.06 + broken * 0.5);
        } else {
          const t = (f - 0.25) / 0.45;
          a = Math.max(0, (1 - t) * (0.75 + 0.5 * broken) - 0.15) * 0.6;
          c = mix(wet, wash, Math.min(1, t * 3)).map((v) => v * (0.85 + 0.3 * broken));
        }
      } else {
        const m = fbm(x * 0.1, z * 0.1, 8, 151, 4);
        c = m < 0.5 ? mix(darkA, midA, m / 0.5) : mix(midA, lightA, (m - 0.5) / 0.5);
        const grit = noise(x * 60, z * 60, 100000, 153);
        c = mix(c, fleck, Math.max(0, grit - 0.8) * 3);
        c = mix(c, darkA, Math.max(0, 0.18 - grit) * 3);
        // Darker down the middle of each lane, where the traffic runs.
        for (const lane of [(north + middle) / 2, (south + middle) / 2])
          c = mix(c, darkA, 0.25 * Math.max(0, 1 - Math.abs(z - lane) / 0.9));
        // The paint: a solid line inside each kerb, the middle dashed and solid near the
        // crossing, a stop line before it in each lane (traffic keeps right, so +x in the north
        // lane and -x in the south), and the crossing's bars.
        const near = Math.abs(x - crossing);
        let line = Math.max(band(z, north - 0.35, 0.06), band(z, south + 0.35, 0.06));
        const dash = ((x % 3) + 3) % 3 < 1.6 || near < 6 ? 1 : 0;
        line = Math.max(line, band(z, middle, 0.06) * dash * (near > 1.7 ? 1 : 0));
        if (z > middle && z < north - 0.35) line = Math.max(line, band(x, crossing - STOP, 0.15));
        if (z < middle && z > south + 0.35) line = Math.max(line, band(x, crossing + STOP, 0.15));
        if (near < 1.5 && z < north - 0.5 && z > south + 0.5) {
          const across = (z - (south + 0.5)) / 0.5;
          const bar = Math.floor(across) % 2 === 0 ? 1 : 0;
          const soft = Math.min(1, (1.5 - near) * perMetre * 0.5);
          line = Math.max(
            line,
            bar * soft * Math.min(1, Math.min(across % 1, 1 - (across % 1)) * 40),
          );
        }
        const wear = fbm(x * 0.4, z * 0.4, 8, 157, 4);
        const chips = noise(x * 25, z * 25, 100000, 159);
        line *= Math.min(1, Math.max(0, (wear - 0.22) * 4)) * (chips > 0.18 ? 1 : 0.35);
        line *= Math.min(1, Math.max(0, -f / 0.35));
        c = mix(c, white, line * 0.92);
        // Cracks, a few running with moss.
        const along = fbm(x * 0.12, z * 0.3, 8, 161, 4);
        const net = fbm(x * 0.3, z * 0.3, 8, 163, 3);
        const crackAt = Math.max(
          Math.max(0, 1 - Math.abs(along - 0.5) / 0.007) * (net > 0.5 ? 1 : 0),
          Math.max(0, 1 - Math.abs(net - 0.5) / 0.005) * (along > 0.6 ? 1 : 0),
        );
        const mossy = fbm(x * 0.2, z * 0.2, 8, 165, 2) > 0.6;
        c = mix(c, mossy ? moss : crack, crackAt * 0.9);
        // Grime gathered along the kerbs.
        const gutter = Math.max(0, 1 - Math.min(north - z, z - south) / 0.3);
        c = mix(c, [0x30, 0x34, 0x36], gutter * 0.35);
      }
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  return texture(data, W, H);
}

/**
 * Pavement slabs over a `w × d` strip: square concrete slabs half a metre across, laid in
 * staggered rows, each its own shade, with dark joints, moss in some, and pale worn edges.
 */
function paving(w: number, d: number, perMetre: number, seed: number) {
  const W = Math.round(w * perMetre);
  const H = Math.round(d * perMetre);
  const data = new Uint8Array(W * H * 4);
  const size = 0.5;
  const base = [0xa9, 0xa6, 0xa0];
  const joint = [0x4c, 0x4d, 0x4b];
  const moss = [0x4a, 0x5e, 0x2a];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) / perMetre;
      const z = (j + 0.5) / perMetre;
      const row = Math.floor(z / size);
      const sx = x + (row % 2) * size * 0.5;
      const col = Math.floor(sx / size);
      const [u, v] = [sx / size - col, z / size - row];
      const edge = Math.min(u, 1 - u, v, 1 - v) * size;
      const tone = 0.86 + hash(col, row, seed) * 0.2;
      const mottle = 0.9 + 0.2 * fbm(x * 0.6, z * 0.6, 8, seed + 3, 4);
      const speck = noise(x * 70, z * 70, 100000, seed + 5);
      let c = base.map((b) => b * tone * mottle * (0.94 + 0.12 * speck));
      // A worn lighter rim round each slab, and the joint between.
      c = mix(c, [0xc4, 0xc1, 0xba], Math.max(0, 1 - edge / 0.02) * 0.4);
      const inJoint = Math.max(0, Math.min(1, (0.008 - edge) / 0.004 + 0.5));
      const mossy = fbm(x * 0.8, z * 0.8, 8, seed + 7, 3) > 0.58;
      c = mix(c, mossy ? moss : joint, inJoint);
      // Stains here and there.
      const stain = Math.max(0, fbm(x * 0.3, z * 0.3, 8, seed + 9, 3) - 0.62) * 2.2;
      c = c.map((v) => v * (1 - stain * 0.35));
      const k = (j * W + i) * 4;
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = 255;
    }
  return texture(data, W, H);
}

function texture(data: Uint8Array, W: number, H: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** The road's surface, out a little past the pavements' ends. */
function road(root: THREE.Group): void {
  const { x0, x1, north, south } = STREET;
  const outline: [number, number][] = [
    [x0 - 1.0, north + 0.3],
    [x1 + 1.0, north + 0.3],
    [x1 + 1.3, (north + south) / 2],
    [x1 + 0.9, south - 0.3],
    [x0 - 0.8, south - 0.3],
    [x0 - 1.2, (north + south) / 2],
  ];
  const field = polygonField(outline);
  const rect: [number, number, number, number] = [
    x0 - 2.2,
    south - 0.4,
    x1 - x0 + 4.4,
    north - south + 0.8,
  ];
  const geo = new THREE.PlaneGeometry(rect[2], rect[3]);
  geo.rotateX(-Math.PI / 2);
  const surface = new THREE.Mesh(
    geo,
    groundMaterial(0xffffff, { map: asphalt(field, rect, 100), shine: 0.3, grain: 0.8 }),
  );
  surface.position.set(rect[0] + rect[2] / 2, 0.003, rect[1] + rect[3] / 2);
  surface.renderOrder = 0.5;
  root.add(surface);
}

/**
 * A pavement along the road on `side`: its body, its slabs on top, and its kerb of pale stone
 * blocks, each with a strip of cyan light set into its face.
 */
function pavement(root: THREE.Group, side: 'north' | 'south'): void {
  const { x0, x1, pavement: deep } = STREET;
  const s = side === 'north' ? 1 : -1;
  const face = side === 'north' ? STREET.north : STREET.south;
  const back = face + s * deep;
  const len = x1 - x0;
  const midZ = (face + back) / 2;
  cbox(
    root,
    concrete(),
    (x0 + x1) / 2,
    (PAVE - 0.004) / 2,
    midZ + s * 0.05,
    // Its ends just short of the kerb's, rather than in the same planes.
    len - 0.008,
    PAVE - 0.004,
    deep - 0.1,
    0.03,
  );
  const top = new THREE.PlaneGeometry(len - 0.04, deep - KERB.depth - 0.02);
  top.rotateX(-Math.PI / 2);
  const slabs = new THREE.Mesh(
    top,
    groundMaterial(0xffffff, {
      map: paving(len, deep - KERB.depth, 100, side === 'north' ? 201 : 211),
      shine: 0.35,
      grain: 0.5,
    }),
  );
  slabs.position.set((x0 + x1) / 2, PAVE, face + s * (KERB.depth + (deep - KERB.depth) / 2));
  root.add(slabs);
  // The kerb, in blocks a metre or so long.
  const rand = rng(side === 'north' ? 31 : 37);
  const line = glow(CAR.blue, 1.3);
  for (let x = x0; x < x1 - 0.05;) {
    const l = Math.min(0.9 + rand() * 0.25, x1 - x);
    const zc = face + s * (KERB.depth / 2);
    cbox(
      root,
      kerbStone(),
      x + l / 2,
      KERB.height / 2,
      zc,
      l - 0.012,
      KERB.height,
      KERB.depth,
      0.02,
    );
    cbox(root, line, x + l / 2, 0.075, face - s * 0.002, l - 0.14, 0.014, 0.006, 0.003);
    x += l;
  }
}

/**
 * Tactile paving where the crossing meets the pavement on `side`: a yellow pad studded with
 * rows of small domes.
 */
function tactile(root: THREE.Group, side: 'north' | 'south'): void {
  const s = side === 'north' ? 1 : -1;
  const face = side === 'north' ? STREET.north : STREET.south;
  const [w, d] = [2.6, 0.8];
  const zc = face + s * (KERB.depth + 0.05 + d / 2);
  const yellow = mat(0xd9a520, { mottle: 'plastic', roughness: 0.55 });
  cbox(root, yellow, STREET.crossing, PAVE + 0.004, zc, w, 0.012, d, 0.004);
  const dome = new THREE.SphereGeometry(0.02, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const step = 0.066;
  const nx = Math.floor((w - 0.06) / step);
  const nz = Math.floor((d - 0.06) / step);
  const studs = new THREE.InstancedMesh(dome, yellow, nx * nz);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      m.makeTranslation(
        STREET.crossing - ((nx - 1) * step) / 2 + i * step,
        PAVE + 0.01,
        zc - ((nz - 1) * step) / 2 + j * step,
      );
      studs.setMatrixAt(n++, m);
    }
  studs.castShadow = studs.receiveShadow = true;
  root.add(studs);
}

/**
 * A manhole cover in the road: a disc of cast iron, its pattern in relief, in a frame of the same
 * iron set flush with the road.
 */
function manhole(root: THREE.Group, x: number, z: number, lifts = true): void {
  const g = at(root, x, z, hash(Math.round(x), Math.round(z), 3) * Math.PI, 0);
  g.name = 'fitting';
  const frame = new THREE.RingGeometry(COVER_RADIUS - 0.004, COVER_RADIUS + 0.045, 64);
  frame.rotateX(-Math.PI / 2);
  put(g, frame, iron(), 0, 0.006);
  const disc = new THREE.CircleGeometry(COVER_RADIUS, 64);
  disc.rotateX(-Math.PI / 2);
  if (!lifts) {
    put(g, disc, coverIron(), 0, 0.009);
    return;
  }
  // The shaft's dark mouth under the cover, inside the frame.
  const mouth = new THREE.CircleGeometry(COVER_RADIUS - 0.004, 64);
  mouth.rotateX(-Math.PI / 2);
  put(g, mouth, dark(), 0, 0.007);
  // The cover: a click lifts it, swings it up off the frame and sets it down on the road beside
  // the hole; another puts it back.
  const cover = new THREE.Group();
  cover.name = MOVING;
  g.add(cover);
  put(cover, disc, coverIron(), 0, 0.009);
  const lift = addGadget(
    g,
    new Toggle([cover], ['lift the manhole cover', 'put back the manhole cover'], (k) => {
      const up = Math.sin(k * Math.PI);
      cover.position.set(k * (COVER_RADIUS * 2 + 0.12), up * 0.16 + k * 0.004, 0);
      cover.rotation.z = up * 0.35;
    }),
  );
  lift.noise = ['thump', 'thump'];
}

/** A drain in the gutter against the kerb on `side`: a cast iron grate, slotted over a dark pit. */
function drain(root: THREE.Group, x: number, side: 'north' | 'south'): void {
  const s = side === 'north' ? 1 : -1;
  const z = (side === 'north' ? STREET.north : STREET.south) - s * 0.2;
  const top = new THREE.PlaneGeometry(GRATE.long, GRATE.wide);
  top.rotateX(-Math.PI / 2);
  put(root, top, grateIron(), x, 0.009, z);
}

// ---------------------------------------------------------------------------------------------
// Street furniture. Each is built at its own origin on the pavement, facing +x.

/** A bolted foot: a rounded charcoal block with a steel bolt head at each corner. */
function foot(g: THREE.Object3D, w: number, h: number): void {
  rbox(g, charcoal(), 0, h / 2, 0, w, h, w, Math.min(0.05, h / 3));
  for (const [a, b] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const bolt = new THREE.CylinderGeometry(0.022, 0.022, 0.03, 8);
    put(g, bolt, polished(), (a! * w) / 2 - a! * 0.06, h + 0.01, (b! * w) / 2 - b! * 0.06);
  }
}

/**
 * A street lamp: a tall teal pole on a bolted foot, a cyan ring of light round it near the
 * ground, an arm curving out over the road (+x) to a long charcoal pod glowing white underneath
 * and edged in cyan.
 */
function streetLamp(parent: THREE.Object3D): void {
  const g = new THREE.Group();
  parent.add(g);
  foot(g, 0.42, 0.42);
  const pole = new THREE.CylinderGeometry(0.065, 0.1, 4.2, 24);
  put(g, pole, paint(), 0, 0.42 + 2.1);
  // Bands round it: steel at its foot and head, a ring of light low down.
  for (const y of [0.5, 4.5]) {
    const band = new THREE.CylinderGeometry(
      0.11 - (y / 4.6) * 0.035,
      0.11 - (y / 4.6) * 0.035,
      0.06,
      24,
    );
    put(g, band, polished(), 0, y);
  }
  const ring = new THREE.TorusGeometry(0.1, 0.012, 8, 32);
  ring.rotateX(Math.PI / 2);
  put(g, ring, glow(CAR.blue, 2), 0, 0.85);
  // The arm, from the pole's head out over the road.
  const arm = bentPath(
    [
      new THREE.Vector3(0, 4.45, 0),
      new THREE.Vector3(0, 5.05, 0),
      new THREE.Vector3(0.5, 5.2, 0),
      new THREE.Vector3(1.75, 5.2, 0),
    ],
    0.35,
  );
  tube(g, arm, 0.05, paint());
  // The pod.
  const pod = roundedOutline(
    [
      [-0.55, -0.06, 0.05],
      [0.5, -0.06, 0.05],
      [0.6, 0.02, 0.06],
      [0.45, 0.08, 0.06],
      [-0.55, 0.08, 0.06],
    ],
    0.03,
  );
  putSlab(g, pod, 0.32, charcoal(), 0.03, 1.55, 5.18, 0);
  // Its light and the pod's edges, fed by the mains (see `powered`).
  const lit = dimmable(glow(0xeaf8ff, 2.8), glow(CAR.blue, 2.2));
  powered(g, lit.set);
  cbox(g, lit.mats[0], 1.55, 5.11, 0, 0.82, 0.02, 0.2, 0.008);
  for (const z of [-0.155, 0.155]) cbox(g, lit.mats[1], 1.55, 5.18, z, 0.9, 0.012, 0.008, 0.003);
  const cap = new THREE.SphereGeometry(0.05, 16, 8);
  put(g, cap, polished(), 0, 5.06, 0);
}

/** A face of `rows` lines of 5-wide pixels, painted `on` where marked, as a texture. */
function pixels(rows: string[], on: number, off: number, pad = 2): THREE.DataTexture {
  const W = rows[0]!.length + pad * 2;
  const H = rows.length + pad * 2;
  const k = 6;
  const data = new Uint8Array(W * k * H * k * 4);
  const rgb = (c: number) => {
    const s = new THREE.Color(c).convertLinearToSRGB();
    return [s.r * 255, s.g * 255, s.b * 255, 255];
  };
  const [a, b] = [rgb(on), rgb(off)];
  for (let y = 0; y < H * k; y++)
    for (let x = 0; x < W * k; x++) {
      const r = rows[rows.length - 1 - (Math.floor(y / k) - pad)];
      const ch = r?.[Math.floor(x / k) - pad];
      data.set(ch === '#' ? a : b, (y * W * k + x) * 4);
    }
  const t = new THREE.DataTexture(data, W * k, H * k);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const STANDING = [
  '...###...',
  '...###...',
  '....#....',
  '..#####..',
  '.#.###.#.',
  '.#.###.#.',
  '...###...',
  '...#.#...',
  '...#.#...',
  '...#.#...',
  '...#.#...',
  '..##.##..',
];
const WALKING = [
  '....##...',
  '....##...',
  '.....#...',
  '...####..',
  '..#.##.#.',
  '.#..##..#',
  '....##...',
  '...#..#..',
  '..#....#.',
  '..#....#.',
  '.#.....#.',
  '.#......#',
];

/** The crossing's sign: a blue square, a white walking figure on white bars under it. */
function crossingSign(size: number): THREE.Mesh {
  const rows = [
    '#################',
    '#...............#',
    '#......##.......#',
    '#......##.......#',
    '#.......#.......#',
    '#.....####......#',
    '#....#.##.#.....#',
    '#...#..##..#....#',
    '#......##.......#',
    '#.....#..#......#',
    '#....#....#.....#',
    '#...#......#....#',
    '#...............#',
    '#.##.##.##.##.#.#',
    '#.##.##.##.##.#.#',
    '#...............#',
    '#################',
  ];
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    madeOf(
      new THREE.MeshStandardMaterial({ map: pixels(rows, 0xf2f2ee, 0x1d5fb8, 0), roughness: 0.4 }),
      Surface.None,
    ),
  );
  m.castShadow = m.receiveShadow = true;
  return m;
}

/**
 * The crossing's lights, which its two traffic lights share and change together: the traffic's
 * red, amber and green, the walk signals' red and green figures, and the push buttons' WAIT.
 */
interface CrossingLamps {
  red: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  green: THREE.MeshStandardMaterial;
  stop: THREE.MeshStandardMaterial;
  walk: THREE.MeshStandardMaterial;
  wait: THREE.MeshStandardMaterial;
  /** Each push button's box, to press it by, and the button in it, which goes in. */
  boxes: THREE.Object3D[];
  buttons: THREE.Object3D[];
}

/** A lamp's lens in `colour`: lit (`on` 1) it glows; dark it shows its colour faintly. */
function lens(colour: number): THREE.MeshStandardMaterial {
  return glow(colour, 3.2).clone();
}

/** `m` (one of `lens`'s) lit `k` of the way (0 dark, 1 lit), `full` bright when lit. */
function shine(m: THREE.MeshStandardMaterial, k: number, full = 3.2): void {
  const c = m.emissive;
  m.color.setRGB(c.r * (0.12 + 0.88 * k), c.g * (0.12 + 0.88 * k), c.b * (0.12 + 0.88 * k));
  m.emissiveIntensity = full * k;
}

/** The crossing's lamps, made once for both its lights (see `CrossingLamps`). */
function crossingLamps(): CrossingLamps {
  const sign = (rows: string[], colour: number) =>
    madeOf(
      new THREE.MeshStandardMaterial({
        color: 0x0b0d0e,
        roughness: 0.3,
        emissive: colour,
        emissiveMap: pixels(rows, 0xffffff, 0x000000),
        emissiveIntensity: 3,
      }),
      Surface.None,
    ) as THREE.MeshStandardMaterial;
  const wait = litSign('WAIT', CAR.amber, 0.1).material as THREE.MeshStandardMaterial;
  return {
    red: lens(0xff2a20),
    amber: lens(CAR.amber),
    green: lens(0x2fe07a),
    stop: sign(STANDING, 0xff3020),
    walk: sign(WALKING, 0x40f090),
    wait,
    boxes: [],
    buttons: [],
  };
}

/**
 * A traffic light for the crossing: a charcoal pole on a bolted foot; up it a housing of three
 * hooded lamps facing the traffic (+x), its back edged in cyan; below that a walk signal facing
 * across the road (+z), its red and green figures; and a yellow push-button box facing the
 * pavement behind it (-z), WAIT over its button. Its lamps are `lamps`, which the crossing
 * changes (see `Crossing`).
 */
function trafficLight(parent: THREE.Object3D, lamps: CrossingLamps): void {
  const g = new THREE.Group();
  parent.add(g);
  foot(g, 0.34, 0.3);
  const pole = new THREE.CylinderGeometry(0.06, 0.07, 3.2, 20);
  put(g, pole, gunmetal(), 0, 0.3 + 1.6);
  const cap = new THREE.SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  put(g, cap, polished(), 0, 3.5);
  // The lamps' housing, out on the pole's traffic side.
  const hx = 0.2;
  const hy = 2.75;
  rbox(g, charcoal(), hx, hy, 0, 0.24, 0.9, 0.32, 0.06);
  cbox(g, gunmetal(), hx - 0.13, hy, 0, 0.03, 1.02, 0.42, 0.012);
  for (const s of [-1, 1])
    cbox(g, glow(CAR.blue, 1.6), hx - 0.13, hy, s * 0.212, 0.032, 0.96, 0.008, 0.003);
  cbox(g, gunmetal(), 0.04, hy + 0.25, 0, 0.1, 0.06, 0.08, 0.01);
  cbox(g, gunmetal(), 0.04, hy - 0.25, 0, 0.1, 0.06, 0.08, 0.01);
  const lights: [number, THREE.Material][] = [
    [0.27, lamps.red],
    [0, lamps.amber],
    [-0.27, lamps.green],
  ];
  for (const [dy, m] of lights) {
    const y = hy + dy;
    const disc = new THREE.CircleGeometry(0.085, 28);
    disc.rotateY(Math.PI / 2);
    put(g, disc, m, hx + 0.122, y, 0);
    const rim = new THREE.TorusGeometry(0.092, 0.01, 8, 28);
    rim.rotateY(Math.PI / 2);
    put(g, rim, polished(), hx + 0.124, y, 0);
    // The hood over it: half a short tube, open underneath.
    const hood = new THREE.CylinderGeometry(0.105, 0.105, 0.13, 20, 1, true, 0, Math.PI);
    hood.rotateZ(Math.PI / 2);
    put(
      g,
      hood,
      mat(CAR.trim, { mottle: 'plastic', roughness: 0.6, side: THREE.DoubleSide }),
      hx + 0.18,
      y,
      0,
    );
  }
  // The walk signal, facing across the road.
  const wy = 2.0;
  rbox(g, charcoal(), 0, wy, 0.2, 0.26, 0.5, 0.2, 0.04);
  for (const [m, dy] of [
    [lamps.stop, 0.11],
    [lamps.walk, -0.11],
  ] as const) {
    const figure = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.2), m);
    figure.position.set(0, wy + dy, 0.302);
    g.add(figure);
  }
  // The push-button box, at hand height, facing along the pavement (-z) toward those waiting.
  const by = 1.12;
  const box = rbox(
    g,
    mat(BUS.yellow, { mottle: 'plastic', roughness: 0.45 }),
    0,
    by,
    -0.11,
    0.16,
    0.3,
    0.12,
    0.03,
  );
  lamps.boxes.push(box);
  // The button, in a group of its own so that a press pushes it in.
  const press = new THREE.Group();
  press.name = MOVING;
  g.add(press);
  const button = new THREE.CylinderGeometry(0.028, 0.03, 0.02, 20);
  button.rotateX(Math.PI / 2);
  put(press, button, polished(), 0, by - 0.04, -0.175);
  const halo = new THREE.TorusGeometry(0.04, 0.006, 6, 24);
  put(press, halo, glow(CAR.blue, 2), 0, by - 0.04, -0.172);
  lamps.buttons.push(press);
  const wait = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1 / 3.4), lamps.wait);
  wait.rotation.y = Math.PI;
  wait.position.set(0, by + 0.08, -0.171);
  g.add(wait);
}

/**
 * The crossing, working as a pelican crossing does: the traffic's lights green and the walk
 * signals' red figure lit till someone presses a button (either side), which lights WAIT on
 * both; a moment later the traffic gets amber, then red; then the green figure, beeping, for a
 * while to cross; then the green figure and the amber flash together, the last to cross going
 * on over and the traffic free to go if the crossing is clear; then green again, and the red
 * figure. A press while it is busy only clicks the button.
 */
export class Crossing implements Gadget {
  /** The stages, each with how long it lasts (s). */
  static readonly STAGES = [
    ['idle', Infinity],
    ['waiting', 2.5],
    ['amber', 3],
    ['red', 1.5],
    ['walk', 7],
    ['flashing', 4],
    ['clearing', 1],
  ] as const;
  /** The stage it is in, and how long it has been in it. */
  stage = 0;
  time = 0;
  /** The mains, from 0 (cut: every lamp dark) to 1. */
  power = 1;
  /** How long since each button was pressed, for its going in and out. */
  private pressed: number[];
  private beepIn = 0;
  readonly handles: THREE.Object3D[];

  constructor(private readonly lamps: CrossingLamps) {
    this.handles = lamps.boxes;
    this.pressed = lamps.buttons.map(() => Infinity);
    this.show();
  }

  /** What stage it is in, by name. */
  get now(): (typeof Crossing.STAGES)[number][0] {
    return Crossing.STAGES[this.stage]![0];
  }

  hint(): string {
    return this.now === 'idle' ? 'press the button to cross' : 'press the button';
  }

  use(): void {
    // The nearest button is the one pressed: both go in, as nobody sees the other.
    this.pressed = this.pressed.map(() => 0);
    sound('button', this.lamps.boxes[0]!);
    if (this.now === 'idle' && this.power > 0.5) this.go(1);
  }

  private go(stage: number): void {
    this.stage = stage % Crossing.STAGES.length;
    this.time = 0;
  }

  update(dt: number): void {
    this.time += dt;
    // With the power cut it stops where it is, dark, and starts again from green.
    if (this.power < 0.5) this.go(0);
    else if (this.time >= Crossing.STAGES[this.stage]![1]) this.go(this.stage + 1);
    for (const [i, b] of this.lamps.buttons.entries()) {
      this.pressed[i] = this.pressed[i]! + dt;
      // In 6 mm, quickly, and out again.
      const t = this.pressed[i]!;
      b.position.z = t < 0.25 ? 0.006 * Math.sin((t / 0.25) * Math.PI) : 0;
    }
    if (this.now === 'walk' && this.power > 0.5) {
      this.beepIn -= dt;
      if (this.beepIn <= 0) {
        this.beepIn = 0.35;
        for (const box of this.lamps.boxes) sound('beep', box);
      }
    } else this.beepIn = 0;
    this.show();
  }

  /** Lights the lamps for the stage it is in. */
  private show(): void {
    const { red, amber, green, stop, walk, wait } = this.lamps;
    const blink = Math.floor(this.time * 2.5) % 2 === 0 ? 1 : 0;
    const on = {
      idle: [0, 0, 1, 1, 0, 0],
      waiting: [0, 0, 1, 1, 0, 1],
      amber: [0, 1, 0, 1, 0, 1],
      red: [1, 0, 0, 1, 0, 1],
      walk: [1, 0, 0, 0, 1, 0],
      flashing: [0, blink, 0, 0, blink, 0],
      clearing: [1, 0, 0, 1, 0, 0],
    }[this.now];
    const p = this.power;
    [red, amber, green].forEach((m, i) => shine(m, on[i]! * p));
    stop.emissiveIntensity = (0.12 + 2.9 * on[3]!) * p;
    walk.emissiveIntensity = (0.12 + 2.9 * on[4]!) * p;
    wait.emissiveIntensity = (0.05 + 2.4 * on[5]!) * p;
  }
}

/**
 * The crossing's sign on its own mast: a straight teal pole on a bolted foot, a short straight
 * arm out over the road (+x), and the sign fixed under the arm's end facing the traffic both ways
 * (±z), in a charcoal box edged in cyan and glowing white underneath to light the crossing.
 */
function crossingMast(parent: THREE.Object3D, reach: number): void {
  const g = new THREE.Group();
  parent.add(g);
  foot(g, 0.36, 0.36);
  const top = 4.9;
  const pole = new THREE.CylinderGeometry(0.06, 0.085, top + 0.05 - 0.36, 24);
  put(g, pole, paint(), 0, (top + 0.05 + 0.36) / 2);
  const band = new THREE.CylinderGeometry(0.095, 0.095, 0.06, 24);
  put(g, band, polished(), 0, 0.46);
  const ring = new THREE.TorusGeometry(0.09, 0.012, 8, 32);
  ring.rotateX(Math.PI / 2);
  put(g, ring, glow(CAR.blue, 2), 0, 0.8);
  const cap = new THREE.SphereGeometry(0.065, 16, 8);
  put(g, cap, polished(), 0, top, 0);
  const arm = new THREE.CylinderGeometry(0.045, 0.045, reach + 0.1, 16);
  arm.rotateZ(Math.PI / 2);
  put(g, arm, paint(), (reach + 0.1) / 2, top, 0);
  // The sign's box, fixed under the arm's end.
  const size = 0.62;
  const sy = top - 0.045 - (size + 0.08) / 2;
  rbox(g, charcoal(), reach, sy, 0, size + 0.08, size + 0.08, 0.1, 0.03);
  cbox(g, gunmetal(), reach, top - 0.045, 0, 0.3, 0.03, 0.12, 0.01);
  for (const s of [-1, 1]) {
    const sign = crossingSign(size);
    // Two millimetres off the box: half of one, and far off they fought over every pixel.
    sign.position.set(reach, sy, s * 0.052);
    if (s < 0) sign.rotation.y = Math.PI;
    g.add(sign);
    cbox(g, glow(CAR.blue, 2), reach, sy - size / 2 - 0.03, s * 0.051, size, 0.012, 0.004, 0.002);
  }
  cbox(g, glow(0xeaf8ff, 2.6), reach, sy - size / 2 - 0.041, 0, size - 0.1, 0.004, 0.06, 0.001);
}

/**
 * A guard railing `length` long: charcoal posts with steel caps and a cyan eye, a steel rail
 * along their tops and one low down, and between each pair a teal panel pierced with round holes.
 */
function railing(parent: THREE.Object3D, length: number): void {
  const g = new THREE.Group();
  parent.add(g);
  const bays = Math.max(1, Math.round(length / 1.25));
  const bay = length / bays;
  for (let k = 0; k <= bays; k++) {
    const x = -length / 2 + k * bay;
    rbox(g, charcoal(), x, 0.5, 0, 0.07, 1.0, 0.07, 0.02);
    const cap = new THREE.SphereGeometry(0.045, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
    put(g, cap, polished(), x, 1.0, 0);
    for (const s of [-1, 1]) {
      const eye = new THREE.CircleGeometry(0.012, 12);
      if (s < 0) eye.rotateY(Math.PI);
      put(g, eye, glow(CAR.blue, 2.4), x, 0.86, s * 0.0362);
    }
  }
  for (const y of [0.96, 0.22]) {
    const rail = new THREE.CylinderGeometry(0.022, 0.022, length, 14);
    rail.rotateZ(Math.PI / 2);
    put(g, rail, polished(), 0, y, 0);
  }
  for (let k = 0; k < bays; k++) {
    const cx = -length / 2 + (k + 0.5) * bay;
    const w = bay - 0.12;
    const panel = roundedOutline(
      [
        [-w / 2, 0.3],
        [w / 2, 0.3],
        [w / 2, 0.88],
        [-w / 2, 0.88],
      ],
      0.04,
    );
    const holes = Math.max(2, Math.round(w / 0.3));
    for (let h = 0; h < holes; h++) {
      const p = new THREE.Path();
      p.absarc(-w / 2 + (h + 0.5) * (w / holes), 0.59, 0.08, 0, Math.PI * 2, false);
      panel.holes.push(p);
    }
    putFlatSlab(g, panel, 0.025, paint(), 0.008, cx, 0, 0);
  }
}

/**
 * A bin: a rounded body in `colour` on a charcoal foot, a charcoal lid with a dark slot in its
 * front (+x), a steel handle bar, and a cyan light strip showing it is not full.
 */
function bin(parent: THREE.Object3D, colour = TEAL): void {
  const g = new THREE.Group();
  parent.add(g);
  const body = mat(colour, {
    mottle: 'paint',
    roughness: 0.42,
    metalness: 0.15,
    clearcoat: 0.8,
    clearcoatRoughness: 0.25,
  });
  rbox(g, charcoal(), 0, 0.04, 0, 0.5, 0.08, 0.46, 0.02);
  // The body: rounded walls round a hollow, on its own floor.
  const walls = roundRect(0.5, 0.46, 0.07);
  walls.holes.push(roundRect(0.44, 0.4, 0.04));
  const wallGeo = slab(walls, 0.86, 0.01);
  wallGeo.rotateX(-Math.PI / 2);
  put(g, wallGeo, body, 0, 0.5, 0);
  cbox(g, dark(), 0, 0.11, 0, 0.42, 0.04, 0.38, 0.01);
  // What is in it: a black bag of rubbish, full, a can and a crumpled paper on it.
  const bag = mat(0x15181a, { mottle: 'plastic', roughness: 0.3, metalness: 0.1 });
  const lump = new THREE.SphereGeometry(0.17, 18, 12);
  for (const [x, y, z, k] of [
    [-0.05, 0.62, -0.04, 1.1],
    [0.07, 0.66, 0.06, 0.9],
    [0.02, 0.5, 0.0, 1.15],
  ])
    put(g, lump.clone().scale(k!, k! * 0.8, k!), bag, x!, y!, z!);
  put(
    g,
    new THREE.CylinderGeometry(0.033, 0.033, 0.12, 16),
    mat(SPORT.red, { mottle: 'metal', roughness: 0.3, metalness: 0.6 }),
    0.06,
    0.82,
    -0.05,
    0.3,
    0,
    1.3,
  );
  put(
    g,
    new THREE.IcosahedronGeometry(0.045, 0),
    mat(0xf1efe8, { mottle: 'plastic', roughness: 0.9 }),
    -0.08,
    0.82,
    0.06,
  );
  cbox(g, dark(), 0.27, 0.86, 0, 0.03, 0.08, 0.3, 0.012);
  cbox(g, glow(CAR.blue, 1.8), 0.262, 0.72, 0, 0.012, 0.02, 0.3, 0.004);
  const bar = bentPath(
    [
      new THREE.Vector3(0.26, 0.6, -0.17),
      new THREE.Vector3(0.31, 0.6, -0.17),
      new THREE.Vector3(0.31, 0.6, 0.17),
      new THREE.Vector3(0.26, 0.6, 0.17),
    ],
    0.03,
  );
  tube(g, bar, 0.012, polished());
  // A recycling mark: three cyan dots in a triangle on its face.
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 + Math.PI / 2;
    const dot = new THREE.CircleGeometry(0.018, 12);
    dot.rotateY(Math.PI / 2);
    put(g, dot, polished(), 0.261, 0.42 + Math.sin(a) * 0.04, Math.cos(a) * 0.04);
  }
  // The lid, hinged along its back edge, lifting at the front.
  const lid = hingedDoor(g, 'bin', new THREE.Vector3(-0.28, 0.935, 0), 'z', 1.75, (leaf) => {
    rbox(leaf, charcoal(), 0, 0.97, 0, 0.56, 0.07, 0.52, 0.03);
  });
  lid.noise = ['click', 'clunk'];
}

/**
 * A bench facing +x: two charcoal frames, a seat and a back of teal slats, steel arm rests, a
 * cyan light under the seat.
 */
function bench(parent: THREE.Object3D): void {
  const g = new THREE.Group();
  parent.add(g);
  const len = 1.9;
  for (const z of [-len / 2 + 0.15, len / 2 - 0.15]) {
    const side = roundedOutline(
      [
        [-0.28, 0],
        [-0.16, 0],
        [-0.12, 0.38],
        [0.24, 0.38],
        [0.24, 0.0],
        [0.32, 0.0],
        [0.32, 0.46],
        [-0.2, 0.46],
        [-0.36, 0.95],
        [-0.42, 0.95],
      ],
      0.03,
    );
    putSlab(g, side, 0.06, charcoal(), 0.012, 0, 0.012, z);
  }
  for (const x of [-0.12, 0.02, 0.16, 0.29]) cbox(g, paint(), x, 0.49, 0, 0.11, 0.045, len, 0.015);
  for (const y of [0.66, 0.84]) {
    const slat = cbox(g, paint(), -0.29 - (y - 0.66) * 0.33, y, 0, 0.045, 0.13, len, 0.015);
    slat.rotation.z = 0.32;
  }
  for (const z of [-len / 2 + 0.15, len / 2 - 0.15]) {
    const arm = bentPath(
      [
        new THREE.Vector3(-0.2, 0.68, z),
        new THREE.Vector3(0.3, 0.68, z),
        new THREE.Vector3(0.3, 0.47, z),
      ],
      0.06,
    );
    tube(g, arm, 0.018, polished());
  }
  cbox(g, glow(CAR.blue, 1.4), 0.1, 0.455, 0, 0.012, 0.01, len - 0.4, 0.003);
}

/** A hydrant: a red lathe-turned body on a charcoal flange, steel caps to the sides and on top. */
function hydrant(parent: THREE.Object3D): void {
  const g = new THREE.Group();
  parent.add(g);
  const red = mat(SPORT.red, {
    mottle: 'paint',
    roughness: 0.4,
    metalness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.2,
  });
  const profile = [
    [0, 0.08],
    [0.13, 0.08],
    [0.12, 0.12],
    [0.1, 0.14],
    [0.1, 0.52],
    [0.12, 0.55],
    [0.12, 0.6],
    [0.09, 0.66],
    [0.05, 0.7],
    [0, 0.71],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  put(g, new THREE.LatheGeometry(profile, 32), red);
  const flange = new THREE.CylinderGeometry(0.16, 0.17, 0.08, 24);
  put(g, flange, charcoal(), 0, 0.04);
  // Its caps: the one toward +x comes off on its chain when it is opened.
  const nozzle = new THREE.Group();
  nozzle.name = MOVING;
  nozzle.position.set(0.13, 0.43, 0);
  g.add(nozzle);
  for (const a of [0, Math.PI / 2, Math.PI]) {
    const cap = new THREE.CylinderGeometry(0.05, 0.055, 0.1, 6);
    cap.rotateZ(Math.PI / 2);
    const [cx, cz] = [Math.cos(a) * 0.13, Math.sin(a) * 0.13];
    const m =
      a === 0 ? put(nozzle, cap, polished(), 0, -0.03, 0) : put(g, cap, polished(), cx, 0.4, cz);
    m.rotation.y = -a;
  }
  const nut = new THREE.Group();
  nut.name = MOVING;
  g.add(nut);
  put(nut, new THREE.CylinderGeometry(0.03, 0.035, 0.05, 5), polished(), 0, 0.73);
  const ring = new THREE.TorusGeometry(0.105, 0.008, 6, 28);
  ring.rotateX(Math.PI / 2);
  put(g, ring, glow(CAR.blue, 1.8), 0, 0.3);
  // The water: drops thrown out of the open nozzle in an arc, and a puddle spreading under it.
  const water = waterMaterial();
  const DROPS = 90;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), water, DROPS);
  // All at the nozzle until they fly, so none sits at the foot sunk in the pavement.
  for (let i = 0; i < DROPS; i++)
    drops.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0.2, 0.43, 0));
  drops.visible = false;
  drops.frustumCulled = false;
  drops.renderOrder = 2;
  g.add(drops);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 12, 1, true), water);
  jet.rotation.z = -Math.PI / 2 + 0.25;
  jet.position.set(0.32, 0.43, 0);
  jet.visible = false;
  jet.renderOrder = 2;
  g.add(jet);
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), water);
  puddle.visible = false;
  puddle.renderOrder = 1;
  g.add(puddle);
  const m = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const size = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  let [time, wet] = [0, 0];
  const open = addGadget(
    g,
    new Toggle(
      [g],
      ['open the hydrant', 'shut the hydrant'],
      (k, dt) => {
        time += dt;
        // The nut turned round, and the cap swung down on its chain.
        nut.rotation.y = k * Math.PI * 4;
        nozzle.position.set(0.13 + 0.1 * Math.min(1, k * 3), 0.43 - 0.18 * k, 0);
        nozzle.rotation.z = -k * 1.2;
        const flow = THREE.MathUtils.clamp((k - 0.3) / 0.7, 0, 1);
        wet = THREE.MathUtils.clamp(wet + (flow > 0.5 ? dt / 8 : -dt / 20), 0, 1);
        puddle.visible = wet > 0.01;
        puddle.scale.setScalar(0.2 + 1.3 * wet);
        puddle.position.set(0.9 * wet + 0.2, 0.003, 0);
        water.opacity = 0.55;
        drops.visible = jet.visible = flow > 0;
        if (!drops.visible) return;
        jet.scale.set(flow, flow, flow);
        // Each drop out along +x at its own pace, falling as it goes, spread a little.
        for (let i = 0; i < DROPS; i++) {
          const phase = (time * 1.6 + ((i * 0.618) % 1)) % 1;
          const spread = Math.sin(i * 12.9898) * 0.5;
          const speed = 2.6 * flow * (0.9 + 0.2 * Math.sin(i * 4.1));
          const t = phase * 0.5;
          at.set(0.2 + speed * t, 0.43 + 1.2 * t - 4.9 * t * t, spread * t * 0.8);
          if (at.y < 0.01) at.y = 0.01;
          size.setScalar(0.6 + 0.8 * (1 - phase));
          m.compose(at, turn, size);
          drops.setMatrixAt(i, m);
        }
        drops.instanceMatrix.needsUpdate = true;
      },
      1.2,
    ),
  );
  open.noise = ['splash', 'clunk'];
}

/** A bollard: a charcoal post with a domed steel top, a cyan ring of light and a steel band. */
function bollard(parent: THREE.Object3D): void {
  const g = new THREE.Group();
  parent.add(g);
  const post = new THREE.CylinderGeometry(0.1, 0.11, 0.78, 24);
  put(g, post, charcoal(), 0, 0.39);
  const top = new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  put(g, top, polished(), 0, 0.78);
  const ring = new THREE.CylinderGeometry(0.102, 0.102, 0.04, 24, 1, true);
  put(g, ring, glow(CAR.blue, 2.2), 0, 0.64);
  const band = new THREE.CylinderGeometry(0.106, 0.108, 0.05, 24);
  put(g, band, polished(), 0, 0.2);
}

/**
 * A charging post for the cars: a slim teal pillar on a charcoal foot, a dark glass screen lit
 * cyan, a connector in its holster, its cable looped down to the pavement and back.
 */
function charger(parent: THREE.Object3D): void {
  const g = new THREE.Group();
  parent.add(g);
  rbox(g, charcoal(), 0, 0.05, 0, 0.42, 0.1, 0.32, 0.03);
  rbox(g, paint(), 0, 0.8, 0, 0.34, 1.4, 0.26, 0.06);
  rbox(g, charcoal(), 0, 1.55, 0, 0.38, 0.12, 0.3, 0.04);
  const screen = cbox(g, glass(), 0.17, 1.15, 0, 0.012, 0.32, 0.2, 0.01);
  const face = glow(CAR.blue, 1.6).clone();
  cbox(g, face, 0.177, 1.2, 0, 0.004, 0.12, 0.14, 0.002);
  const lamp = glow(0x2fe07a, 2).clone();
  cbox(g, lamp, 0.177, 1.06, -0.04, 0.004, 0.03, 0.06, 0.002);
  // The charge: a bar filling along the screen while it charges, cell by cell.
  const cell = glow(0x2fe07a, 2.2).clone();
  const cells: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const c = cbox(g, cell, 0.18, 1.2, -0.052 + i * 0.026, 0.002, 0.07, 0.02, 0.001);
    c.visible = false;
    cells.push(c);
  }
  // The holster and connector on its side.
  rbox(g, charcoal(), 0.05, 0.85, 0.16, 0.14, 0.2, 0.08, 0.02);
  const plug = new THREE.CylinderGeometry(0.035, 0.04, 0.16, 16);
  put(g, plug, polished(), 0.05, 0.86, 0.19);
  const cable = bentPath(
    [
      new THREE.Vector3(0.05, 0.77, 0.2),
      new THREE.Vector3(0.12, 0.25, 0.32),
      new THREE.Vector3(0.28, 0.03, 0.3),
      new THREE.Vector3(0.36, 0.03, 0.05),
      new THREE.Vector3(0.24, 0.12, -0.1),
      new THREE.Vector3(0.175, 0.4, -0.08),
    ],
    0.12,
  );
  tube(g, cable, 0.02, dark());
  // A click starts it charging (the screen goes green, the bar filling and starting again, the
  // lamp pulsing), another stops it.
  const idle = face.emissive.clone();
  const idleColour = face.color.clone();
  const busy = new THREE.Color(0x2fe07a);
  let time = 0;
  addGadget(
    g,
    new Toggle(
      [screen],
      ['start charging', 'stop charging'],
      (k, dt) => {
        time = k > 0.5 ? time + dt : 0;
        face.emissive.copy(idle).lerp(busy, k);
        face.color.copy(idleColour).lerp(busy, k);
        face.emissiveIntensity = 1.6 - k * 1.1;
        const lit = k > 0.5 ? Math.floor((time / 0.5) % 6) : 0;
        cells.forEach((c, i) => (c.visible = i < lit));
        lamp.emissiveIntensity = k > 0.5 ? 1.2 + 1.4 * (0.5 + 0.5 * Math.sin(time * 4)) : 2;
      },
      0.3,
    ),
  );
}

/**
 * A planter: a long charcoal trough, its rim standing a hand over the earth in it, grass grown
 * thick in that.
 */
function planter(parent: THREE.Object3D, seed: number): void {
  const g = new THREE.Group();
  parent.add(g);
  const [l, w] = [0.6, 1.4];
  const [top, earth, rim] = [0.48, 0.42, 0.06];
  rbox(g, charcoal(), 0, (earth - 0.02) / 2, 0, l, earth - 0.02, w, 0.05);
  // The rim: two long sides and two ends round the earth.
  for (const s of [-1, 1]) {
    rbox(
      g,
      charcoal(),
      (s * (l - rim)) / 2,
      (top + earth - 0.12) / 2,
      0,
      rim,
      top - earth + 0.12,
      w,
      0.025,
    );
    rbox(
      g,
      charcoal(),
      0,
      (top + earth - 0.12) / 2,
      (s * (w - rim)) / 2,
      l,
      top - earth + 0.12,
      rim,
      0.025,
    );
  }
  // A little over the planter's floor, not in its plane.
  put(g, soilBed(l - 2 * rim + 0.01, w - 2 * rim + 0.01, seed), soil(), 0, earth - 0.016, 0);
  cbox(g, glow(CAR.blue, 1.4), l / 2 + 0.001, 0.4, 0, 0.004, 0.012, w - 0.2, 0.002);
  const grass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const rand = rng(seed);
  for (let i = 0; i < 9; i++) {
    const t = new THREE.Mesh(tuft(900 + seed + i, 0.3 + rand() * 0.2, true), grass);
    t.position.set((rand() - 0.5) * (l - 0.2), earth - 0.01, (rand() - 0.5) * (w - 0.2));
    t.rotation.y = rand() * Math.PI * 2;
    t.castShadow = true;
    g.add(t);
  }
}

/** Builds the street, in place in the scene. */
export function buildStreet(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'street';
  const { crossing: cx, north, south } = STREET;
  road(root);
  pavement(root, 'north');
  pavement(root, 'south');
  tactile(root, 'north');
  tactile(root, 'south');
  manhole(root, -9.2, -15.6);
  // Under the road works' plate.
  manhole(root, 0.8, -17.6, false);
  drain(root, -7.2, 'north');
  drain(root, 1.8, 'north');
  drain(root, -1.4, 'south');
  drain(root, -10.4, 'south');

  // The lamps, staggered along both pavements, their arms out over the road.
  for (const x of [-10.6, -0.4]) streetLamp(at(root, x, north + 0.45, TO_ROAD.north));
  for (const x of [-8.2, 2.4]) streetLamp(at(root, x, south - 0.45, TO_ROAD.south));

  // The crossing's lights, one each side at its lane's stop line, short of the crossing, facing
  // the traffic coming at it, its walk signal facing the far pavement.
  const lamps = crossingLamps();
  trafficLight(at(root, cx - STOP + 0.4, north + 0.42, Math.PI), lamps);
  trafficLight(at(root, cx + STOP - 0.4, south - 0.42, 0), lamps);
  const crossing = addGadget(root, new Crossing(lamps));
  powered(root, (k) => (crossing.power = k));

  // The crossing's signs, one each side on its own mast at the crossing's edge, hung a little
  // out over the road.
  crossingMast(at(root, cx + 1.9, north + 0.42, TO_ROAD.north), 1.2);
  crossingMast(at(root, cx - 1.9, south - 0.42, TO_ROAD.south), 1.2);

  // Railings along the kerb either side of the crossing.
  // The west one ends short of the lamp on the pavement's edge there.
  railing(at(root, cx - 4.35, north + 0.3, 0), 2.7);
  railing(at(root, cx + 6.0, north + 0.3, 0), 2.0);
  railing(at(root, cx + 4.4, south - 0.3, 0), 2.5);

  // On the north pavement: a hydrant, a bin and a charging post.
  hydrant(at(root, -8.0, north + 1.5));
  bin(at(root, -11.9, north + 1.7, TO_ROAD.north));
  charger(at(root, 2.3, north + 1.8, TO_ROAD.north));

  // On the south pavement: a pair of bins, a bench, a planter and bollards at the crossing.
  bin(at(root, -11.2, south - 1.75, TO_ROAD.south), TEAL);
  bin(at(root, -10.6, south - 1.75, TO_ROAD.south), BUS.yellow);
  bench(at(root, -0.6, south - 1.6, TO_ROAD.south));
  planter(at(root, 1.3, south - 1.4, 0), 41);
  for (const x of [cx - 2.6, cx - 3.25]) bollard(at(root, x, south - 0.42));
  return root;
}
