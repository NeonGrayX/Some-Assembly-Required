import type RAPIER from '@dimforge/rapier3d-compat';
import { BRICK_TYPES } from '../bricks.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import { matchBuild } from '../builds/match.ts';
import type { MatchResult } from '../builds/match.ts';
import { printKey } from '../builds/types.ts';
import type { TargetBrick, TargetBuild } from '../builds/types.ts';
import { length, sub } from '../math.ts';
import type { Vec3 } from '../math.ts';
import type { Room } from '../net/room.ts';
import type { SimEvent, Sim } from '../sim/sim.ts';
import { Bot } from './bot.ts';
import { NavGrid } from './nav.ts';
import { SKILLS } from './skill.ts';
import type { BotLevel } from './skill.ts';

type Rapier = typeof RAPIER;

/** Names bots go by, in turn. */
export const BOT_NAMES = [
  'Bolt',
  'Gizmo',
  'Rivet',
  'Sprocket',
  'Widget',
  'Cog',
  'Gadget',
  'Nibbler',
  'Clank',
  'Dynamo',
];

/** What a page says, as a bot read it (or was told it by another bot). */
export interface PageNote {
  step: number;
  half?: 'A' | 'B';
  added: TargetBrick[];
  stamp: string;
  /** Who read it. */
  from: number;
}

/** A brick of the build a bot has taken on, so two bots do not fetch the same one. */
export interface Claim {
  key: string;
  brick: TargetBrick & { step: number };
  since: number;
}

/** Seconds a hiding place counts as searched (a saboteur may have put a page back in since). */
const SEARCHED_SECONDS = 150;

/**
 * The bots of a room, and what they share between them: a map to walk by, what the pages they
 * read say (bots tell each other, the way players talk), which hiding places they searched,
 * which bricks each is fetching, and who they suspect. Runs each bot once per tick, before the
 * room applies everyone's inputs.
 */
export class Squad {
  readonly bots = new Map<number, Bot>();
  private sim: Sim | null = null;
  private navGrid: NavGrid | null = null;
  /** What the bots of each job site know (two sites for rival teams). */
  teams: Team[] = [];
  /** What each bot is fetching. */
  readonly claims = new Map<number, Claim>();
  /** A moulding machine a bot is setting up: by machine id, the bot. */
  readonly presses = new Map<number, number>();
  /** Who the builders suspect, 0..1 (how sure). */
  readonly suspicion = new Map<number, number>();
  /** Swapped bricks someone noticed (brick id and its new colour), so each counts once. */
  readonly noticed = new Set<string>();
  /** Who last carried each page (public: everyone sees who has a page in their pocket). */
  private readonly carriers = new Map<number, number>();
  private readonly hiddenBefore = new Set<number>();
  /** Players near the build, ticks spent within reach of it lately. */
  readonly nearBuild = new Map<number, number>();
  /** Tick the panel was last claimed by a bot going to fix it. */
  panelBy: number | null = null;
  /** The bot gone to feed the dog. */
  dogBy: number | null = null;
  tick = 0;
  /** Where bots say what they are doing, for working on them (off unless set). */
  trace: ((bot: number, line: string) => void) | null = null;
  /** Seeded so a room's bots play the same way given the same game. */
  private seed = 1;

  constructor(
    private readonly R: Rapier,
    private readonly room: Room,
  ) {}

  /** A new bot in the room under this id. */
  add(id: number, level: BotLevel): Bot {
    const bot = new Bot(id, level, SKILLS[level], this, this.seed++);
    this.bots.set(id, bot);
    return bot;
  }

  remove(id: number): void {
    this.bots.delete(id);
    this.release(id);
  }

  /** Lets go of everything a bot was seeing to. */
  private release(id: number): void {
    this.claims.delete(id);
    for (const [m, b] of this.presses) if (b === id) this.presses.delete(m);
    if (this.panelBy === id) this.panelBy = null;
    if (this.dogBy === id) this.dogBy = null;
  }

  get rapier(): Rapier {
    return this.R;
  }

  get game(): Room {
    return this.room;
  }

  /** The walking map of the current world, made the first time it is needed. */
  get nav(): NavGrid {
    this.navGrid ??= new NavGrid(this.R, this.room.sim);
    return this.navGrid;
  }

