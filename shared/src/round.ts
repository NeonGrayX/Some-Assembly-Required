import type { TargetBuild } from './builds/types.ts';
import { STAMPS, forgePage, realPage } from './builds/forgery.ts';
import { binColours } from './builds/variant.ts';
import type { BinColours } from './builds/variant.ts';
import { matchBuild } from './builds/match.ts';
import type { MatchResult } from './builds/match.ts';
import type { PrintedPage } from './builds/forgery.ts';
import { inspectionReport } from './builds/report.ts';
import { GEAR_HUNT_EXTRA_SECONDS, GEAR_IDS, LOCKABLE, indoors } from './gear.ts';
import type { GameMode, GearId } from './gear.ts';
import type { InspectionReport } from './builds/report.ts';
import { length, makeRng, rotate, sub, v3 } from './math.ts';
import type { Vec3 } from './math.ts';
import { DT, TICK_RATE } from './sim/sim.ts';
import type { Sim } from './sim/sim.ts';

/** Seconds a build has to rest on the inspector pad before the verdict shows. */
export const SCAN_SECONDS = 4;
export const DEFAULT_ROUND_SECONDS = 10 * 60;
/** The Done button must be pressed twice within this many seconds. */
export const DONE_CONFIRM_SECONDS = 3;
/** Discussion and voting time of a Brick Meeting. */
export const MEETING_SECONDS = 90;
/** How long the outcome of a vote stays on screen before play resumes. */
export const MEETING_OUTCOME_SECONDS = 5;
export const MEETINGS_PER_PLAYER = 1;
/** Sending an innocent builder home costs the team this much time. */
export const INNOCENT_PENALTY_SECONDS = 60;
/** The saboteurs win once this many innocents have been sent home. */
export const INNOCENTS_TO_LOSE = 2;
/** Saboteur tells are noticed within this distance. */
export const WITNESS_RANGE = 6;
export const COOLDOWNS: Record<SabotageTool, number> = {
  swap: 40,
  forge: 60,
  // Hiding means walking up to a hiding place with the page, which is limit enough.
  hide: 0,
  clumsy: 30,
  trap: 45,
};
/** Tools that can only be used a few times a round, and how often. */
/** The electrical panel breaks down this many seconds after the power last came on, at random. */
export const POWER_FAILS_AFTER = { min: 4 * 60, max: 6 * 60 };
export const CHARGES: Partial<Record<SabotageTool, number>> = { clumsy: 2 };
/** A gear hunt's litter: small loose bricks around each dog point. */
export const LITTER_PER_POINT = 3;
/** Share of the lockable hiding places that get a padlock in a gear hunt. */
export const LOCKED_SHARE = 1 / 3;
/** Share of the gear that hides in closed hiding places rather than on open surfaces. */
export const GEAR_HIDDEN_SHARE = 1 / 3;
/** The colour goggles never lie on an open surface this close to the spawn (the first find should be something else). */
const GOGGLES_MIN_SPAWN_DISTANCE = 10;

export type RoundPhase = 'building' | 'results';
export type EndReason = 'done' | 'time' | 'votes';
/**
 * Builders build, saboteurs sabotage. In blind build mode one builder is the reader: the only
 * one who can read the pages, and the one who may not touch bricks.
 */
export type Role = 'builder' | 'saboteur' | 'reader';
export type SabotageTool = 'swap' | 'forge' | 'hide' | 'clumsy' | 'trap';
/** Who won: the builders or saboteurs of a classic round, or a team (or neither) of a race. */
export type Winner = 'builders' | 'saboteurs' | 'nobody' | 'red' | 'blue' | 'draw';
export const TEAM_NAMES = ['Red', 'Blue'] as const;
export const TEAM_WINNERS = ['red', 'blue'] as const;

