import * as THREE from 'three';
import { CAR } from './car.ts';
import { doorRed, plinthMat, roofMat, seam, steel, trim, zinc } from './house.ts';
import { glow, mat, pbox, put, rng } from './kit.ts';
import { AT_NIGHT } from '../render/daynight.ts';

/**
 * The town round Chevron Street, in the houses' own style but built for being seen from past the
 * map's walls: terraced houses of painted panels on a charcoal plinth, charcoal bands at each
 * floor and posts at the party walls, windows in charcoal frames with steel sills, red doors under
 * canopies lit cyan, dark roofs with zinc gutters and chimneys; workshops clad in ribbed steel
 * with roller doors; and street trees. Their parts are plain boxes (no rounded edges, no
 * interiors, glass that is not see-through), a few thousand triangles a house, as each is seen
 * from six metres away and more. Each is built at its own origin, its front toward +z, standing
 * on the ground at y = 0.
 */

/** A storey's height, floor to floor; the plinth under the ground floor. */
export const STOREY = 2.9;
export const PLINTH = 0.3;
/** How deep a terraced house is, front to back. */
export const TERRACE_DEPTH = 8;

/**
 * The town's wall paint: the houses' paint in white, so that each house takes its own colour as
 * it is laid out (see `stamp` in `city.ts`), and its edges worn pale as theirs are.
 */
export const townWall = () =>
  mat(0xffffff, {
    mottle: 'paint',
    roughness: 0.48,
    metalness: 0.12,
    envMapIntensity: 1.3,
    clearcoat: 0.7,
    clearcoatRoughness: 0.25,
    vertexColors: true,
  });

/** The windows' glass: as the houses' tint, but not see-through (there is nothing behind it). */
const glass = () =>
  mat(0x231812, { mottle: 'none', roughness: 0.05, metalness: 0.2, envMapIntensity: 2.6 });

/** A window lit inside after dark: the same glass by day, a warm lamplight by night. */
export const litGlass = () => {
  const m = mat(0x2a1d14, {
    mottle: 'none',
    roughness: 0.08,
    metalness: 0.15,
    envMapIntensity: 2.4,
    emissive: 0xffc27a,
    emissiveIntensity: 0,
  });
  m.userData[AT_NIGHT] = 1.4;
  return m;
};

/** The street furniture's deep teal (as `street.ts`'s), for awnings and fascias. */
const teal = () => mat(0x2c6670, { mottle: 'paint', roughness: 0.42, metalness: 0.2 });

/** The colours the town's houses are painted, after the map's two houses and its cars. */
export const TOWN_COLOURS = [
  0x7fb2c2, // the houses' pale blue
  0x4f97a6, // a deeper teal
  0x9fb88e, // sage
  0xd9b25c, // mustard
  0xc0644c, // brick red
  0xe2d9c0, // cream
  0xb2bb68, // the off-roader's lime
  0x8fa3c9, // a dusty cornflower
];

/** A terraced house: how wide it is, how many storeys, and how it is fitted out. */
export interface TerraceHouse {
  width: number;
  storeys: number;
  /** Which side of its front its door is on: -1 its left (-x), 1 its right. */
  door: -1 | 1;
  /** Whether it ends its row on its left (-x) or right (+x): a window in that gable wall. */
  ends: { left: boolean; right: boolean };
  /** A shop on its ground floor: a window across its front, a lit fascia and an awning. */
  shop?: boolean;
  chimney?: boolean;
  /** Which of its windows are lit at night. */
  seed: number;
  /**
   * Built to be seen close to, from the map: its windows framed all round with a lintel over
   * them, seams down its walls between the bays, a downpipe front and back, standing seams up its
   * roof, a letterbox and handle on its door; and before it (if it has a front garden `garden`
   * deep) a low wall along the pavement with a gap at its gate.
   */
  fine?: boolean;
  garden?: number;
}

/** The roof's pitch, and how far the roof stands out over the walls at the eaves. */
const PITCH = (33 * Math.PI) / 180;
const EAVES = 0.32;

