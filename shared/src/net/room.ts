import type RAPIER from '@dimforge/rapier3d-compat';
import { BUILDS, buildById } from '../builds/catalog.ts';
import type { InspectionReport } from '../builds/report.ts';
import type { TargetBuild } from '../builds/types.ts';
import { BOARD_SLOTS, HOUSE } from '../content/house.ts';
import type { LevelDef } from '../content/house.ts';
import { houseLayout } from '../content/layout.ts';
import { length, makeRng, sub, v3 } from '../math.ts';
import { binColours, colourVariant } from '../builds/variant.ts';
import { faceOr, hatOr, lookOr, shirtOr } from '../look.ts';
import { gearBits, isGameMode } from '../gear.ts';
import type { GameMode } from '../gear.ts';
import type { FaceId, HatId, ShirtId } from '../look.ts';
import type { Quat, Vec3 } from '../math.ts';
import { DEFAULT_ROUND_SECONDS, Round } from '../round.ts';
import type { Role, SabotageTool } from '../round.ts';
import { DOG_MODES } from '../sim/dog.ts';
import { Sim, TICK_RATE } from '../sim/sim.ts';
import type { Action, Player, SimEvent } from '../sim/sim.ts';
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  RANDOM_BUILD,
  ROUND_LENGTHS,
  SABOTEUR_SETTINGS,
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
  PlayerT,
  BroomT,
  DogT,
  RoomPhase,
  RoundSummary,
  ServerMsg,
  SignalData,
  TimeOfDay,
  WorldMsg,
} from './protocol.ts';

/** In a round's last this many seconds the dog leaves the build alone, however hungry. */
export const DOG_WRECK_CUTOFF_SECONDS = 90;

type Rapier = typeof RAPIER;

/** How long a dropped player keeps their spot (and their character) for a reconnect. */
export const RECONNECT_GRACE_TICKS = 30 * TICK_RATE;
/** Players this close can read a page held up to them (metres). */
export const SHOW_RANGE = 5;
/** While building, chat only reaches players this close (metres). */
export const CHAT_RANGE = 12;
/** Inputs buffered beyond this (two seconds' worth) are dropped, only after a long stall. */
const MAX_INPUT_BACKLOG = 120;

export const PLAYER_COLOURS = [
  0xf07d1a, 0x1e5bc6, 0x2c9a3a, 0xc91a1a, 0x8e44ad, 0x16a3a3, 0xf5c518, 0xe84393, 0x6d4c41,
  0x7f8c8d,
];

interface Client {
  id: number;
  name: string;
  colour: number;
  hat: HatId;
  face: FaceId;
  shirt: ShirtId;
  token: string;
  ready: boolean;
  connected: boolean;
  leftAtTick: number;
  inputs: InputMsg[];
  lastSeq: number;
  actions: { a: Action; seq: number; yaw: number; pitch: number; fp: boolean }[];
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
  time: TimeOfDay = 'day';
  /** Whether the current round (or the last one, back in the lobby) is played at night. */
  night = false;
  sim!: Sim;
  round: Round | null = null;
  readonly clients = new Map<number, Client>();
  tick = 0;

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
  private sentGear = new Map<number, number>();
  private sentMeeting = -1;
  private sentFurniture = -1;
  private handledHome = 0;
  private sentPoses = new Map<string, SentPose>();
  private sentReport: InspectionReport | null = null;

  constructor(
    private readonly R: Rapier,
    private readonly opts: RoomOptions,
  ) {
    this.code = opts.code;
    this.send = opts.send;
    this.seed = opts.seed ?? 1;
    this.fixedLevel = opts.level ?? null;
    // Furnished by `newWorld` below.
    this.level = this.fixedLevel ?? HOUSE;
    this.fixedTarget = opts.target ?? null;
    this.target = this.fixedTarget ?? BUILDS[0]!;
    this.makeToken =
      opts.token ?? (() => Math.random().toString(36).slice(2) + Date.now().toString(36));
    this.newWorld(true);
  }

  get playerCount(): number {
    return this.clients.size;
  }

  get connectedCount(): number {
    let n = 0;
    for (const c of this.clients.values()) if (c.connected) n++;
    return n;
  }

  // ---------------------------------------------------------------- membership

