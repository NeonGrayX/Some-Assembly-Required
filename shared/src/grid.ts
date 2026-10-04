import { BRICK_TYPES, PLATE_H, STUD, footprint } from './bricks.ts';
import type { BrickTypeId, ColourId, Rotation } from './bricks.ts';

/** Where a brick sits in an assembly's grid. (x, y, z) is the minimum corner cell. */
export interface Placement {
  type: BrickTypeId;
  x: number;
  y: number;
  z: number;
  rot: Rotation;
}

export interface PlacedBrick extends Placement {
  id: number;
  colour: ColourId;
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
  const { w, d } = footprint(p.type, p.rot);
  const h = BRICK_TYPES[p.type].plates;
  for (let y = p.y; y < p.y + h; y++)
    for (let x = p.x; x < p.x + w; x++) for (let z = p.z; z < p.z + d; z++) yield [x, y, z];
}

/** Brick centre in the assembly's local frame, in metres. */
export function localCentre(p: Placement): { x: number; y: number; z: number } {
  const { w, d } = footprint(p.type, p.rot);
  const h = BRICK_TYPES[p.type].plates;
  return { x: (p.x + w / 2) * STUD, y: (p.y + h / 2) * PLATE_H, z: (p.z + d / 2) * STUD };
}

function overlapArea(a: Placement, b: Placement): number {
  const fa = footprint(a.type, a.rot);
  const fb = footprint(b.type, b.rot);
  const ox = Math.min(a.x + fa.w, b.x + fb.w) - Math.max(a.x, b.x);
  const oz = Math.min(a.z + fa.d, b.z + fb.d) - Math.max(a.z, b.z);
  return ox > 0 && oz > 0 ? ox * oz : 0;
}

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
   * Bricks directly above or below `p` that share at least one stud with it. `p` must not
   * overlap the grid, so anything in the layer just below or above touches its face.
   * For a placement that is not in the grid yet, its side of each connection is -1.
   */
  neighbours(p: Placement): Connection[] {
    const out: Connection[] = [];
    const self = 'id' in p ? (p as PlacedBrick).id : -1;
    const { w, d } = footprint(p.type, p.rot);
    const top = p.y + BRICK_TYPES[p.type].plates;
    const seen = new Set<number>();
    for (let x = p.x; x < p.x + w; x++) {
      for (let z = p.z; z < p.z + d; z++) {
        const below = this.occupancy.get(cellKey(x, p.y - 1, z));
        if (below !== undefined && !seen.has(below)) {
          seen.add(below);
          out.push({ lower: below, upper: self, studs: overlapArea(p, this.bricks.get(below)!) });
        }
        const above = this.occupancy.get(cellKey(x, top, z));
        if (above !== undefined && !seen.has(above)) {
          seen.add(above);
          out.push({ lower: self, upper: above, studs: overlapArea(p, this.bricks.get(above)!) });
        }
      }
    }
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