export interface InspectorState {
  status: 'idle' | 'scanning' | 'done';
  /** 0..1 while scanning. */
  progress: number;
  /** Report of the last finished scan. */
  report: InspectionReport | null;
  /** Build version that was scanned, so a changed build gets scanned again. */
  scannedVersion: number;
}

export interface Meeting {
  calledBy: number;
  /** Ticks of discussion and voting left. */
  ticksLeft: number;
  /** Voter id → voted-for id, or 0 to skip. */
  votes: Map<number, number>;
  /** Set once the vote is counted. `sentHome` is 0 if nobody was. */
  outcome: { sentHome: number; tally: [id: number, votes: number][] } | null;
  /** Ticks the outcome stays on screen. */
  outcomeTicks: number;
}

export interface RoundOptions {
  seconds?: number;
  seed?: number;
  /** Player ids taking part, for role assignment. */
  players?: number[];
  /** How many saboteurs; defaults to the usual count for the number of players. */
  saboteurs?: number;
  /** Blind build: one reader sees the pages and nobody else does; the reader builds nothing. */
  blind?: boolean;
  /**
   * Rival teams: two job sites race for the most accurate build; no saboteurs, no meetings.
   * `teams` says which site (0 or 1) each player builds on.
   */
  rival?: boolean;
  teams?: Map<number, number>;
  /** How the round is played; a gear hunt or plain co-op has no saboteurs whatever `saboteurs` says. */
  mode?: GameMode;
}

/**
 * Which steps of an `n`-step build are printed as paired half-pages: about one in four, never
 * the first (it sets the model's orientation), and none for very short builds.
 */
export function pairedSteps(n: number, rng: () => number): number[] {
  if (n < 6) return [];
  const count = Math.round(n / 4);
  const later = shuffle(
    Array.from({ length: n - 1 }, (_, i) => i + 1),
    rng,
  );
  return later.slice(0, count).sort((a, b) => a - b);
}

/** One saboteur for 3–6 players, two from 7, none when playing alone or in pairs. */
export function defaultSaboteurs(players: number): number {
  return players >= 7 ? 2 : players >= 3 ? 1 : 0;
}

/**
 * One round on the job site: roles, hidden pages and the master index, the clock, the
 * inspector, Brick Meetings and votes, saboteur tools, and the final score. Reacts to the sim's
 * events; only touches physics through the sim's own methods.
 */
export class Round {
  phase: RoundPhase = 'building';
  timeLeft: number;
  endReason: EndReason | null = null;
  result: MatchResult | null = null;
  winner: Winner | null = null;
  readonly roles = new Map<number, Role>();
  /** Blind build mode (see `RoundOptions.blind`). */
  readonly blind: boolean;
  /** Steps printed as two half-pages, A (positions) and B (colours), in step order. */
  readonly paired: number[];
  /** Rival teams mode (see `RoundOptions.rival`), and each player's team (site). */
  readonly rival: boolean;
  readonly teams = new Map<number, number>();
  /** Rival teams: when each team handed in (time left then), and how its build matched. */
  readonly finished: (number | null)[];
  readonly teamResults: (MatchResult | null)[];
  readonly mode: GameMode;
  /** The gear hidden this round (a gear hunt), in the order it was placed. */
  readonly gearHidden: GearId[] = [];
  /** How many litter bricks were scattered (a gear hunt). */
  litter = 0;
  /** Players voted off the job site, in order. */
  readonly sentHome: number[] = [];
  innocentsSentHome = 0;
  meeting: Meeting | null = null;
  /** Bumped whenever the meeting changes, so it gets sent again. */
  meetingVersion = 0;
  readonly meetingsLeft = new Map<number, number>();
  /** The real stamp this round, and the near-copy forgers use. */
  readonly stamp: string;
  readonly fakeStamp: string;
  /** One inspector per job site. */
  readonly inspectors: InspectorState[];
  /** The first (or only) job site's inspector. */
  get inspector(): InspectorState {
    return this.inspectors[0]!;
  }

