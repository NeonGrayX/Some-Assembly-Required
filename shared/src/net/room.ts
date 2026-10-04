import type RAPIER from '@dimforge/rapier3d-compat';
import { LIGHTHOUSE } from '../builds/lighthouse.ts';
import type { InspectionReport } from '../builds/report.ts';
import type { TargetBuild } from '../builds/types.ts';
import { SANDBOX } from '../content/sandbox.ts';
import type { LevelDef } from '../content/sandbox.ts';
import { v3 } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import { DEFAULT_ROUND_SECONDS, Round } from '../round.ts';
import { Sim, TICK_RATE } from '../sim/sim.ts';
import type { Action, Player } from '../sim/sim.ts';
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  ROUND_LENGTHS,
  SNAPSHOT_EVERY,
  assemblyState,
  pageState,
} from './protocol.ts';
import type {
  BodyT,
  ClientMsg,
  InputMsg,
  LobbyPlayer,
  PlayerT,
  RoomPhase,
  RoundSummary,
  ServerMsg,
  WorldMsg,
} from './protocol.ts';

type Rapier = typeof RAPIER;

/** How long a dropped player keeps their spot (and their character) for a reconnect. */
export const RECONNECT_GRACE_TICKS = 30 * TICK_RATE;
/** Inputs buffered beyond this are dropped so a lagging client catches up. */
const MAX_INPUT_BACKLOG = 4;

export const PLAYER_COLOURS = [
  0xf07d1a, 0x1e5bc6, 0x2c9a3a, 0xc91a1a, 0x8e44ad, 0x16a3a3, 0xf5c518, 0xe84393, 0x6d4c41,
  0x7f8c8d,
];

interface Client {
  id: number;
  name: string;
  colour: number;
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
  level?: LevelDef;
  target?: TargetBuild;
  /** Makes reconnect tokens; defaults to Math.random. */
  token?: () => string;
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
  readonly level: LevelDef;
  readonly target: TargetBuild;
  phase: RoomPhase = 'lobby';
  hostId = 0;
  seconds = DEFAULT_ROUND_SECONDS;
  sim!: Sim;
  round: Round | null = null;
  readonly clients = new Map<number, Client>();
  tick = 0;

  private nextClientId = 1;
  private seed: number;
  private readonly send: RoomOptions['send'];
  private readonly makeToken: () => string;
  private sentAssemblies = new Map<
    number,
    { version: number; anchored: boolean; heldBy: number | null }
  >();
  private sentPages = new Map<number, number | null>();
  private sentPoses = new Map<string, SentPose>();
  private sentReport: InspectionReport | null = null;

