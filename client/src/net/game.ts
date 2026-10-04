import type RAPIER from '@dimforge/rapier3d-compat';
import {
  DT,
  PROTOCOL_VERSION,
  SANDBOX,
  Sim,
  add,
  bricksOf,
  fromQ,
  fromV,
  length,
  sub,
} from '@sar/shared';
import type {
  Action,
  BodyT,
  EndReason,
  InspectorState,
  LobbyPlayer,
  MatchResult,
  Player,
  PlayerInput,
  Quat,
  RoomPhase,
  Rotation,
  ServerMsg,
  SimEvent,
  Vec3,
} from '@sar/shared';
import type { Connection } from './connection.ts';

/** How far behind the newest snapshot other things are drawn, so there is always a pair to blend. */
const INTERP_DELAY_MS = 100;
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

function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** The round as the client sees it, shaped like the shared Round for the UI. */
export interface RoundView {
  phase: 'building' | 'results';
  timeLeft: number;
  doneArmed: boolean;
  inspector: InspectorState;
  result: MatchResult | null;
  endReason: EndReason | null;
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
  lobby: { host: number; seconds: number; players: LobbyPlayer[] } = {
    host: 0,
    seconds: 600,
    players: [],
  };
  round: RoundView | null = null;
  /** Sound and effect events since the UI last took them. */
  events: SimEvent[] = [];
  /** Bumped whenever the whole world was replaced, so renderers drop what they cached. */
  worldVersion = 0;
  error: string | null = null;
  /** Round-trip-ish delay estimate for the status line, in ms. */
  ping = 0;
  /** Size of the last prediction correction, in metres (for debugging feel). */
  lastCorrection = 0;