  /** Per job site: while `timeLeft` is above this, a second press of Done hands the build in. */
  private readonly doneArmedUntil: number[];
  /** Seconds of building left until the electrical panel breaks down (null while it is broken). */
  powerFailsIn: number | null = null;
  private readonly cooldowns = new Map<string, number>();
  /** Uses of limited tools so far, by `player:tool`. */
  private readonly uses = new Map<string, number>();
  /** Colours each brick type comes in, from the level's bins. */
  private readonly bins: BinColours;
  private readonly rng: () => number;
  /** Hiding places and open surfaces the pages left free, for the gear. */
  private freeHideouts: number[] = [];
  private freeSurfaces: Vec3[] = [];

  constructor(
    readonly sim: Sim,
    readonly target: TargetBuild,
    opts: RoundOptions = {},
  ) {
    this.mode = opts.mode ?? (opts.rival ? 'rival' : opts.blind ? 'blind' : 'saboteur');
    this.timeLeft = opts.seconds ?? DEFAULT_ROUND_SECONDS;
    if (this.mode === 'gear') this.timeLeft += GEAR_HUNT_EXTRA_SECONDS;
    this.rng = makeRng(opts.seed ?? 1);
    this.bins = binColours(sim.level);
    [this.stamp, this.fakeStamp] = STAMPS[Math.floor(this.rng() * STAMPS.length)]!;
    this.blind = this.mode === 'blind';
    this.rival = this.mode === 'rival';
    const sites = this.sim.sites.length;
    this.inspectors = Array.from({ length: sites }, () => ({
      status: 'idle' as const,
      progress: 0,
      report: null,
      scannedVersion: -1,
    }));
    this.doneArmedUntil = Array.from({ length: sites }, () => Infinity);
    this.finished = Array.from({ length: sites }, () => null);
    this.teamResults = Array.from({ length: sites }, () => null);
    if (this.rival) {
      for (const [id, team] of opts.teams ?? []) this.teams.set(id, Math.min(team, sites - 1));
      for (const [id, team] of this.teams) {
        const p = this.sim.players.get(id);
        if (p) p.team = team;
      }
    }
    this.paired = pairedSteps(this.target.steps.length, this.rng);
    this.assignRoles(
      opts.players ?? [],
      this.mode === 'saboteur' || this.mode === 'blind' ? opts.saboteurs : 0,
    );
    this.hidePages();
    if (this.mode === 'gear') this.startGearHunt();
  }

  /**
   * A gear hunt's troubles: padlocks on some hiding places, litter on the floors, the power
   * out for good, and the gear that fixes them hidden about the map.
   */
  private startGearHunt(): void {
    for (const id of GEAR_IDS) this.sim.hazards.add(id);
    this.lockHideouts();
    this.hideGear();
    this.litter = this.sim.spawnLitter(LITTER_PER_POINT, this.rng);
    this.sim.breakPower();
  }

  /** Padlocks a share of the hiding places that can take a padlock. */
  private lockHideouts(): void {
    const lockable = this.sim.level.hideouts.filter((h) => LOCKABLE.has(h.kind)).map((h) => h.id);
    const n = Math.ceil(lockable.length * LOCKED_SHARE);
    for (const id of shuffle(lockable, this.rng).slice(0, n)) this.sim.lockHideout(id);
  }

