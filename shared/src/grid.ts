import { BRICK_TYPES, footprint } from './bricks.ts';
import type { BrickTypeId, ColourId, Facing, Rotation } from './bricks.ts';
import type { Prints } from './builds/types.ts';
import type { PlacedSideStud } from './parts.ts';
import {
  bottomGrips,
  canopyCells,
  emptyColumns,
  clipsOnto,
  faceVector,
  partBox,
  partCentre,
  PLATES_PER_STUD,
  sideStudsOf,
  sidewaysOut,
  sidewaysSpan,
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
 * every slot of every part tried, many times a tick, so not a string.
 */
const SLOT = 131072;

const slotKey = (x: number, h: number, z: number) =>
  ((x + SLOT / 2) * SLOT + (h + SLOT / 2)) * SLOT + (z + SLOT / 2);

/** A stud's radius, in studs. */
const STUD_RADIUS_STUDS = 0.3;

/**
 * How far apart (in plates) a bracket's flange stud and a side stud sticking out of the same
 * side must be: half the flange's height (a stud) and a stud's radius (0.3 of a stud).
 */
const FLANGE_CLEAR = PLATES_PER_STUD * (0.5 + STUD_RADIUS_STUDS);
/** How far round a side stud (in plates) the parts whose studs or flanges could meet it are. */
const FLANGE_REACH = 2 * PLATES_PER_STUD + FLANGE_CLEAR;

/** Grid cells (x, z columns and y layers) covered by a placement. */
export function* cellsOf(p: Placement): Generator<[number, number, number]> {
  const b = partBox(p);
  const empty = emptyColumns(p);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++)
      for (let z = b.z0; z < b.z1; z++) if (!empty.size || !empty.has(`${x},${z}`)) yield [x, y, z];
  yield* canopyCells(p);
}

/**
 * Half-plate slots a placement fills, as (x, half, z). Upright parts fill whole layers. A
 * sideways part sits where side studs put it, a stud (2.5 plates) at a time, so its ends can
 * fall half way through a layer: two tiles clipped one over the other onto a five-plate brick
 * with two rows of side studs share its middle layer, half each.
 */
function slotsOf(p: Placement): number[] {
  const out: number[] = [];
  const b = partBox(p);
  let h0 = 2 * b.y0;
  let h1 = 2 * b.y1;
  if (p.face) {
    const { y0, y1 } = sidewaysSpan(p);
    h0 = Math.floor(2 * y0 + 1e-6);
    h1 = Math.ceil(2 * y1 - 1e-6);
  }
  // Only where its body is: not the cells a quarter arc's hole leaves empty.
  const empty = emptyColumns(p);
  for (let h = h0; h < h1; h++)
    for (let x = b.x0; x < b.x1; x++)
      for (let z = b.z0; z < b.z1; z++)
        if (!empty.size || !empty.has(`${x},${z}`)) out.push(x, h, z);
  for (const [x, y, z] of canopyCells(p)) out.push(x, 2 * y, z, x, 2 * y + 1, z);
  return out;
}

/**
 * Where a bracket's flanges hang below the bracket's own layer: for each stud on a flange (a
 * side stud standing out from its part), the column in front of it and the half-plate slots
 * from the flange's bottom (a stud's half below the stud) up to the bracket's bottom.
 */
function flangeZones(
  p: Placement,
): { x: number; z: number; dir: Facing; h0: number; h1: number }[] {
  if (p.face) return [];
  const bottom = 2 * p.y;
  return sideStudsOf(p)
    .filter((s) => s.out > 0)
    .map((s) => {
      const v = faceVector(s.dir);
      const h0 = Math.floor(2 * (s.y - PLATES_PER_STUD / 2) + 1e-6);
      return { x: s.x + v.x, z: s.z + v.z, dir: s.dir, h0, h1: bottom };
    })
    .filter((f) => f.h0 < f.h1);
}

