import { BRICK_TYPES } from './bricks.ts';
import type { BrickTypeId, ColourId, Facing, Rotation } from './bricks.ts';
import type { Prints } from './builds/types.ts';
import {
  faceVector,
  partBox,
  partCentre,
  sideStudsOf,
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

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Grid cells (x, z columns and y layers) covered by a placement. */
export function* cellsOf(p: Placement): Generator<[number, number, number]> {
  const b = partBox(p);
  for (let y = b.y0; y < b.y1; y++)
    for (let x = b.x0; x < b.x1; x++) for (let z = b.z0; z < b.z1; z++) yield [x, y, z];
}

/** Brick centre in the assembly's local frame, in metres. */
export function localCentre(p: Placement): { x: number; y: number; z: number } {
  return partCentre(p);
}

/** Whether side stud height `y` (plates) is within a sideways part's reach. */
const spans = (p: Placement, y: number) => {
  const { y0, y1 } = sidewaysSpan(p);
  return y > y0 && y < y1;
};

/**
 * The logical structure of one assembly: which bricks sit where, and which are clutched
 * together. Pure data, no physics, so the same code runs on client, server and in tests.
 */
export class BrickGrid {
  readonly bricks = new Map<number, PlacedBrick>();
  private readonly occupancy = new Map<string, number>();

  static from(bricks: Iterable<PlacedBrick>): BrickGrid {
    const g = new BrickGrid();
    for (const b of bricks) g.insert(b);
    return g;
  }

  get size(): number {
    return this.bricks.size;
  }

  brickAt(x: number, y: number, z: number): number | undefined {
    return this.occupancy.get(cellKey(x, y, z));
  }

  /** Whether `p` could be added: no overlap, and clutched to at least one brick. */
  check(p: Placement): AddResult {
    for (const [x, y, z] of cellsOf(p)) {
      if (this.occupancy.has(cellKey(x, y, z))) return { ok: false, reason: 'overlap' };
    }
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
    for (const [x, y, z] of cellsOf(brick)) this.occupancy.set(cellKey(x, y, z), brick.id);
  }

  remove(id: number): PlacedBrick | undefined {
    const b = this.bricks.get(id);
    if (!b) return undefined;
    for (const [x, y, z] of cellsOf(b)) this.occupancy.delete(cellKey(x, y, z));
    this.bricks.delete(id);
    return b;
  }

  /**
   * Bricks clutched to `p`: upright ones directly above or below that meet a stud (a tile or
   * a slope's front clutches nothing on top), and for side studs, the sideways part clipped
   * on or the part it is clipped to. `p` must not overlap the grid. The lower side of a
   * connection is the part underneath, or the one whose side studs hold the other. For a
   * placement that is not in the grid yet, its side of each connection is -1.
   */
  neighbours(p: Placement): Connection[] {
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    const counts = new Map<string, Connection>();
    const add = (lower: number, upper: number) => {
      const key = `${lower}:${upper}`;
      const c = counts.get(key);
      if (c) c.studs++;
      else counts.set(key, { lower, upper, studs: 1 });
    };
    const upright = (id: number | undefined) => {
      const b = id === undefined ? undefined : this.bricks.get(id);
      return b && !b.face ? b : undefined;
    };
    if (!p.face) {
      const box = partBox(p);
      // Below: every stud of what is underneath that the part covers.
      const studsBelow = new Map<number, Set<string>>();
      for (let x = box.x0; x < box.x1; x++) {
        for (let z = box.z0; z < box.z1; z++) {
          const below = upright(this.occupancy.get(cellKey(x, box.y0 - 1, z)));
          if (!below || below.y + BRICK_TYPES[below.type].plates !== box.y0) continue;
          let studs = studsBelow.get(below.id);
          if (!studs) {
            studs = new Set(topStudCells(below).map((c) => `${c.x},${c.z}`));
            studsBelow.set(below.id, studs);
          }
          if (studs.has(`${x},${z}`)) add(below.id, self);
        }
      }
      // Above: whatever sits on this part's own studs.
      for (const c of topStudCells(p)) {
        const above = upright(this.occupancy.get(cellKey(c.x, box.y1, c.z)));
        if (above && above.y === box.y1) add(self, above.id);
      }
      // Its side studs: sideways parts clipped on in front of them.
      for (const s of sideStudsOf(p)) {
        const v = faceVector(s.dir);
        const id = this.occupancy.get(cellKey(s.x + v.x, Math.floor(s.y), s.z + v.z));
        const q = id === undefined ? undefined : this.bricks.get(id);
        if (q && q.face === s.dir && spans(q, s.y)) add(self, q.id);
      }
    } else {
      // A sideways part: the side studs behind it that it covers.
      const v = faceVector(p.face);
      const box = partBox(p);
      const seen = new Set<number>();
      for (let y = box.y0; y < box.y1; y++) {
        for (let x = box.x0; x < box.x1; x++) {
          for (let z = box.z0; z < box.z1; z++) {
            const host = upright(this.occupancy.get(cellKey(x - v.x, y, z - v.z)));
            if (!host || seen.has(host.id)) continue;
            seen.add(host.id);
            for (const s of sideStudsOf(host)) {
              const inFront = s.x + v.x >= box.x0 && s.x + v.x < box.x1;
              const inFrontZ = s.z + v.z >= box.z0 && s.z + v.z < box.z1;
              if (s.dir === p.face && inFront && inFrontZ && spans(p, s.y)) add(host.id, self);
            }
          }
        }
      }
    }
    return [...counts.values()];
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
