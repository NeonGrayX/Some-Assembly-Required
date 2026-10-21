import { BRICK_TYPES, footprint } from './bricks.ts';
import type { BrickTypeId, ColourId, Facing, Rotation } from './bricks.ts';
import type { Prints } from './builds/types.ts';
import {
  LDU_PER_PLATE,
  LDU_PER_STUD,
  ORIENTATIONS,
  STUD_REACH,
  clutches,
  meets,
  oppositeAxis,
  placedShape,
  studBox,
} from './lattice.ts';
import type { Axis, LatticeBox, LatticeStud, PartShape, Receiver } from './lattice.ts';
import { acrossShape, oppositeDir, turnedMeet } from './across.ts';
import type { AcrossShape, PlacedPoint } from './across.ts';
import type { Frame, SurdVec } from './frames.ts';
import {
  composeFrames,
  frameKey,
  framePointOf,
  invertFrame,
  latticeFrame,
  latticeMove,
  movePlacement,
  rational,
  surdValue,
} from './frames.ts';
import type { Vec3 } from './math.ts';
import {
  emptyColumns,
  hasCentreHollow,
  partBox,
  placedCentre,
  sidewaysOut,
  topStudCells,
} from './parts.ts';

/**
 * Where a brick sits in an assembly's grid. (x, y, z) is the minimum corner cell. A `face`
 * means it is clipped sideways onto side studs, its top pointing that way (see parts.ts).
 */
export interface Placement {
  type: BrickTypeId;
  x: number;
  y: number;
  z: number;
  rot: Rotation;
  face?: Facing;
  /** Turned a way `rot` and `face` cannot say (see `PartPlacement.orient` in parts.ts). */
  orient?: string;
  /** Turned 45° off the grid, or built onto a part that is (see `PartPlacement.frame`). */
  frame?: Frame;
}

export interface PlacedBrick extends Placement {
  id: number;
  colour: ColourId;
  /** A printed part's pictures, by side (from the specialty shelf). */
  prints?: Prints;
}

/** Two bricks clutched together: `upper` sits on top of `lower`, sharing `studs` studs. */
export interface Connection {
  lower: number;
  upper: number;
  studs: number;
}

export type AddResult = { ok: true } | { ok: false; reason: 'overlap' | 'floating' };

/**
 * Key of a slot: column (x, z) and half plate `h` (layer y is halves 2y and 2y + 1), each a
 * whole number well inside ±65536, packed into one number (exactly: under 2^53). Looked up for
 * every slot of every part tried, many times a tick, so not a string. A point of the lattice
 * packs the same way.
 */
const SLOT = 131072;

const slotKey = (x: number, h: number, z: number) =>
  ((x + SLOT / 2) * SLOT + (h + SLOT / 2)) * SLOT + (z + SLOT / 2);

const pointKey = (v: Vec3) => slotKey(v.x, v.y, v.z);

/** A slot on the lattice: a stud across, half a plate up. */
const SLOT_ACROSS = LDU_PER_STUD;
const SLOT_UP = LDU_PER_PLATE / 2;

/** Keys of the slots a box reaches into, grown by `pad` slots every way. */
function slotKeysIn(b: LatticeBox, pad = 0): number[] {
  const out: number[] = [];
  const x1 = Math.ceil(b.max.x / SLOT_ACROSS) + pad;
  const h1 = Math.ceil(b.max.y / SLOT_UP) + pad;
  const z1 = Math.ceil(b.max.z / SLOT_ACROSS) + pad;
  for (let x = Math.floor(b.min.x / SLOT_ACROSS) - pad; x < x1; x++)
    for (let h = Math.floor(b.min.y / SLOT_UP) - pad; h < h1; h++)
      for (let z = Math.floor(b.min.z / SLOT_ACROSS) - pad; z < z1; z++) out.push(slotKey(x, h, z));
  return out;
}

/** Grid cells (x, z columns and y layers) covered by a placement. */
export function* cellsOf(p: Placement): Generator<[number, number, number]> {
  const b = partBox(p);
  const empty = emptyColumns(p);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++)
      for (let z = b.z0; z < b.z1; z++) if (!empty.size || !empty.has(`${x},${z}`)) yield [x, y, z];
}

