import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BUCKET_SHOTS,
  COLOURS,
  MAKE_SECONDS,
  MOULD_TYPES,
  PRESS_BAY,
  outputSlots,
  printKey,
} from '@sar/shared';
import type {
  BrickTypeId,
  ColourId,
  Made,
  MachineDef,
  MachinePart,
  MachineState,
  OutputSlot,
  SimEvent,
  Tool,
} from '@sar/shared';
import { random } from '../clock.ts';
import { brickGeometry, brickMaterial } from './bricks.ts';
import { add, mat, metal } from './interiors.ts';
import { KEEP_SEPARATE } from './merge.ts';
import { mouldTop, posedInMould } from './mouldCavity.ts';
import type { MouldTop } from './mouldCavity.ts';
import { addDecorations, addPrints } from './prints.ts';
import { bevelBox, bevelFor } from './shapes.ts';

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

const boxGeo = (x: number, y: number, z: number, radius: number) =>
  cached(`box:${x}:${y}:${z}:${radius}`, () => bevelBox(x, y, z, radius));
const canGeo = (r: number, h: number, segments = 12) =>
  cached(`can:${r}:${h}:${segments}`, () => new THREE.CylinderGeometry(r, r, h, segments));

/**
 * A box from the shared geometries, centred at `x, y, z`, its edges bevelled `radius` deep: to
 * suit its size unless it says (0 for square edges, where pieces meet as one).
 */
function block(
  parent: THREE.Object3D,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  material: THREE.Material,
  radius = bevelFor(sx, sy, sz),
): THREE.Mesh {
  return add(parent, boxGeo(sx, sy, sz, radius), material, x, y, z);
}

/** A corner of a box: its x, y and z. */
type Corner = [number, number, number];

