import * as THREE from 'three';
import { BUS } from './bus.ts';
import { CAR } from './car.ts';
import { tuft } from './ground.ts';
import {
  bentPath,
  cbox,
  flatSlab,
  glow,
  mat,
  type MatOptions,
  put,
  rbox,
  rng,
  roundRect,
  soilBed,
  tube,
} from './kit.ts';
import {
  MOVING,
  Toggle,
  addGadget,
  dimmable,
  hingedDoor,
  pivot,
  waterMaterial,
} from './gadgets.ts';
import { SPORT } from './sportscar.ts';

/**
 * The houses' insides, in the cars' style as their outsides are: pale lined walls, a warm floor,
 * charcoal furniture with teal and red cushions, white tops, steel trim, and cyan light strips
 * under their edges; round ceiling lights ringed in cyan, glowing screens, and plants.
 *
 * Every piece is built at its own origin on the floor, its front toward +z, its back (where it
 * meets a wall) at z = 0 unless it stands free; the houses place and turn them.
 *
 * What can be used is (see `Gadget`): the cupboards', the fridge's, the oven's and the
 * wardrobe's doors open on what is kept inside, the tap runs, the hob heats, the screens and
 * the lamps switch off and on.
 */

const TEAL = 0x2c6670;

/**
 * A material that reads as lit from within the room: its own colour, a little of it glowing, as
 * the light from the ceiling would lift it where the sun through the windows does not reach.
 */
function lit(colour: number, o: MatOptions = {}, k = 0.2): THREE.MeshStandardMaterial {
  const emissive = new THREE.Color(colour).multiplyScalar(k).getHex();
  return mat(colour, { roughness: 0.7, ...o, emissive, emissiveIntensity: 1 });
}

/** The rooms' surfaces: the walls' lining, the ceilings and the floors. */
export const wallIn = () => lit(0xe4dfd5, { mottle: 'plastic', roughness: 0.9 }, 0.24);
export const ceiling = () => lit(0xdcd8d0, { mottle: 'plastic', roughness: 0.9 }, 0.3);
export const floor = () => lit(0x8a6f56, { mottle: 'plastic', roughness: 0.55 }, 0.16);

const charcoal = (side: THREE.Side = THREE.FrontSide) =>
  lit(CAR.trim, { mottle: 'plastic', roughness: 0.6, side }, 0.12);
const earth = () => lit(0x4a3526, { mottle: 'soil', roughness: 1 }, 0.12);
const teal = () => lit(TEAL, { mottle: 'plastic', roughness: 0.8 }, 0.18);
const red = () => lit(SPORT.red, { mottle: 'plastic', roughness: 0.6 }, 0.14);
const white = () => lit(0xeceae4, { mottle: 'plastic', roughness: 0.35 }, 0.18);
const steel = () =>
  mat(0xc8ced2, { mottle: 'metal', roughness: 0.3, metalness: 0.75, envMapIntensity: 2.2 });
const dark = () => mat(0x15181a, { mottle: 'none', roughness: 0.4 });
const cyan = (k = 1.8) => glow(CAR.blue, k);

/** A wall's lining: its outline as a thin pale panel, to stand just inside the wall. */
export function lining(shape: THREE.Shape): THREE.BufferGeometry {
  return flatSlab(shape, 0.02, 0.006);
}

/** A group at (`x`, `y`, `z`) in `parent`, turned `turn` about the upright. */
export function place(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  turn = 0,
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'furniture';
  g.position.set(x, y, z);
  g.rotation.y = turn;
  parent.add(g);
  return g;
}

/** A sofa `len` long: a charcoal frame and arms, teal cushions, a cyan strip under its front. */
export function sofa(g: THREE.Object3D, len: number): void {
  const d = 0.86;
  rbox(g, charcoal(), 0, 0.15, d / 2, len, 0.22, d, 0.04);
  for (const sx of [-1, 1])
    for (const z of [0.08, d - 0.08])
      cbox(g, steel(), sx * (len / 2 - 0.1), 0.02, z, 0.05, 0.04, 0.05, 0.01);
  const n = len > 1.7 ? 3 : 2;
  const inner = len - 0.32;
  for (let k = 0; k < n; k++) {
    const x = -inner / 2 + (k + 0.5) * (inner / n);
    rbox(g, teal(), x, 0.35, d / 2 + 0.06, inner / n - 0.02, 0.18, d - 0.26, 0.06);
    rbox(g, teal(), x, 0.66, 0.16, inner / n - 0.02, 0.46, 0.2, 0.07);
  }
  for (const sx of [-1, 1])
    rbox(g, charcoal(), sx * (len / 2 - 0.08), 0.42, d / 2, 0.16, 0.42, d, 0.05);
  rbox(g, red(), -inner / 2 + 0.25, 0.56, 0.32, 0.36, 0.3, 0.1, 0.05, [0.25, 0.2, 0]);
  cbox(g, cyan(), 0, 0.035, d - 0.01, len - 0.2, 0.01, 0.012, 0.003);
}

/** A low table: a white top on charcoal legs, a steel shelf under it. */
export function coffeeTable(g: THREE.Object3D, w = 1.0, d = 0.56): void {
  rbox(g, white(), 0, 0.4, 0, w, 0.04, d, 0.015);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      cbox(g, charcoal(), sx * (w / 2 - 0.05), 0.2, sz * (d / 2 - 0.05), 0.04, 0.38, 0.04, 0.01);
  cbox(g, steel(), 0, 0.12, 0, w - 0.12, 0.015, d - 0.12, 0.005);
  cbox(g, cyan(1.4), 0, 0.374, d / 2 - 0.02, w - 0.1, 0.006, 0.006, 0.002);
}

/** A round table `r` across on a charcoal stem and foot. */
export function roundTable(g: THREE.Object3D, r = 0.38): void {
  put(g, new THREE.CylinderGeometry(r, r, 0.04, 40), white(), 0, 0.74, 0);
  put(
    g,
    new THREE.TorusGeometry(r - 0.01, 0.006, 6, 48).rotateX(Math.PI / 2),
    cyan(1.2),
    0,
    0.715,
    0,
  );
  put(g, new THREE.CylinderGeometry(0.04, 0.05, 0.7, 16), charcoal(), 0, 0.37, 0);
  put(g, new THREE.CylinderGeometry(0.24, 0.26, 0.03, 32), charcoal(), 0, 0.015, 0);
}

/** A stool: a round seat in `colour` on a steel stem, ringed in cyan under the seat. */
export function stool(g: THREE.Object3D, height = 0.62, colour = SPORT.red): void {
  put(
    g,
    new THREE.CylinderGeometry(0.17, 0.16, 0.06, 28),
    lit(colour, { mottle: 'plastic', roughness: 0.6 }, 0.14),
    0,
    height,
    0,
  );
  put(
    g,
    new THREE.TorusGeometry(0.12, 0.008, 6, 28).rotateX(Math.PI / 2),
    cyan(1.4),
    0,
    height - 0.04,
    0,
  );
  put(
    g,
    new THREE.CylinderGeometry(0.025, 0.025, height - 0.03, 12),
    steel(),
    0,
    (height - 0.03) / 2,
    0,
  );
  put(g, new THREE.CylinderGeometry(0.16, 0.17, 0.02, 24), charcoal(), 0, 0.01, 0);
  put(
    g,
    new THREE.TorusGeometry(0.13, 0.01, 6, 28).rotateX(Math.PI / 2),
    steel(),
    0,
    height * 0.4,
    0,
  );
}