/**
 * Half-plate slots a placement fills, as (x, half, z): every slot one of its body's boxes
 * reaches into (see lattice.ts). A sideways part sits where side studs put it, a stud (2.5
 * plates) at a time, so its ends can fall half way through a layer: two tiles clipped one over
 * the other onto a five-plate brick with two rows of side studs share its middle layer, half
 * each. Parts can share a slot; they overlap only where their boxes do.
 */
export function slotsOf(p: Placement): number[] {
  return slotsOfBoxes(kept(p, placedShape(p)).boxes);
}

function slotsOfBoxes(boxes: LatticeBox[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const { min, max } of boxes)
    for (let x = Math.floor(min.x / SLOT_ACROSS); x < Math.ceil(max.x / SLOT_ACROSS); x++)
      for (let h = Math.floor(min.y / SLOT_UP); h < Math.ceil(max.y / SLOT_UP); h++)
        for (let z = Math.floor(min.z / SLOT_ACROSS); z < Math.ceil(max.z / SLOT_ACROSS); z++) {
          const k = slotKey(x, h, z);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(x, h, z);
        }
  return out;
}

/** Keys of the slots any of the boxes reach into, each once. */
function slotKeysOf(boxes: LatticeBox[]): number[] {
  if (boxes.length === 1) return slotKeysIn(boxes[0]!);
  return [...new Set(boxes.flatMap((b) => slotKeysIn(b)))];
}

/** Brick centre in the assembly's local frame, in metres. */
export function localCentre(p: Placement): { x: number; y: number; z: number } {
  return placedCentre(p);
}

const component = (a: Axis) => a[1] as 'x' | 'y' | 'z';

/**
 * The shape a part keeps others out of. A part set back into a headlight brick's recess
 * reaches half a plate into the cell behind it. It checks that room as it goes in (only a
 * recessed side leaves it), but parts that come after it do not, as has always been so: shipped
 * builds have signs clipped into a headlight brick's recess that reach up past it, in front of
 * the parts over it.
 */
function kept(p: Placement, shape: PartShape): PartShape {
  if (!p.face || sidewaysOut(p) >= 0) return shape;
  const k = p.face[1] as 'x' | 'z';
  const lo = Math.round(p[k]) * LDU_PER_STUD;
  const hi = lo + LDU_PER_STUD;
  return {
    ...shape,
    boxes: shape.boxes.map((b) => ({
      min: { ...b.min, [k]: Math.max(b.min[k], lo) },
      max: { ...b.max, [k]: Math.min(b.max[k], hi) },
    })),
  };
}

/**
 * Whether the stud `s` and the part `q` run into each other: the stud stands in its body where
 * it does not make room for it. A sideways part's edge may rest on studs pointing up, as it
 * always has.
 */
function runsInto(s: LatticeStud, q: Placement, shape: PartShape): boolean {
  if (s.dir === '+y' && q.face) return false;
  const room = studBox(s);
  return shape.boxes.some((b) => meets(b, room)) && !makesRoom(q, shape, s);
}

/**
 * Whether a stud may stand inside the part's body where it does: where the part takes a stud
 * (whether or not it grips it there), or anywhere under the bottom of a part with one centre
 * hollow, open all the way across (a cone, a dish, a 2x2 round tile). Anywhere else, the stud
 * and the part run into each other.
 */
function makesRoom(p: Placement, shape: PartShape, s: LatticeStud): boolean {
  const k = pointKey(s.at);
  // A dish's rim comes down over the studs round its centre: only that one has room.
  const rim = BRICK_TYPES[p.type].rim;
  for (const r of shape.receivers)
    if ((!rim || r.kind !== 'around') && pointKey(r.at) === k && meetsStud(r, s)) return true;
  if (!hasCentreHollow(p.type) || rim) return false;
  // Its bottom: where its receivers are, facing the stud.
  const r = shape.receivers[0]!;
  const c = component(r.dir);
  return meetsStud(r, s) && s.at[c] === r.at[c];
}

/** Whether the receiver faces the stud. */
const meetsStud = (r: Receiver, s: LatticeStud) => r.dir[1] === s.dir[1] && r.dir[0] !== s.dir[0];

/** A part not in the grid (yet) that counts as being there, with its shape. */
interface Extra {
  id: number;
  p: Placement;
  shape: PartShape;
}

/** What is where on one lattice: the grid's own, or a frame's (see frames.ts). */
interface Lattice {
  /** The parts whose boxes reach into each slot. */
  occupancy: Map<number, number[]>;
  /** The studs that count, by the point they stand on. */
  studsAt: Map<number, { id: number; s: LatticeStud }[]>;
  /** The parts with a receiver at each point. */
  receiversAt: Map<number, number[]>;
}