  /**
   * Hides every piece of gear once, where the pages left room: a share in closed hiding
   * places, the rest on open surfaces. Finding gear must never need gear, so the key ring
   * never goes behind a padlock and the headlamp never into the dark house; and the goggles
   * (the find that changes everything) keep off the open surfaces near the spawn.
   */
  private hideGear(): void {
    const kinds = shuffle([...GEAR_IDS], this.rng);
    const inHideouts = Math.round(kinds.length * GEAR_HIDDEN_SHARE);
    const spawn = this.sim.level.spawn;
    const hideoutOk = (kind: GearId, id: number) => {
      const h = this.sim.hideouts.get(id)!;
      if (kind === 'keys' && h.locked) return false;
      if (kind === 'headlamp' && indoors(h.def.pos)) return false;
      return true;
    };
    const surfaceOk = (kind: GearId, at: Vec3) => {
      if (kind === 'headlamp' && indoors(at)) return false;
      if (kind === 'goggles' && length(sub(at, spawn)) < GOGGLES_MIN_SPAWN_DISTANCE) return false;
      return true;
    };
    let hidden = 0;
    for (const kind of kinds) {
      const yaw = this.rng() * Math.PI * 2;
      const hideout = this.freeHideouts.find((id) => hideoutOk(kind, id));
      if (hidden < inHideouts && hideout !== undefined) {
        this.freeHideouts = this.freeHideouts.filter((id) => id !== hideout);
        const item = this.sim.spawnGear(kind, v3(0, -50, 0), yaw);
        this.sim.hideGearInHideout(item, hideout);
        hidden++;
      } else {
        const spot =
          this.freeSurfaces.find((at) => surfaceOk(kind, at)) ??
          // Nowhere far enough from the spawn for the goggles: near will do.
          (kind === 'goggles' ? this.freeSurfaces.find((at) => !indoors(at)) : undefined);
        if (!spot) throw new Error(`nowhere to hide the ${kind}`);
        this.freeSurfaces = this.freeSurfaces.filter((at) => at !== spot);
        this.sim.spawnGear(kind, spot, yaw);
      }
      this.gearHidden.push(kind);
    }
  }

  private assignRoles(players: number[], saboteurs = defaultSaboteurs(players.length)): void {
    const shuffled = shuffle([...players], this.rng);
    // Blind build needs someone left to build after the reader is picked.
    const reader = this.blind && players.length - saboteurs >= 2 ? saboteurs : -1;
    shuffled.forEach((id, i) => {
      this.roles.set(id, i < saboteurs ? 'saboteur' : i === reader ? 'reader' : 'builder');
      this.meetingsLeft.set(id, MEETINGS_PER_PLAYER);
    });
    this.applyHands();
  }

  /** The reader keeps their hands off the bricks; everyone else may build. */
  private applyHands(): void {
    for (const [id, role] of this.roles) {
      const p = this.sim.players.get(id);
      if (p) p.handsOff = role === 'reader';
    }
  }

  /** Who reads the pages in blind build mode, or null (everyone reads them otherwise). */
  get reader(): number | null {
    for (const [id, role] of this.roles) if (role === 'reader') return id;
    return null;
  }

  /**
   * Whether this player may read what is printed on the pages: everyone, unless this is a
   * blind build with a reader, who is then the only one.
   */
  canRead(id: number): boolean {
    if (!this.blind) return true;
    const reader = this.reader;
    return reader === null || reader === id;
  }

  /** Someone who joined after the start plays as a builder. */
  addPlayer(id: number): void {
    if (this.roles.has(id)) return;
    this.roles.set(id, 'builder');
    this.meetingsLeft.set(id, MEETINGS_PER_PLAYER);
  }

  /** Demo mode: changes a player's role mid-round, with every tool ready to use. */
  setRole(id: number, role: Role): void {
    this.roles.set(id, role);
    this.applyHands();
    if (!this.meetingsLeft.has(id)) this.meetingsLeft.set(id, MEETINGS_PER_PLAYER);
    for (const key of [...this.cooldowns.keys()]) {
      if (key.startsWith(`${id}:`)) this.cooldowns.delete(key);
    }
    for (const key of [...this.uses.keys()]) if (key.startsWith(`${id}:`)) this.uses.delete(key);
  }

  role(id: number): Role {
    return this.roles.get(id) ?? 'builder';
  }

  /** Rival teams: which job site a player builds on (0 when not racing). */
  teamOf(id: number): number {
    return this.teams.get(id) ?? 0;
  }

