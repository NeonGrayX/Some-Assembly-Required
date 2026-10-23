import type RAPIER from '@dimforge/rapier3d-compat';
import { BUILDS, buildById } from '../builds/catalog.ts';
import type { InspectionReport } from '../builds/report.ts';
import type { TargetBuild } from '../builds/types.ts';
import { HOUSE, boardSlots, levelSites } from '../content/house.ts';
import { rivalLevel } from '../content/rival.ts';
import { MACHINE_ACTS } from '../sim/operate.ts';
import type { LevelDef } from '../content/house.ts';
import { isMapId, mapById } from '../content/maps/index.ts';
import type { MapId } from '../content/maps/index.ts';
import { length, makeRng, sub, v3 } from '../math.ts';
import { binColours, colourVariant } from '../builds/variant.ts';
import { gearBits, hasBell, isGameMode } from '../gear.ts';
import type { GameMode } from '../gear.ts';
import type { Quat, Vec3 } from '../math.ts';
import {
  DEFAULT_ROUND_SECONDS,
  FREE_BUILD,
  ROLE_REVEAL_HOLD_SECONDS,
  Round,
  defaultSaboteurs,
  isChosenRole,
} from '../round.ts';
import { TEAM_NAMES } from '../round.ts';
import { pageName } from '../builds/forgery.ts';
import type { ChosenRole, Role, SabotageTool } from '../round.ts';
import { DOG_MODES } from '../sim/dog.ts';
import { BOT_NAMES, Squad } from '../bots/squad.ts';
import { isBotLevel, isBotSide } from '../bots/skill.ts';
import type { BotLevel, BotSide } from '../bots/skill.ts';
import { Sim, TICK_RATE } from '../sim/sim.ts';
import type { Action, PageItem, Player, SimEvent } from '../sim/sim.ts';
import {
  ACTIONS_PER_SECOND,
  ACTION_BURST,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  RANDOM_BUILD,
  ROUND_LENGTHS,
  SABOTEUR_SETTINGS,
  NO_SQUEEZE,
  SNAPSHOT_EVERY,
  TIMES_OF_DAY,
  assemblyState,
  gearState,
  pageState,
  toQ,
  toV,
} from './protocol.ts';
import type {
  BodyT,
  ClientMsg,
  FurnitureState,
  IceServer,
  InputMsg,
  LobbyPlayer,
  MeetingView,
  PageState,
  PlayerT,
  RoomListing,
  VacuumT,
  DogT,
  RoomPhase,
  RoundSummary,
  ServerMsg,
  SignalData,
  TimeOfDay,
  WorldMsg,
} from './protocol.ts';

type Rapier = typeof RAPIER;

/** How long a dropped player keeps their spot (and their character) for a reconnect. */
export const RECONNECT_GRACE_TICKS = 30 * TICK_RATE;
/** Players this close can read a page held up to them (metres). */
export const SHOW_RANGE = 5;
/** While building, chat only reaches players this close (metres). */
export const CHAT_RANGE = 12;
/** Inputs buffered beyond this (two seconds' worth) are dropped, only after a long stall. */
const MAX_INPUT_BACKLOG = 120;
/**
 * Inputs a player may have applied per tick, on average: one, and a little over for a clock
 * that runs fast. Unused ones add up (to a backlog's worth), so a burst after a stall is worked
 * off quickly, but a client sending inputs faster than real time does not move faster.
 */
const INPUT_CREDIT_PER_TICK = 1.01;

export const PLAYER_COLOURS = [
  0xf07d1a, 0x1e5bc6, 0x2c9a3a, 0xc91a1a, 0x8e44ad, 0x16a3a3, 0xf5c518, 0xe84393, 0x6d4c41,
  0x7f8c8d,
];

interface Client {
  id: number;
  /** A computer player, and how well it plays (null for a person). */
  bot: BotLevel | null;
  /** The role the host chose for the next round (see `RoomOptions.rolePicks`); null deals it at random. */
  role: ChosenRole | null;
  name: string;
  colour: number;
  /** Rival teams: 0 or 1. */
  team: number;
  token: string;
  ready: boolean;
  connected: boolean;
  leftAtTick: number;
  inputs: InputMsg[];
  /** How many more inputs may be applied (see `INPUT_CREDIT_PER_TICK`). */
  inputCredits: number;
  lastSeq: number;
  actions: { a: Action; seq: number; yaw: number; pitch: number; fp: boolean }[];
  /** How many more actions may be taken (see `ACTIONS_PER_SECOND`). */
  actionCredits: number;
}

export interface RoomOptions {
  code: string;
  /** Delivers a message to one client. */
  send: (clientId: number, msg: ServerMsg) => void;
  seed?: number;
  /** A level to play in every round. Without one, the house is furnished anew each round. */
  level?: LevelDef;
  /** A build to play every round. Without one, the lobby's build setting picks it. */
  target?: TargetBuild;
  /** Makes reconnect tokens; defaults to Math.random. */
  token?: () => string;
  /** STUN and TURN servers for voice chat, made fresh for each player who joins. */
  ice?: () => IceServer[];
  /**
   * The host may choose who plays saboteur and who builds before a round. Only for a solo game:
   * it tells the host who the saboteurs are, so even friends who join one by invite are in on it
   * (handy for testing).
   */
  rolePicks?: boolean;
  /**
   * A solo game on the server: kept out of the room list for good, though friends may join by
   * its code or link.
   */
  solo?: boolean;
  /** Told what happened in each tick of play (bricks breaking, clicks, the dog), as it happens. */
  onEvents?: (events: SimEvent[]) => void;
}

/** Where body poses were last sent, to only send what moved. */
interface SentPose {
  pos: Vec3;
  rot: Quat;
}

const moved = (a: SentPose | undefined, pos: Vec3, rot: Quat) =>
  !a ||
  Math.abs(a.pos.x - pos.x) + Math.abs(a.pos.y - pos.y) + Math.abs(a.pos.z - pos.z) > 0.0005 ||
  Math.abs(a.rot.x - rot.x) +
    Math.abs(a.rot.y - rot.y) +
    Math.abs(a.rot.z - rot.z) +
    Math.abs(a.rot.w - rot.w) >
    0.0005;

const bodyT = (id: number, p: Vec3, q: Quat): BodyT => [id, p.x, p.y, p.z, q.x, q.y, q.z, q.w];

/**
 * One game lobby and its world, run by whoever hosts it: the Node server, or the browser for
 * solo play. Transport-agnostic: it receives decoded messages and hands back messages to send.
 */
