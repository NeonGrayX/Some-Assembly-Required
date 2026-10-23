import type RAPIER from '@dimforge/rapier3d-compat';
import type { BrickTypeId, ColourId } from '../bricks.ts';
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
import { parse } from './talk.ts';
import type { Deed } from './talk.ts';
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
  added: TargetBrick[];
  stamp: string;
  /** Who read it. */
  from: number;
  /** Whoever read it saw its stamp is wrong. */
  doubted?: boolean;
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
 * Who had a machine of the brick works make what lies (or will lie) in a place in its output
 * area.
 */
export interface Order {
  machine: number;
  slot: number;
  /** The player who ordered it. */
  by: number;
  /** The tick it came to rest there, or null while it is still being made. */
  landed: number | null;
}

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
  /** What each bot is clearing off a baseplate: by bot, the loose piece's assembly id. */
  readonly clearing = new Map<number, number>();
  /** A moulding machine a bot is setting up: by machine id, the bot. */
  readonly presses = new Map<number, number>();
  /**
   * What each bot waits at a machine of the brick works to take out: by bot, the machine and
   * the place in its output area that what it had made goes in (other bots leave it be).
   */
  readonly collecting = new Map<number, { machine: number; slot: number }>();
  /**
   * Who had the brick works make what lies in their output areas (or is being made for them),
   * by `machine|slot`, forgotten once the place is empty: so the bots leave what a person
   * ordered there a while, for them to come for.
   */
  private readonly orders = new Map<string, Order>();
  /** Who the builders suspect, 0..1 (how sure). */
  readonly suspicion = new Map<number, number>();
  /** Swapped bricks someone noticed (brick id and its new colour), so each counts once. */
  readonly noticed = new Set<string>();
  /** Why the builders suspect each player, in words, for when someone asks. */
  readonly why = new Map<number, string>();
  /** When a player last told the bots about another (speaker and target), so a claim said over and over counts once. */
  private readonly claimed = new Map<string, number>();
  /** Who last carried each page (public: everyone sees who has a page in their pocket). */
  private readonly carriers = new Map<number, number>();
  private readonly hiddenBefore = new Set<number>();
  /** Players near the build, ticks spent within reach of it lately. */
  readonly nearBuild = new Map<number, number>();
  /** The bot gone to fix the electrical panel. */
  panelBy: number | null = null;
  /** The bot gone to feed the dog. */
  dogBy: number | null = null;
  /** The bot gone to clear a jammed machine. */
  jamBy: number | null = null;
  /** The bot gone to press Done. */
  doneBy: number | null = null;
  /** The bot gone to ring the meeting bell. */
  bellBy: number | null = null;
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
    this.clearing.delete(id);
    for (const [m, b] of this.presses) if (b === id) this.presses.delete(m);
    this.collecting.delete(id);
    if (this.panelBy === id) this.panelBy = null;
    if (this.dogBy === id) this.dogBy = null;
    if (this.jamBy === id) this.jamBy = null;
    if (this.doneBy === id) this.doneBy = null;
    if (this.bellBy === id) this.bellBy = null;
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

  /**
   * Effects of the last tick: bots see who orders what at the brick works, and notice the tells
   * that happen close to them.
   */
  witness(events: SimEvent[]): void {
    this.noteOrders(events);
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

  /** Who ordered what lies (or is being made for) a place in a machine's output area, if known. */
  order(machine: number, slot: number): Order | undefined {
    return this.orders.get(`${machine}|${slot}`);
  }

  /**
   * Keeps track of who orders what at the brick works: a machine starting on something says
   * who ordered it and the place it goes in, it has landed there once it is seen lying there,
   * and it is forgotten once that place is empty again (whoever took it).
   */
  private noteOrders(events: SimEvent[]): void {
    for (const e of events) {
      if (e.kind !== 'fill' && e.kind !== 'dispense' && e.kind !== 'moulded') continue;
      const { machineId: machine, slot, playerId: by } = e;
      if (machine === undefined || slot === undefined || by === undefined) continue;
      this.orders.set(`${machine}|${slot}`, { machine, slot, by, landed: null });
    }
    for (const [key, o] of this.orders) {
      const m = this.room.sim.machines.get(o.machine);
      if (m?.out[o.slot]) o.landed ??= this.tick;
      else if (m?.making?.slot !== o.slot) this.orders.delete(key);
    }
  }

  private newWorld(): void {
    this.sim = this.room.sim;
    this.navGrid = null;
    this.teams = this.room.sim.sites.map((_, site) => new Team(this.room, site, this));
    this.claims.clear();
    this.clearing.clear();
    this.presses.clear();
    this.collecting.clear();
    this.orders.clear();
    this.suspicion.clear();
    this.noticed.clear();
    this.why.clear();
    this.claimed.clear();
    this.carriers.clear();
    this.hiddenBefore.clear();
    this.nearBuild.clear();
    this.panelBy = null;
    this.dogBy = null;
    this.jamBy = null;
    this.doneBy = null;
    this.bellBy = null;
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
      const hidden = page.hidden;
      if (hidden && !this.hiddenBefore.has(page.id)) {
        this.hiddenBefore.add(page.id);
        const by = this.carriers.get(page.id);
        // Gone from someone's pocket into a hiding place: only a saboteur does that.
        if (by !== undefined)
          this.suspect(by, 0.5, 'a page went from their pocket into a hiding place');
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

  /** Raises the builders' suspicion of a player (by how much evidence there is, 0..1), and says why. */
  suspect(id: number, by: number, why?: string): void {
    const was = this.suspicion.get(id) ?? 0;
    this.suspicion.set(id, Math.min(1, was + (1 - was) * by));
    // The strongest reason is the one worth telling.
    if (why && (by >= 0.3 || !this.why.has(id))) this.why.set(id, why);
  }

  /**
   * A person said something in the chat, and these bots were close enough to hear it. What it
   * claims counts as much as the builders trust whoever said it; one bot answers (the one spoken
   * to, else the nearest).
   */
  hear(from: number, text: string, listeners: number[]): void {
    const room = this.room;
    const players = [...room.clients.values()].map((c) => ({ id: c.id, name: c.name }));
    const said = parse(text, from, players);
    if (!said.heard.length) return;
    const bots = listeners
      .map((id) => this.bots.get(id))
      .filter((b): b is Bot => !!b && this.room.sim.players.has(b.id));
    if (!bots.length) return;
    const at = room.sim.players.get(from)?.body.translation();
    const near = (b: Bot) => {
      const p = room.sim.players.get(b.id)?.body.translation();
      return p && at ? length(sub(p, at)) : 0;
    };
    const answerer =
      bots.find((b) => b.id === said.to) ??
      (said.to !== null && this.bots.has(said.to)
        ? null
        : bots.sort((a, b) => near(a) - near(b))[0]!);
    const building = room.phase === 'building' && !!room.round;
    const speaker = room.clients.get(from)?.name ?? 'someone';
    for (const h of said.heard) {
      if (building && (h.kind === 'accuse' || h.kind === 'clear' || h.kind === 'vote')) {
        const key = `${h.kind}|${from}|${h.target}`;
        if (this.tick - (this.claimed.get(key) ?? -Infinity) > 20 * 60) {
          this.claimed.set(key, this.tick);
          // Worth as much as the speaker is trusted.
          const trust = 1 - (this.suspicion.get(from) ?? 0);
          if (h.kind === 'clear') {
            const was = this.suspicion.get(h.target) ?? 0;
            this.suspicion.set(h.target, was * (1 - 0.3 * trust));
          } else {
            const by =
              (h.kind === 'vote' ? 0.15 : h.kind === 'accuse' && h.deed ? 0.4 : 0.25) * trust;
            const why =
              h.kind === 'accuse' && h.deed
                ? `${speaker} saw them ${DEED_WORDS[h.deed]}`
                : `${speaker} thinks it is them`;
            this.suspect(h.target, by, why);
            // Accused, a bot says it was not it, and doubts whoever said so (every bot alike,
            // saboteur or not, so the answer gives nothing away).
            if (this.bots.has(h.target))
              this.suspect(from, 0.1, `they blamed ${room.clients.get(h.target)?.name}`);
          }
        }
      }
      const bot =
        h.kind === 'accuse' && this.bots.has(h.target) && bots.some((b) => b.id === h.target)
          ? this.bots.get(h.target)!
          : answerer;
      if (bot && (building || h.kind === 'greet')) bot.answer(h, from, said.to === bot.id);
    }
  }
}

/** A tell as the bots tell it ("Ada saw them swap a brick"). */
export const DEED_WORDS: Record<Deed, string> = {
  swap: 'swap a brick',
  forge: 'forge a page',
  hide: 'hide a page',
  trip: 'trip into the build on purpose',
  trap: 'spill bricks to trip people',
  tamper: 'tamper with the machines',
};

/** What the bots building at one job site know between them. */
export class Team {
  /** Pages read, by step. Saboteurs only tell what suits them. */
  readonly notes = new Map<number, PageNote>();
  /** The real stamp, once someone read the master index or saw it on two pages. */
  realStamp: string | null = null;
  /** Each page's parts (type and colour, counted), once someone read the master index. */
  index: PartCount[][] | null = null;
  /** Hiding places searched, and when (tick). */
  readonly searched = new Map<number, number>();
  /** When the dog was last seen with a page in its mouth (tick). */
  dogSeen = -1e9;
  /** Places pages lie (by index in the bots' list of them) looked at, and when (tick). */
  readonly looked = new Map<number, number>();
  /** Pages seen lying about: where, and when (tick). */
  readonly sightings = new Map<number, { pos: Vec3; tick: number }>();
  /**
   * Bumped whenever what the bots know of the pages changes (a page told, the real stamp or the
   * master index learnt), so a match against what they know is redone.
   */
  private notesVersion = 0;
  /** The site's build as last matched, so it is matched once a version of it and of the notes. */
  private matched: { version: number; notes: number; result: MatchResult } | null = null;

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

  /**
   * Tells the other bots what a page says (a forger tells its forgery, or nothing), and whether
   * the one who read it saw its stamp is wrong. A forgery nobody saw through is believed.
   */
  tell(page: PrintedPage, from: number, doubted = false): void {
    if (page.step < 0) {
      this.realStamp = page.stamp;
      const target = this.room.round?.target;
      if (target) this.index = target.steps.map((s) => partsOf(s.bricks));
      this.notesVersion++;
      return;
    }
    const note: PageNote = { step: page.step, added: page.added, stamp: page.stamp, from };
    if (doubted) note.doubted = true;
    const old = this.notes.get(page.step);
    // A page with the real stamp beats one seen to have the wrong one.
    if (old && doubted && old.stamp === this.realStamp) return;
    this.notes.set(page.step, note);
    this.notesVersion++;
    if (!this.realStamp) {
      // Two pages agreeing on a stamp: that is the real one (one forger cannot keep up).
      const stamps = new Map<string, number>();
      for (const n of this.notes.values()) stamps.set(n.stamp, (stamps.get(n.stamp) ?? 0) + 1);
      for (const [s, n] of stamps) if (n >= 2 && n > (stamps.size > 1 ? 2 : 1)) this.realStamp = s;
    }
  }

  /**
   * The build as the bots know it: each step whose page they have read, with a forged brick
   * put right where someone saw through the forgery and the master index tells which brick it
   * is. Steps nobody has read are empty.
   */
  known(): TargetBuild | null {
    const target = this.room.round?.target;
    if (!target) return null;
    const steps = target.steps.map((_, step) => {
      const note = this.notes.get(step);
      if (!note) return { bricks: [] };
      return { bricks: note.doubted ? this.mend(step, note.added) : note.added };
    });
    return { ...target, steps };
  }

  /** Puts a forged page's odd brick back to the colour the master index lists, if it can tell. */
  mend(step: number, bricks: TargetBrick[]): TargetBrick[] {
    const parts = this.index?.[step];
    if (!parts) return bricks;
    const have = partsOf(bricks);
    const extra = have.find((h) => h.count > countOf(parts, h));
    const short = parts.find((p) => p.count > countOf(have, p));
    if (!extra || !short) return bricks;
    // The forger only changed a colour: the odd brick is the same part as the one short.
    const i = bricks.findIndex(
      (b) =>
        samePart(partOf(b), extra) && b.type === short.type && printKey(b.prints) === short.prints,
    );
    if (i < 0) return bricks;
    const out = [...bricks];
    out[i] = { ...out[i]!, colour: short.colour };
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
    const m = this.matched;
    if (!m || m.version !== build.version || m.notes !== this.notesVersion) {
      this.matched = {
        version: build.version,
        notes: this.notesVersion,
        result: matchBuild(known, build.grid),
      };
    }
    return { result: this.matched!.result, known };
  }
}

/** A kind of part: its type, colour and pictures (`printKey`, empty for none). */
export interface Part {
  type: BrickTypeId;
  colour: ColourId;
  prints: string;
}

/** A kind of part in a step, and how many of it there are. */
export interface PartCount extends Part {
  count: number;
}

const partOf = (b: TargetBrick): Part => ({
  type: b.type,
  colour: b.colour,
  prints: printKey(b.prints),
});

const samePart = (a: Part, b: Part): boolean =>
  a.type === b.type && a.colour === b.colour && a.prints === b.prints;

/** How many of a kind of part a list counts (0 when it has none). */
const countOf = (parts: PartCount[], part: Part): number =>
  parts.find((p) => samePart(p, part))?.count ?? 0;

/** A step's parts, counted by type and colour (and print), in the order they first come. */
export function partsOf(bricks: TargetBrick[]): PartCount[] {
  const out: PartCount[] = [];
  for (const b of bricks) {
    const part = partOf(b);
    const have = out.find((p) => samePart(p, part));
    if (have) have.count++;
    else out.push({ ...part, count: 1 });
  }
  return out;
}