/**
 * A terraced house `width` wide and `TERRACE_DEPTH` deep: its body on a plinth, a charcoal band
 * at each floor and under its eaves, a post at its left party wall (and at its right where it
 * ends a row), its windows front and back, its door under a canopy lit cyan (or a shop across its
 * ground floor), a pitched roof with its ridge along the street, a gutter at each eave and a
 * chimney on its left party wall. Houses stand side by side in a row, each sharing its neighbour's
 * party wall.
 */
export function terraceHouse(o: TerraceHouse): THREE.Group {
  const g = new THREE.Group();
  const { width: W, storeys } = o;
  const D = TERRACE_DEPTH;
  const eave = PLINTH + storeys * STOREY + 0.25;
  const lit = rng(o.seed);
  const pane = () => (lit() < 0.45 ? litGlass() : glass());
  const fine = o.fine ?? false;

  pbox(g, plinthMat(), 0, PLINTH / 2, 0, W, PLINTH, D + 0.06);
  pbox(g, townWall(), 0, (PLINTH + eave) / 2, 0, W, eave - PLINTH, D);
  // The posts over the party walls, and the bands across the front and back.
  const posts = [-W / 2, ...(o.ends.right ? [W / 2] : [])];
  for (const x of posts)
    for (const z of [-D / 2, D / 2])
      pbox(g, trim(), x, (PLINTH + eave) / 2, z, 0.16, eave - PLINTH, 0.16);
  for (const s of [-1, 1]) {
    for (let k = 1; k < storeys; k++)
      pbox(g, trim(), 0, PLINTH + k * STOREY, s * (D / 2 + 0.015), W, 0.1, 0.03);
    pbox(g, trim(), 0, eave - 0.09, s * (D / 2 + 0.02), W, 0.18, 0.04);
  }

  // The windows, in bays across the front and the back.
  const bays = Math.max(1, Math.round((W - 1.2) / 1.9));
  const bayX = (i: number) => -W / 2 + ((i + 0.5) * W) / bays;
  const doorBay = o.door < 0 ? 0 : bays - 1;
  const front = new THREE.Group();
  front.position.z = D / 2;
  const back = new THREE.Group();
  back.position.z = -D / 2;
  back.rotation.y = Math.PI;
  g.add(front, back);
  for (let k = 0; k < storeys; k++) {
    const y = PLINTH + k * STOREY + 1.55;
    for (let i = 0; i < bays; i++) {
      if (k > 0 || (!o.shop && i !== doorBay)) windowAt(front, bayX(i), y, 1.0, 1.3, pane(), fine);
      // At the back, the ground floor's door where the front's is (as seen from behind).
      if (k > 0 || i !== bays - 1 - doorBay) windowAt(back, bayX(i), y, 1.0, 1.3, pane(), fine);
    }
  }
  if (o.shop) shopfront(front, W, o.door);
  else doorway(front, bayX(doorBay), doorRed(), true, fine);
  doorway(back, bayX(bays - 1 - doorBay), trim(), false, fine);
  if (fine) {
    for (const face of [front, back]) {
      // Seams down the wall between the bays, and a downpipe from the gutter by the right party
      // wall (as seen from before that wall) to a shoe on the plinth.
      for (let i = 1; i < bays; i++)
        pbox(
          face,
          seam(),
          -W / 2 + (i * W) / bays,
          (PLINTH + eave) / 2,
          0.006,
          0.03,
          eave - PLINTH,
          0.012,
        );
      const px = W / 2 - 0.22;
      const pipe = new THREE.CylinderGeometry(0.045, 0.045, eave - PLINTH - 0.25, 10, 1, true);
      put(face, pipe, zinc(), px, (PLINTH + eave - 0.25) / 2 + 0.1, 0.08);
      pbox(face, zinc(), px, PLINTH + 0.12, 0.11, 0.12, 0.08, 0.16);
    }
    if (o.garden && !o.shop) gardenWall(front, W, o.garden, bayX(doorBay));
  }

  // A window in each storey of a gable wall that ends a row.
  for (const [end, s] of [
    [o.ends.left, -1],
    [o.ends.right, 1],
  ] as const) {
    if (!end) continue;
    const side = new THREE.Group();
    side.position.x = (s * W) / 2;
    side.rotation.y = (s * Math.PI) / 2;
    g.add(side);
    for (let k = 0; k < storeys; k++)
      windowAt(side, 0, PLINTH + k * STOREY + 1.55, 0.9, 1.2, pane(), fine);
  }

  roof(g, W, D, eave, o.ends, fine);
  if (o.chimney) {
    const ridge = eave + (D / 2) * Math.tan(PITCH);
    pbox(g, plinthMat(), -W / 2 + 0.45, ridge + 0.2, -0.6, 0.7, 1.4, 0.9);
    pbox(g, trim(), -W / 2 + 0.45, ridge + 0.94, -0.6, 0.86, 0.1, 1.06);
  }
  return g;
}