/** A box like `block`, from corner `a` to the opposite corner `b`. */
function boxBetween(
  parent: THREE.Object3D,
  [x0, y0, z0]: Corner,
  [x1, y1, z1]: Corner,
  material: THREE.Material,
  radius?: number,
): THREE.Mesh {
  const [sx, sy, sz] = [x1 - x0, y1 - y0, z1 - z0];
  return block(parent, sx, sy, sz, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, material, radius);
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

/** A flat ring from `y0` up to `y1`, `rIn` to `rOut` across, centred on `x, z`. */
function collar(
  parent: THREE.Object3D,
  rIn: number,
  rOut: number,
  y0: number,
  y1: number,
  x: number,
  z: number,
  material: THREE.Material,
  segments = 16,
): THREE.Mesh {
  const h = y1 - y0;
  const geo = cached(`collar:${rIn}:${rOut}:${h}:${segments}`, () => {
    const s = new THREE.Shape().absarc(0, 0, rOut, 0, Math.PI * 2);
    s.holes.push(new THREE.Path().absarc(0, 0, rIn, 0, Math.PI * 2));
    return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: segments })
      .rotateX(-Math.PI / 2)
      .translate(0, -h / 2, 0);
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
export function pelletHeap(r: number): THREE.BufferGeometry {
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

/**
 * Pellets of `colour` filling a round space of radius `r` up to `y`, heaped on top: the top
 * centimetre of them and the heap, as a group standing at `y`.
 */
function pelletTop(g: THREE.Object3D, r: number, y: number, colour: ColourId): THREE.Group {
  const plastic = brickMaterial(colour);
  const top = new THREE.Group();
  top.position.y = y;
  g.add(top);
  const disc = upright(top, r, r, -0.01, 0, 0, 0, plastic, 20);
  const heap = add(top, pelletHeap(r), plastic, 0, 0, 0);
  for (const m of [disc, heap]) m.userData[KEEP_SEPARATE] = true;
  return top;
}

// ---- Moulds ----

const mouldSteel = metal(0x8c949b);
const mouldSteelLight = metal(0xa9b0b7);
const mouldDark = mat(0x2b2f33, 0.6, 0.4);
const pinSteel = metal(0xd5dade);
/** The cavity's walls and floor: polished, and darker than the face round it, so it reads as a hole. */
const polished = mat(0x6c757d, 0.25, 0.6);
const brass = mat(0xc9a14a, 0.35, 0.6);

/** A mould block's size, as on the dispenser's shelves and clamped in the moulding machine. */
export const MOULD_SIZE = { x: 0.4, y: 0.2, z: 0.4 };

/** How far the moulding machine's safety door slides to open: its frame clear of the mould. */
const DOOR_SLIDE = 0.68;
/** How high the mouth of the moulding machine's chute stands on its bed, under the door's rail. */
const CHUTE_TOP = 0.63;

/** How far back from upright the dispenser's moulds lean on its shelves, to show their cavities. */
const SHELF_LEAN = 1.0;

/** How wide the steel round a mould's cavity is, at least. */
const MOULD_RIM = 0.065;

/** Each part's mould's upper half, made once: its face and its cavity. */
const mouldTops = new Map<BrickTypeId, MouldTop>();

/**
 * The upper half of a mould for `type`, `height` thick: a steel slab with the part's shape sunk
 * in its top, as big as fits with a rim round it and steel left under it.
 */
function mouldTopFor(type: BrickTypeId, height: number): MouldTop {
  let top = mouldTops.get(type);
  if (top) return top;
  const { x: W, z: D } = MOULD_SIZE;
  const room = W - 2 * MOULD_RIM;
  const posed = posedInMould(brickGeometry(type), room, height - 0.02, room);
  top = mouldTop(posed, W, D, height);
  posed.dispose();
  mouldTops.set(type, top);
  return top;
}

/**
 * A mould block in its own frame: the centre of its bottom at the origin, `MOULD_SIZE`, its
 * cavity face up (+y) and its front +z. Two halves with a parting line between them, guide
 * pins at the corners, a sprue bush at the back and the part's shape sunk into the top as its
 * cavity, dark against the face, so the moulds can be told apart from a little way off.
 */
export function mouldBlock(type: BrickTypeId): THREE.Group {
  const g = new THREE.Group();
  const { x: W, y: H, z: D } = MOULD_SIZE;
  const lower = H * 0.44;
  const gap = 0.006;
  const top = H - 0.015;
  const rim = 0.05;
  // Ground steel, square-edged like the upper half, the parting line between them.
  block(g, W, lower, D, 0, lower / 2, 0, mouldSteel, 0);
  block(g, W - 0.016, gap, D - 0.016, 0, lower + gap / 2, 0, mouldDark);
  const y0 = lower + gap;
  // The upper half, the cavity sunk in it.
  const { face, cavity } = mouldTopFor(type, top - y0);
  add(g, face, mouldSteelLight, 0, top, 0);
  add(g, cavity, polished, 0, top, 0);
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
  upright(g, 0.009, 0.009, top + 0.002, top + 0.006, 0, -D / 2 + rim / 2, mouldDark, 10);
  // A brass maker's plate on the front.
  block(g, W * 0.4, lower * 0.4, 0.003, 0, lower / 2, D / 2 + 0.0015, brass);
  return g;
}

// ---- Buckets ----

export const BUCKET = { height: 0.26, bottom: 0.1, top: 0.125 };
/** How high a full bucket's pellets come, up its inside. */
const BUCKET_FULL = BUCKET.height * 0.82;
/** How wide the pellets in a bucket are `y` up its inside, where it is that wide. */
const pelletsWide = (y: number) =>
  BUCKET.bottom + ((BUCKET.top - BUCKET.bottom) * y) / BUCKET.height - 0.004;
const bucketPlastic = new THREE.MeshStandardMaterial({
  color: 0xf2f2ee,
  roughness: 0.55,
  side: THREE.DoubleSide,
});
/** Its bottom is solid, so it is drawn from outside alone, to stand flat on a grate. */
const bucketBase = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.55 });

/**
 * A plastic pail with a wire handle, its bottom centre at the origin, filled most of the way
 * with `colour` pellets, or empty.
 */
export function bucket(colour: ColourId | null): THREE.Group {
  const g = new THREE.Group();
  const { height: h, bottom, top } = BUCKET;
  upright(g, bottom, top, 0.008, h, 0, 0, bucketPlastic, 24, true);
  upright(g, bottom, bottom, 0, 0.008, 0, 0, bucketBase, 24);
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
  if (colour) pelletTop(g, pelletsWide(BUCKET_FULL), BUCKET_FULL, colour);
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

/** What a brick works event says, as far as a machine's view shows it. */
export type MachineEvent = Pick<SimEvent, 'kind' | 'mould' | 'colour' | 'slot'>;

/**
 * A machine of the brick works as it is drawn, standing at its foot and turned to face its way,
 * with what is in it shown and what it does played out: what every look of the machines has
 * alike (the game's own models, `MachineView`, and the car scene's, `CarMachineView`). What the
 * machine is doing is kept as jobs, each of which poses the model as it goes and leaves what it
 * made at rest in its place in the output area when it ends; what is in the machine and what
 * waits in its output area are drawn again from its state when that changes.
 */
export abstract class MachineLook {
  /** What changes with the machine's state: rebuilt only when that changes. */
  protected readonly dynamic = new THREE.Group();
  private key = '';
  protected last: { m: MachineState; svgs: Record<string, string>; powered: boolean } | null = null;
  /** The places in its output area (see `outputSlots`). */
  protected readonly places: OutputSlot[];
  /** When a jammed machine next puffs smoke, in seconds. */
  private nextSmoke = 0;
  /** The work under way, and what is drawn for it. */
  protected readonly fx = new THREE.Group();
  protected jobs: Job[] = [];
  /**
   * Jobs that have ended with what they made at rest in the output area before the machine's
   * state says it is there: drawn as they left it until it does (see `update`).
   */
  private resting: Job[] = [];

  constructor(
    protected readonly def: MachineDef,
    readonly group = new THREE.Group(),
  ) {
    this.places = outputSlots(def.kind, def.size);
  }

  /**
   * Puts the layers of what changes on the model, over what it is built of: called once the
   * model is built, so that they come last among its children.
   */
  protected addLayers(): void {
    this.fx.userData[KEEP_SEPARATE] = true;
    this.fx.name = 'fx';
    this.dynamic.name = 'contents';
    this.group.add(this.fx, this.dynamic);
  }

  /** The job that shows event `e`, if this machine shows it at all. */
  protected abstract jobFor(e: MachineEvent, slot: number): Omit<Job, 'start'> | null;

  /** Draws what is in the machine into `dynamic`, bar what waits in its output area. */
  protected abstract contents(
    m: MachineState,
    svgs: Record<string, string>,
    powered: boolean,
  ): void;

  /** Shows whether something waits in its output area or is on its way there (`busy`). */
  protected waiting(_m: MachineState, _busy: Set<number | undefined>): void {}

  /** Before the jobs under way are posed for a frame (or cut short). */
  protected beforePose(): void {}

  /** What it does by itself every frame, whatever its jobs; `now` in seconds. */
  protected idle(_now: number): void {}

  /** What the machine's state was (`was`, null at first) and is now (`m`), as it changes. */
  protected changed(_was: MachineState | null, _m: MachineState): void {}

  /**
   * Shows the machine doing what a player just had it do: the silo filling a bucket on its
   * grate, the dispenser dropping a mould into its hatch, the moulding machine taking a mould or
   * a bucket of pellets, or moulding a part and dropping it into its bay; what it makes comes to
   * rest in the place in its output area the event says (`slot`). `now` in seconds.
   */
  play(e: MachineEvent, now: number): void {
    const job = this.jobFor(e, e.slot ?? 0);
    if (job) this.start(job, now);
  }

  /** Sets a job going from `now` (in seconds). */
  protected start(job: Omit<Job, 'start'>, now: number): void {
    // Making something and loading the machine (or taking out what it made) go on side by
    // side, as a mould can go in while a part is moulded; otherwise one thing at a time, and
    // whatever was under way jumps to its end.
    const keep = this.jobs.filter((j) => laneOf(j) !== laneOf(job));
    const under = this.jobs.filter((j) => !keep.includes(j));
    this.jobs = keep;
    this.beforePose();
    for (const j of under) this.finish(j, true);
    // What an earlier job left in this place makes way for what this one brings.
    if (job.slot !== undefined) this.settle((j) => j.slot === job.slot);
    this.jobs = [...keep, { ...job, start: now }];
    // Whatever is drawn waiting in its place goes while it is under way.
    if (job.slot !== undefined && this.last) this.rebuild();
    this.tick(now);
  }

  /** Moves the work under way along to `now` (in seconds); call every frame. */
  tick(now: number): void {
    this.idle(now);
    if (!this.jobs.length) return;
    const done = this.jobs.filter((j) => now - j.start >= j.length);
    this.jobs = this.jobs.filter((j) => !done.includes(j));
    // What ended is put away first: that redraws what waits in the output area, which would
    // otherwise undo this frame's pose of the work still under way.
    for (const j of done) this.finish(j);
    this.beforePose();
    for (const j of this.jobs) j.step(now - j.start);
  }

  /** Whether a job is bringing something to place `slot`, or has brought it and it rests there. */
  protected showing(slot: number): boolean {
    return [...this.jobs, ...this.resting].some((j) => j.slot === slot);
  }

  /** Whether the machine is busy showing something. */
  get working(): boolean {
    return this.jobs.length > 0;
  }

  /**
   * Ends a job (no longer among `jobs`). What it made stays at rest where it left it until the
   * machine's state says it is there (the server may say so a moment later than it ends here),
   * and from then on is drawn with the rest of what waits in the output area. Cut short
   * (`early`), it had not got there yet: it is drawn there only once the state says it is.
   */
  private finish(j: Job, early = false): void {
    j.step(j.length);
    j.end();
    if (j.slot === undefined) {
      this.fx.remove(j.group);
      return;
    }
    if (!early && this.last?.m.making?.slot === j.slot) this.resting.push(j);
    else this.fx.remove(j.group);
    if (this.last) this.rebuild();
  }

  /** Stops drawing what the resting jobs that `done` picks out left behind. */
  private settle(done: (j: Job) => boolean): boolean {
    const settled = this.resting.filter(done);
    for (const j of settled) this.fx.remove(j.group);
    this.resting = this.resting.filter((j) => !settled.includes(j));
    return settled.length > 0;
  }

  /**
   * Shows what is in the machine, what waits in its output area, and whether it is jammed or
   * without power; cheap when that has not changed.
   */
  update(m: MachineState, svgs: Record<string, string>, powered = true): void {
    const p = m.part;
    const key = [
      m.mould ?? '',
      m.colour ?? '',
      m.shots,
      p ? `${p.type}:${p.colour}:${printKey(p.prints)}` : '',
      m.jammed,
      powered,
      JSON.stringify(m.out),
    ].join('|');
    // Once the machine is no longer making what a job left at rest, it lies in the output area
    // (unless taken already), drawn there from now on.
    const settled = this.settle((j) => m.making?.slot !== j.slot);
    if (key === this.key && svgs === this.last?.svgs && !settled) return;
    this.key = key;
    const was = this.last?.m ?? null;
    this.last = { m, svgs, powered };
    this.changed(was, m);
    this.rebuild();
  }

  /** Whether a jammed machine is due another puff of smoke at `now` (in seconds). */
  smokeDue(now: number): boolean {
    if (now < this.nextSmoke) return false;
    this.nextSmoke = now + 0.9 + random() * 0.6;
    return true;
  }

  /** Builds what is in the machine again, as when the colour goggles go on or off. */
  refreshColours(): void {
    if (this.last) this.rebuild();
  }

  protected rebuild(): void {
    // Shared geometries stay; those made for this machine alone go.
    this.dynamic.traverse((o) => {
      if (o instanceof THREE.Mesh && (o.userData.own || o.userData.decoration))
        o.geometry.dispose();
    });
    this.dynamic.clear();
    const { m, svgs, powered } = this.last!;
    this.contents(m, svgs, powered);
    this.outContents(m);
    this.dynamic.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.userData[KEEP_SEPARATE] = true;
      }
    });
  }

  /**
   * What waits in the output area, each thing at rest in its place: but not where a job is
   * bringing something, or has just brought it, which draws it there itself until it is done.
   */
  private outContents(m: MachineState): void {
    const busy = new Set([...this.jobs, ...this.resting].map((j) => j.slot));
    m.out.forEach((made, slot) => {
      const place = this.places[slot];
      if (!made || !place || busy.has(slot)) return;
      const thing = madeModel(made);
      thing.position.set(place.rest.x, place.rest.y, place.rest.z);
      thing.userData.slot = slot;
      this.dynamic.add(thing);
    });
    this.waiting(m, busy);
  }

  /** What lies in each place in the output area as drawn, each with its place as `slot`. */
  outItems(): THREE.Object3D[] {
    return this.dynamic.children.filter((o) => o.userData.slot !== undefined);
  }

  /** Where what is made comes to rest in place `slot` of the output area. */
  protected restAt(slot: number): THREE.Vector3 {
    const { rest } = this.places[slot] ?? this.places[0]!;
    return new THREE.Vector3(rest.x, rest.y, rest.z);
  }

  /** A group of its own for one job's models. */
  protected jobGroup(): THREE.Group {
    const g = new THREE.Group();
    this.fx.add(g);
    return g;
  }
}

