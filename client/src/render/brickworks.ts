import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUCKET_SHOTS, COLOURS, MOULD_TYPES, printKey } from '@sar/shared';
import type { BrickTypeId, ColourId, MachineDef, MachineState, Tool } from '@sar/shared';
import { brickGeometry, brickMaterial } from './bricks.ts';
import { add, mat, metal } from './interiors.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { addDecorations, addPrints } from './prints.ts';

/**
 * The brick works' models: the moulds and pellet buckets players carry, and the four machines,
 * an injection moulding machine, the pellet silo, the mould dispenser and the UV printer. Each
 * is built to fill its own box, whatever size that is.
 *
 * Unlike the props in `props.ts`, everything here is built with local +z its front, the way
 * the machines face. Pellets and parts are drawn in `brickMaterial`, which goes grey
 * with the rest of the bricks without the colour goggles.
 */

const geometries = new Map<string, THREE.BufferGeometry>();
/** A geometry made once and shared, by `key`. */
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometries.get(key);
  if (!g) geometries.set(key, (g = make()));
  return g;
}

const boxGeo = (x: number, y: number, z: number) =>
  cached(`box:${x}:${y}:${z}`, () => new THREE.BoxGeometry(x, y, z));
const canGeo = (r: number, h: number, segments = 12) =>
  cached(`can:${r}:${h}:${segments}`, () => new THREE.CylinderGeometry(r, r, h, segments));

/** A box from the shared geometries, centred at `x, y, z`. */
function block(
  parent: THREE.Object3D,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  return add(parent, boxGeo(sx, sy, sz), material, x, y, z);
}

/** A cylinder lying along x from `x0` to `x1`, its axis at `y, z`. */
function rod(
  parent: THREE.Object3D,
  r: number,
  x0: number,
  x1: number,
  y: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const m = add(parent, canGeo(r, x1 - x0), material, (x0 + x1) / 2, y, z);
  m.rotation.z = Math.PI / 2;
  return m;
}

/** A cylinder lying along z from `z0` to `z1`, its axis at `x, y`. */
function rodZ(
  parent: THREE.Object3D,
  r: number,
  z0: number,
  z1: number,
  x: number,
  y: number,
  material: THREE.Material,
): THREE.Mesh {
  const m = add(parent, canGeo(r, z1 - z0), material, x, y, (z0 + z1) / 2);
  m.rotation.x = Math.PI / 2;
  return m;
}

/** An upright cylinder (or a cone's frustum) from `y0` up to `y1`, centred on `x, z`. */
function upright(
  parent: THREE.Object3D,
  rBottom: number,
  rTop: number,
  y0: number,
  y1: number,
  x: number,
  z: number,
  material: THREE.Material,
  segments = 16,
  open = false,
): THREE.Mesh {
  const geo = cached(`up:${rBottom}:${rTop}:${y1 - y0}:${segments}:${open}`, () => {
    return new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, segments, 1, open);
  });
  return add(parent, geo, material, x, (y0 + y1) / 2, z);
}

/** A light that glows `colour` when lit, and is a dull shade of it when not. */
const lamp = (colour: number, lit: boolean) =>
  lit ? mat(colour, 0.4, 0, colour) : mat(new THREE.Color(colour).multiplyScalar(0.35).getHex());

