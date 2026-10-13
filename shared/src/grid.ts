import { BRICK_TYPES } from './bricks.ts';
import type { BrickTypeId, ColourId, Facing, Rotation } from './bricks.ts';
import type { Prints } from './builds/types.ts';
import {
  bottomGrips,
  clipsOnto,
  faceVector,
  partBox,
  partCentre,
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

/** Key of a slot: column (x, z) and half plate `h` (layer y is halves 2y and 2y + 1). */
const slotKey = (x: number, h: number, z: number) => `${x},${h},${z}`;

/** Grid cells (x, z columns and y layers) covered by a placement. */
export function* cellsOf(p: Placement): Generator<[number, number, number]> {
  const b = partBox(p);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) for (let z = b.z0; z < b.z1; z++) yield [x, y, z];
}

/**
 * Half-plate slots a placement fills, as (x, half, z). Upright parts fill whole layers. A
 * sideways part sits where side studs put it, a stud (2.5 plates) at a time, so its ends can
 * fall half way through a layer: two tiles clipped one over the other onto a five-plate brick
 * with two rows of side studs share its middle layer, half each.
 */
function* slotsOf(p: Placement): Generator<[number, number, number]> {
  const b = partBox(p);
  let h0 = 2 * b.y0;
  let h1 = 2 * b.y1;
  if (p.face) {
    const { y0, y1 } = sidewaysSpan(p);
    h0 = Math.floor(2 * y0 + 1e-6);
    h1 = Math.ceil(2 * y1 - 1e-6);
  }
  for (let h = h0; h < h1; h++)
    for (let x = b.x0; x < b.x1; x++) for (let z = b.z0; z < b.z1; z++) yield [x, h, z];
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
  private readonly occupancy = new Map<string, number>();
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
    const h = 2 * Math.floor(y);
    return this.occupancy.get(slotKey(x, h, z)) ?? this.occupancy.get(slotKey(x, h + 1, z));
  }

  /** The part filling the half-plate slot at (x, half, z), if any. */
  private at(x: number, h: number, z: number): PlacedBrick | undefined {
    const id = this.occupancy.get(slotKey(x, h, z));
    return id === undefined ? undefined : this.bricks.get(id);
  }

  /**
   * Whether `p` would run into a part in the grid. A sideways part set back into a headlight
   * brick's recess also reaches half a plate into the cell behind it, which only a recessed
   * side leaves room for.
   */
  overlaps(p: Placement): boolean {
    for (const [x, h, z] of slotsOf(p)) if (this.occupancy.has(slotKey(x, h, z))) return true;
    if (p.face && sidewaysOut(p) < 0) {
      const v = faceVector(p.face);
      for (const [x, h, z] of slotsOf(p)) {
        const behind = this.at(x - v.x, h, z - v.z);
        if (!behind) continue;
        const recessed = sideStudsOf(behind).some(
          (s) => s.dir === p.face && s.out < 0 && s.x === x - v.x && s.z === z - v.z,
        );
        if (!recessed) return true;
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
    for (const [x, h, z] of slotsOf(brick)) this.occupancy.set(slotKey(x, h, z), brick.id);
  }

  remove(id: number): PlacedBrick | undefined {
    const b = this.bricks.get(id);
    if (!b) return undefined;
    for (const [x, h, z] of slotsOf(b)) this.occupancy.delete(slotKey(x, h, z));
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
      for (const [x, h, z] of slotsOf(p)) {
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
    for (let x = box.x0; x < box.x1; x++) {
      for (let z = box.z0; z < box.z1; z++) {
        const b = this.at(x, 2 * box.y0 - 1, z);
        if (b && !b.face) parts.set(b.id, b);
      }
    }
    if (extra && !extra.p.face) parts.set(extra.id, extra.p);
    const studAt = new Map<string, number>();
    for (const [id, b] of parts) {
      if (b.y + BRICK_TYPES[b.type].plates !== box.y0) continue;
      for (const c of topStudCells(b)) studAt.set(`${c.x},${c.z}`, id);
    }
    const out = new Map<number, number>();
    const take = (id: number) => out.set(id, (out.get(id) ?? 0) + 1);
    const grips = bottomGrips(p);
    for (const c of grips.under) {
      const id = studAt.get(`${c.x},${c.z}`);
      if (id !== undefined) take(id);
    }
    const around = grips.around.map((c) => studAt.get(`${c.x},${c.z}`));
    if (around.length && around.every((id) => id !== undefined)) for (const id of around) take(id!);
    return out;
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