/** Inside a bay of cupboards: its middle along x, its width and depth, its floor and its roof. */
export interface Bay {
  x: number;
  w: number;
  d: number;
  y0: number;
  y1: number;
}

interface Cupboards {
  /** What they are, for the hint ("open the cupboard"). */
  what: string;
  /** What the doors are made of. */
  door: THREE.Material;
  /** The doors' handles: a bar across near the top, one down by the free edge, or none. */
  handle: 'across' | 'down' | 'none';
  /** Whether each bay has a shelf across its middle. */
  shelf: boolean;
  /** Puts what a bay holds in it, on each of its floors (its bottom, and its shelf). */
  fill: (g: THREE.Object3D, bay: Bay, k: number) => void;
  /**
   * Builds bay `k` some other way (the oven under a hob) if it says so: then it has no door or
   * shelf of the run's own.
   */
  own?: (g: THREE.Object3D, bay: Bay, k: number) => boolean;
}

/** How thick the cupboards' panels are, and how far a door stands off the carcass. */
const PANEL = 0.02;
const DOOR_GAP = 0.003;

/**
 * A run of `bays` cupboards `len` long and `depth` deep, from `y0` up to `y1`, its back at
 * z = 0: a hollow charcoal carcass (back, floor, roof, ends and a divider between each bay), a
 * shelf in each, what each holds, and a door to each, which a click swings open.
 */
export function cupboards(
  g: THREE.Object3D,
  len: number,
  depth: number,
  y0: number,
  y1: number,
  bays: number,
  o: Cupboards,
): void {
  const t = PANEL;
  const body = charcoal();
  const h = y1 - y0;
  const r = 0.004;
  cbox(g, body, 0, y0 + h / 2, t / 2 + 0.002, len - 0.004, h, t, r);
  cbox(g, body, 0, y0 + t / 2, depth / 2, len, t, depth - 0.004, r);
  cbox(g, body, 0, y1 - t / 2, depth / 2, len, t, depth - 0.004, r);
  for (let k = 0; k <= bays; k++) {
    const x = -len / 2 + (k * len) / bays;
    const end = k === 0 ? t / 2 : k === bays ? -t / 2 : 0;
    cbox(
      g,
      body,
      x + end,
      y0 + h / 2,
      depth / 2,
      k % bays === 0 ? t : t * 0.9,
      h - 0.002,
      depth,
      r,
    );
  }
  const front = depth + DOOR_GAP;
  for (let k = 0; k < bays; k++) {
    const [bx0, bx1] = [-len / 2 + (k * len) / bays, -len / 2 + ((k + 1) * len) / bays];
    const bay: Bay = {
      x: (bx0 + bx1) / 2,
      w: bx1 - bx0 - t - 0.006,
      d: depth - t - 0.006,
      y0: y0 + t,
      y1: y1 - t,
    };
    if (o.own?.(g, bay, k)) continue;
    if (o.shelf) {
      const sy = (bay.y0 + bay.y1) / 2;
      cbox(g, body, bay.x, sy, t + bay.d / 2, bay.w, 0.018, bay.d, 0.004);
      o.fill(g, { ...bay, y1: sy - 0.009 }, k);
      o.fill(g, { ...bay, y0: sy + 0.009 }, k + 100);
    } else o.fill(g, bay, k);
    // Each hung at its left, so that no two swing into each other, but for the last of an even
    // run, which meets the one before it in the middle; and open square, clear of the doors
    // beside, open or shut, and of what stands at the run's ends.
    const left = k % 2 === 0 || k < bays - 1;
    const [dx0, dx1] = [bx0 + 0.002, bx1 - 0.002];
    const dw = dx1 - dx0;
    const hx = left ? dx0 : dx1;
    hingedDoor(
      g,
      o.what,
      new THREE.Vector3(hx, (y0 + y1) / 2, front + t),
      'y',
      left ? -1.55 : 1.55,
      (leaf) => {
        cbox(leaf, o.door, (dx0 + dx1) / 2, (y0 + y1) / 2, front + t / 2, dw, h - 0.006, t, 0.005);
        const hz = front + t + 0.01;
        if (o.handle === 'across')
          cbox(leaf, steel(), (dx0 + dx1) / 2, y1 - 0.06, hz, dw - 0.2, 0.02, 0.02, 0.006);
        else if (o.handle === 'down')
          rbox(
            leaf,
            steel(),
            left ? dx1 - 0.06 : dx0 + 0.06,
            y0 + h * 0.55,
            hz,
            0.025,
            Math.min(0.5, h * 0.4),
            0.02,
            0.008,
          );
      },
    );
  }
}

/** A cylinder `r` round and `h` tall standing on (`x`, `y`, `z`). */
function can(
  g: THREE.Object3D,
  m: THREE.Material,
  x: number,
  y: number,
  z: number,
  r: number,
  h: number,
  seg = 20,
): THREE.Mesh {
  return put(g, new THREE.CylinderGeometry(r, r, h, seg), m, x, y + h / 2, z);
}

/** The colours what is kept in the cupboards comes in. */
const WARES = [TEAL, SPORT.red, BUS.yellow, 0xeceae4, 0x7fb2c2, 0x5e8f99, 0xa34a3c];

/**
 * What a kitchen keeps on a floor of a cupboard: stacks of plates, bowls, mugs, tins, jars and
 * packets along it, a little apart, in the room's colours.
 */
export function kitchenStuff(g: THREE.Object3D, bay: Bay, seed: number): void {
  const rand = rng(seed * 31 + 7);
  const room = bay.y1 - bay.y0;
  const zMid = PANEL + bay.d * 0.45;
  let x = bay.x - bay.w / 2 + 0.03;
  const end = bay.x + bay.w / 2 - 0.03;
  const y = bay.y0;
  while (x < end) {
    const kind = Math.floor(rand() * 6);
    const colour = lit(
      WARES[Math.floor(rand() * WARES.length)]!,
      { mottle: 'plastic', roughness: 0.4 },
      0.16,
    );
    if (kind === 0 && x + 0.24 < end && room > 0.12) {
      // A stack of plates.
      const n = 3 + Math.floor(rand() * Math.min(5, (room - 0.04) / 0.022));
      for (let i = 0; i < n; i++)
        can(g, white(), x + 0.11, y + i * 0.022 + 0.001, zMid, 0.105 - (i % 2) * 0.003, 0.018, 28);
      x += 0.25;
    } else if (kind === 1 && x + 0.1 < end && room > 0.12) {
      // A mug, its handle out to the side.
      can(g, colour, x + 0.04, y + 0.001, zMid + 0.08, 0.04, 0.09);
      put(
        g,
        new THREE.TorusGeometry(0.025, 0.007, 6, 16),
        colour,
        x + 0.085,
        y + 0.05,
        zMid + 0.08,
      );
      x += 0.12;
    } else if (kind === 2 && x + 0.1 < end && room > 0.14) {
      // A tin, its label round its middle.
      can(g, steel(), x + 0.04, y + 0.001, zMid - 0.04, 0.038, 0.11);
      can(g, colour, x + 0.04, y + 0.021, zMid - 0.04, 0.0395, 0.07);
      x += 0.1;
    } else if (kind === 3 && x + 0.12 < end && room > 0.22) {
      // A packet, stood up.
      const ph = Math.min(room - 0.03, 0.18 + rand() * 0.08);
      cbox(g, colour, x + 0.055, y + 0.001 + ph / 2, zMid, 0.1, ph, 0.06, 0.006);
      x += 0.13;
    } else if (kind === 4 && x + 0.1 < end && room > 0.16) {
      // A jar with a lid.
      can(
        g,
        lit(0xd8c9a8, { mottle: 'plastic', roughness: 0.3 }, 0.2),
        x + 0.04,
        y + 0.001,
        zMid + 0.06,
        0.04,
        0.1,
      );
      can(g, colour, x + 0.04, y + 0.101, zMid + 0.06, 0.042, 0.02);
      x += 0.1;
    } else if (x + 0.18 < end && room > 0.1) {
      // A bowl, upside down.
      put(
        g,
        new THREE.CylinderGeometry(0.05, 0.08, 0.06, 24),
        colour,
        x + 0.085,
        y + 0.031,
        zMid - 0.02,
      );
      x += 0.19;
    } else x += 0.05;
  }
}