/** Brick centre in the assembly's local frame, in metres. */
export function localCentre(p: Placement): { x: number; y: number; z: number } {
  return partCentre(p);
}

/**
 * The logical structure of one assembly: which bricks sit where, and which are clutched
 * together. Pure data, no physics, so the same code runs on client, server and in tests.
 */
export class BrickGrid {
  readonly bricks = new Map<number, PlacedBrick>();
  private readonly occupancy = new Map<number, number>();
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

  /** A part in cell (x, y, z), in either half of that layer. */
  brickAt(x: number, y: number, z: number): number | undefined {
    // Only whole columns hold anything (and a key is made of whole numbers only).
    if (!Number.isInteger(x) || !Number.isInteger(z)) return undefined;
    const h = 2 * Math.floor(y);
    return this.occupancy.get(slotKey(x, h, z)) ?? this.occupancy.get(slotKey(x, h + 1, z));
  }

  /** The part filling the half-plate slot at (x, half, z), if any. */
  private at(x: number, h: number, z: number): PlacedBrick | undefined {
    if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(h)) return undefined;
    const id = this.occupancy.get(slotKey(x, h, z));
    return id === undefined ? undefined : this.bricks.get(id);
  }

  /**
   * Whether `p` would run into a part in the grid. A sideways part set back into a headlight
   * brick's recess also reaches half a plate into the cell behind it, which only a recessed
   * side leaves room for.
   */
  overlaps(p: Placement): boolean {
    const slots = slotsOf(p);
    for (let i = 0; i < slots.length; i += 3) {
      if (this.occupancy.has(slotKey(slots[i]!, slots[i + 1]!, slots[i + 2]!))) return true;
    }
    if (p.face && sidewaysOut(p) < 0) {
      const v = faceVector(p.face);
      for (let i = 0; i < slots.length; i += 3) {
        const x = slots[i]!;
        const h = slots[i + 1]!;
        const z = slots[i + 2]!;
        const behind = this.at(x - v.x, h, z - v.z);
        if (!behind) continue;
        const recessed = sideStudsOf(behind).some(
          (s) => s.dir === p.face && s.out < 0 && s.x === x - v.x && s.z === z - v.z,
        );
        if (!recessed) return true;
      }
    }
    return (!p.face && this.flangeClash(p)) || this.underFlange(p);
  }

  /**
   * Whether `p` and a bracket's flange would be in the same place below the bracket: the
   * flange hangs a stud down from the bracket's top in front of it, so it needs that room in
   * the column in front, under the bracket's layer, free. `p` may be the bracket, or a part
   * going in under one. Only a part clipped onto the flange's own studs goes there.
   */
  private underFlange(p: Placement): boolean {
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    // Clipped onto a flange: sideways, its back half a plate out.
    const onFlange = (q: Placement, dir: Facing) => q.face === dir && sidewaysOut(q) > 0;
    const zones = flangeZones(p);
    for (const f of zones)
      for (let h = f.h0; h < f.h1; h++) {
        const q = this.at(f.x, h, f.z);
        if (q && q.id !== self && !onFlange(q, f.dir)) return true;
      }
    // Brackets whose flanges hang where `p` goes: beside it, up to a stud above it.
    const box = partBox(p);
    const slots = new Set<number>();
    const mine = slotsOf(p);
    for (let i = 0; i < mine.length; i += 3)
      slots.add(slotKey(mine[i]!, mine[i + 1]!, mine[i + 2]!));
    const seen = new Set<number>([self]);
    for (let x = box.x0 - 1; x <= box.x1; x++)
      for (let z = box.z0 - 1; z <= box.z1; z++)
        for (let h = 2 * box.y0; h < 2 * box.y1 + 2 * PLATES_PER_STUD; h++) {
          const b = this.at(x, h, z);
          if (!b || b.face || seen.has(b.id)) continue;
          seen.add(b.id);
          for (const f of flangeZones(b)) {
            if (onFlange(p, f.dir)) continue;
            for (let k = f.h0; k < f.h1; k++) if (slots.has(slotKey(f.x, k, f.z))) return true;
          }
        }
    return false;
  }

  /**
   * Whether the upright part `p` has a bracket's flange where a side stud of another part is,
   * or a side stud where another part's flange is: a flange hangs in front of its plate's side,
   * so a stud sticking out of that side under it (not one set back in a headlight brick's
   * recess), or another flange, runs into it.
   */
  private flangeClash(p: Placement): boolean {
    const mine = sideStudsOf(p);
    if (!mine.length) return false;
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    const meet = (flange: PlacedSideStud, stud: PlacedSideStud) =>
      flange.out > 0 &&
      stud.out >= 0 &&
      flange.dir === stud.dir &&
      flange.x === stud.x &&
      flange.z === stud.z &&
      Math.abs(flange.y - stud.y) < FLANGE_CLEAR - 1e-6;
    for (const s of mine) {
      const seen = new Set<number>([self]);
      for (let h = Math.floor(2 * (s.y - FLANGE_REACH)); h < 2 * (s.y + FLANGE_REACH); h++) {
        const b = this.at(s.x, h, s.z);
        if (!b || b.face || seen.has(b.id)) continue;
        seen.add(b.id);
        for (const o of sideStudsOf(b)) if (meet(s, o) || meet(o, s)) return true;
      }
    }
    return false;
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
    this.version++;
    const slots = slotsOf(brick);
    for (let i = 0; i < slots.length; i += 3) {
      this.occupancy.set(slotKey(slots[i]!, slots[i + 1]!, slots[i + 2]!), brick.id);
    }
  }

  remove(id: number): PlacedBrick | undefined {
    const b = this.bricks.get(id);
    if (!b) return undefined;
    const slots = slotsOf(b);
    for (let i = 0; i < slots.length; i += 3) {
      this.occupancy.delete(slotKey(slots[i]!, slots[i + 1]!, slots[i + 2]!));
    }
    this.bricks.delete(id);
    this.version++;
    return b;
  }

  /**
   * Bricks clutched to `p`: upright ones directly above or below that meet a stud (a tile or
   * a slope's front clutches nothing on top), and for side studs, the sideways part clipped
   * on or the part it is clipped to, where a stud spot of the sideways part lines up with the
   * side stud exactly (see `clipsOnto`). `p` must not overlap the grid. The lower side of a
   * connection is the part underneath, or the one whose side studs hold the other. For a
   * placement that is not in the grid yet, its side of each connection is -1.
   */
  neighbours(p: Placement): Connection[] {
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    const counts = new Map<string, Connection>();
    const add = (lower: number, upper: number, studs = 1) => {
      const key = `${lower}:${upper}`;
      const c = counts.get(key);
      if (c) c.studs += studs;
      else counts.set(key, { lower, upper, studs });
    };
    const upright = (b: PlacedBrick | undefined) => (b && !b.face ? b : undefined);
    if (!p.face) {
      const box = partBox(p);
      // Below: every stud of what is underneath that the part's bottom takes.
      for (const [id, studs] of this.gripsBelow(p)) add(id, self, studs);
      // Above: whatever sits on this part's own studs.
      const seen = new Set<number>();
      for (let x = box.x0; x < box.x1; x++) {
        for (let z = box.z0; z < box.z1; z++) {
          const above = upright(this.at(x, 2 * box.y1, z));
          if (!above || above.y !== box.y1 || above.id === self || seen.has(above.id)) continue;
          seen.add(above.id);
          const studs = this.gripsBelow(above, { id: self, p }).get(self);
          if (studs) add(self, above.id, studs);
        }
      }
      // Its side studs: sideways parts clipped on in front of them.
      for (const s of sideStudsOf(p)) {
        const v = faceVector(s.dir);
        const q = this.at(s.x + v.x, Math.floor(2 * s.y), s.z + v.z);
        if (q && q.id !== self && clipsOnto(q, s)) add(self, q.id);
      }
    } else {
      // A sideways part: the side studs behind it that it lines up with.
      const v = faceVector(p.face);
      const seen = new Set<number>();
      const slots = slotsOf(p);
      for (let i = 0; i < slots.length; i += 3) {
        const x = slots[i]!;
        const h = slots[i + 1]!;
        const z = slots[i + 2]!;
        const host = upright(this.at(x - v.x, h, z - v.z));
        if (!host || host.id === self || seen.has(host.id)) continue;
        seen.add(host.id);
        for (const s of sideStudsOf(host)) if (clipsOnto(p, s)) add(host.id, self);
      }
    }
    return [...counts.values()];
  }

  /**
   * How many studs the upright part `p` takes from each part right under it, by id. `extra` is
   * a part that is not in the grid (yet) but counts as being there.
   */
  private gripsBelow(p: Placement, extra?: { id: number; p: Placement }): Map<number, number> {
    const box = partBox(p);
    const parts = new Map<number, Placement>();
    // What stands in each column right under the part, by id.
    const under = new Map<string, number>();
    for (let x = box.x0; x < box.x1; x++) {
      for (let z = box.z0; z < box.z1; z++) {
        const b = this.at(x, 2 * box.y0 - 1, z);
        if (!b) continue;
        under.set(`${x},${z}`, b.id);
        if (!b.face) parts.set(b.id, b);
      }
    }
    if (extra && !extra.p.face) {
      parts.set(extra.id, extra.p);
      const e = partBox(extra.p);
      if (e.y1 === box.y0)
        for (let x = Math.max(e.x0, box.x0); x < Math.min(e.x1, box.x1); x++)
          for (let z = Math.max(e.z0, box.z0); z < Math.min(e.z1, box.z1); z++)
            under.set(`${x},${z}`, extra.id);
    }
    const studAt = new Map<string, number>();
    // A bar goes only into an open stud.
    const bar = BRICK_TYPES[p.type].bottom === 'bar';
    for (const [id, b] of parts) {
      if (b.y + BRICK_TYPES[b.type].plates !== box.y0) continue;
      if (bar && !BRICK_TYPES[b.type].openStud) continue;
      for (const c of topStudCells(b)) studAt.set(`${c.x},${c.z}`, id);
    }
    const out = new Map<number, number>();
    const take = (id: number) => out.set(id, (out.get(id) ?? 0) + 1);
    const grips = bottomGrips(p);
    for (const c of grips.under) {
      const id = studAt.get(`${c.x},${c.z}`);
      // A centre hollow on a single stud (a dish or a 2x2 round tile centred on it) clears what
      // is round that stud only if that stud stands up on its own: anything else right under
      // the part, or another stud, would run into its bottom (a dish's bowed underside reaches
      // out over it).
      if (id === undefined || (grips.around.length && !this.standsAlone(p, id, under, extra)))
        continue;
      take(id);
    }
    const around = grips.around.map((c) => studAt.get(`${c.x},${c.z}`));
    if (around.length && around.every((id) => id !== undefined)) for (const id of around) take(id!);
    return out;
  }

  /**
   * Whether the part `id` is all that is right under the upright part `p` (`under` holds what
   * stands in each column under it), with no stud under `p` but the one in the middle.
   */
  private standsAlone(
    p: Placement,
    id: number,
    under: Map<string, number>,
    extra?: { id: number; p: Placement },
  ): boolean {
    for (const u of under.values()) if (u !== id) return false;
    const host = extra?.id === id ? extra.p : this.bricks.get(id);
    if (!host) return false;
    // The part is round: a stud is under it if the stud's edge reaches inside its rim.
    const { w, d } = footprint(p.type, p.rot);
    const [cx, cz] = [p.x + w / 2, p.z + d / 2];
    const inside = (c: { x: number; z: number }) =>
      Math.hypot(c.x + 0.5 - cx, c.z + 0.5 - cz) < Math.min(w, d) / 2 + STUD_RADIUS_STUDS;
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