  /** Fellow saboteurs a saboteur gets to know about (empty for builders). */
  partners(id: number): number[] {
    if (this.role(id) !== 'saboteur') return [];
    return [...this.roles].filter(([pid, r]) => r === 'saboteur' && pid !== id).map(([pid]) => pid);
  }

  /**
   * Puts one page per step (two halves for a paired step), and the master index, on randomly
   * chosen hiding spots.
   */
  private hidePages(): void {
    const pages = (): PrintedPage[] => [
      ...this.target.steps.flatMap((_, step) =>
        this.paired.includes(step)
          ? [
              realPage(this.target, step, this.stamp, 'A'),
              realPage(this.target, step, this.stamp, 'B'),
            ]
          : [realPage(this.target, step, this.stamp)],
      ),
      // The master index: no bricks, just the real stamp (and, when read, every page's parts).
      { step: -1, added: [], stamp: this.stamp },
    ];
    // Rival teams: each side gets its own set, hidden on its own side.
    const sides = this.sim.level.divide ? [0, 1] : [null];
    for (const side of sides) {
      const onSide = (p: Vec3) => side === null || this.sim.sideOf(p) === side;
      this.hideSet(
        pages(),
        [...this.sim.hideouts.values()].filter((h) => onSide(h.def.pos)).map((h) => h.def.id),
        this.sim.level.pageSpots.filter(onSide),
      );
    }
  }

  private hideSet(items: PrintedPage[], hideoutIds: number[], spots: Vec3[]): void {
    // About half go into closed hiding places, the rest lie about on open surfaces.
    const hideouts = shuffle(hideoutIds, this.rng);
    const surfaces = shuffle([...spots], this.rng);
    const hidden = Math.min(hideouts.length, Math.ceil(items.length / 2));
    if (surfaces.length < items.length - hidden) throw new Error('not enough page spots');
    shuffle(items, this.rng).forEach((printed, i) => {
      const yaw = this.rng() * Math.PI * 2;
      if (i < hidden) {
        const page = this.sim.spawnPage(printed, v3(0, -50, 0), yaw);
        this.sim.hideInHideout(page, hideouts[i]!);
      } else {
        this.sim.spawnPage(printed, surfaces[i - hidden]!, yaw);
      }
    });
    this.freeHideouts = hideouts.slice(hidden);
    this.freeSurfaces = surfaces.slice(items.length - hidden);
  }

  // ---------------------------------------------------------------- each tick

  /** Call once after every sim step, before the sim's events are cleared. */
  update(): void {
    if (this.phase !== 'building') return;
    for (const e of this.sim.events) {
      if (e.kind !== 'button' || e.playerId === undefined) continue;
      if (e.buttonId === 'bell') this.callMeeting(e.playerId);
      if (e.buttonId === 'done' && !this.meeting) {
        const site = e.site ?? 0;
        if (this.rival && this.finished[site] !== null) continue;
        if (this.doneArmedFor(site)) {
          if (this.rival) this.handIn(site);
          else this.finish('done');
        } else this.doneArmedUntil[site] = this.timeLeft - DONE_CONFIRM_SECONDS;
      }
    }
    if (this.rival && this.phase === 'building' && this.raceDecided()) this.finish('done');
    for (const [k, t] of this.cooldowns) {
      if (t <= 1) this.cooldowns.delete(k);
      else this.cooldowns.set(k, t - 1);
    }
    if (this.meeting) {
      this.updateMeeting();
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - DT);
    if (this.timeLeft === 0) this.finish('time');
    if (this.phase === 'building') {
      this.updateInspector();
      this.updatePower();
    }
  }

