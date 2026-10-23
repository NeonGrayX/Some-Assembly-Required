import type { Collider } from '@dimforge/rapier3d-compat';
import { BASEPLATE_SIZE, BRICK_TYPES } from '../bricks.ts';
import { DOG_RADIUS } from './dog.ts';
import type { DogHost, WreckTarget } from './dog.ts';
import { groundHeight } from '../content/terrain.ts';
import { add, length, scale, sub, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { PAGE_SIZE, restingOn } from './body.ts';
import type { Sim, ColliderOwner } from './sim.ts';

/** How far out from the baseplate's edge the hungry dog stands to wreck the build. */
const WRECK_STAND_OUT = 0.25;
/**
 * Bricks whose middle is this close to where it stands (flat), and this low, it knocks off: about
 * the near half of the baseplate.
 */
const WRECK_REACH = 1.1;
const WRECK_HEIGHT = 0.95;
/** Half the thickness of the plank `clearForDog` sweeps across the dog's width. */
const DOG_PLANK = 0.005;
/** How long the pieces are that `clearForDog` follows the terrain in. */
const DOG_PIECE = 0.75;
/** The steepest ground the dog is sent over, as its rise over its run (about 38°). */
export const DOG_STEEPEST = 0.78;
/** What the dog cannot walk or see through. */
const DOG_SOLID: ReadonlySet<ColliderOwner['kind']> = new Set<ColliderOwner['kind']>([
  'static',
  'carDoor',
  'hideout',
  'machine',
  'board',
  'button',
  'catapult',
]);

/**
 * The world as the house dog meets it (see `Dog`, which is told it through `DogHost`): whether
 * its way somewhere is clear, the build's bricks within its reach when it is hungry, knocking
 * them off, and the pages it steals. Part of the `Sim`.
 */
export class DogWorld {
  constructor(private readonly sim: Sim) {}

  /** What the dog may do to the world: carry pages, and look around for walls. */
  dogHost(): DogHost {
    return {
      R: this.sim.R,
      world: this.sim.world,
      players: this.sim.players,
      pages: this.sim.pages,
      emit: (e) => this.sim.events.push(e),
      random: () => this.sim.rng(),
      stealTargets: () => this.sim.pageWork.stealTargets(),
      mayWreck: () => this.sim.dogMayWreck,
      wreckTarget: (from) => this.wreckTarget(from),
      wreck: (at) => this.dogWreck(at),
      pickPageUp: (page) => {
        this.sim.pageWork.detachPage(page);
        page.version++;
      },
      putPageDown: (page, pos, yaw) => {
        this.sim.pageWork.placePage(page, restingOn(pos, PAGE_SIZE), yawQuat(yaw));
        page.version++;
      },
      clearLine: (a, b, wide) => this.clearForDog(a, b, wide),
      floorUnder: (x, z, y) =>
        this.sim.level.terrain?.length ? groundHeight(this.sim.level, x, z) : y,
    };
  }

  /**
   * Whether nothing solid (walls, furniture, bins) lies between two points, for the dog; with
   * `wide`, across its whole width too, so a gap a thin line slips through but the dog does not,
   * a post it would walk into, or a corner it would brush, does not count as clear.
   */
  clearForDog(a: Vec3, b: Vec3, wide = false): boolean {
    if (!this.sim.level.terrain?.length) return this.clearStraight(a, b, wide);
    // Over terrain, the line follows the ground at the height it starts and ends over it, in
    // short pieces, so a rise between the two points neither blocks it (the dog sees and walks
    // over a hump) nor lets it float over what stands in a hollow; and walking, the ground
    // must not be too steep for the dog anywhere on the way.
    const ga = groundHeight(this.sim.level, a.x, a.z);
    const gb = groundHeight(this.sim.level, b.x, b.z);
    const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DOG_PIECE));
    let from = a;
    let groundFrom = ga;
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const ground = groundHeight(this.sim.level, x, z);
      const to = v3(x, ground + (a.y - ga) * (1 - t) + (b.y - gb) * t, z);
      const run = Math.hypot(x - from.x, z - from.z);
      if (wide && Math.abs(ground - groundFrom) > run * DOG_STEEPEST) return false;
      if (!this.clearStraight(from, to, wide)) return false;
      from = to;
      groundFrom = ground;
    }
    return true;
  }

  /** `clearForDog` along one straight line. */
  private clearStraight(a: Vec3, b: Vec3, wide: boolean): boolean {
    const d = sub(b, a);
    const dist = length(d);
    if (dist < 1e-3) return true;
    const dir = scale(d, 1 / dist);
    const flat = Math.hypot(dir.x, dir.z);
    // Walking, the job sites' builds are in the way too: it goes round them, not into them.
    const builds = wide
      ? new Set(
          this.sim.sites
            .map((_, i) => this.sim.build(i))
            .filter((a) => a.anchored)
            .map((a) => a.id),
        )
      : null;
    const solid = (c: Collider) => {
      const o = this.sim.owners.get(c.handle);
      if (!o) return false;
      if (o.kind === 'brick') return builds?.has(o.assemblyId) ?? false;
      return DOG_SOLID.has(o.kind);
    };
    if (!wide || flat < 1e-3)
      return !this.sim.world.castRay(
        new this.sim.R.Ray(a, dir),
        dist,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        solid,
      );
    // A thin plank as wide as the dog, square across the way it goes, swept along it: every
    // line its body would follow at once, at the height of the points.
    // Its long side (x) turned square across `dir`.
    const across = Math.atan2(dir.x, dir.z);
    return !this.sim.world.castShape(
      a,
      yawQuat(across),
      dir,
      new this.sim.R.Cuboid(DOG_RADIUS, DOG_PLANK, DOG_PLANK),
      0,
      dist,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      solid,
    );
  }

  /** A job-site build's bricks the dog could knock off, with where each one is. */
  private wreckableBricks(site: number): { id: number; pos: Vec3 }[] {
    const a = this.sim.build(site);
    if (!a.anchored || a.heldBy !== null || a.frozen) return [];
    return [...a.grid.bricks.values()]
      .filter((b) => !BRICK_TYPES[b.type].fixture)
      .map((b) => ({ id: b.id, pos: this.sim.brickPose(a, b).pos }))
      .filter((b) => b.pos.y < this.sim.sites[site]!.baseplate.y + WRECK_HEIGHT);
  }

  /**
   * Where the hungry dog stands to wreck the build: just off one side of the baseplate, the side
   * with the most bricks in its reach (the one nearest `from` if several tie), and clear of bins.
   */
  wreckTarget(from: Vec3): WreckTarget | null {
    let best: { at: WreckTarget; n: number; d: number } | null = null;
    for (let site = 0; site < this.sim.sites.length; site++) {
      const found = this.siteWreckTarget(site, from);
      if (found && (!best || found.n > best.n || (found.n === best.n && found.d < best.d))) {
        best = found;
      }
    }
    return best?.at ?? null;
  }

  private siteWreckTarget(
    site: number,
    from: Vec3,
  ): { at: WreckTarget; n: number; d: number } | null {
    const bricks = this.wreckableBricks(site);
    if (!bricks.length) return null;
    const c = this.sim.buildCentre(this.sim.build(site));
    const out = BASEPLATE_SIZE / 2 + WRECK_STAND_OUT;
    const floor = this.sim.sites[site]!.baseplate.y;
    let best: { at: WreckTarget; n: number; d: number } | null = null;
    for (let k = 0; k < 4; k++) {
      const dir = v3(Math.sin((k * Math.PI) / 2), 0, Math.cos((k * Math.PI) / 2));
      const stand = v3(c.x + dir.x * out, floor, c.z + dir.z * out);
      const beyond = add(stand, scale(dir, 0.3));
      const up = (p: Vec3) => v3(p.x, floor + 0.25, p.z);
      if (!this.clearForDog(up(c), up(beyond))) continue;
      const reach = bricks.filter(
        (b) => Math.hypot(b.pos.x - stand.x, b.pos.z - stand.z) < WRECK_REACH,
      );
      if (!reach.length) continue;
      const look = scale(
        reach.reduce((s, b) => add(s, b.pos), v3()),
        1 / reach.length,
      );
      const d = Math.hypot(stand.x - from.x, stand.z - from.z);
      if (!best || reach.length > best.n || (reach.length === best.n && d < best.d)) {
        best = { at: { stand, look, site }, n: reach.length, d };
      }
    }
    return best;
  }

  /**
   * The hungry dog's paws on the build: every brick in its reach comes off whatever holds it
   * up (taking what sits on it along), and is knocked away from the dog.
   */
  dogWreck(at: WreckTarget): boolean {
    const a = this.sim.build(at.site);
    const near = new Set(
      this.wreckableBricks(at.site)
        .filter((b) => Math.hypot(b.pos.x - at.stand.x, b.pos.z - at.stand.z) < WRECK_REACH)
        .map((b) => b.id),
    );
    if (!near.size) return false;
    const broken = a.grid.connections().filter((c) => near.has(c.upper));
    const pieces = this.sim.resplit(a, broken);
    const away = sub(at.look, at.stand);
    const len = Math.hypot(away.x, away.z) || 1;
    const push = v3((away.x / len) * 1.2, 1, (away.z / len) * 1.2);
    for (const piece of pieces) piece.body.setLinvel(push, true);
    if (pieces.length) this.sim.events.push({ kind: 'break', pos: at.look });
    return pieces.length > 0;
  }
}