/**
 * A run of kitchen counter `len` long against the wall: cupboards behind charcoal doors with
 * steel handles (plates, mugs, tins and jars in them), a white top lit cyan under its edge, a
 * steel sink at `sinkAt` whose tap runs, and a black hob at `hobAt` that heats, an oven under
 * it behind a door that drops open.
 */
export function counterRun(g: THREE.Object3D, len: number, sinkAt: number, hobAt: number): void {
  const d = 0.62;
  cbox(g, dark(), 0, 0.05, d / 2 - 0.04, len - 0.02, 0.1, d - 0.08, 0.01);
  const bays = Math.max(1, Math.round(len / 0.6));
  const bayOf = (x: number) =>
    Math.min(bays - 1, Math.max(0, Math.floor(((x + len / 2) / len) * bays)));
  const ovenBay = bayOf(hobAt);
  const hob = hobRings(g, hobAt, d);
  const depth = d - 0.04 - PANEL - DOOR_GAP;
  cupboards(g, len, depth, 0.1, 0.86, bays, {
    what: 'cupboard',
    door: charcoal(),
    handle: 'across',
    shelf: true,
    fill: (c, bay, k) => kitchenStuff(c, bay, k + Math.round(len * 10) + Math.round(sinkAt * 7)),
    own: (c, bay, k) => {
      if (k !== ovenBay || bay.w < 0.45) return false;
      oven(c, bay, depth, hob);
      return true;
    },
  });
  rbox(g, white(), 0, 0.885, d / 2, len + 0.02, 0.05, d + 0.02, 0.012);
  cbox(g, cyan(), 0, 0.862, d - 0.005, len - 0.1, 0.008, 0.01, 0.003);
  // The sink, sunk in the top, its tap curving over it.
  rbox(g, steel(), sinkAt, 0.905, d / 2, 0.52, 0.012, 0.4, 0.004);
  cbox(g, dark(), sinkAt, 0.909, d / 2, 0.44, 0.006, 0.32, 0.002);
  tap(g, sinkAt);
}

/**
 * The sink's tap: a steel spout curving over the sink and a lever at its foot; a click turns
 * the lever and the water runs from the spout into the sink, rippling where it falls.
 */
function tap(g: THREE.Object3D, x: number): void {
  const mouth = new THREE.Vector3(x, 1.1, 0.26);
  const spout = tube(
    g,
    bentPath(
      [
        new THREE.Vector3(x, 0.91, 0.08),
        new THREE.Vector3(x, 1.2, 0.08),
        new THREE.Vector3(x, 1.2, 0.26),
        mouth.clone(),
      ],
      0.05,
    ),
    0.015,
    steel(),
  );
  const { pivot: lever, leaf } = pivot(g, new THREE.Vector3(x + 0.03, 0.95, 0.08));
  put(
    leaf,
    new THREE.CylinderGeometry(0.008, 0.008, 0.1, 10).rotateZ(Math.PI / 2),
    steel(),
    x + 0.07,
    0.95,
    0.08,
  );
  put(leaf, new THREE.SphereGeometry(0.012, 10, 6), steel(), x + 0.12, 0.95, 0.08);
  // The water, from the spout's mouth down to the sink's floor: hung from its top, so it
  // falls as it grows.
  const water = waterMaterial();
  const fall = mouth.y - 0.004 - 0.912;
  const stream = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.007, fall, 12, 1, true).translate(0, -fall / 2, 0),
    water,
  );
  stream.position.set(mouth.x, mouth.y - 0.004, mouth.z);
  const ripple = new THREE.Mesh(
    new THREE.RingGeometry(0.012, 0.03, 24).rotateX(-Math.PI / 2),
    water,
  );
  ripple.position.set(mouth.x, 0.9135, mouth.z);
  for (const m of [stream, ripple]) {
    m.visible = false;
    m.renderOrder = 2;
    g.add(m);
  }
  let time = 0;
  const tap = addGadget(
    g,
    new Toggle(
      [spout, lever],
      ['turn on the tap', 'turn off the tap'],
      (k, dt) => {
        lever.rotation.y = -k * 0.7;
        time += dt;
        stream.visible = ripple.visible = k > 0.02;
        if (!stream.visible) return;
        const wobble = 1 + 0.12 * Math.sin(time * 37) * Math.sin(time * 23);
        stream.scale.set(k * wobble, Math.min(1, k * 1.6), k * wobble);
        const ring = 1 + ((time * 2.4) % 1) * 1.6;
        ripple.scale.set(ring * k, 1, ring * k);
        ripple.visible = k > 0.6;
      },
      0.4,
    ),
  );
  tap.noise = ['tapOn', 'tapOff'];
}

/** The hob, for what warms with it: each told how hot it is (0 cold, 1 on). */
interface Hob {
  heats: ((k: number) => void)[];
}

/**
 * The hob: black glass, four rings glowing dim amber; a click switches it on and the rings
 * glow up red hot, flickering a little, and off again.
 */
function hobRings(g: THREE.Object3D, x: number, d: number): Hob {
  const glassTop = cbox(g, dark(), x, 0.912, d / 2, 0.6, 0.006, 0.5, 0.002);
  const ring = glow(CAR.amber, 0.7).clone();
  const cold = new THREE.Color(CAR.amber);
  const hot = new THREE.Color(0xff4a1c);
  for (const [dx, dz] of [
    [-0.14, -0.11],
    [0.14, -0.11],
    [-0.14, 0.11],
    [0.14, 0.11],
  ])
    put(
      g,
      new THREE.TorusGeometry(0.08, 0.005, 6, 32).rotateX(Math.PI / 2),
      ring,
      x + dx!,
      0.916,
      d / 2 + dz!,
    );
  let time = 0;
  const hob: Hob = { heats: [] };
  const glass = addGadget(
    g,
    new Toggle(
      [glassTop],
      ['switch on the hob', 'switch off the hob'],
      (k, dt) => {
        time += dt;
        const flicker = k > 0.9 ? 0.06 * Math.sin(time * 9) * Math.sin(time * 5.3) : 0;
        ring.emissive.copy(cold).lerp(hot, k);
        ring.color.copy(ring.emissive);
        ring.emissiveIntensity = 0.7 + k * (2.6 + flicker * 10);
        for (const f of hob.heats) f(k);
      },
      1.5,
    ),
  );
  glass.noise = ['hobOn', 'hobOff'];
  return hob;
}