export class Room {
  readonly code: string;
  level: LevelDef;
  /** The furnished house the level is (or, for rival teams, is doubled from). */
  private baseLevel: LevelDef;
  /** The seed the house was furnished from (see `houseLayout`), or null for a fixed level. */
  layout: number | null = null;
  /** This round's build (in its design colours), or the last round's outside a round. */
  target: TargetBuild;
  /** The build the host picked for the next round, or `RANDOM_BUILD`. */
  build: string = RANDOM_BUILD;
  phase: RoomPhase = 'lobby';
  hostId = 0;
  seconds = DEFAULT_ROUND_SECONDS;
  /** Saboteurs per round; -1 picks the usual number for the player count. */
  saboteurs = -1;
  /** How rounds are played: with saboteurs, as a gear hunt, or plainly together. */
  mode: GameMode = 'saboteur';
  map: MapId = 'house';
  time: TimeOfDay = 'day';
  /** Kept out of the room list; only its link or code leads in. */
  private = false;
  /** How well the bots the host adds play. */
  botLevel: BotLevel = 'normal';
  /** Which side the bots take when roles are dealt. */
  botSide: BotSide = 'any';
  /** Whether the current round (or the last one, back in the lobby) is played at night. */
  night = false;
  sim!: Sim;
  round: Round | null = null;
  readonly clients = new Map<number, Client>();
  tick = 0;
  /** The room's bots and what they share. */
  readonly squad: Squad;

  private nextClientId = 1;
  private seed: number;
  private readonly fixedLevel: LevelDef | null;
  private readonly fixedTarget: TargetBuild | null;
  /** Rounds started so far. */
  private rounds = 0;
  private readonly send: RoomOptions['send'];
  private readonly makeToken: () => string;
  private sentAssemblies = new Map<
    number,
    { version: number; anchored: boolean; heldBy: number | null }
  >();
  private sentPages = new Map<number, number>();
  /** Per client, each page as that client was last sent it, to only send what they can tell changed. */
  private sentPageViews = new Map<number, Map<number, string>>();
  private sentGear = new Map<number, number>();
  private sentMeeting = -1;
  private sentFurniture = -1;
  private handledHome = 0;
  private sentPoses = new Map<string, SentPose>();
  private sentReports: (InspectionReport | null)[] = [];

  constructor(
    private readonly R: Rapier,
    private readonly opts: RoomOptions,
  ) {
    this.code = opts.code;
    // Bots play in the room itself: nothing is sent to them.
    this.send = (id, msg) => {
      if (!this.clients.get(id)?.bot) opts.send(id, msg);
    };
    this.seed = opts.seed ?? 1;
    this.fixedLevel = opts.level ?? null;
    // Furnished by `newWorld` below.
    this.baseLevel = this.fixedLevel ?? HOUSE;
    this.level = this.baseLevel;
    this.fixedTarget = opts.target ?? null;
    this.target = this.fixedTarget ?? BUILDS[0]!;
    this.makeToken =
      opts.token ?? (() => Math.random().toString(36).slice(2) + Date.now().toString(36));
    this.squad = new Squad(R, this);
    this.newWorld(true);
  }

  get playerCount(): number {
    return this.clients.size;
  }

