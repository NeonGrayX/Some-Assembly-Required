import type RAPIER from '@dimforge/rapier3d-compat';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import {
  DT,
  PROTOCOL_VERSION,
  RANDOM_BUILD,
  HOUSE,
  Sim,
  levelFor,
  add,
  bricksOf,
  fromQ,
  fromV,
  length,
  mulQuat,
  rotate,
  sub,
  isLooseBrick,
  yawQuat,
  lerpAngle,
  DOG_MODES,
  IDENTITY,
  rivalLevel,
  GEAR_IDS,
  gearFromBits,
} from '@sar/shared';
import type {
  Action,
  BodyT,
  EndReason,
  GameMode,
  GearId,
  InspectorState,
  Look,
  LevelDef,
  LobbyPlayer,
  TimeOfDay,
  MeetingView,
  PrintedPage,
  Role,
  SabotageTool,
  Winner,
  MatchResult,
  Player,
  PlayerInput,
  Quat,
  RoomPhase,
  Rotation,
  ServerMsg,
  IceServer,
  SignalData,
  SimEvent,
  TargetBuild,
  Vec3,
  MapId,
} from '@sar/shared';
import type { Connection } from './connection.ts';

/** How far behind the newest snapshot other things are drawn, so there is always a pair to blend. */
const INTERP_DELAY_MS = 100;
/** A correction bigger than this is a teleport, not a prediction error. */
const TELEPORT_DISTANCE = 1.5;
/** Prediction errors smaller than this are ignored. */
const CORRECTION_EPSILON = 0.01;

interface Sample {
  t: number;
  pos: Vec3;
  rot: Quat;
  yaw?: number;
  pitch?: number;
}

/** A short history of poses for one remote thing, sampled at server time. */
class Track {
  private samples: Sample[] = [];

  push(s: Sample): void {
    const last = this.samples.at(-1);
    if (last && s.t < last.t) return;
    this.samples.push(s);
    if (this.samples.length > 12) this.samples.shift();
  }

  at(t: number): Sample | undefined {
    const s = this.samples;
    if (!s.length) return undefined;
    if (t <= s[0]!.t) return s[0];
    for (let i = 1; i < s.length; i++) {
      const b = s[i]!;
      if (t > b.t) continue;
      const a = s[i - 1]!;
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return {
        t,
        pos: {
          x: a.pos.x + (b.pos.x - a.pos.x) * k,
          y: a.pos.y + (b.pos.y - a.pos.y) * k,
          z: a.pos.z + (b.pos.z - a.pos.z) * k,
        },
        rot: nlerp(a.rot, b.rot, k),
        yaw: a.yaw !== undefined && b.yaw !== undefined ? lerpAngle(a.yaw, b.yaw, k) : b.yaw,
        pitch:
          a.pitch !== undefined && b.pitch !== undefined
            ? a.pitch + (b.pitch - a.pitch) * k
            : b.pitch,
      };
    }
    return s.at(-1);
  }
}