  /** Runs every bot for one tick. */
  update(): void {
    if (this.room.sim !== this.sim) this.newWorld();
    // The physics only answers questions about a world once it has stepped.
    if (this.room.sim.tick === 0) return;
    this.tick++;
    if (this.room.phase === 'building' && this.room.round) this.watch();
    for (const bot of this.bots.values()) {
      // Sent home (or out of the world): whatever it was fetching is free for the others.
      if (!this.room.sim.players.has(bot.id)) this.release(bot.id);
      else bot.update();
    }
  }

  /** Effects of the last tick: bots notice the tells that happen close to them. */
  witness(events: SimEvent[]): void {
    if (!this.room.round || this.room.phase !== 'building') return;
    for (const e of events) {
      if (e.witnessRange === undefined || e.playerId === undefined) continue;
      for (const bot of this.bots.values()) {
        if (bot.id === e.playerId) continue;
        const p = this.room.sim.players.get(bot.id);
        if (!p || length(sub(p.body.translation(), e.pos)) > e.witnessRange) continue;
        bot.saw(e);
      }
    }
  }

  private newWorld(): void {
    this.sim = this.room.sim;
    this.navGrid = null;
    this.teams = this.room.sim.sites.map((_, site) => new Team(this.room, site, this));
    this.claims.clear();
    this.presses.clear();
    this.suspicion.clear();
    this.noticed.clear();
    this.carriers.clear();
    this.hiddenBefore.clear();
    this.nearBuild.clear();
    this.panelBy = null;
    this.dogBy = null;
    for (const bot of this.bots.values()) bot.reset();
  }

  /**
   * What everyone can see happening: who carries which page, pages going into hiding places
   * from someone's pocket, and who hangs about the build.
   */
  private watch(): void {
    const sim = this.room.sim;
    for (const page of sim.pages.values()) {
      if (page.carriedBy !== null) this.carriers.set(page.id, page.carriedBy);
      const hidden = page.hideout !== null;
      if (hidden && !this.hiddenBefore.has(page.id)) {
        this.hiddenBefore.add(page.id);
        const by = this.carriers.get(page.id);
        // Gone from someone's pocket into a hiding place: only a saboteur does that.
        if (by !== undefined && this.tick > 10) this.suspect(by, 0.5);
        for (const team of this.teams) {
          team.sightings.delete(page.id);
          // Wherever it went, it is worth looking again.
          if (page.hideout !== null) team.searched.delete(page.hideout);
        }
      } else if (!hidden) this.hiddenBefore.delete(page.id);
    }
    if (this.tick % 30 === 0) {
      const centre = sim.buildCentre();
      for (const p of sim.players.values()) {
        const near = length(sub(p.body.translation(), centre)) < 2.6;
        const was = this.nearBuild.get(p.id) ?? 0;
        this.nearBuild.set(p.id, near ? Math.min(20, was + 1) : Math.max(0, was - 0.25));
      }
    }
  }

  /** Raises the builders' suspicion of a player (by how much evidence there is, 0..1). */
  suspect(id: number, by: number): void {
    const was = this.suspicion.get(id) ?? 0;
    this.suspicion.set(id, Math.min(1, was + (1 - was) * by));
  }
}

/** What the bots building at one job site know between them. */
export class Team {
  /** Pages read, by step and half ("3", "3A"). Saboteurs only tell what suits them. */
  readonly notes = new Map<string, PageNote>();
  /** The real stamp, once someone read the master index or saw it on two pages. */
  realStamp: string | null = null;
  /** Each page's parts (type and colour, counted), once someone read the master index. */
  index: Map<string, number>[] | null = null;
  /** Hiding places searched, and when (tick). */
  readonly searched = new Map<number, number>();
  /** When the dog was last seen with a page in its mouth (tick). */
  dogSeen = -1e9;
  /** Places pages lie (by index in the bots' list of them) looked at, and when (tick). */
  readonly looked = new Map<number, number>();
  /** Pages seen lying about: where, and when (tick). */
  readonly sightings = new Map<number, { pos: Vec3; tick: number }>();
  /** The site's build as last matched, so it is matched once a version. */
  private matched: { version: number; known: number; result: MatchResult } | null = null;

  constructor(
    private readonly room: Room,
    readonly site: number,
    private readonly squad: Squad,
  ) {}

  /** Whether a hiding place was searched lately. */
  wasSearched(id: number): boolean {
    const t = this.searched.get(id);
    return t !== undefined && this.squad.tick - t < SEARCHED_SECONDS * 60;
  }