/**
 * The oven under the hob, filling bay `bay` of the counter: a dark lined cavity with a rack and
 * a tray of bread on it, a door of dark glass in a charcoal frame hinged along its foot that a
 * click drops open (its light coming on inside), and the cavity glowing warm while the hob is on.
 */
function oven(g: THREE.Object3D, bay: Bay, front: number, hob: Hob): void {
  const { x, w, y0, y1 } = bay;
  const h = y1 - y0;
  const inside = lit(0x1e2224, { mottle: 'metal', roughness: 0.5 }, 0.08);
  const back = PANEL + 0.004;
  const deep = bay.d - 0.01;
  // The cavity's lining: its floor, roof, sides and back, inside the bay.
  cbox(g, inside, x, y0 + 0.006, back + deep / 2, w - 0.004, 0.008, deep, 0.002);
  cbox(g, inside, x, y1 - 0.006, back + deep / 2, w - 0.004, 0.008, deep, 0.002);
  for (const s of [-1, 1])
    cbox(
      g,
      inside,
      x + s * (w / 2 - 0.006),
      (y0 + y1) / 2,
      back + deep / 2,
      0.008,
      h - 0.02,
      deep,
      0.002,
    );
  cbox(g, inside, x, (y0 + y1) / 2, back + 0.006, w - 0.02, h - 0.02, 0.008, 0.002);
  // The rack: steel rods across on two along, and a tray of bread on it.
  const ry = y0 + h * 0.38;
  for (let i = 0; i < 6; i++)
    put(
      g,
      new THREE.CylinderGeometry(0.004, 0.004, w - 0.03, 6).rotateZ(Math.PI / 2),
      steel(),
      x,
      ry,
      back + 0.05 + (i * (deep - 0.1)) / 5,
    );
  for (const s of [-1, 1])
    put(
      g,
      new THREE.CylinderGeometry(0.004, 0.004, deep - 0.06, 6).rotateX(Math.PI / 2),
      steel(),
      x + s * (w / 2 - 0.03),
      ry - 0.008,
      back + deep / 2,
    );
  cbox(g, steel(), x, ry + 0.012, back + deep / 2, w * 0.7, 0.012, deep * 0.6, 0.004);
  const crust = lit(0xb06a2c, { mottle: 'soil', roughness: 0.8 }, 0.18);
  for (const s of [-1, 1])
    rbox(g, crust, x + s * w * 0.15, ry + 0.045, back + deep / 2, w * 0.22, 0.06, 0.12, 0.03);
  // The light inside, at the back's top, and the heat's glow on the back.
  const light = dimmable(glow(0xffe2b0, 2.2));
  cbox(g, light.mats[0]!, x, y1 - 0.05, back + 0.012, 0.08, 0.04, 0.006, 0.002);
  const heat = dimmable(glow(0xff6a28, 1.2));
  put(
    g,
    new THREE.TorusGeometry(0.11, 0.006, 6, 32),
    heat.mats[0]!,
    x,
    (y0 + y1) / 2 + 0.04,
    back + 0.013,
  );
  // The door: dark glass in a charcoal frame, hinged along its foot, a steel bar across its top.
  const z = front + DOOR_GAP;
  const t = PANEL;
  hob.heats.push((k) => heat.set(k));
  hingedDoor(
    g,
    'oven',
    new THREE.Vector3(x, y0 - t + 0.004, z + t),
    'x',
    1.45,
    (leaf) => {
      // As wide as a cupboard door, its bevel taken off.
      const fw = w + t - 0.004;
      const fh = h + 2 * t - 0.016;
      const fy = (y0 - t + 0.004 + y1 + t - 0.004) / 2;
      const frame = roundRect(fw, fh, 0.008);
      frame.holes.push(roundRect(fw - 0.12, fh - 0.2, 0.02));
      put(leaf, flatSlab(frame, t, 0.004), charcoal(), x, fy, z + t / 2);
      cbox(
        leaf,
        mat(0x0e1418, { mottle: 'none', roughness: 0.08, envMapIntensity: 2.2 }),
        x,
        fy,
        z + t / 2,
        fw - 0.1,
        fh - 0.18,
        0.008,
        0.002,
      );
      cbox(leaf, steel(), x, y1 - 0.02, z + t + 0.012, fw - 0.16, 0.02, 0.02, 0.006);
    },
    (k) => light.set(k),
  );
}

/**
 * A tall fridge in teal: a freezer over the fridge, each behind its own door hung at its right
 * edge with a steel bar of a handle and a small cyan display on the freezer's; inside, white
 * walls and shelves with milk, juice, cheese, eggs, fruit and greens, bottles in the door's bin,
 * ice and frozen boxes in the freezer, a light coming on in each while its door is open.
 */