const newLattice = (): Lattice => ({
  occupancy: new Map(),
  studsAt: new Map(),
  receiversAt: new Map(),
});

/** A part on a lattice of its own as the grid sees it, kept to meet parts on other lattices. */
interface Turned {
  frame: string;
  across: AcrossShape;
  /** The grid's slots its bounds reach into. */
  slots: number[];
}

/** Whether `p` and `q`, on the same lattice, run into each other: boxes, or a stud in the other. */
function clash(p: Placement, ps: PartShape, q: Placement, qs: PartShape): boolean {
  for (const a of ps.boxes) for (const b of qs.boxes) if (meets(a, b)) return true;
  for (const s of ps.studs) if (runsInto(s, q, qs)) return true;
  for (const s of qs.studs) if (runsInto(s, p, ps)) return true;
  return false;
}

/**
 * Whether the stud `s` (as the grid sees it) may stand in the part `q` on another lattice where
 * it does: exactly where `q` takes a stud facing it, or under the bottom of a part with one
 * centre hollow, as `makesRoom` has it on one lattice.
 */
function roomAcross(
  q: Placement,
  qs: PartShape,
  qa: AcrossShape,
  s: PlacedPoint<LatticeStud>,
): boolean {
  const rim = BRICK_TYPES[q.type].rim;
  const facing = oppositeDir(frameDirOf(s));
  for (const r of qa.receivers)
    if ((!rim || r.of.kind !== 'around') && r.key === s.key && r.dir === facing) return true;
  if (!hasCentreHollow(q.type) || rim) return false;
  // Its bottom, in its own frame.
  const r = qa.receivers[0]!;
  if (r.dir !== facing) return false;
  const inQ = q.frame ? framePointOf(invertFrame(q.frame), s.at) : s.at;
  const c = component(qs.receivers[0]!.dir);
  const i = c === 'x' ? 0 : c === 'y' ? 1 : 2;
  return inQ[i][1] === 0 && inQ[i][0] === qs.receivers[0]!.at[c];
}

/** A placed point's direction, back as exact numbers. */
function frameDirOf(s: PlacedPoint<unknown>): SurdVec {
  const n = s.dir.split(',').map(Number);
  return [
    [n[0]!, n[1]!],
    [n[2]!, n[3]!],
    [n[4]!, n[5]!],
  ];
}

/**
 * Whether `p` and `q`, on lattices turned against each other, run into each other: their
 * boxes share room, or a stud of one stands in the other where it does not make room for it.
 */
function clashAcross(
  p: Placement,
  ps: PartShape,
  pa: AcrossShape,
  q: Placement,
  qs: PartShape,
  qa: AcrossShape,
): boolean {
  for (const a of pa.boxes) for (const b of qa.boxes) if (turnedMeet(a, b)) return true;
  const into = (xa: AcrossShape, y: Placement, ys: PartShape, ya: AcrossShape): boolean =>
    xa.studs.some(
      (s, i) => ya.boxes.some((b) => turnedMeet(xa.studBoxes[i]!, b)) && !roomAcross(y, ys, ya, s),
    );
  return into(pa, q, qs, qa) || into(qa, p, ps, pa);
}

/**
 * The logical structure of one assembly: which bricks sit where, and which are clutched
 * together. Pure data, no physics, so the same code runs on client, server and in tests.
 *
 * Every part is its studs, receivers and boxes on the lattice (see lattice.ts). Two parts
 * overlap where their boxes share room, or where one's stud stands in the other's body
 * anywhere it does not make room for it. They clutch where a stud and a receiver meet.
 *
 * A part turned 45° about a stud, and what is built onto it, is on a lattice of its own (its
 * `frame`, see frames.ts). On each lattice all is as above; across lattices, studs and
 * receivers meet exactly where they line up, and boxes are tried turned against each other.
 */
