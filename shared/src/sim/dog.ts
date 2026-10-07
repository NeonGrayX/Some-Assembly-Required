import type RAPIER from '@dimforge/rapier3d-compat';
import type {
  Collider,
  KinematicCharacterController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import type { DogDef } from '../content/house.ts';
import { add, length, scale, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import type { PageItem, Player, SimEvent } from './sim.ts';

/** The dog's id: pages it carries name it as their carrier, like a player's. */
export const DOG_ID = 1_000_000;
export const DOG_RADIUS = 0.22;
export const DOG_HALF_HEIGHT = 0.12;
/** Height of the dog's middle above its paws. */
const BODY_Y = DOG_RADIUS + DOG_HALF_HEIGHT;
const WALK_SPEED = 1.6;
/** Faster than walking, slower than sprinting: a sprinting player can catch it. */
const RUN_SPEED = 4.6;
const BEG_SPEED = 2.4;
const GRAVITY = 15;
/** Players this close who sprint send it running. */
const FLEE_RANGE = 3.5;
/** It smells a treat in someone's hand from this far. */
const BEG_RANGE = 8;
/** Loose pages on the floor this close catch its eye. */
const FETCH_RANGE = 4;
/** Anyone this close to a pinned page keeps the dog from stealing it. */
const GUARD_RANGE = 2.5;
/** How long its jump up at the corkboard takes. */
const JUMP_TICKS = 36;
/** How long one click of patting lasts (clicking again keeps it going). */
const PAT_SECONDS = 3;
/** Where it sits to be patted: in front of the player and a little to one side, by a hand. */
const PAT_AHEAD = 0.5;
const PAT_SIDE = 0.36;
/** Up against the player (their radius and its own, and a little): it can get no closer. */
const PAT_SPOT_CLOSE = 0.75;
/** Close enough to that spot to sit down and be patted, and far enough off it to get up again. */
const PAT_SETTLE = 0.3;
const PAT_LEAVE = 0.55;

const DT = 1 / 60;
const seconds = (s: number) => Math.round(s * 60);

/** What the dog is doing, as sent to clients (by index). */
export const DOG_MODES = ['walk', 'sit', 'run', 'beg', 'follow', 'fetch', 'jump', 'pat'] as const;
export type DogMode = (typeof DOG_MODES)[number];

/** A page pinned low enough on the corkboard for the dog to jump up and take. */
export interface StealTarget {
  page: PageItem;
  /** Where on the floor it stands to jump for it. */
  stand: Vec3;
}

/** A fresh wait before the dog next goes for the corkboard: two to four minutes. */
const stealDelay = (random: () => number) => seconds(120 + random() * 120);

/** What the dog needs from the simulation it lives in. */
export interface DogHost {
  readonly R: typeof RAPIER;
  readonly world: World;
  readonly players: Map<number, Player>;
  readonly pages: Map<number, PageItem>;
  /** Reports something that happened (a bark), for sounds. */
  emit(e: SimEvent): void;
  random(): number;
  /** Pinned pages it could steal from the corkboard, with where to stand for each. */
  stealTargets(): StealTarget[];
  /** Takes a lying (or pinned) page into the dog's mouth. */
  pickPageUp(page: PageItem): void;
  /** Puts a page from the dog's mouth down on the floor at `pos`. */
  putPageDown(page: PageItem, pos: Vec3, yaw: number): void;
  /** Whether nothing solid lies between two points (walls, furniture). */
  clearLine(a: Vec3, b: Vec3): boolean;
}

/**
 * The house dog. It wanders between the level's dog points, sits now and then, and picks up
 * pages left on the floor to carry around for a while before dropping them somewhere else.
 * Every two to four minutes it jumps up at the corkboard and steals a page from its bottom row
 * (a treat resets that wait). Whatever it carries, it puts down on one of its dog points, which
 * players can always get to.
 * It runs from anyone sprinting at it (but a sprinter is faster), drops its page when someone
 * grabs its collar, begs from anyone holding a treat, and follows whoever feeds it one. Clicked
 * by someone with empty hands, it comes and sits in front of them to be patted.
 *
 * On a client the dog is only a body posed from snapshots, for aiming and bumping into.
 */
export class Dog {
  readonly id = DOG_ID;
  readonly body: RigidBody;
  readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  yaw = 0;
  mode: DogMode = 'sit';
  /** The page in its mouth. */
  page: number | null = null;
  /** The player patting it, once it sits in front of them (sent to clients, to pose both). */
  patBy: number | null = null;

  private vy = 0;
  /** Where it is heading, and the dog point that is, if any. */
  private target: Vec3 | null = null;
  private targetPoint: number | null = null;
  private targetPage: number | null = null;
  /** Dog points still to pass on the way to a goal it cannot see from here. */
  private path: number[] = [];
  private pathGoal: Vec3 | null = null;
  /** The dog point it last reached (or is nearest to). */
  private at: number;
  private previous: number | null = null;
  private wait = 0;
  private carry = 0;
  private fetchCooldown = seconds(10);
  /** Ticks until it next goes for the corkboard. */
  private stealTimer: number;
  /** The pinned page it is on its way to steal, and where it will jump for it. */
  private steal: { page: number; stand: Vec3; jump: number } | null = null;
  private lastStolen: number | null = null;
  /** Ticks since it should have put its page down (it waits until it is on a dog point). */
  private overdue = 0;
  private runTicks = 0;
  private follow: { id: number; ticks: number } | null = null;
  private pat: { id: number; ticks: number; settled: boolean } | null = null;
  /** Getting nowhere: how close it got to the target, and for how long it has not got closer. */
  private best = Infinity;
  private stuck = 0;

  constructor(
    private readonly host: DogHost,
    private readonly def: DogDef,
    groups: number,
    replica: boolean,
  ) {
    const { R, world } = host;
    this.at = def.start;
    const p = def.points[def.start]!;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y + BODY_Y, p.z),
    );
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(DOG_HALF_HEIGHT, DOG_RADIUS).setCollisionGroups(groups),
      this.body,
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.enableAutostep(0.2, 0.1, true);
    this.controller.enableSnapToGround(0.3);
    this.stealTimer = stealDelay(host.random);
    if (replica) this.wait = Infinity;
  }

  /** Ticks until it next goes for the corkboard (it counts down only while its mouth is empty). */
  get ticksToSteal(): number {
    return this.stealTimer;
  }

  /** Sends it off to the corkboard right away (demo mode, tests). */
  stealSoon(): void {
    this.stealTimer = 0;
    this.wait = 0;
  }

  /** The dog's paws: the floor under it. */
  get feet(): Vec3 {
    return sub(this.body.translation(), v3(0, BODY_Y, 0));
  }

  /** One tick of being a dog. */
  update(): void {
    if (this.fetchCooldown > 0) this.fetchCooldown--;
    if (this.page !== null && --this.carry <= 0) this.putDownSoon();
    if (this.page === null && this.steal === null && this.stealTimer > 0) this.stealTimer--;
    const pos = this.feet;
    const players = [...this.host.players.values()].filter((p) => p.down === 0);
    const near = (p: Player) => length(flat(sub(p.body.translation(), pos)));
    const closest = (list: Player[]) =>
      list.reduce<Player | null>((a, b) => (!a || near(b) < near(a) ? b : a), null);

    const chaser = closest(
      players.filter(
        (p) =>
          near(p) < FLEE_RANGE &&
          p.input.sprint &&
          (p.input.forward !== 0 || p.input.right !== 0) &&
          p.id !== this.follow?.id,
      ),
    );
    const treat = closest(players.filter((p) => p.treat && near(p) < BEG_RANGE));
    if (this.follow && (--this.follow.ticks <= 0 || !this.host.players.has(this.follow.id))) {
      this.follow = null;
    }
    const patter = this.pat ? this.host.players.get(this.pat.id) : undefined;
    // Walking off (or falling over, or picking something up) ends a pat; then it sits a moment.
    if (
      this.pat &&
      (--this.pat.ticks <= 0 ||
        !patter ||
        patter.down > 0 ||
        patter.holding ||
        patter.input.forward !== 0 ||
        patter.input.right !== 0 ||
        near(patter) > FLEE_RANGE)
    ) {
      this.pat = null;
      this.target = null;
      this.wait = Math.max(this.wait, seconds(2));
    }
    this.patBy = null;

    let speed = WALK_SPEED;
    if (chaser && this.runTicks <= 0) {
      this.runTicks = seconds(2.5);
      this.cancelSteal();
      this.fleeFrom(chaser);
      this.host.emit({ kind: 'bark', pos });
    }
    if (this.runTicks > 0) {
      this.runTicks--;
      this.mode = 'run';
      speed = RUN_SPEED;
      if (!this.target) this.wander();
    } else if (this.steal?.jump) {
      this.mode = 'jump';
      this.target = null;
      if (--this.steal.jump === 0) this.snatch();
    } else if (this.pat && patter) {
      // Sit right under the hand of whoever is patting, facing them.
      this.mode = 'pat';
      speed = BEG_SPEED;
      const them = patter.body.translation();
      const yaw = patter.input.yaw;
      const ahead = v3(-Math.sin(yaw), 0, -Math.cos(yaw));
      // By whichever hand it is nearer (the right one if straight ahead).
      const toDog = flat(sub(pos, them));
      const across = toDog.x * Math.cos(yaw) - toDog.z * Math.sin(yaw);
      const hand = across < 0 ? -1 : 1;
      const side = v3(Math.cos(yaw) * hand, 0, -Math.sin(yaw) * hand);
      const spot = add(them, add(scale(ahead, PAT_AHEAD), scale(side, PAT_SIDE)));
      const off = length(flat(sub(spot, pos)));
      // Pushed up against them and getting no closer is close enough.
      const blocked = near(patter) < PAT_SPOT_CLOSE && this.stuck > seconds(0.5);
      this.pat.settled = off < (this.pat.settled ? PAT_LEAVE : PAT_SETTLE) || blocked;
      if (this.pat.settled) {
        this.target = null;
        this.faceTowards(them);
        this.patBy = patter.id;
      } else {
        // Coming at them head on, it would only push into their legs: round them first.
        const goal =
          near(patter) < 1.3 && Math.abs(across) < PAT_SIDE / 2
            ? add(them, scale(side, 0.8))
            : spot;
        this.head(v3(goal.x, pos.y, goal.z));
      }
    } else if (treat) {
      // Sit in front of whoever has the treat, looking up at them.
      this.mode = 'beg';
      speed = BEG_SPEED;
      const them = treat.body.translation();
      const toDog = flat(sub(pos, them));
      const d = length(toDog);
      const away = d > 1e-3 ? scale(toDog, 1 / d) : v3(0, 0, 1);
      const spot = add(them, scale(away, 0.8));
      this.head(v3(spot.x, pos.y, spot.z));
      if (length(flat(sub(spot, pos))) < 0.25) {
        this.target = null;
        this.faceTowards(them);
      }
    } else if (this.follow) {
      this.mode = 'follow';
      const them = this.host.players.get(this.follow.id)!.body.translation();
      if (near(this.host.players.get(this.follow.id)!) > 1.4) this.head(v3(them.x, pos.y, them.z));
      else this.target = null;
    } else if (this.steal) {
      this.mode = 'fetch';
      this.goSteal();
    } else if (this.targetPage !== null) {
      this.mode = 'fetch';
      this.fetch();
    } else if (this.wait > 0) {
      this.wait--;
      this.mode = 'sit';
      this.target = null;
    } else {
      this.mode = 'walk';
      if (this.page === null && this.stealTimer === 0) this.lookForSteal();
      if (this.page === null && this.steal === null && this.fetchCooldown === 0) {
        this.lookForPages();
      }
      if (this.steal === null && this.targetPage === null && !this.target) this.wander();
    }
    this.move(speed);
  }

  /**
   * Someone clicked the dog: a treat makes a friend, a grab at its collar makes it let go of its
   * page, and empty hands pat it.
   */
  clicked(p: Player): void {
    const pos = this.feet;
    if (p.treat) {
      p.treat = false;
      if (this.page !== null) this.dropPage(seconds(30), p.body.translation());
      this.follow = { id: p.id, ticks: seconds(20) };
      this.runTicks = 0;
      this.cancelSteal();
      this.stealTimer = stealDelay(this.host.random);
      this.host.emit({ kind: 'crunch', pos, playerId: p.id });
    } else if (this.page !== null) {
      this.dropPage(seconds(30));
      this.runTicks = seconds(1.5);
      this.fleeFrom(p);
      this.host.emit({ kind: 'yelp', pos, playerId: p.id });
    } else if (p.holding) {
      this.host.emit({ kind: 'bark', pos, playerId: p.id });
    } else {
      // Being patted beats going after the corkboard.
      this.cancelSteal();
      if (this.pat?.id !== p.id) this.host.emit({ kind: 'pat', pos, playerId: p.id });
      this.pat = {
        id: p.id,
        ticks: seconds(PAT_SECONDS),
        settled: this.pat?.id === p.id && this.pat.settled,
      };
    }
  }

  /**
   * Its carry is up: puts the page down if it stands on a dog point, otherwise on the next one it
   * reaches. If it gets to none for a while (following someone, say), the page goes on the
   * nearest one anyway, so it never ends up somewhere nobody can get to.
   */
  private putDownSoon(): void {
    const point = this.nearestPoint(this.feet);
    const p = this.def.points[point]!;
    if (length(flat(sub(p, this.feet))) < 0.2) this.dropPage(seconds(30));
    else if (++this.overdue > seconds(20)) this.dropPage(seconds(30), p);
  }

  /** Puts its page down and stays off pages for `cooldown` ticks. */
  private dropPage(cooldown: number, at?: Vec3): void {
    const page = this.page === null ? undefined : this.host.pages.get(this.page);
    this.page = null;
    this.overdue = 0;
    this.fetchCooldown = cooldown;
    if (!page) return;
    const pos = this.feet;
    const front = add(pos, scale(v3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), 0.35));
    const spot = at
      ? v3(at.x, pos.y, at.z)
      : this.host.clearLine(raised(pos), raised(front))
        ? front
        : pos;
    this.host.putPageDown(page, v3(spot.x, pos.y + 0.02, spot.z), this.yaw);
  }

  /** Picks a page on the corkboard to steal, if nobody is standing by it. */
  private lookForSteal(): void {
    const players = [...this.host.players.values()];
    const options = this.host
      .stealTargets()
      .filter(
        (t) =>
          t.page.id !== this.lastStolen &&
          players.every(
            (p) =>
              length(flat(sub(p.body.translation(), t.page.body!.translation()))) > GUARD_RANGE,
          ),
      );
    if (!options.length) {
      this.stealTimer = seconds(10);
      return;
    }
    const pick = options[Math.floor(this.host.random() * options.length)]!;
    this.steal = { page: pick.page.id, stand: pick.stand, jump: 0 };
    this.targetPage = null;
  }

  /** On its way to the corkboard: gives up if the page is gone or someone is guarding it. */
  private goSteal(): void {
    const steal = this.steal!;
    const page = this.host.pages.get(steal.page);
    const guarded = [...this.host.players.values()].some(
      (p) =>
        page?.body &&
        length(flat(sub(p.body.translation(), page.body.translation()))) < GUARD_RANGE,
    );
    if (!page?.body || page.pinned === null || guarded) {
      this.cancelSteal();
      return;
    }
    this.head(steal.stand);
    if (length(flat(sub(steal.stand, this.feet))) < 0.25) {
      this.target = null;
      this.path = [];
      this.faceTowards(page.body.translation());
      steal.jump = JUMP_TICKS;
    }
  }

  /** The top of its jump: takes the page off the board, if it is still there, and runs. */
  private snatch(): void {
    const page = this.host.pages.get(this.steal!.page);
    this.steal = null;
    this.stealTimer = stealDelay(this.host.random);
    if (!page?.body || page.pinned === null) return;
    const at = page.body.translation();
    this.host.pickPageUp(page);
    this.page = page.id;
    this.lastStolen = page.id;
    this.carry = seconds(20 + this.host.random() * 20);
    this.host.emit({ kind: 'page', pos: at });
    this.host.emit({ kind: 'bark', pos: this.feet });
    // Off and away from the board, back onto its walks.
    this.at = this.nearestPoint(this.feet);
    this.runTicks = seconds(2);
    this.wander();
  }

  /** Forgets about the corkboard for now, and tries again a little later. */
  private cancelSteal(): void {
    if (!this.steal) return;
    this.steal = null;
    this.stealTimer = seconds(20);
  }

  private lookForPages(): void {
    const pos = this.feet;
    let best: PageItem | null = null;
    let bestDist = FETCH_RANGE;
    for (const page of this.host.pages.values()) {
      if (!page.body || page.pinned !== null) continue;
      const t = page.body.translation();
      if (t.y > pos.y + 0.35 || t.y < pos.y - 0.3) continue;
      const d = length(flat(sub(t, pos)));
      if (d < bestDist && this.host.clearLine(add(pos, v3(0, 0.25, 0)), add(t, v3(0, 0.1, 0)))) {
        best = page;
        bestDist = d;
      }
    }
    if (best) {
      this.targetPage = best.id;
      this.setTarget(best.body!.translation(), null);
    }
  }

  private fetch(): void {
    const page = this.host.pages.get(this.targetPage!);
    if (!page?.body) {
      this.targetPage = null;
      this.target = null;
      return;
    }
    const t = page.body.translation();
    this.setTarget(t, null);
    if (length(flat(sub(t, this.feet))) < 0.45) {
      this.host.pickPageUp(page);
      this.page = page.id;
      this.carry = seconds(40 + this.host.random() * 40);
      this.targetPage = null;
      this.target = null;
      this.host.emit({ kind: 'page', pos: t });
    }
  }

  /** Picks the next dog point to walk to, or sits for a while. */
  private wander(): void {
    const pos = this.feet;
    const here = this.def.points[this.at]!;
    // Away from the network (after a fetch or a beg): back to the nearest point first.
    if (length(flat(sub(here, pos))) > 0.6) {
      this.head(here);
      return;
    }
    if (this.mode === 'walk' && this.host.random() < 0.3) {
      this.wait = seconds(2 + this.host.random() * 4);
      return;
    }
    const next = this.neighbours(this.at);
    const options = next.length > 1 ? next.filter((n) => n !== this.previous) : next;
    const pick = options[Math.floor(this.host.random() * options.length)]!;
    this.setTarget(this.def.points[pick]!, pick);
  }

  /** Heads for the dog point next to it that is farthest from `p`. */
  private fleeFrom(p: Player): void {
    const them = p.body.translation();
    this.at = this.nearestPoint(this.feet);
    const options = [this.at, ...this.neighbours(this.at)];
    const far = options.reduce((a, b) =>
      length(flat(sub(this.def.points[b]!, them))) > length(flat(sub(this.def.points[a]!, them)))
        ? b
        : a,
    );
    this.targetPage = null;
    this.setTarget(this.def.points[far]!, far);
  }

  private setTarget(t: Vec3, point: number | null): void {
    const changed = !this.target || length(flat(sub(t, this.target))) > 0.5;
    this.target = t;
    this.targetPoint = point;
    if (changed) {
      this.best = Infinity;
      this.stuck = 0;
    }
  }

  private move(speed: number): void {
    const pos = this.feet;
    let step = v3();
    if (this.target) {
      const d = flat(sub(this.target, pos));
      const dist = length(d);
      if (dist < 0.15) this.arrive();
      else {
        step = scale(d, Math.min(speed * DT, dist) / dist);
        this.yaw = Math.atan2(-d.x, -d.z);
      }
      // Getting nowhere (a wall, a crowd): give up on it, and if that does not help either,
      // hop back onto the nearest dog point.
      if (dist < this.best - 0.2) {
        this.best = dist;
        this.stuck = 0;
      } else if (++this.stuck > seconds(3)) {
        this.targetPage = null;
        this.cancelSteal();
        this.fetchCooldown = Math.max(this.fetchCooldown, seconds(10));
        const point = this.nearestPoint(pos);
        if (this.stuck > seconds(6)) {
          const p = this.def.points[point]!;
          this.body.setTranslation(add(p, v3(0, BODY_Y, 0)), true);
          this.collider.setTranslation(add(p, v3(0, BODY_Y, 0)));
        }
        this.at = point;
        this.setTarget(this.def.points[point]!, point);
        if (this.stuck > seconds(6)) this.stuck = 0;
      }
    }
    if (this.controller.computedGrounded() && this.vy <= 0) this.vy = 0;
    else this.vy -= GRAVITY * DT;
    const desired = v3(step.x, this.vy * DT, step.z);
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    if (this.controller.computedGrounded() && this.vy < 0) this.vy = 0;
    this.body.setNextKinematicTranslation(add(this.body.translation(), m));
  }

  private arrive(): void {
    if (this.targetPoint !== null) {
      this.previous = this.at;
      this.at = this.targetPoint;
      if (this.path[0] === this.targetPoint) this.path.shift();
    }
    this.target = null;
    this.targetPoint = null;
  }

  /**
   * Heads for `goal`: straight there if nothing is in the way, otherwise along the dog points,
   * from the nearest one it can see to the nearest one that can see the goal.
   */
  private head(goal: Vec3): void {
    const pos = this.feet;
    if (this.host.clearLine(raised(pos), raised(goal))) {
      this.path = [];
      this.setTarget(goal, null);
      return;
    }
    if (!this.pathGoal || length(flat(sub(this.pathGoal, goal))) > 1 || !this.path.length) {
      this.path = this.route(pos, goal);
      this.pathGoal = goal;
    }
    const next = this.path[0];
    if (next === undefined) this.setTarget(goal, null);
    else this.setTarget(this.def.points[next]!, next);
  }

  /** The dog points to pass from `from` to `to` (shortest walk through the links). */
  private route(from: Vec3, to: Vec3): number[] {
    const points = this.def.points;
    const seen = (p: Vec3) =>
      points
        .map((q, i) => ({ i, d: length(flat(sub(q, p))) }))
        .sort((a, b) => a.d - b.d)
        .find(({ i }) => this.host.clearLine(raised(p), raised(points[i]!)))?.i;
    const start = seen(from);
    const end = seen(to);
    if (start === undefined || end === undefined) return [];
    const dist = points.map(() => Infinity);
    const prev = points.map(() => -1);
    const open = new Set(points.map((_, i) => i));
    dist[start] = 0;
    while (open.size) {
      const u = [...open].reduce((a, b) => (dist[b]! < dist[a]! ? b : a));
      open.delete(u);
      if (u === end || dist[u] === Infinity) break;
      for (const v of this.neighbours(u)) {
        const d = dist[u]! + length(sub(points[u]!, points[v]!));
        if (d < dist[v]!) [dist[v], prev[v]] = [d, u];
      }
    }
    const path: number[] = [];
    for (let i = end; i !== -1; i = prev[i]!) path.unshift(i);
    return path[0] === start ? path : [];
  }

  private faceTowards(p: Vec3): void {
    const d = flat(sub(p, this.feet));
    if (length(d) > 1e-3) this.yaw = Math.atan2(-d.x, -d.z);
  }

  private neighbours(i: number): number[] {
    return this.def.links.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []));
  }

  private nearestPoint(pos: Vec3): number {
    let best = 0;
    this.def.points.forEach((p, i) => {
      if (length(flat(sub(p, pos))) < length(flat(sub(this.def.points[best]!, pos)))) best = i;
    });
    return best;
  }
}

const flat = (v: Vec3): Vec3 => v3(v.x, 0, v.z);
/** A point at the dog's eye level, for checking what is in the way. */
const raised = (v: Vec3): Vec3 => v3(v.x, v.y + 0.25, v.z);