  /** Breaks the electrical panel every four to six minutes, counted from when it was last fixed. */
  private updatePower(): void {
    // A gear hunt's panel is dead for the round.
    if (this.mode === 'gear') return;
    if (!this.sim.power.on) {
      this.powerFailsIn = null;
      return;
    }
    const { min, max } = POWER_FAILS_AFTER;
    this.powerFailsIn ??= min + (max - min) * this.rng();
    this.powerFailsIn -= DT;
    if (this.powerFailsIn <= 0) this.sim.breakPower();
  }

  /** True right after a first press of Done: pressing again ends the round (or hands in). */
  get doneArmed(): boolean {
    return this.doneArmedFor(0);
  }

  doneArmedFor(site: number): boolean {
    return this.timeLeft > (this.doneArmedUntil[site] ?? Infinity);
  }

  /**
   * Rival teams: a team hands its build in. It is matched and frozen there and then; the other
   * team may go on until it hands in too, time runs out, or nothing it could do would beat
   * this build.
   */
  private handIn(site: number): void {
    if (this.finished[site] !== null) return;
    this.finished[site] = this.timeLeft;
    this.teamResults[site] = matchBuild(this.target, this.sim.build(site).grid);
    this.sim.freezeBuild(site);
    this.sim.events.push({ kind: 'anchor', pos: this.sim.buildCentre(this.sim.build(site)), site });
  }

  /** Rival teams: nothing left to race for: everyone handed in, or someone handed in a perfect build. */
  private raceDecided(): boolean {
    if (this.finished.every((f) => f !== null)) return true;
    return this.teamResults.some((r) => r !== null && isPerfect(r));
  }

  /** Whether a team's build is resting, upright and unheld on its inspector pad. */
  buildOnInspector(site = 0): boolean {
    const build = this.sim.build(site);
    if (build.heldBy !== null || build.anchored) return false;
    const { pos, size } = this.sim.sites[site]!.inspector;
    const c = this.sim.buildCentre(build);
    return (
      Math.abs(c.x - pos.x) < size.x / 2 &&
      Math.abs(c.z - pos.z) < size.z / 2 &&
      c.y < pos.y + 0.3 &&
      rotate(build.body.rotation(), v3(0, 1, 0)).y > 0.9 &&
      length(build.body.linvel()) < 0.3
    );
  }

  private updateInspector(): void {
    for (let site = 0; site < this.inspectors.length; site++) this.updateSiteInspector(site);
  }

  private updateSiteInspector(site: number): void {
    const ins = this.inspectors[site]!;
    if (!this.buildOnInspector(site)) {
      if (ins.status !== 'idle') ins.status = 'idle';
      ins.progress = 0;
      return;
    }
    const version = this.sim.build(site).version;
    if (ins.status === 'done' && ins.scannedVersion === version) return;
    if (ins.status === 'done') ins.progress = 0;
    ins.status = 'scanning';
    ins.progress = Math.min(1, ins.progress + DT / SCAN_SECONDS);
    if (ins.progress >= 1) {
      ins.status = 'done';
      const grid = this.sim.build(site).grid;
      ins.report = inspectionReport(matchBuild(this.target, grid), grid);
      ins.scannedVersion = version;
    }
  }

  // ---------------------------------------------------------------- meetings

  /** Players still on the job site. */
  get onSite(): number[] {
    return [...this.roles.keys()].filter((id) => !this.sentHome.includes(id));
  }

  callMeeting(playerId: number): boolean {
    // A race has no saboteurs to vote on.
    if (this.rival) return false;
    // A gear hunt has no bell: nobody to vote off.
    if (this.mode === 'gear') return false;
    if (this.meeting || this.phase !== 'building' || this.sentHome.includes(playerId)) return false;
    const left = this.meetingsLeft.get(playerId) ?? 0;
    if (left <= 0) return false;
    this.meetingsLeft.set(playerId, left - 1);
    this.meeting = {
      calledBy: playerId,
      ticksLeft: MEETING_SECONDS * TICK_RATE,
      votes: new Map(),
      outcome: null,
      outcomeTicks: 0,
    };
    this.meetingVersion++;
    this.sim.events.push({ kind: 'meeting', pos: v3(), playerId });
    // Everyone drops what they hold and gathers around the break room table.
    const seats = this.sim.level.meetingSeats;
    this.onSite.forEach((id, i) => {
      const p = this.sim.players.get(id);
      if (!p) return;
      this.sim.dropHeld(p);
      if (seats.length) this.sim.teleportPlayer(p, seats[i % seats.length]!);
    });
    return true;
  }