export class BrickGrid {
  readonly bricks = new Map<number, PlacedBrick>();
  /** Each part's studs, receivers and boxes on its lattice, by id. */
  private readonly shapes = new Map<number, PartShape>();
  /** What is where on each lattice, by frame (see `frameKey`): the grid's own is ''. */
  private readonly lattices = new Map<string, Lattice>([['', newLattice()]]);
  /** The parts on a lattice of their own, by id. */
  private readonly turned = new Map<number, Turned>();
  /** Those parts by the grid's slots their bounds reach into. */
  private readonly turnedAt = new Map<number, number[]>();
  /** Their studs by the exact point they stand on in the grid. */
  private readonly turnedStuds = new Map<string, { id: number; s: PlacedPoint<LatticeStud> }[]>();
  /** Their receivers by the exact point they are at in the grid. */
  private readonly turnedReceivers = new Map<string, number[]>();
  /** Goes up whenever a part is inserted or removed, so work done on the grid can be cached. */
  version = 0;

  static from(bricks: Iterable<PlacedBrick>): BrickGrid {
    const g = new BrickGrid();
    for (const b of bricks) g.insert(b);
    return g;
  }

  get size(): number {
    return this.bricks.size;
  }

  private get root(): Lattice {
    return this.lattices.get('')!;
  }

  /** A part in cell (x, y, z) of the grid's own lattice, in either half of that layer. */
  brickAt(x: number, y: number, z: number): number | undefined {
    // Only whole columns hold anything (and a key is made of whole numbers only).
    if (!Number.isInteger(x) || !Number.isInteger(z)) return undefined;
    const h = 2 * Math.floor(y);
    const at = this.root.occupancy;
    return at.get(slotKey(x, h, z))?.[0] ?? at.get(slotKey(x, h + 1, z))?.[0];
  }

  /** The studs, receivers and boxes of the part `id` in the grid, if it is there. */
  shapeOfBrick(id: number): PartShape | undefined {
    return this.shapes.get(id);
  }

  /** The part's shape: kept for a part in the grid, worked out for any other placement. */
  private shapeOf(p: Placement): PartShape {
    const id = 'id' in p ? (p as PlacedBrick).id : -1;
    return (this.bricks.get(id) === p && this.shapes.get(id)) || placedShape(p);
  }

  /** The part's shape as the grid sees it: kept for a part in the grid on a lattice of its own. */
  private acrossOf(p: Placement, shape: PartShape): AcrossShape {
    const id = 'id' in p ? (p as PlacedBrick).id : -1;
    return (
      (this.bricks.get(id) === p && this.turned.get(id)?.across) || acrossShape(shape, p.frame)
    );
  }

  /** Ids of the parts on lattice `l` whose boxes reach into the slots `b` reaches into, grown by `pad`. */
  private near(l: Lattice, b: LatticeBox, pad: number, out = new Set<number>()): Set<number> {
    for (const k of slotKeysIn(b, pad)) {
      const ids = l.occupancy.get(k);
      if (ids) for (const id of ids) out.add(id);
    }
    return out;
  }

  /**
   * Parts on other lattices than `p`'s that could meet it: those whose bounds share slots of
   * the grid with its bounds. None, and nothing worked out, while every part is on the grid.
   */
  private acrossNear(p: Placement, a: AcrossShape | null): Set<number> {
    const out = new Set<number>();
    if (!a) return out;
    const mine = frameKey(p.frame);
    for (const k of slotKeysIn(a.bounds)) {
      for (const id of this.turnedAt.get(k) ?? [])
        if (this.turned.get(id)!.frame !== mine) out.add(id);
      if (mine) for (const id of this.root.occupancy.get(k) ?? []) out.add(id);
    }
    return out;
  }

  /** Whether `p` needs trying against other lattices: it is on one, or some part is. */
  private across(p: Placement, shape: PartShape): boolean {
    if (p.frame) return true;
    if (!this.turned.size) return false;
    // On the grid's lattice: only near enough a part on another to meet it.
    for (const b of shape.boxes)
      for (const k of slotKeysIn(b, 1)) if (this.turnedAt.has(k)) return true;
    return false;
  }