  /** Tells the other bots what a page says (a forger tells its forgery, or nothing). */
  tell(page: PrintedPage, from: number): void {
    if (page.step < 0) {
      this.realStamp = page.stamp;
      const target = this.room.round?.target;
      if (target) this.index = target.steps.map((s) => partsOf(s.bricks));
      return;
    }
    const key = `${page.step}${page.half ?? ''}`;
    const note: PageNote = { step: page.step, added: page.added, stamp: page.stamp, from };
    if (page.half) note.half = page.half;
    const old = this.notes.get(key);
    // A page with the real stamp beats one without.
    if (old && this.realStamp && old.stamp === this.realStamp && page.stamp !== this.realStamp)
      return;
    this.notes.set(key, note);
    if (!this.realStamp) {
      // Two pages agreeing on a stamp: that is the real one (one forger cannot keep up).
      const stamps = new Map<string, number>();
      for (const n of this.notes.values()) stamps.set(n.stamp, (stamps.get(n.stamp) ?? 0) + 1);
      for (const [s, n] of stamps) if (n >= 2 && n > (stamps.size > 1 ? 2 : 1)) this.realStamp = s;
    }
  }

  /**
   * The build as the bots know it: each step whose page (both halves of a paired step) they
   * have read, with a forged brick put right where the master index tells which it is. Steps
   * nobody has read are empty.
   */
  known(): TargetBuild | null {
    const target = this.room.round?.target;
    if (!target) return null;
    const omniscient = [...this.squad.bots.values()].some(
      (b) => b.skill.omniscient && !b.saboteur && b.site === this.site,
    );
    if (omniscient) return target;
    const steps = target.steps.map((_, step) => {
      const whole = this.notes.get(`${step}`);
      const a = this.notes.get(`${step}A`);
      const b = this.notes.get(`${step}B`);
      let bricks: TargetBrick[] | null = null;
      if (whole) bricks = whole.added;
      else if (a && b && a.added.length === b.added.length) {
        bricks = a.added.map((x, i) => ({ ...x, colour: b.added[i]!.colour }));
      }
      if (!bricks) return { bricks: [] };
      return { bricks: this.mend(step, bricks) };
    });
    return { ...target, steps };
  }

  /** Puts a forged page's odd brick back to the colour the master index lists, if it can tell. */
  private mend(step: number, bricks: TargetBrick[]): TargetBrick[] {
    const parts = this.index?.[step];
    if (!parts) return bricks;
    const have = partsOf(bricks);
    const extra = [...have].find(([k, n]) => n > (parts.get(k) ?? 0))?.[0];
    const short = [...parts].find(([k, n]) => n > (have.get(k) ?? 0))?.[0];
    if (!extra || !short) return bricks;
    const [type, colour] = short.split('|');
    const i = bricks.findIndex((b) => `${b.type}|${b.colour}` === extra && b.type === type);
    if (i < 0) return bricks;
    const out = [...bricks];
    out[i] = { ...out[i]!, colour: colour as TargetBrick['colour'] };
    return out;
  }

  /** How many steps the bots know, out of how many there are. */
  knownSteps(): { known: number; total: number } {
    const k = this.known();
    const total = this.room.round?.target.steps.length ?? 0;
    return { known: k ? k.steps.filter((s) => s.bricks.length).length : 0, total };
  }

  /** The job-site build matched against what the bots know of it, once per build version. */
  match(): { result: MatchResult; known: TargetBuild } | null {
    const known = this.known();
    if (!known) return null;
    const build = this.room.sim.build(this.site);
    const count = known.steps.reduce((n, s) => n + s.bricks.length, 0);
    if (!this.matched || this.matched.version !== build.version || this.matched.known !== count) {
      this.matched = {
        version: build.version,
        known: count,
        result: matchBuild(known, build.grid),
      };
    }
    return { result: this.matched.result, known };
  }
}

/** A step's parts, counted by type and colour (and print). */
export function partsOf(bricks: TargetBrick[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of bricks) {
    const k = `${b.type}|${b.colour}${b.prints ? `|${printKey(b.prints)}` : ''}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** Whether a placed or target brick is a part of the baseplate kind (never fetched). */
export function isFixture(type: TargetBrick['type']): boolean {
  return !!BRICK_TYPES[type].fixture;
}