  /**
   * Adds (or, with a valid token, reconnects) a player. Returns their id, or an error. `look`
   * is their hat, face and shirt (the hello message carries them); anything unknown in it (an
   * old client, a tampered save) is the default.
   */
  join(name: string, token?: string, look?: unknown): { id: number } | { error: string } {
    const back = token ? [...this.clients.values()].find((c) => c.token === token) : undefined;
    if (back) {
      back.connected = true;
      if (name.trim()) back.name = cleanName(name);
      if (look !== undefined) Object.assign(back, lookOr(look));
      this.welcome(back);
      return { id: back.id };
    }
    if (this.clients.size >= MAX_PLAYERS) return { error: 'This room is full.' };
    const used = new Set([...this.clients.values()].map((c) => c.colour));
    const c: Client = {
      id: this.nextClientId++,
      name: cleanName(name) || `Builder ${this.nextClientId - 1}`,
      colour: PLAYER_COLOURS.find((x) => !used.has(x)) ?? PLAYER_COLOURS[0]!,
      ...lookOr(look),
      token: this.makeToken(),
      ready: false,
      connected: true,
      leftAtTick: 0,
      inputs: [],
      lastSeq: 0,
      actions: [],
    };
    this.clients.set(c.id, c);
    if (!this.hostId) this.hostId = c.id;
    this.spawn(c.id, this.clients.size - 1);
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
    this.round?.addPlayer(c.id);
    this.broadcastLobby();
    this.send(c.id, this.worldMsg());
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
    this.sim.removePlayer(clientId);
    if (this.hostId === clientId) {
      const next =
        [...this.clients.values()].find((c) => c.connected) ?? [...this.clients.values()][0];
      this.hostId = next?.id ?? 0;
    }
    this.broadcastLobby();
  }

