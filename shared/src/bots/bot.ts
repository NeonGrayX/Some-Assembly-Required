import { BRICK_TYPES, PLATE_H, STUD, footprint } from '../bricks.ts';
import { faceVector, partBox } from '../parts.ts';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import { sameCells } from '../builds/match.ts';
import { printKey } from '../builds/types.ts';
import type { Prints, TargetBrick } from '../builds/types.ts';
import { levelBoards, levelSites, machineFront, machinePose } from '../content/house.ts';
import type { Placement } from '../grid.ts';
import { add, conj, length, makeRng, rotate, scale, sub, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import { WITNESS_RANGE } from '../round.ts';
import type { SabotageTool } from '../round.ts';
import { EYE_OFFSET, PLAYER_FEET, TICK_RATE, isLooseBrick } from '../sim/sim.ts';
import type {
  Action,
  Assembly,
  ColliderOwner,
  MachineState,
  Player,
  SimEvent,
} from '../sim/sim.ts';
import { ACTIONS_PER_SECOND, ACTION_BURST } from '../net/protocol.ts';
import type { Waypoint } from './nav.ts';
import type { Skill, BotLevel } from './skill.ts';
import type { Squad, Team } from './squad.ts';

/** A job, run a tick at a time: yields once per tick, returns whether it worked. */
type Job<T = boolean> = Generator<void, T>;

/** Something to click on: where it is, and what the aim must land on. */
interface Target {
  key: string;
  point(): Vec3 | null;
  ok(o: ColliderOwner): boolean;
}

/** A brick of the build to put in place, with the step it belongs to. */
type Wanted = TargetBrick & { step: number };

const MAX_PITCH = 1.45;
/** How far from the eye things can be clicked (the sim's reach, less a little). */
const REACH = 2.5;
/** Feet below a player's body centre, as the controller leaves them standing. */
const FEET = PLAYER_FEET + 0.02;

const brickKey = (b: TargetBrick) => `${b.type}|${b.x}|${b.y}|${b.z}|${b.rot}|${b.face ?? ''}`;

/** View angles to place a brick at, after how many quarter turns, and the layer aim first. */
interface PlaceAim {
  yaw: number;
  pitch: number;
  turns: number;
  lock?: { yaw: number; pitch: number };
}

/** How far it turns its view in a tick with something in hand (radians). */
const MAX_TURN = 0.06;

/** A dog unfed this long (of the three minutes before it wrecks the build) gets a treat. */
const DOG_FEED_SECONDS = 120;

/** How far a jump lifts the eye that a bot counts on to click on something (the top is ~0.8). */
const JUMP_LIFT = 0.6;

/**
 * A computer player. It plays through the same inputs and clicks a person does (walking, turning,
 * aiming, clicking), one input each tick, finding its way with the squad's walking map and
 * aiming by trying where a click would land before it clicks. Builders find and pin the pages,
 * make bricks at the brick works, put them on the build where the pages say, fix what is wrong,
 * and press Done. Saboteurs help just enough to pass, and sabotage when nobody is looking.
 */
export class Bot {
  saboteur = false;
  /** The job site (team) it builds for. */
  site = 0;
  private job: Job<unknown> | null = null;
  private jobName = '';
  private rest = 0;
  private seq = 0;
  private readonly ctl = {
    forward: 0,
    right: 0,
    jump: false,
    sprint: false,
    careful: false,
    yaw: 0,
    pitch: -0.2,
  };
  private acts: { a: Action; yaw: number; pitch: number }[] = [];
  /** Where it looks now (turning toward `ctl`'s view). */
  private readonly view = { yaw: 0, pitch: -0.2 };
  /** Clicks it may make now, as the room counts them. */
  private credits = ACTION_BURST;
  private readonly random: () => number;
  /** Things that did not work lately, by key, with the tick they may be tried again. */
  private readonly avoid = new Map<string, number>();
  /** Bricks of the build seen correct, by brick id, to notice one swapped. */
  private seenRight = new Map<number, ColourId>();
  private lastCheck = 0;
  private lastLook = 0;
  private lastSaid = -Infinity;
  private votedIn = -1;
  private voteAt = 0;
  /** Ticks into a round, so a saboteur does not strike in its first moments. */
  private roundTicks = 0;
  /** The tool cooldowns as the round reports them, read when needed. */
  private wanderAt = 0;
  /** Nodes something is in the way of, with the tick to try them again. */
  private readonly blocked = new Map<number, number>();

  constructor(
    readonly id: number,
    readonly level: BotLevel,
    readonly skill: Skill,
    private readonly squad: Squad,
    seed: number,
  ) {
    this.random = makeRng(seed * 7919 + id);
  }

  /** Drops the job in hand, letting go of what it claimed. */
  private stop(): void {
    this.job?.return(undefined as never);
    this.job = null;
  }

  /** A new world: everything it was doing is gone. */
  reset(): void {
    this.stop();
    this.jobName = '';
    this.avoid.clear();
    this.blocked.clear();
    this.seenRight.clear();
    this.roundTicks = 0;
    this.votedIn = -1;
    this.halt();
  }

  /** What it is up to, for tests and the balance report. */
  get doing(): string {
    return this.jobName;
  }

  // ---------------------------------------------------------------- each tick

  update(): void {
    const room = this.squad.game;
    const round = room.round;
    this.seq++;
    if (room.phase !== 'building' || !round) {
      this.stop();
      return;
    }
    const p = this.me();
    if (!p) return;
    this.roundTicks++;
    const role = round.role(this.id);
    this.saboteur = role === 'saboteur';
    this.site = round.rival ? round.teamOf(this.id) : 0;
    if (round.meeting) {
      this.stop();
      this.halt();
      this.meeting();
      this.send();
      return;
    }
    if (p.down > 0) {
      this.halt();
      this.send();
      return;
    }
    if (this.roundTicks % 15 === 0) this.look();
    if (!this.job) {
      if (this.rest > 0) {
        this.rest--;
        this.halt();
        this.send();
        return;
      }
      this.job = this.decide();
    }
    const step = this.job.next();
    if (step.done) {
      this.squad.trace?.(this.id, `${this.jobName || 'job'} -> ${String(step.value)}`);
      this.job = null;
      this.jobName = '';
      this.rest = this.skill.pause;
      this.halt();
    }
    this.send();
  }

  private send(): void {
    const room = this.squad.game;
    const c = this.ctl;
    // With something in hand it turns smoothly, as a hand on a mouse does: a sudden turn would
    // swing what it holds, and fling it if it lets go.
    const holding = !!this.me()?.holding;
    const turn = holding ? MAX_TURN : Math.PI * 2;
    const dyaw = Math.atan2(Math.sin(c.yaw - this.view.yaw), Math.cos(c.yaw - this.view.yaw));
    this.view.yaw += Math.max(-turn, Math.min(turn, dyaw));
    this.view.pitch += Math.max(-turn, Math.min(turn, c.pitch - this.view.pitch));
    room.handle(this.id, {
      t: 'input',
      seq: this.seq,
      f: c.forward,
      r: c.right,
      jump: c.jump,
      sprint: c.sprint,
      careful: c.careful,
      yaw: this.view.yaw,
      pitch: this.view.pitch,
      fp: true,
    });
    // Clicks are rationed as for everyone (the room drops any beyond the ration): what does not
    // fit goes next tick.
    while (this.acts.length && this.credits >= 1) {
      const { a, yaw, pitch } = this.acts.shift()!;
      room.handle(this.id, { t: 'act', a, seq: this.seq, yaw, pitch, fp: true });
      this.credits--;
    }
    this.credits = Math.min(ACTION_BURST, this.credits + ACTIONS_PER_SECOND / TICK_RATE);
    c.jump = false;
  }

  private act(a: Action, yaw = this.ctl.yaw, pitch = this.ctl.pitch): void {
    this.acts.push({ a, yaw, pitch });
  }

  /** Turns to look this way, and waits until it does (and a moment longer, to hold still). */
  private *face(yaw: number, pitch: number): Job {
    this.ctl.yaw = yaw;
    this.ctl.pitch = pitch;
    for (let k = 0; k < 40; k++) {
      const d = Math.abs(Math.atan2(Math.sin(yaw - this.view.yaw), Math.cos(yaw - this.view.yaw)));
      if (d < 1e-3 && Math.abs(pitch - this.view.pitch) < 1e-3) break;
      yield;
    }
    yield;
    yield;
    return true;
  }

  /** Waits until `n` clicks can go at once. */
  private *afford(n: number): Job {
    while (this.credits - this.acts.length < n) yield;
    return true;
  }

  private halt(): void {
    Object.assign(this.ctl, { forward: 0, right: 0, jump: false, sprint: false, careful: false });
  }

  private say(text: string): void {
    this.squad.trace?.(this.id, `says: ${text}`);
    // Only when people are there to read it, and not too often.
    if (this.squad.tick - this.lastSaid < 8 * 60) return;
    const room = this.squad.game;
    if (![...room.clients.values()].some((c) => c.connected && !c.bot)) return;
    this.lastSaid = this.squad.tick;
    room.handle(this.id, { t: 'chat', text });
  }

  // ---------------------------------------------------------------- the world

  private me(): Player | undefined {
    return this.squad.game.sim.players.get(this.id);
  }

  private get team(): Team {
    return this.squad.teams[this.site] ?? this.squad.teams[0]!;
  }

  private feet(): Vec3 {
    const p = this.me()!;
    return sub(p.body.translation(), v3(0, FEET, 0));
  }

  private eye(): Vec3 {
    return this.squad.game.sim.eye(this.me()!);
  }

  private nameOf(id: number): string {
    return this.squad.game.clients.get(id)?.name ?? 'someone';
  }

  private failed(key: string, seconds = 20): void {
    this.avoid.set(key, this.squad.tick + seconds * 60);
  }

  private avoided(key: string): boolean {
    const t = this.avoid.get(key);
    return t !== undefined && t > this.squad.tick;
  }

  /** Players other than its fellow saboteurs within `r` of a point. */
  private watchers(at: Vec3, r = WITNESS_RANGE + this.skill.caution): number {
    let n = 0;
    const round = this.squad.game.round!;
    for (const p of this.squad.game.sim.players.values()) {
      if (p.id === this.id || round.partners(this.id).includes(p.id)) continue;
      if (length(sub(p.body.translation(), at)) < r) n++;
    }
    return n;
  }

  /** Every so often: pages in view are noted, and pinned pages close by are read. */
  private look(): void {
    const sim = this.squad.game.sim;
    const round = this.squad.game.round!;
    const team = this.team;
    const eye = this.eye();
    const canRead = round.canRead(this.id);
    for (const page of sim.pages.values()) {
      if (this.skill.omniscient && page.hideout !== null) {
        team.sightings.set(page.id, {
          pos: sim.hideouts.get(page.hideout)!.def.pos,
          tick: this.squad.tick,
        });
        continue;
      }
      if (!page.body || page.carriedBy !== null) continue;
      const at = page.body.translation();
      if (sim.sideOf(at) !== null && sim.sideOf(at) !== this.site) continue;
      const d = length(sub(at, eye));
      if (page.pinned !== null) {
        if (canRead && d < 3.2 && page.printed && this.visible(eye, at, page.id)) {
          if (!this.saboteur) team.tell(page.printed, this.id);
        }
        continue;
      }
      if (this.skill.omniscient || (d < 10 && this.visible(eye, at, page.id))) {
        team.sightings.set(page.id, { pos: at, tick: this.squad.tick });
      }
    }
    // The dog with a page in its mouth.
    if (sim.dog.page !== null) {
      const at = sim.dog.body.translation();
      if (length(sub(at, eye)) < 10 && this.visible(eye, at, -1)) team.dogSeen = this.squad.tick;
    }
    // Places pages lie, close by and in view, count as looked at.
    this.spots().forEach((s, i) => {
      if (length(sub(s, eye)) < 2.5 && this.visible(eye, s, -1))
        team.looked.set(i, this.squad.tick);
    });
    this.lastLook = this.squad.tick;
  }

  /** Whether a straight look from `eye` reaches a page (nothing solid in the way). */
  private visible(eye: Vec3, at: Vec3, pageId: number): boolean {
    const sim = this.squad.game.sim;
    const R = this.squad.rapier;
    const d = sub(at, eye);
    const dist = length(d);
    if (dist < 0.05) return true;
    const hit = sim.world.castRay(
      new R.Ray(eye, scale(d, 1 / dist)),
      dist + 0.05,
      true,
      R.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      (c) => {
        const o = sim.ownerOf(c);
        return o !== undefined && o.kind !== 'player' && o.kind !== 'dog';
      },
    );
    if (!hit) return true;
    const o = sim.ownerOf(hit.collider);
    return (o?.kind === 'page' && o.pageId === pageId) || hit.timeOfImpact > dist - 0.08;
  }

  /** Something it saw happen close by: a saboteur's tell. */
  saw(e: SimEvent): void {
    if (this.saboteur || e.playerId === undefined) return;
    if (e.kind !== 'swap' && e.kind !== 'forge' && e.kind !== 'hide') return;
    this.squad.suspect(e.playerId, 0.95);
    if (e.kind === 'hide') {
      // The page went into the hiding place nearest the tell: look there again.
      const sim = this.squad.game.sim;
      let best: number | null = null;
      let bestD = Infinity;
      for (const h of sim.hideouts.values()) {
        const d = length(sub(h.def.pos, e.pos));
        if (d < bestD) {
          bestD = d;
          best = h.def.id;
        }
      }
      if (best !== null) this.team.searched.delete(best);
    }
    const what =
      e.kind === 'swap' ? 'swap a brick' : e.kind === 'forge' ? 'forge a page' : 'hide a page';
    this.say(`I saw ${this.nameOf(e.playerId)} ${what}!`);
  }

  // ---------------------------------------------------------------- meetings

  private meeting(): void {
    const round = this.squad.game.round!;
    const m = round.meeting!;
    if (m.outcome || !round.onSite.includes(this.id)) return;
    if (this.votedIn !== round.meetingVersion && this.voteAt === 0) {
      // Takes a moment to think, like everyone.
      this.voteAt = this.squad.tick + Math.round((3 + this.random() * 8) * 60);
    }
    if (this.voteAt === 0 || this.squad.tick < this.voteAt || m.votes.has(this.id)) {
      if (m.votes.has(this.id)) this.voteAt = 0;
      return;
    }
    this.voteAt = 0;
    this.votedIn = round.meetingVersion;
    this.squad.game.handle(this.id, { t: 'vote', target: this.choose() });
  }

  /** Who to vote off: the most suspected player, if it is clear enough, or nobody (0). */
  private choose(): number {
    const round = this.squad.game.round!;
    const onSite = round.onSite.filter((id) => id !== this.id);
    if (this.saboteur) {
      const partners = round.partners(this.id);
      const innocents = onSite.filter((id) => !partners.includes(id));
      // Go along with whoever most of the others are voting for, if they are innocent.
      const votes = new Map<number, number>();
      for (const t of round.meeting!.votes.values()) if (t) votes.set(t, (votes.get(t) ?? 0) + 1);
      const crowd = [...votes].filter(([id]) => innocents.includes(id)).sort((a, b) => b[1] - a[1]);
      if (crowd[0] && crowd[0][1] >= 1) return crowd[0][0];
      const suspects = innocents
        .map((id) => [id, this.squad.suspicion.get(id) ?? 0] as const)
        .sort((a, b) => b[1] - a[1]);
      return suspects[0] && suspects[0][1] > 0.3 ? suspects[0][0] : 0;
    }
    const suspects = onSite
      .map((id) => [id, this.squad.suspicion.get(id) ?? 0] as const)
      .sort((a, b) => b[1] - a[1]);
    const top = suspects[0];
    return top && top[1] >= 0.5 && (!suspects[1] || suspects[1][1] < top[1] - 0.15) ? top[0] : 0;
  }

  // ---------------------------------------------------------------- deciding

  private decide(): Job<unknown> {
    const p = this.me()!;
    const sim = this.squad.game.sim;
    const round = this.squad.game.round!;
    if (p.tool) return this.named('put the tool away', this.putAway());
    if (p.holding && !this.squad.claims.has(this.id)) {
      // Still holding a part after a meeting, say: put it on if it goes on now.
      const fits = this.saboteur
        ? undefined
        : this.plan().ready.find((b) => this.holds(b.type, b.colour, b.prints));
      if (fits) return this.named('build', this.buildOne(fits));
      return this.named('let go', this.letGo());
    }
    if (this.saboteur) {
      const job = this.mischief();
      if (job) return job;
    }
    if (p.page !== null) return this.named('read the page', this.pocketPage());
    // The lights went out: someone has to fix the panel (one bot is enough).
    if (
      !sim.power.on &&
      sim.power.fixer === null &&
      sim.panel &&
      round.mode !== 'gear' &&
      (this.squad.panelBy === null || !this.squad.bots.has(this.squad.panelBy))
    ) {
      this.squad.panelBy = this.id;
      return this.named('fix the panel', this.fixPanel());
    }
    // The dog goes for the build after three minutes without a treat: one bot feeds it first.
    if (
      !this.saboteur &&
      !sim.dog.leashed &&
      sim.dog.ticksHungry > DOG_FEED_SECONDS * 60 &&
      (this.squad.dogBy === null || !this.squad.bots.has(this.squad.dogBy))
    ) {
      this.squad.dogBy = this.id;
      return this.named('feed the dog', this.feedDog());
    }
    if (!this.saboteur && this.mayAccuse()) return this.named('ring the bell', this.ringBell());
    const plan = this.plan();
    if (plan.complete) return this.named('press Done', this.pressDone());
    if (!p.handsOff && plan.fix) return this.named('fix a brick', this.fixBrick(plan.fix));
    const searching = this.shouldSearch(plan.ready.length, plan.unknown);
    if (searching || p.handsOff) {
      const job = this.search();
      if (job) return job;
    }
    const brick = p.handsOff ? null : this.pick(plan.ready);
    if (brick) return this.named('build', this.buildOne(brick));
    if (plan.unknown > 0) {
      const job = this.search();
      if (job) return job;
    }
    return this.named('wait', this.loiter());
  }

  private *named<T>(name: string, job: Job<T>): Job<T> {
    this.jobName = name;
    return yield* job;
  }

  /**
   * Where the build stands: bricks known and not yet right that can go on now, a wrong brick
   * to take off, how many steps nobody has read, and whether everything is in place.
   */
  private plan(): { ready: Wanted[]; fix: Wanted | null; unknown: number; complete: boolean } {
    const m = this.team.match();
    const empty = { ready: [], fix: null, unknown: 0, complete: false };
    if (!m) return empty;
    const sim = this.squad.game.sim;
    const build = sim.build(this.site);
    const { known, total } = this.team.knownSteps();
    const unknown = total - known;
    const grid = build.grid;
    this.checkSwaps(m.result.bricks);
    const ready: Wanted[] = [];
    let fix: Wanted | null = null;
    let wrong = 0;
    // Parts that could go on now (clutching something already there).
    const missing = m.result.bricks
      .filter((v) => v.status === 'missing')
      .map((v) => v.target)
      .filter((t) => !grid.overlaps(t) && (grid.size === 0 || grid.neighbours(t).length > 0));
    for (const v of m.result.bricks) {
      if (v.status === 'correct') continue;
      wrong++;
      if (v.status !== 'missing') {
        fix ??= this.avoided(`fix|${v.actualId}`)
          ? null
          : ({ ...v.target, actualId: v.actualId } as Wanted);
        continue;
      }
      if (grid.overlaps(v.target)) continue;
      if (grid.size > 0 && grid.neighbours(v.target).length === 0) continue;
      // Bottom up: never over a part still to go in under it (it could not get in after).
      if (missing.some((u) => u !== v.target && u.y < v.target.y && underlaps(u, v.target)))
        continue;
      ready.push(v.target);
    }
    // Bricks nobody wants (not in any step the bots know of), when they know every step.
    if (!fix && unknown === 0 && m.result.extras.length > 0) {
      const id = m.result.extras.find((x) => !this.avoided(`fix|${x}`));
      if (id !== undefined) {
        const b = grid.bricks.get(id)!;
        fix = { ...b, step: -1, actualId: id } as unknown as Wanted;
      }
    }
    const complete = unknown === 0 && wrong === 0 && m.result.extras.length <= 1;
    // Out of time: hand in what there is if it should pass.
    const round = this.squad.game.round!;
    const late = round.timeLeft < 12 && m.result.counts.correct >= 0.95 * m.result.counts.total;
    return { ready, fix, unknown, complete: complete || (late && unknown === 0) };
  }

  /** Looks over the build now and then: a brick that was right and now is not was swapped. */
  private checkSwaps(bricks: { status: string; actualId?: number; target: Wanted }[]): void {
    if (this.saboteur || this.squad.tick - this.lastCheck < this.skill.checkEvery * 60) return;
    this.lastCheck = this.squad.tick;
    const sim = this.squad.game.sim;
    const grid = sim.build(this.site).grid;
    const now = new Map<number, ColourId>();
    for (const v of bricks) {
      if (v.actualId === undefined) continue;
      const b = grid.bricks.get(v.actualId);
      if (!b) continue;
      const was = this.seenRight.get(b.id);
      if (v.status === 'correct') now.set(b.id, b.colour);
      else if (
        was !== undefined &&
        was !== b.colour &&
        !this.squad.noticed.has(`${b.id}:${b.colour}`)
      ) {
        // Someone swapped it: whoever has been about the build lately (once, however many
        // bots notice it).
        const near = [...this.squad.nearBuild].filter(([id, t]) => t > 0 && id !== this.id);
        const sum = near.reduce((s, [, t]) => s + t, 0);
        this.squad.noticed.add(`${b.id}:${b.colour}`);
        for (const [id, t] of near) this.squad.suspect(id, (0.45 * t) / Math.max(sum, 1));
      }
    }
    this.seenRight = now;
  }

  /** Whether this bot looks for pages now rather than building. */
  private shouldSearch(ready: number, unknown: number): boolean {
    if (unknown === 0) return false;
    const mates = [...this.squad.bots.values()]
      .filter((b) => b.site === this.site && this.squad.game.sim.players.has(b.id))
      .map((b) => b.id)
      .sort((a, b) => a - b);
    const n = mates.length;
    // Everyone looks while there is little to build; at least one keeps looking.
    const builders = Math.min(n - 1, Math.ceil(ready / 3));
    const rank = mates.indexOf(this.id);
    return rank >= builders;
  }

  /** The brick to fetch next: early steps first, and one nobody else is fetching. */
  private pick(ready: Wanted[]): Wanted | null {
    const taken = new Set([...this.squad.claims.values()].map((c) => c.key));
    const free = ready.filter(
      (b) => !taken.has(brickKey(b)) && !this.avoided(`brick|${brickKey(b)}`),
    );
    if (!free.length) return null;
    const first = Math.min(...free.map((b) => b.step));
    const sim = this.squad.game.sim;
    const presses = [...sim.machines.values()].filter((m) => m.def.kind === 'press');
    // A part a moulding machine makes now, from any step that can go on; else one of the
    // earliest steps, one needing the fewest trips to the brick works.
    const loaded = free.find((b) =>
      presses.some((m) => m.mould === b.type && m.colour === b.colour && m.shots > 0),
    );
    if (loaded) return loaded;
    const early = free.filter((b) => b.step <= first + 1);
    const half = early.filter((b) =>
      presses.some((m) => (m.colour === b.colour && m.shots > 0) || m.mould === b.type),
    );
    const pool = half.length ? half : early;
    return pool[Math.floor(this.random() * Math.min(pool.length, 3))]!;
  }

  // ---------------------------------------------------------------- moving

  /**
   * Walks to the nearest of `goals` (nodes), or until `done` says it is close enough. Returns
   * whether it got there.
   */
  private *walk(goals: number[], done?: () => boolean, seconds = 45): Job {
    const nav = this.squad.nav;
    let start = nav.locate(this.feet());
    if (start === null || !nav.reachable(start)) {
      // Somewhere the map cannot lead from (up on a pushed crate, say): head for the map.
      if (!(yield* this.backOnMap())) return false;
      start = nav.locate(this.feet());
    }
    if (start === null || !goals.length) return false;
    let path: Waypoint[] | null = nav.path(start, goals, this.costs());
    if (!path) return false;
    let i = 0;
    let stuck = 0;
    let from = this.feet();
    // Up on something the map does not know (a crate pushed into the way): get down off it.
    if (from.y - nav.ys[start]! > 0.45) {
      this.block(nav.around(from, 0.7, 2, 0.5), 30);
      path = nav.path(start, goals, this.costs());
      if (!path) return false;
      while (
        i < path.length - 1 &&
        Math.hypot(path[i]!.pos.x - from.x, path[i]!.pos.z - from.z) < 0.8
      )
        i++;
    }
    let checkAt = this.squad.tick + 30;
    const end = this.squad.tick + seconds * 60;
    while (this.squad.tick < end) {
      if (!this.me()) return false;
      if (done && this.squad.tick % 4 === 0 && done()) {
        this.halt();
        return true;
      }
      const feet = this.feet();
      // Past the farthest waypoint it is at now (cutting corners skips some), up to a ladder.
      for (let j = Math.min(path.length - 1, i + 14); j >= i; j--) {
        if (path.slice(i, j + 1).some((w) => w.ladder)) continue;
        if (reached(feet, path[j]!.pos)) {
          i = j + 1;
          break;
        }
      }
      if (i >= path.length) {
        this.halt();
        return true;
      }
      const wp = path[i]!;
      if (wp.ladder) {
        if (!(yield* this.climb(wp))) return false;
        i++;
        from = this.feet();
        checkAt = this.squad.tick + 30;
        continue;
      }
      // Cut straight across to the farthest waypoint in a clear line.
      let to = wp.pos;
      for (let j = i + 1; j < Math.min(path.length, i + 12); j++) {
        const w = path[j]!;
        if (w.ladder || !nav.straight(feet, w.pos) || this.crossesPlate(feet, w.pos)) break;
        to = w.pos;
      }
      const dx = to.x - feet.x;
      const dz = to.z - feet.z;
      this.ctl.yaw = Math.atan2(-dx, -dz);
      this.ctl.pitch = -0.25;
      this.ctl.forward = 1;
      this.ctl.right = 0;
      const p = this.me()!;
      const carrying = p.holding !== null && !this.holdingBrick();
      const left = path.length - i;
      this.ctl.sprint = this.skill.sprint && !carrying && left > 6;
      this.ctl.careful = this.skill.careful && !carrying && this.looseAhead(feet, this.ctl.yaw);
      if (this.ctl.careful) this.ctl.sprint = false;
      if (this.squad.tick >= checkAt) {
        const moved = Math.hypot(feet.x - from.x, feet.z - from.z);
        if (moved < 0.25 && p.limp === 0) {
          stuck++;
          this.ctl.jump = true;
          if (stuck % 3 === 0) {
            // Something is in the way: step aside, then find a way round it from here.
            this.ctl.right = this.random() < 0.5 ? 1 : -1;
            const ahead = path[i]!.pos;
            if (Math.hypot(ahead.x - feet.x, ahead.z - feet.z) < 1.2) {
              this.block(nav.around(ahead, 0.4, 0.5, 0.5), 20);
            }
            const again = nav.locate(feet);
            path = again === null ? null : nav.path(again, goals, this.costs());
            if (!path) return false;
            i = 0;
          }
          if (stuck >= 9) return false;
        } else stuck = Math.max(0, stuck - 1);
        from = feet;
        checkAt = this.squad.tick + 30;
      }
      yield;
    }
    this.halt();
    return false;
  }

  /** Walks (and jumps) straight for the nearest place on the map that leads anywhere. */
  private *backOnMap(): Job {
    const nav = this.squad.nav;
    for (let tries = 0; tries < 3; tries++) {
      const feet = this.feet();
      const near = nav
        .around(feet, 3, 3, 0.4)
        .sort(
          (a, b) =>
            Math.hypot(nav.xs[a]! - feet.x, nav.zs[a]! - feet.z) -
            Math.hypot(nav.xs[b]! - feet.x, nav.zs[b]! - feet.z),
        );
      const to = near.find(
        (n) => Math.hypot(nav.xs[n]! - feet.x, nav.zs[n]! - feet.z) > 0.6 + 0.4 * tries,
      );
      if (to === undefined) return false;
      for (let k = 0; k < 60; k++) {
        const f = this.feet();
        const n = nav.locate(f);
        if (n !== null && nav.reachable(n) && Math.abs(nav.ys[n]! - f.y) < 0.3) {
          this.halt();
          return true;
        }
        this.ctl.yaw = Math.atan2(-(nav.xs[to]! - f.x), -(nav.zs[to]! - f.z));
        this.ctl.forward = 1;
        if (k === 20) this.ctl.jump = true;
        yield;
      }
    }
    this.halt();
    return false;
  }

  /** Keeps off these nodes for a while (something the map does not know of is in the way). */
  private block(nodes: number[], seconds: number): void {
    const until = this.squad.tick + seconds * 60;
    for (const n of nodes) this.blocked.set(n, until);
  }

  /** Whether a spot is on (or right by) a job site's baseplate. */
  private overPlate(x: number, y: number, z: number): boolean {
    const sim = this.squad.game.sim;
    if (this.plates?.tick !== this.squad.tick) {
      const list = sim.sites.map((_, site) => {
        const build = sim.build(site);
        const plate = [...build.grid.bricks.values()].find((b) => BRICK_TYPES[b.type].fixture);
        if (!plate) return null;
        const { w, d } = footprint(plate.type, plate.rot);
        return {
          centre: sim.buildCentre(build),
          inv: conj(build.body.rotation()),
          hw: (w * STUD) / 2 + 0.3,
          hd: (d * STUD) / 2 + 0.3,
        };
      });
      this.plates = { tick: this.squad.tick, list };
    }
    for (const pl of this.plates.list) {
      if (!pl || Math.abs(y - pl.centre.y) > 0.8) continue;
      const l = rotate(pl.inv, v3(x - pl.centre.x, 0, z - pl.centre.z));
      if (Math.abs(l.x) < pl.hw && Math.abs(l.z) < pl.hd) return true;
    }
    return false;
  }
  /** Whether walking straight from `a` to `b` goes over a baseplate (when `a` is not on it). */
  private crossesPlate(a: Vec3, b: Vec3): boolean {
    if (this.overPlate(a.x, a.y, a.z)) return false;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      if (this.overPlate(a.x + (b.x - a.x) * t, b.y, a.z + (b.z - a.z) * t)) return true;
    }
    return false;
  }
  private plates: {
    tick: number;
    list: ({ centre: Vec3; inv: Quat; hw: number; hd: number } | null)[];
  } | null = null;

  /**
   * Extra cost of each node: other players standing on it, something in the way, or a job
   * site's baseplate (walking over the build gets in the way of building it).
   */
  private costs(): (n: number) => number {
    const nav = this.squad.nav;
    const sim = this.squad.game.sim;
    const others = [...sim.players.values()]
      .filter((p) => p.id !== this.id)
      .map((p) => p.body.translation());
    // Loose bricks on the floor (a saboteur's trap, say): stepping on one trips a player up.
    const loose = new Map<string, Vec3[]>();
    for (const a of sim.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      const t = a.body.translation();
      const key = `${Math.floor(t.x / 0.5)}|${Math.floor(t.z / 0.5)}`;
      const list = loose.get(key);
      if (list) list.push(t);
      else loose.set(key, [t]);
    }
    const trips = (x: number, y: number, z: number): boolean => {
      const cx = Math.floor(x / 0.5);
      const cz = Math.floor(z / 0.5);
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (let k = cz - 1; k <= cz + 1; k++) {
          for (const t of loose.get(`${i}|${k}`) ?? []) {
            if (Math.abs(t.y - y) < 0.3 && Math.hypot(t.x - x, t.z - z) < 0.4) return true;
          }
        }
      }
      return false;
    };
    return (n) => {
      const until = this.blocked.get(n);
      let c = until !== undefined && until > this.squad.tick ? 25 : 0;
      const x = nav.xs[n]!;
      const y = nav.ys[n]!;
      const z = nav.zs[n]!;
      for (const t of others) {
        if (Math.hypot(t.x - x, t.z - z) < 0.5 && Math.abs(t.y - FEET - y) < 1) c += 1.5;
      }
      if (this.overPlate(x, y, z)) c += 40;
      if (loose.size && trips(x, y, z)) c += this.skill.careful ? 1 : 6;
      return c;
    };
  }

  /** Whether a loose brick lies on the floor just ahead (one to step over carefully). */
  private looseAhead(feet: Vec3, yaw: number): boolean {
    const ahead = add(feet, v3(-Math.sin(yaw) * 0.6, 0, -Math.cos(yaw) * 0.6));
    for (const a of this.squad.game.sim.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      const t = a.body.translation();
      if (Math.abs(t.y - feet.y) < 0.3 && Math.hypot(t.x - ahead.x, t.z - ahead.z) < 0.7)
        return true;
    }
    return false;
  }

  /** Up or down a ladder, from its foot or its top. */
  private *climb(wp: Waypoint): Job {
    const l = wp.ladder!;
    const yaw = l.def.facing;
    const end = this.squad.tick + 8 * 60;
    let left = false;
    while (this.squad.tick < end) {
      const p = this.me();
      if (!p) return false;
      const feet = this.feet();
      this.ctl.yaw = yaw;
      this.ctl.pitch = l.up ? 0.3 : -0.4;
      this.ctl.sprint = false;
      this.ctl.forward = l.up ? 1 : -1;
      if (p.climbing) left = true;
      const there = Math.abs(feet.y - wp.pos.y) < 0.4 && p.grounded;
      if (left && there) {
        // Off the top: a few steps on, onto whatever it reaches.
        for (let k = 0; k < 20; k++) yield;
        this.halt();
        return true;
      }
      if (!left && there && Math.hypot(feet.x - wp.pos.x, feet.z - wp.pos.z) < 0.4) {
        this.halt();
        return true;
      }
      yield;
    }
    this.halt();
    return false;
  }

  /** Waits about, out of the way near the build. */
  private *loiter(): Job {
    const centre = this.squad.game.sim.buildCentre(this.squad.game.sim.build(this.site));
    if (this.squad.tick > this.wanderAt) {
      this.wanderAt = this.squad.tick + 600;
      const spots = this.squad.nav.around(centre, 3.5, 1, 1).filter((n) => {
        const d = Math.hypot(this.squad.nav.xs[n]! - centre.x, this.squad.nav.zs[n]! - centre.z);
        return d > 2.2;
      });
      if (spots.length) {
        const goal = spots[Math.floor(this.random() * spots.length)]!;
        yield* this.walk([goal], undefined, 10);
      }
    }
    for (let i = 0; i < 40; i++) yield;
    return true;
  }

  // ---------------------------------------------------------------- aiming and clicking

  /**
   * The view angles that put the crosshair on `point` (or near it, nudged the way a player
   * nudges the mouse) with the aim landing on what `ok` wants, from where the bot stands now.
   */
  private aim(
    point: Vec3,
    ok: (o: ColliderOwner) => boolean,
  ): { yaw: number; pitch: number } | null {
    const p = this.me();
    if (!p) return null;
    const sim = this.squad.game.sim;
    const eye = sim.eye(p);
    if (length(sub(point, eye)) > REACH + 0.3) return null;
    const saved = { yaw: p.input.yaw, pitch: p.input.pitch, firstPerson: p.input.firstPerson };
    const nudges = [v3()];
    for (const d of [0.04, 0.08, 0.14]) {
      nudges.push(v3(d, 0, 0), v3(-d, 0, 0), v3(0, d, 0), v3(0, -d, 0), v3(0, 0, d), v3(0, 0, -d));
    }
    try {
      for (const n of nudges) {
        const d = sub(add(point, n), eye);
        const yaw = Math.atan2(-d.x, -d.z);
        const pitch = Math.max(
          -MAX_PITCH,
          Math.min(MAX_PITCH, Math.atan2(d.y, Math.hypot(d.x, d.z))),
        );
        Object.assign(p.input, { yaw, pitch, firstPerson: true });
        const hit = sim.aim(p);
        if (hit && ok(hit.owner)) return { yaw, pitch };
      }
    } finally {
      Object.assign(p.input, saved);
    }
    return null;
  }

  /** Nodes to stand on to reach `point`, best first: in reach, in view, not too close. */
  private stands(point: Vec3, ok: (o: ColliderOwner) => boolean, near = 1.1, lift = 0): number[] {
    const nav = this.squad.nav;
    const sim = this.squad.game.sim;
    const R = this.squad.rapier;
    const me = this.feet();
    const eyeUp = FEET + EYE_OFFSET + lift;
    const scored = nav
      .around(point, 2.2, 2.6, 0.8)
      .map((n) => {
        const eye = v3(nav.xs[n]!, nav.ys[n]! + eyeUp, nav.zs[n]!);
        const reach = length(sub(point, eye));
        const flat = Math.hypot(nav.xs[n]! - point.x, nav.zs[n]! - point.z);
        const fromMe = Math.hypot(nav.xs[n]! - me.x, nav.zs[n]! - me.z);
        return {
          n,
          eye,
          reach,
          score: Math.abs(flat - near) + 0.08 * fromMe + (flat < 0.45 ? 2 : 0),
        };
      })
      .filter((s) => s.reach < REACH)
      .sort((a, b) => a.score - b.score);
    const out: number[] = [];
    for (const s of scored.slice(0, 40)) {
      const d = sub(point, s.eye);
      const dist = length(d);
      const hit = sim.world.castRay(
        new R.Ray(s.eye, scale(d, 1 / dist)),
        dist + 0.1,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        (c) => {
          const o = sim.ownerOf(c);
          return o !== undefined && o.kind !== 'player' && (o.kind !== 'dog' || ok(o));
        },
      );
      const o = hit ? sim.ownerOf(hit.collider) : undefined;
      if (o && ok(o)) out.push(s.n);
      if (out.length >= 6) break;
    }
    return out;
  }

  /**
   * Goes to where it can click on a target and clicks (or does all of `actions` there, in
   * order). Returns whether it got to click.
   */
  private *use(t: Target, actions: Action | Action[], near?: number): Job {
    const list = Array.isArray(actions) ? actions : [actions];
    if (this.avoided(t.key)) return false;
    const point = t.point();
    if (!point) return false;
    const tried = new Set<number>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const at = t.point();
      if (!at) return false;
      let sol = this.aim(at, t.ok);
      if (!sol) {
        const goals = this.stands(at, t.ok, near).filter((n) => !tried.has(n));
        if (!goals.length) {
          // Out of sight from the floor (on a high shelf): jump and click at the top.
          if (yield* this.jumpUse(t, list, near)) return true;
          this.squad.trace?.(this.id, `no place to stand for ${t.key} (attempt ${attempt})`);
          break;
        }
        for (const g of goals) tried.add(g);
        const there = yield* this.walk(goals.slice(0, 3), () => {
          const now = t.point();
          return !!now && !!this.aim(now, t.ok);
        });
        const now = t.point();
        if (!now) return false;
        sol = this.aim(now, t.ok);
        if (!sol && !there) {
          const f = this.feet();
          this.squad.trace?.(
            this.id,
            `walk to ${t.key} failed at ${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)}`,
          );
          continue;
        }
      }
      if (!sol) {
        // Standing there, but the aim does not land: look again from a step closer.
        for (let k = 0; k < 10; k++) yield;
        const now = t.point();
        sol = now ? this.aim(now, t.ok) : null;
        if (!sol) {
          const f = this.feet();
          const hit = this.me() && now ? this.squad.game.sim.aim(this.me()!) : null;
          this.squad.trace?.(
            this.id,
            `no aim on ${t.key} from ${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)} (${hit?.owner.kind})`,
          );
          continue;
        }
      }
      if (this.credits < list.length) {
        yield* this.afford(list.length);
        const now = t.point();
        sol = now ? this.aim(now, t.ok) : null;
        if (!sol) continue;
      }
      this.ctl.yaw = sol.yaw;
      this.ctl.pitch = sol.pitch;
      for (const a of list) this.act(a, sol.yaw, sol.pitch);
      yield;
      yield;
      return true;
    }
    this.failed(t.key);
    this.squad.trace?.(this.id, `could not use ${t.key}`);
    return false;
  }

  /** Clicks on something only in sight mid-jump: walks under it, jumps, clicks near the top. */
  private *jumpUse(t: Target, list: Action[], near?: number): Job {
    const at = t.point();
    if (!at) return false;
    const goals = this.stands(at, t.ok, near, JUMP_LIFT);
    if (!goals.length) return false;
    for (let tries = 0; tries < 3; tries++) {
      yield* this.walk(goals.slice(0, 3), undefined, 30);
      this.halt();
      for (let k = 0; k < 6; k++) yield;
      this.ctl.jump = true;
      for (let k = 0; k < 45; k++) {
        yield;
        const now = t.point();
        if (!now) return false;
        const sol = this.aim(now, t.ok);
        if (sol) {
          this.ctl.yaw = sol.yaw;
          this.ctl.pitch = sol.pitch;
          for (const a of list) this.act(a, sol.yaw, sol.pitch);
          yield;
          yield;
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- jobs: small ones

  private *putAway(): Job {
    this.act({ kind: 'drop' });
    yield;
    yield;
    return true;
  }

  /** Puts down whatever is in hand, away from the build so nobody steps on it there. */
  private *letGo(): Job {
    const p = this.me()!;
    const sim = this.squad.game.sim;
    const held = p.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (held && sim.isBuild(held.id)) {
      // A build in the arms: set it down where it can be worked on.
      this.act({ kind: 'drop' });
      for (let k = 0; k < 90 && this.me()?.holding; k++) yield;
      return true;
    }
    yield* this.throwAway();
    return true;
  }

  /** Throws what it holds away, well clear of the build and facing away from it. */
  private *throwAway(): Job {
    const sim = this.squad.game.sim;
    const nav = this.squad.nav;
    const centre = sim.buildCentre(sim.build(this.site));
    const flat = (x: number, z: number): number => Math.hypot(x - centre.x, z - centre.z);
    let me = this.feet();
    if (flat(me.x, me.z) < 3.4) {
      const spots = nav
        .around(centre, 5, 1, 1)
        .filter((n) => flat(nav.xs[n]!, nav.zs[n]!) > 3.6)
        .sort(
          (a, b) =>
            Math.hypot(nav.xs[a]! - me.x, nav.zs[a]! - me.z) -
            Math.hypot(nav.xs[b]! - me.x, nav.zs[b]! - me.z),
        );
      if (spots.length) yield* this.walk(spots.slice(0, 4), undefined, 15);
      me = this.feet();
    }
    this.halt();
    yield;
    const yaw = Math.atan2(-(me.x - centre.x), -(me.z - centre.z));
    this.ctl.yaw = yaw;
    this.act({ kind: 'throw' }, yaw, 0.3);
    yield;
    yield;
    return true;
  }

  /** Takes a treat from the nearest jar and gives it to the dog. */
  private *feedDog(): Job {
    const sim = this.squad.game.sim;
    const me = this.feet();
    const jars = [sim.level.dog.treatJar, ...(sim.level.dog.treatJars ?? [])].sort(
      (a, b) => length(sub(a, me)) - length(sub(b, me)),
    );
    try {
      for (const jar of jars) {
        if (this.me()?.treat) break;
        const at = add(jar, v3(0, 0.09, 0));
        yield* this.use(
          { key: `treats|${jar.x}|${jar.z}`, point: () => at, ok: (o) => o.kind === 'treats' },
          { kind: 'grab' },
        );
      }
      if (!this.me()?.treat) return false;
      for (let tries = 0; tries < 4 && this.me()?.treat; tries++) {
        yield* this.use(
          {
            key: 'dog',
            point: () => add(sim.dog.body.translation(), v3(0, 0.1, 0)),
            ok: (o) => o.kind === 'dog',
          },
          { kind: 'grab' },
          0.9,
        );
      }
      return !this.me()?.treat;
    } finally {
      this.squad.dogBy = null;
    }
  }

  private *fixPanel(): Job {
    const sim = this.squad.game.sim;
    const panel = sim.panel!;
    const ok = yield* this.use(
      { key: 'panel', point: () => panel, ok: (o) => o.kind === 'panel' },
      { kind: 'grab' },
    );
    if (ok) {
      // Stays on the job until the lights come on.
      for (let k = 0; k < 5 * 60 && !sim.power.on; k++) yield;
      if (sim.power.on) this.say('Power is back on.');
    }
    this.squad.panelBy = null;
    return ok;
  }

  /** The page in its pocket: reads it, tells the others, and pins it on the board. */
  private *pocketPage(): Job {
    const sim = this.squad.game.sim;
    const round = this.squad.game.round!;
    const p = this.me()!;
    const page = p.page === null ? undefined : sim.pages.get(p.page);
    if (!page) return false;
    const printed = round.canRead(this.id) ? page.printed : null;
    if (printed && !this.saboteur) {
      this.team.tell(printed, this.id);
      const real = this.team.realStamp;
      if (real && printed.step >= 0 && printed.stamp !== real) {
        this.say(
          `Page ${printed.step + 1}${printed.half ?? ''} has the wrong stamp: it is forged.`,
        );
      }
    }
    if (printed && this.saboteur && !round.partners(this.id).length)
      this.team.tell(printed, this.id);
    // Pin it where everyone can read it.
    const boards = levelBoards(sim.level).filter((b) => b.site === this.site);
    for (const b of boards) {
      const ok = yield* this.use(
        {
          key: `board|${b.pos.x}|${b.pos.z}`,
          point: () => add(b.pos, v3(0, -0.15, 0)),
          ok: (o) => o.kind === 'board',
        },
        { kind: 'grab' },
        1.2,
      );
      if (ok && this.me()?.page === null) return true;
    }
    this.act({ kind: 'dropPage' });
    yield;
    return false;
  }

  // ---------------------------------------------------------------- jobs: pages

  /** The next thing to do about pages nobody has read: one lying about, or a hiding place to open. */
  private search(): Job | null {
    const sim = this.squad.game.sim;
    const round = this.squad.game.round!;
    const team = this.team;
    const me = this.feet();
    const claimed = new Set(
      [...this.squad.bots.values()].filter((b) => b !== this).map((b) => b.searching),
    );
    // A page lying where someone saw it, nearest first.
    const pages = [...team.sightings]
      .map(([id, s]) => ({ id, s, page: sim.pages.get(id) }))
      .filter(
        ({ id, page }) =>
          page &&
          page.carriedBy === null &&
          !claimed.has(`page|${id}`) &&
          !this.avoided(`page|${id}`) &&
          (page.body !== null || (this.skill.omniscient && page.hideout !== null)) &&
          page.pinned === null &&
          this.unread(page.printed?.step ?? -2, page.printed?.half),
      )
      .sort((a, b) => length(sub(a.s.pos, me)) - length(sub(b.s.pos, me)));
    const next = pages[0];
    if (next) {
      const page = next.page!;
      if (page.hideout !== null)
        return this.named('open a hiding place', this.openHideout(page.hideout));
      return this.named('take a page', this.takePage(page.id));
    }
    // A page in the dog's mouth, seen lately: get it to drop it.
    const dogPage = sim.dog.page === null ? undefined : sim.pages.get(sim.dog.page);
    if (
      dogPage &&
      !claimed.has('dog') &&
      !this.me()?.holding &&
      !this.me()?.treat &&
      (this.skill.omniscient || this.squad.tick - team.dogSeen < 10 * 60) &&
      this.unread(dogPage.printed?.step ?? -2, dogPage.printed?.half)
    ) {
      return this.named('take a page off the dog', this.takeFromDog());
    }
    // Pinned pages someone else put up that nobody here has read: go and read them.
    if (round.canRead(this.id) && !this.saboteur) {
      const unreadPinned = [...sim.pages.values()].find(
        (pg) => pg.pinned !== null && pg.printed && this.unread(pg.printed.step, pg.printed.half),
      );
      if (unreadPinned && !claimed.has('board'))
        return this.named('read the board', this.readBoard());
    }
    // A hiding place nobody has opened lately, nearest first.
    const hideouts = [...sim.hideouts.values()]
      .filter(
        (h) =>
          !h.locked &&
          !team.wasSearched(h.def.id) &&
          !claimed.has(`hideout|${h.def.id}`) &&
          !this.avoided(`hideout|${h.def.id}`) &&
          (sim.sideOf(h.def.pos) === null || sim.sideOf(h.def.pos) === this.site),
      )
      .sort((a, b) => length(sub(a.def.pos, me)) - length(sub(b.def.pos, me)));
    const h = hideouts[0];
    if (h) return this.named('open a hiding place', this.openHideout(h.def.id));
    // Nothing left to open: walk round the page spots, looking.
    // Nothing left to open: go round the places pages lie, the one looked at longest ago first.
    let best: { i: number; score: number } | null = null;
    this.spots().forEach((s, i) => {
      if (sim.sideOf(s) !== null && sim.sideOf(s) !== this.site) return;
      if (claimed.has(`spot|${i}`) || this.avoided(`spot|${i}`)) return;
      const ago = this.squad.tick - (team.looked.get(i) ?? -1e6);
      const score = Math.min(ago, 1e5) - 60 * length(sub(s, me));
      if (!best || score > best.score) best = { i, score };
    });
    const pick = best as { i: number; score: number } | null;
    if (pick) return this.named('look around', this.lookAt(pick.i));
    return null;
  }

  /** Where pages lie about: the level's places for them, and where the dog drops them. */
  private spots(): Vec3[] {
    const level = this.squad.game.sim.level;
    return [...level.pageSpots, ...level.dog.points];
  }

  /** Grabs the dog's collar, so it drops the page in its mouth. */
  private *takeFromDog(): Job {
    this.searchKey = 'dog';
    const sim = this.squad.game.sim;
    const ok = yield* this.use(
      {
        key: 'dog',
        point: () => add(sim.dog.body.translation(), v3(0, 0.1, 0)),
        ok: (o) => o.kind === 'dog',
      },
      { kind: 'grab' },
      0.9,
    );
    this.searchKey = '';
    for (let k = 0; k < 20; k++) yield;
    this.look();
    return ok;
  }

  /** What this bot is busy finding, so the others pick something else. */
  get searching(): string {
    return this.searchKey;
  }
  private searchKey = '';

  /** Whether the team still needs to read this page (a step and half). */
  private unread(step: number, half?: 'A' | 'B'): boolean {
    // A page it cannot read could be any: worth taking to the board.
    if (step === -2) return true;
    if (step < 0) return this.team.realStamp === null;
    const team = this.team;
    if (team.notes.has(`${step}`)) return false;
    if (half) return !team.notes.has(`${step}${half}`);
    return true;
  }

  private *takePage(id: number): Job {
    this.searchKey = `page|${id}`;
    const sim = this.squad.game.sim;
    const ok = yield* this.use(
      {
        key: `page|${id}`,
        point: () => {
          const page = sim.pages.get(id);
          return page?.body && page.carriedBy === null && page.pinned === null
            ? page.body.translation()
            : null;
        },
        ok: (o) => o.kind === 'page' && o.pageId === id,
      },
      { kind: 'grab' },
      0.9,
    );
    this.searchKey = '';
    if (!ok || this.me()?.page !== id) {
      this.team.sightings.delete(id);
      return false;
    }
    return true;
  }

  private *openHideout(id: number): Job {
    this.searchKey = `hideout|${id}`;
    const sim = this.squad.game.sim;
    const h = sim.hideouts.get(id)!;
    const team = this.team;
    if (!h.open) {
      const centre = add(h.def.pos, v3(0, h.def.kind === 'rug' ? 0.02 : 0, 0));
      const ok = yield* this.use(
        {
          key: `hideout|${id}`,
          point: () => centre,
          ok: (o) => o.kind === 'hideout' && o.hideoutId === id,
        },
        { kind: 'grab' },
      );
      if (!ok) {
        this.searchKey = '';
        return false;
      }
      // Pages spill out in front: take a look.
      for (let k = 0; k < 20; k++) yield;
      this.look();
    }
    team.searched.set(id, this.squad.tick);
    this.searchKey = '';
    return true;
  }

  private *readBoard(): Job {
    this.searchKey = 'board';
    const sim = this.squad.game.sim;
    for (const b of levelBoards(sim.level).filter((x) => x.site === this.site)) {
      for (const side of [1, -1]) {
        const out = rotate(yawQuat(b.facing), v3(0, 0, -side * 1.3));
        const spot = add(b.pos, out);
        const n = this.squad.nav.closest(v3(spot.x, b.pos.y - 1.3, spot.z), 1, 1.5);
        if (n === null) continue;
        yield* this.walk([n], undefined, 20);
        this.ctl.yaw = Math.atan2(-(b.pos.x - spot.x), -(b.pos.z - spot.z));
        for (let k = 0; k < 20; k++) yield;
        this.look();
      }
    }
    this.searchKey = '';
    return true;
  }

  private *lookAt(i: number): Job {
    this.searchKey = `spot|${i}`;
    const s = this.spots()[i]!;
    this.failed(`spot|${i}`, 30);
    const n = this.squad.nav.around(s, 1.2, 2.6, 0.6);
    const there = n.length ? yield* this.walk(n.slice(0, 4), undefined, 25) : false;
    // Turn round once there, in case it lies behind something.
    for (let k = 0; k < 4; k++) {
      this.ctl.yaw += Math.PI / 2;
      for (let t = 0; t < 6; t++) yield;
      this.look();
    }
    // Up on a shelf above its eyes: jump to see over the edge.
    if (s.y > this.eye().y - 0.3) {
      const f = this.feet();
      this.ctl.yaw = Math.atan2(-(s.x - f.x), -(s.z - f.z));
      this.ctl.jump = true;
      for (let t = 0; t < 30; t++) {
        yield;
        if (t % 5 === 4) this.look();
      }
    }
    if (there) this.team.looked.set(i, this.squad.tick);
    this.searchKey = '';
    return true;
  }

  // ---------------------------------------------------------------- jobs: building

  private holdingBrick(): Assembly | undefined {
    const p = this.me();
    const sim = this.squad.game.sim;
    const a = p?.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    return a && isLooseBrick(a) ? a : undefined;
  }

  /** Whether what is in hand is this part. */
  private holds(type: BrickTypeId, colour: ColourId, prints?: Prints): boolean {
    const a = this.holdingBrick();
    const b = a?.grid.bricks.values().next().value;
    return !!b && b.type === type && b.colour === colour && printKey(b.prints) === printKey(prints);
  }

  private *buildOne(brick: Wanted): Job {
    const key = brickKey(brick);
    this.squad.claims.set(this.id, { key, brick, since: this.squad.tick });
    try {
      const got = yield* this.fetch(brick.type, brick.colour, brick.prints);
      if (!got) {
        this.squad.trace?.(this.id, `could not get ${key}`);
        this.failed(`brick|${key}`, 15);
        return false;
      }
      const placed = yield* this.place(brick);
      if (!placed) {
        this.failed(`brick|${key}`, 20);
        const f = this.feet();
        this.squad.trace?.(
          this.id,
          `could not place ${key} from ${f.x.toFixed(1)},${f.y.toFixed(1)},${f.z.toFixed(1)}`,
        );
      }
      return placed;
    } finally {
      this.squad.claims.delete(this.id);
    }
  }

  /** Gets this part into its hands: one lying about, or out of the brick works. */
  private *fetch(type: BrickTypeId, colour: ColourId, prints?: Prints): Job {
    if (this.holds(type, colour, prints)) return true;
    if (this.me()!.holding) yield* this.throwAway();
    const sim = this.squad.game.sim;
    // A loose one close by (off a broken build, say).
    const me = this.feet();
    const loose = [...sim.assemblies.values()]
      .filter(
        (a) => isLooseBrick(a) && a.heldBy === null && !a.frozen && !this.avoided(`loose|${a.id}`),
      )
      .filter((a) => {
        const b = a.grid.bricks.values().next().value!;
        return b.type === type && b.colour === colour && printKey(b.prints) === printKey(prints);
      })
      .filter(
        (a) =>
          length(sub(a.body.translation(), me)) < 9 && sim.mayUse(this.me()!, a.body.translation()),
      )
      .sort(
        (a, b) => length(sub(a.body.translation(), me)) - length(sub(b.body.translation(), me)),
      )[0];
    if (loose) {
      const id = loose.id;
      const ok = yield* this.use(
        {
          key: `loose|${id}`,
          point: () => {
            const a = sim.assemblies.get(id);
            return a && a.heldBy === null ? a.body.worldCom() : null;
          },
          ok: (o) => o.kind === 'brick' && o.assemblyId === id,
        },
        { kind: 'grab' },
        0.9,
      );
      if (ok && this.holds(type, colour, prints)) return true;
      this.failed(`loose|${id}`, 30);
    }
    if (prints) {
      if (!(yield* this.mould(type, colour))) return false;
      return yield* this.print(type, prints);
    }
    return yield* this.mould(type, colour);
  }

  /** A moulding machine's front, as somewhere to click. */
  private machineTarget(id: number): Target {
    const sim = this.squad.game.sim;
    const m = sim.machines.get(id)!;
    const turn = yawQuat(m.def.facing);
    const height = Math.min(1, machinePose(m.def).half.y * 1.6);
    const point = add(machineFront(m.def), rotate(turn, v3(0, height, -0.05)));
    return {
      key: `machine|${id}`,
      point: () => point,
      ok: (o) => o.kind === 'machine' && o.machineId === id,
    };
  }

  private machinesOf(kind: string): number[] {
    const sim = this.squad.game.sim;
    const p = this.me()!;
    return [...sim.machines.values()]
      .filter((m) => m.def.kind === kind && sim.mayUse(p, m.def.pos))
      .map((m) => m.def.id);
  }

  /**
   * Makes a part at a moulding machine, setting one up for it if none makes it already: the
   * machine that needs the fewest trips (a new mould keeps the pellets in it), and not one
   * making something another bot is fetching. With both machines busy being set up, it fetches
   * the mould meanwhile and waits for one.
   */
  private *mould(type: BrickTypeId, colour: ColourId): Job {
    const sim = this.squad.game.sim;
    const presses = (): MachineState[] => {
      const me = this.feet();
      return this.machinesOf('press')
        .map((id) => sim.machines.get(id)!)
        .sort((a, b) => length(sub(a.def.pos, me)) - length(sub(b.def.pos, me)));
    };
    const makes = (m: MachineState): boolean =>
      m.mould === type && m.colour === colour && m.shots > 0;
    const free = (m: MachineState): boolean => {
      const by = this.squad.presses.get(m.def.id);
      return by === undefined || by === this.id || !this.squad.bots.has(by);
    };
    let press = presses().find(makes);
    for (let wait = 0; !press && wait < 2; wait++) {
      const wanted = new Set(
        [...this.squad.claims]
          .filter(([id]) => id !== this.id)
          .map(([, c]) => `${c.brick.type}|${c.brick.colour}`),
      );
      const trips = (m: MachineState): number =>
        (m.mould === type ? 0 : 1) +
        (m.colour === colour && m.shots > 0 ? 0 : 1) +
        (m.shots > 0 && wanted.has(`${m.mould}|${m.colour}`) ? 3 : 0);
      const choice = presses()
        .filter(free)
        .sort((a, b) => trips(a) - trips(b))[0];
      if (!choice) {
        // Both being set up: get the mould meanwhile, then wait by the machines for one.
        if (!(yield* this.getMould(type))) return false;
        const near = presses()[0];
        if (near)
          yield* this.walk(
            this.stands(this.machineTarget(near.def.id).point()!, () => true, 1.6).slice(0, 3),
            undefined,
            20,
          );
        for (let k = 0; k < 20 * 60 && !presses().some((m) => free(m) || makes(m)); k += 10) {
          for (let t = 0; t < 10; t++) yield;
        }
        press = presses().find(makes);
        continue;
      }
      this.squad.presses.set(choice.def.id, this.id);
      try {
        if (choice.mould !== type) {
          if (!(yield* this.getMould(type))) return false;
          if (!(yield* this.use(this.machineTarget(choice.def.id), { kind: 'grab' }))) return false;
          if (choice.mould !== type) return false;
        }
        if (choice.colour !== colour || choice.shots <= 0) {
          if (!(yield* this.getPellets(colour))) return false;
          if (!(yield* this.use(this.machineTarget(choice.def.id), { kind: 'grab' }))) return false;
          if (choice.colour !== colour) return false;
        }
      } finally {
        this.squad.presses.delete(choice.def.id);
      }
      press = choice;
    }
    if (!press || !makes(press)) return false;
    yield* this.use(this.machineTarget(press.def.id), { kind: 'grab' });
    return this.holds(type, colour);
  }

  private *getMould(type: BrickTypeId): Job {
    const p = this.me()!;
    if (p.tool?.kind === 'mould' && p.tool.type === type) return true;
    if (p.tool) {
      this.act({ kind: 'drop' });
      yield;
    }
    const id = this.machinesOf('dispenser')[0];
    if (id === undefined) return false;
    yield* this.use(this.machineTarget(id), { kind: 'mould', type });
    const t = this.me()?.tool;
    return t?.kind === 'mould' && t.type === type;
  }

  private *getPellets(colour: ColourId): Job {
    const p = this.me()!;
    if (p.tool?.kind === 'bucket' && p.tool.colour === colour) return true;
    if (p.tool) {
      this.act({ kind: 'drop' });
      yield;
    }
    const id = this.machinesOf('silo')[0];
    if (id === undefined) return false;
    yield* this.use(this.machineTarget(id), { kind: 'fill', colour });
    const t = this.me()?.tool;
    return t?.kind === 'bucket' && t.colour === colour;
  }

  /** Takes the part in hand to the UV printer and has these pictures printed on it. */
  private *print(type: BrickTypeId, prints: Prints): Job {
    const sim = this.squad.game.sim;
    const job = sim.printJobs.findIndex(
      (j) => j.type === type && printKey(j.prints) === printKey(prints),
    );
    const id = this.machinesOf('printer')[0];
    if (job < 0 || id === undefined) return false;
    const printer = sim.machines.get(id)!;
    for (let k = 0; k < 240 && printer.part; k++) yield;
    if (printer.part) return false;
    yield* this.use(this.machineTarget(id), { kind: 'grab' });
    if (!printer.part) return false;
    yield* this.use(this.machineTarget(id), { kind: 'print', job });
    return !!this.holdingBrick();
  }

  /** Where the target brick would sit, in the world. */
  private brickWorld(b: Placement): Vec3 {
    const sim = this.squad.game.sim;
    return sim.brickPose(sim.build(this.site), b).pos;
  }

  /**
   * How to put the brick in hand exactly where `b` goes from where the bot stands: view angles
   * and the quarter turns of the brick in hand, found by trying aims around the spot it sits on
   * and asking the sim where each would snap. A brick bridging a gap, with nothing under its
   * middle to aim at, goes on the way a player puts it: aim at a top face at its height, hold
   * Shift to lock snapping to that layer, then aim at where it goes (`lock` is the first aim).
   */
  private placement(b: Wanted): PlaceAim | null {
    const p = this.me();
    const sim = this.squad.game.sim;
    const build = sim.build(this.site);
    if (!p?.holding || build.heldBy !== null || build.grid.overlaps(b)) return null;
    const eye = sim.eye(p);
    const pos = build.body.translation();
    const rot = build.body.rotation();
    const { w, d } = footprint(b.type, b.rot);
    const cx = b.x + w / 2;
    const cz = b.z + d / 2;
    const local: Vec3[] = [];
    if (b.face) {
      // Clipped on sideways: aim at the side face it clips onto, behind its middle.
      const box = partBox(b);
      const v = faceVector(b.face);
      const plane = v.x ? (v.x > 0 ? box.x0 : box.x1) : v.z > 0 ? box.z0 : box.z1;
      const up = ((box.y0 + box.y1) / 2) * PLATE_H;
      const mid = v.x ? (box.z0 + box.z1) / 2 : (box.x0 + box.x1) / 2;
      for (const [da, du] of [
        [0, 0],
        [0.25, 0],
        [-0.25, 0],
        [0, 0.02],
        [0, -0.02],
      ] as const) {
        const inside = plane - 0.03 * (v.x || v.z);
        local.push(
          v.x
            ? v3(inside * STUD, up + du, (mid + da) * STUD)
            : v3((mid + da) * STUD, up + du, inside * STUD),
        );
      }
    }
    const y = b.y * PLATE_H;
    for (const [ox, oz] of [
      [0, 0],
      [0.25, 0],
      [-0.25, 0],
      [0, 0.25],
      [0, -0.25],
      [0.3, 0.3],
      [-0.3, -0.3],
      [0.3, -0.3],
      [-0.3, 0.3],
      [0.6, 0],
      [-0.6, 0],
      [0, 0.6],
      [0, -0.6],
    ] as const) {
      local.push(v3((cx + ox) * STUD, y, (cz + oz) * STUD));
    }
    const angles = (l: Vec3): { yaw: number; pitch: number } | null => {
      const dv = sub(add(pos, rotate(rot, l)), eye);
      if (length(dv) > REACH + 0.3) return null;
      const yaw = Math.atan2(-dv.x, -dv.z);
      const pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, Math.atan2(dv.y, Math.hypot(dv.x, dv.z))),
      );
      return { yaw, pitch };
    };
    const saved = {
      yaw: p.input.yaw,
      pitch: p.input.pitch,
      firstPerson: p.input.firstPerson,
      lock: p.snapLock,
    };
    const turn = p.holding.rot;
    const fits = (a: { yaw: number; pitch: number }, k: number): boolean => {
      Object.assign(p.input, { yaw: a.yaw, pitch: a.pitch, firstPerson: true });
      p.holding!.rot = ((turn + k) % 4) as Rotation;
      // The click must not land on something it would use instead (a button behind the spot).
      const hit = sim.aim(p);
      if (hit && !['brick', 'static', 'player'].includes(hit.owner.kind)) return false;
      const preview = sim.snapPreview(p);
      const got = preview?.bricks[0]?.placement;
      if (!preview || preview.targetId !== build.id || preview.bricks.length !== 1 || !got)
        return false;
      return got.type === b.type && sameCells(got as TargetBrick, b);
    };
    try {
      for (const l of local) {
        const a = angles(l);
        if (!a) continue;
        for (let k = 0; k < 4; k++) if (fits(a, k)) return { ...a, turns: k };
      }
      if (b.face) return null;
      // Locked to the layer: an aim at a top face at the brick's height, then the spot itself.
      const anchors: Vec3[] = [];
      for (const o of build.grid.bricks.values()) {
        if (o.y + BRICK_TYPES[o.type].plates !== b.y || o.face) continue;
        const f = footprint(o.type, o.rot);
        for (let x = o.x; x < o.x + f.w; x++) {
          for (let z = o.z; z < o.z + f.d; z++) {
            // Cells under the brick, or right next to it.
            if (x < b.x - 1 || x > b.x + w || z < b.z - 1 || z > b.z + d) continue;
            anchors.push(v3((x + 0.5) * STUD, y, (z + 0.5) * STUD));
          }
        }
      }
      anchors.sort(
        (u, v) =>
          Math.hypot(u.x / STUD - cx, u.z / STUD - cz) -
          Math.hypot(v.x / STUD - cx, v.z / STUD - cz),
      );
      const spot = angles(v3(cx * STUD, y, cz * STUD));
      if (!spot) return null;
      for (const l of anchors.slice(0, 12)) {
        const a = angles(l);
        if (!a) continue;
        for (let k = 0; k < 4; k++) {
          p.snapLock = null;
          Object.assign(p.input, { yaw: a.yaw, pitch: a.pitch, firstPerson: true });
          p.holding.rot = ((turn + k) % 4) as Rotation;
          const hit = sim.aim(p);
          if (hit?.owner.kind !== 'brick' || hit.owner.assemblyId !== build.id) break;
          if (rotate(rot, v3(0, 1, 0)).y < 0.9 || hit.normal.y < 0.7) break;
          // The face it lands on must be the one at the brick's height (not something on it).
          const up = rotate(conj(rot), sub(hit.point, pos)).y;
          if (Math.round(up / PLATE_H) !== b.y) break;
          if (!sim.snapPreview(p)) continue;
          p.snapLock = { y: b.y, down: false, targetId: build.id };
          if (fits(spot, k)) return { ...spot, turns: k, lock: a };
        }
      }
    } finally {
      Object.assign(p.input, {
        yaw: saved.yaw,
        pitch: saved.pitch,
        firstPerson: saved.firstPerson,
      });
      p.snapLock = saved.lock;
      p.holding.rot = turn;
    }
    return null;
  }

  /** Puts the brick in hand on the build where `b` goes. */
  private *place(b: Wanted): Job {
    const sim = this.squad.game.sim;
    const nav = this.squad.nav;
    const tried = new Set<number>();
    const placed = (): boolean =>
      [...sim.build(this.site).grid.bricks.values()].some(
        (x) => x.type === b.type && sameCells(x, b),
      );
    for (let attempt = 0; attempt < 4; attempt++) {
      if (!this.holdingBrick()) return false;
      let sol = this.placement(b);
      if (!sol) {
        const at = this.brickWorld(b);
        const me = this.feet();
        const centre = sim.buildCentre(sim.build(this.site));
        // Stand on the brick's side of the build, looking down on where it goes.
        const goals = nav
          .around(at, 2.1, 2.4, 0.4)
          .filter(
            (n) =>
              !tried.has(n) &&
              !this.overPlate(nav.xs[n]!, nav.ys[n]!, nav.zs[n]!) &&
              this.holdClear(nav.pos(n), at),
          )
          .map((n) => {
            const flat = Math.hypot(nav.xs[n]! - at.x, nav.zs[n]! - at.z);
            const fromCentre = Math.hypot(nav.xs[n]! - centre.x, nav.zs[n]! - centre.z);
            const fromMe = Math.hypot(nav.xs[n]! - me.x, nav.zs[n]! - me.z);
            // A part clipped on sideways is put on from the side it faces.
            let side = 0;
            if (b.face) {
              const v = rotate(sim.build(this.site).body.rotation(), faceVector(b.face));
              side = (nav.xs[n]! - at.x) * v.x + (nav.zs[n]! - at.z) * v.z > 0.3 ? 0 : 2;
            }
            return {
              n,
              score: Math.abs(flat - 0.95) - 0.3 * Math.min(fromCentre, 1.6) + 0.05 * fromMe + side,
            };
          })
          .sort((x, y) => x.score - y.score)
          .slice(0, 3)
          .map((s) => s.n);
        if (!goals.length) return false;
        for (const g of goals) tried.add(g);
        yield* this.walk(goals, () => !!this.placement(b) || !!this.placementFrom(b, JUMP_LIFT));
      }
      // Stand still, Shift up (it may be down from running, and no layer may stay locked from
      // before), and find the aim again from where it stopped.
      this.halt();
      for (let k = 0; k < 30; k++) {
        yield;
        const me = this.me();
        const v = me?.body.linvel();
        if (me?.grounded && v && Math.hypot(v.x, v.y, v.z) < 0.05 && k >= 2) break;
      }
      yield* this.afford(4);
      sol = this.placement(b);
      if (!sol) {
        // Too high to see from the floor: jump and put it on at the top of the jump, from far
        // enough off that the part in its hands does not sweep through the build going up.
        if (!this.jumpSafe()) yield* this.backOff();
        if (this.jumpSafe() && (yield* this.jumpPlace(b))) return true;
        continue;
      }
      for (let k = 0; k < sol.turns; k++)
        this.act({ kind: 'rotate' }, this.view.yaw, this.view.pitch);
      if (sol.lock) {
        // Aim at the layer, hold Shift to lock onto it, then aim where the brick goes.
        yield* this.face(sol.lock.yaw, sol.lock.pitch);
        this.ctl.sprint = true;
        yield;
        yield;
      }
      yield* this.face(sol.yaw, sol.pitch);
      // Still where it was (nothing moved it, it did not slip off something)?
      const again = sol.lock ? this.lockedAim(b, sol) : this.placement(b);
      if (
        !again ||
        again.turns !== 0 ||
        Math.abs(again.yaw - sol.yaw) > 0.02 ||
        Math.abs(again.pitch - sol.pitch) > 0.02
      ) {
        this.ctl.sprint = false;
        continue;
      }
      this.act({ kind: 'place' }, again.yaw, again.pitch);
      yield;
      yield;
      this.ctl.sprint = false;
      if (placed()) return true;
    }
    return false;
  }

  /** With a layer locked: whether the aim found still puts `b` where it goes from here. */
  private lockedAim(b: Wanted, sol: PlaceAim): PlaceAim | null {
    const p = this.me();
    const sim = this.squad.game.sim;
    if (!p?.holding || !p.snapLock) return null;
    const saved = { yaw: p.input.yaw, pitch: p.input.pitch };
    Object.assign(p.input, { yaw: sol.yaw, pitch: sol.pitch });
    try {
      const got = sim.snapPreview(p)?.bricks[0]?.placement;
      const hit = sim.aim(p);
      if (hit && !['brick', 'static', 'player'].includes(hit.owner.kind)) return null;
      return got && got.type === b.type && sameCells(got as TargetBrick, b)
        ? { yaw: sol.yaw, pitch: sol.pitch, turns: 0 }
        : null;
    } finally {
      Object.assign(p.input, saved);
    }
  }

  /** Where it would aim to place `b` if it stood `lift` higher (at the top of a jump). */
  private placementFrom(b: Wanted, lift: number): PlaceAim | null {
    const p = this.me();
    if (!p) return null;
    const t = p.body.translation();
    p.body.setTranslation(v3(t.x, t.y + lift, t.z), false);
    try {
      return this.placement(b);
    } finally {
      p.body.setTranslation(t, false);
    }
  }

  /** The view angles at the middle of where `b` goes, from where the eye is now. */
  private spotAim(b: Wanted): { yaw: number; pitch: number } {
    const sim = this.squad.game.sim;
    const build = sim.build(this.site);
    const { w, d } = footprint(b.type, b.rot);
    const at = add(
      build.body.translation(),
      rotate(build.body.rotation(), v3((b.x + w / 2) * STUD, b.y * PLATE_H, (b.z + d / 2) * STUD)),
    );
    const dv = sub(at, sim.eye(this.me()!));
    return {
      yaw: Math.atan2(-dv.x, -dv.z),
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(dv.y, Math.hypot(dv.x, dv.z)))),
    };
  }

  /** Whether it looks (nearly) this way now. */
  private looking(a: { yaw: number; pitch: number }): boolean {
    const d = Math.atan2(Math.sin(a.yaw - this.view.yaw), Math.cos(a.yaw - this.view.yaw));
    return Math.abs(d) < 0.005 && Math.abs(a.pitch - this.view.pitch) < 0.005;
  }

  /**
   * Jumps and places `b` in the air, where only the top of a jump gives a view of where it
   * goes; locking onto the layer (Shift) mid-jump when that is how it goes on.
   */
  private *jumpPlace(b: Wanted): Job {
    yield* this.afford(5);
    const sol = this.placementFrom(b, JUMP_LIFT);
    if (!sol) return false;
    const sim = this.squad.game.sim;
    const placed = (): boolean =>
      [...sim.build(this.site).grid.bricks.values()].some(
        (x) => x.type === b.type && sameCells(x, b),
      );
    for (let k = 0; k < sol.turns; k++)
      this.act({ kind: 'rotate' }, this.view.yaw, this.view.pitch);
    yield* this.face((sol.lock ?? sol).yaw, (sol.lock ?? sol).pitch);
    this.ctl.jump = true;
    try {
      for (let k = 0; k < 55; k++) {
        yield;
        const p = this.me();
        if (!p?.holding) return false;
        if (p.snapLock && p.snapLock.y === b.y && !p.snapLock.down) {
          // Locked onto the layer: turn to where it goes and put it there.
          const spot = this.spotAim(b);
          this.ctl.yaw = spot.yaw;
          this.ctl.pitch = spot.pitch;
          if (this.looking(spot) && this.lockedAim(b, { ...spot, turns: 0 })) {
            this.act({ kind: 'place' }, spot.yaw, spot.pitch);
            yield;
            yield;
            return placed();
          }
          continue;
        }
        const now = this.placement(b);
        if (now && now.turns === 0 && !now.lock) {
          this.act({ kind: 'place' }, now.yaw, now.pitch);
          yield;
          yield;
          return placed();
        }
        if (now?.lock && now.turns === 0) {
          this.ctl.yaw = now.lock.yaw;
          this.ctl.pitch = now.lock.pitch;
          if (this.looking(now.lock)) this.ctl.sprint = true;
          continue;
        }
        // Keep looking where it will be able to aim from, higher up.
        const ahead = this.placementFrom(b, Math.max(0, JUMP_LIFT - this.lifted()));
        if (ahead && ahead.turns === 0) {
          this.ctl.yaw = (ahead.lock ?? ahead).yaw;
          this.ctl.pitch = (ahead.lock ?? ahead).pitch;
        }
      }
      return false;
    } finally {
      this.ctl.sprint = false;
    }
  }

  /**
   * Whether the part in its hands stays clear of the build with the bot standing at `feet`
   * facing `toward`: carried at chest height, it would knock into a tall build's upper bricks.
   */
  private holdClear(feet: Vec3, toward: Vec3): boolean {
    const sim = this.squad.game.sim;
    const p = this.me();
    const held = p?.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (!held) return true;
    const hb = held.grid.bricks.values().next().value!;
    const hf = footprint(hb.type, hb.rot);
    const long = (Math.max(hf.w, hf.d) * STUD) / 2;
    const dx = toward.x - feet.x;
    const dz = toward.z - feet.z;
    const d = Math.hypot(dx, dz) || 1;
    const out = 0.27 + long;
    const hold = v3(feet.x + (dx / d) * out, feet.y + FEET + 0.15, feet.z + (dz / d) * out);
    const build = sim.build(this.site);
    for (const b of build.grid.bricks.values()) {
      if (BRICK_TYPES[b.type].fixture) continue;
      const pos = sim.brickPose(build, b).pos;
      if (Math.abs(pos.y - hold.y) > 0.2) continue;
      const f = footprint(b.type, b.rot);
      if (Math.hypot(pos.x - hold.x, pos.z - hold.z) < long + (Math.max(f.w, f.d) * STUD) / 2 + 0.1)
        return false;
    }
    return true;
  }

  /** Whether the part in its hands, going up a jump's height, stays clear of the build. */
  private jumpSafe(): boolean {
    const sim = this.squad.game.sim;
    const p = this.me();
    const held = p?.holding ? sim.assemblies.get(p.holding.assemblyId) : undefined;
    if (!held) return true;
    const hp = held.body.translation();
    const hb = held.grid.bricks.values().next().value!;
    const hf = footprint(hb.type, hb.rot);
    const hr = (Math.max(hf.w, hf.d) * STUD) / 2;
    const build = sim.build(this.site);
    for (const b of build.grid.bricks.values()) {
      if (BRICK_TYPES[b.type].fixture) continue;
      const pos = sim.brickPose(build, b).pos;
      const f = footprint(b.type, b.rot);
      const br = (Math.max(f.w, f.d) * STUD) / 2;
      if (pos.y < hp.y - 0.15 || pos.y > hp.y + 1.1) continue;
      if (Math.hypot(pos.x - hp.x, pos.z - hp.z) < hr + br + 0.05) return false;
    }
    return true;
  }

  /** Steps back from the build a little. */
  private *backOff(): Job {
    const sim = this.squad.game.sim;
    const nav = this.squad.nav;
    const centre = sim.buildCentre(sim.build(this.site));
    const me = this.feet();
    const d = Math.hypot(me.x - centre.x, me.z - centre.z) || 1;
    const to = v3(me.x + ((me.x - centre.x) / d) * 0.4, me.y, me.z + ((me.z - centre.z) / d) * 0.4);
    const n = nav.closest(to, 0.4, 0.4);
    if (n === null) return false;
    yield* this.walk([n], undefined, 5);
    this.halt();
    for (let k = 0; k < 10; k++) yield;
    return true;
  }

  /** How far above the floor its feet are now (mid-jump). */
  private lifted(): number {
    const feet = this.feet();
    const n = this.squad.nav.locate(feet);
    return n === null ? 0 : Math.max(0, feet.y - this.squad.nav.ys[n]!);
  }

  /** Takes a wrong brick off the build (and puts the right one on, when it knows which). */
  private *fixBrick(b: Wanted & { actualId?: number }): Job {
    const sim = this.squad.game.sim;
    const id = b.actualId!;
    const build = sim.build(this.site);
    const ok = yield* this.use(
      {
        key: `fix|${id}`,
        point: () => {
          const x = build.grid.bricks.get(id);
          return x ? sim.brickPose(build, x).pos : null;
        },
        ok: (o) => o.kind === 'brick' && o.assemblyId === build.id && o.brickId === id,
      },
      { kind: 'pull' },
      1,
    );
    if (!ok || !this.holdingBrick()) {
      this.failed(`fix|${id}`, 30);
      return false;
    }
    // Away from the build with it.
    yield* this.throwAway();
    return true;
  }

  /** Walks to the Done button and presses it twice. */
  private *pressDone(): Job {
    const sim = this.squad.game.sim;
    const round = this.squad.game.round!;
    const site = levelSites(sim.level)[this.site]!;
    const point = add(site.doneButton, v3(0, 0.85, 0));
    const t: Target = {
      key: 'done',
      point: () => point,
      ok: (o) => o.kind === 'button' && o.buttonId === 'done' && o.site === this.site,
    };
    // Someone else is on it already.
    if ([...this.squad.bots.values()].some((b) => b !== this && b.doing === 'press Done')) {
      for (let k = 0; k < 60; k++) yield;
      return false;
    }
    if (!(yield* this.use(t, { kind: 'grab' }))) return false;
    this.say('That is all of it. Pressing Done!');
    for (let k = 0; k < 20; k++) yield;
    if (round.phase === 'building' && round.doneArmedFor(this.site))
      yield* this.use(t, { kind: 'grab' });
    return true;
  }

  // ---------------------------------------------------------------- meetings: calling one

  /** Whether it is sure enough of someone to ring the bell. */
  private mayAccuse(): boolean {
    const round = this.squad.game.round!;
    if (round.rival || round.mode === 'gear' || !this.squad.game.sim.bell) return false;
    if ((round.meetingsLeft.get(this.id) ?? 0) <= 0) return false;
    if ([...this.squad.bots.values()].some((b) => b !== this && b.doing === 'ring the bell'))
      return false;
    return this.accused() !== null;
  }

  private accused(): number | null {
    const round = this.squad.game.round!;
    let best: number | null = null;
    let top = 0;
    for (const id of round.onSite) {
      if (id === this.id) continue;
      const s = this.squad.suspicion.get(id) ?? 0;
      if (s > top) {
        top = s;
        best = id;
      }
    }
    return top >= this.skill.accuse ? best : null;
  }

  private *ringBell(): Job {
    const sim = this.squad.game.sim;
    const who = this.accused();
    const site = levelSites(sim.level)[this.site]!;
    const point = add(site.bell, v3(0, 0.85, 0));
    const ok = yield* this.use(
      {
        key: 'bell',
        point: () => point,
        ok: (o) => o.kind === 'button' && o.buttonId === 'bell',
      },
      { kind: 'grab' },
    );
    if (ok && who !== null) this.say(`I think it is ${this.nameOf(who)}.`);
    return ok;
  }

  // ---------------------------------------------------------------- saboteur

  private cooldown(tool: SabotageTool): number {
    return this.squad.game.round!.cooldown(this.id, tool);
  }

  /** A saboteur's next trick, if now is the moment for one; otherwise it helps out like anyone. */
  private mischief(): Job | null {
    const round = this.squad.game.round!;
    const sim = this.squad.game.sim;
    const p = this.me()!;
    const mood = this.skill.mischief;
    // Not in the first half minute: everyone is still finding their feet.
    if (this.roundTicks < 30 * 60) return null;
    if (p.page !== null) {
      const page = sim.pages.get(p.page);
      const printed = page?.printed;
      if (printed && this.watchers(p.body.translation()) === 0 && this.random() < 0.85 * mood) {
        return this.named('hide a page', this.hidePage());
      }
      if (printed && printed.step >= 0 && printed.half !== 'A' && this.cooldown('forge') === 0) {
        return this.named('forge a page', this.forge());
      }
      return null;
    }
    const build = sim.build(this.site);
    const centre = sim.buildCentre(build);
    const bricks = build.grid.size - 1;
    const late = round.timeLeft < 150;
    // Tripping into the build leaves no tell, so it is worth most once there is a lot to break.
    const charges = round.chargesLeft(this.id, 'clumsy') ?? 0;
    const tall =
      bricks >= Math.max(20, 0.4 * round.target.steps.reduce((n, s) => n + s.bricks.length, 0));
    const people = round.onSite.some(
      (id) => round.role(id) !== 'saboteur' && !this.squad.game.clients.get(id)?.bot,
    );
    const trip = late ? 0.5 : people ? this.skill.tripVsPeople : this.skill.trip;
    // One trip while it builds up; the last is kept for the end.
    if (
      charges > 0 &&
      bricks >= 10 &&
      (late || (tall && charges > 1)) &&
      this.random() < trip * mood
    ) {
      return this.named('trip into the build', this.clumsy(centre));
    }
    if (bricks >= 4 && this.cooldown('swap') === 0 && this.random() < Math.min(1, 0.6 * mood)) {
      return this.named('swap a brick', this.swap());
    }
    if (this.cooldown('trap') === 0 && this.random() < 0.3 * mood) {
      return this.named('drop a trap', this.trap());
    }
    // Pages pinned on the board: take one away to hide it.
    const pinned = [...sim.pages.values()].filter((pg) => pg.pinned !== null && pg.body);
    if (pinned.length && this.random() < 0.35 * mood) {
      const pg = pinned[Math.floor(this.random() * pinned.length)]!;
      return this.named('take a page', this.takePinned(pg.id));
    }
    return null;
  }

  /** Waits until nobody but fellow saboteurs is close (up to `seconds`); returns whether it got its moment. */
  private *alone(seconds: number, at?: Vec3): Job {
    const end = this.squad.tick + seconds * 60;
    while (this.squad.tick < end) {
      const me = this.me()!.body.translation();
      if (this.watchers(me) === 0 && (!at || this.watchers(at) === 0)) return true;
      yield;
    }
    return false;
  }

  /** Puts the page in its pocket into a hiding place nobody is near. */
  private *hidePage(): Job {
    const sim = this.squad.game.sim;
    const me = this.feet();
    const options = [...sim.hideouts.values()]
      .filter(
        (h) => !h.locked && (sim.sideOf(h.def.pos) === null || sim.sideOf(h.def.pos) === this.site),
      )
      .filter((h) => this.watchers(h.def.pos) === 0 && !this.avoided(`hideout|${h.def.id}`))
      .map((h) => ({ h, d: length(sub(h.def.pos, me)) }))
      // Not right where it was found, and not across the map either.
      .filter(({ d }) => d > 2 && d < 14)
      .sort((a, b) => a.d - b.d);
    const pick = options[Math.floor(this.random() * Math.min(3, options.length))];
    if (!pick) return false;
    const id = pick.h.def.id;
    const centre = pick.h.def.pos;
    const ok = yield* this.use(
      {
        key: `hideout|${id}`,
        point: () => centre,
        ok: (o) => o.kind === 'hideout' && o.hideoutId === id,
      },
      { kind: 'grab' },
    );
    return ok && this.me()?.page === null;
  }

  private *forge(): Job {
    if (!(yield* this.alone(10))) return false;
    this.act({ kind: 'sabotage', tool: 'forge' });
    yield;
    yield;
    const p = this.me()!;
    const page = p.page === null ? undefined : this.squad.game.sim.pages.get(p.page);
    // Tells the others what the forgery says, as if it were the real page.
    if (page?.printed) this.team.tell(page.printed, this.id);
    return yield* this.pocketPage();
  }

  /** Swaps a brick of the build for its look-alike while nobody is watching. */
  private *swap(): Job {
    const sim = this.squad.game.sim;
    const build = sim.build(this.site);
    const centre = sim.buildCentre(build);
    const stands = this.squad.nav
      .around(centre, 1.9, 1.5, 0.5)
      .filter(
        (n) => Math.hypot(this.squad.nav.xs[n]! - centre.x, this.squad.nav.zs[n]! - centre.z) > 1.1,
      );
    if (!stands.length) return false;
    const goal = stands[Math.floor(this.random() * stands.length)]!;
    yield* this.walk([goal], undefined, 25);
    if (!(yield* this.alone(8))) return false;
    // A brick in view that has a look-alike colour; one of the earlier steps, already checked.
    const bricks = [...build.grid.bricks.values()].filter((b) => !BRICK_TYPES[b.type].fixture);
    const order = this.skill.cunning
      ? // Low down first (a little shuffled): the higher bricks have to come off to fix it.
        bricks
          .map((b) => ({ b, k: b.y + this.random() * 4 }))
          .sort((x, y) => x.k - y.k)
          .map(({ b }) => b)
      : bricks.sort(() => this.random() - 0.5);
    for (const b of order.slice(0, 12)) {
      const at = sim.brickPose(build, b).pos;
      const sol = this.aim(
        at,
        (o) => o.kind === 'brick' && o.assemblyId === build.id && o.brickId === b.id,
      );
      if (!sol) continue;
      // The tell shows where the brick is, which can be in sight of someone who cannot see it.
      if (!(yield* this.alone(4, at))) return false;
      this.act({ kind: 'sabotage', tool: 'swap' }, sol.yaw, sol.pitch);
      yield;
      yield;
      return true;
    }
    return false;
  }

  private *clumsy(centre: Vec3): Job {
    const nav = this.squad.nav;
    const stands = nav
      .around(centre, 1.7, 1.5, 0.5)
      .filter((n) => Math.hypot(nav.xs[n]! - centre.x, nav.zs[n]! - centre.z) > 1.0);
    if (!stands.length) return false;
    yield* this.walk(stands.slice(0, 4), undefined, 20);
    // A trip looks like anyone's: only a careless saboteur waits to be alone for it.
    if (!this.skill.bold && !(yield* this.alone(6))) return false;
    const f = this.feet();
    this.ctl.yaw = Math.atan2(-(centre.x - f.x), -(centre.z - f.z));
    this.ctl.pitch = -0.3;
    yield;
    this.act({ kind: 'sabotage', tool: 'clumsy' });
    yield;
    return true;
  }

  /** Spills a few bricks on the busy way between the brick works and the build. */
  private *trap(): Job {
    const sim = this.squad.game.sim;
    const presses = this.machinesOf('press').map((id) => machineFront(sim.machines.get(id)!.def));
    if (!presses.length) return false;
    const centre = sim.buildCentre(sim.build(this.site));
    const press = presses[Math.floor(this.random() * presses.length)]!;
    const mid = add(centre, scale(sub(press, centre), 0.35 + this.random() * 0.3));
    const n = this.squad.nav.closest(v3(mid.x, centre.y - 0.3, mid.z), 1.5, 1);
    if (n === null) return false;
    yield* this.walk([n], undefined, 20);
    if (!(yield* this.alone(5))) return false;
    this.ctl.yaw = Math.atan2(-(centre.x - mid.x), -(centre.z - mid.z));
    this.act({ kind: 'sabotage', tool: 'trap' });
    yield;
    return true;
  }

  private *takePinned(id: number): Job {
    const sim = this.squad.game.sim;
    const page = sim.pages.get(id);
    if (!page?.body) return false;
    const at = page.body.translation();
    if (this.watchers(at) > 0) return false;
    return yield* this.use(
      {
        key: `page|${id}`,
        point: () => {
          const pg = sim.pages.get(id);
          return pg?.body && pg.pinned !== null ? pg.body.translation() : null;
        },
        ok: (o) => o.kind === 'page' && o.pageId === id,
      },
      { kind: 'grab' },
      0.9,
    );
  }
}

/** Whether two parts' footprints overlap, seen from above. */
function underlaps(a: TargetBrick, b: TargetBrick): boolean {
  const fa = footprint(a.type, a.rot);
  const fb = footprint(b.type, b.rot);
  return a.x < b.x + fb.w && b.x < a.x + fa.w && a.z < b.z + fb.d && b.z < a.z + fa.d;
}

function reached(feet: Vec3, to: Vec3): boolean {
  return Math.hypot(feet.x - to.x, feet.z - to.z) < 0.3 && Math.abs(feet.y - to.y) < 0.6;
}
