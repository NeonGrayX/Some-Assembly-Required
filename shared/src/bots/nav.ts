import type RAPIER from '@dimforge/rapier3d-compat';
import { STAIRS, UPPER_FLOOR, floorRect, stairsAxes } from '../content/house.ts';
import type { LadderDef } from '../content/house.ts';
import { inSea } from '../content/terrain.ts';
import { rotate, v3 } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import {
  CONTROLLER_OFFSET,
  MAX_CLIMB,
  PLAYER_FEET,
  PLAYER_GROUPS,
  PLAYER_HALF_HEIGHT,
  PLAYER_RADIUS,
  STAIRS_MARGIN,
  STAIRS_SLIDE,
} from '../sim/sim.ts';
import type { Sim } from '../sim/sim.ts';
import { makeNavCore } from './navcore.ts';
import type { NavCore } from './navcore.ts';

type Rapier = typeof RAPIER;

/** Grid spacing of the walking map, in metres. */
export const NAV_CELL = 0.25;
/** Highest step between neighbouring spots that a player walks up (the controller's autostep). */
const STEP = 0.32;
/**
 * The least a surface's normal points up for it to count as floor: a little short of the
 * steepest slope players climb, as just short of it they stall part way up.
 */
const FLOOR_NY = Math.cos(MAX_CLIMB - (5 * Math.PI) / 180);
/**
 * How much dearer a step through the sea round an island is than one on land: a player wades
 * it at a careful pace, where they would have run.
 */
const WADE = 3.5;
/** Where the downward probes start and stop. */
const TOP = 16;
const BOTTOM = -8;
/**
 * How far from the middle of a flight a player can be (see the sim's `keepOnStairs`): its
 * limit, and the one tick's slide back in that may leave them past it.
 */
const STAIRS_LIMIT = STAIRS.width / 2 - PLAYER_RADIUS - STAIRS_MARGIN + STAIRS_SLIDE;
/** How far below a player's centre the bots take their feet to be: where the controller leaves them. */
export const FEET = PLAYER_FEET + CONTROLLER_OFFSET;

/** A job site's baseplate, as walking is kept off it: where it is, and half its size and more. */
export interface Plate {
  centre: Vec3;
  /** Its rotation undone: into the plate's own frame. */
  inv: Quat;
  hw: number;
  hd: number;
}

/** What makes some spots dearer to walk over for one bot (see `Bot.costs`). */
export interface PathCosts {
  /** Spots something the map does not know of is in the way of, for now. */
  blocked: readonly number[];
  /** Where the other players are (their centres). */
  others: readonly Vec3[];
  /** Every job site's plate (null where it has none). */
  plates: readonly (Plate | null)[];
  /** Loose bricks on the floor that would trip a player up (their centres of mass). */
  loose: readonly Vec3[];
  /** The cost of a spot with one of them on it. */
  trip: number;
}

