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
import { DT, seconds } from './time.ts';

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
/** The least time between its everyday barks (being chased, a full-handed click). */
const BARK_GAP_SECONDS = 6;

/** What the dog is doing, as sent to clients (by index). */
export const DOG_MODES = ['walk', 'sit', 'run', 'beg', 'follow', 'fetch', 'jump', 'pat'] as const;
export type DogMode = (typeof DOG_MODES)[number];

/** A page pinned low enough on the corkboard for the dog to jump up and take. */
export interface StealTarget {
  page: PageItem;
  /** Where on the floor it stands to jump for it. */
  stand: Vec3;
}

/** How long it waits between trips to the corkboard while nobody feeds it. */
const STEAL_TICKS = seconds(60);
/** Unfed this long, it goes and wrecks part of the build at the job site. */
export const WRECK_HUNGER_TICKS = seconds(180);

/** Where the hungry dog goes to wreck the build, and what it goes for there. */
export interface WreckTarget {
  /** Where on the floor it stands, by the baseplate. */
  stand: Vec3;
  /** The middle of the bricks it can reach from there. */
  look: Vec3;
  /** Whose job site's build it is. */
  site: number;
}

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
  /** Whether it may wreck the build now (only while building, and not near the end). */
  mayWreck(): boolean;
  /** Where to stand to wreck the build from `from`'s side, or null if there is nothing to wreck. */
  wreckTarget(from: Vec3): WreckTarget | null;
  /** Knocks the bricks within its reach off the build. Returns whether any came off. */
  wreck(at: WreckTarget): boolean;
  /** Takes a lying (or pinned) page into the dog's mouth. */
  pickPageUp(page: PageItem): void;
  /** Puts a page from the dog's mouth down on the floor at `pos`. */
  putPageDown(page: PageItem, pos: Vec3, yaw: number): void;
  /**
   * Whether nothing solid lies between two points (walls, furniture). With `wide`, nothing
   * either side of the line either, as far out as the dog's flanks: room for it to walk there.
   */
  clearLine(a: Vec3, b: Vec3, wide?: boolean): boolean;
}

/**
 * The house dog. It wanders between the level's dog points, sits now and then, and picks up
 * pages left on the floor to carry around for a while before dropping them somewhere else.
 * Every minute nobody feeds it, it jumps up at the corkboard and steals a page from its bottom
 * row; after three minutes without a treat it goes and knocks part of the build off the
 * baseplate (never late in a round). A treat resets both. Whatever it carries, it puts down on one of its dog points, which
 * players can always get to.
 * It runs from anyone sprinting at it (but a sprinter is faster), drops its page when someone
 * grabs its collar, begs from anyone holding a treat, and follows whoever feeds it one. Clicked
 * by someone with empty hands, it comes and sits in front of them to be patted.
 *
 * On a client the dog is only a body posed from snapshots, for aiming and bumping into.
 */
export class Dog {
  readonly body: RigidBody;
  readonly collider: Collider;
  private readonly controller: KinematicCharacterController;
  yaw = 0;
  mode: DogMode = 'sit';
  /**
   * The page in its mouth: the one place that says so (the page itself, carried by nobody,
   * is out of the world while it is here).
   */
  page: number | null = null;
  /** The player patting it, once it sits in front of them (sent to clients, to pose both). */
  patBy: number | null = null;
  /** Leashed to the pole by its kennel (Gear Hunt): it sits there for the rest of the round. */
  leashed = false;

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
  /** Ticks since it was last fed (or last wrecked the build). */
  private hunger = 0;
  /** The build it is on its way to wreck. */
  private wrecking: (WreckTarget & { jump: number }) | null = null;
  /** Ticks since it should have put its page down (it waits until it is on a dog point). */
  private overdue = 0;
  private runTicks = 0;
  /** Ticks until an everyday bark may sound again. */
  private barkCooldown = 0;
  private follow: { id: number; ticks: number } | null = null;
  private pat: { id: number; ticks: number; settled: boolean } | null = null;
  /**
   * Where it is ultimately going, which `target` is the next step to (the same place when it
   * heads straight there), and how far it still has to walk from `target` to get there.
   */
  private goal: Vec3 | null = null;
  private beyond = 0;
  /**
   * Getting nowhere: the shortest walk it has had left to its goal, and for how long it has not
   * got any shorter. Measured to the goal rather than to the next dog point, so taking a new
   * route there does not count as headway.
   */
  private best = Infinity;
  private stuck = 0;
  /**
   * How many more times it may set off a new way round to the same goal and count from there
   * afresh: the new way can be longer than the one it gave up on without being any less good.
   * Only a few times, though, or going round in circles would never count as getting nowhere.
   */
  private detours = 0;
  /** It gave up on where it was going and is walking back onto its nearest dog point. */
  private lost = false;

