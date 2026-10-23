import { partBox } from '../parts.ts';
import type { ColourId } from '../bricks.ts';
import { MAX_EXTRAS, PASS_FRACTION, matchBuild } from '../builds/match.ts';
import type { MatchResult } from '../builds/match.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { TargetBrick } from '../builds/types.ts';
import { levelSites, machinePose } from '../content/house.ts';
import type { BrickGrid } from '../grid.ts';
import { add, length, makeRng, scale, sub, v3 } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { WITNESS_RANGE } from '../round.ts';
import { TICK_RATE } from '../sim/sim.ts';
import type { Action, Player, SimEvent } from '../sim/sim.ts';
import { ACTIONS_PER_SECOND, ACTION_BURST } from '../net/protocol.ts';
import { FEET } from './nav.ts';
import type { Plate } from './nav.ts';
import type { Skill, BotLevel } from './skill.ts';
import type { Squad, Team } from './squad.ts';
import type { Errand } from './talk.ts';
import { BotChat } from './chat.ts';
import { Chores } from './chores.ts';
import { PageJobs } from './pageJobs.ts';
import { Building } from './building.ts';
import { brickKey } from './common.ts';
import { BrickMaking } from './making.ts';
import { Sabotage } from './sabotage.ts';
import { Walking } from './walking.ts';
import { Clicking } from './clicking.ts';

/** A job, run a tick at a time: yields once per tick, returns whether it worked. */
export type Job<T = boolean> = Generator<void, T>;

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
  credits = ACTION_BURST;
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
  wanderAt = 0;
  /** Nodes something is in the way of, with the tick to try them again. */
  readonly blocked = new Map<number, number>();
  /** Aiming and clicking (see `Clicking`). */
  readonly clicking: Clicking;
  /** Walking about (see `Walking`). */
  readonly walking: Walking;
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
    this.clicking = new Clicking(this);
    this.walking = new Walking(this);
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
    if (round.mode === 'free') return this.named('wait', this.walking.loiter());
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
    return this.named('wait', this.walking.loiter());
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

  plates: { tick: number; list: (Plate | null)[] } | null = null;

  // ---------------------------------------------------------------- aiming and clicking

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
    const ok = yield* this.clicking.use(
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
