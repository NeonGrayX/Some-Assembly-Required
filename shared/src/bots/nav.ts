import type RAPIER from '@dimforge/rapier3d-compat';
import { STAIRS, UPPER_FLOOR, floorRect, stairsAxes } from '../content/house.ts';
import type { LadderDef } from '../content/house.ts';
import { v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import {
  CONTROLLER_OFFSET,
  PLAYER_FEET,
  PLAYER_GROUPS,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  STAIRS_MARGIN,
  STAIRS_SLIDE,
} from '../sim/sim.ts';
import type { Sim } from '../sim/sim.ts';

type Rapier = typeof RAPIER;

/** Grid spacing of the walking map, in metres. */
export const NAV_CELL = 0.25;
/** Highest step between neighbouring spots that a player walks up (the controller's autostep). */
const STEP = 0.32;
/** Where the downward probes start and stop. */
const TOP = 16;
const BOTTOM = -8;
/**
 * How far from the middle of a flight a player can be (see the sim's `keepOnStairs`): its
 * limit, and the one tick's slide back in that may leave them past it.
 */
const STAIRS_LIMIT = STAIRS.width / 2 - PLAYER_RADIUS - STAIRS_MARGIN + STAIRS_SLIDE;

/** A ladder as the walking map uses it: from the spot at its foot to the spot at its top. */
export interface NavLadder {
  ladder: LadderDef;
  foot: number;
  top: number;
}

/** One step of a path: a spot to walk to, or a ladder to climb up or down to get there. */
export interface Waypoint {
  pos: Vec3;
  node: number;
  /** Set when this step is a climb: the ladder, and whether it goes up. */
  ladder?: { def: LadderDef; up: boolean };
}

/**
 * Where a player can stand and walk, found by probing the level's physics: a grid of spots on
 * every floor (yard, storeys, basement, roofs, the tops of ramps and stairs) where a standing
 * player touches nothing, joined to their neighbours when the step between them is low enough,
 * plus every ladder from its foot to its top. Bots find their way with it.
 */
export class NavGrid {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** Per node: where its feet stand. */
  readonly xs: Float32Array;
  readonly ys: Float32Array;
  readonly zs: Float32Array;
  /** Per column (i * nz + k): its nodes, lowest first. */
  private readonly columns: number[][];
  /** Per node: its neighbours, and the cost of getting there. */
  readonly links: { to: number; cost: number; ladder?: NavLadder; up?: boolean }[][];
  /** Per node: which connected part of the map it is in (spots on top of walls are on their own). */
  readonly part: Int32Array;
  /** The connected part the spawn is in: everywhere a player can get to. */
  readonly main: number;
  readonly ladders: NavLadder[] = [];
  private readonly flights: {
    x: number;
    y: number;
    z: number;
    along: { x: number; z: number };
    across: { x: number; z: number };
  }[];

  constructor(
    private readonly R: Rapier,
    private readonly sim: Sim,
  ) {
    this.flights = (sim.level.stairs ?? []).map((st) => ({ ...st.pos, ...stairsAxes(st) }));
    const f = floorRect(sim.level);
    this.x0 = f.x0;
    this.z0 = f.z0;
    this.nx = Math.ceil((f.x1 - f.x0) / NAV_CELL);
    this.nz = Math.ceil((f.z1 - f.z0) / NAV_CELL);
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    this.columns = Array.from({ length: this.nx * this.nz }, () => []);
    const flags = this.staticFlags();
    const capsule = new R.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS);
    const rot = { x: 0, y: 0, z: 0, w: 1 };
    const down = { x: 0, y: -1, z: 0 };
    for (let i = 0; i < this.nx; i++) {
      for (let k = 0; k < this.nz; k++) {
        const x = this.x0 + (i + 0.5) * NAV_CELL;
        const z = this.z0 + (k + 0.5) * NAV_CELL;
        const found: number[] = [];
        let top = TOP;
        for (let guard = 0; guard < 40 && top > BOTTOM; guard++) {
          const ray = new R.Ray({ x, y: top, z }, down);
          const hit = sim.world.castRayAndGetNormal(ray, top - BOTTOM, true, flags, PLAYER_GROUPS);
          if (!hit) break;
          if (hit.timeOfImpact < 1e-4) {
            // Started inside something solid: find its underside and carry on below it.
            const out = sim.world.castRay(ray, top - BOTTOM, false, flags, PLAYER_GROUPS);
            top -= out && out.timeOfImpact > 1e-4 ? out.timeOfImpact + 0.01 : 0.1;
            continue;
          }
          const y = top - hit.timeOfImpact;
          if (hit.normal.y > 0.6) {
            // Lifted by a step: on stairs the next step up is within a body's width.
            const centre = { x, y: y + PLAYER_FEET + STEP + CONTROLLER_OFFSET, z };
            const blocked = sim.world.intersectionWithShape(
              centre,
              rot,
              capsule,
              flags,
              PLAYER_GROUPS,
            );
            if (!blocked) found.push(y);
          }
          top = y - 0.02;
        }
        for (const y of found.reverse()) {
          // On a flight of stairs a player is kept to the middle of the steps (`keepOnStairs`).
          const on = this.onFlight(x, y, z);
          if (on && Math.abs(on.across) > STAIRS_LIMIT) continue;
          this.columns[i * this.nz + k]!.push(xs.length);
          xs.push(x);
          ys.push(y);
          zs.push(z);
        }
      }
    }
    this.xs = Float32Array.from(xs);
    this.ys = Float32Array.from(ys);
    this.zs = Float32Array.from(zs);
    this.links = Array.from({ length: xs.length }, () => []);
    for (let i = 0; i < this.nx; i++) {
      for (let k = 0; k < this.nz; k++) {
        for (const a of this.columns[i * this.nz + k]!) {
          for (const [di, dk] of [
            [1, 0],
            [0, 1],
            [1, 1],
            [1, -1],
          ] as const) {
            const ni = i + di;
            const nk = k + dk;
            if (ni < 0 || nk < 0 || ni >= this.nx || nk >= this.nz) continue;
            for (const b of this.columns[ni * this.nz + nk]!) {
              if (Math.abs(this.ys[a]! - this.ys[b]!) > STEP) continue;
              if (!this.stairsAllow(a, b, xs, ys, zs)) continue;
              // A diagonal needs both its sides open, or it cuts a corner.
              if (di && dk && !(this.near(ni, k, this.ys[a]!) && this.near(i, nk, this.ys[a]!)))
                continue;
              const cost = Math.hypot(di, dk) * NAV_CELL;
              this.links[a]!.push({ to: b, cost });
              this.links[b]!.push({ to: a, cost });
            }
          }
        }
      }
    }
    for (const l of sim.level.ladders) this.addLadder(l);
    this.part = new Int32Array(xs.length).fill(-1);
    let parts = 0;
    for (let n = 0; n < xs.length; n++) {
      if (this.part[n] !== -1) continue;
      const todo = [n];
      this.part[n] = parts;
      while (todo.length) {
        const m = todo.pop()!;
        for (const l of this.links[m]!) {
          if (this.part[l.to] === -1) {
            this.part[l.to] = parts;
            todo.push(l.to);
          }
        }
      }
      parts++;
    }
    const spawn = this.locate(sim.level.spawn);
    this.main = spawn === null ? 0 : this.part[spawn]!;
  }

  /** Where a spot is on a flight of stairs (along it from its foot, across from its middle), if it is. */
  private onFlight(
    x: number,
    y: number,
    z: number,
  ): { flight: number; along: number; across: number } | null {
    const run = STAIRS.steps * STAIRS.tread;
    for (let i = 0; i < this.flights.length; i++) {
      const f = this.flights[i]!;
      if (y < f.y - 0.2 || y > f.y + UPPER_FLOOR + 0.5) continue;
      const along = (x - f.x) * f.along.x + (z - f.z) * f.along.z;
      const across = (x - f.x) * f.across.x + (z - f.z) * f.across.z;
      if (along < 0 || along > run || Math.abs(across) > STAIRS.width / 2 + 0.4) continue;
      return { flight: i, along, across };
    }
    return null;
  }

  /**
   * Whether a step between two spots is allowed by the stairs: nobody steps on or off a flight
   * over its side, only at its foot and its top.
   */
  private stairsAllow(a: number, b: number, xs: number[], ys: number[], zs: number[]): boolean {
    const fa = this.onFlight(xs[a]!, ys[a]!, zs[a]!);
    const fb = this.onFlight(xs[b]!, ys[b]!, zs[b]!);
    const half = STAIRS.width / 2;
    const inA = fa !== null && Math.abs(fa.across) <= half;
    const inB = fb !== null && Math.abs(fb.across) <= half;
    if (inA === inB) return true;
    // One on the steps, one beside them: only where the flight starts or comes out.
    const on = inA ? fa! : fb!;
    const run = STAIRS.steps * STAIRS.tread;
    return on.along < STAIRS.tread * 0.75 || on.along > run - STAIRS.tread;
  }

  get size(): number {
    return this.xs.length;
  }

  /** Static things only: what never moves (the level, furniture, machines, an anchored build). */
  private staticFlags(): number {
    const F = this.R.QueryFilterFlags;
    return F.EXCLUDE_DYNAMIC | F.EXCLUDE_KINEMATIC | F.EXCLUDE_SENSORS;
  }

  /** Whether column (i, k) has a node within a step of height `y`. */
  private near(i: number, k: number, y: number): boolean {
    if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return false;
    return this.columns[i * this.nz + k]!.some((n) => Math.abs(this.ys[n]! - y) <= STEP);
  }

  private addLadder(l: LadderDef): void {
    // Climbed facing `facing`, from the side away from it.
    const fx = -Math.sin(l.facing);
    const fz = -Math.cos(l.facing);
    const foot = this.closest(v3(l.pos.x - fx * 0.55, l.pos.y, l.pos.z - fz * 0.55), 0.6);
    const topY = l.pos.y + l.height - PLAYER_FEET + 0.3;
    let top: number | null = null;
    for (const out of [0.55, 0.8, 1.05]) {
      top = this.closest(v3(l.pos.x + fx * out, topY, l.pos.z + fz * out), 0.5, 1.4);
      if (top !== null) break;
    }
    if (foot === null || top === null) return;
    const nl: NavLadder = { ladder: l, foot, top };
    this.ladders.push(nl);
    const cost = l.height / 2.4 + 2;
    this.links[foot]!.push({ to: top, cost, ladder: nl, up: true });
    this.links[top]!.push({ to: foot, cost, ladder: nl, up: false });
  }

  /** The node nearest a point (flat distance up to `r`, height within `dy`), if any. */
  closest(p: Vec3, r: number, dy = 0.6): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    const ci = Math.floor((p.x - this.x0) / NAV_CELL);
    const ck = Math.floor((p.z - this.z0) / NAV_CELL);
    const reach = Math.ceil(r / NAV_CELL);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let k = ck - reach; k <= ck + reach; k++) {
        if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) continue;
        for (const n of this.columns[i * this.nz + k]!) {
          const h = Math.abs(this.ys[n]! - p.y);
          if (h > dy) continue;
          const d = Math.hypot(this.xs[n]! - p.x, this.zs[n]! - p.z) + h * 0.5;
          if (d <= r + h * 0.5 && d < bestD) {
            bestD = d;
            best = n;
          }
        }
      }
    }
    return best;
  }

  /** The node a player whose feet are at `feet` stands on (or next to), if any. */
  locate(feet: Vec3): number | null {
    return this.closest(feet, 0.5, 0.6) ?? this.closest(feet, 1.2, 1);
  }

  pos(n: number): Vec3 {
    return v3(this.xs[n]!, this.ys[n]!, this.zs[n]!);
  }

  /** Whether a node is somewhere a player can get to from the spawn. */
  reachable(n: number): boolean {
    return this.part[n] === this.main;
  }

  /** Nodes within `r` (flat) of a point, at a height within `dy` below to `up` above it. */
  around(p: Vec3, r: number, below: number, above: number): number[] {
    const out: number[] = [];
    const ci = Math.floor((p.x - this.x0) / NAV_CELL);
    const ck = Math.floor((p.z - this.z0) / NAV_CELL);
    const reach = Math.ceil(r / NAV_CELL);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let k = ck - reach; k <= ck + reach; k++) {
        if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) continue;
        for (const n of this.columns[i * this.nz + k]!) {
          const dy = this.ys[n]! - p.y;
          if (dy < -below || dy > above || !this.reachable(n)) continue;
          if (Math.hypot(this.xs[n]! - p.x, this.zs[n]! - p.z) <= r) out.push(n);
        }
      }
    }
    return out;
  }

  /**
   * The cheapest way from `from` to any of the `goals` (A* toward the nearest of them), as
   * waypoints, or null if there is none. `avoid` adds a cost to stepping on a node.
   */
  path(from: number, goals: number[], avoid?: (n: number) => number): Waypoint[] | null {
    if (!goals.length) return null;
    const goalSet = new Set(goals);
    const gx = goals.map((g) => this.xs[g]!);
    const gz = goals.map((g) => this.zs[g]!);
    const h = (n: number) => {
      let best = Infinity;
      for (let i = 0; i < gx.length; i++) {
        best = Math.min(best, Math.hypot(this.xs[n]! - gx[i]!, this.zs[n]! - gz[i]!));
      }
      return best;
    };
    const g = new Map<number, number>([[from, 0]]);
    const came = new Map<number, { from: number; ladder?: NavLadder; up?: boolean }>();
    const heap = new Heap();
    heap.push(from, h(from));
    const closed = new Set<number>();
    let found: number | null = null;
    let expanded = 0;
    while (heap.size) {
      const n = heap.pop();
      if (closed.has(n)) continue;
      if (goalSet.has(n)) {
        found = n;
        break;
      }
      closed.add(n);
      if (++expanded > 60000) break;
      const gn = g.get(n)!;
      for (const l of this.links[n]!) {
        if (closed.has(l.to)) continue;
        const cost = gn + l.cost + (avoid ? avoid(l.to) : 0);
        if (cost < (g.get(l.to) ?? Infinity)) {
          g.set(l.to, cost);
          came.set(l.to, { from: n, ladder: l.ladder, up: l.up });
          heap.push(l.to, cost + h(l.to));
        }
      }
    }
    if (found === null) return null;
    const out: Waypoint[] = [];
    for (let n = found; n !== from;) {
      const c = came.get(n)!;
      const w: Waypoint = { pos: this.pos(n), node: n };
      if (c.ladder) w.ladder = { def: c.ladder.ladder, up: c.up! };
      out.push(w);
      n = c.from;
    }
    out.reverse();
    return out;
  }

  /**
   * Whether a straight walk from `a` to `b` stays on the map, on one floor (no gaps, no steps
   * too high), so a walker can cut straight across instead of following the grid.
   */
  straight(a: Vec3, b: Vec3): boolean {
    if (Math.abs(a.y - b.y) > 3) return false;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / (NAV_CELL * 0.5)));
    let y = a.y;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const expect = a.y + (b.y - a.y) * t;
      const i = Math.floor((x - this.x0) / NAV_CELL);
      const k = Math.floor((z - this.z0) / NAV_CELL);
      if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return false;
      let next: number | null = null;
      for (const n of this.columns[i * this.nz + k]!) {
        const h = this.ys[n]!;
        if (Math.abs(h - y) <= STEP && Math.abs(h - expect) <= 0.45 && this.reachable(n)) next = h;
      }
      if (next === null) return false;
      y = next;
    }
    return Math.abs(y - b.y) <= 0.35;
  }
}

/** A binary min-heap of node ids by priority. */
class Heap {
  private ids: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up]! <= p) break;
      ids[i] = ids[up]!;
      pri[i] = pri[up]!;
      i = up;
    }
    ids[i] = id;
    pri[i] = p;
  }

  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= ids.length) break;
        const r = l + 1;
        const c = r < ids.length && pri[r]! < pri[l]! ? r : l;
        if (pri[c]! >= lastP) break;
        ids[i] = ids[c]!;
        pri[i] = pri[c]!;
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