/**
 * A window `w × h` with its middle at (`x`, `y`) on the wall `parent`'s origin is on, the wall
 * facing +z: a charcoal frame standing out of the wall, the glass in it, a bar across near its
 * top, and a steel sill under it; and if `fine` (seen close to), the frame's edge standing proud
 * all round the glass, a bar down it too, and a lintel of the plinth's stone over it.
 */
function windowAt(
  parent: THREE.Object3D,
  x: number,
  y: number,
  w: number,
  h: number,
  pane: THREE.Material,
  fine = false,
): void {
  // The frame a charcoal board behind the glass, standing out round it: four parts fewer than
  // a frame round it, which no one sees from the street.
  const f = 0.08;
  pbox(parent, trim(), x, y, 0.02, w + 2 * f, h + 2 * f, 0.04);
  pbox(parent, pane, x, y, 0.05, w, h, 0.02);
  pbox(parent, trim(), x, y + h * 0.18, 0.065, w, 0.04, 0.01);
  pbox(parent, steel(), x, y - h / 2 - f - 0.025, 0.08, w + 0.24, 0.05, 0.16);
  if (!fine) return;
  for (const s of [-1, 1]) {
    pbox(parent, trim(), x + (s * (w + f)) / 2, y, 0.07, f, h + 2 * f, 0.06);
    pbox(parent, trim(), x, y + (s * (h + f)) / 2, 0.07, w, f, 0.06);
  }
  pbox(parent, trim(), x, y, 0.065, 0.04, h, 0.01);
  pbox(parent, plinthMat(), x, y + h / 2 + f + 0.08, 0.04, w + 0.4, 0.16, 0.08);
}

/**
 * A low wall `W` long along the back of the pavement before a house's front garden, `garden`
 * deep, a charcoal coping on it, broken by its gate at `gate`.
 */
function gardenWall(front: THREE.Object3D, W: number, garden: number, gate: number): void {
  const z = garden - 0.12;
  const pieces = [
    [-W / 2, gate - 0.6],
    [gate + 0.6, W / 2],
  ];
  for (const [x0, x1] of pieces) {
    if (x1! - x0! < 0.2) continue;
    pbox(front, plinthMat(), (x0! + x1!) / 2, 0.25, z, x1! - x0!, 0.5, 0.2);
    pbox(front, trim(), (x0! + x1!) / 2, 0.53, z, x1! - x0!, 0.06, 0.26);
  }
  // The gate posts.
  for (const s of [-1, 1]) pbox(front, trim(), gate + s * 0.66, 0.36, z, 0.14, 0.72, 0.24);
}

/**
 * A doorway at `x` in the ground floor of the wall `parent`'s origin is on: a door of `leaf` in a
 * charcoal frame, a step before it, and (at the front) a canopy over it lit cyan underneath.
 */