  /** A vote for a player on the job site, or 0 to skip. Votes can be changed until the count. */
  vote(voter: number, target: number): void {
    const m = this.meeting;
    if (!m || m.outcome || !this.onSite.includes(voter)) return;
    if (target !== 0 && !this.onSite.includes(target)) return;
    m.votes.set(voter, target);
    this.meetingVersion++;
    if (this.onSite.every((id) => m.votes.has(id))) this.countVotes();
  }

  private updateMeeting(): void {
    const m = this.meeting!;
    if (m.outcome) {
      if (--m.outcomeTicks <= 0) {
        this.meeting = null;
        this.meetingVersion++;
      }
      return;
    }
    if (--m.ticksLeft <= 0) this.countVotes();
  }

  /** Whoever got the most votes, if more than the skips and no tie, is sent home. */
  private countVotes(): void {
    const m = this.meeting!;
    const counts = new Map<number, number>();
    for (const t of m.votes.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
    const tally = [...counts].filter(([id]) => id !== 0).sort((a, b) => b[1] - a[1]);
    const skips = counts.get(0) ?? 0;
    const top = tally[0];
    const tie = top && tally[1] && tally[1][1] === top[1];
    const sentHome = top && !tie && top[1] > skips ? top[0] : 0;
    m.outcome = { sentHome, tally };
    m.outcomeTicks = MEETING_OUTCOME_SECONDS * TICK_RATE;
    this.meetingVersion++;
    if (!sentHome) return;
    this.sentHome.push(sentHome);
    this.sim.events.push({ kind: 'sentHome', pos: v3(), playerId: sentHome });
    if (this.role(sentHome) === 'builder') {
      this.innocentsSentHome++;
      this.timeLeft = Math.max(0, this.timeLeft - INNOCENT_PENALTY_SECONDS);
      if (this.innocentsSentHome >= INNOCENTS_TO_LOSE) this.finish('votes');
    }
  }

  // ---------------------------------------------------------------- sabotage

  /** Seconds until a saboteur can use a tool again (0 = ready). */
  cooldown(playerId: number, tool: SabotageTool): number {
    return (this.cooldowns.get(`${playerId}:${tool}`) ?? 0) / TICK_RATE;
  }

  /**
   * Uses a saboteur tool. Returns false if the player may not (wrong role, sent home, lying on
   * the ground, during a meeting, cooling down) or there was nothing to use it on.
   */
  sabotage(playerId: number, tool: SabotageTool): boolean {
    const p = this.sim.players.get(playerId);
    if (!p || p.down > 0 || this.phase !== 'building' || this.meeting) return false;
    if (this.role(playerId) !== 'saboteur' || this.cooldown(playerId, tool) > 0) return false;
    if (this.chargesLeft(playerId, tool) === 0) return false;
    let at: Vec3 | null = null;
    if (tool === 'swap') {
      at = this.sim.swapBrick(p);
    } else if (tool === 'forge') {
      const page = p.page === null ? undefined : this.sim.pages.get(p.page);
      // Half A shows no colours, so there is nothing on it to forge.
      const printed = page?.printed;
      if (printed && page.step >= 0 && printed.stamp === this.stamp && printed.half !== 'A') {
        const fake = forgePage(
          this.target,
          page.step,
          this.fakeStamp,
          this.rng,
          this.bins,
          printed.half,
        );
        if (this.sim.reprintPocketPage(p, fake)) at = p.body.translation();
      }
    } else if (tool === 'hide') {
      at = this.sim.hidePocketPage(p);
    } else if (tool === 'clumsy') {
      at = this.sim.clumsyTrip(p);
    } else if (tool === 'trap') {
      at = this.sim.dropTrap(p);
    }
    if (!at) return false;
    const key = `${playerId}:${tool}`;
    this.cooldowns.set(key, COOLDOWNS[tool] * TICK_RATE);
    this.uses.set(key, (this.uses.get(key) ?? 0) + 1);
    // A clumsy trip looks like any other trip, and a trap is just some dropped bricks: no
    // tell beyond what everyone sees and hears anyway.
    if (tool !== 'clumsy' && tool !== 'trap') {
      this.sim.events.push({ kind: tool, pos: at, playerId, witnessRange: WITNESS_RANGE });
    }
    return true;
  }

  /**
   * Whether a click by this player puts the page in their pocket into the hiding place they aim
   * at (saboteurs only), rather than opening or shutting it.
   */
  hidesOnClick(playerId: number): boolean {
    const p = this.sim.players.get(playerId);
    if (!p || this.role(playerId) !== 'saboteur') return false;
    return this.sim.hideoutForPocketPage(p) !== null;
  }

  /** Uses left of a limited tool this round, or null if it is not limited. */
  chargesLeft(playerId: number, tool: SabotageTool): number | null {
    const max = CHARGES[tool];
    return max === undefined
      ? null
      : Math.max(0, max - (this.uses.get(`${playerId}:${tool}`) ?? 0));
  }

  // ---------------------------------------------------------------- end

  finish(reason: EndReason): void {
    if (this.phase !== 'building') return;
    this.phase = 'results';
    this.endReason = reason;
    this.meeting = null;
    this.meetingVersion++;
    if (this.rival) {
      // Whoever has not handed in is judged on what stands on their job site now.
      this.teamResults.forEach((r, site) => {
        if (!r) this.teamResults[site] = matchBuild(this.target, this.sim.build(site).grid);
      });
      const results = this.teamResults as MatchResult[];
      const best = rankTeams(results, this.finished);
      this.winner = best === null ? 'draw' : TEAM_WINNERS[best]!;
      this.result = results[best ?? 0]!;
      return;
    }
    this.result = matchBuild(this.target, this.sim.build().grid);
    const saboteurs = [...this.roles.values()].includes('saboteur');
    const builtIt = reason === 'done' && this.result.passed;
    this.winner = builtIt ? 'builders' : saboteurs ? 'saboteurs' : 'nobody';
  }
}

/** Every brick where it should be and nothing else on the plate. */
export function isPerfect(r: MatchResult): boolean {
  return r.counts.correct === r.counts.total && r.extras.length === 0;
}

/** Bricks that are not right: look-alikes, wrong ones and extras. */
export function errorsOf(r: MatchResult): number {
  return r.counts.close + r.counts.wrong + r.extras.length;
}

/**
 * Rival teams: who won. Accuracy first: more bricks exactly right, then fewer errors; only
 * then speed: a team that handed in beats one that did not, an earlier hand-in a later one.
 * One correct brick beats an empty plate however fast. Null when nothing tells them apart.
 */
export function rankTeams(results: MatchResult[], finished: (number | null)[]): number | null {
  const score = (i: number): number[] => {
    const r = results[i]!;
    const at = finished[i];
    return [r.counts.correct, -errorsOf(r), at === null || at === undefined ? -Infinity : at];
  };
  let best: number | null = 0;
  for (let i = 1; i < results.length; i++) {
    const a = score(best ?? 0);
    const b = score(i);
    const cmp = a.findIndex((v, k) => v !== b[k]);
    if (cmp === -1) best = null;
    else if (b[cmp]! > a[cmp]!) best = i;
  }
  return best;
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}