  private spawn(id: number, index: number): Player {
    const s = this.level.spawn;
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
        if (c.actions.length < 10) c.actions.push(msg);
        return;
      case 'ready':
        c.ready = !!msg.ready;
        this.broadcastLobby();
        return;
      case 'look': {
        // The lobby before readying up is the time to choose: mid-round, a look changing
        // would rebuild the avatar (and lose a ragdoll in flight), and once ready the look is
        // settled, like the name.
        if (this.phase !== 'lobby' || c.ready) return;
        const hat = msg.hat === undefined ? c.hat : hatOr(msg.hat);
        const face = msg.face === undefined ? c.face : faceOr(msg.face);
        const shirt = msg.shirt === undefined ? c.shirt : shirtOr(msg.shirt);
        if (hat === c.hat && face === c.face && shirt === c.shirt) return;
        Object.assign(c, { hat, face, shirt });
        this.broadcastLobby();
        return;
      }
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
      case 'again':
        if (clientId === this.hostId && this.phase === 'results') this.backToLobby();
        return;
      case 'hello':
        return;
    }
  }

  // ---------------------------------------------------------------- phases

  /** A fresh world; with `refurnish`, in a newly furnished house. */
  private newWorld(refurnish: boolean): void {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    if (refurnish && !this.fixedLevel) {
      this.layout = this.seed;
      this.level = houseLayout(this.layout);
    }
    this.sim = new Sim(this.R, this.level, this.seed, { bell: this.mode !== 'gear' });
    this.round = null;
    this.sentAssemblies.clear();
    this.sentPages.clear();
    this.sentGear.clear();
    this.sentPoses.clear();
    this.sentReport = null;
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
    if (this.fixedTarget) return this.fixedTarget;
    const picked = buildById(this.build);
    if (picked) return picked;
    const others = BUILDS.filter((b) => b.id !== this.target.id);
    const pool = this.rounds > 0 && others.length ? others : BUILDS;
    return pool[Math.floor(makeRng(this.seed ^ 0xb11d)() * pool.length)]!;
  }

  startRound(): void {
    // Every round is played in a newly furnished house.
    this.newWorld(true);
    const players = [...this.clients.values()].filter((c) => c.connected).map((c) => c.id);
    this.target = this.pickTarget();
    this.rounds++;
    // Every round recolours the model a little, so colours alone never give a forgery away.
    const variant = colourVariant(this.target, binColours(this.level), makeRng(this.seed ^ 0x5eed));
    this.night =
      this.time === 'random' ? makeRng(this.seed ^ 0x4157)() < 0.5 : this.time === 'night';
    this.round = new Round(this.sim, variant, {
      seconds: this.seconds,
      seed: this.seed,
      players,
      saboteurs: this.saboteurs < 0 ? undefined : Math.min(this.saboteurs, players.length),
      mode: this.mode,
    });
    this.phase = 'building';
    this.handledHome = 0;
    for (const c of this.clients.values()) c.ready = false;
    this.broadcastLobby();
    this.broadcast(this.worldMsg());
    for (const id of players) {
      this.send(id, this.roleMsg(id));
    }
  }

  // ---------------------------------------------------------------- demo mode

  /*
   * Demo mode, for trying everything out alone. Only the in-tab solo room calls these; no
   * message reaches them, so they never run in an online room.
   */

  /** Starts a new round right away with this build, time of day and role for everyone. */
  demoRound(opts: {
    build: string;
    night: boolean;
    role: Role;
    pinned: boolean;
    mode?: GameMode;
  }): void {
    if (opts.build === RANDOM_BUILD || buildById(opts.build)) this.build = opts.build;
    this.time = opts.night ? 'night' : 'day';
    this.mode = opts.mode ?? 'saboteur';
    this.saboteurs = 0;
    this.seconds = Math.max(...ROUND_LENGTHS);
    this.startRound();
    if (opts.role === 'saboteur') {
      for (const id of this.round!.roles.keys()) this.demoRole(id, 'saboteur');
    }
    if (opts.pinned) this.demoPinManuals();
  }

  /** Makes a player a builder or a saboteur in the running round. */
  demoRole(id: number, role: Role): void {
    if (!this.round || this.phase !== 'building' || !this.clients.has(id)) return;
    this.round.setRole(id, role);
    this.send(id, this.roleMsg(id));
  }

  /** Switches the running round (and the next ones) between day and night. */
  demoNight(night: boolean): void {
    this.night = night;
    this.time = night ? 'night' : 'day';
    this.broadcastLobby();
  }

  /**
   * Pins this round's pages to the corkboard in order, reading left to right and top to bottom,
   * front face first, the master index after the last step. Pages that do not fit (the castle
   * has 16 steps) stay where they are.
   */
  demoPinManuals(): void {
    const order = (step: number) => (step < 0 ? Infinity : step);
    const pages = [...this.sim.pages.values()].sort((a, b) => order(a.step) - order(b.step));
    pages.slice(0, BOARD_SLOTS).forEach((page, i) => this.sim.pinToBoard(page, readingSlot(i)));
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
    this.broadcast(this.worldMsg());
  }

  // ---------------------------------------------------------------- simulation

  update(): void {
    this.tick++;
    for (const c of [...this.clients.values()]) {
      if (!c.connected && this.tick - c.leftAtTick > RECONNECT_GRACE_TICKS) this.remove(c.id);
    }
    // During a Brick Meeting everyone stands still and nothing can be touched.
    const frozen = !!this.round?.meeting;
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
      const backlog = c.inputs.length;
      const consumed = c.inputs.splice(0, backlog > 8 ? 4 : backlog > 2 ? 2 : backlog);
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
        p.input.yaw = num(act.yaw);
        p.input.pitch = clamp(num(act.pitch), -1.5, 1.5);
        p.input.firstPerson = !!act.fp;
        if (act.a?.kind === 'sabotage') this.sabotage(c.id, act.a.tool);
        else if (!this.clickToHide(c.id, act.a)) this.sim.act(c.id, act.a);
      }
    }

    // The hungry dog may wreck the build only while building, and not in the last 90 seconds.
    this.sim.dogMayWreck =
      this.phase === 'building' &&
      !!this.round &&
      !this.round.meeting &&
      this.round.timeLeft > DOG_WRECK_CUTOFF_SECONDS;
    this.sim.step();
    this.round?.update();
    const events = this.sim.events;
    this.sim.events = [];

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
        this.broadcast({
          t: 'result',
          result: round.result!,
          reason: round.endReason!,
          winner: round.winner!,
          roles: [...round.roles],
          sentHome: round.sentHome,
        });
        this.broadcastLobby();
      }
    }
    this.syncStructure();
    if (this.sim.furnitureVersion !== this.sentFurniture) {
      this.sentFurniture = this.sim.furnitureVersion;
      this.broadcast({ t: 'furniture', furniture: this.furniture() });
    }
    if (events.length) this.sendEvents(events);
    const report = this.round?.inspector.report ?? null;
    if (report && report !== this.sentReport) {
      this.sentReport = report;
      this.broadcast({ t: 'report', report });
    }
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
      this.broadcast({ t: 'page', p: pageState(page) });
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
      .trim()
      .slice(0, 200);
    if (!text) return;
    const home = this.round?.sentHome.includes(from.id) ?? false;
    const near = this.phase === 'building' && !this.round?.meeting && !home;
    const scope = home ? 'home' : near ? 'near' : 'all';
    const origin = this.sim.players.get(from.id)?.body.translation();
    for (const c of this.clients.values()) {
      if (!c.connected) continue;
      const theirHome = this.round?.sentHome.includes(c.id) ?? false;
      if (home && !theirHome) continue;
      if (near && c.id !== from.id) {
        const at = this.sim.players.get(c.id)?.body.translation();
        // Players sent home overhear everything; on site, only within shouting distance.
        if (!theirHome && (!at || !origin || length(sub(at, origin)) > CHAT_RANGE)) continue;
      }
      this.send(c.id, { t: 'chat', from: from.id, text, scope });
    }
  }

  private furniture(): FurnitureState {
    const hideouts = [...this.sim.hideouts.values()];
    const open = hideouts.filter((h) => h.open).map((h) => h.def.id);
    const locked = hideouts.filter((h) => h.locked).map((h) => h.def.id);
    const { on, fixer } = this.sim.power;
    return { open, locked, power: { on, fixer } };
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
      if (other && length(sub(other, at)) <= SHOW_RANGE) {
        this.send(c.id, { t: 'shown', from: id, printed: page.printed });
      }
    }
  }

  private roleMsg(id: number): ServerMsg {
    const r = this.round!;
    const saboteurs = [...r.roles.values()].filter((x) => x === 'saboteur').length;
    return { t: 'role', role: r.role(id), partners: r.partners(id), saboteurs };
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
        p.climbing ? 1 : 0,
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
    const b = sim.broom;
    const broom: BroomT = [b.heldBy ?? 0, b.pos.x, b.pos.y, b.pos.z, b.yaw, b.leaning ? 1 : 0];
    const round = this.roundSummary();
    for (const c of this.clients.values()) {
      if (!c.connected) continue;
      const vy = sim.players.get(c.id)?.vy ?? 0;
      this.send(c.id, {
        t: 'snap',
        tick: this.tick,
        ack: c.lastSeq,
        vy,
        players,
        bodies,
        pages,
        gear,
        dog,
        broom,
        round,
      });
    }
  }

  private roundSummary(): RoundSummary | null {
    const r = this.round;
    if (!r) return null;
    const ins = r.inspector;
    return {
      timeLeft: r.timeLeft,
      doneArmed: r.doneArmed,
      meetingLeft: r.meeting && !r.meeting.outcome ? r.meeting.ticksLeft / TICK_RATE : 0,
      inspector: { status: ins.status, progress: ins.progress, scannedVersion: ins.scannedVersion },
    };
  }

  private worldMsg(): WorldMsg {
    return {
      t: 'world',
      tick: this.tick,
      phase: this.phase,
      buildId: this.sim.buildId,
      layout: this.layout,
      targetId: this.target.id,
      assemblies: [...this.sim.assemblies.values()].map(assemblyState),
      pages: [...this.sim.pages.values()].map(pageState),
      round: this.roundSummary(),
      report: this.round?.inspector.report ?? null,
      furniture: this.furniture(),
      target: this.round?.target ?? null,
      night: this.night,
      mode: this.mode,
      gear: [...this.sim.gear.values()].map(gearState),
    };
  }

  // ---------------------------------------------------------------- sending

  private lobbyPlayers(): LobbyPlayer[] {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      colour: c.colour,
      hat: c.hat,
      face: c.face,
      shirt: c.shirt,
      ready: c.ready,
      connected: c.connected,
      home: this.round?.sentHome.includes(c.id) ?? false,
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

function cleanName(name: unknown): string {
  return String(name ?? '')
    .replace(/[<>]/g, '')
    .replace(/\p{Cc}/gu, '')
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