  /** People connected right now (bots do not count: a room of only bots is empty). */
  get connectedCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.connected && !c.bot) n++;
    return n;
  }

  get botCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.bot) n++;
    return n;
  }

  /**
   * Adds a bot to the lobby (only between rounds, while there is room). It plays the next round
   * like anyone, in the role it is dealt. Returns its id, or an error.
   */
  addBot(level: BotLevel): { id: number } | { error: string } {
    return this.addSquadMember(level, false);
  }

  /**
   * Adds a bot that the room takes for a person: it is dealt a role, told what people are told
   * and known to the other bots as people are, but a bot plays it (at `level`). For headless
   * games of bots standing in for people against bots. Returns its id, or an error.
   */
  addStandIn(level: BotLevel): { id: number } | { error: string } {
    return this.addSquadMember(level, true);
  }

  private addSquadMember(level: BotLevel, standIn: boolean): { id: number } | { error: string } {
    if (this.phase !== 'lobby') return { error: 'Bots join between rounds.' };
    if (this.clients.size >= MAX_PLAYERS) return { error: 'This room is full.' };
    const used = new Set([...this.clients.values()].map((c) => c.colour));
    const names = new Set([...this.clients.values()].map((c) => c.name));
    const n = this.nextClientId++;
    const name = BOT_NAMES.find((x) => !names.has(x)) ?? `Bot ${n}`;
    const c: Client = {
      id: n,
      bot: standIn ? null : level,
      role: null,
      name,
      colour: PLAYER_COLOURS.find((x) => !used.has(x)) ?? PLAYER_COLOURS[0]!,
      team: this.smallerTeam(),
      token: '',
      ready: true,
      connected: true,
      leftAtTick: 0,
      inputs: [],
      inputCredits: 0,
      lastSeq: 0,
      actions: [],
      actionCredits: ACTION_BURST,
    };
    this.clients.set(c.id, c);
    // A stand-in, like a person, picks its own role (or none).
    if (!standIn) c.role = this.sideRole(c.id);
    this.spawn(c.id, this.clients.size - 1);
    this.squad.add(c.id, level);
    this.broadcastLobby();
    return { id: c.id };
  }

  /**
   * The role a bot starts with in a solo game, from "Bots play as": a builder when people are
   * the saboteurs; a saboteur when the bots are, while the saboteur places are not all taken by
   * other bots (a builder after that); otherwise none, so it is dealt at random.
   */
  private sideRole(id: number): ChosenRole | null {
    if (!this.opts.rolePicks || this.botSide === 'any') return null;
    if (this.botSide === 'builders') return 'builder';
    const places = this.saboteurs < 0 ? defaultSaboteurs(this.clients.size) : this.saboteurs;
    let taken = 0;
    for (const c of this.clients.values())
      if (c.id !== id && c.bot && c.role === 'saboteur') taken++;
    return taken < places ? 'saboteur' : 'builder';
  }

  /**
   * Sets the role a player (or bot) asks to play in the next round, or null to be dealt one at
   * random. Only in the lobby, and only a room with role picks (see `RoomOptions.rolePicks`)
   * deals the roles asked for.
   */
  chooseRole(id: number, role: ChosenRole | null): void {
    const c = this.clients.get(id);
    if (!c || this.phase !== 'lobby') return;
    c.role = role;
    this.broadcastLobby();
  }

  /** Takes a bot out of the room. */
  removeBot(id: number): void {
    if (!this.clients.get(id)?.bot) return;
    this.squad.remove(id);
    this.remove(id);
  }

  // ---------------------------------------------------------------- membership

  /**
   * Adds (or, with a valid token, reconnects) a player. Returns their id, or an error.
   * `connect` learns their id before the room greets them, so that whatever routes `send` can
   * reach them.
   */
  join(
    name: string,
    token?: string,
    connect?: (id: number) => void,
  ): { id: number } | { error: string } {
    const back = token ? [...this.clients.values()].find((c) => c.token === token) : undefined;
    if (back) {
      back.connected = true;
      if (name.trim()) back.name = cleanName(name);
      connect?.(back.id);
      this.welcome(back);
      return { id: back.id };
    }
    if (this.clients.size >= MAX_PLAYERS && this.phase === 'lobby') {
      // Bots only keep places warm: in the lobby, the last one added makes way for a person.
      const bot = [...this.clients.values()].reverse().find((c) => c.bot);
      if (bot) this.removeBot(bot.id);
    }
    if (this.clients.size >= MAX_PLAYERS) return { error: 'This room is full.' };
    const used = new Set([...this.clients.values()].map((c) => c.colour));
    const c: Client = {
      id: this.nextClientId++,
      bot: null,
      role: null,
      name: cleanName(name) || `Builder ${this.nextClientId - 1}`,
      colour: PLAYER_COLOURS.find((x) => !used.has(x)) ?? PLAYER_COLOURS[0]!,
      team: this.smallerTeam(),
      token: this.makeToken(),
      ready: false,
      connected: true,
      leftAtTick: 0,
      inputs: [],
      inputCredits: 0,
      lastSeq: 0,
      actions: [],
      actionCredits: ACTION_BURST,
    };
    this.clients.set(c.id, c);
    if (!this.hostId) this.hostId = c.id;
    this.spawn(c.id, this.clients.size - 1);
    connect?.(c.id);
    this.welcome(c);
    return { id: c.id };
  }

  private welcome(c: Client): void {
    this.send(c.id, {
      t: 'welcome',
      you: c.id,
      room: this.code,
      token: c.token,
      ice: this.opts.ice?.() ?? [],
    });
    // Someone arriving mid-round joins as a builder.
    this.round?.addPlayer(c.id, c.team);
    this.broadcastLobby();
    this.send(c.id, this.worldMsg(c.id));
    if (this.round && this.phase === 'building') {
      this.send(c.id, this.roleMsg(c.id));
      this.send(c.id, { t: 'meeting', meeting: this.meetingView() });
    }
  }

  /** The connection dropped. The player stays for a while in case they come back. */
  disconnect(clientId: number): void {
    const c = this.clients.get(clientId);
    if (!c || !c.connected) return;
    c.connected = false;
    c.leftAtTick = this.tick;
    c.inputs = [];
    c.actions = [];
    const p = this.sim.players.get(clientId);
    if (p) {
      Object.assign(p.input, { forward: 0, right: 0, jump: false, sprint: false, careful: false });
    }
    this.broadcastLobby();
  }

  private remove(clientId: number): void {
    this.clients.delete(clientId);
    this.sentPageViews.delete(clientId);
    this.sim.removePlayer(clientId);
    if (this.hostId === clientId) {
      const people = [...this.clients.values()].filter((c) => !c.bot);
      const next = people.find((c) => c.connected) ?? people[0];
      this.hostId = next?.id ?? 0;
    }
    this.broadcastLobby();
  }

  /** The team with fewer players in it (the first when even), for someone joining. */
  private smallerTeam(): number {
    const counts = [0, 0];
    for (const c of this.clients.values()) counts[c.team]!++;
    return counts[1]! < counts[0]! ? 1 : 0;
  }

  private spawn(id: number, index: number): Player {
    // In a rival teams world each team starts in its own yard.
    const sites = levelSites(this.level);
    const team = this.clients.get(id)?.team ?? 0;
    const s = sites[Math.min(team, sites.length - 1)]!.spawn;
    const across = [0, 1, -1, 2, -2.4][index % 5]!;
    const spawn = v3(s.x + across, s.y, s.z + Math.floor(index / 5) * 0.9);
    return this.sim.addPlayer({ id, spawn });
  }

  // ---------------------------------------------------------------- messages

  handle(clientId: number, msg: ClientMsg): void {
    const c = this.clients.get(clientId);
    if (!c || !c.connected) return;
    switch (msg.t) {
      case 'input':
        c.inputs.push(msg);
        if (c.inputs.length > 2 * MAX_INPUT_BACKLOG) c.inputs.splice(0, MAX_INPUT_BACKLOG);
        return;
      case 'act':
        // Anything but a well-formed action is dropped here: the tick that runs it must not throw.
        if (!msg.a || typeof msg.a !== 'object' || typeof msg.a.kind !== 'string') return;
        if (c.actions.length < 10 && c.actionCredits >= 1) {
          c.actionCredits--;
          c.actions.push(msg);
        }
        return;
      case 'ready':
        c.ready = !!msg.ready;
        this.broadcastLobby();
        return;
      case 'team':
        if (this.phase !== 'lobby' || c.ready) return;
        c.team = c.team ? 0 : 1;
        this.broadcastLobby();
        return;
      case 'settings':
        if (clientId !== this.hostId || this.phase !== 'lobby') return;
        if (msg.seconds !== undefined && ROUND_LENGTHS.includes(msg.seconds)) {
          this.seconds = msg.seconds;
        }
        if (msg.saboteurs !== undefined && SABOTEUR_SETTINGS.includes(msg.saboteurs)) {
          this.saboteurs = msg.saboteurs;
        }
        if (typeof msg.build === 'string' && (msg.build === RANDOM_BUILD || buildById(msg.build))) {
          this.build = msg.build;
        }
        if (msg.time !== undefined && TIMES_OF_DAY.includes(msg.time)) this.time = msg.time;
        if (isGameMode(msg.mode)) this.mode = msg.mode;
        if (typeof msg.private === 'boolean' && !this.opts.solo) this.private = msg.private;
        if (msg.map !== undefined && isMapId(msg.map) && msg.map !== this.map) {
          this.map = msg.map;
          // The lobby moves to the new map's plain version, so everyone can look round it.
          if (!this.fixedLevel) {
            this.baseLevel = mapById(this.map).plain;
            this.layout = null;
            this.newWorld(false);
            this.broadcastWorld();
          }
        }
        this.broadcastLobby();
        return;
      case 'vote':
        this.round?.vote(clientId, num(msg.target));
        return;
      case 'chat':
        this.chat(c, String(msg.text ?? ''));
        return;
      case 'ping':
        // Answered right away, not on the next tick, so it measures only the connection.
        this.send(clientId, { t: 'pong', n: num(msg.n) });
        return;
      case 'show':
        this.showPage(c.id);
        return;
      case 'signal': {
        // Voice handshakes go only to another player here, and only in the expected shape.
        const to = this.clients.get(num(msg.to));
        const data = cleanSignal(msg.data);
        if (to && to.connected && to.id !== c.id && data) {
          this.send(to.id, { t: 'signal', from: c.id, data });
        }
        return;
      }
      case 'start':
        if (clientId === this.hostId && this.phase === 'lobby') this.startRound();
        return;
      case 'bots': {
        if (clientId !== this.hostId || this.phase !== 'lobby') return;
        const level = isBotLevel(msg.level) ? msg.level : 'normal';
        if (msg.remove !== undefined) this.removeBot(num(msg.remove));
        if (isBotSide(msg.side) && msg.side !== this.botSide) {
          this.botSide = msg.side;
          // Changing the side sets every bot's role afresh, as if each was added now.
          const bots = [...this.clients.values()].filter((c) => c.bot);
          for (const c of bots) c.role = null;
          for (const c of bots) c.role = this.sideRole(c.id);
        }
        // Fill every empty place, or add `add` of them.
        const want = msg.fill ? MAX_PLAYERS - this.clients.size : Math.min(4, num(msg.add));
        for (let i = 0; i < want; i++) if ('error' in this.addBot(level)) break;
        if (msg.level !== undefined && isBotLevel(msg.level)) {
          // Changing the level on its own changes every bot in the room; adding bots at a level
          // leaves the ones already there as they were set (see `pick`).
          if (!want)
            for (const c of this.clients.values()) {
              if (c.bot && c.bot !== level) {
                c.bot = level;
                this.squad.remove(c.id);
                this.squad.add(c.id, level);
              }
            }
          this.botLevel = level;
        }
        this.broadcastLobby();
        return;
      }
      case 'pick': {
        if (clientId !== this.hostId || this.phase !== 'lobby') return;
        const c = this.clients.get(num(msg.id));
        if (!c) return;
        if (c.bot && isBotLevel(msg.level) && c.bot !== msg.level) {
          c.bot = msg.level;
          this.squad.remove(c.id);
          this.squad.add(c.id, msg.level);
        }
        if (this.opts.rolePicks && msg.role !== undefined) {
          c.role = isChosenRole(msg.role) ? msg.role : null;
        }
        this.broadcastLobby();
        return;
      }
      case 'again':
        if (clientId === this.hostId && this.phase === 'results') this.backToLobby();
        return;
      case 'end':
        // The host calls the round off, results or not: everyone is back in the lobby.
        if (clientId === this.hostId && this.phase !== 'lobby') this.backToLobby();
        return;
      case 'hello':
        return;
    }
  }

  // ---------------------------------------------------------------- phases

  /**
   * A fresh world; with `refurnish`, in a newly furnished house; with `rival`, that house and
   * yard doubled for two teams.
   */
  private newWorld(refurnish: boolean, rival = false): void {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    if (refurnish && !this.fixedLevel) {
      this.layout = this.seed;
      this.baseLevel = mapById(this.map).layout(this.layout);
    }
    this.level = rival ? rivalLevel(this.baseLevel) : this.baseLevel;
    this.sim = new Sim(this.R, this.level, this.seed, {
      bell: hasBell(this.mode),
    });
    this.sim.catapultArmed = this.phase !== 'building';
    this.round = null;
    this.sentAssemblies.clear();
    this.sentPages.clear();
    this.sentPageViews.clear();
    this.sentGear.clear();
    this.sentPoses.clear();
    this.sentReports = [];
    this.sentMeeting = -1;
    this.sentFurniture = -1;
    [...this.clients.keys()].forEach((id, i) => this.spawn(id, i));
  }

  /**
   * The build for the next round: the fixed one, the host's pick, or a random one from the
   * room's seed (never the same as last round, so a random lobby sees them all), so every
   * client agrees on it.
   */
  private pickTarget(): TargetBuild {
    // A free build follows no plans.
    if (this.mode === 'free') return FREE_BUILD;
    if (this.fixedTarget) return this.fixedTarget;
    const picked = buildById(this.build);
    if (picked) return picked;
    const others = BUILDS.filter((b) => b.id !== this.target.id);
    const pool = this.rounds > 0 && others.length ? others : BUILDS;
    return pool[Math.floor(makeRng(this.seed ^ 0xb11d)() * pool.length)]!;
  }

  /**
   * Starts a round. Unless `hold` is false, everyone stands still while the role reveal is up,
   * when there are people to read it (bots alone start at once). Unless `refurnish` is false
   * (demo mode, same layout again), the map is laid out anew.
   */
  startRound(hold = true, refurnish = true): void {
    // Every round is played in a newly furnished house; a race in two of them.
    const rival = this.mode === 'rival';
    this.newWorld(refurnish, rival);
    const players = [...this.clients.values()].filter((c) => c.connected).map((c) => c.id);
    const bots = players.filter((id) => this.clients.get(id)?.bot);
    this.target = this.pickTarget();
    this.rounds++;
    // Every round recolours the model a little, so colours alone never give a forgery away.
    const variant = colourVariant(this.target, binColours(this.level), makeRng(this.seed ^ 0x5eed));
    this.night =
      this.time === 'random' ? makeRng(this.seed ^ 0x4157)() < 0.5 : this.time === 'night';
    // The UV printer prints the pictures of this round's model.
    this.sim.loadPrints(variant);
    this.round = new Round(this.sim, variant, {
      seconds: this.seconds,
      hold: hold && players.length > bots.length ? ROLE_REVEAL_HOLD_SECONDS : 0,
      seed: this.seed,
      players,
      saboteurs: rival
        ? 0
        : this.saboteurs < 0
          ? undefined
          : Math.min(this.saboteurs, players.length),
      mode: this.mode,
      teams: new Map([...this.clients.values()].map((c) => [c.id, c.team])),
      saboteursFirst: this.botSide === 'saboteurs' ? bots : [],
      saboteursLast: this.botSide === 'builders' ? bots : [],
      chosen: new Map(
        players.flatMap((id) => {
          const role = this.opts.rolePicks ? this.clients.get(id)?.role : null;
          return role ? [[id, role] as const] : [];
        }),
      ),
    });
    this.phase = 'building';
    this.sim.catapultArmed = false;
    this.handledHome = 0;
    for (const c of this.clients.values()) c.ready = !!c.bot;
    this.broadcastLobby();
    this.broadcastWorld();
    for (const id of players) {
      this.send(id, this.roleMsg(id));
    }
  }

  // ---------------------------------------------------------------- demo mode

  /*
   * Demo mode, for trying everything out alone. Only the in-tab solo room calls these; no
   * message reaches them, so they never run in an online room.
   */

  /**
   * Starts a new round right away with this build, time of day and role for everyone. With
   * `newLayout` false the map keeps the layout it has (unless it is another map now), so a
   * round can be played again in the same house; otherwise it is laid out anew.
   */
  demoRound(opts: {
    build: string;
    night: boolean;
    role: Role;
    pinned: boolean;
    mode?: GameMode;
    map?: MapId;
    newLayout?: boolean;
  }): void {
    if (opts.build === RANDOM_BUILD || buildById(opts.build)) this.build = opts.build;
    this.time = opts.night ? 'night' : 'day';
    this.mode = opts.mode ?? 'saboteur';
    const otherMap = isMapId(opts.map) && opts.map !== this.map;
    if (isMapId(opts.map)) this.map = opts.map;
    this.saboteurs = 0;
    this.seconds = Math.max(...ROUND_LENGTHS);
    // Alone with the demo panel there is nobody to wait for.
    this.startRound(false, opts.newLayout !== false || otherMap || this.layout === null);
    for (const id of this.round!.roles.keys()) this.demoRole(id, opts.role);
    if (opts.pinned) this.demoPinManuals();
  }

  /**
   * Makes a player a builder, a saboteur or (blind build) the reader in the running round. A
   * blind build's builder plays as if the reader were someone else, so the pages are smudged.
   */
  demoRole(id: number, role: Role): void {
    if (!this.round || this.phase !== 'building' || !this.clients.has(id)) return;
    this.round.setRole(id, role);
    this.send(id, this.roleMsg(id));
    // Who can read the pages may have changed, so they go out again as this player now sees them.
    for (const page of this.sim.pages.values()) {
      this.send(id, { t: 'page', p: this.pageView(page, id) });
    }
  }

  /** Switches the running round (and the next ones) between day and night. */
  demoNight(night: boolean): void {
    this.night = night;
    this.time = night ? 'night' : 'day';
    this.broadcastLobby();
    this.broadcast({ t: 'night', night });
  }

  /**
   * Pins this round's pages to the corkboards in order, reading left to right and top to bottom,
   * front face first and board by board, the master index after the last step. Pages that do
   * not fit (a manual of 32 pages leaves its index off) stay where they are.
   */
  demoPinManuals(): void {
    // Step order, the master index last.
    const order = (p: PageItem) => (p.step < 0 ? Infinity : p.step);
    const pages = [...this.sim.pages.values()].sort((a, b) => order(a) - order(b));
    pages
      .slice(0, boardSlots(this.sim.level))
      .forEach((page, i) => this.sim.pinToBoard(page, readingSlot(i)));
  }

  /** Finishes the team's build on its baseplate, exactly as this round's pages show it. */
  demoFinishBuild(): void {
    if (this.round && this.phase === 'building') this.sim.finishBuild(this.round.target);
  }

  /** Breaks the electrical panel now, as if its time had come. */
  demoPowerCut(): void {
    if (this.round && this.phase === 'building') this.sim.breakPower();
  }

  /** Gets the power back on now, as if someone had fixed the panel. */
  demoPowerRestore(): void {
    if (this.round && this.phase === 'building') this.sim.restorePower();
  }

  /** Clears every loose brick and piece off the map, leaving the team's build alone. */
  demoClearPieces(): void {
    if (this.round && this.phase === 'building') this.sim.clearLoose();
  }

  private backToLobby(): void {
    this.newWorld(false);
    this.phase = 'lobby';
    this.broadcastLobby();
    this.broadcastWorld();
  }

  // ---------------------------------------------------------------- simulation

  /**
   * `ticks` whoever runs the room let go rather than ran (see `catchUp`). The players played on
   * through them, and their inputs for them still come: each is owed the inputs it may have
   * applied in them, or a backlog would be worked off no faster than it builds up, and every
   * move be applied late from then on (rounds later, as a rubber band on a game in this tab).
   */
  letGo(ticks: number): void {
    for (const c of this.clients.values())
      c.inputCredits = Math.min(MAX_INPUT_BACKLOG, c.inputCredits + ticks * INPUT_CREDIT_PER_TICK);
  }

  update(): void {
    this.tick++;
    // Bots decide first and send their inputs like anyone, to be applied below.
    this.squad.update();
    for (const c of [...this.clients.values()]) {
      if (!c.connected && this.tick - c.leftAtTick > RECONNECT_GRACE_TICKS) this.remove(c.id);
    }
    // During a Brick Meeting, and while the round starts and everyone reads their role, everyone
    // stands still and nothing can be touched.
    const frozen = !!this.round?.meeting || !!this.round?.starting;
    for (const c of this.clients.values()) {
      const p = this.sim.players.get(c.id);
      if (!p) {
        // Sent home: watching only.
        c.inputs = [];
        c.actions = [];
        continue;
      }
      // One input is one tick of movement, exactly as the client predicted it. No input, no
      // movement (never guess). A backlog after a hiccup is worked off a few inputs per tick.
      if (c.inputs.length > MAX_INPUT_BACKLOG) {
        c.inputs.splice(0, c.inputs.length - MAX_INPUT_BACKLOG);
      }
      c.inputCredits = Math.min(MAX_INPUT_BACKLOG, c.inputCredits + INPUT_CREDIT_PER_TICK);
      c.actionCredits = Math.min(ACTION_BURST, c.actionCredits + ACTIONS_PER_SECOND / TICK_RATE);
      const backlog = c.inputs.length;
      const want = backlog > 8 ? 4 : backlog > 2 ? 2 : backlog;
      const consumed = c.inputs.splice(0, Math.min(want, Math.floor(c.inputCredits)));
      c.inputCredits -= consumed.length;
      p.pendingInputs = consumed.map((input) => ({
        forward: frozen ? 0 : clamp(input.f, -1, 1),
        right: frozen ? 0 : clamp(input.r, -1, 1),
        jump: !frozen && !!input.jump,
        sprint: !!input.sprint,
        careful: !!input.careful,
        yaw: num(input.yaw),
        pitch: clamp(num(input.pitch), -1.5, 1.5),
        firstPerson: !!input.fp,
      }));
      const last = consumed.at(-1);
      if (last) {
        Object.assign(p.input, p.pendingInputs.at(-1));
        c.lastSeq = last.seq;
      }
      // An action waits until the movement input it was made after has been applied.
      const due = c.actions.filter((a) => !(num(a.seq) > c.lastSeq) || c.inputs.length === 0);
      c.actions = c.actions.filter((a) => !due.includes(a));
      if (this.phase === 'results' || frozen) continue;
      for (const act of due) {
        // A click turns the player to the view it was made with, so it lands where their
        // crosshair was (sabotage like hiding a page aims the same way). It is their real view
        // at that moment, kept until the next input turns them on from it.
        p.input.yaw = num(act.yaw);
        p.input.pitch = clamp(num(act.pitch), -1.5, 1.5);
        p.input.firstPerson = !!act.fp;
        if (act.a?.kind === 'sabotage') this.sabotage(c.id, act.a.tool);
        else if (!this.clickToHide(c.id, act.a)) this.sim.act(c.id, act.a);
      }
    }

    this.sim.dogMayWreck = this.round?.dogMayWreck ?? false;
    this.sim.step();
    this.round?.update();
    const events = this.sim.events;
    this.sim.events = [];
    this.squad.witness(events);
    this.opts.onEvents?.(events);

    const round = this.round;
    if (round) {
      // Players voted off the job site leave the world and watch.
      while (this.handledHome < round.sentHome.length) {
        this.sim.removePlayer(round.sentHome[this.handledHome++]!);
        this.broadcastLobby();
      }
      if (round.meetingVersion !== this.sentMeeting) {
        this.sentMeeting = round.meetingVersion;
        this.broadcast({ t: 'meeting', meeting: this.meetingView() });
      }
      if (round.phase === 'results' && this.phase === 'building') {
        this.phase = 'results';
        this.sim.catapultArmed = true;
        const teams = round.rival
          ? round.teamResults.map((result, i) => ({
              name: TEAM_NAMES[i] ?? `Team ${i + 1}`,
              result: result!,
              handedIn: round.finished[i] === null ? null : this.seconds - round.finished[i]!,
            }))
          : null;
        for (const c of this.clients.values()) {
          if (!c.connected) continue;
          this.send(c.id, {
            t: 'result',
            result: (round.rival && round.teamResults[c.team]) || round.result!,
            reason: round.endReason!,
            winner: round.winner!,
            roles: [...round.roles],
            sentHome: round.sentHome,
            teams,
          });
        }
        this.broadcastLobby();
      }
    }
    this.syncStructure();
    if (this.sim.furnitureVersion !== this.sentFurniture) {
      this.sentFurniture = this.sim.furnitureVersion;
      this.broadcast({ t: 'furniture', furniture: this.furniture() });
    }
    if (events.length) this.sendEvents(events);
    this.round?.inspectors.forEach((ins, site) => {
      if (ins.report && ins.report !== this.sentReports[site]) {
        this.sentReports[site] = ins.report;
        this.broadcast({ t: 'report', report: ins.report, site });
      }
    });
    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
  }

  /** Sends what changed about the world's structure: new, rebuilt, held or removed things. */
  private syncStructure(): void {
    const { sim } = this;
    for (const a of sim.assemblies.values()) {
      const sent = this.sentAssemblies.get(a.id);
      if (!sent || sent.version !== a.version) {
        this.broadcast({ t: 'asm', a: assemblyState(a) });
        this.sentPoses.set(`a${a.id}`, { pos: a.body.translation(), rot: a.body.rotation() });
      } else if (sent.anchored !== a.anchored || sent.heldBy !== a.heldBy) {
        this.broadcast({
          t: 'held',
          id: a.id,
          heldBy: a.heldBy,
          anchored: a.anchored,
          pos: toV(a.body.translation()),
          rot: toQ(a.body.rotation()),
        });
      } else continue;
      this.sentAssemblies.set(a.id, { version: a.version, anchored: a.anchored, heldBy: a.heldBy });
    }
    for (const id of this.sentAssemblies.keys()) {
      if (!sim.assemblies.has(id)) {
        this.sentAssemblies.delete(id);
        this.sentPoses.delete(`a${id}`);
        this.broadcast({ t: 'asmDel', id });
      }
    }
    for (const page of sim.pages.values()) {
      if (this.sentPages.get(page.id) === page.version) continue;
      this.sentPages.set(page.id, page.version);
      this.sentPoses.delete(`p${page.id}`);
      for (const c of this.clients.values()) {
        if (!c.connected) continue;
        // A change this client cannot see (a page reprinted in someone else's pocket) is not
        // sent at all: the message alone would tell them something happened to it.
        const before = this.sentPageViews.get(c.id)?.get(page.id);
        const p = this.pageView(page, c.id);
        if (JSON.stringify(p) !== before) this.send(c.id, { t: 'page', p });
      }
    }
    for (const item of sim.gear.values()) {
      if (this.sentGear.get(item.id) === item.version) continue;
      this.sentGear.set(item.id, item.version);
      this.sentPoses.delete(`g${item.id}`);
      this.broadcast({ t: 'gear', g: gearState(item) });
    }
  }

  /** Sends effects; saboteur tells only reach players close enough to notice them. */
  private sendEvents(events: SimEvent[]): void {
    for (const c of this.clients.values()) {
      if (!c.connected) continue;
      const p = this.sim.players.get(c.id);
      const seen = events.filter((e) => {
        if (e.witnessRange === undefined || e.playerId === c.id) return true;
        return !!p && length(sub(p.body.translation(), e.pos)) <= e.witnessRange;
      });
      if (seen.length) this.send(c.id, { t: 'fx', events: seen });
    }
  }

  /**
   * A saboteur clicking a hiding place with a page in their pocket puts the page in it: the
   * same click that opens it for everyone else. Returns whether the click was used up.
   */
  private clickToHide(clientId: number, a: Action): boolean {
    if (a?.kind !== 'grab' && a?.kind !== 'place') return false;
    if (!this.round?.hidesOnClick(clientId)) return false;
    return this.sabotage(clientId, 'hide');
  }

  private sabotage(clientId: number, tool: SabotageTool): boolean {
    const round = this.round;
    if (!round?.sabotage(clientId, tool)) return false;
    this.send(clientId, {
      t: 'sabotaged',
      tool,
      cooldown: round.cooldown(clientId, tool),
      charges: round.chargesLeft(clientId, tool),
    });
    return true;
  }

  /**
   * Text chat. In the lobby, meetings and results everyone hears everyone; while building only
   * players within shouting distance do. Players sent home only talk among themselves.
   */
  private chat(from: Client, raw: string): void {
    const text = raw
      .replace(/\p{Cc}/gu, '')
      .replace(BIDI_CONTROLS, '')
      .trim()
      .slice(0, 200);
    if (!text) return;
    const home = this.round?.sentHome.includes(from.id) ?? false;
    const near = this.phase === 'building' && !this.round?.meeting && !home;
    const scope = home ? 'home' : near ? 'near' : 'all';
    const origin = this.sim.players.get(from.id)?.body.translation();
    // Bots close enough to hear it (bots say nothing to each other in words: they share what
    // they know anyway).
    const listening: number[] = [];
    for (const c of this.clients.values()) {
      if (!c.connected) continue;
      const theirHome = this.round?.sentHome.includes(c.id) ?? false;
      if (home && !theirHome) continue;
      if (near && c.id !== from.id) {
        const at = this.sim.players.get(c.id)?.body.translation();
        // Players sent home overhear everything; on site, only within shouting distance.
        if (!theirHome && (!at || !origin || length(sub(at, origin)) > CHAT_RANGE)) continue;
      }
      if (c.bot) listening.push(c.id);
      else this.send(c.id, { t: 'chat', from: from.id, text, scope });
    }
    if (!from.bot && listening.length) this.squad.hear(from.id, text, listening);
  }

  private furniture(): FurnitureState {
    return this.sim.replication.furnitureState();
  }

  /** Shows the page in a player's pocket to everyone within reading distance. */
  private showPage(id: number): void {
    const p = this.sim.players.get(id);
    const page = p?.page != null ? this.sim.pages.get(p.page) : undefined;
    if (!p || !page?.printed || this.phase !== 'building') return;
    const at = p.body.translation();
    for (const c of this.clients.values()) {
      if (c.id === id || !c.connected) continue;
      const other = this.sim.players.get(c.id)?.body.translation();
      // In blind build mode only the reader can make a page out, held up or not.
      if (other && length(sub(other, at)) <= SHOW_RANGE && this.round!.canRead(c.id)) {
        this.send(c.id, { t: 'shown', from: id, printed: page.printed });
      }
    }
  }

  private roleMsg(id: number): ServerMsg {
    const r = this.round!;
    const saboteurs = [...r.roles.values()].filter((x) => x === 'saboteur').length;
    return {
      t: 'role',
      role: r.role(id),
      partners: r.partners(id),
      saboteurs,
      reader: r.reader,
      team: r.rival ? r.teamOf(id) : null,
    };
  }

  private meetingView(): MeetingView | null {
    const m = this.round?.meeting;
    if (!m) return null;
    return {
      calledBy: m.calledBy,
      onSite: this.round!.onSite,
      voted: [...m.votes.keys()],
      outcome: m.outcome,
    };
  }

  private sendSnapshots(): void {
    const { sim } = this;
    const players: PlayerT[] = [...sim.players.values()].map((p) => {
      const t = p.body.translation();
      return [
        p.id,
        t.x,
        t.y,
        t.z,
        p.input.yaw,
        p.input.pitch,
        p.holding?.assemblyId ?? 0,
        p.holding?.rot ?? 0,
        p.page ?? 0,
        p.down,
        p.limp,
        p.knocks,
        p.treat ? 1 : 0,
        p.input.careful ? 1 : 0,
        p.holding?.yawOffset ?? 0,
        gearBits(p.gear),
        p.ladder ?? -1,
        !p.grounded && p.ladder === null && p.down === 0 ? 1 : 0,
        p.fatigue,
        p.squeeze ? Math.atan2(p.squeeze.x, p.squeeze.z) : NO_SQUEEZE,
        p.work?.there
          ? [
              p.work.hand.x,
              p.work.hand.y,
              p.work.hand.z,
              MACHINE_ACTS.indexOf(p.work.act),
              p.work.slot,
              p.work.machineId ?? -1,
              p.work.n,
            ]
          : 0,
        (p.holding?.flip ? 1 : 0) + (p.holding?.eighth ? 2 : 0),
      ];
    });
    const bodies: BodyT[] = [];
    for (const a of sim.assemblies.values()) {
      if (a.anchored) continue;
      const pos = a.body.translation();
      const rot = a.body.rotation();
      const key = `a${a.id}`;
      if (!moved(this.sentPoses.get(key), pos, rot)) continue;
      this.sentPoses.set(key, { pos, rot });
      bodies.push(bodyT(a.id, pos, rot));
    }
    const pages: BodyT[] = [];
    for (const page of sim.pages.values()) {
      if (!page.body) continue;
      const pos = page.body.translation();
      const rot = page.body.rotation();
      const key = `p${page.id}`;
      if (!moved(this.sentPoses.get(key), pos, rot)) continue;
      this.sentPoses.set(key, { pos, rot });
      pages.push(bodyT(page.id, pos, rot));
    }
    const gear: BodyT[] = [];
    for (const item of sim.gear.values()) {
      if (!item.body) continue;
      const pos = item.body.translation();
      const rot = item.body.rotation();
      const key = `g${item.id}`;
      if (!moved(this.sentPoses.get(key), pos, rot)) continue;
      this.sentPoses.set(key, { pos, rot });
      gear.push(bodyT(item.id, pos, rot));
    }
    const d = sim.dog;
    const dt = d.body.translation();
    const dog: DogT = [
      dt.x,
      dt.y,
      dt.z,
      d.yaw,
      DOG_MODES.indexOf(d.mode),
      d.page ?? 0,
      d.patBy ?? 0,
    ];
    const b = sim.vacuum;
    const vacuum: VacuumT = [
      b.heldBy ?? 0,
      b.pos.x,
      b.pos.y,
      b.pos.z,
      b.yaw,
      b.leaning ? 1 : 0,
      b.load,
    ];
    const round = this.roundSummary();
    for (const c of this.clients.values()) {
      if (!c.connected) continue;
      const me = sim.players.get(c.id);
      const vy = me?.vy ?? 0;
      const vel: [number, number] = [me?.vel.x ?? 0, me?.vel.z ?? 0];
      const slip = me?.slip;
      const squeeze = me?.squeeze;
      const work = me?.work;
      this.send(c.id, {
        t: 'snap',
        tick: this.tick,
        ack: c.lastSeq,
        vy,
        vel,
        ...(slip && { slip: [slip.x, slip.z] as [number, number] }),
        ...(squeeze && { squeeze: [squeeze.x, squeeze.z] as [number, number] }),
        ...(work && { work }),
        players,
        bodies,
        pages,
        gear,
        dog,
        vacuum,
        round,
      });
    }
  }

  private roundSummary(): RoundSummary | null {
    const r = this.round;
    if (!r) return null;
    return {
      timeLeft: r.timeLeft,
      doneArmed: r.inspectors.map((_, site) => r.doneArmedFor(site)),
      meetingLeft: r.meeting && !r.meeting.outcome ? r.meeting.ticksLeft / TICK_RATE : 0,
      startsIn: r.holdLeft,
      inspectors: r.inspectors.map((ins) => ({
        status: ins.status,
        progress: ins.progress,
        scannedVersion: ins.scannedVersion,
      })),
      handedIn: r.finished.map((f) => (f === null ? null : this.seconds - f)),
    };
  }

  /**
   * A page as this client gets to see it. What is printed on it is left out where they could not
   * see it: in someone else's pocket, tucked away in a hiding place, or (blind build) for all but
   * the reader.
   */
  private pageStateFor(page: PageItem, clientId: number): PageState {
    const s = pageState(page, this.sim.dog.page);
    const pocketed =
      page.carriedBy !== null && page.carriedBy !== clientId && this.clients.has(page.carriedBy);
    const canRead = !this.round || this.round.canRead(clientId);
    if (pocketed && canRead && page.printed) s.label = pageName(page.printed);
    if (pocketed || page.hidden) s.printed = null;
    if (!canRead) s.printed = null;
    return s;
  }

  /** `pageStateFor`, noting what this client was sent. */
  private pageView(page: PageItem, clientId: number): PageState {
    const s = this.pageStateFor(page, clientId);
    let views = this.sentPageViews.get(clientId);
    if (!views) this.sentPageViews.set(clientId, (views = new Map()));
    views.set(page.id, JSON.stringify(s));
    return s;
  }

  private broadcastWorld(): void {
    for (const c of this.clients.values()) if (c.connected) this.send(c.id, this.worldMsg(c.id));
  }

  private worldMsg(clientId: number): WorldMsg {
    return {
      t: 'world',
      tick: this.tick,
      phase: this.phase,
      buildIds: this.sim.buildIds,
      rival: !!this.level.divide,
      map: this.map,
      layout: this.layout,
      targetId: this.target.id,
      assemblies: [...this.sim.assemblies.values()].map(assemblyState),
      pages: [...this.sim.pages.values()].map((p) => this.pageView(p, clientId)),
      round: this.roundSummary(),
      reports: this.round?.inspectors.map((ins) => ins.report) ?? [],
      furniture: this.furniture(),
      target: this.round?.target ?? null,
      night: this.night,
      mode: this.mode,
      gear: [...this.sim.gear.values()].map(gearState),
    };
  }

  /** How the room list shows this room, or null when it is not listed (private, or empty). */
  listing(): RoomListing | null {
    const people = this.connectedCount;
    if (this.private || people === 0) return null;
    // In the lobby a bot makes way for anyone who joins, so only people take up places.
    const players = this.phase === 'lobby' ? people : people + this.botCount;
    return {
      code: this.code,
      host: this.clients.get(this.hostId)?.name ?? '',
      map: this.map,
      mode: this.mode,
      players,
      max: MAX_PLAYERS,
      playing: this.phase !== 'lobby',
    };
  }

  // ---------------------------------------------------------------- sending

  private lobbyPlayers(): LobbyPlayer[] {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      colour: c.colour,
      team: c.team,
      ready: c.ready,
      connected: c.connected,
      home: this.round?.sentHome.includes(c.id) ?? false,
      ...(c.bot ? { bot: c.bot } : {}),
      ...(c.role ? { role: c.role } : {}),
    }));
  }

  private broadcastLobby(): void {
    this.broadcast({
      t: 'lobby',
      phase: this.phase,
      host: this.hostId,
      seconds: this.seconds,
      saboteurs: this.saboteurs,
      build: this.fixedTarget?.id ?? this.build,
      time: this.time,
      mode: this.mode,
      map: this.map,
      private: this.private,
      botLevel: this.botLevel,
      botSide: this.botSide,
      rolePicks: !!this.opts.rolePicks,
      solo: !!this.opts.solo,
      players: this.lobbyPlayers(),
    });
  }

  private broadcast(msg: ServerMsg): void {
    for (const c of this.clients.values()) if (c.connected) this.send(c.id, msg);
  }
}