/** Whether a spot is on (or right by) one of the plates. */
export function overPlate(plates: readonly (Plate | null)[], x: number, y: number, z: number) {
  for (const pl of plates) {
    if (!pl || Math.abs(y - pl.centre.y) > 0.8) continue;
    const l = rotate(pl.inv, v3(x - pl.centre.x, 0, z - pl.centre.z));
    if (Math.abs(l.x) < pl.hw && Math.abs(l.z) < pl.hd) return true;
  }
  return false;
}

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
  /** The same searches in WebAssembly, once it is ready (see `navcore.ts`). */
  private core: NavCore | null = null;
  /** The plates last handed to `core`. */
  private corePlates: readonly (Plate | null)[] | null = null;
  /** Scratch for `path`, made on its first search. */
  private search = 0;
  private gs: Float64Array | null = null;
  private seen: Uint32Array | null = null;
  private shut: Uint32Array | null = null;
  private cameFrom: Int32Array | null = null;
  private cameLink: Int32Array | null = null;
  private readonly heap = new Heap();
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
          if (hit.normal.y > FLOOR_NY) {
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
    // Spots out in the sea, where a player wades (as the sim's `inWater` has it).
    const { sea } = sim.level;
    const wet = xs.map(
      (x, n) => sea !== undefined && ys[n]! < sea + 0.15 && inSea(sim.level, x, zs[n]!),
    );
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
              const cost = Math.hypot(di, dk) * NAV_CELL * (wet[a] || wet[b] ? WADE : 1);
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
    makeNavCore((core) => this.attach(core));
  }

  /** Copies the map into a WebAssembly instance, which does the searches from then on. */
  private attach(core: NavCore): void {
    const n = this.xs.length;
    let m = 0;
    for (const l of this.links) m += l.length;
    const cols = this.columns.length;
    const at = core.setup(n, m, cols, this.x0, this.z0, this.nx, this.nz);
    const buf = core.memory.buffer;
    const table = new Uint32Array(buf, at, 16);
    new Float32Array(buf, table[0], n).set(this.xs);
    new Float32Array(buf, table[1], n).set(this.ys);
    new Float32Array(buf, table[2], n).set(this.zs);
    new Int32Array(buf, table[3], n).set(this.part);
    const start = new Int32Array(buf, table[4], n + 1);
    const to = new Int32Array(buf, table[5], m);
    const cost = new Float64Array(buf, table[6], m);
    let k = 0;
    for (let a = 0; a < n; a++) {
      start[a] = k;
      for (const l of this.links[a]!) {
        to[k] = l.to;
        cost[k++] = l.cost;
      }
    }
    start[n] = k;
    const colStart = new Int32Array(buf, table[7], cols + 1);
    const colNodes = new Int32Array(buf, table[8], n);
    k = 0;
    for (let c = 0; c < cols; c++) {
      colStart[c] = k;
      for (const node of this.columns[c]!) colNodes[k++] = node;
    }
    colStart[cols] = k;
    core.setMain(this.main);
    this.coreViews = {
      cameFrom: new Int32Array(buf, table[9], n),
      cameLink: new Int32Array(buf, table[10], n),
      goals: new Int32Array(buf, table[11], n),
      blocked: new Int32Array(buf, table[12], n),
      others: new Float64Array(buf, table[13], 3 * core.MAX_OTHERS.value),
      plates: new Float64Array(buf, table[14], 9 * core.MAX_PLATES.value),
      loose: new Float64Array(buf, table[15], 3 * core.MAX_LOOSE.value),
    };
    this.core = core;
  }
  private coreViews: {
    cameFrom: Int32Array;
    cameLink: Int32Array;
    goals: Int32Array;
    blocked: Int32Array;
    others: Float64Array;
    plates: Float64Array;
    loose: Float64Array;
  } | null = null;

  /** Hands the plates to the WebAssembly instance, if they are not the ones it has. */
  private platesToCore(core: NavCore, plates: readonly (Plate | null)[]): boolean {
    if (plates === this.corePlates) return true;
    const v = this.coreViews!.plates;
    let count = 0;
    for (const pl of plates) {
      if (!pl) continue;
      if (count >= core.MAX_PLATES.value) return false;
      v.set(
        [
          pl.centre.x,
          pl.centre.y,
          pl.centre.z,
          pl.inv.x,
          pl.inv.y,
          pl.inv.z,
          pl.inv.w,
          pl.hw,
          pl.hd,
        ],
        count * 9,
      );
      count++;
    }
    core.setPlates(count);
    this.corePlates = plates;
    return true;
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
   * waypoints, or null if there is none. `costs` make some spots dearer to step on.
   */
  path(from: number, goals: number[], costs?: PathCosts): Waypoint[] | null {
    if (!goals.length) return null;
    const core = this.core;
    if (core && this.pathInCore(core, from, goals, costs)) return this.walkBack(from);
    const avoid = costs && this.avoid(costs);
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
    // Scratch arrays shared by every search, marked with the search's number instead of
    // cleared: a search touches a small part of a map of tens of thousands of nodes.
    const n0 = this.xs.length;
    if (!this.gs) {
      this.gs = new Float64Array(n0);
      this.seen = new Uint32Array(n0);
      this.shut = new Uint32Array(n0);
      this.cameFrom = new Int32Array(n0);
      this.cameLink = new Int32Array(n0);
    }
    const gs = this.gs;
    const seen = this.seen!;
    const shut = this.shut!;
    const cameFrom = this.cameFrom!;
    const cameLink = this.cameLink!;
    if (++this.search === 0xffffffff) {
      seen.fill(0);
      shut.fill(0);
      this.search = 1;
    }
    const mark = this.search;
    gs[from] = 0;
    seen[from] = mark;
    const heap = this.heap;
    heap.clear();
    heap.push(from, h(from));
    let found: number | null = null;
    let expanded = 0;
    while (heap.size) {
      const n = heap.pop();
      if (shut[n] === mark) continue;
      if (goalSet.has(n)) {
        found = n;
        break;
      }
      shut[n] = mark;
      if (++expanded > 60000) break;
      const gn = gs[n]!;
      const links = this.links[n]!;
      for (let li = 0; li < links.length; li++) {
        const l = links[li]!;
        const to = l.to;
        if (shut[to] === mark) continue;
        const cost = gn + l.cost + (avoid ? avoid(to) : 0);
        if (cost < (seen[to] === mark ? gs[to]! : Infinity)) {
          gs[to] = cost;
          seen[to] = mark;
          cameFrom[to] = n;
          cameLink[to] = li;
          heap.push(to, cost + h(to));
        }
      }
    }
    this.found = found;
    return this.walkBack(from, cameFrom, cameLink);
  }

  /** The goal the last search reached, or null. */
  private found: number | null = null;

  /** The way the last search found, from the goal it reached back to `from`, in order. */
  private walkBack(
    from: number,
    cameFrom = this.coreViews!.cameFrom,
    cameLink = this.coreViews!.cameLink,
  ): Waypoint[] | null {
    if (this.found === null) return null;
    const out: Waypoint[] = [];
    for (let n = this.found; n !== from;) {
      const prev = cameFrom[n]!;
      const l = this.links[prev]![cameLink[n]!]!;
      const w: Waypoint = { pos: this.pos(n), node: n };
      if (l.ladder) w.ladder = { def: l.ladder.ladder, up: l.up! };
      out.push(w);
      n = prev;
    }
    out.reverse();
    return out;
  }

  /**
   * The search in WebAssembly, leaving the goal it reached in `found`. False if what it is given
   * does not fit there (an unlikely crowd of loose bricks), for the JavaScript to do instead.
   */
  private pathInCore(
    core: NavCore,
    from: number,
    goals: number[],
    costs: PathCosts | undefined,
  ): boolean {
    const v = this.coreViews!;
    if (goals.length > v.goals.length) return false;
    if (
      costs &&
      (costs.blocked.length > v.blocked.length ||
        costs.others.length > core.MAX_OTHERS.value ||
        costs.loose.length > core.MAX_LOOSE.value ||
        !this.platesToCore(core, costs.plates))
    )
      return false;
    v.goals.set(goals);
    if (costs) {
      v.blocked.set(costs.blocked);
      costs.others.forEach((p, i) => {
        v.others[i * 3] = p.x;
        v.others[i * 3 + 1] = p.y;
        v.others[i * 3 + 2] = p.z;
      });
      costs.loose.forEach((p, i) => {
        v.loose[i * 3] = p.x;
        v.loose[i * 3 + 1] = p.y;
        v.loose[i * 3 + 2] = p.z;
      });
    }
    const found = core.path(
      from,
      goals.length,
      costs ? 1 : 0,
      costs?.blocked.length ?? 0,
      costs?.others.length ?? 0,
      costs?.loose.length ?? 0,
      costs?.trip ?? 0,
      FEET,
    );
    this.found = found < 0 ? null : found;
    return true;
  }

  /** The extra cost of stepping on each node (what `Bot.costs` describes), in JavaScript. */
  private avoid(c: PathCosts): (n: number) => number {
    const blocked = new Set(c.blocked);
    // Loose bricks by half-metre cell, keyed by a number (a string made for every cell looked
    // in, for every node a search reaches, costs more than the search).
    const cell = (cx: number, cz: number) => cx * 65536 + cz;
    const loose = new Map<number, Vec3[]>();
    for (const t of c.loose) {
      const key = cell(Math.floor(t.x / 0.5), Math.floor(t.z / 0.5));
      const list = loose.get(key);
      if (list) list.push(t);
      else loose.set(key, [t]);
    }
    const trips = (x: number, y: number, z: number): boolean => {
      const cx = Math.floor(x / 0.5);
      const cz = Math.floor(z / 0.5);
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let k = cz - 1; k <= cz + 1; k++) {
          const list = loose.get(cell(i, k));
          if (!list) continue;
          for (const t of list) {
            if (Math.abs(t.y - y) < 0.3 && Math.hypot(t.x - x, t.z - z) < 0.4) return true;
          }
        }
      }
      return false;
    };
    return (n) => {
      let cost = blocked.has(n) ? 25 : 0;
      const x = this.xs[n]!;
      const y = this.ys[n]!;
      const z = this.zs[n]!;
      for (const t of c.others) {
        if (Math.hypot(t.x - x, t.z - z) < 0.5 && Math.abs(t.y - FEET - y) < 1) cost += 1.5;
      }
      if (overPlate(c.plates, x, y, z)) cost += 40;
      if (loose.size && trips(x, y, z)) cost += c.trip;
      return cost;
    };
  }

  /** Whether walking straight from `a` to `b` goes over a plate (when `a` is not on one). */
  crossesPlate(plates: readonly (Plate | null)[], a: Vec3, b: Vec3): boolean {
    const core = this.core;
    if (core && this.platesToCore(core, plates))
      return core.crossesPlate(a.x, a.y, a.z, b.x, b.y, b.z) !== 0;
    if (overPlate(plates, a.x, a.y, a.z)) return false;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (overPlate(plates, a.x + (b.x - a.x) * t, b.y, a.z + (b.z - a.z) * t)) return true;
    }
    return false;
  }

  /**
   * Whether a straight walk from `a` to `b` stays on the map, on one floor (no gaps, no steps
   * too high), so a walker can cut straight across instead of following the grid.
   */
  straight(a: Vec3, b: Vec3): boolean {
    if (this.core) return this.core.straight(a.x, a.y, a.z, b.x, b.y, b.z) !== 0;
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

  clear(): void {
    this.ids.length = 0;
    this.pri.length = 0;
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