  /**
   * Whether `p` would run into a part in the grid: their boxes share room, or a stud of one
   * stands in the other where that does not make room for it. That covers a sideways part set
   * back into a headlight brick's recess (only a recessed side leaves it room), a side stud
   * under a sideways part that it does not line up with (side-stud bricks stacked straight on
   * each other), and a bracket's flange, which hangs in front of its plate's side: anything in
   * front of the plate down to a stud below its top, and any side stud under it that sticks out,
   * runs into it. Parts on other lattices are tried turned against it.
   */
  overlaps(p: Placement): boolean {
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    const shape = this.shapeOf(p);
    const l = this.lattices.get(frameKey(p.frame));
    if (l) {
      for (const b of shape.boxes)
        for (const k of slotKeysIn(b)) {
          const ids = l.occupancy.get(k);
          if (ids)
            for (const id of ids)
              if (this.shapes.get(id)!.boxes.some((o) => meets(o, b))) return true;
        }
      // Its studs in other parts.
      for (const s of shape.studs)
        for (const id of this.near(l, studBox(s), 0))
          if (id !== self && runsInto(s, this.bricks.get(id)!, this.shapes.get(id)!)) return true;
      // Other parts' studs in it: a stud stands out of its part at most a slot.
      const around = new Set<number>();
      for (const b of shape.boxes) this.near(l, b, 1, around);
      for (const id of around) {
        if (id === self) continue;
        for (const s of this.shapes.get(id)!.studs) if (runsInto(s, p, shape)) return true;
      }
    }
    if (!this.across(p, shape)) return false;
    const a = this.acrossOf(p, shape);
    for (const id of this.acrossNear(p, a)) {
      if (id === self) continue;
      const q = this.bricks.get(id)!;
      if (this.meetAcross(p, shape, a, q, this.shapes.get(id)!)) return true;
    }
    return false;
  }

  /** Whether `p` and `q`, on different lattices, run into each other. */
  private meetAcross(
    p: Placement,
    ps: PartShape,
    pa: AcrossShape,
    q: Placement,
    qs: PartShape,
  ): boolean {
    // Lattices that line up after all (a frame said another way): put `p` on `q`'s.
    const rel = composeFrames(q.frame ? invertFrame(q.frame) : ROOT_FRAME, p.frame ?? ROOT_FRAME);
    const move = latticeMove(rel);
    if (move) {
      const moved = movePlacement(p, move.o, move.d);
      return clash(moved, placedShape(moved), q, qs);
    }
    return clashAcross(p, ps, pa, q, qs, this.acrossOf(q, qs));
  }

  /** Whether `p` could be added: no overlap, and clutched to at least one brick. */
  check(p: Placement): AddResult {
    if (this.overlaps(p)) return { ok: false, reason: 'overlap' };
    if (this.bricks.size > 0 && this.neighbours(p).length === 0) {
      return { ok: false, reason: 'floating' };
    }
    return { ok: true };
  }

  add(brick: PlacedBrick): AddResult {
    const r = this.check(brick);
    if (r.ok) this.insert(brick);
    return r;
  }

  /** Inserts without checks. Used when copying bricks between grids. */
  insert(brick: PlacedBrick): void {
    if (this.bricks.has(brick.id)) throw new Error(`duplicate brick id ${brick.id}`);
    this.bricks.set(brick.id, brick);
    const shape = kept(brick, placedShape(brick));
    this.shapes.set(brick.id, shape);
    this.version++;
    const key = frameKey(brick.frame);
    let l = this.lattices.get(key);
    if (!l) this.lattices.set(key, (l = newLattice()));
    for (const k of slotKeysOf(shape.boxes)) push(l.occupancy, k, brick.id);
    for (const s of shape.studs) push(l.studsAt, pointKey(s.at), { id: brick.id, s });
    for (const r of shape.receivers) {
      const k = pointKey(r.at);
      const at = l.receiversAt.get(k);
      if (!at) l.receiversAt.set(k, [brick.id]);
      else if (!at.includes(brick.id)) at.push(brick.id);
    }
    if (!brick.frame) return;
    const across = acrossShape(shape, brick.frame);
    const slots = slotKeysIn(across.bounds);
    this.turned.set(brick.id, { frame: key, across, slots });
    for (const k of slots) push(this.turnedAt, k, brick.id);
    for (const s of across.studs) push(this.turnedStuds, s.key, { id: brick.id, s });
    for (const r of across.receivers) {
      const at = this.turnedReceivers.get(r.key);
      if (!at) this.turnedReceivers.set(r.key, [brick.id]);
      else if (!at.includes(brick.id)) at.push(brick.id);
    }
  }