  private tracks = new Map<string, Track>();
  private clockOffset: number | null = null;
  private lastServerMs = 0;
  private seq = 0;
  private history = new Map<number, Vec3>();
  private sentAt = new Map<number, number>();
  private placedMe = false;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly conn: Connection,
  ) {
    this.sim = this.newSim();
    conn.onMessage = (msg) => this.handle(msg);
  }

  hello(name: string, room?: string, token?: string): void {
    this.conn.send({ t: 'hello', v: PROTOCOL_VERSION, name, room, token });
  }

  get isHost(): boolean {
    return this.lobby.host === this.myId;
  }

  send(msg: Parameters<Connection['send']>[0]): void {
    this.conn.send(msg);
  }

  private newSim(): Sim {
    return new Sim(this.R, SANDBOX, 1, { replica: true });
  }

  // ---------------------------------------------------------------- messages

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.you;
        this.roomCode = msg.room;
        this.token = msg.token;
        return;
      case 'error':
        this.error = msg.message;
        return;
      case 'lobby':
        this.phase = msg.phase;
        this.lobby = { host: msg.host, seconds: msg.seconds, players: msg.players };
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
        if (a) this.sim.replicaHeld(a, msg.heldBy, msg.anchored);
        return;
      }
      case 'asmDel':
        this.sim.replicaRemoveAssembly(msg.id);
        this.tracks.delete(`a${msg.id}`);
        return;
      case 'page': {
        const p = msg.p;
        this.sim.replicaPage(p.id, p.step, p.carriedBy, fromV(p.pos), fromQ(p.rot));
        const track = new Track();
        track.push({ t: this.lastServerMs, pos: fromV(p.pos), rot: fromQ(p.rot) });
        this.tracks.set(`p${p.id}`, track);
        return;
      }
      case 'snap':
        return this.applySnapshot(msg);
      case 'fx':
        this.events.push(...msg.events);
        return;
      case 'report':
        if (this.round) this.round.inspector.report = msg.report;
        return;
      case 'result':
        if (this.round) {
          this.round.phase = 'results';
          this.round.result = msg.result;
          this.round.endReason = msg.reason;
        }
        return;
    }
  }

  private loadWorld(msg: Extract<ServerMsg, { t: 'world' }>): void {
    this.sim = this.newSim();
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
      this.sim.replicaPage(p.id, p.step, p.carriedBy, fromV(p.pos), fromQ(p.rot));
    this.sim.buildId = msg.buildId;
    this.round = msg.round
      ? {
          phase: 'building',
          timeLeft: msg.round.timeLeft,
          doneArmed: msg.round.doneArmed,
          inspector: { ...msg.round.inspector, report: msg.report },
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

    const sent = this.sentAt.get(msg.ack);
    if (sent !== undefined) this.ping += (performance.now() - sent - this.ping) * 0.1;
    for (const k of this.sentAt.keys()) if (k <= msg.ack) this.sentAt.delete(k);

    const seen = new Set<number>();
    for (const [id, x, y, z, yaw, pitch, held, rot, page] of msg.players) {
      seen.add(id);
      const pos = { x, y, z };
      let p = this.sim.players.get(id);
      if (!p)
        p = this.sim.addPlayer({ id, replicated: id !== this.myId, spawn: { x, y: y - 0.85, z } });
      p.page = page || null;
      const holding = held
        ? {
            assemblyId: held,
            rot: rot as Rotation,
            yawOffset: p.holding?.yawOffset ?? 0,
            reach: 0,
            settingDown: null,
          }
        : null;
      if (id === this.myId) {
        this.me = p;
        p.holding =
          holding && p.holding?.assemblyId === held
            ? { ...p.holding, rot: rot as Rotation }
            : holding;
        this.reconcile(pos, msg.ack, msg.vy);
        continue;
      }
      p.holding = holding;
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

    if (msg.round && this.round) {
      this.round.timeLeft = msg.round.timeLeft;
      this.round.doneArmed = msg.round.doneArmed;
      Object.assign(this.round.inspector, msg.round.inspector);
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
      me.vy = vy;
      this.placedMe = true;
      return;
    }
    const d = sub(server, predicted);
    const err = length(d);
    this.lastCorrection = err;
    if (err < CORRECTION_EPSILON) return;
    me.body.setTranslation(add(me.body.translation(), d), true);
    for (const [k, v] of this.history) this.history.set(k, add(v, d));
    if (err > 0.3) me.vy = vy;
  }

  // ---------------------------------------------------------------- per tick

  /** One 60 Hz client step: send input and actions, pose remote things, predict ourselves. */
  tick(input: PlayerInput, actions: Action[]): void {
    const me = this.me;
    if (me && this.placedMe) {
      this.seq++;
      Object.assign(me.input, input);
      this.conn.send({
        t: 'input',
        seq: this.seq,
        f: input.forward,
        r: input.right,
        jump: input.jump,
        sprint: input.sprint,
        yaw: input.yaw,
        pitch: input.pitch,
        fp: input.firstPerson,
      });
      this.sentAt.set(this.seq, performance.now());
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
      // Our own held brick follows our hands immediately instead of waiting for the server.
      if (me && a.heldBy === me.id && a.grid.size === 1 && me.holding) {
        const target = this.sim.holdTarget(me, me.holding, a);
        this.sim.setPose(a.body, target.pos, target.rot);
        continue;
      }
      const s = this.tracks.get(`a${a.id}`)?.at(renderMs);
      if (s) this.sim.setPose(a.body, s.pos, s.rot);
    }
    for (const page of this.sim.pages.values()) {
      const s = page.body && this.tracks.get(`p${page.id}`)?.at(renderMs);
      if (s) this.sim.setPose(page.body!, s.pos, s.rot);
    }
    for (const p of this.sim.players.values()) {
      if (!p.replicated) continue;
      const s = this.tracks.get(`pl${p.id}`)?.at(renderMs);
      if (!s) continue;
      p.body.setNextKinematicTranslation(s.pos);
      p.input.yaw = s.yaw ?? p.input.yaw;
      p.input.pitch = s.pitch ?? p.input.pitch;
    }

    this.sim.step();
    if (me && this.placedMe) this.history.set(this.seq, me.body.translation());
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