export function fridge(g: THREE.Object3D): void {
  const w = 0.68;
  const [h, deep] = [1.92, 0.58];
  const shell = teal();
  const liner = white();
  const t = 0.03;
  // The shell: back, sides, top, floor and the shelf between freezer and fridge.
  rbox(g, shell, 0, h / 2, t / 2, w, h, t, 0.01);
  for (const s of [-1, 1]) rbox(g, shell, s * (w / 2 - t / 2), h / 2, deep / 2, t, h, deep, 0.01);
  rbox(g, shell, 0, h - t / 2, deep / 2, w - 0.004, t, deep, 0.01);
  rbox(g, shell, 0, 0.04, deep / 2, w - 0.004, 0.08, deep, 0.01);
  const split = 1.25;
  rbox(g, shell, 0, split, deep / 2, w - 0.004, t, deep, 0.008);
  // The white lining inside, a little in from the shell.
  const [iw, i0, i1] = [w - 2 * t - 0.004, 0.08 + 0.002, h - t - 0.002];
  cbox(g, liner, 0, (i0 + i1) / 2, t + 0.006, iw, i1 - i0, 0.008, 0.002);
  for (const s of [-1, 1])
    cbox(
      g,
      liner,
      s * (iw / 2 - 0.004),
      (i0 + i1) / 2,
      deep / 2 + 0.01,
      0.008,
      i1 - i0,
      deep - t - 0.02,
      0.002,
    );
  // Shelves of white wire-glass, and what is on them.
  const shelfAt = [0.48, 0.86];
  const sd = deep - t - 0.11;
  for (const y of shelfAt) cbox(g, liner, 0, y, t + 0.01 + sd / 2, iw - 0.012, 0.012, sd, 0.003);
  fridgeStuff(g, [0.081, ...shelfAt.map((y) => y + 0.006)], iw - 0.04, t + 0.03, sd - 0.04);
  // The freezer: a shelf, ice and frozen boxes.
  cbox(g, liner, 0, 1.58, t + 0.01 + sd / 2, iw - 0.012, 0.012, sd, 0.003);
  const frost = lit(0xdff2f8, { mottle: 'plastic', roughness: 0.3 }, 0.3);
  for (const [i, y] of [split + t / 2 + 0.001, 1.586].entries()) {
    rbox(g, frost, -0.13, y + 0.04, t + 0.17, 0.2, 0.08, 0.26, 0.01);
    rbox(
      g,
      lit(i ? 0x7fb2c2 : SPORT.red, { mottle: 'plastic' }, 0.18),
      0.12,
      y + 0.05,
      t + 0.15,
      0.22,
      0.1,
      0.2,
      0.01,
    );
  }
  // A light at the top of each, on while its door is open.
  const lights = [split - 0.04, h - t - 0.03].map((y) => {
    const l = dimmable(glow(0xf6f8ff, 2.4));
    cbox(g, l.mats[0]!, 0, y, t + 0.08, 0.16, 0.02, 0.05, 0.006);
    return l;
  });
  // The doors, each hung at the right edge, swinging out to the right.
  const front = deep + 0.003;
  const dt = 0.06;
  const leaves: [number, number, string][] = [
    [0.004, split - 0.012, 'fridge'],
    [split + 0.012, h - 0.004, 'freezer'],
  ];
  for (const [i, [y0, y1, what]] of leaves.entries()) {
    const ym = (y0 + y1) / 2;
    hingedDoor(
      g,
      what,
      new THREE.Vector3(w / 2, ym, front + dt),
      'y',
      1.75,
      (leaf) => {
        rbox(leaf, shell, 0, ym, front + dt / 2, w, y1 - y0, dt, 0.025);
        // Its inside: white, clear of the shell's floor and shelf where it shuts, a bin of
        // bottles on the fridge's.
        const [l0, l1] = [Math.max(y0 + 0.05, i0 + 0.01), y1 - 0.05];
        cbox(leaf, liner, 0, (l0 + l1) / 2, front - 0.004, iw - 0.02, l1 - l0, 0.008, 0.002);
        rbox(
          leaf,
          steel(),
          -w / 2 + 0.08,
          i ? y0 + 0.3 : y1 - 0.4,
          0.67 + (front - 0.583),
          0.025,
          0.5,
          0.03,
          0.01,
        );
        if (i)
          cbox(
            leaf,
            glow(0x9fe6ff, 1.4),
            w / 2 - 0.14,
            y0 + 0.25,
            front + dt + 0.001,
            0.12,
            0.05,
            0.002,
            0.001,
          );
        else
          for (const by of [0.35, 0.85]) {
            cbox(leaf, liner, 0, by, front - 0.045, iw - 0.06, 0.012, 0.07, 0.003);
            cbox(leaf, liner, 0, by + 0.04, front - 0.083, iw - 0.06, 0.08, 0.006, 0.002);
            for (let k = 0; k < 4; k++)
              bottle(
                leaf,
                -iw / 2 + 0.08 + k * 0.12,
                by + 0.007,
                front - 0.045,
                [0xf4f2ea, 0xffa424, 0x2fe07a, 0xf4f2ea][k]!,
              );
          }
      },
      (k) => lights[i]!.set(k),
    );
  }
}

/** A bottle `colour` full, standing on (`x`, `y`, `z`): a body, a shoulder, a cap. */
function bottle(g: THREE.Object3D, x: number, y: number, z: number, colour: number): void {
  const body = lit(colour, { mottle: 'plastic', roughness: 0.3 }, 0.2);
  put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.16, 16), body, x, y + 0.08, z);
  put(g, new THREE.CylinderGeometry(0.012, 0.03, 0.05, 16), body, x, y + 0.185, z);
  put(g, new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12), lit(TEAL, {}, 0.18), x, y + 0.22, z);
}

/** What a fridge holds, on each of its floors at `ys`, `w` across and from `z0` back `d` deep. */
function fridgeStuff(g: THREE.Object3D, ys: number[], w: number, z0: number, d: number): void {
  const zm = z0 + d / 2;
  const [y0, y1, y2] = ys as [number, number, number];
  // The bottom: a drawer of greens and apples.
  const tray = lit(0xdff2f8, { mottle: 'plastic', roughness: 0.2 }, 0.26);
  cbox(g, tray, 0, y0 + 0.004, zm, w, 0.008, d, 0.003);
  for (const s of [-1, 1])
    cbox(g, tray, 0, y0 + 0.06, zm + s * (d / 2 - 0.004), w, 0.11, 0.008, 0.002);
  const apple = lit(SPORT.red, { mottle: 'plastic', roughness: 0.35 }, 0.18);
  for (const [x, z] of [
    [-0.18, -0.06],
    [-0.1, 0.05],
    [-0.2, 0.08],
  ])
    put(g, new THREE.SphereGeometry(0.04, 16, 10), apple, x!, y0 + 0.05 + 0.01, zm + z!);
  const greens = lit(0x4f9a3a, { mottle: 'plastic', roughness: 0.7 }, 0.18);
  for (const [x, z] of [
    [0.08, -0.04],
    [0.17, 0.06],
  ])
    put(
      g,
      new THREE.SphereGeometry(0.06, 14, 8).scale(1, 0.75, 1),
      greens,
      x!,
      y0 + 0.056,
      zm + z!,
    );
  // The middle shelf: milk and juice, and a box of eggs.
  bottle(g, -0.19, y1, zm - 0.05, 0xf4f2ea);
  bottle(g, -0.11, y1, zm + 0.04, 0xffa424);
  rbox(g, lit(0xd8c9a8, { mottle: 'plastic' }, 0.2), 0.12, y1 + 0.035, zm, 0.24, 0.07, 0.11, 0.012);
  for (let i = 0; i < 3; i++)
    put(
      g,
      new THREE.SphereGeometry(0.022, 12, 8).scale(1, 1.25, 1),
      white(),
      0.04 + i * 0.08,
      y1 + 0.085,
      zm,
    );
  // The top shelf: cheese and a covered bowl.
  const cheese = lit(BUS.yellow, { mottle: 'plastic', roughness: 0.6 }, 0.2);
  rbox(g, cheese, -0.14, y2 + 0.035, zm, 0.16, 0.07, 0.1, 0.01);
  put(
    g,
    new THREE.CylinderGeometry(0.09, 0.07, 0.08, 24),
    lit(TEAL, {}, 0.18),
    0.12,
    y2 + 0.04,
    zm,
  );
  put(g, new THREE.CylinderGeometry(0.095, 0.095, 0.012, 24), white(), 0.12, y2 + 0.087, zm);
}

/**
 * A kitchen island `len` long, standing free: cupboards on its -z side behind charcoal doors,
 * under a white top that overhangs +z for stools.
 */
export function island(g: THREE.Object3D, len: number): void {
  const d = 0.62;
  cbox(g, dark(), 0, 0.05, -0.06, len - 0.04, 0.1, d - 0.08, 0.01);
  // The cupboards face -z: built facing +z in a group turned round, their back at the far side.
  const back = new THREE.Group();
  back.position.z = -0.06 + (d - 0.04) / 2;
  back.rotation.y = Math.PI;
  g.add(back);
  cupboards(back, len, d - 0.04 - PANEL - DOOR_GAP, 0.1, 0.86, 3, {
    what: 'cupboard',
    door: charcoal(),
    handle: 'across',
    shelf: true,
    fill: (c, bay, k) => kitchenStuff(c, bay, 50 + k),
  });
  rbox(g, white(), 0, 0.885, 0.05, len + 0.04, 0.05, d + 0.28, 0.012);
  cbox(g, cyan(), 0, 0.862, 0.05 + (d + 0.28) / 2 - 0.01, len - 0.1, 0.008, 0.01, 0.003);
  rbox(g, red(), len / 2 - 0.3, 0.97, 0.05, 0.3, 0.12, 0.3, 0.05);
}