  remove(id: number): PlacedBrick | undefined {
    const b = this.bricks.get(id);
    if (!b) return undefined;
    const shape = this.shapes.get(id)!;
    const drop = <K, T>(map: Map<K, T[]>, k: K, keep: (t: T) => boolean) => {
      const left = map.get(k)?.filter(keep);
      if (left?.length) map.set(k, left);
      else map.delete(k);
    };
    const key = frameKey(b.frame);
    const l = this.lattices.get(key)!;
    for (const k of slotKeysOf(shape.boxes)) drop(l.occupancy, k, (o) => o !== id);
    for (const s of shape.studs) drop(l.studsAt, pointKey(s.at), (o) => o.id !== id);
    for (const r of shape.receivers) drop(l.receiversAt, pointKey(r.at), (o) => o !== id);
    if (key && !l.occupancy.size && !l.studsAt.size && !l.receiversAt.size)
      this.lattices.delete(key);
    const t = this.turned.get(id);
    if (t) {
      for (const k of t.slots) drop(this.turnedAt, k, (o) => o !== id);
      for (const s of t.across.studs) drop(this.turnedStuds, s.key, (o) => o.id !== id);
      for (const r of t.across.receivers) drop(this.turnedReceivers, r.key, (o) => o !== id);
      this.turned.delete(id);
    }
    this.bricks.delete(id);
    this.shapes.delete(id);
    this.version++;
    return b;
  }

  /**
   * Bricks clutched to `p`: the parts whose studs go into its receivers, and the parts its
   * studs go into, where a stud and a receiver meet on the lattice. The lower side of a
   * connection is the part whose studs it is: the part underneath, or the one whose side studs
   * hold the other. `p` must not overlap the grid. For a placement that is not in the grid
   * yet, its side of each connection is -1.
   */
  neighbours(p: Placement): Connection[] {
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    const shape = this.shapeOf(p);
    const extra = this.bricks.get(self) === p ? undefined : { id: self, p, shape };
    const counts = new Map<string, Connection>();
    const add = (lower: number, upper: number, studs: number) => {
      const key = `${lower}:${upper}`;
      const c = counts.get(key);
      if (c) c.studs += studs;
      else counts.set(key, { lower, upper, studs });
    };
    // The studs it takes.
    const byId = (a: [number, number], b: [number, number]) => a[0] - b[0];
    for (const [id, studs] of [...this.grips(p, self, shape)].sort(byId)) add(id, self, studs);
    // What takes its studs.
    if (shape.studs.length) {
      const takers = new Set<number>();
      const l = this.lattices.get(frameKey(p.frame));
      if (l)
        for (const s of shape.studs)
          for (const id of l.receiversAt.get(pointKey(s.at)) ?? []) takers.add(id);
      if (this.across(p, shape)) for (const id of this.takersAcross(p, shape)) takers.add(id);
      for (const id of [...takers].sort((a, b) => a - b)) {
        if (id === self) continue;
        const qs = this.shapes.get(id)!;
        const studs = this.grips(this.bricks.get(id)!, id, qs, extra).get(self);
        if (studs) add(self, id, studs);
      }
    }
    return [...counts.values()];
  }

  /** Parts on other lattices with a receiver where one of `p`'s studs is, exactly. */
  private takersAcross(p: Placement, shape: PartShape): Set<number> {
    const out = new Set<number>();
    const mine = frameKey(p.frame);
    const a = this.acrossOf(p, shape);
    for (const s of a.studs) {
      for (const id of this.turnedReceivers.get(s.key) ?? [])
        if (this.turned.get(id)!.frame !== mine) out.add(id);
      const at = mine ? rational(s.at) : null;
      if (at) for (const id of this.root.receiversAt.get(pointKey(at)) ?? []) out.add(id);
    }
    return out;
  }

  /**
   * The one stud the part `p` would hang on, if it is held by one stud only and by nothing
   * else: where that stud's base is and the way from the part it hangs on toward it, on `p`'s
   * lattice. A part held so can turn about it in 45° steps.
   */
  hangsOn(p: Placement): { at: Vec3; dir: Axis } | null {
    const links = this.neighbours(p);
    if (links.length !== 1 || links[0]!.studs !== 1) return null;
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    const shape = this.shapeOf(p);
    const other = links[0]!.lower === self ? links[0]!.upper : links[0]!.lower;
    const q = this.bricks.get(other)!;
    const qa = this.acrossOf(q, this.shapes.get(other)!);
    const pa = this.acrossOf(p, shape);
    // One of its receivers on a stud of the other, or one of its studs in a receiver.
    for (let i = 0; i < pa.receivers.length; i++) {
      const r = pa.receivers[i]!;
      if (qa.studs.some((s) => s.key === r.key && s.dir === oppositeDir(frameDirOf(r))))
        return { at: shape.receivers[i]!.at, dir: oppositeAxis(shape.receivers[i]!.dir) };
    }
    for (let i = 0; i < pa.studs.length; i++) {
      const s = pa.studs[i]!;
      if (qa.receivers.some((r) => r.key === s.key && r.dir === oppositeDir(frameDirOf(s))))
        return { at: shape.studs[i]!.at, dir: oppositeAxis(shape.studs[i]!.dir) };
    }
    return null;
  }