  constructor(
    private readonly R: Rapier,
    opts: RoomOptions,
  ) {
    this.code = opts.code;
    this.send = opts.send;
    this.seed = opts.seed ?? 1;
    this.level = opts.level ?? SANDBOX;
    this.target = opts.target ?? LIGHTHOUSE;
    this.makeToken =
      opts.token ?? (() => Math.random().toString(36).slice(2) + Date.now().toString(36));
    this.newWorld();
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

  /** Adds (or, with a valid token, reconnects) a player. Returns their id, or an error. */
  join(name: string, token?: string): { id: number } | { error: string } {
    const back = token ? [...this.clients.values()].find((c) => c.token === token) : undefined;
    if (back) {
      back.connected = true;
      if (name.trim()) back.name = cleanName(name);
      this.welcome(back);
      return { id: back.id };
    }
    if (this.clients.size >= MAX_PLAYERS) return { error: 'This room is full.' };
    const used = new Set([...this.clients.values()].map((c) => c.colour));
    const c: Client = {
      id: this.nextClientId++,
      name: cleanName(name) || `Builder ${this.nextClientId - 1}`,
      colour: PLAYER_COLOURS.find((x) => !used.has(x)) ?? PLAYER_COLOURS[0]!,
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
    this.send(c.id, { t: 'welcome', you: c.id, room: this.code, token: c.token });
    this.broadcastLobby();
    this.send(c.id, this.worldMsg());
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
    if (p) Object.assign(p.input, { forward: 0, right: 0, jump: false, sprint: false });
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
        if (c.inputs.length > 60) c.inputs.splice(0, c.inputs.length - 60);
        return;
      case 'act':
        if (c.actions.length < 10) c.actions.push(msg);
        return;
      case 'ready':
        c.ready = !!msg.ready;
        this.broadcastLobby();
        return;
      case 'settings':
        if (
          clientId === this.hostId &&
          this.phase === 'lobby' &&
          ROUND_LENGTHS.includes(msg.seconds)
        ) {
          this.seconds = msg.seconds;
          this.broadcastLobby();
        }
        return;
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

  private newWorld(): void {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    this.sim = new Sim(this.R, this.level, this.seed);
    this.round = null;
    this.sentAssemblies.clear();
    this.sentPages.clear();
    this.sentPoses.clear();
    this.sentReport = null;
    [...this.clients.keys()].forEach((id, i) => this.spawn(id, i));
  }

  startRound(): void {
    this.newWorld();
    this.round = new Round(this.sim, this.target, { seconds: this.seconds, seed: this.seed });
    this.phase = 'building';
    for (const c of this.clients.values()) c.ready = false;
    this.broadcastLobby();
    this.broadcast(this.worldMsg());
  }

  private backToLobby(): void {
    this.newWorld();
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
    for (const c of this.clients.values()) {
      const p = this.sim.players.get(c.id);
      if (!p) continue;
      if (c.inputs.length > MAX_INPUT_BACKLOG) c.inputs.splice(0, c.inputs.length - 2);
      const input = c.inputs.shift();
      if (input) {
        Object.assign(p.input, {
          forward: clamp(input.f, -1, 1),
          right: clamp(input.r, -1, 1),
          jump: !!input.jump,
          sprint: !!input.sprint,
          yaw: num(input.yaw),
          pitch: clamp(num(input.pitch), -1.5, 1.5),
          firstPerson: !!input.fp,
        });
        c.lastSeq = input.seq;
      }
      // An action waits until the movement input it was made after has been applied.
      const due = c.actions.filter((a) => !(num(a.seq) > c.lastSeq) || c.inputs.length === 0);
      c.actions = c.actions.filter((a) => !due.includes(a));
      if (this.phase === 'results') continue;
      for (const act of due) {
        p.input.yaw = num(act.yaw);
        p.input.pitch = clamp(num(act.pitch), -1.5, 1.5);
        p.input.firstPerson = !!act.fp;
        this.sim.act(c.id, act.a);
      }
    }

    this.sim.step();
    this.round?.update();
    const events = this.sim.events;
    this.sim.events = [];

    if (this.round?.phase === 'results' && this.phase === 'building') {
      this.phase = 'results';
      this.broadcast({ t: 'result', result: this.round.result!, reason: this.round.endReason! });
      this.broadcastLobby();
    }
    this.syncStructure();
    if (events.length) this.broadcast({ t: 'fx', events });
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
        this.broadcast({ t: 'held', id: a.id, heldBy: a.heldBy, anchored: a.anchored });
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
      if (this.sentPages.has(page.id) && this.sentPages.get(page.id) === page.carriedBy) continue;
      this.sentPages.set(page.id, page.carriedBy);
      this.broadcast({ t: 'page', p: pageState(page) });
    }
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
      inspector: { status: ins.status, progress: ins.progress, scannedVersion: ins.scannedVersion },
    };
  }

  private worldMsg(): WorldMsg {
    return {
      t: 'world',
      tick: this.tick,
      phase: this.phase,
      buildId: this.sim.buildId,
      targetId: this.target.id,
      assemblies: [...this.sim.assemblies.values()].map(assemblyState),
      pages: [...this.sim.pages.values()].map(pageState),
      round: this.roundSummary(),
      report: this.round?.inspector.report ?? null,
    };
  }

  // ---------------------------------------------------------------- sending

  private lobbyPlayers(): LobbyPlayer[] {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      colour: c.colour,
      ready: c.ready,
      connected: c.connected,
    }));
  }

  private broadcastLobby(): void {
    this.broadcast({
      t: 'lobby',
      phase: this.phase,
      host: this.hostId,
      seconds: this.seconds,
      players: this.lobbyPlayers(),
    });
  }

  private broadcast(msg: ServerMsg): void {
    for (const c of this.clients.values()) if (c.connected) this.send(c.id, msg);
  }
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

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

function clamp(x: unknown, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, num(x)));
}