/**
 * A tall wardrobe `w` wide: a charcoal body, teal doors with steel bars that a click swings
 * open, a cyan strip at its foot; inside, clothes on hangers along a rail, folded ones on a shelf
 * over them and shoes under them.
 */
export function wardrobe(g: THREE.Object3D, w: number): void {
  const depth = 0.6 - PANEL - DOOR_GAP;
  cbox(g, charcoal(), 0, 0.035, depth / 2, w - 0.04, 0.07, depth - 0.04, 0.01);
  cupboards(g, w, depth, 0.07, 2.0, 2, {
    what: 'wardrobe',
    door: teal(),
    handle: 'down',
    shelf: false,
    fill: (c, bay, k) => clothes(c, bay, 60 + k),
  });
  cbox(g, cyan(), 0, 0.035, depth - 0.015, w - 0.1, 0.008, 0.01, 0.003);
}

/** What a wardrobe's bay holds: a rail of clothes on hangers, a shelf of folded ones, shoes. */
function clothes(g: THREE.Object3D, bay: Bay, seed: number): void {
  const rand = rng(seed);
  const zm = PANEL + bay.d / 2;
  const shelf = bay.y1 - 0.3;
  cbox(g, charcoal(), bay.x, shelf, zm, bay.w, 0.018, bay.d, 0.004);
  const railY = shelf - 0.12;
  put(
    g,
    new THREE.CylinderGeometry(0.012, 0.012, bay.w, 12).rotateZ(Math.PI / 2),
    steel(),
    bay.x,
    railY,
    zm,
  );
  const n = Math.max(2, Math.floor((bay.w - 0.08) / 0.065));
  for (let i = 0; i < n; i++) {
    const x = bay.x - bay.w / 2 + 0.06 + i * ((bay.w - 0.12) / Math.max(1, n - 1));
    const colour = lit(
      WARES[Math.floor(rand() * WARES.length)]!,
      { mottle: 'plastic', roughness: 0.9 },
      0.16,
    );
    const len = 0.6 + rand() * 0.45;
    // The hook over the rail, the hanger's shoulders, the garment hung from them.
    put(
      g,
      new THREE.TorusGeometry(0.018, 0.003, 4, 12, Math.PI).rotateY(Math.PI / 2),
      steel(),
      x,
      railY + 0.004,
      zm,
    );
    cbox(g, charcoal(), x, railY - 0.04, zm, 0.012, 0.025, 0.4, 0.005);
    rbox(g, colour, x, railY - 0.055 - len / 2, zm, 0.035, len, 0.42, 0.015);
  }
  // Folded on the shelf.
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 3; j++) {
      const colour = lit(
        WARES[Math.floor(rand() * WARES.length)]!,
        { mottle: 'plastic', roughness: 0.9 },
        0.16,
      );
      rbox(
        g,
        colour,
        bay.x + (i - 0.5) * bay.w * 0.45,
        shelf + 0.009 + 0.025 + j * 0.052,
        zm,
        bay.w * 0.38,
        0.048,
        0.3,
        0.012,
      );
    }
  // A pair of shoes on the floor.
  const shoe = lit(i2c(rand), { mottle: 'plastic', roughness: 0.5 }, 0.12);
  for (const s of [-1, 1])
    rbox(g, shoe, bay.x + s * 0.06, bay.y0 + 0.04, zm + 0.04, 0.09, 0.08, 0.26, 0.03);
}

/** A colour for shoes: charcoal, red or teal. */
function i2c(rand: () => number): number {
  return [CAR.trim, SPORT.red, TEAL][Math.floor(rand() * 3)]!;
}

/**
 * A screen's picture: a group named `MOVING` on its face, `w × h`, the screen's own glow in
 * `base`; a click switches it off (dark) and on, and while on its picture moves: a show of
 * shapes drifting over a field that slowly shifts in colour, and a bar of light scanning down.
 */
function picture(
  g: THREE.Object3D,
  handle: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  what: string,
): void {
  const field = glow(0x3d86b5, 0.8).clone();
  const shapes = [glow(0x9fe6ff, 1.2), glow(0xff7a5c, 0.9), glow(BUS.yellow, 1.0)].map((m) =>
    m.clone(),
  );
  const show = new THREE.Group();
  show.name = MOVING;
  show.position.set(x, y, z);
  g.add(show);
  cbox(show, field, 0, 0, 0, w, h, 0.002, 0.001);
  const parts = shapes.map((m, i) =>
    cbox(
      show,
      m,
      0,
      0,
      0.0015 + i * 0.0006,
      w * [0.3, 0.22, 0.12][i]!,
      h * [0.07, 0.3, 0.12][i]!,
      0.001,
      0.0005,
    ),
  );
  const hue = new THREE.Color();
  const full = [field, ...shapes].map((m) => m.emissiveIntensity);
  let time = 0;
  const screen = addGadget(
    g,
    new Toggle(
      [handle],
      [`switch on the ${what}`, `switch off the ${what}`],
      (k, dt) => {
        time += dt;
        [field, ...shapes].forEach((m, i) => (m.emissiveIntensity = full[i]! * k));
        show.visible = k > 0.01;
        if (!show.visible) return;
        hue.setHSL(0.55 + 0.06 * Math.sin(time * 0.3), 0.5, 0.42);
        field.emissive.copy(hue);
        // The shapes drift round the screen, each its own way, inside its edges.
        const [a, b, c] = parts as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
        a.position.set(
          -w * 0.18 + w * 0.08 * Math.sin(time * 0.7),
          h * 0.15 + h * 0.1 * Math.sin(time * 1.1),
          a.position.z,
        );
        b.position.set(
          w * 0.2 * Math.sin(time * 0.45),
          -h * 0.12 + h * 0.08 * Math.cos(time * 0.9),
          b.position.z,
        );
        c.position.set(
          w * 0.3 * Math.cos(time * 0.8),
          h * 0.32 * Math.sin(time * 1.7),
          c.position.z,
        );
        // Fading in from the middle as it comes on, as a screen does.
        show.scale.set(1, Math.max(0.02, k), 1);
      },
      0.35,
      true,
    ),
  );
  screen.noise = ['screenOn', 'screenOff'];
}

/**
 * A screen on the wall over a low charcoal cabinet: the cabinet's doors swing open on a games
 * console and its games, and a click on the screen switches its moving picture off and on.
 */