  /**
   * How many studs the part `p` (id `pid`, shape `shape`) takes from each part, by id. `extra`
   * is a part that is not in the grid (yet) but counts as being there. A sideways or turned part takes
   * each stud its receivers meet. An upright part with a centre hollow takes the stud right
   * under the hollow only if that stud stands up on its own, and wedges between the four studs
   * round it only with all four there. Studs of parts on other lattices count where they meet a
   * receiver exactly.
   */
  private grips(p: Placement, pid: number, shape: PartShape, extra?: Extra): Map<number, number> {
    const out = new Map<number, number>();
    if (!shape.receivers.length) return out;
    const mine = frameKey(p.frame);
    const l = this.lattices.get(mine);
    const across =
      this.across(p, shape) || (!!extra && frameKey(extra.p.frame) !== frameKey(p.frame));
    const pa = across ? this.acrossOf(p, shape) : null;
    // The extra part's studs, by point: on this lattice, or exactly in the grid.
    const extraAt = new Map<number, LatticeStud>();
    const extraAcross = new Map<string, PlacedPoint<LatticeStud>>();
    if (extra && extra.id !== pid) {
      if (frameKey(extra.p.frame) === mine)
        for (const s of extra.shape.studs) extraAt.set(pointKey(s.at), s);
      else for (const s of acrossShape(extra.shape, extra.p.frame).studs) extraAcross.set(s.key, s);
    }
    // Whose stud goes into the receiver, if any.
    const at = (r: Receiver, i: number) => {
      const k = pointKey(r.at);
      const e = extraAt.get(k);
      if (e && clutches(e, r)) return extra!.id;
      for (const f of l?.studsAt.get(k) ?? [])
        if (f.id !== pid && f.id !== extra?.id && clutches(f.s, r)) return f.id;
      if (!pa) return undefined;
      // A stud on another lattice, exactly there.
      const ra = pa.receivers[i]!;
      const facing = oppositeDir(frameDirOf(ra));
      const fits = (s: PlacedPoint<LatticeStud>) =>
        s.dir === facing && (r.kind !== 'bar' || !!s.of.open);
      const x = extraAcross.get(ra.key);
      if (x && fits(x)) return extra!.id;
      for (const f of this.turnedStuds.get(ra.key) ?? [])
        if (
          f.id !== pid &&
          f.id !== extra?.id &&
          this.turned.get(f.id)!.frame !== mine &&
          fits(f.s)
        )
          return f.id;
      const point = mine ? rational(ra.at) : null;
      if (point && ra.axis)
        for (const f of this.root.studsAt.get(pointKey(point)) ?? [])
          if (
            f.id !== pid &&
            f.id !== extra?.id &&
            clutches(f.s, { ...r, at: point, dir: ra.axis })
          )
            return f.id;
      return undefined;
    };
    const take = (id: number) => out.set(id, (out.get(id) ?? 0) + 1);
    const rim = BRICK_TYPES[p.type].rim;
    if (p.face || p.orient) {
      shape.receivers.forEach((r, i) => {
        if (rim && r.kind === 'around') return;
        const id = at(r, i);
        if (id !== undefined) take(id);
      });
      return out;
    }
    const around = shape.receivers.flatMap((r, i) => (r.kind === 'around' ? [i] : []));
    shape.receivers.forEach((r, i) => {
      if (r.kind === 'around') return;
      const id = at(r, i);
      // A centre hollow on a single stud (a dish or a 2x2 round tile centred on it) clears what
      // is round that stud only if that stud stands up on its own: anything else right under
      // the part, or another stud, would run into its bottom (a dish's bowed underside reaches
      // out over it). A hole on top (a round tile's with a hole) takes a stud from above as is.
      if (id === undefined) return;
      if (r.dir === '-y' && around.length && !this.standsAlone(p, id, extra)) return;
      take(id);
    });
    // A dish's rim comes down over the studs round it: it never wedges between four.
    const held = rim ? [] : around.map((i) => at(shape.receivers[i]!, i));
    if (held.length && held.every((id) => id !== undefined)) for (const id of held) take(id!);
    return out;
  }