/** Which jobs go on side by side: one at a time in each lane (see `Job.lane`). */
function laneOf(j: Omit<Job, 'start'>): string {
  return j.lane ?? (j.slot === undefined ? 'load' : 'make');
}

/**
 * A machine of the brick works in the game's own models: what is in it shown, the moulding
 * machine's mould and pellets, the part on the printer's bed, and what waits in its output area
 * for someone to take it.
 */
export class MachineView extends MachineLook {
  /**
   * The moulding machine's stack light: green when it can mould a part (a mould and pellets in
   * it, and room in its tray), amber when it has either in it but cannot (half loaded, or its
   * tray full), red when it has neither or is jammed, and dark without power.
   */
  private lights: THREE.Mesh[] = [];
  /** Which of the stack lights are lit, between flashes. */
  private lit = [false, false, true];
  /** What moves when the machine works (see `play`), set up as each machine is built. */
  private readonly parts: MovingParts;
  /**
   * How far open the jobs posed so far this frame want the moulding machine's clamp (see
   * `clamp`): back to shut before they are posed each frame, or cut short.
   */
  private clampOpen = 0;

  constructor(def: MachineDef) {
    super(def);
    this.group.position.set(def.pos.x, def.pos.y, def.pos.z);
    this.group.rotation.y = def.facing;
    const { x: w, y: h, z: d } = def.size;
    if (def.kind === 'press') this.parts = { kind: 'press', ...this.press(w, h, d) };
    else if (def.kind === 'silo') this.parts = { kind: 'silo', ...this.silo(w, h, d) };
    else if (def.kind === 'dispenser')
      this.parts = { kind: 'dispenser', ...this.dispenser(w, h, d) };
    else {
      this.printer(w, h, d);
      this.parts = { kind: 'printer' };
    }
    this.addLayers();
  }

  protected jobFor(e: MachineEvent, slot: number): Omit<Job, 'start'> | null {
    const p = this.parts;
    return p.kind === 'silo' && e.kind === 'fill' && e.colour
      ? this.fillJob(p, e.colour, slot)
      : p.kind === 'dispenser' && e.kind === 'dispense' && e.mould
        ? this.dispenseJob(p, e.mould, slot)
        : p.kind === 'dispenser' && e.kind === 'toolUp'
          ? this.flapJob(p)
          : p.kind === 'press' && e.kind === 'mouldIn'
            ? this.mouldInJob(p)
            : p.kind === 'press' && e.kind === 'pour' && e.colour
              ? this.pourJob(e.colour)
              : p.kind === 'press' && e.kind === 'moulded' && e.mould && e.colour
                ? this.mouldJob(p, e.mould, e.colour, slot)
                : null;
  }

  protected override beforePose(): void {
    this.clampOpen = 0;
  }

  protected contents(m: MachineState, svgs: Record<string, string>, powered: boolean): void {
    if (this.parts.kind === 'press') this.pressContents(this.parts, m, powered);
    else if (this.def.kind === 'printer') this.printerContents(m, svgs);
  }