export function screenWall(g: THREE.Object3D, w = 1.6): void {
  const depth = 0.4 - PANEL - DOOR_GAP;
  cbox(g, charcoal(), 0, 0.03, depth / 2, w - 0.04, 0.06, depth - 0.04, 0.01);
  cupboards(g, w, depth, 0.06, 0.45, 2, {
    what: 'cabinet',
    door: charcoal(),
    handle: 'down',
    shelf: false,
    fill: (c, bay, k) => {
      const zm = PANEL + bay.d / 2;
      if (k === 0) {
        // The console: a dark box, its cyan light, a controller on top.
        rbox(c, dark(), bay.x, bay.y0 + 0.04, zm, 0.36, 0.08, 0.26, 0.01);
        cbox(c, cyan(1.6), bay.x, bay.y0 + 0.04, zm + 0.131, 0.2, 0.006, 0.004, 0.002);
        rbox(c, charcoal(), bay.x - 0.05, bay.y0 + 0.1, zm, 0.14, 0.03, 0.08, 0.012);
      } else
        for (let i = 0; i < 6; i++)
          cbox(
            c,
            lit(WARES[i % WARES.length]!, { mottle: 'plastic', roughness: 0.4 }, 0.18),
            bay.x - 0.2 + i * 0.07,
            bay.y0 + 0.095,
            zm,
            0.018,
            0.19,
            0.14,
            0.003,
          );
    },
  });
  cbox(g, cyan(), 0, 0.03, depth - 0.015, w - 0.1, 0.008, 0.01, 0.003);
  const sw = w * 0.85;
  const frame = rbox(g, dark(), 0, 1.25, 0.03, sw, sw * 0.56, 0.04, 0.015);
  picture(g, frame, 0, 1.25, 0.051, sw - 0.05, sw * 0.56 - 0.05, 'screen');
}

/**
 * A desk `w` wide against the wall, a teal chair before it, and on it a screen whose moving
 * picture a click switches off and on.
 */
export function desk(g: THREE.Object3D, w: number): void {
  rbox(g, white(), 0, 0.74, 0.32, w, 0.04, 0.62, 0.012);
  for (const sx of [-1, 1])
    cbox(g, charcoal(), sx * (w / 2 - 0.03), 0.36, 0.32, 0.04, 0.72, 0.58, 0.01);
  cbox(g, cyan(1.4), 0, 0.715, 0.62, w - 0.1, 0.006, 0.006, 0.002);
  put(g, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 12), steel(), 0, 0.86, 0.09);
  cbox(g, charcoal(), 0, 0.765, 0.1, 0.22, 0.01, 0.14, 0.004);
  const screen = rbox(g, dark(), 0, 1.12, 0.12, 0.64, 0.38, 0.03, 0.01);
  picture(g, screen, 0, 1.12, 0.136, 0.6, 0.34, 'computer');
  rbox(g, white(), 0, 0.77, 0.38, 0.42, 0.015, 0.14, 0.005);
  // The chair: a teal seat and back on a steel stem and a charcoal foot.
  rbox(g, teal(), 0, 0.48, 0.86, 0.48, 0.08, 0.46, 0.03);
  rbox(g, teal(), 0, 0.82, 1.08, 0.46, 0.5, 0.06, 0.03);
  put(g, new THREE.CylinderGeometry(0.025, 0.025, 0.42, 12), steel(), 0, 0.23, 0.88);
  put(g, new THREE.CylinderGeometry(0.24, 0.24, 0.03, 5), charcoal(), 0, 0.03, 0.88);
}

/** A bed `w` wide, its head against the wall: a charcoal base, a red headboard, white and teal linen. */
export function bed(g: THREE.Object3D, w: number): void {
  const len = 2.1;
  rbox(g, charcoal(), 0, 0.17, len / 2 + 0.04, w + 0.1, 0.26, len, 0.04);
  cbox(g, cyan(), 0, 0.035, len / 2 + 0.04, w, 0.008, len - 0.1, 0.003);
  rbox(g, white(), 0, 0.4, len / 2 + 0.06, w, 0.2, len - 0.06, 0.06);
  rbox(g, teal(), 0, 0.5, len / 2 + 0.36, w + 0.04, 0.08, len - 0.62, 0.035);
  for (const sx of [-1, 1])
    rbox(g, white(), (sx * w) / 4, 0.57, 0.32, w / 2 - 0.1, 0.12, 0.38, 0.05);
  rbox(g, charcoal(), 0, 0.55, 0.04, w + 0.2, 1.0, 0.08, 0.03);
  rbox(g, red(), 0, 0.68, 0.085, w, 0.56, 0.02, 0.02);
  cbox(g, cyan(), 0, 1.04, 0.07, w + 0.1, 0.012, 0.012, 0.004);
}

/** An open shelf `w` wide and `h` tall in charcoal, books and boxes on it in the scene's colours. */
export function bookshelf(g: THREE.Object3D, w: number, h: number, seed: number): void {
  const d = 0.32;
  for (const sx of [-1, 1])
    cbox(g, charcoal(), sx * (w / 2 - 0.02), h / 2, d / 2, 0.04, h, d, 0.008);
  const shelves = Math.max(2, Math.round(h / 0.4));
  const rand = rng(seed);
  const colours = [TEAL, SPORT.red, BUS.yellow, 0xeceae4, CAR.trim, 0x7fb2c2];
  for (let k = 0; k <= shelves; k++) {
    const y = 0.04 + (k * (h - 0.06)) / shelves;
    cbox(g, charcoal(), 0, y, d / 2, w - 0.06, 0.03, d, 0.006);
    if (k === shelves) continue;
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.12) {
      const bw = 0.03 + rand() * 0.04;
      const bh = 0.18 + rand() * 0.12;
      if (rand() < 0.15) {
        x += 0.12;
        continue;
      }
      const c = colours[Math.floor(rand() * colours.length)]!;
      cbox(
        g,
        lit(c, { mottle: 'plastic' }, 0.16),
        x + bw / 2,
        y + 0.015 + bh / 2,
        d / 2 + 0.02,
        bw,
        bh,
        d - 0.1,
        0.004,
      );
      x += bw + 0.005;
    }
  }
  cbox(g, cyan(1.4), 0, h + 0.005, d - 0.01, w - 0.1, 0.006, 0.008, 0.002);
}

/**
 * A plant in a charcoal pot `size` tall, ringed in cyan, its earth sunk a little under its rim,
 * its leaves as the yards' grass.
 */
export function plant(g: THREE.Object3D, size: number, seed: number): void {
  const r = size * 0.22;
  const h = size * 0.4;
  const sunk = h - 0.06;
  // The pot, open at the top: its outside, a wall's thickness of rim, and its inside down to the
  // earth.
  put(g, new THREE.CylinderGeometry(r, r * 0.85, h, 32, 1, true), charcoal(), 0, h / 2, 0);
  put(g, new THREE.CircleGeometry(r * 0.85, 32).rotateX(Math.PI / 2), charcoal(), 0, 0.001, 0);
  put(g, new THREE.RingGeometry(r - 0.02, r, 32).rotateX(-Math.PI / 2), charcoal(), 0, h, 0);
  const inner = new THREE.CylinderGeometry(r - 0.02, r - 0.025, h - sunk + 0.02, 32, 1, true);
  put(g, inner, charcoal(THREE.BackSide), 0, (h + sunk - 0.02) / 2, 0);
  put(
    g,
    new THREE.TorusGeometry(r - 0.005, 0.006, 6, 28).rotateX(Math.PI / 2),
    cyan(1.2),
    0,
    size * 0.36,
    0,
  );
  put(g, soilBed((r - 0.02) * 2, 0, seed, true), earth(), 0, sunk, 0);
  const leaves = new THREE.Mesh(
    tuft(seed, size * 0.8, true),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }),
  );
  leaves.position.y = sunk + 0.01;
  leaves.castShadow = true;
  g.add(leaves);
}

