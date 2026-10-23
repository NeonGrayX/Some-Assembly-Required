import { BASEPLATE_SIZE, BRICK_TYPES, STUD, footprint } from '../bricks.ts';
import { partBox } from '../parts.ts';
import type { ColourId } from '../bricks.ts';
import { MAX_EXTRAS, PASS_FRACTION, matchBuild } from '../builds/match.ts';
import type { MatchResult } from '../builds/match.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { TargetBrick } from '../builds/types.ts';
import { levelSites, machinePose } from '../content/house.ts';
import type { BrickGrid } from '../grid.ts';
import { add, conj, length, makeRng, scale, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { WITNESS_RANGE } from '../round.ts';
import { EYE_OFFSET, TICK_RATE, isLooseBrick } from '../sim/sim.ts';
import type { Action, ColliderOwner, Player, SimEvent } from '../sim/sim.ts';
import { ACTIONS_PER_SECOND, ACTION_BURST } from '../net/protocol.ts';
import { FEET, overPlate } from './nav.ts';
import type { PathCosts, Plate, Waypoint } from './nav.ts';
import type { Skill, BotLevel } from './skill.ts';
import type { Squad, Team } from './squad.ts';
import type { Errand } from './talk.ts';
import { BotChat } from './chat.ts';
import { Chores } from './chores.ts';
import { PageJobs } from './pageJobs.ts';
import { Building } from './building.ts';
import { JUMP_LIFT, MAX_PITCH, REACH, brickKey } from './common.ts';
import { BrickMaking } from './making.ts';
import { Sabotage } from './sabotage.ts';

/** A job, run a tick at a time: yields once per tick, returns whether it worked. */
export type Job<T = boolean> = Generator<void, T>;

/** Something to click on: where it is, and what the aim must land on. */
export interface Target {
  key: string;
  point(): Vec3 | null;
  ok(o: ColliderOwner): boolean;
}

/** A brick of the build to put in place, with the step it belongs to. */
export type Wanted = TargetBrick & { step: number };

/** What one bot at a time sees to, by the squad's field naming the bot on it. */
type Duty = 'panelBy' | 'dogBy' | 'jamBy' | 'doneBy' | 'bellBy';

/** How far it turns its view in a tick with something in hand (radians). */
const MAX_TURN = 0.06;

/** A dog unfed this long (of the three minutes before it wrecks the build) gets a treat. */
const DOG_FEED_SECONDS = 120;

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
  jobName = '';
  private rest = 0;
  private seq = 0;
  readonly ctl = {
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
  readonly view = { yaw: 0, pitch: -0.2 };
  /** Clicks it may make now, as the room counts them. */
  private credits = ACTION_BURST;
  readonly random: () => number;
  /** Things that did not work lately, by key, with the tick they may be tried again. */
  private readonly avoid = new Map<string, number>();
  /** Bricks of the build seen correct, by brick id, to notice one swapped. */
  private seenRight = new Map<number, ColourId>();
  /**
   * The one page it remembers, as a player would: its step and what it says. Reading another
   * step's page forgets this one.
   */
  memory: { step: number; added: TargetBrick[]; doubted: boolean } | null = null;
  /** Pages (number and stamp) it read, and whether it saw the stamp is wrong. */
  private readonly doubts = new Map<string, boolean>();
  /** The step whose page it is off to read at the board. */
  wantStep: number | null = null;
  /** The build matched against the page it remembers, once a build version and reading. */
  private recall: { version: number; read: number; result: MatchResult } | null = null;
  private reads = 0;
  private lastCheck = 0;
  private lastLook = 0;
  lastSaid = -Infinity;
  /** Answers to people, each with the tick it is said (a moment to "type" it). */
  replies: { at: number; text: string }[] = [];
  /** Something a person asked it to do, and who asked. */
  errand: { what: Errand; from: number; until: number } | null = null;
  private votedIn = -1;
  private voteAt = 0;
  /** Ticks into a round, so a saboteur does not strike in its first moments. */
  roundTicks = 0;
  /** The tool cooldowns as the round reports them, read when needed. */
  private wanderAt = 0;
  /** Nodes something is in the way of, with the tick to try them again. */
  private readonly blocked = new Map<number, number>();
  /** Talking with people (see `BotChat`). */
  readonly chat: BotChat;
  /** Small jobs (see `Chores`). */
  readonly chores: Chores;
  /** Finding and reading the pages (see `PageJobs`). */
  readonly pageJobs: PageJobs;
  /** Putting bricks on the build (see `Building`). */
  readonly building: Building;
  /** Making bricks at the brick works (see `BrickMaking`). */
  readonly making: BrickMaking;
  /** A saboteur's tricks (see `Sabotage`). */
  readonly sabotage: Sabotage;

  constructor(
    readonly id: number,
    readonly level: BotLevel,
    readonly skill: Skill,
    readonly squad: Squad,
    seed: number,
  ) {
    this.random = makeRng(seed * 7919 + id);
    this.chat = new BotChat(this);
    this.chores = new Chores(this);
    this.pageJobs = new PageJobs(this);
    this.building = new Building(this);
    this.making = new BrickMaking(this);
    this.sabotage = new Sabotage(this);
  }

  /** Drops the job in hand, letting go of what it claimed. */
  stop(): void {
    this.job?.return(undefined as never);
    this.job = null;
  }

  /** A new world: everything it was doing is gone. */
  reset(): void {
    this.stop();
    this.replies = [];
    this.errand = null;
    this.jobName = '';
    this.avoid.clear();
    this.blocked.clear();
    this.seenRight.clear();
    this.memory = null;
    this.doubts.clear();
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
    this.chat.speak();
    if (room.phase !== 'building' || !round) {
      this.stop();
      return;
    }
    const p = this.me();
    if (!p) return;
    // Everyone stands still while the people read their role, and so does the bot.
    if (round.starting) {
      this.halt();
      this.send();
      return;
    }
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
    // Typing an answer: it stands still until it is said, so whoever asked can hear it.
    if (this.replies.length && this.replies[0]!.at - this.squad.tick < 4 * 60) {
      this.halt();
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

  act(a: Action, yaw = this.ctl.yaw, pitch = this.ctl.pitch): void {
    this.acts.push({ a, yaw, pitch });
  }

  /**
   * Waits while it works a machine: it stays at it till its hands are done (and it has taken
   * what it waits there for), moving off or doing anything else meanwhile to no avail.
   */
  *free(): Job {
    for (let k = 0; k < 30 * 60 && this.me()?.work?.machineId != null; k++) yield;
    return true;
  }

  /** Turns to look this way, and waits until it does (and a moment longer, to hold still). */
  *face(yaw: number, pitch: number): Job {
    yield* this.free();
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
  *afford(n: number): Job {
    while (this.credits - this.acts.length < n) yield;
    return true;
  }

  halt(): void {
    Object.assign(this.ctl, { forward: 0, right: 0, jump: false, sprint: false, careful: false });
  }

  say(text: string): void {
    this.squad.trace?.(this.id, `says: ${text}`);
    // Only when people are there to read it, and not too often.
    if (this.squad.tick - this.lastSaid < 8 * 60) return;
    if (!this.chat.peopleHere()) return;
    this.lastSaid = this.squad.tick;
    this.squad.game.handle(this.id, { t: 'chat', text });
  }

  // ---------------------------------------------------------------- chat

  // ---------------------------------------------------------------- the world

  me(): Player | undefined {
    return this.squad.game.sim.players.get(this.id);
  }

  get team(): Team {
    return this.squad.teams[this.site] ?? this.squad.teams[0]!;
  }

  feet(): Vec3 {
    const p = this.me()!;
    return sub(p.body.translation(), v3(0, FEET, 0));
  }

  eye(): Vec3 {
    return this.squad.game.sim.eye(this.me()!);
  }

  nameOf(id: number): string {
    return this.squad.game.clients.get(id)?.name ?? 'someone';
  }

  failed(key: string, seconds = 20): void {
    this.avoid.set(key, this.squad.tick + seconds * 60);
  }

  avoided(key: string): boolean {
    const t = this.avoid.get(key);
    return t !== undefined && t > this.squad.tick;
  }

  /** Players other than its fellow saboteurs within `r` of a point. */
  watchers(at: Vec3, r = WITNESS_RANGE + this.skill.caution): number {
    let n = 0;
    const round = this.squad.game.round!;
    for (const p of this.squad.game.sim.players.values()) {
      if (p.id === this.id || round.partners(this.id).includes(p.id)) continue;
      if (length(sub(p.body.translation(), at)) < r) n++;
    }
    return n;
  }

  /** Every so often: pages in view are noted, and pinned pages close by are read. */
  look(): void {
    const sim = this.squad.game.sim;
    const round = this.squad.game.round!;
    const team = this.team;
    const eye = this.eye();
    const canRead = round.canRead(this.id);
    for (const page of sim.pages.values()) {
      if (!page.body || page.carriedBy !== null) continue;
      const at = page.body.translation();
      if (sim.sideOf(at) !== null && sim.sideOf(at) !== this.site) continue;
      const d = length(sub(at, eye));
      if (page.pinned !== null) {
        if (canRead && d < 3.2 && page.printed && this.visible(eye, at, page.id)) {
          if (!this.saboteur) team.tell(page.printed, this.id, this.spotted(page.printed));
          const step = page.printed.step;
          if (step === this.wantStep || step === this.memory?.step) this.remember(page.printed);
        }
        continue;
      }
      if (d < 10 && this.visible(eye, at, page.id)) {
        team.sightings.set(page.id, { pos: at, tick: this.squad.tick });
        // The page it came to read, lying here: it reads it where it lies.
        if (canRead && d < 3.2 && page.printed?.step === this.wantStep) this.remember(page.printed);
      }
    }
    // The dog with a page in its mouth.
    if (sim.dog.page !== null) {
      const at = sim.dog.body.translation();
      if (length(sub(at, eye)) < 10 && this.visible(eye, at, -1)) team.dogSeen = this.squad.tick;
    }
    // Places pages lie, close by and in view, count as looked at.
    this.pageJobs.spots().forEach((s, i) => {
      if (length(sub(s, eye)) < 2.5 && this.visible(eye, add(s, v3(0, 0.1, 0)), -1))
        team.looked.set(i, this.squad.tick);
    });
    this.lastLook = this.squad.tick;
  }

  /** Whether a straight look from `eye` reaches a page (nothing solid in the way). */
  visible(eye: Vec3, at: Vec3, pageId: number): boolean {
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

  /** Whether a player is in plain view: their head or their middle, nothing solid in between. */
  private sees(id: number): boolean {
    const sim = this.squad.game.sim;
    const p = sim.players.get(id);
    if (!p) return false;
    const eye = this.eye();
    return this.visible(eye, sim.eye(p), -1) || this.visible(eye, p.body.translation(), -1);
  }

  /** Something that happened close by: a saboteur's tell, if it was in plain view. */
  saw(e: SimEvent): void {
    if (this.saboteur || e.playerId === undefined) return;
    if (e.kind !== 'swap' && e.kind !== 'forge' && e.kind !== 'hide' && e.kind !== 'tamper') return;
    // Close is not enough: it has to see them do it, with no wall or shelf in between.
    if (!this.sees(e.playerId)) return;
    const what = {
      swap: 'swap a brick',
      forge: 'forge a page',
      hide: 'hide a page',
      tamper: 'tamper with the machines',
    }[e.kind];
    this.squad.suspect(e.playerId, 0.95, `${this.nameOf(this.id)} saw them ${what}`);
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
    const target = this.choose();
    this.squad.game.handle(this.id, { t: 'vote', target });
    // Says how it votes, and why, for the people in the meeting.
    const why = this.saboteur ? undefined : this.squad.why.get(target);
    this.chat.reply(
      target
        ? `I vote ${this.nameOf(target)}${why ? `: ${why}` : ''}.`
        : 'I skip, I am not sure yet.',
      1,
    );
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
    if (p.tool) return this.named('put the tool away', this.chores.putAway());
    if (p.holding && !this.squad.claims.has(this.id)) {
      // Still holding a part after a meeting, say: put it on if it goes on now.
      const fits = this.saboteur
        ? undefined
        : this.plan().ready.find((b) => this.building.holds(b.type, b.colour, b.prints));
      if (fits) return this.named('build', this.building.buildOne(fits));
      return this.named('let go', this.chores.letGo());
    }
    const errand = this.chat.runErrand();
    if (errand) return errand;
    // Free build: no plans and no clock, so nothing to build to; it keeps people company.
    if (round.mode === 'free') return this.named('wait', this.loiter());
    if (this.saboteur) {
      const job = this.sabotage.mischief();
      if (job) return job;
    }
    if (p.page !== null) return this.named('read the page', this.chores.pocketPage());
    // The lights went out: someone has to fix the panel (one bot is enough).
    if (
      !sim.power.on &&
      sim.power.fixer === null &&
      sim.panel &&
      round.mode !== 'gear' &&
      this.squad.panelBy === null
    )
      return this.named('fix the panel', this.onDuty('panelBy', this.chores.fixPanel()));
    // A machine somebody tampered with: one builder clears the jam.
    const jammed = this.saboteur
      ? undefined
      : [...sim.machines.values()].find(
          (m) => m.jammed && m.fixer === null && sim.mayUse(p, machinePose(m.def).centre),
        );
    if (jammed && this.squad.jamBy === null)
      return this.named('clear a jam', this.onDuty('jamBy', this.chores.clearJam(jammed.def.id)));
    // The dog goes for the build after three minutes without a treat: one bot feeds it first.
    if (
      !this.saboteur &&
      !sim.dog.leashed &&
      sim.dog.ticksHungry > DOG_FEED_SECONDS * 60 &&
      this.squad.dogBy === null
    )
      return this.named('feed the dog', this.onDuty('dogBy', this.chores.feedDog()));
    if (!this.saboteur && this.mayAccuse())
      return this.named('ring the bell', this.onDuty('bellBy', this.ringBell()));
    const plan = this.plan();
    // Saboteurs cannot hand the build in (their presses do nothing).
    if (plan.complete && !this.saboteur) return this.named('press Done', this.building.pressDone());
    if (!p.handsOff && plan.fix !== null)
      return this.named('fix a brick', this.building.fixBrick(plan.fix));
    // Bricks knocked off lying on the baseplate: in the way of putting anything on there.
    const debris = p.handsOff || this.saboteur ? null : this.chores.debris();
    if (debris !== null) return this.named('clear the build', this.chores.clearDebris(debris));
    const searching = this.shouldSearch(plan.work, plan.unknown + plan.lost);
    if (searching || p.handsOff) {
      const job = this.pageJobs.search();
      if (job) return job;
    }
    const brick = p.handsOff ? null : this.pick(plan.ready);
    if (brick) return this.named('build', this.building.buildOne(brick));
    // Nothing on the page it remembers left to do: off to the board for the next one.
    if (!p.handsOff && plan.next !== null)
      return this.named('read a page', this.pageJobs.readStep(plan.next));
    if (plan.unknown + plan.lost > 0) {
      const job = this.pageJobs.search();
      if (job) return job;
    }
    return this.named('wait', this.loiter());
  }

  *named<T>(name: string, job: Job<T>): Job<T> {
    this.jobName = name;
    return yield* job;
  }

  /**
   * Runs `job` with something claimed: `take` claims it as the job starts and `free` lets it go
   * as the job ends, however it ends (done, given up, or stopped part way, by a meeting say).
   */
  private *claiming<T>(take: () => void, free: () => void, job: Job<T>): Job<T> {
    take();
    try {
      return yield* job;
    } finally {
      free();
    }
  }

  /** Runs `job` as the one bot seeing to `duty`, so the others leave it be. */
  onDuty<T>(duty: Duty, job: Job<T>): Job<T> {
    return this.claiming(
      () => (this.squad[duty] = this.id),
      () => {
        if (this.squad[duty] === this.id) this.squad[duty] = null;
      },
      job,
    );
  }

  /** Runs `job` busy finding `key` (see `PageJobs.searching`), so the others pick something else. */
  searchingFor<T>(key: string, job: Job<T>): Job<T> {
    return this.claiming(
      () => (this.searchKey = key),
      () => (this.searchKey = ''),
      job,
    );
  }

  /**
   * Where the build stands. What to put on or fix comes from the one page it remembers; how
   * many steps nobody has read, which page to read next and whether everything is in place come
   * from the board, as the team read it.
   */
  plan(): {
    ready: Wanted[];
    /** A brick in the build to take off (wrong, or wanted nowhere), by id. */
    fix: number | null;
    unknown: number;
    lost: number;
    work: number;
    next: number | null;
    complete: boolean;
  } {
    const m = this.team.match();
    const empty = {
      ready: [],
      fix: null,
      unknown: 0,
      lost: 0,
      work: 0,
      next: null,
      complete: false,
    };
    if (!m) return empty;
    const sim = this.squad.game.sim;
    const build = sim.build(this.site);
    const { known, total } = this.team.knownSteps();
    const unknown = total - known;
    const grid = build.grid;
    this.checkSwaps(m.result.bricks);
    const board = this.verdicts(m.result, grid);
    const own = this.recalled();
    // Never over a part of any step still to go in under it, the remembered one's or not.
    const mine = own
      ? this.verdicts(own, grid, board.missing)
      : { ready: [], fix: null, wrong: 0, steps: [], missing: [] };
    let fix = mine.fix;
    // Bricks nobody wants (not in any step the bots know of), when they know every step.
    if (fix === null && unknown === 0)
      fix = m.result.extras.find((x) => !this.avoided(`fix|${x}`)) ?? null;
    // The page to go and read next: a step with work in it whose page is up on the board, one
    // no other bot here has in mind first, then the earliest.
    const others = new Set(
      [...this.squad.bots.values()]
        .filter((b) => b !== this && b.site === this.site)
        .flatMap((b) => [b.memory?.step, b.wantStep]),
    );
    const next =
      [...new Set(board.steps)]
        .filter((st) => !this.avoided(`read|${st}`) && this.readable(st))
        .filter((st) => st !== this.memory?.step)
        .sort((a, b) => Number(others.has(a)) - Number(others.has(b)) || a - b)[0] ?? null;
    let lost = 0;
    for (let st = 0; st < total; st++) if (!this.readable(st)) lost++;
    const complete = unknown === 0 && board.wrong === 0 && m.result.extras.length <= MAX_EXTRAS;
    // Out of time: hand in what there is if it should pass.
    const round = this.squad.game.round!;
    const late =
      round.timeLeft < 12 && m.result.counts.correct >= PASS_FRACTION * m.result.counts.total;
    return {
      ready: mine.ready,
      fix,
      unknown,
      lost,
      work: board.ready.length,
      next,
      complete: complete || (late && unknown === 0),
    };
  }

  /**
   * A match read out: bricks not yet right that can go on now (none over a part of `under`
   * still to go in, by default the match's own), the id of a wrong brick to take off, how many
   * are not right, the steps of those that can be seen to, and the parts that could go on now.
   */
  private verdicts(
    result: MatchResult,
    grid: BrickGrid,
    under?: Wanted[],
  ): { ready: Wanted[]; fix: number | null; wrong: number; steps: number[]; missing: Wanted[] } {
    const ready: Wanted[] = [];
    const steps: number[] = [];
    let fix: number | null = null;
    let wrong = 0;
    // Parts that could go on now (clutching something already there).
    const missing = result.bricks
      .filter((v) => v.status === 'missing')
      .map((v) => v.target)
      .filter((t) => !grid.overlaps(t) && (grid.size === 0 || grid.neighbours(t).length > 0));
    for (const v of result.bricks) {
      if (v.status === 'correct') continue;
      wrong++;
      if (v.status !== 'missing') {
        steps.push(v.target.step);
        if (fix === null && v.actualId !== undefined && !this.avoided(`fix|${v.actualId}`))
          fix = v.actualId;
        continue;
      }
      if (grid.overlaps(v.target)) continue;
      if (grid.size > 0 && grid.neighbours(v.target).length === 0) continue;
      // Bottom up: never over a part still to go in under it (it could not get in after).
      const below = under ?? missing;
      if (below.some((u) => u.y < v.target.y && underlaps(u, v.target))) continue;
      ready.push(v.target);
      steps.push(v.target.step);
    }
    return { ready, fix, wrong, steps, missing };
  }

  /** The build matched against the page it remembers (nothing else of the manual counts). */
  private recalled(): MatchResult | null {
    const m = this.memory;
    const target = this.squad.game.round?.target;
    if (!m || !target) return null;
    const build = this.squad.game.sim.build(this.site);
    if (this.recall?.version === build.version && this.recall.read === this.reads)
      return this.recall.result;
    const bricks = m.doubted ? this.team.mend(m.step, m.added) : m.added;
    const steps = target.steps.map((_, i) => ({ bricks: i === m.step ? bricks : [] }));
    const result = matchBuild({ ...target, steps }, build.grid);
    this.recall = { version: build.version, read: this.reads, result };
    return result;
  }

  /** Keeps what a page says in mind, forgetting the page it remembered before (if another). */
  remember(page: PrintedPage): void {
    if (page.step < 0) return;
    // A forgery it saw through is checked against the master index, if anyone read it.
    this.memory = { step: page.step, added: page.added, doubted: this.spotted(page) };
    this.reads++;
  }

  /**
   * Whether it sees a page's stamp is wrong: only once it knows the real one, and then as
   * sharp-eyed as it is (decided once a page, however often it reads it).
   */
  spotted(page: PrintedPage): boolean {
    const real = this.team.realStamp;
    if (this.saboteur || !real || page.stamp === real || page.step < 0) return false;
    const key = `${page.step}|${page.stamp}`;
    let seen = this.doubts.get(key);
    if (seen === undefined) {
      seen = this.random() < this.skill.spot;
      this.doubts.set(key, seen);
    }
    return seen;
  }

  /** A step's pages out where anyone can read them: pinned up, or lying about, on this side. */
  readablePages(step: number) {
    const sim = this.squad.game.sim;
    return [...sim.pages.values()].filter((pg) => {
      if (!pg.body || pg.printed?.step !== step || pg.carriedBy !== null) return false;
      if (pg.hidden || sim.dog.page === pg.id) return false;
      const side = sim.sideOf(pg.body.translation());
      return side === null || side === this.site;
    });
  }

  /** Whether a step's page is out where it can be read. */
  private readable(step: number): boolean {
    return this.readablePages(step).length > 0;
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
        for (const [id, t] of near)
          this.squad.suspect(
            id,
            (0.45 * t) / Math.max(sum, 1),
            'they were by the build when a brick got swapped',
          );
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
  *walk(goals: number[], done?: () => boolean, seconds = 45): Job {
    yield* this.free();
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
        let ladder = false;
        for (let w = i; w <= j && !ladder; w++) ladder = !!path[w]!.ladder;
        if (ladder) continue;
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
        if (
          w.ladder ||
          !nav.straight(feet, w.pos) ||
          nav.crossesPlate(this.platesNow(), feet, w.pos)
        )
          break;
        to = w.pos;
      }
      const dx = to.x - feet.x;
      const dz = to.z - feet.z;
      this.ctl.yaw = Math.atan2(-dx, -dz);
      this.ctl.pitch = -0.25;
      this.ctl.forward = 1;
      this.ctl.right = 0;
      const p = this.me()!;
      const carrying = p.holding !== null && !this.building.holdingBrick();
      const left = path.length - i;
      // A build lifted off its job site (to the inspector, say) is loose: one knock and it
      // breaks, so nobody runs about it.
      const gently = this.nearLooseBuild(feet);
      this.ctl.sprint = this.skill.sprint && !carrying && left > 6 && !gently;
      this.ctl.careful =
        !carrying && (gently || (this.skill.careful && this.looseAhead(feet, this.ctl.yaw)));
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
  overPlate(x: number, y: number, z: number): boolean {
    return overPlate(this.platesNow(), x, y, z);
  }

  /** The job sites' baseplates where they are this tick. */
  private platesNow(): readonly (Plate | null)[] {
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
    return this.plates.list;
  }
  /** Whether a spot is within a couple of metres of a build that is off its job site, unheld. */
  private nearLooseBuild(at: Vec3): boolean {
    const sim = this.squad.game.sim;
    for (let site = 0; site < sim.sites.length; site++) {
      const build = sim.build(site);
      if (build.anchored || build.heldBy !== null) continue;
      const c = sim.buildCentre(build);
      if (Math.abs(at.y - c.y) < 2 && Math.hypot(at.x - c.x, at.z - c.z) < 2 + BASEPLATE_SIZE * 0.7)
        return true;
    }
    return false;
  }

  private plates: { tick: number; list: (Plate | null)[] } | null = null;

  /**
   * Extra cost of each node: other players standing on it, something in the way, or a job
   * site's baseplate (walking over the build gets in the way of building it).
   */
  private costs(): PathCosts {
    const sim = this.squad.game.sim;
    const tick = this.squad.tick;
    const blocked: number[] = [];
    for (const [n, until] of this.blocked) if (until > tick) blocked.push(n);
    const others = [...sim.players.values()]
      .filter((p) => p.id !== this.id)
      .map((p) => p.body.translation());
    // Loose bricks on the floor (a saboteur's trap, say): stepping on one trips a player up.
    const loose: Vec3[] = [];
    for (const a of sim.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      loose.push(a.body.worldCom());
    }
    return {
      blocked,
      others,
      plates: this.platesNow(),
      loose,
      trip: this.skill.careful ? 1 : 6,
    };
  }

  /** Whether a loose brick lies on the floor just ahead (one to step over carefully). */
  private looseAhead(feet: Vec3, yaw: number): boolean {
    // Underfoot, or anywhere in the next stride and a half at a run (bricks get kicked about).
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    for (const a of this.squad.game.sim.assemblies.values()) {
      if (!isLooseBrick(a) || a.heldBy !== null) continue;
      const t = a.body.worldCom();
      if (Math.abs(t.y - feet.y) > 0.3) continue;
      const along = (t.x - feet.x) * dx + (t.z - feet.z) * dz;
      const across = Math.abs((t.x - feet.x) * dz - (t.z - feet.z) * dx);
      if (
        Math.hypot(t.x - feet.x, t.z - feet.z) < 0.7 ||
        (along > 0 && along < 1.6 && across < 0.6)
      )
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
      if (p.ladder !== null) left = true;
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
  aim(point: Vec3, ok: (o: ColliderOwner) => boolean): { yaw: number; pitch: number } | null {
    const p = this.me();
    if (!p) return null;
    const sim = this.squad.game.sim;
    const eye = sim.eye(p);
    if (length(sub(point, eye)) > REACH + 0.3) return null;
    const nudges = [v3()];
    for (const d of [0.04, 0.08, 0.14]) {
      nudges.push(v3(d, 0, 0), v3(-d, 0, 0), v3(0, d, 0), v3(0, -d, 0), v3(0, 0, d), v3(0, 0, -d));
    }
    for (const n of nudges) {
      const d = sub(add(point, n), eye);
      const yaw = Math.atan2(-d.x, -d.z);
      const pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, Math.atan2(d.y, Math.hypot(d.x, d.z))),
      );
      const hit = sim.sight.aim(p, { eye, yaw, pitch, firstPerson: true });
      if (hit && ok(hit.owner)) return { yaw, pitch };
    }
    return null;
  }

  /** Nodes to stand on to reach `point`, best first: in reach, in view, not too close. */
  stands(point: Vec3, ok: (o: ColliderOwner) => boolean, near = 1.1, lift = 0): number[] {
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
  *use(t: Target, actions: Action | Action[], near?: number): Job {
    const list = Array.isArray(actions) ? actions : [actions];
    if (this.avoided(t.key)) return false;
    yield* this.free();
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
          const hit = this.me() && now ? this.squad.game.sim.sight.aim(this.me()!) : null;
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

  // ---------------------------------------------------------------- jobs: pages

  searchKey = '';

  // ---------------------------------------------------------------- jobs: building

  // ---------------------------------------------------------------- meetings: calling one

  /** Whether it is sure enough of someone to ring the bell. */
  private mayAccuse(): boolean {
    const round = this.squad.game.round!;
    if (round.rival || round.mode === 'gear' || !this.squad.game.sim.bell) return false;
    if ((round.meetingsLeft.get(this.id) ?? 0) <= 0) return false;
    // Another bot is on its way to ring it.
    if (this.squad.bellBy !== null && this.squad.bellBy !== this.id) return false;
    return this.accused() !== null;
  }

  accused(): number | null {
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

  *ringBell(): Job {
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
}

/** Whether two parts' footprints overlap, seen from above. */
function underlaps(a: TargetBrick, b: TargetBrick): boolean {
  const ba = partBox(a);
  const bb = partBox(b);
  return ba.x0 < bb.x1 && bb.x0 < ba.x1 && ba.z0 < bb.z1 && bb.z0 < ba.z1;
}

function reached(feet: Vec3, to: Vec3): boolean {
  return Math.hypot(feet.x - to.x, feet.z - to.z) < 0.3 && Math.abs(feet.y - to.y) < 0.6;
}