  protected override waiting(m: MachineState, busy: Set<number | undefined>): void {
    // The dispenser's screen glows brighter, and a lamp lights the hatch, while a mould waits.
    if (this.parts.kind === 'dispenser') {
      const waiting = !!m.out[0] || busy.has(0);
      this.parts.screen.emissiveIntensity = waiting ? WAITING_GLOW : 1;
      this.parts.hatchLamp.material = lamp(HATCH_LAMP, waiting);
    }
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

  private press(w: number, h: number, d: number): Omit<PressParts, 'kind'> {
    const g = this.group;
    const { hw, hd, mx, my, cz, hx, hx0, hopper } = this.pressLayout(w, d);
    // Feet, the bed, and a stripe along its front.
    for (const x of [-hw + 0.2, 0, hw - 0.2])
      for (const z of [-hd + 0.15, hd - 0.15]) block(g, 0.12, 0.1, 0.12, x, 0.05, z, darkMetal);
    // The bed has a bay in its front under the mould, which the parts it makes drop into and
    // wait in (see `PRESS_BAY`). It is built of blocks round the bay, each reaching into the
    // next by twice its bevel: their bevels where they meet are out of sight inside each other,
    // so only its outer edges show them, as one block's would. The blocks over and under the
    // bay are too thin for so deep a bevel and get less (see `BevelBoxGeometry`): the chute's
    // mouth covers the front edge of the one over it, and the one under it stands back from the
    // front by the bevel, so that its edges stay inside the bed's to either side of the bay,
    // out of sight behind the tray's lip, which comes down to the bed's foot.
    const bevel = bevelFor(w - 0.08, 0.52, d - 0.1);
    const bed = { x0: -hw + 0.04, x1: hw - 0.04, y0: 0.1, y1: 0.62, z0: -hd + 0.03, z1: hd - 0.07 };
    const bay = {
      x0: mx - 1.5 * PRESS_BAY.step,
      x1: mx + 1.5 * PRESS_BAY.step,
      y0: PRESS_BAY.floor,
      y1: PRESS_BAY.top,
      z0: bed.z1 - PRESS_BAY.depth,
    };
    const tray = 0.01;
    const [left, right, back] = [bay.x0 - 2 * bevel, bay.x1 + 2 * bevel, bay.z0 - 2 * bevel];
    const grey = (a: Corner, b: Corner) => boxBetween(g, a, b, machineGrey, bevel);
    grey([bed.x0, bed.y0, bed.z0], [bay.x0, bed.y1, bed.z1]);
    grey([bay.x1, bed.y0, bed.z0], [bed.x1, bed.y1, bed.z1]);
    // Behind the bay, over it, and under it (and the tray along its floor).
    grey([left, bed.y0, bed.z0], [right, bed.y1, bay.z0]);
    grey([left, bay.y1, back], [right, bed.y1, bed.z1]);
    grey([left, bed.y0, back], [right, bay.y0 - tray, bed.z1 - bevel]);
    // The stripe stops where the bed's bevelled edges turn away, at its ends and over it. Over
    // the bay it is its top edge, and fills the bevel along the bottom of the block over it.
    const stripe = w - 0.08 - 2 * bevel;
    const sy = bed.y1 - bevel - 0.035;
    block(g, stripe, 0.06, 0.01, 0, sy, hd - 0.065, teal);
    const [sx0, sx1] = [bay.x0 - bevel, bay.x1 + bevel];
    boxBetween(g, [sx0, sy - 0.03, bed.z1 - bevel], [sx1, sy + 0.03, bed.z1], teal, 0);
    // The bay's inside is dark, so the parts in it stand out: its back, its sides as far as the
    // bevels at its mouth, and its ceiling, where the chute from the mould comes out. A tray
    // along its floor runs out into those bevels, and its lip at the front is a plate down to
    // the bed's foot, over the block under the bay.
    const sheet = 0.006;
    const mouth = bed.z1 - bevel;
    boxBetween(g, [bay.x0, bay.y0, bay.z0], [bay.x1, bay.y1, bay.z0 + sheet], darkMetal);
    for (const x of [bay.x0, bay.x1 - sheet])
      boxBetween(g, [x, bay.y0, bay.z0 + sheet], [x + sheet, bay.y1, mouth], darkMetal);
    const ceiling: Corner = [bay.x0 + sheet, bay.y1 - 0.004, bay.z0 + sheet];
    boxBetween(g, ceiling, [bay.x1 - sheet, bay.y1, mouth], darkMetal);
    boxBetween(g, [sx0, bay.y0 - tray, bay.z0], [sx1, bay.y0, bed.z1 - 0.01], panelGrey);
    const lip: Corner = [sx0, bed.y0, bed.z1 - 0.01];
    boxBetween(g, lip, [sx1, bay.y0 + 0.015, bed.z1 + 0.003], panelGrey);
    // The clamp: its cylinder housing at the end, the ram, the moving and fixed platens and
    // four tie bars between.
    block(g, 0.32, 0.64, d - 0.2, -hw + 0.22, 0.94, -0.03, teal);
    // The ram and the moving platen slide together (see `clamp`).
    const clampParts = new THREE.Group();
    g.add(clampParts);
    rod(clampParts, 0.07, -hw + 0.36, mx - 0.28, my, cz, steel);
    block(clampParts, 0.1, 0.62, 0.64, mx - 0.25, my, cz, tealDark);
    block(g, 0.14, 0.62, 0.64, mx + 0.27, my, cz, tealDark);
    for (const y of [my - 0.25, my + 0.25])
      for (const z of [-0.26, 0.26]) rod(g, 0.035, -hw + 0.36, mx + 0.36, y, cz + z, steel);
    // The mouth of the chute down to the bay, on the bed in front of the mould's face, over
    // the stripe and along the block over the bay.
    const chute: Corner = [left, sy + 0.03, bed.z1 - 0.075];
    boxBetween(g, chute, [right, CHUTE_TOP, bed.z1 + 0.002], darkMetal);
    // A guard sheet behind the mould and the safety door in front of it: a glass pane in a
    // frame with a handle.
    block(g, 0.84, 0.62, 0.01, mx, my, cz - 0.345, panelGrey);
    // The door hangs from a rail along its top and slides along it to the right, clear of the
    // mould but short of the control panel (see `door`).
    const doorZ = hd - 0.05;
    const [dx0, dx1, dy0, dy1] = [mx - 0.42, mx + 0.42, 0.66, 1.2];
    const bar = 0.03;
    const door = new THREE.Group();
    door.position.set(0, dy1, doorZ);
    g.add(door);
    block(door, dx1 - dx0, bar, bar, mx, dy0 + bar / 2 - dy1, 0, panelGrey);
    block(door, dx1 - dx0, bar, bar, mx, -bar / 2, 0, panelGrey);
    for (const x of [dx0 + bar / 2, dx1 - bar / 2])
      block(door, bar, dy1 - dy0 - 2 * bar, bar, x, (dy0 + dy1) / 2 - dy1, 0, panelGrey);
    const glass = block(
      door,
      dx1 - dx0 - 2 * bar,
      dy1 - dy0 - 2 * bar,
      0.008,
      mx,
      (dy0 + dy1) / 2 - dy1,
      0,
      clear,
    );
    glass.castShadow = false;
    block(door, 0.025, 0.22, 0.02, dx0 + 0.08, my - dy1, hd - 0.02 - doorZ, steel);
    for (const y of [my - 0.09, my + 0.09])
      block(door, 0.02, 0.02, 0.02, dx0 + 0.08, y - dy1, hd - 0.04 - doorZ, steel);
    // The rail it hangs from and the guide its foot runs in, long enough for it open.
    const rx1 = dx1 + DOOR_SLIDE;
    block(g, rx1 - dx0, 0.024, 0.04, (dx0 + rx1) / 2, dy1 + 0.012, doorZ, darkMetal);
    block(g, rx1 - dx0, 0.02, 0.04, (dx0 + rx1) / 2, dy0 - 0.02, doorZ, darkMetal);
    // The sign over the door, on posts standing on the platens.
    for (const x of [mx - 0.25, mx + 0.27])
      block(g, 0.03, 0.2, 0.03, x, my + 0.41, hd - 0.12, darkMetal);
    chalkSign(g, 1.1, 0.2, mx, my + 0.44, hd - 0.105, 'Moulding machine');
    // The injection unit: the barrel with its heater bands on a carriage, the hopper over it,
    // and the housing with the motor and controls.
    block(g, hx0 - (mx + 0.34), 0.16, 0.3, (hx0 + mx + 0.34) / 2, 0.7, cz, tealDark);
    rod(g, 0.075, mx + 0.34, hx0, 0.85, cz, steel);
    // The heater bands glow while it moulds: a material of this machine's own.
    const heat = new THREE.MeshStandardMaterial({
      color: 0x8a4b2a,
      roughness: 0.5,
      metalness: 0.3,
      emissive: 0xff5a1f,
      emissiveIntensity: 0,
    });
    for (const x of [mx + 0.5, mx + 0.68, hx + 0.2])
      rod(g, 0.085, x - 0.03, x + 0.03, 0.85, cz, heat);
    upright(g, 0.05, 0.05, hopper.neck, hopper.cone, hx, cz, steel, 12);
    upright(g, 0.05, hopper.r, hopper.cone, hopper.cyl, hx, cz, clear, 20, true).castShadow = false;
    upright(g, hopper.r, hopper.r, hopper.cyl, hopper.top, hx, cz, clear, 20, true).castShadow =
      false;
    // A ring round the clear hopper where its cone meets its drum, open in the middle so the
    // last of the pellets in the cone can be seen; and its lid with a vent pipe.
    const { r, cyl, top: lid } = hopper;
    collar(g, r - 0.012, r + 0.01, cyl - 0.01, cyl + 0.01, hx, cz, panelGrey, 20);
    upright(g, r + 0.012, r + 0.012, lid, lid + 0.03, hx, cz, panelGrey, 20);
    upright(g, 0.03, 0.03, hopper.top + 0.03, h - 0.005, hx, cz, darkMetal, 10);
    const top = 1.25;
    const [x1, front] = [hw - 0.04, hd - 0.11];
    block(g, x1 - hx0, top - 0.62, d - 0.16, (hx0 + x1) / 2, (top + 0.62) / 2, -0.03, teal);
    // The cover plate on its top, inside its bevelled edges.
    const inset = 2 * bevelFor(x1 - hx0, top - 0.62, d - 0.16);
    block(
      g,
      x1 - hx0 - inset,
      0.02,
      d - 0.16 - inset,
      (hx0 + x1) / 2,
      top + 0.01,
      -0.03,
      machineGrey,
    );
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
      block(g, 0.4, 0.02, 0.006, px, 1.09 + i * 0.04, front + 0.003, darkMetal);
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
    return { clamp: clampParts, door, heat, mould: null };
  }

  private pressContents(parts: PressParts, m: MachineState, powered: boolean): void {
    const { hd, mx, my, cz, hx, hopper } = this.pressLayout(this.def.size.x, this.def.size.z);
    const ready =
      !!m.mould &&
      !!m.colour &&
      m.shots > 0 &&
      !m.jammed &&
      // A place free for the next part: not the one the part being moulded drops into.
      m.out.some((x, i) => x === null && m.making?.slot !== i);
    const half = !ready && !m.jammed && (!!m.mould || (!!m.colour && m.shots > 0));
    // Without power the stack light is dark; jammed, it shows red.
    this.lit = powered ? [ready, half, !ready && !half] : [false, false, false];
    this.showLights();
    parts.mould = null;
    if (m.mould) {
      // Clamped between the platens, its cavity face toward the door.
      const mould = mouldBlock(m.mould);
      mould.rotation.x = Math.PI / 2;
      mould.position.set(mx, my, hd - 0.1 - MOULD_SIZE.y);
      this.dynamic.add(mould);
      parts.mould = mould;
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

  private showLights(flash = -1): void {
    for (const [i, c] of [0x3bb54a, 0xf2a530, 0xd32f2f].entries())
      this.lights[i]!.material = lamp(c, i === flash || (flash < 0 && this.lit[i]!));
  }

  /** Puts a mould in: the door slides aside, the clamp opens, the mould slides in and it shuts. */
  private mouldInJob(p: PressParts): Omit<Job, 'start'> {
    const { hd, mx, my } = this.pressLayout(this.def.size.x, this.def.size.z);
    const home = new THREE.Vector3(mx, my, hd - 0.1 - MOULD_SIZE.y);
    const from = new THREE.Vector3(mx, my + 0.12, hd + 0.5);
    return {
      length: 1.5,
      group: this.jobGroup(),
      step: (t) => {
        this.door(p, span(t, 0, 0.3) - span(t, 1.15, 1.5));
        this.clamp(p, span(t, 0, 0.3) - span(t, 0.95, 1.15));
        p.mould?.position.lerpVectors(from, home, ease(span(t, 0.25, 0.95)));
      },
      end: () => p.mould?.position.copy(home),
    };
  }

  /** Pours pellets in: a bucket tips over the hopper and empties into it. */
  private pourJob(colour: ColourId): Omit<Job, 'start'> {
    const { hx, cz, hopper } = this.pressLayout(this.def.size.x, this.def.size.z);
    const group = this.jobGroup();
    const pail = bucket(colour);
    group.add(pail);
    const lip = new THREE.Vector3(hx, hopper.top + 0.1, cz);
    const stream = pelletStream(group, colour, lip, hopper.top - 0.15);
    return {
      length: 1.4,
      group,
      step: (t) => {
        // From over the hopper's side, tipped toward it, then put down out of the way.
        const tip = ease(span(t, 0, 0.35)) - ease(span(t, 1.05, 1.4));
        pail.position.set(hx + 0.28 - 0.06 * tip, hopper.top + 0.12 + 0.06 * tip, cz);
        pail.rotation.z = 1.9 * tip;
        pail.scale.setScalar(1 - span(t, 1.15, 1.4));
        stream(t >= 0.3 && t < 1.05 ? t : null);
      },
      end: () => {},
    };
  }

  /**
   * Moulds a part: the clamp shuts tight, the heater bands glow while the plastic goes in, the
   * clamp opens and the part is pushed off the mould's face and drops down the chute, out of
   * which it falls into its place in the bay in the bed's front, to wait there to be taken.
   */
  private mouldJob(
    p: PressParts,
    type: BrickTypeId,
    colour: ColourId,
    slot: number,
  ): Omit<Job, 'start'> {
    const { hd, mx, my } = this.pressLayout(this.def.size.x, this.def.size.z);
    const group = this.jobGroup();
    const part = lyingPart(type, colour);
    const turned = part.children[0]!;
    const half = turned.position.y;
    group.add(part);
    // Where its middle goes: from in the mould's cavity out of its face, then down in front of
    // it into the chute's mouth. Out of sight in the chute it goes over its place in the bay,
    // and comes out of the bay's ceiling there.
    const cavity = new THREE.Vector3(mx, my, hd - 0.12);
    const off = new THREE.Vector3(mx, my, hd - 0.095);
    const rest = this.restAt(slot);
    const { heat } = p;
    return {
      length: MAKE_SECONDS.part,
      slot,
      group,
      step: (t) => {
        // A shudder while it injects; open to let the part go; shut again.
        const shake = t > 0.25 && t < 0.9 ? Math.sin(t * 90) * 0.002 : 0;
        this.clamp(p, span(t, 1.0, 1.2) - span(t, 2.0, 2.3), shake);
        heat.emissiveIntensity = 1.6 * (span(t, 0.15, 0.4) - span(t, 0.9, 1.6));
        this.showLights(Math.floor(t * 6) % 2 ? 1 : 0);
        part.visible = t >= 1.15 && (t < 1.5 || t >= 1.75);
        if (t < 1.75) {
          // Studs first off the face, then falling, turning in the plane of the door.
          const fall = span(t, 1.25, 1.5);
          part.position.lerpVectors(cavity, off, ease(span(t, 1.15, 1.25)));
          part.position.y += (CHUTE_TOP - 0.07 - my) * fall * fall - half;
          turned.rotation.set(Math.PI / 2, fall * 1.4, 0);
        } else {
          // Out of the ceiling, landing flat with a little bounce, and at rest.
          const fall = span(t, 1.75, 1.95);
          const bounce = t < 2.15 ? Math.sin(span(t, 1.95, 2.15) * Math.PI) * 0.012 : 0;
          part.position.copy(rest);
          part.position.y += (1 - fall * fall) * (PRESS_BAY.top - half - rest.y) + bounce;
          turned.rotation.set(0.35 * (1 - fall), 0, 0.25 * (1 - fall));
        }
      },
      end: () => {
        heat.emissiveIntensity = 0;
        this.showLights();
        this.clamp(p, 0);
      },
    };
  }

  /** Slides the safety door aside along its rail by `open` (0 shut, 1 open). */
  private door(p: PressParts, open: number): void {
    p.door.position.x = DOOR_SLIDE * ease(clamp01(open));
  }

  /**
   * Draws the moving platen back by `open` (0 shut, 1 open), less any shudder. A part being
   * moulded while a mould goes in moves it for both: it is as far open as the most either
   * wants it this frame, so neither snaps it shut on the other.
   */
  private clamp(p: PressParts, open: number, shake = 0): void {
    this.clampOpen = Math.max(this.clampOpen, clamp01(open));
    p.clamp.position.x = -0.12 * ease(this.clampOpen) + shake;
  }

  // -- The pellet silo --

  /**
   * One round silo on braced legs toward the back of its box, every colour banded down its
   * sight strip; under it a pipe out to the tap at the front, where a bucket stands on a grate
   * to be filled, with the colour chart on one side and spare buckets on the other.
   */
  private silo(w: number, h: number, d: number): Omit<SiloParts, 'kind'> {
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
    // Legs braced together, holding a ring under the silo: in from its edge, so their tops
    // are under the ring.
    const l = (r - 0.05) / Math.SQRT2;
    // Each leg on a foot plate bolted down to the floor.
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        block(g, 0.07, body0 - 0.02, 0.07, sx * l, 0.02 + (body0 - 0.02) / 2, sz * l, frame);
        block(g, 0.17, 0.02, 0.17, sx * l, 0.01, sz * l, darkMetal);
        for (const k of [-1, 1])
          upright(g, 0.012, 0.012, 0.02, 0.032, sx * l + k * 0.06, sz * l + k * 0.06, steel, 6);
      }
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
    // A ladder up its side on feet of its own, held off the body by brackets up its height
    // and tied in to the legs' frame low down, and hooked over the top ring.
    const lx = Math.min(r + 0.07, hw - 0.03);
    for (const z of [-0.16, 0.16]) {
      block(g, 0.04, body1 - 0.07, 0.04, lx, 0.02 + (body1 - 0.07) / 2, z, frame);
      block(g, 0.08, 0.02, 0.08, lx, 0.01, z, darkMetal);
      // Brackets from the rail back to the shell (the rail stands 5 cm off it).
      const gap = lx - 0.02 - Math.sqrt(r * r - z * z);
      for (const y of [body0 + 0.25, body0 + 0.9, body1 - 0.2])
        block(g, gap + 0.01, 0.03, 0.03, lx - 0.02 - gap / 2, y, z, frame);
      // The tie to the legs' brace bar, out at `l`.
      block(g, lx - 0.02 - l, 0.03, 0.03, (lx - 0.02 + l) / 2, 0.45, z, frame);
    }
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
    // A bar across the valve wheel to turn it by: it turns while a bucket fills.
    const wheel = new THREE.Group();
    wheel.position.set(0, 1.022, zs);
    block(wheel, 0.13, 0.014, 0.018, 0, 0, 0, mat(0xd32f2f, 0.4));
    this.group.add(wheel);
    const spout = new THREE.Vector3(0, 0.81, zs);
    // A grate to stand a bucket on under it, on a post: the silo's output area (see
    // `outputSlots`).
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
    return { wheel, spout, stack: new THREE.Vector3(hw - 0.27, 0.122, hd - 0.16) };
  }

  /**
   * Fills a bucket: an empty one comes off the stack onto the grate, the valve turns and the
   * pellets pour in until it is full, and the valve turns off, leaving it full on the grate for
   * someone to take.
   */
  private fillJob(
    { wheel, spout, stack }: SiloParts,
    colour: ColourId,
    slot: number,
  ): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const pail = bucket(null);
    group.add(pail);
    const grate = this.restAt(slot);
    const fill = pelletFill(pail, colour);
    const stream = pelletStream(group, colour, spout, grate.y + 0.05);
    return {
      length: MAKE_SECONDS.bucket,
      slot,
      group,
      step: (t) => {
        const move = ease(span(t, 0, 0.35));
        pail.position.lerpVectors(stack, grate, move);
        pail.position.y += move < 1 ? Math.sin(move * Math.PI) * 0.25 : 0;
        fill(span(t, 0.45, 1.6));
        stream(t >= 0.4 && t < 1.6 ? t : null);
        wheel.rotation.y = ease(span(t, 0.3, 0.5)) * 1.6 - ease(span(t, 1.5, 1.7)) * 1.6;
      },
      end: () => {
        wheel.rotation.y = 0;
      },
    };
  }

  // -- The mould dispenser --

  /**
   * A steel cabinet like a vending machine: a window on the left showing shelves of moulds, and
   * on the right a column with a screen, a keypad and the hatch at hand height the chosen mould
   * comes out of. The sign over the window says what it is.
   */
  private dispenser(w: number, h: number, d: number): Omit<DispenserParts, 'kind'> {
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
    // Its pieces are cut from the one sheet: square-edged, meeting as one.
    block(g, xb - xa, gy0 - lo, skin, (xa + xb) / 2, (lo + gy0) / 2, fz, panel, 0);
    block(g, xb - xa, y1 - gy1, skin, (xa + xb) / 2, (gy1 + y1) / 2, fz, panel, 0);
    // The control column's sheet, round the hatch (see below), which is open.
    const [hy, hh, hwid] = [0.95, 0.22, 0.28];
    const cx = (xb + hw - side) / 2;
    const cw = hw - side - xb;
    const [hy0, hy1] = [hy - hh / 2, hy + hh / 2];
    // Under the hatch, only down to the steel lip along its bottom (below).
    const lip = hy0 - 0.025;
    block(g, cw, lip - lo, skin, cx, (lo + lip) / 2, fz, panel, 0);
    block(g, cw, y1 - hy1, skin, cx, (hy1 + y1) / 2, fz, panel, 0);
    for (const s of [-1, 1])
      block(
        g,
        (cw - hwid) / 2,
        hy1 - lip,
        skin,
        cx + (s * (cw + hwid)) / 4,
        (lip + hy1) / 2,
        fz,
        panel,
        0,
      );
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
    const md = MOULD_SIZE.z * k;
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
      // Each leant back on a stand, its cavity toward the window.
      for (let j = 0; j < 3; j++) {
        const x = xa + ((xb - xa) * (j + 0.5)) / 3;
        const mould = mouldBlock(SHOWN_MOULDS[i * 3 + j]!);
        mould.scale.setScalar(k);
        mould.rotation.x = SHELF_LEAN;
        mould.position.set(x, sy + (md / 2) * Math.sin(SHELF_LEAN), iz + 0.06);
        g.add(mould);
        const rise = md * Math.sin(SHELF_LEAN);
        const backZ = iz + 0.06 - (md / 2) * Math.cos(SHELF_LEAN);
        block(g, MOULD_SIZE.x * k * 0.6, rise, 0.04, x, sy + rise / 2, backZ - 0.02, panelGrey);
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
    // of at hand height, with a smoked flap and a tray, and a lamp over it; vents at its foot.
    // The screen lights up while it dispenses a mould, and glows brighter while one waits in
    // the hatch: a material of this machine's own.
    block(g, 0.3, 0.22, 0.01, cx, gy1 - 0.2, front + 0.005, panelGrey);
    const lcd = new THREE.MeshStandardMaterial({
      color: 0x4fc3f7,
      roughness: 0.3,
      emissive: 0x1e6fb5,
    });
    block(g, 0.25, 0.16, 0.006, cx, gy1 - 0.2, front + 0.013, lcd);
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
    // The hatch: a dark box set into the column, deep enough for a mould to drop into.
    const deep = 0.26;
    const back0 = front - deep;
    block(g, hwid, hh, 0.01, cx, hy, back0 + 0.005, darkMetal);
    block(g, hwid, 0.01, deep - skin, cx, hy0 + 0.005, (back0 + front - skin) / 2, darkMetal);
    block(g, hwid, 0.01, deep - skin, cx, hy1 - 0.005, (back0 + front - skin) / 2, darkMetal);
    for (const s of [-1, 1])
      block(
        g,
        0.01,
        hh,
        deep - skin,
        cx + s * (hwid / 2 - 0.005),
        hy,
        (back0 + front - skin) / 2,
        darkMetal,
      );
    block(g, hwid + 0.04, 0.03, 0.035, cx, hy + hh / 2 + 0.015, front + 0.0175, steel);
    for (const s of [-1, 1])
      block(g, 0.02, hh, 0.035, cx + s * (hwid / 2 + 0.01), hy, front + 0.0175, steel);
    block(g, hwid + 0.04, 0.025, 0.065, cx, hy - hh / 2 - 0.0125, front + 0.0025, steel);
    block(g, hwid + 0.04, 0.04, 0.01, cx, hy - hh / 2 + 0.005, front + 0.03, steel);
    // The flap hangs from its top edge, a little open at the bottom, and swings up as a mould
    // is taken out (see `flapJob`).
    const flapHinge = new THREE.Group();
    flapHinge.position.set(cx, hy1 - 0.01, front - 0.004);
    flapHinge.rotation.x = FLAP_REST;
    g.add(flapHinge);
    const flap = block(flapHinge, hwid - 0.01, hh - 0.04, 0.006, 0, -(hh - 0.04) / 2, 0, smoked);
    flap.castShadow = false;
    // The lamp, between the hatch's trim and the keypad, lit while a mould waits in the hatch.
    const ly = (hy1 + 0.03 + gy1 - 0.5 - 0.016) / 2;
    const hatchLamp = rodZ(g, 0.016, front, front + 0.012, cx, ly, lamp(HATCH_LAMP, false));
    hatchLamp.castShadow = false;
    for (let i = 0; i < 4; i++)
      block(g, 0.24, 0.015, 0.004, cx, 0.22 + i * 0.04, front + 0.002, darkMetal);
    chalkSign(g, 0.9, 0.18, 0, (gy1 + y1) / 2 + 0.01, front, 'Moulds');
    return { flap: flapHinge, screen: lcd, hatchLamp };
  }

  /**
   * Dispenses a mould: the screen lights up and flickers while it finds the one asked for, and
   * the mould drops into the hatch and the lamp over it lights, for someone to take it.
   */
  private dispenseJob(
    { screen: lcd, hatchLamp }: DispenserParts,
    type: BrickTypeId,
    slot: number,
  ): Omit<Job, 'start'> {
    const group = this.jobGroup();
    const mould = madeModel({ kind: 'mould', type });
    group.add(mould);
    const hatch = this.restAt(slot);
    // From the cabinet over the hatch, out of sight until it drops through the hatch's top.
    const top = hatch.clone().add(new THREE.Vector3(0, 0.3, 0));
    return {
      length: MAKE_SECONDS.mould,
      slot,
      group,
      step: (t) => {
        const flicker = t > 0.15 && t < 1.05 ? 0.3 * Math.sin(t * 40) : 0;
        lcd.emissiveIntensity =
          1 + 1.5 * span(t, 0, 0.15) - (2.5 - WAITING_GLOW) * span(t, 1.05, 1.3) + flicker;
        const drop = span(t, 1.0, 1.3);
        mould.position.lerpVectors(top, hatch, drop * drop);
        // A little bounce as it lands.
        mould.position.y +=
          t < 1.5 ? Math.max(0, Math.sin(span(t, 1.3, 1.5) * Math.PI)) * 0.025 : 0;
        hatchLamp.material = lamp(HATCH_LAMP, t >= 1.3);
      },
      end: () => {
        lcd.emissiveIntensity = WAITING_GLOW;
        hatchLamp.material = lamp(HATCH_LAMP, true);
      },
    };
  }

  /** The hatch's flap swinging up as a mould is taken out of it, and falling back. */
  private flapJob({ flap }: DispenserParts): Omit<Job, 'start'> {
    return {
      length: 0.6,
      group: this.jobGroup(),
      step: (t) => {
        flap.rotation.x = FLAP_REST - 1.3 * (ease(span(t, 0, 0.15)) - ease(span(t, 0.25, 0.6)));
      },
      end: () => {
        flap.rotation.x = FLAP_REST;
      },
    };
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
    // The cabinet, a stripe and the bed on top, ruled with a grid. The cabinet's edges are
    // rounded only a little, for the stripe along the top of its front (over the sign), which
    // stops where they turn away.
    const round = 0.015;
    block(g, w - 0.1, 0.33, d - 0.04, 0, 0.615, 0, white, round);
    block(g, w - 0.1 - 2 * round, 0.03, 0.006, 0, 0.75, hd - 0.017, panelGrey);
    block(g, w - 0.7, 0.02, d - 0.1, 0, bed.top - 0.01, 0, mat(0x26292c, 0.8));
    // The towers at the ends, the gantry over the back of the bed and the print head parked
    // on it, its UV lamp glowing underneath.
    for (const s of [-1, 1]) block(g, 0.24, 0.2, d - 0.06, s * (hw - 0.17), 0.88, 0, white);
    const gz = -0.12;
    block(g, w - 0.5, 0.07, 0.08, 0, 0.975, gz, panelGrey);
    block(g, 0.02, 0.08, 0.09, -(hw - 0.32), 0.975, gz, darkMetal);
    const [head, hz] = [hw - 0.43, gz + 0.095];
    block(g, 0.2, 0.12, 0.13, head, 0.97, hz, white);
    block(g, 0.2 - 2 * bevelFor(0.12), 0.02, 0.006, head, 0.99, hz + 0.068, mat(0x7a52d1, 0.5));
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
    if (m.part) this.dynamic.add(bedPart(m.part, svgs, this.printerBed()));
  }
}

/**
 * A part as it lies on a printer's bed, its pictures on it: at its own size if it fits in the
 * room there (`w` across, `d` deep, `room` high), smaller if not, its foot's middle on the bed's
 * top at (`x`, `top`, `z`).
 */
export function bedPart(
  p: MachinePart,
  svgs: Record<string, string>,
  bed: { top: number; x: number; z: number; w: number; d: number; room: number },
): THREE.Mesh {
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
  return part;
}

/** How far the dispenser's hatch flap hangs open at rest. */
const FLAP_REST = -0.12;
/** How brightly the dispenser's screen glows while a mould waits in its hatch (1 otherwise). */
const WAITING_GLOW = 2;
/** The colour of the lamp over the dispenser's hatch. */
const HATCH_LAMP = 0xf2a530;

/** The moulding machine's moving parts: the ram and moving platen, the door, the heater bands. */
interface PressParts {
  kind: 'press';
  clamp: THREE.Object3D;
  door: THREE.Object3D;
  heat: THREE.MeshStandardMaterial;
  /** The mould clamped in it, if one is. */
  mould: THREE.Object3D | null;
}

/** The silo's: the valve's handle, the spout's tip and the stack of buckets. */
interface SiloParts {
  kind: 'silo';
  wheel: THREE.Object3D;
  spout: THREE.Vector3;
  stack: THREE.Vector3;
}

/** The dispenser's: the hatch's flap, the screen and the lamp over the hatch. */
interface DispenserParts {
  kind: 'dispenser';
  flap: THREE.Object3D;
  screen: THREE.MeshStandardMaterial;
  hatchLamp: THREE.Mesh;
}

/** What moves on a machine, by the kind of machine (the printer shows its work otherwise). */
type MovingParts = PressParts | SiloParts | DispenserParts | { kind: 'printer' };

/** Something a machine is showing itself do, from `start` (seconds) for `length`. */
export interface Job {
  start: number;
  length: number;
  /** The place in the output area it brings what it makes to, if it makes something. */
  slot?: number;
  /**
   * What it is busy with, if not making something (`make`, a job with a `slot`) or loading the
   * machine (`load`, one without): jobs go on side by side but for two in the same lane, where
   * the later cuts the earlier short.
   */
  lane?: string;
  /** What is drawn for it alone, gone when it ends. */
  group: THREE.Group;
  /** Poses everything `t` seconds in. */
  step(t: number): void;
  /** Puts the machine back as it was, bar what it made, left at rest where it brought it. */
  end(): void;
}

/** How far `t` is from `a` to `b`, from 0 to 1. */
export function span(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a));
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Eased in and out. */
export function ease(x: number): number {
  return x * x * (3 - 2 * x);
}

const BEAD = 0.012;
const beadGeo = () => cached('bead', () => new THREE.SphereGeometry(BEAD, 6, 4));

/**
 * Pellets of `colour` falling from `from` down to `bottom`, in `group`. The function it gives
 * back poses them `t` seconds in, or hides them for `null`.
 */
export function pelletStream(
  group: THREE.Object3D,
  colour: ColourId,
  from: THREE.Vector3,
  bottom: number,
): (t: number | null) => void {
  const plastic = brickMaterial(colour);
  const rand = rng(11);
  const beads = Array.from({ length: 18 }, () => {
    const m = new THREE.Mesh(beadGeo(), plastic);
    m.userData.dx = (rand() - 0.5) * 0.03;
    m.userData.dz = (rand() - 0.5) * 0.03;
    m.userData.phase = rand();
    group.add(m);
    return m;
  });
  const drop = from.y - bottom;
  return (t) => {
    for (const b of beads) {
      b.visible = t !== null;
      if (t === null) continue;
      const f = (t * 2.2 + (b.userData.phase as number)) % 1;
      b.position.set(
        from.x + (b.userData.dx as number) * f,
        from.y - f * f * drop,
        from.z + (b.userData.dz as number) * f,
      );
    }
  };
}

/**
 * Pellets of `colour` in an empty bucket, filled to `level` (0 to 1) by the function given
 * back. Full, it looks just as a bucket made full (see `bucket`).
 */
export function pelletFill(pail: THREE.Object3D, colour: ColourId): (level: number) => void {
  const r = BUCKET.bottom - 0.004;
  const column = upright(pail, r, r, 0, 1, 0, 0, brickMaterial(colour), 20);
  // The top of them as a full bucket's, as wide as the bucket is at the level they are up to.
  const top = pelletTop(pail, pelletsWide(BUCKET_FULL), BUCKET_FULL, colour);
  return (level) => {
    const y = 0.01 + level * (BUCKET_FULL - 0.01);
    // (Full, the column is out of sight under the top.)
    column.visible = level > 0 && level < 1;
    top.visible = level > 0;
    column.scale.y = y - 0.01;
    column.position.y = (y - 0.01) / 2;
    top.position.y = y;
    top.scale.x = top.scale.z = pelletsWide(y) / pelletsWide(BUCKET_FULL);
  };
}

/** A part in `colour`, at most `size` across, centred on its origin. */
function partModel(type: BrickTypeId, colour: ColourId, size: number): THREE.Group {
  const geo = brickGeometry(type);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const dims = bb.getSize(new THREE.Vector3());
  const part = new THREE.Mesh(geo, brickMaterial(colour));
  part.position.copy(bb.getCenter(new THREE.Vector3()).negate());
  part.castShadow = true;
  addDecorations(part, type);
  const inner = new THREE.Group();
  inner.add(part);
  inner.scale.setScalar(1 / Math.max(dims.x, dims.y, dims.z));
  const g = new THREE.Group();
  g.add(inner);
  g.scale.setScalar(size);
  return g;
}

/** How big (at most, across) a part is drawn in a moulding machine's bay. */
const BAY_PART = 0.13;
/** How big a mould is drawn in the dispenser's hatch, to its size on the shelves. */
export const HATCH_MOULD = 0.5;

/**
 * A part in `colour` as it lies in a moulding machine's bay, `BAY_PART` across at most, the
 * right way up, its origin the middle of its bottom. Its one child is the part about its own
 * middle, to turn it by.
 */
export function lyingPart(type: BrickTypeId, colour: ColourId): THREE.Group {
  const geo = brickGeometry(type);
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const part = partModel(type, colour, BAY_PART);
  part.position.y = (BAY_PART * size.y) / Math.max(size.x, size.y, size.z) / 2;
  const g = new THREE.Group();
  g.add(part);
  return g;
}

/** What a machine made as it lies in its output area, its origin the middle of its bottom. */
export function madeModel(made: Made): THREE.Object3D {
  if (made.kind === 'bucket') return bucket(made.colour);
  if (made.kind === 'part') return lyingPart(made.type, made.colour);
  const mould = mouldBlock(made.type);
  mould.scale.setScalar(HATCH_MOULD);
  return mould;
}

/** A mesh with a geometry of its own (thrown away when it is rebuilt), at height `y`. */
export function ownMesh(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  y: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  m.userData.own = true;
  return m;
}