/** A floor lamp: a steel pole on a charcoal foot, a warm glowing globe ringed in cyan. */
export function floorLamp(g: THREE.Object3D): void {
  const light = dimmable(glow(0xfff0d8, 1.6), cyan(1.6));
  const [globe, ring] = light.mats;
  put(g, new THREE.CylinderGeometry(0.16, 0.18, 0.03, 28), charcoal(), 0, 0.015, 0);
  put(g, new THREE.CylinderGeometry(0.015, 0.015, 1.4, 12), steel(), 0, 0.72, 0);
  put(g, new THREE.SphereGeometry(0.13, 24, 12), globe, 0, 1.52, 0);
  put(g, new THREE.TorusGeometry(0.135, 0.008, 6, 32).rotateX(Math.PI / 2), ring, 0, 1.52, 0);
  lightSwitch(g, light.set);
}

/** A click on lamp `g` switches it off, another on again, `set` dimming its glow. */
function lightSwitch(g: THREE.Object3D, set: (k: number) => void): void {
  const lamp = addGadget(
    g,
    new Toggle([g], ['switch on the light', 'switch off the light'], set, 0.2, true),
  );
  lamp.noise = ['lampOn', 'lampOff'];
}

/** A round light flush under the ceiling at y = 0: a charcoal rim, a white glow, a cyan ring. */
export function ceilingLight(g: THREE.Object3D, r = 0.26): void {
  const light = dimmable(glow(0xf6f8ff, 2.2), cyan(2));
  const [face, ring] = light.mats;
  put(g, new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.04, 40), charcoal(), 0, -0.02, 0);
  put(g, new THREE.CircleGeometry(r, 40).rotateX(Math.PI / 2), face, 0, -0.041, 0);
  put(g, new THREE.TorusGeometry(r + 0.025, 0.01, 6, 40).rotateX(Math.PI / 2), ring, 0, -0.042, 0);
  lightSwitch(g, light.set);
}

/** A light hung `drop` below the ceiling at y = 0: a steel cord, a charcoal cone, a glowing bulb. */
export function pendant(g: THREE.Object3D, drop: number): void {
  put(g, new THREE.CylinderGeometry(0.006, 0.006, drop, 6), steel(), 0, -drop / 2, 0);
  put(
    g,
    new THREE.CylinderGeometry(0.05, 0.16, 0.18, 28, 1, true),
    lit(CAR.trim, { side: THREE.DoubleSide, mottle: 'plastic' }, 0.1),
    0,
    -drop - 0.06,
    0,
  );
  const light = dimmable(glow(0xfff0d8, 2), cyan(1.6));
  const [bulb, ring] = light.mats;
  put(g, new THREE.SphereGeometry(0.06, 16, 8), bulb, 0, -drop - 0.12, 0);
  put(
    g,
    new THREE.TorusGeometry(0.16, 0.006, 6, 28).rotateX(Math.PI / 2),
    ring,
    0,
    -drop - 0.15,
    0,
  );
  lightSwitch(g, light.set);
}

/** A rug `w × d` in `colour`, flat on the floor, edged in a paler band. */
export function rug(g: THREE.Object3D, w: number, d: number, colour: number): void {
  rbox(
    g,
    lit(0xd6d2c8, { mottle: 'plastic', roughness: 0.95 }, 0.16),
    0,
    0.005,
    0,
    w,
    0.01,
    d,
    0.004,
  );
  rbox(
    g,
    lit(colour, { mottle: 'plastic', roughness: 0.95 }, 0.16),
    0,
    0.011,
    0,
    w - 0.14,
    0.01,
    d - 0.14,
    0.004,
  );
}

/**
 * A straight stair up along +x, `run` long and `rise` high in `steps`, `width` wide across z:
 * white treads lit cyan at their noses between two charcoal stringers, open beneath; a steel
 * rail on the open side (+z) from a newel at its foot to `top` along x at its head (where the
 * landing's own rail takes it), on posts that stop under it.
 */
export function stairs(
  g: THREE.Object3D,
  run: number,
  rise: number,
  width: number,
  steps: number,
  top = run,
): void {
  const going = run / steps;
  const h = rise / steps;
  for (let k = 0; k < steps; k++) {
    const x = (k + 0.5) * going;
    const y = (k + 1) * h;
    rbox(g, white(), x, y - 0.025, 0, going + 0.03, 0.05, width, 0.01);
    cbox(g, cyan(1.4), k * going + 0.005, y - 0.04, 0, 0.008, 0.008, width - 0.1, 0.002);
  }
  // The stringers run from the first step up, so their feet stay above the floor.
  const A = Math.atan2(rise - h, run - going);
  const len = Math.hypot(rise - h, run - going);
  const [sx, sy] = [(going + run) / 2, (h + rise) / 2 - 0.1];
  // They, the rail and its posts stand a few millimetres out past the treads' ends, so the
  // treads' ends and their faces are never in the same plane.
  const rz = width / 2 - 0.026;
  for (const s of [-1, 1]) cbox(g, charcoal(), sx, sy, s * rz, len, 0.16, 0.06, 0.01, [0, 0, A]);
  // The rail, parallel to the treads' noses, 0.95 over the landing at its head.
  const foot = 0.04;
  const railAt = (x: number) => rise + 0.95 - ((top - x) * h) / going;
  tube(
    g,
    bentPath(
      [new THREE.Vector3(foot, railAt(foot), rz), new THREE.Vector3(top, railAt(top), rz)],
      0.01,
    ),
    0.022,
    steel(),
  );
  // A newel at its foot, capped, the rail running into it.
  const newel = railAt(foot) + 0.03;
  cbox(g, charcoal(), foot, newel / 2, rz, 0.06, newel, 0.06, 0.01);
  put(g, new THREE.SphereGeometry(0.036, 16, 10), charcoal(), foot, newel, rz);
  // Posts up from every third tread, each to the rail's middle over it.
  for (let k = 2; k < steps; k += 3) {
    const x = (k + 0.5) * going;
    const y0 = (k + 1) * h;
    const y1 = railAt(x);
    cbox(g, charcoal(), x, (y0 + y1) / 2, rz, 0.03, y1 - y0, 0.03, 0.008);
  }
}

/**
 * A steel guard rail along `points` on the floor at y = 0, round its corners, on charcoal posts
 * at each corner and between; its top rail's ends capped.
 */
export function guardRail(g: THREE.Object3D, points: THREE.Vector3[]): void {
  const at = (y: number) => points.map((p) => p.clone().setY(y));
  // Turned tight enough round each corner that the post under it stays inside the bend.
  tube(g, bentPath(at(0.95), 0.03), 0.022, steel());
  tube(g, bentPath(at(0.45), 0.03), 0.012, steel());
  for (const end of [points[0]!, points.at(-1)!])
    put(g, new THREE.SphereGeometry(0.022, 12, 8), steel(), end.x, 0.95, end.z);
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i]!, points[i + 1]];
    cbox(g, charcoal(), a.x, 0.47, a.z, 0.04, 0.94, 0.04, 0.01);
    if (!b) break;
    const n = Math.max(1, Math.round(a.distanceTo(b) / 0.7));
    for (let k = 1; k < n; k++) {
      const p = a.clone().lerp(b, k / n);
      cbox(g, charcoal(), p.x, 0.47, p.z, 0.04, 0.94, 0.04, 0.01);
    }
  }
}