  /**
   * Whether the part `id` is all that is right under the upright part `p`, with no stud under
   * `p` but the one in the middle. `extra` counts as being in the grid.
   */
  private standsAlone(p: Placement, id: number, extra?: Extra): boolean {
    const box = partBox(p);
    // A dish's rim comes down to its bottom: it needs a whole plate of room under it.
    const rim = BRICK_TYPES[p.type].rim;
    const room = rim ? 2 : 1;
    const l = this.lattices.get(frameKey(p.frame));
    for (let x = box.x0; x < box.x1; x++)
      for (let z = box.z0; z < box.z1; z++)
        for (let h = 1; h <= room; h++)
          for (const u of l?.occupancy.get(slotKey(x, 2 * box.y0 - h, z)) ?? [])
            if (u !== id && u !== extra?.id) return false;
    const same = (q: Placement) => frameKey(q.frame) === frameKey(p.frame);
    if (extra && extra.id !== id && !extra.p.face && same(extra.p)) {
      const e = partBox(extra.p);
      if (
        e.y1 <= box.y0 &&
        e.y1 > box.y0 - room / 2 &&
        e.x0 < box.x1 &&
        box.x0 < e.x1 &&
        e.z0 < box.z1 &&
        box.z0 < e.z1
      )
        return false;
    }
    const host = extra?.id === id ? extra.p : this.bricks.get(id);
    if (!host) return false;
    // On a 1x1's stud (or a part's whose top is no bigger), or on another dish's.
    if (rim && !BRICK_TYPES[host.type].rim) {
      const f = footprint(host.type, host.rot);
      if (!host.face && !host.orient && f.w * f.d > 1) return false;
    }
    // The part is round: a stud is under it if the stud's edge reaches inside its rim.
    const { w, d } = footprint(p.type, p.rot);
    const [cx, cz] = [p.x + w / 2, p.z + d / 2];
    const reach = STUD_REACH / LDU_PER_STUD;
    if (!same(host)) {
      // On another lattice: its studs as the grid has them, in the part's frame.
      const back = p.frame ? invertFrame(p.frame) : ROOT_FRAME;
      const hs = host === extra?.p ? extra.shape : this.shapes.get(id)!;
      const studs = acrossShape(hs, host.frame).studs.filter((s) => s.of.kind === 'top');
      const under = studs.filter((s) => {
        const v = framePointOf(back, s.at).map(surdValue);
        return (
          Math.hypot(v[0]! / LDU_PER_STUD - cx, v[2]! / LDU_PER_STUD - cz) <
          Math.min(w, d) / 2 + reach
        );
      });
      return under.length === 1;
    }
    const inside = (c: { x: number; z: number }) =>
      Math.hypot(c.x + 0.5 - cx, c.z + 0.5 - cz) < Math.min(w, d) / 2 + reach;
    return topStudCells(host).filter(inside).length === 1;
  }

  /** Every connection in the grid, each listed once. */
  connections(): Connection[] {
    const out: Connection[] = [];
    for (const b of this.bricks.values()) {
      for (const c of this.neighbours(b)) if (c.lower === b.id) out.push(c);
    }
    return out;
  }

  /**
   * Splits the bricks into connected groups, ignoring the connections listed in `broken`.
   * Groups are sorted largest first.
   */
  components(broken: Iterable<Connection> = []): number[][] {
    const cut = new Set<string>();
    for (const c of broken) cut.add(`${c.lower}:${c.upper}`);
    const adj = new Map<number, number[]>();
    for (const id of this.bricks.keys()) adj.set(id, []);
    for (const c of this.connections()) {
      if (cut.has(`${c.lower}:${c.upper}`)) continue;
      adj.get(c.lower)!.push(c.upper);
      adj.get(c.upper)!.push(c.lower);
    }
    const seen = new Set<number>();
    const groups: number[][] = [];
    for (const start of this.bricks.keys()) {
      if (seen.has(start)) continue;
      const group: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop()!;
        group.push(id);
        for (const n of adj.get(id)!) {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      groups.push(group.sort((a, b) => a - b));
    }
    return groups.sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  }
}

function push<K, T>(map: Map<K, T[]>, k: K, t: T): void {
  const at = map.get(k);
  if (at) at.push(t);
  else map.set(k, [t]);
}

/** The grid's own frame. */
const ROOT_FRAME = latticeFrame(ORIENTATIONS[0]!);