const clear = new THREE.MeshStandardMaterial({
  color: 0xd8eef5,
  roughness: 0.05,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/**
 * A chalkboard in a dark frame, `w` by `h`, centred on `x, y`, its back at `z` and `label`
 * chalked on its front (+z). It stands 2.3 cm out from `z`.
 */
function chalkSign(
  g: THREE.Object3D,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  label: string,
): void {
  block(g, w + 0.04, h + 0.04, 0.015, x, y, z + 0.0075, mat(0x5a3b22, 0.8));
  block(g, w, h, 0.006, x, y, z + 0.018, mat(0x2c3a33, 0.95));
  // The chalk is drawn on a canvas, which only a browser has.
  if (typeof document === 'undefined') return;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * h) / w);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e9eef0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic ${c.height * 0.6}px "Segoe Script", "Bradley Hand", "Comic Sans MS", cursive`;
  ctx.fillText(label, c.width / 2, c.height * 0.52, c.width * 0.9);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const chalk = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 1 }),
  );
  chalk.position.set(x, y, z + 0.023);
  chalk.userData[KEEP_SEPARATE] = true;
  g.add(chalk);
}

/** Same pseudo-random numbers every time, from a seed. */
function rng(seed: number): () => number {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

/**
 * Loose pellets heaped over a disc of radius `r` lying on y = 0: one geometry of many little
 * beads, shared by every heap that size.
 */
function pelletHeap(r: number): THREE.BufferGeometry {
  return cached(`heap:${r}`, () => {
    const rand = rng(Math.round(r * 1e4) + 7);
    const bead = 0.011;
    const count = Math.min(140, Math.round((r / bead) ** 2 * 0.9));
    const beads: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (r - bead);
      // A little higher in the middle, like a heap.
      const y = (1 - d / r) * bead * 1.5 + rand() * bead * 0.5;
      beads.push(
        new THREE.SphereGeometry(bead, 6, 4)
          .scale(1, 0.7, 1)
          .translate(Math.cos(a) * d, y, Math.sin(a) * d),
      );
    }
    return mergeGeometries(beads)!;
  });
}

/** Pellets of `colour` filling a round space of radius `r` up to `y`, heaped on top. */
function pelletTop(g: THREE.Object3D, r: number, y: number, colour: ColourId): void {
  const plastic = brickMaterial(colour);
  const disc = upright(g, r, r, y - 0.01, y, 0, 0, plastic, 20);
  const heap = add(g, pelletHeap(r), plastic, 0, y, 0);
  for (const m of [disc, heap]) m.userData[KEEP_SEPARATE] = true;
}

// ---- Moulds ----

const mouldSteel = metal(0x8c949b);
const mouldSteelLight = metal(0xa9b0b7);
const mouldDark = mat(0x2b2f33, 0.6, 0.4);
const pinSteel = metal(0xd5dade);
/** The part's shape in the mould: bright aluminium, to stand out from the darker steel. */
const insert = mat(0xdfe5ea, 0.3, 0.5);
const brass = mat(0xc9a14a, 0.35, 0.6);

/** A mould block's size, as on the dispenser's shelves and clamped in the moulding machine. */
const MOULD_SIZE = { x: 0.4, y: 0.2, z: 0.4 };

/**
 * A mould block in its own frame: the centre of its bottom at the origin, `MOULD_SIZE`, its
 * cavity face up (+y) and its front +z. Two halves with a parting line between them, guide
 * pins at the corners, a sprue bush at the back and the part's shape, in aluminium, sunk in a
 * pocket in the top so the moulds can be told apart from a little way off.
 */
function mouldBlock(type: BrickTypeId): THREE.Group {
  const g = new THREE.Group();
  const { x: W, y: H, z: D } = MOULD_SIZE;
  const lower = H * 0.44;
  const gap = 0.006;
  const top = H - 0.015;
  const rim = 0.05;
  block(g, W, lower, D, 0, lower / 2, 0, mouldSteel);
  block(g, W - 0.016, gap, D - 0.016, 0, lower + gap / 2, 0, mouldDark);
  const y0 = lower + gap;
  const upper = top - y0;
  const pocket = W - 2 * rim;
  for (const s of [-1, 1]) {
    block(g, W, upper, rim, 0, y0 + upper / 2, s * (D / 2 - rim / 2), mouldSteelLight);
    block(g, rim, upper, D - 2 * rim, s * (W / 2 - rim / 2), y0 + upper / 2, 0, mouldSteelLight);
  }
  const floor = 0.016;
  block(g, pocket, floor, D - 2 * rim, 0, y0 + floor / 2, 0, mouldDark);
  // Guide pins at the corners, up to the top of its box.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      add(
        g,
        canGeo(0.012, H - top, 10),
        pinSteel,
        sx * (W / 2 - rim / 2),
        (top + H) / 2,
        sz * (D / 2 - rim / 2),
      );
  // The sprue bush the plastic goes in by, on the back rim.
  upright(g, 0.02, 0.02, top, top + 0.005, 0, -D / 2 + rim / 2, pinSteel, 12);
  upright(g, 0.009, 0.009, top, top + 0.006, 0, -D / 2 + rim / 2, mouldDark, 10);
  // A brass maker's plate on the front.
  block(g, W * 0.4, lower * 0.4, 0.003, 0, lower / 2, D / 2 + 0.0015, brass);
  // The part, upright or lying on its back, whichever shows it bigger, shrunk into the pocket.
  const geo = brickGeometry(type);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const room = pocket - 0.03;
  const deep = H - 0.005 - (y0 + floor);
  const upK = Math.min(room / size.x, room / size.z, deep / size.y);
  const lyingK = Math.min(room / size.x, room / size.y, deep / size.z);
  const lying = lyingK > upK * 1.15;
  const k = lying ? lyingK : upK;
  const part = new THREE.Mesh(geo, insert);
  part.scale.setScalar(k);
  if (lying) part.rotation.x = -Math.PI / 2;
  part.updateMatrix();
  const placed = bb.clone().applyMatrix4(part.matrix);
  const mid = placed.getCenter(new THREE.Vector3());
  part.position.set(-mid.x, y0 + floor + 0.001 - placed.min.y, -mid.z);
  part.castShadow = true;
  g.add(part);
  return g;
}

// ---- Buckets ----

const BUCKET = { height: 0.26, bottom: 0.1, top: 0.125 };
const bucketPlastic = new THREE.MeshStandardMaterial({
  color: 0xf2f2ee,
  roughness: 0.55,
  side: THREE.DoubleSide,
});

/**
 * A plastic pail with a wire handle, its bottom centre at the origin, filled most of the way
 * with `colour` pellets, or empty.
 */
function bucket(colour: ColourId | null): THREE.Group {
  const g = new THREE.Group();
  const { height: h, bottom, top } = BUCKET;
  upright(g, bottom, top, 0.008, h, 0, 0, bucketPlastic, 24, true);
  upright(g, bottom, bottom, 0, 0.008, 0, 0, bucketPlastic, 24);
  const rim = add(
    g,
    cached('bucketRim', () => new THREE.TorusGeometry(top, 0.007, 6, 28)),
    bucketPlastic,
    0,
    h,
    0,
  );
  rim.rotation.x = Math.PI / 2;
  // Lugs on the sides, and the handle lying back from them.
  const wire = metal(0x9aa1a8);
  for (const s of [-1, 1])
    block(g, 0.012, 0.03, 0.02, s * (top - 0.004), h - 0.04, 0, bucketPlastic);
  const handle = add(
    g,
    cached('bucketHandle', () => new THREE.TorusGeometry(top + 0.008, 0.004, 5, 20, Math.PI)),
    wire,
    0,
    h - 0.04,
    0,
  );
  handle.rotation.x = -0.6;
  if (colour) {
    const fill = h * 0.82;
    pelletTop(g, bottom + (top - bottom) * (fill / h) - 0.004, fill, colour);
  }
  return g;
}

/**
 * What a player carries in both hands: a mould, a little smaller than in a machine, or a
 * bucket of pellets. Its origin is its middle; a new model every call.
 */
export function makeHeldTool(tool: Tool): THREE.Group {
  const g = new THREE.Group();
  if (tool.kind === 'mould') {
    const k = 0.3 / MOULD_SIZE.x;
    const m = mouldBlock(tool.type);
    m.scale.setScalar(k);
    m.position.y = (-MOULD_SIZE.y * k) / 2;
    g.add(m);
  } else {
    const b = bucket(tool.colour);
    b.position.y = -BUCKET.height / 2;
    g.add(b);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return g;
}

// ---- Machines ----

const teal = mat(0x2f8f83, 0.5);
const tealDark = mat(0x23706a, 0.55);
const machineGrey = mat(0x5d646b, 0.6);
const panelGrey = mat(0x3a3f44, 0.6);
const darkMetal = metal(0x2b2d30);
const steel = metal(0xb0b6bc);
const screen = mat(0x4fc3f7, 0.3, 0, 0x1e6fb5);
const smoked = new THREE.MeshStandardMaterial({
  color: 0x2a3036,
  roughness: 0.15,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** The parts the mould dispenser shows on its shelves: a spread of all there are. */
const SHOWN_MOULDS = Array.from(
  { length: 9 },
  (_, i) => MOULD_TYPES[Math.floor((i * MOULD_TYPES.length) / 9)]!,
);

/**
 * A machine of the brick works, standing at its foot and turned to face its way, with what
 * is in it shown: the moulding machine's mould and pellets, the part on the printer's bed.
 */
export class MachineView {
  readonly group = new THREE.Group();
  /** What changes with the machine's state: rebuilt only when that changes. */
  private readonly dynamic = new THREE.Group();
  private key = '';
  private last: { m: MachineState; svgs: Record<string, string> } | null = null;
  /** The moulding machine's stack light: green when it can run, amber when half loaded. */
  private lights: THREE.Mesh[] = [];

  constructor(private readonly def: MachineDef) {
    this.group.position.set(def.pos.x, def.pos.y, def.pos.z);
    this.group.rotation.y = def.facing;
    const { x: w, y: h, z: d } = def.size;
    if (def.kind === 'press') this.press(w, h, d);
    else if (def.kind === 'silo') this.silo(w, h, d);
    else if (def.kind === 'dispenser') this.dispenser(w, h, d);
    else this.printer(w, h, d);
    this.group.add(this.dynamic);
  }

  /** Shows what is in the machine; cheap when that has not changed. */
  update(m: MachineState, svgs: Record<string, string>): void {
    const p = m.part;
    const key = [
      m.mould ?? '',
      m.colour ?? '',
      m.shots,
      p ? `${p.type}:${p.colour}:${printKey(p.prints)}` : '',
    ].join('|');
    if (key === this.key && svgs === this.last?.svgs) return;
    this.key = key;
    this.last = { m, svgs };
    this.rebuild();
  }

  /** Builds what is in the machine again, as when the colour goggles go on or off. */
  refreshColours(): void {
    if (this.last) this.rebuild();
  }

  private rebuild(): void {
    // Shared geometries stay; those made for this machine alone go.
    this.dynamic.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.userData.own || o.userData.decoration))
        o.geometry.dispose();
    });
    this.dynamic.clear();
    const m = this.last!.m;
    if (this.def.kind === 'press') this.pressContents(m);
    else if (this.def.kind === 'printer') this.printerContents(m, this.last!.svgs);
    this.dynamic.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.userData[KEEP_SEPARATE] = true;
      }
    });
  }

  // -- The injection moulding machine --

  /**
   * Where the press's parts are, worked out from its size: the clamp at its left end, the
   * injection unit with its hopper in the middle and the housing with the controls at the right.
   */
  private pressLayout(w: number, d: number) {
    const hw = w / 2;
    const hd = d / 2;
    const mx = -hw + 0.9;
    const hx = mx + 0.85;
    return {
      hw,
      hd,
      /** The mould's middle across, its height, and how far forward the clamp's axis is. */
      mx,
      my: 0.95,
      cz: hd - 0.415,
      /** The hopper's place, and where the housing begins. */
      hx,
      hx0: hx + 0.35,
      hopper: { r: 0.17, neck: 0.92, cone: 1.02, cyl: 1.16, top: 1.46 },
    };
  }

  private press(w: number, h: number, d: number): void {
    const g = this.group;
    const { hw, hd, mx, my, cz, hx, hx0, hopper } = this.pressLayout(w, d);
    // Feet, the bed, and a stripe along its front.
    for (const x of [-hw + 0.2, 0, hw - 0.2])
      for (const z of [-hd + 0.15, hd - 0.15]) block(g, 0.12, 0.1, 0.12, x, 0.05, z, darkMetal);
    block(g, w - 0.08, 0.52, d - 0.1, 0, 0.36, -0.02, machineGrey);
    block(g, w - 0.08, 0.06, 0.01, 0, 0.56, hd - 0.065, teal);
    // The clamp: its cylinder housing at the end, the ram, the moving and fixed platens and
    // four tie bars between.
    block(g, 0.32, 0.64, d - 0.2, -hw + 0.22, 0.94, -0.03, teal);
    rod(g, 0.07, -hw + 0.36, mx - 0.28, my, cz, steel);
    block(g, 0.1, 0.62, 0.64, mx - 0.25, my, cz, tealDark);
    block(g, 0.14, 0.62, 0.64, mx + 0.27, my, cz, tealDark);
    for (const y of [my - 0.25, my + 0.25])
      for (const z of [-0.26, 0.26]) rod(g, 0.035, -hw + 0.36, mx + 0.36, y, cz + z, steel);
    // A slot in the bed under the mould, where parts drop out, and a tray at the front.
    block(g, 0.36, 0.004, 0.2, mx, 0.622, hd - 0.27, darkMetal);
    block(g, 0.44, 0.16, 0.004, mx, 0.4, hd - 0.068, darkMetal);
    block(g, 0.5, 0.02, 0.2, mx, 0.3, hd - 0.11, panelGrey);
    block(g, 0.5, 0.08, 0.02, mx, 0.35, hd - 0.02, panelGrey);
    for (const s of [-1, 1]) block(g, 0.02, 0.08, 0.18, mx + s * 0.24, 0.35, hd - 0.12, panelGrey);
    // A guard sheet behind the mould and the safety door in front of it: a glass pane in a
    // frame with a handle.
    block(g, 0.84, 0.62, 0.01, mx, my, cz - 0.345, panelGrey);
    const doorZ = hd - 0.05;
    const [dx0, dx1, dy0, dy1] = [mx - 0.42, mx + 0.42, 0.66, 1.2];
    const bar = 0.03;
    block(g, dx1 - dx0, bar, bar, mx, dy0 + bar / 2, doorZ, panelGrey);
    block(g, dx1 - dx0, bar, bar, mx, dy1 - bar / 2, doorZ, panelGrey);
    for (const x of [dx0 + bar / 2, dx1 - bar / 2])
      block(g, bar, dy1 - dy0 - 2 * bar, bar, x, (dy0 + dy1) / 2, doorZ, panelGrey);
    const glass = block(
      g,
      dx1 - dx0 - 2 * bar,
      dy1 - dy0 - 2 * bar,
      0.008,
      mx,
      (dy0 + dy1) / 2,
      doorZ,
      clear,
    );
    glass.castShadow = false;
    block(g, 0.025, 0.22, 0.02, dx1 - 0.08, my, hd - 0.02, steel);
    for (const y of [my - 0.09, my + 0.09])
      block(g, 0.02, 0.02, 0.02, dx1 - 0.08, y, hd - 0.04, steel);
    // The sign over the door, on posts standing on the platens.
    for (const x of [mx - 0.25, mx + 0.27])
      block(g, 0.03, 0.2, 0.03, x, my + 0.41, hd - 0.12, darkMetal);
    chalkSign(g, 1.1, 0.2, mx, my + 0.44, hd - 0.105, 'Moulding machine');
    // The injection unit: the barrel with its heater bands on a carriage, the hopper over it,
    // and the housing with the motor and controls.
    block(g, hx0 - (mx + 0.34), 0.16, 0.3, (hx0 + mx + 0.34) / 2, 0.7, cz, tealDark);
    rod(g, 0.075, mx + 0.34, hx0, 0.85, cz, steel);
    for (const x of [mx + 0.5, mx + 0.68, hx + 0.2])
      rod(g, 0.085, x - 0.03, x + 0.03, 0.85, cz, mat(0x8a4b2a, 0.5, 0.3));
    upright(g, 0.05, 0.05, hopper.neck, hopper.cone, hx, cz, steel, 12);
    upright(g, 0.05, hopper.r, hopper.cone, hopper.cyl, hx, cz, clear, 20, true).castShadow = false;
    upright(g, hopper.r, hopper.r, hopper.cyl, hopper.top, hx, cz, clear, 20, true).castShadow =
      false;
    // Rings holding the clear hopper, and its lid with a vent pipe.
    const ring = (r: number, y0: number, y1: number) =>
      upright(g, r, r, y0, y1, hx, cz, panelGrey, 20);
    ring(hopper.r + 0.01, hopper.cyl - 0.01, hopper.cyl + 0.01);
    ring(hopper.r + 0.012, hopper.top, hopper.top + 0.03);
    upright(g, 0.03, 0.03, hopper.top + 0.03, h - 0.005, hx, cz, darkMetal, 10);
    const top = 1.25;
    const [x1, front] = [hw - 0.04, hd - 0.11];
    block(g, x1 - hx0, top - 0.62, d - 0.16, (hx0 + x1) / 2, (top + 0.62) / 2, -0.03, teal);
    block(g, x1 - hx0, 0.02, d - 0.16, (hx0 + x1) / 2, top + 0.01, -0.03, machineGrey);
    // The control panel with its screen and buttons on the housing's front, vents over it.
    const px = (hx0 + x1) / 2;
    block(g, 0.5, 0.36, 0.09, px, 0.88, hd - 0.075, panelGrey);
    block(g, 0.3, 0.14, 0.006, px, 0.97, hd - 0.027, screen);
    for (const [i, c] of [0x3bb54a, 0xf2c230, 0x3a7bd5].entries()) {
      const b = rodZ(g, 0.018, hd - 0.03, hd - 0.015, px - 0.15 + i * 0.07, 0.8, mat(c, 0.4));
      b.castShadow = false;
    }
    rodZ(g, 0.03, hd - 0.03, hd - 0.012, px + 0.15, 0.8, mat(0xd32f2f, 0.4));
    for (let i = 0; i < 3; i++)
      block(g, 0.4, 0.02, 0.006, px, 1.11 + i * 0.045, front + 0.003, darkMetal);
    // The stack light on top of the housing (lit by `pressContents`).
    const lx = hw - 0.22;
    upright(g, 0.015, 0.015, top + 0.02, top + 0.08, lx, -0.1, darkMetal, 8);
    this.lights = [0x3bb54a, 0xf2a530, 0xd32f2f].map((c, i) =>
      upright(
        g,
        0.04,
        0.04,
        top + 0.08 + i * 0.08,
        top + 0.155 + i * 0.08,
        lx,
        -0.1,
        lamp(c, false),
        12,
      ),
    );
    upright(g, 0.042, 0.042, top + 0.32, top + 0.34, lx, -0.1, darkMetal, 12);
  }

  private pressContents(m: MachineState): void {
    const { hd, mx, my, cz, hx, hopper } = this.pressLayout(this.def.size.x, this.def.size.z);
    const ready = !!m.mould && !!m.colour && m.shots > 0;
    const half = !ready && (!!m.mould || (!!m.colour && m.shots > 0));
    const lit = [ready, half, !ready && !half];
    for (const [i, c] of [0x3bb54a, 0xf2a530, 0xd32f2f].entries())
      this.lights[i]!.material = lamp(c, lit[i]!);
    if (m.mould) {
      // Clamped between the platens, its cavity face toward the door.
      const mould = mouldBlock(m.mould);
      mould.rotation.x = Math.PI / 2;
      mould.position.set(mx, my, hd - 0.1 - MOULD_SIZE.y);
      this.dynamic.add(mould);
    }
    if (m.colour && m.shots > 0) {
      // Pellets in the hopper, from its narrow bottom up as far as there are shots left.
      const f = Math.min(1, m.shots / BUCKET_SHOTS);
      const r = hopper.r - 0.008;
      const bottom = hopper.cone + 0.005;
      const level = bottom + f * (hopper.top - 0.04 - bottom);
      const plastic = brickMaterial(m.colour);
      const coneTop = Math.min(level, hopper.cyl);
      const rAt = 0.045 + ((r - 0.045) * (coneTop - bottom)) / (hopper.cyl - bottom);
      const g = new THREE.Group();
      g.position.set(hx, 0, cz);
      g.add(
        ownMesh(
          new THREE.CylinderGeometry(rAt, 0.045, coneTop - bottom, 20),
          plastic,
          (bottom + coneTop) / 2,
        ),
      );
      if (level > hopper.cyl)
        g.add(
          ownMesh(
            new THREE.CylinderGeometry(r, r, level - hopper.cyl, 20),
            plastic,
            (hopper.cyl + level) / 2,
          ),
        );
      const heap = new THREE.Mesh(pelletHeap(level > hopper.cyl ? r : rAt), plastic);
      heap.position.y = level;
      g.add(heap);
      this.dynamic.add(g);
    }
  }

  // -- The pellet silo --

  /**
   * One round silo on braced legs toward the back of its box, every colour banded down its
   * sight strip; under it a pipe out to the tap at the front, where a bucket stands on a grate
   * to be filled, with the colour chart on one side and spare buckets on the other.
   */
  private silo(w: number, h: number, d: number): void {
    const hw = w / 2;
    const hd = d / 2;
    const r = Math.min(hw - 0.2, hd - 0.2, 0.6);
    // The silo itself is built about its own axis, set back from the front.
    const cz = -hd + r + 0.13;
    const g = new THREE.Group();
    g.position.z = cz;
    this.group.add(g);
    const shell = metal(0xc9ced3);
    const frame = mat(0xe0a526, 0.5);
    const ids = Object.keys(COLOURS) as ColourId[];
    const [cone0, body0, body1] = [1.05, 1.45, h - 0.25];
    // Legs braced together, holding a ring under the silo.
    const l = r * 0.8;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) block(g, 0.07, body0, 0.07, sx * l, body0 / 2, sz * l, frame);
    for (const s of [-1, 1]) {
      block(g, 2 * l - 0.07, 0.05, 0.04, 0, 0.45, s * l, frame);
      block(g, 0.04, 0.05, 2 * l - 0.07, s * l, 0.45, 0, frame);
    }
    upright(g, r + 0.015, r + 0.015, body0 - 0.03, body0, 0, 0, frame, 32);
    // The cone, the tall body with its stiffening rings, the roof and a vent.
    upright(g, 0.06, r, cone0, body0 - 0.03, 0, 0, shell, 32);
    upright(g, r, r, body0, body1, 0, 0, shell, 32);
    for (const y of [body0 + 0.45, body0 + 0.9, body1 - 0.1])
      upright(g, r + 0.01, r + 0.01, y, y + 0.03, 0, 0, metal(0xa9b0b7), 32);
    upright(g, r, 0.08, body1, body1 + 0.15, 0, 0, shell, 32);
    upright(g, 0.06, 0.06, body1 + 0.15, h - 0.03, 0, 0, darkMetal, 12);
    upright(g, 0.08, 0.08, h - 0.03, h, 0, 0, darkMetal, 12);
    // A sight strip down its front, banded with the colours it holds.
    const [s0, s1] = [body0 + 0.08, body0 + 0.86];
    block(g, 0.11, s1 - s0 + 0.03, 0.012, 0, (s0 + s1) / 2, r + 0.004, darkMetal);
    const band = (s1 - s0) / ids.length;
    for (const [j, c] of ids.entries()) {
      const m = block(
        g,
        0.08,
        band - 0.004,
        0.008,
        0,
        s0 + band * (j + 0.5),
        r + 0.014,
        brickMaterial(c),
      );
      m.userData[KEEP_SEPARATE] = true;
    }
    chalkSign(g, 0.6, 0.2, 0, body1 - 0.32, r + 0.003, 'Pellet silo');
    // A ladder up its side.
    const lx = Math.min(r + 0.07, hw - 0.03);
    for (const z of [-0.16, 0.16])
      block(g, 0.04, body1 - 0.05, 0.04, lx, (body1 - 0.05) / 2, z, frame);
    for (let y = 0.3; y < body1 - 0.1; y += 0.3) rodZ(g, 0.012, -0.14, 0.14, lx, y, darkMetal);
    // Its outlet, an elbow and the pipe out to the tap at the front: a valve wheel on top and
    // the spout down to the bucket.
    const zs = hd - 0.1;
    upright(g, 0.03, 0.03, 1.0, cone0 + 0.01, 0, 0, steel, 10);
    upright(g, 0.05, 0.05, 0.92, 1.0, 0, 0, steel, 12);
    rodZ(this.group, 0.04, cz + 0.04, zs, 0, 0.96, steel);
    upright(this.group, 0.05, 0.05, 0.92, 1.0, 0, zs, steel, 12);
    upright(this.group, 0.03, 0.022, 0.81, 0.92, 0, zs, steel, 12);
    upright(this.group, 0.06, 0.06, 1.0, 1.015, 0, zs, mat(0xd32f2f, 0.4), 12);
    // A grate to stand a bucket on under it, on a post.
    block(this.group, 0.32, 0.025, 0.28, 0, 0.5, hd - 0.16, darkMetal);
    block(this.group, 0.05, 0.4875, 0.05, 0, 0.24375, hd - 0.27, darkMetal);
    // The colour chart on one side, every colour there is, on a post.
    const cx = -(hw - 0.27);
    block(this.group, 0.05, 0.75, 0.05, cx, 0.375, hd - 0.08, darkMetal);
    block(this.group, 0.46, 0.46, 0.02, cx, 0.98, hd - 0.045, mat(0xf2f2ee, 0.7));
    const cols = Math.ceil(Math.sqrt(ids.length));
    const rows = Math.ceil(ids.length / cols);
    const cell = 0.4 / Math.max(cols, rows);
    for (const [i, c] of ids.entries()) {
      const m = block(
        this.group,
        cell * 0.8,
        cell * 0.8,
        0.004,
        cx - (cols * cell) / 2 + cell * ((i % cols) + 0.5),
        0.98 + (rows * cell) / 2 - cell * (Math.floor(i / cols) + 0.5),
        hd - 0.033,
        brickMaterial(c),
      );
      m.castShadow = false;
      m.userData[KEEP_SEPARATE] = true;
    }
    // A stack of empty buckets on the other.
    for (let i = 0; i < 3; i++) {
      const b = bucket(null);
      b.position.set(hw - 0.27, 0.002 + i * 0.04, hd - 0.16);
      this.group.add(b);
    }
  }

  // -- The mould dispenser --

  /**
   * A steel cabinet like a vending machine: a window on the left showing shelves of moulds, and
   * on the right a column with a screen, a keypad and the hatch at hand height the chosen mould
   * comes out of. The sign over the window says what it is.
   */
  private dispenser(w: number, h: number, d: number): void {
    const g = this.group;
    const hw = w / 2;
    const hd = d / 2;
    const side = 0.06;
    const back = -hd + 0.04;
    // The cabinet's front face, a little back from its box so the hatch can stand out, and
    // how thick the front panels are.
    const front = hd - 0.04;
    const skin = 0.04;
    const [y0, y1] = [0.08, h - 0.05];
    const [xa, xb] = [-hw + side, hw - side - 0.42];
    const [gy0, gy1] = [0.48, Math.min(h - 0.32, 1.7)];
    // The plinth, then the cabinet: its sides, top, bottom and back.
    block(g, w - 0.1, y0, d - 0.12, 0, y0 / 2, -0.02, darkMetal);
    for (const s of [-1, 1])
      block(g, side, h - y0, d - 0.04, s * (hw - side / 2), (y0 + h) / 2, -0.02, teal);
    block(g, w - 2 * side, h - y1, d - 0.04, 0, (y1 + h) / 2, -0.02, teal);
    block(g, w - 2 * side, 0.06, d - 0.04, 0, y0 + 0.03, -0.02, teal);
    block(g, w - 2 * side, y1 - y0 - 0.06, 0.04, 0, (y0 + 0.06 + y1) / 2, -hd + 0.02, panelGrey);
    // The front: panels under and over the window, and the control column to its right, all
    // one sheet; a divider behind, between the window and the column.
    const fz = front - skin / 2;
    const panel = mat(0xd9dcdf, 0.45);
    const lo = y0 + 0.06;
    block(g, xb - xa, gy0 - lo, skin, (xa + xb) / 2, (lo + gy0) / 2, fz, panel);
    block(g, xb - xa, y1 - gy1, skin, (xa + xb) / 2, (gy1 + y1) / 2, fz, panel);
    block(g, hw - side - xb, y1 - lo, skin, (xb + hw - side) / 2, (lo + y1) / 2, fz, panel);
    block(
      g,
      0.02,
      gy1 - gy0,
      front - skin - back,
      xb + 0.01,
      (gy0 + gy1) / 2,
      (front - skin + back) / 2,
      panelGrey,
    );
    // Steel trim round the window, and the glass.
    const t = 0.025;
    const tz = front + 0.005;
    block(g, xb - xa + 2 * t, t, 0.01, (xa + xb) / 2, gy0 - t / 2, tz, steel);
    block(g, xb - xa + 2 * t, t, 0.01, (xa + xb) / 2, gy1 + t / 2, tz, steel);
    for (const x of [xa - t / 2, xb + t / 2])
      block(g, t, gy1 - gy0, 0.01, x, (gy0 + gy1) / 2, tz, steel);
    const glass = block(
      g,
      xb - xa,
      gy1 - gy0,
      0.008,
      (xa + xb) / 2,
      (gy0 + gy1) / 2,
      front - 0.012,
      clear,
    );
    glass.castShadow = false;
    // Inside: three shelves of moulds, three to a shelf, under a strip light.
    const inner = front - skin - back;
    const iz = (front - skin + back) / 2;
    const gap = (gy1 - gy0) / 3;
    const k = Math.min(0.7, (xb - xa - 0.1) / 3 / MOULD_SIZE.x, (gap - 0.1) / MOULD_SIZE.y);
    for (let i = 0; i < 3; i++) {
      const sy = gy0 + 0.01 + i * gap;
      block(g, xb - xa, 0.02, inner, (xa + xb) / 2, sy - 0.01, iz, machineGrey);
      // A price strip along the shelf's edge.
      block(
        g,
        xb - xa - 0.02,
        0.033,
        0.004,
        (xa + xb) / 2,
        sy - 0.0085,
        front - skin + 0.004,
        panelGrey,
      );
      for (let j = 0; j < 3; j++) {
        const mould = mouldBlock(SHOWN_MOULDS[i * 3 + j]!);
        mould.scale.setScalar(k);
        mould.position.set(xa + ((xb - xa) * (j + 0.5)) / 3, sy, iz + 0.02);
        g.add(mould);
      }
    }
    block(g, xb - xa, 0.02, inner, (xa + xb) / 2, gy1 - 0.01, iz, machineGrey);
    block(
      g,
      xb - xa - 0.1,
      0.012,
      0.03,
      (xa + xb) / 2,
      gy1 - 0.026,
      front - skin - 0.06,
      mat(0xffffff, 0.4, 0, 0xdde8f0),
    );
    // The control column: a screen in its bezel, a keypad, and the hatch the mould comes out
    // of at hand height, with a smoked flap and a tray; vents at its foot.
    const cx = (xb + hw - side) / 2;
    block(g, 0.3, 0.22, 0.01, cx, gy1 - 0.2, front + 0.005, panelGrey);
    block(g, 0.25, 0.16, 0.006, cx, gy1 - 0.2, front + 0.013, screen);
    for (let i = 0; i < 9; i++) {
      const b = rodZ(
        g,
        0.016,
        front,
        front + 0.012,
        cx - 0.06 + (i % 3) * 0.06,
        gy1 - 0.4 - Math.floor(i / 3) * 0.05,
        steel,
      );
      b.castShadow = false;
    }
    rodZ(g, 0.024, front, front + 0.015, cx + 0.12, gy1 - 0.45, mat(0x3bb54a, 0.4)).castShadow =
      false;
    const [hy, hh, hwid] = [0.95, 0.22, 0.28];
    block(g, hwid, hh, 0.004, cx, hy, front + 0.002, darkMetal);
    block(g, hwid + 0.04, 0.03, 0.035, cx, hy + hh / 2 + 0.015, front + 0.0175, steel);
    for (const s of [-1, 1])
      block(g, 0.02, hh, 0.035, cx + s * (hwid / 2 + 0.01), hy, front + 0.0175, steel);
    block(g, hwid + 0.04, 0.025, 0.065, cx, hy - hh / 2 - 0.0125, front + 0.0025, steel);
    block(g, hwid + 0.04, 0.04, 0.01, cx, hy - hh / 2 + 0.005, front + 0.03, steel);
    const flap = block(g, hwid - 0.01, hh - 0.04, 0.006, cx, hy + 0.01, front + 0.018, smoked);
    flap.rotation.x = -0.12;
    flap.castShadow = false;
    for (let i = 0; i < 4; i++)
      block(g, 0.24, 0.015, 0.004, cx, 0.22 + i * 0.04, front + 0.002, darkMetal);
    chalkSign(g, 0.9, 0.18, 0, (gy1 + y1) / 2 + 0.01, front, 'Moulds');
  }

  // -- The UV printer --

  /** Where the part goes on the printer's bed: the bed's top, the part's middle and its room. */
  private printerBed() {
    const hw = this.def.size.x / 2;
    return { top: 0.8, x: -0.1, z: 0.05, w: 2 * (hw - 0.47), d: 0.5, room: 0.12 };
  }

  private printer(w: number, h: number, d: number): void {
    const g = this.group;
    const hw = w / 2;
    const hd = d / 2;
    const white = mat(0xe8e8e4, 0.5);
    const bed = this.printerBed();
    // The stand: legs, feet and a shelf.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        block(g, 0.05, 0.43, 0.05, sx * (hw - 0.12), 0.235, sz * (hd - 0.06), darkMetal);
        block(g, 0.09, 0.02, 0.09, sx * (hw - 0.12), 0.01, sz * (hd - 0.06), panelGrey);
      }
    block(g, w - 0.3, 0.02, d - 0.14, 0, 0.14, 0, darkMetal);
    // The cabinet, a stripe and the bed on top, ruled with a grid.
    block(g, w - 0.1, 0.33, d - 0.04, 0, 0.615, 0, white);
    block(g, w - 0.1, 0.03, 0.006, 0, 0.75, hd - 0.017, panelGrey);
    block(g, w - 0.7, 0.02, d - 0.1, 0, bed.top - 0.01, 0, mat(0x26292c, 0.8));
    // The towers at the ends, the gantry over the back of the bed and the print head parked
    // on it, its UV lamp glowing underneath.
    for (const s of [-1, 1]) block(g, 0.24, 0.2, d - 0.06, s * (hw - 0.17), 0.88, 0, white);
    const gz = -0.12;
    block(g, w - 0.5, 0.07, 0.08, 0, 0.975, gz, panelGrey);
    block(g, 0.02, 0.08, 0.09, -(hw - 0.32), 0.975, gz, darkMetal);
    const [head, hz] = [hw - 0.43, gz + 0.095];
    block(g, 0.2, 0.12, 0.13, head, 0.97, hz, white);
    block(g, 0.2, 0.02, 0.006, head, 1.0, hz + 0.068, mat(0x7a52d1, 0.5));
    block(g, 0.16, 0.012, 0.09, head, 0.904, hz, mat(0x9a6cff, 0.3, 0, 0x7c4dff));
    // Ink bottles on the left tower and a little screen on the right one.
    for (const [i, c] of [0x00a3e0, 0xe0218a, 0xf6d300, 0x222222, 0xffffff].entries())
      upright(g, 0.018, 0.018, 0.98, 1.04, -(hw - 0.08) + i * 0.045, -0.05, mat(c, 0.4), 10);
    block(g, 0.16, 0.1, 0.006, hw - 0.17, 0.89, hd - 0.027, screen);
    for (const [i, c] of [0x3bb54a, 0xd32f2f].entries())
      rodZ(g, 0.015, hd - 0.03, hd - 0.018, hw - 0.4 + i * 0.06, 0.62, mat(c, 0.4)).castShadow =
        false;
    chalkSign(g, 0.8, 0.2, -0.15, 0.615, hd - 0.024, 'UV printer');
  }

  private printerContents(m: MachineState, svgs: Record<string, string>): void {
    const p = m.part;
    if (!p) return;
    const bed = this.printerBed();
    const geo = brickGeometry(p.type);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const size = bb.getSize(new THREE.Vector3());
    const k = Math.min(1, bed.w / size.x, bed.d / size.z, bed.room / size.y);
    const part = new THREE.Mesh(geo, brickMaterial(p.colour));
    part.scale.setScalar(k);
    const mid = bb.getCenter(new THREE.Vector3()).multiplyScalar(k);
    part.position.set(bed.x - mid.x, bed.top + 0.001 - bb.min.y * k, bed.z - mid.z);
    addDecorations(part, p.type);
    if (p.prints) addPrints(part, p.type, p.prints, svgs);
    this.dynamic.add(part);
  }
}

/** A mesh with a geometry of its own (thrown away when it is rebuilt), at height `y`. */
function ownMesh(geo: THREE.BufferGeometry, material: THREE.Material, y: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  m.userData.own = true;
  return m;
}