function doorway(
  parent: THREE.Object3D,
  x: number,
  leaf: THREE.Material,
  canopy = true,
  fine = false,
): void {
  const [w, h] = [1.0, 2.15];
  const y = PLINTH + h / 2;
  pbox(parent, leaf, x, y, 0.02, w, h, 0.04);
  pbox(parent, glass(), x, y + 0.3, 0.045, 0.22, 1.0, 0.01);
  pbox(parent, steel(), x, PLINTH + 0.1, 0.045, w - 0.1, 0.16, 0.01);
  if (fine) {
    // A letterbox under the glass, a pull beside it, and its number lit cyan over it.
    pbox(parent, steel(), x, y - 0.35, 0.045, 0.32, 0.07, 0.012);
    pbox(parent, steel(), x + w / 2 - 0.14, y, 0.07, 0.03, 0.42, 0.04);
    pbox(parent, glow(CAR.blue, 1.6), x, y + h / 2 - 0.12, 0.045, 0.16, 0.08, 0.01);
  }
  pbox(parent, trim(), x, y + h / 2 + 0.05, 0.04, w + 0.2, 0.1, 0.08);
  for (const s of [-1, 1]) pbox(parent, trim(), x + s * (w / 2 + 0.05), y, 0.04, 0.1, h, 0.08);
  pbox(parent, plinthMat(), x, PLINTH / 2, 0.25, w + 0.5, PLINTH, 0.5);
  if (!canopy) return;
  const top = PLINTH + h + 0.35;
  pbox(parent, trim(), x, top, 0.32, w + 0.6, 0.1, 0.64);
  pbox(parent, glow(CAR.blue, 1.6), x, top - 0.055, 0.6, w + 0.48, 0.012, 0.02);
}

/**
 * A shop across the ground floor of the front `parent`'s origin is on, `W` wide: a window lit
 * by night across most of it, its door of glass at the `door` side, a charcoal fascia over it
 * with a cyan strip of light along its foot, and a teal awning out over the pavement.
 */
function shopfront(parent: THREE.Object3D, W: number, door: -1 | 1): void {
  const top = PLINTH + 2.5;
  const dx = door * (W / 2 - 0.85);
  const span = W - 2.2;
  const sx = -door * 0.55;
  pbox(parent, litGlass(), sx, PLINTH + 0.35 + 1.0, 0.015, span, 2.0, 0.02);
  for (const s of [-1, 1])
    pbox(parent, trim(), sx + (s * (span + 0.1)) / 2, PLINTH + 1.3, 0.04, 0.1, 2.2, 0.08);
  pbox(parent, trim(), sx, PLINTH + 0.18, 0.05, span + 0.2, 0.36, 0.1);
  pbox(parent, glass(), dx, PLINTH + 1.1, 0.015, 0.95, 2.2, 0.02);
  pbox(parent, steel(), dx, PLINTH + 1.1, 0.03, 0.04, 2.2, 0.03);
  pbox(parent, trim(), 0, top + 0.3, 0.06, W - 0.2, 0.6, 0.12);
  pbox(parent, glow(CAR.blue, 1.8), 0, top + 0.02, 0.125, W - 0.4, 0.03, 0.01);
  pbox(parent, teal(), sx, top - 0.12, 0.6, span + 0.4, 0.06, 1.1, [0.32, 0, 0]);
}

/**
 * The roof: two dark slabs pitched up from the eaves front and back to a ridge along the house,
 * standing out over the walls at the eaves (and at a gable that ends a row), a charcoal cap on
 * the ridge, the gable's triangle of wall under it, and a zinc gutter along each eave.
 */