/**
 * The corkboard slot of the `i`th page in reading order. Seen from in front, each row's slots
 * run right to left (see `Sim.slotPose`).
 */
export function readingSlot(i: number): number {
  const row = Math.floor(i / 4);
  return row * 4 + (3 - (i % 4));
}

export function isHello(msg: ClientMsg): msg is Extract<ClientMsg, { t: 'hello' }> {
  return msg.t === 'hello' && msg.v === PROTOCOL_VERSION;
}

/** Characters that flip the direction text runs in, so a name could pass itself off as another. */
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g;

function cleanName(name: unknown): string {
  return String(name ?? '')
    .replace(/[<>]/g, '')
    .replace(/\p{Cc}/gu, '')
    .replace(BIDI_CONTROLS, '')
    .trim()
    .slice(0, 20);
}

/** A voice handshake message rebuilt from what a client sent, or null if it is malformed. */
export function cleanSignal(raw: unknown): SignalData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null);
  if (r.sdp && typeof r.sdp === 'object') {
    const d = r.sdp as Record<string, unknown>;
    const sdp = str(d.sdp, 20_000);
    if ((d.type === 'offer' || d.type === 'answer') && sdp !== null) {
      return { sdp: { type: d.type, sdp } };
    }
    return null;
  }
  if (r.ice && typeof r.ice === 'object') {
    const d = r.ice as Record<string, unknown>;
    const candidate = str(d.candidate, 2_000);
    if (candidate === null) return null;
    const sdpMid = d.sdpMid == null ? null : str(d.sdpMid, 64);
    const line = d.sdpMLineIndex;
    const sdpMLineIndex =
      typeof line === 'number' && Number.isInteger(line) && line >= 0 && line < 64 ? line : null;
    return { ice: { candidate, sdpMid, sdpMLineIndex } };
  }
  return null;
}

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

function clamp(x: unknown, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, num(x)));
}