  constructor(
    private readonly host: DogHost,
    private readonly def: DogDef,
    groups: number,
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
    this.stealTimer = STEAL_TICKS;
  }

  /** Ticks until it next goes for the corkboard (it counts down only while its mouth is empty). */
  get ticksToSteal(): number {
    return this.stealTimer;
  }

  /** Ticks since it was last fed (or last wrecked the build). */
  get ticksHungry(): number {
    return this.hunger;
  }

  /** Makes it as hungry as three minutes without a treat, so it goes for the build (demo mode). */
  starve(): void {
    this.hunger = Math.max(this.hunger, WRECK_HUNGER_TICKS);
    this.wait = 0;
  }

  /** Sends it off to the corkboard right away (demo mode, tests). */
  stealSoon(): void {
    this.stealTimer = 0;
    this.wait = 0;
  }

  /** Has it sit where it is until `resume` (unless something more exciting comes along). */
  park(): void {
    this.wait = Infinity;
  }

  /** Gets it up from sitting, to be on its way at once. */
  resume(): void {
    this.wait = 0;
  }

  /** Sends it off to wreck the build from `at` (as when hunger sends it; tests). */
  goWreck(at: WreckTarget): void {
    this.wrecking = { ...at, jump: 0 };
    this.targetPage = null;
    this.cancelSteal();
  }

  /** Where it is on its way to wreck the build, and its jump once there (0 until then). */
  get wreck(): Readonly<WreckTarget & { jump: number }> | null {
    return this.wrecking;
  }

  /** The dog's paws: the floor under it. */
  get feet(): Vec3 {
    return sub(this.body.translation(), v3(0, BODY_Y, 0));
  }

  /**
   * Puts it on the leash at `pole`: it drops what it carries, sits by the pole and steals,
   * fetches and wrecks nothing any more.
   */
  leash(pole: Vec3): void {
    this.leashed = true;
    this.cancelSteal();
    this.wrecking = null;
    this.targetPage = null;
    this.follow = null;
    this.pat = null;
    this.runTicks = 0;
    if (this.page !== null) this.dropPage(seconds(30));
    this.setTarget(v3(pole.x, this.feet.y, pole.z), null);
    this.host.emit({ kind: 'bark', pos: this.feet });
  }