function roof(
  g: THREE.Group,
  W: number,
  D: number,
  eave: number,
  ends: { left: boolean; right: boolean },
  fine = false,
): void {
  const rise = (D / 2) * Math.tan(PITCH);
  const slope = (D / 2 + EAVES) / Math.cos(PITCH);
  const x0 = -W / 2 - (ends.left ? 0.25 : 0);
  const x1 = W / 2 + (ends.right ? 0.25 : 0);
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  for (const s of [-1, 1]) {
    // From the ridge down past the wall by the eaves, its underside on the wall's top edge.
    const zc = s * (D / 2 + EAVES - (slope / 2) * Math.cos(PITCH));
    const yc = eave + rise - (slope / 2) * Math.sin(PITCH) + 0.06;
    pbox(g, roofMat(), mid, yc, zc, len, 0.12, slope, [s * PITCH, 0, 0]);
    // Seen close to, standing seams down it, on its top face.
    if (fine)
      for (let x = x0 + 0.3; x < x1 - 0.2; x += 0.46)
        pbox(
          g,
          ribs(),
          x,
          yc + 0.07 * Math.cos(PITCH),
          zc + s * 0.07 * Math.sin(PITCH),
          0.03,
          0.03,
          slope - 0.1,
          [s * PITCH, 0, 0],
        );
    pbox(
      g,
      zinc(),
      mid,
      eave - 0.12 - EAVES * Math.tan(PITCH),
      s * (D / 2 + EAVES),
      len,
      0.12,
      0.14,
    );
  }
  pbox(g, trim(), mid, eave + rise + 0.1, 0, len, 0.12, 0.3);
  // The gables' triangles of wall, at both ends (between two houses, out of sight).
  const tri = new THREE.Shape();
  tri.moveTo(-D / 2, 0);
  tri.lineTo(D / 2, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  for (const s of [-1, 1]) {
    const geo = new THREE.ShapeGeometry(tri);
    geo.rotateY(s * (Math.PI / 2));
    put(g, geo, townWall(), (s * W) / 2, eave, 0);
  }
}

/** A workshop: how wide its front is, how deep and high it is, and how many roller doors. */
export interface Workshop {
  width: number;
  depth: number;
  height: number;
  doors: number;
  seed: number;
}

/** The workshops' ribbed steel cladding, and their roller doors. */
const cladding = () => mat(0x7d8a91, { mottle: 'metal', roughness: 0.45, metalness: 0.6 });
const shutter = () => mat(0x4b5257, { mottle: 'metal', roughness: 0.5, metalness: 0.5 });
const concrete = () => mat(0x8f918f, { mottle: 'plastic', roughness: 0.85 });

/**
 * A workshop clad in ribbed steel on a concrete plinth: roller doors across its front, each in
 * a charcoal frame under a yellow and charcoal lintel, an office door and a strip of windows
 * beside them, a teal fascia with a cyan strip of light over the doors, ribs down every wall, and
 * a shallow roof with rooflights.
 */
export function workshop(o: Workshop): THREE.Group {
  const g = new THREE.Group();
  const { width: W, depth: D, height: H } = o;
  pbox(g, concrete(), 0, 0.3, 0, W + 0.1, 0.6, D + 0.1);
  pbox(g, cladding(), 0, (0.6 + H) / 2, 0, W, H - 0.6, D);
  // The ribs, every half metre down each wall.
  for (const [len, z, turn] of [
    [W, D / 2, 0],
    [W, -D / 2, 0],
    [D, W / 2, Math.PI / 2],
    [D, -W / 2, Math.PI / 2],
  ] as const) {
    const side = new THREE.Group();
    side.rotation.y = turn;
    g.add(side);
    for (let x = -len / 2 + 0.25; x < len / 2; x += 0.5)
      pbox(side, cladding(), x, (0.6 + H) / 2, z + Math.sign(z) * 0.025, 0.06, H - 0.6, 0.05);
  }
  const front = new THREE.Group();
  front.position.z = D / 2 + 0.05;
  g.add(front);
  const bay = 4.2;
  const doorH = Math.min(4.2, H - 1.4);
  const x0 = -W / 2 + 1.2;
  for (let i = 0; i < o.doors; i++) {
    const x = x0 + bay / 2 + i * (bay + 0.8);
    pbox(front, shutter(), x, 0.6 + doorH / 2 - 0.3, 0.02, bay, doorH, 0.04);
    for (let y = 0.45; y < doorH; y += 0.22) pbox(front, trim(), x, y, 0.045, bay, 0.025, 0.01);
    for (const s of [-1, 1])
      pbox(front, trim(), x + s * (bay / 2 + 0.08), 0.3 + doorH / 2, 0.05, 0.16, doorH + 0.6, 0.1);
    pbox(
      front,
      mat(0xd9a520, { mottle: 'paint', roughness: 0.5 }),
      x,
      doorH + 0.42,
      0.05,
      bay + 0.32,
      0.24,
      0.1,
    );
  }
  // The office: its door and a strip of windows beside the roller doors.
  const ox = W / 2 - 1.6;
  pbox(front, doorRed(), ox, 0.6 + 1.05, 0.03, 1.0, 2.1, 0.05);
  const lit = rng(o.seed);
  for (let x = ox - 1.6; x > x0 + o.doors * (bay + 0.8) - 0.4; x -= 1.4)
    windowAt(front, x, 2.0, 1.1, 0.9, lit() < 0.5 ? litGlass() : glass());
  pbox(front, teal(), 0, H - 0.45, 0.06, W, 0.7, 0.1);
  pbox(front, glow(CAR.blue, 1.6), 0, H - 0.81, 0.11, W - 0.2, 0.025, 0.012);
  // The roof, low-pitched, its ridge front to back, rooflights along each side.
  const pitch = 0.12;
  const run = (W / 2 + 0.25) / Math.cos(pitch);
  for (const s of [-1, 1]) {
    const xc = (s * (W / 2 + 0.25)) / 2;
    const yc = H + ((W / 2 + 0.25) / 2) * Math.tan(pitch) - 0.05;
    pbox(g, roofMat(), xc, yc, 0, run, 0.1, D + 0.4, [0, 0, -s * pitch]);
    for (let z = -D / 2 + 2; z < D / 2 - 1; z += 3)
      pbox(g, glass(), xc, yc + 0.06, z, run * 0.5, 0.04, 1.2, [0, 0, -s * pitch]);
  }
  pbox(g, trim(), 0, H + (W / 2) * Math.tan(pitch) + 0.05, 0, 0.3, 0.12, D + 0.4);
  return g;
}

/** The roofs' standing seams. */
const ribs = () =>
  mat(0x4b5257, { mottle: 'metal', roughness: 0.32, metalness: 0.6, envMapIntensity: 1.8 });

/** Bark, and the trees' leaves in two greens. */
const bark = () => mat(0x5a4636, { mottle: 'plastic', roughness: 0.9 });
const leaves = [
  () => mat(0x5f8a3a, { mottle: 'plastic', roughness: 0.75 }),
  () => mat(0x76994a, { mottle: 'plastic', roughness: 0.75 }),
];

/**
 * A street tree `size` metres tall, as a toy's: a tapering trunk running up into a crown of a
 * few round lumps of leaves in two greens, each side lump held on a limb, set by `seed`.
 */
export function streetTree(size: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rand = rng(seed);
  const trunkH = size * 0.42;
  const crown = trunkH + size * 0.25;
  // The trunk runs on up into the middle of the crown; the limbs fork from it below the leaves.
  limb(g, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, crown, 0), size * 0.036, size * 0.012);
  const fork = new THREE.Vector3(0, trunkH * 0.82, 0);
  const lumps = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + rand();
    const out = i === 0 ? 0 : size * (0.13 + rand() * 0.09);
    const r = size * (i === 0 ? 0.27 : 0.17 + rand() * 0.06);
    const y = i === 0 ? crown : trunkH + size * (0.1 + rand() * 0.18);
    const geo = new THREE.IcosahedronGeometry(r, 2);
    geo.scale(1, 0.85, 1);
    const centre = new THREE.Vector3(Math.cos(a) * out, y, Math.sin(a) * out);
    put(g, geo, leaves[i % 2]!(), centre.x, centre.y, centre.z);
    // Every lump out to the side hangs on a limb that ends inside it.
    if (i > 0) limb(g, fork, centre, size * 0.016, size * 0.007);
  }
  return g;
}

/** A tapering branch of bark from `from` to `to`, `r0` thick at its foot and `r1` at its tip. */
function limb(g: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) {
  const run = to.clone().sub(from);
  const geo = new THREE.CylinderGeometry(r1, r0, run.length(), 10, 1, true);
  geo.translate(0, run.length() / 2, 0);
  geo.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), run.normalize()),
  );
  put(g, geo, bark(), from.x, from.y, from.z);
}