function nlerp(a: Quat, b: Quat, k: number): Quat {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const q = {
    x: a.x + (b.x * sign - a.x) * k,
    y: a.y + (b.y * sign - a.y) * k,
    z: a.z + (b.z * sign - a.z) * k,
    w: a.w + (b.w * sign - a.w) * k,
  };
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** The round as the client sees it, shaped like the shared Round for the UI. */
export interface RoundView {
  phase: 'building' | 'results';
  timeLeft: number;
  /** Per job site. */
  doneArmed: boolean[];
  inspectors: InspectorState[];
  /** Rival teams: seconds into the round each team handed in, or null. */
  handedIn: (number | null)[];
  result: MatchResult | null;
  endReason: EndReason | null;
}

/** How a race ended: each team's result and when it handed in. */
export interface TeamEnding {
  name: string;
  result: MatchResult;
  handedIn: number | null;
}

/**
 * The client's side of a room: a replica of the server's world, the local player predicted
 * ahead of the server, and everyone and everything else blended between snapshots.
 */
export class ClientGame {
  sim: Sim;
  myId = -1;
  me: Player | null = null;
  roomCode = '';
  token = '';
  phase: RoomPhase = 'lobby';
  lobby: {
    host: number;
    seconds: number;
    saboteurs: number;
    build: string;
    time: TimeOfDay;
    mode: GameMode;
    map: MapId;
    players: LobbyPlayer[];
  } = {
    host: 0,
    seconds: 600,
    saboteurs: -1,
    build: RANDOM_BUILD,
    time: 'day',
    mode: 'saboteur',
    map: 'house',
    players: [],
  };
  /** Whether this round is played at night. */
  night = false;
  /** How this round is played (the lobby's setting outside a round). */
  mode: GameMode = 'saboteur';
  /** Your secret role this round (null outside a round). */
  role: Role | null = null;
  /** Who reads the pages this round (blind build mode), or null. */
  reader: number | null = null;
  /** Rival teams: your team (job site), or null in other modes. */
  team: number | null = null;
  /** Whether the world is the doubled rival-teams level. */
  rival = false;

  /** The job site you build on: your team's, or the only one. */
  get mySite(): number {
    return this.team ?? 0;
  }

  /** Your job site's inspector, if a round is on. */
  get myInspector(): InspectorState | null {
    return this.round?.inspectors[this.mySite] ?? null;
  }
  /** Fellow saboteurs, if you are one. */
  partners: number[] = [];
  /** How many saboteurs are in this round (players are told the number, not who). */
  saboteurCount = 0;
  /** When the role was revealed, for the reveal overlay. */
  roleShownAt = 0;
  meeting: MeetingView | null = null;
  /** Seconds left in the running meeting, from snapshots. */
  meetingLeft = 0;
  /** Who you voted for in the current meeting (0 = skip). */
  myVote: number | null = null;
  chat: { from: number; text: string; scope: 'near' | 'all' | 'home'; at: number }[] = [];
  /** When each saboteur tool can be used again (performance.now() time). */
  toolReadyAt = new Map<SabotageTool, number>();
  /** Uses left of limited saboteur tools, once one has been used. */
  toolCharges = new Map<SabotageTool, number>();
  /** The last page someone held up for you to read. */
  shown: { from: number; printed: PrintedPage; at: number } | null = null;
  /** Revealed at the end of a round. */
  ending: {
    winner: Winner;
    roles: Map<number, Role>;
    sentHome: number[];
    teams: TeamEnding[] | null;
  } | null = null;
  round: RoundView | null = null;
  /** Sound and effect events since the UI last took them. */
  events: SimEvent[] = [];
  /** This round's model in this round's colours (null outside a round). */
  target: TargetBuild | null = null;
  /** Which build this round is (or the last round was), in its design colours. */
  targetId = '';
  /** Bumped whenever the whole world was replaced, so renderers drop what they cached. */
  worldVersion = 0;
  error: string | null = null;
  /** STUN and TURN servers for voice chat, from the server's welcome. */
  ice: IceServer[] = [];
  /** Voice chat handshakes from other players, until voice chat takes them. */
  onSignal: (from: number, data: SignalData) => void = (from, data) => {
    this.signals.push({ from, data });
  };
  readonly signals: { from: number; data: SignalData }[] = [];
  /** Smoothed round trip to the server, in ms. */
  ping = 0;
  /** Each measured round trip (ms) and when it came back, newest last. Trimmed by the reader. */
  readonly pings: { at: number; ms: number }[] = [];
  /** Size of the last prediction correction, in metres (for debugging feel). */
  lastCorrection = 0;

  private tracks = new Map<string, Track>();
  private clockOffset: number | null = null;
  private lastServerMs = 0;
  private seq = 0;
  private history = new Map<number, Vec3>();
  private pingsOut = new Map<number, number>();
  private pingN = 0;
  private lastPingAt = -Infinity;
  private placedMe = false;
  /** Drawn offset of the local player that fades out after a correction. */
  private smoothing: Vec3 = { x: 0, y: 0, z: 0 };
  private prevPoses = new WeakMap<RigidBody, { pos: Vec3; rot: Quat }>();

  constructor(
    private readonly R: typeof RAPIER,
    private readonly conn: Connection,
  ) {
    this.sim = this.newSim();
    conn.onMessage = (msg) => this.handle(msg);
  }

  hello(name: string, look: Look, room?: string, token?: string): void {
    this.conn.send({ t: 'hello', v: PROTOCOL_VERSION, name, room, token, ...look });
  }

  get isHost(): boolean {
    return this.lobby.host === this.myId;
  }

  send(msg: Parameters<Connection['send']>[0]): void {
    this.conn.send(msg);
  }

  private newSim(level: LevelDef = HOUSE, bell = true): Sim {
    return new Sim(this.R, level, 1, { replica: true, bell });
  }

  // ---------------------------------------------------------------- messages

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.you;
        this.roomCode = msg.room;
        this.token = msg.token;
        this.ice = msg.ice ?? [];
        return;
      case 'signal':
        this.onSignal(msg.from, msg.data);
        return;
      case 'error':
        this.error = msg.message;
        return;
      case 'lobby':
        this.phase = msg.phase;
        this.sim.catapultArmed = this.phase !== 'building';
        this.lobby = {
          host: msg.host,
          seconds: msg.seconds,
          saboteurs: msg.saboteurs,
          build: msg.build,
          time: msg.time,
          mode: msg.mode,
          map: msg.map,
          players: msg.players,
        };
        return;
      case 'role':
        this.role = msg.role;
        this.reader = msg.reader;
        this.team = msg.team;
        this.partners = msg.partners;
        this.saboteurCount = msg.saboteurs;
        this.roleShownAt = performance.now();
        return;
      case 'meeting':
        if (msg.meeting && !this.meeting) this.myVote = null;
        this.meeting = msg.meeting;
        return;
      case 'pong': {
        const sent = this.pingsOut.get(msg.n);
        if (sent === undefined) return;
        this.pingsOut.delete(msg.n);
        const now = performance.now();
        const ms = now - sent;
        this.ping = this.pings.length ? this.ping + (ms - this.ping) * 0.2 : ms;
        this.pings.push({ at: now, ms });
        return;
      }
      case 'chat':
        this.chat.push({ ...msg, at: performance.now() });
        if (this.chat.length > 50) this.chat.shift();
        return;
      case 'furniture':
        this.sim.replicaFurniture(
          msg.furniture.open,
          msg.furniture.power,
          msg.furniture.locked ?? [],
        );
        return;
      case 'shown':
        this.shown = { from: msg.from, printed: msg.printed, at: performance.now() };
        return;
      case 'sabotaged':
        this.toolReadyAt.set(msg.tool, performance.now() + msg.cooldown * 1000);
        if (msg.charges !== null) this.toolCharges.set(msg.tool, msg.charges);
        return;
      case 'world':
        return this.loadWorld(msg);
      case 'asm': {
        const s = msg.a;
        const a = this.sim.replicaAssembly(
          s.id,
          bricksOf(s),
          s.anchored,
          s.heldBy,
          s.version,
          fromV(s.pos),
          fromQ(s.rot),
        );
        const track = new Track();
        track.push({ t: this.lastServerMs, pos: fromV(s.pos), rot: fromQ(s.rot) });
        this.tracks.set(`a${a.id}`, track);
        return;
      }
      case 'held': {
        const a = this.sim.assemblies.get(msg.id);
        if (!a) return;
        const wasAnchored = a.anchored;
        this.sim.replicaHeld(a, msg.heldBy, msg.anchored);
        if (wasAnchored !== msg.anchored) {
          // Put back on (or lifted off) the job site: jump to exactly where the server has it.
          // A fixed body ignores interpolated poses, so it would otherwise stay wherever it was
          // drawn at that moment, possibly still in mid-air.
          const pos = fromV(msg.pos);
          const rot = fromQ(msg.rot);
          a.body.setTranslation(pos, true);
          a.body.setRotation(rot, true);
          const track = new Track();
          track.push({ t: this.lastServerMs, pos, rot });
          this.tracks.set(`a${a.id}`, track);
        }
        return;
      }
      case 'asmDel':
        this.sim.replicaRemoveAssembly(msg.id);
        this.tracks.delete(`a${msg.id}`);
        return;
      case 'page': {
        const p = msg.p;
        this.sim.replicaPage(p.id, p.printed, p.carriedBy, fromV(p.pos), fromQ(p.rot), {
          hideout: p.hidden ? -1 : null,
          pinned: p.pinned,
        });
        const track = new Track();
        track.push({ t: this.lastServerMs, pos: fromV(p.pos), rot: fromQ(p.rot) });
        this.tracks.set(`p${p.id}`, track);
        return;
      }
      case 'gear': {
        const g = msg.g;
        this.sim.replicaGear(
          g.id,
          g.kind,
          g.wornBy,
          { hidden: g.hidden, placed: g.placed },
          fromV(g.pos),
          fromQ(g.rot),
        );
        const track = new Track();
        track.push({ t: this.lastServerMs, pos: fromV(g.pos), rot: fromQ(g.rot) });
        this.tracks.set(`g${g.id}`, track);
        return;
      }
      case 'snap':
        return this.applySnapshot(msg);
      case 'fx':
        this.events.push(...msg.events);
        return;
      case 'report':
        if (this.round?.inspectors[msg.site]) this.round.inspectors[msg.site]!.report = msg.report;
        return;
      case 'result':
        this.ending = {
          winner: msg.winner,
          roles: new Map(msg.roles),
          sentHome: msg.sentHome,
          teams: msg.teams,
        };
        if (this.round) {
          this.round.phase = 'results';
          this.round.result = msg.result;
          this.round.endReason = msg.reason;
        }
        return;
    }
  }

  private loadWorld(msg: Extract<ServerMsg, { t: 'world' }>): void {
    // The server only says which map, how it is furnished and whether it is doubled for two
    // teams; it is built the same way here. The job site has its bell in every mode but a
    // gear hunt (same as the server's world).
    const base = levelFor(msg.map, msg.layout);
    this.rival = msg.rival;
    this.sim = this.newSim(msg.rival ? rivalLevel(base) : base, msg.mode !== 'gear');
    this.sim.catapultArmed = msg.phase !== 'building';
    this.tracks.clear();
    this.history.clear();
    this.me = null;
    this.placedMe = false;
    this.phase = msg.phase;
    this.lastServerMs = msg.tick * DT * 1000;
    for (const s of msg.assemblies) {
      this.sim.replicaAssembly(
        s.id,
        bricksOf(s),
        s.anchored,
        s.heldBy,
        s.version,
        fromV(s.pos),
        fromQ(s.rot),
      );
    }
    for (const p of msg.pages)
      this.sim.replicaPage(p.id, p.printed, p.carriedBy, fromV(p.pos), fromQ(p.rot), {
        hideout: p.hidden ? -1 : null,
        pinned: p.pinned,
      });
    for (const g of msg.gear ?? [])
      this.sim.replicaGear(
        g.id,
        g.kind,
        g.wornBy,
        { hidden: g.hidden, placed: g.placed },
        fromV(g.pos),
        fromQ(g.rot),
      );
    this.sim.buildIds = msg.buildIds;
    this.sim.replicaFurniture(msg.furniture.open, msg.furniture.power, msg.furniture.locked ?? []);
    this.target = msg.target;
    this.targetId = msg.targetId;
    this.night = msg.night;
    this.mode = msg.mode ?? 'saboteur';
    // A gear hunt's troubles, so our own movement is predicted the way the server moves us.
    if (this.mode === 'gear') for (const id of GEAR_IDS) this.sim.hazards.add(id);
    this.meeting = null;
    this.toolReadyAt.clear();
    this.toolCharges.clear();
    if (msg.phase !== 'building') {
      this.role = null;
      this.reader = null;
      this.team = null;
      this.partners = [];
    }
    if (msg.phase === 'building') this.ending = null;
    this.round = msg.round
      ? {
          phase: 'building',
          timeLeft: msg.round.timeLeft,
          doneArmed: msg.round.doneArmed,
          inspectors: msg.round.inspectors.map((ins, i) => ({
            ...ins,
            report: msg.reports[i] ?? null,
          })),
          handedIn: msg.round.handedIn,
          result: null,
          endReason: null,
        }
      : null;
    if (this.myId >= 0) this.me = this.sim.addPlayer({ id: this.myId });
    this.worldVersion++;
  }

  private applySnapshot(msg: Extract<ServerMsg, { t: 'snap' }>): void {
    const serverMs = msg.tick * DT * 1000;
    this.lastServerMs = serverMs;
    const offset = performance.now() - serverMs;
    // Track the fastest arrival, drifting up slowly in case the clocks wander.
    this.clockOffset =
      this.clockOffset === null || offset < this.clockOffset
        ? offset
        : this.clockOffset + (offset - this.clockOffset) * 0.01;

    const seen = new Set<number>();
    for (const [
      id,
      x,
      y,
      z,
      yaw,
      pitch,
      held,
      rot,
      page,
      down,
      limp,
      knocks,
      treat,
      careful,
      yawOffset,
      gear,
      climbing,
      airborne,
    ] of msg.players) {
      seen.add(id);
      const pos = { x, y, z };
      let p = this.sim.players.get(id);
      if (!p)
        p = this.sim.addPlayer({ id, replicated: id !== this.myId, spawn: { x, y: y - 0.85, z } });
      p.page = page || null;
      p.knocks = knocks;
      p.treat = treat === 1;
      if (gear !== undefined) p.gear = gearFromBits(gear);
      // (We predict our own climbing, with the rest of our movement.)
      if (id !== this.myId) {
        p.input.careful = careful === 1;
        p.climbing = climbing === 1;
        p.grounded = airborne !== 1;
      }
      const holding = held
        ? {
            assemblyId: held,
            rot: rot as Rotation,
            yawOffset,
            last: null,
            settingDown: null,
          }
        : null;
      if (id === this.myId) {
        this.me = p;
        p.holding =
          holding && p.holding?.assemblyId === held
            ? { ...p.holding, rot: rot as Rotation, yawOffset }
            : holding;
        // The server's timers as of the input it acknowledged, run on through the inputs
        // predicted since.
        const ahead = this.seq - msg.ack;
        p.down = Math.max(0, down - ahead);
        p.limp = Math.max(0, limp - ahead);
        this.reconcile(pos, msg.ack, msg.vy);
        // Where the server had us, to carry what we hold the way the server carries it.
        let mine = this.tracks.get('me');
        if (!mine) this.tracks.set('me', (mine = new Track()));
        mine.push({ t: serverMs, pos, rot: IDENTITY, yaw });
        continue;
      }
      p.holding = holding;
      p.down = down;
      p.limp = limp;
      let track = this.tracks.get(`pl${id}`);
      if (!track) this.tracks.set(`pl${id}`, (track = new Track()));
      track.push({ t: serverMs, pos, rot: { x: 0, y: 0, z: 0, w: 1 }, yaw, pitch });
    }
    for (const id of [...this.sim.players.keys()]) {
      if (!seen.has(id)) {
        this.sim.removePlayer(id);
        this.tracks.delete(`pl${id}`);
        if (id === this.myId) this.me = null;
      }
    }
    const push = (prefix: string, list: BodyT[]) => {
      for (const [id, x, y, z, qx, qy, qz, qw] of list) {
        let track = this.tracks.get(prefix + id);
        if (!track) this.tracks.set(prefix + id, (track = new Track()));
        track.push({ t: serverMs, pos: { x, y, z }, rot: { x: qx, y: qy, z: qz, w: qw } });
      }
    };
    push('a', msg.bodies);
    push('p', msg.pages);
    push('g', msg.gear ?? []);
    const [dx, dy, dz, dyaw, mode, dogPage, patBy] = msg.dog;
    let dogTrack = this.tracks.get('dog');
    if (!dogTrack) this.tracks.set('dog', (dogTrack = new Track()));
    dogTrack.push({ t: serverMs, pos: { x: dx, y: dy, z: dz }, rot: IDENTITY, yaw: dyaw });
    this.sim.dog.mode = DOG_MODES[mode] ?? 'walk';
    this.sim.dog.page = dogPage || null;
    this.sim.dog.patBy = patBy || null;
    const [broomBy, bx, by, bz, byaw, leaning] = msg.broom;
    this.sim.replicaBroom(broomBy || null, { x: bx, y: by, z: bz }, byaw, leaning === 1);

    if (msg.round && this.round) {
      this.round.timeLeft = msg.round.timeLeft;
      this.round.doneArmed = msg.round.doneArmed;
      this.round.handedIn = msg.round.handedIn;
      this.meetingLeft = msg.round.meetingLeft;
      msg.round.inspectors.forEach((ins, i) => {
        const mine = this.round!.inspectors[i];
        if (mine) Object.assign(mine, ins);
      });
    }
  }

  /**
   * Compares where the server put us (after input `ack`) with where we predicted we would be
   * at that input, and shifts the prediction by the difference.
   */
  private reconcile(server: Vec3, ack: number, vy: number): void {
    const me = this.me!;
    const predicted = this.history.get(ack);
    for (const k of this.history.keys()) if (k <= ack) this.history.delete(k);
    if (!this.placedMe || !predicted) {
      me.body.setTranslation(server, true);
      me.collider.setTranslation(server);
      me.vy = vy;
      this.placedMe = true;
      return;
    }
    const d = sub(server, predicted);
    const err = length(d);
    this.lastCorrection = err;
    if (err < CORRECTION_EPSILON) return;
    if (err > TELEPORT_DISTANCE) {
      // Moved by the server (to the meeting table): jump there, no gliding across the map.
      me.body.setTranslation(add(me.body.translation(), d), true);
      me.collider.setTranslation(add(me.collider.translation(), d));
      for (const [k, v] of this.history) this.history.set(k, add(v, d));
      this.smoothing = { x: 0, y: 0, z: 0 };
      me.vy = vy;
      return;
    }
    me.body.setTranslation(add(me.body.translation(), d), true);
    // Move the collision shape too: the character controller works from the shape, and it
    // would otherwise sit at the old spot until the next physics step.
    me.collider.setTranslation(add(me.collider.translation(), d));
    // Jump the physics, but let what is drawn catch up over a few frames.
    this.smoothing = sub(this.smoothing, d);
    for (const [k, v] of this.history) this.history.set(k, add(v, d));
    if (err > 0.3) me.vy = vy;
  }

  // ---------------------------------------------------------------- per tick

  /** One 60 Hz client step: send input and actions, pose remote things, predict ourselves. */
  /** Measures the round trip four times a second. */
  private sendPing(): void {
    // Only once the server has let us in: before that it expects nothing but a hello.
    if (this.myId < 0) return;
    const now = performance.now();
    if (now - this.lastPingAt < 250) return;
    this.lastPingAt = now;
    // Forget pings that never came back (the connection dropped meanwhile).
    for (const [n, at] of this.pingsOut) if (now - at > 10_000) this.pingsOut.delete(n);
    this.pingsOut.set(++this.pingN, now);
    this.conn.send({ t: 'ping', n: this.pingN });
  }

  tick(input: PlayerInput, actions: Action[]): void {
    this.sendPing();
    const me = this.me;
    if (me && this.placedMe) {
      this.seq++;
      // Everyone stands still during a Brick Meeting; the server ignores movement anyway.
      if (this.meeting) input = { ...input, forward: 0, right: 0, jump: false };
      Object.assign(me.input, input);
      this.conn.send({
        t: 'input',
        seq: this.seq,
        f: input.forward,
        r: input.right,
        jump: input.jump,
        sprint: input.sprint,
        careful: input.careful,
        yaw: input.yaw,
        pitch: input.pitch,
        fp: input.firstPerson,
      });
      for (const a of actions) {
        this.conn.send({
          t: 'act',
          a,
          seq: this.seq,
          yaw: input.yaw,
          pitch: input.pitch,
          fp: input.firstPerson,
        });
      }
    }

    const renderMs = performance.now() - (this.clockOffset ?? 0) - INTERP_DELAY_MS;
    for (const a of this.sim.assemblies.values()) {
      // What we hold is posed after the step, once we have moved.
      if (me && a.heldBy === me.id && me.holding) continue;
      const s = this.tracks.get(`a${a.id}`)?.at(renderMs);
      if (s) this.sim.setPose(a.body, s.pos, s.rot);
    }
    const dog = this.tracks.get('dog')?.at(renderMs);
    if (dog) {
      this.sim.dog.body.setNextKinematicTranslation(dog.pos);
      this.sim.dog.yaw = dog.yaw ?? this.sim.dog.yaw;
    }
    for (const page of this.sim.pages.values()) {
      if (page.pinned !== null) continue;
      const s = page.body && this.tracks.get(`p${page.id}`)?.at(renderMs);
      if (s) this.sim.setPose(page.body!, s.pos, s.rot);
    }
    for (const item of this.sim.gear.values()) {
      const s = item.body && this.tracks.get(`g${item.id}`)?.at(renderMs);
      if (s) this.sim.setPose(item.body!, s.pos, s.rot);
    }
    for (const p of this.sim.players.values()) {
      if (!p.replicated) continue;
      const s = this.tracks.get(`pl${p.id}`)?.at(renderMs);
      if (!s) continue;
      p.body.setNextKinematicTranslation(s.pos);
      p.input.yaw = s.yaw ?? p.input.yaw;
      p.input.pitch = s.pitch ?? p.input.pitch;
    }

    this.rememberPoses();
    this.sim.step();
    if (me && this.placedMe) this.history.set(this.seq, me.body.translation());
    this.poseHeld(renderMs);
  }

  /**
   * Puts what we hold in our hands where we stand now. Waiting for the server would leave it
   * behind by the interpolation delay and the round trip, and running would push it into our
   * belly. A single brick sits right on its hold point; a build keeps the place (and wobble)
   * the server gives it relative to us, carried along to where we are.
   */
  private poseHeld(renderMs: number): void {
    const me = this.me;
    const a = me?.holding && this.sim.assemblies.get(me.holding.assemblyId);
    if (!me?.holding || !a || a.heldBy !== me.id) return;
    let pose: { pos: Vec3; rot: Quat };
    if (isLooseBrick(a)) pose = this.sim.heldBrickPose(me, me.holding, a);
    else {
      const s = this.tracks.get(`a${a.id}`)?.at(renderMs);
      const them = this.tracks.get('me')?.at(renderMs);
      if (!s || !them) return;
      const back = yawQuat(-(them.yaw ?? 0));
      const turn = yawQuat(me.input.yaw);
      pose = {
        pos: add(me.body.translation(), rotate(turn, rotate(back, sub(s.pos, them.pos)))),
        rot: mulQuat(turn, mulQuat(back, s.rot)),
      };
    }
    a.body.setTranslation(pose.pos, false);
    a.body.setRotation(pose.rot, false);
  }

  /** Keeps every body's pose from before this step, for blending frames between steps. */
  private rememberPoses(): void {
    const keep = (b: RigidBody | null) => {
      if (b) this.prevPoses.set(b, { pos: b.translation(), rot: b.rotation() });
    };
    for (const a of this.sim.assemblies.values()) keep(a.body);
    for (const p of this.sim.pages.values()) keep(p.body);
    for (const g of this.sim.gear.values()) keep(g.body);
    for (const p of this.sim.players.values()) keep(p.body);
    keep(this.sim.dog.body);
  }

  /** Fades the correction offset; call once per frame. */
  settle(dt: number): void {
    const k = Math.exp(-dt * 12);
    this.smoothing = { x: this.smoothing.x * k, y: this.smoothing.y * k, z: this.smoothing.z * k };
  }

  /** A body's pose `alpha` (0..1) of the way from the previous step to the latest one. */
  pose(body: RigidBody, alpha: number): { pos: Vec3; rot: Quat } {
    // What we hold is posed from where we stand, so it is drawn shifted along with us.
    const held = this.me?.holding && this.sim.assemblies.get(this.me.holding.assemblyId)?.body;
    if (this.me && (body === this.me.body || body === held)) {
      const p = this.blend(body, alpha);
      return { pos: add(p.pos, this.smoothing), rot: p.rot };
    }
    return this.blend(body, alpha);
  }

  private blend(body: RigidBody, alpha: number): { pos: Vec3; rot: Quat } {
    const pos = body.translation();
    const rot = body.rotation();
    const prev = this.prevPoses.get(body);
    if (!prev) return { pos, rot };
    return {
      pos: {
        x: prev.pos.x + (pos.x - prev.pos.x) * alpha,
        y: prev.pos.y + (pos.y - prev.pos.y) * alpha,
        z: prev.pos.z + (pos.z - prev.pos.z) * alpha,
      },
      rot: nlerp(prev.rot, rot, alpha),
    };
  }

  vote(target: number): void {
    this.myVote = target;
    this.conn.send({ t: 'vote', target });
  }

  /** The gear you wear (Gear Hunt). */
  get worn(): Set<GearId> {
    return this.me?.gear ?? new Set();
  }

  /** Whether you see the world without colours: a gear hunt without the colour goggles on. */
  get colourBlind(): boolean {
    return this.mode === 'gear' && this.phase === 'building' && !this.worn.has('goggles');
  }

  say(text: string): void {
    this.conn.send({ t: 'chat', text });
  }

  /** Name of a player in this room. */
  nameOf(id: number): string {
    return this.lobby.players.find((p) => p.id === id)?.name ?? 'Someone';
  }

  /** Whether you were voted off the job site this round. */
  get sentHome(): boolean {
    return this.lobby.players.find((p) => p.id === this.myId)?.home ?? false;
  }

  takeEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  close(): void {
    this.conn.close();
  }
}