  /** One tick of being a dog. */
  update(): void {
    if (this.leashed) {
      // On the leash: walks to the pole once, then sits there (a treat still goes down well).
      this.mode = this.target ? 'walk' : 'sit';
      this.patBy = null;
      this.move(WALK_SPEED);
      return;
    }
    if (this.fetchCooldown > 0) this.fetchCooldown--;
    if (this.barkCooldown > 0) this.barkCooldown--;
    if (this.page !== null && --this.carry <= 0) this.putDownSoon();
    if (this.page === null && this.steal === null && this.stealTimer > 0) this.stealTimer--;
    if (this.wrecking === null) this.hunger++;
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
      this.cancelWreck();
      this.fleeFrom(chaser);
      this.barkNowAndThen(pos);
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
    } else if (this.wrecking?.jump) {
      this.mode = 'jump';
      this.target = null;
      if (--this.wrecking.jump === 0) this.knockOver();
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
    } else if (this.wrecking) {
      this.mode = 'fetch';
      this.headForWreck();
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
      if (this.page === null && this.hunger >= WRECK_HUNGER_TICKS) this.lookForWreck();
      if (this.page === null && this.wrecking === null && this.stealTimer === 0) {
        this.lookForSteal();
      }
      if (this.page === null && this.steal === null && this.fetchCooldown === 0) {
        this.lookForPages();
      }
      if (!this.wrecking && !this.steal && this.targetPage === null && !this.target) this.wander();
    }
    this.move(speed);
  }

  /**
   * Someone clicked the dog: a treat makes a friend, a grab at its collar makes it let go of its
   * page, and empty hands pat it.
   */
  clicked(p: Player): void {
    const pos = this.feet;
    if (this.leashed) {
      if (p.treat) {
        p.treat = false;
        this.host.emit({ kind: 'crunch', pos, playerId: p.id });
      } else this.barkNowAndThen(pos, p.id);
      return;
    }
    if (p.treat) {
      p.treat = false;
      if (this.page !== null) this.dropPage(seconds(30), p.body.translation());
      this.follow = { id: p.id, ticks: seconds(20) };
      this.runTicks = 0;
      this.cancelSteal();
      this.wrecking = null;
      this.stealTimer = STEAL_TICKS;
      this.hunger = 0;
      this.host.emit({ kind: 'crunch', pos, playerId: p.id });
    } else if (this.page !== null) {
      this.dropPage(seconds(30));
      this.runTicks = seconds(1.5);
      this.fleeFrom(p);
      this.host.emit({ kind: 'yelp', pos, playerId: p.id });
    } else if (p.holding) {
      this.barkNowAndThen(pos, p.id);
    } else {
      // Being patted beats going after the corkboard or the build (but it stays hungry).
      this.cancelSteal();
      this.cancelWreck();
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

  /**
   * A bark that tells nobody anything new (chased again, clicked again): only if it has not
   * barked like that for a while. Stealing, wrecking and the leash always bark.
   */
  private barkNowAndThen(pos: Vec3, playerId?: number): void {
    if (this.barkCooldown > 0) return;
    this.barkCooldown = seconds(BARK_GAP_SECONDS);
    this.host.emit({ kind: 'bark', pos, playerId });
  }

  /** The top of its jump: takes the page off the board, if it is still there, and runs. */
  private snatch(): void {
    const page = this.host.pages.get(this.steal!.page);
    this.steal = null;
    this.stealTimer = STEAL_TICKS;
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

  /** Hungry enough: picks a side of the build to wreck it from, if it may and there is a build. */
  private lookForWreck(): void {
    const at = this.host.mayWreck() ? this.host.wreckTarget(this.feet) : null;
    if (at) this.goWreck(at);
    else {
      this.hunger = WRECK_HUNGER_TICKS - seconds(10);
    }
  }

  /** On its way to the build: gives up if it may no longer wreck it (the round is nearly over). */
  private headForWreck(): void {
    const w = this.wrecking!;
    if (!this.host.mayWreck()) {
      this.cancelWreck();
      return;
    }
    this.head(w.stand);
    if (length(flat(sub(w.stand, this.feet))) < 0.25) {
      this.target = null;
      this.path = [];
      this.faceTowards(w.look);
      w.jump = JUMP_TICKS;
    }
  }

  /** The top of its jump at the build: knocks off what it can reach, barks and runs. */
  private knockOver(): void {
    const w = this.wrecking!;
    this.wrecking = null;
    // Even if nothing came off, it has had its go: three more minutes before the next one.
    this.hunger = 0;
    if (this.host.mayWreck()) this.host.wreck(w);
    this.host.emit({ kind: 'bark', pos: this.feet });
    this.at = this.nearestPoint(this.feet);
    this.runTicks = seconds(2);
    this.wander();
  }

  /** Forgets about the build for now (still hungry), and tries again a little later. */
  private cancelWreck(): void {
    if (!this.wrecking) return;
    this.wrecking = null;
    this.hunger = Math.min(this.hunger, WRECK_HUNGER_TICKS - seconds(20));
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

  /** Heads straight for `t` (a dog point, if `point` is one), forgetting any route it was on. */
  private setTarget(t: Vec3, point: number | null): void {
    this.path = [];
    this.pathGoal = null;
    this.aim(t, point, t, 0);
  }

  /**
   * Takes `t` as the next place to walk to on the way to `goal`, with `beyond` still to walk from
   * there. A goal that moves (someone it follows walking on) starts its count of getting nowhere
   * afresh; a new step on the way to the same goal does not.
   */
  private aim(t: Vec3, point: number | null, goal: Vec3, beyond: number): void {
    if (!this.target || !this.goal || length(flat(sub(goal, this.goal))) > 0.5) {
      this.best = Infinity;
      this.stuck = 0;
      this.detours = 2;
      this.lost = false;
    }
    this.target = t;
    this.targetPoint = point;
    this.goal = goal;
    this.beyond = beyond;
  }

  private move(speed: number): void {
    const pos = this.feet;
    let step = v3();
    if (this.target) {
      const d = flat(sub(this.target, pos));
      const dist = length(d);
      const left = dist + this.beyond;
      if (dist < 0.15) this.arrive();
      else {
        step = scale(d, Math.min(speed * DT, dist) / dist);
        this.yaw = Math.atan2(-d.x, -d.z);
      }
      if (left < this.best - 0.2) {
        this.best = left;
        this.stuck = 0;
      } else if (++this.stuck > seconds(3)) this.giveUp(pos);
    }
    if (this.controller.computedGrounded() && this.vy <= 0) this.vy = 0;
    else this.vy -= GRAVITY * DT;
    const desired = v3(step.x, this.vy * DT, step.z);
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    if (this.controller.computedGrounded() && this.vy < 0) this.vy = 0;
    this.body.setNextKinematicTranslation(add(this.body.translation(), m));
  }

  /**
   * Three seconds without getting any nearer its goal (wedged on a corner, a crowd in the way):
   * it gives up on what it was after and walks back onto its nearest dog point. If it gets
   * nowhere on that walk either, it hops onto the point, the last resort that means it is never
   * stuck anywhere for good.
   */
  private giveUp(pos: Vec3): void {
    this.targetPage = null;
    this.cancelSteal();
    this.cancelWreck();
    this.fetchCooldown = Math.max(this.fetchCooldown, seconds(10));
    const point = this.nearestPoint(pos);
    const p = this.def.points[point]!;
    if (this.lost) {
      this.body.setTranslation(add(p, v3(0, BODY_Y, 0)), true);
      this.collider.setTranslation(add(p, v3(0, BODY_Y, 0)));
    }
    this.at = point;
    // Counted afresh even if that point was where it was going already.
    this.target = null;
    this.setTarget(p, point);
    this.lost = true;
  }

  /** At its target: on to the next step if that was only a stop on the way, else done. */
  private arrive(): void {
    if (this.targetPoint !== null) {
      this.previous = this.at;
      this.at = this.targetPoint;
      if (this.path[0] === this.targetPoint) this.path.shift();
    }
    if (this.beyond > 0 && this.goal) this.aimAlong(this.goal);
    else {
      this.target = null;
      this.targetPoint = null;
    }
  }

  /**
   * Heads for `goal`: straight there if nothing is in the way, otherwise along the dog points,
   * from the nearest one it can see to the nearest one that can see the goal. Once on its way
   * along them, it cuts across to the goal only while it is getting nearer to it, rather than
   * whenever the goal comes into view: pressed against a corner, it could otherwise see the
   * goal one moment and not the next, and turn back and forth between it and a dog point for
   * ever, never getting anywhere and never giving up.
   */
  private head(goal: Vec3): void {
    const pos = this.feet;
    const onRoute =
      this.path.length > 0 && !!this.pathGoal && length(flat(sub(this.pathGoal, goal))) <= 1;
    if (!onRoute || this.stuck === 0) {
      if (this.host.clearLine(raised(pos), raised(goal), true)) {
        this.path = [];
        this.pathGoal = goal;
      } else if (!onRoute) {
        this.path = this.route(pos, goal);
        this.pathGoal = goal;
        if (this.path.length && this.target && this.detours > 0) {
          this.detours--;
          this.best = Infinity;
        }
      }
    }
    this.aimAlong(goal);
  }

  /** Aims at the next dog point on its route to `goal`, or at the goal once past them all. */
  private aimAlong(goal: Vec3): void {
    const points = this.def.points;
    const next = this.path[0];
    if (next === undefined) {
      this.aim(goal, null, goal, 0);
      return;
    }
    let beyond = 0;
    for (let i = 1; i < this.path.length; i++) {
      beyond += length(flat(sub(points[this.path[i]!]!, points[this.path[i - 1]!]!)));
    }
    beyond += length(flat(sub(goal, points[this.path[this.path.length - 1]!]!)));
    this.aim(points[next]!, next, goal, beyond);
  }

  /** The dog points to pass from `from` to `to` (shortest walk through the links). */
  private route(from: Vec3, to: Vec3): number[] {
    const points = this.def.points;
    const seen = (p: Vec3) =>
      points
        .map((q, i) => ({ i, d: length(flat(sub(q, p))) }))
        .sort((a, b) => a.d - b.d)
        .find(({ i }) => this.host.clearLine(raised(p), raised(points[i]!), true))?.i;
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
