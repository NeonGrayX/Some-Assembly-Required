import { FLOAT32_OPTIONS, Packr } from 'msgpackr';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import type { MatchResult } from '../builds/match.ts';
import type { InspectionReport } from '../builds/report.ts';
import type { TargetBuild } from '../builds/types.ts';
import type { PlacedBrick } from '../grid.ts';
import type { Quat, Vec3 } from '../math.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { EndReason, Role, SabotageTool, Winner } from '../round.ts';
import type { Action, Assembly, PageItem, SimEvent } from '../sim/sim.ts';

/**
 * Everything that crosses the wire. The server owns the world; clients send inputs and
 * actions, and get back the world's structure (reliable messages) plus 20 Hz snapshots of
 * whatever moves.
 */

export const PROTOCOL_VERSION = 2;
/** Server ticks between snapshots (60 Hz simulation, 20 Hz snapshots). */
export const SNAPSHOT_EVERY = 3;
export const ROUND_LENGTHS = [5 * 60, 8 * 60, 10 * 60, 15 * 60];
export const MAX_PLAYERS = 10;

export type RoomPhase = 'lobby' | 'building' | 'results';

// ------------------------------------------------------------------ world state

export type Vec3T = [number, number, number];
export type QuatT = [number, number, number, number];
export type BrickT = [
  id: number,
  type: BrickTypeId,
  colour: ColourId,
  x: number,
  y: number,
  z: number,
  rot: Rotation,
];

export interface AssemblyState {
  id: number;
  anchored: boolean;
  heldBy: number | null;
  version: number;
  bricks: BrickT[];
  pos: Vec3T;
  rot: QuatT;
}

export interface PageState {
  id: number;
  /** What is printed on it (step -1 is the master index). */
  printed: PrintedPage | null;
  carriedBy: number | null;
  /** Tucked away in some closed hiding place (which one is not told). */
  hidden: boolean;
  /** Corkboard slot, if pinned there. */
  pinned: number | null;
  pos: Vec3T;
  rot: QuatT;
}

/** Which hiding places stand open, and how many bricks the limited bins have left. */
export interface FurnitureState {
  open: number[];
  stock: [binId: number, stock: number | null][];
}

export interface LobbyPlayer {
  id: number;
  name: string;
  colour: number;
  ready: boolean;
  connected: boolean;
  /** Voted off the job site this round: watching, not playing. */
  home: boolean;
}

/** Saboteur count setting: -1 picks the usual number for the player count. */
export const SABOTEUR_SETTINGS = [-1, 0, 1, 2];

/** A Brick Meeting as everyone sees it. Who voted for whom stays secret. */
export interface MeetingView {
  calledBy: number;
  /** Players who may vote (and be voted for). */
  onSite: number[];
  /** Players who have voted so far. */
  voted: number[];
  outcome: { sentHome: number; tally: [id: number, votes: number][] } | null;
}

/** The parts of the round every client shows: clock, Done button, inspector. */
export interface RoundSummary {
  timeLeft: number;
  doneArmed: boolean;
  /** Seconds of discussion left in a running meeting, or 0. */
  meetingLeft: number;
  inspector: { status: 'idle' | 'scanning' | 'done'; progress: number; scannedVersion: number };
}

export const toV = (v: Vec3): Vec3T => [v.x, v.y, v.z];
export const toQ = (q: Quat): QuatT => [q.x, q.y, q.z, q.w];
export const fromV = (v: Vec3T): Vec3 => ({ x: v[0], y: v[1], z: v[2] });
export const fromQ = (q: QuatT): Quat => ({ x: q[0], y: q[1], z: q[2], w: q[3] });

export function assemblyState(a: Assembly): AssemblyState {
  return {
    id: a.id,
    anchored: a.anchored,
    heldBy: a.heldBy,
    version: a.version,
    bricks: [...a.grid.bricks.values()].map((b) => [b.id, b.type, b.colour, b.x, b.y, b.z, b.rot]),
    pos: toV(a.body.translation()),
    rot: toQ(a.body.rotation()),
  };
}

export function bricksOf(s: AssemblyState): PlacedBrick[] {
  return s.bricks.map(([id, type, colour, x, y, z, rot]) => ({ id, type, colour, x, y, z, rot }));
}

export function pageState(p: PageItem): PageState {
  return {
    id: p.id,
    printed: p.printed,
    carriedBy: p.carriedBy,
    hidden: p.hideout !== null,
    pinned: p.pinned,
    pos: p.body ? toV(p.body.translation()) : [0, 0, 0],
    rot: p.body ? toQ(p.body.rotation()) : [0, 0, 0, 1],
  };
}

// ------------------------------------------------------------------ client → server

export interface InputMsg {
  t: 'input';
  seq: number;
  f: number;
  r: number;
  jump: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
  fp: boolean;
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; room?: string; token?: string }
  | InputMsg
  /**
   * View angles ride along so the server aims exactly where the player clicked, and `seq` is
   * the input it came after, so the server acts from the position the player saw.
   */
  | { t: 'act'; a: Action; seq: number; yaw: number; pitch: number; fp: boolean }
  | { t: 'ready'; ready: boolean }
  | { t: 'settings'; seconds?: number; saboteurs?: number }
  | { t: 'vote'; target: number }
  /** Hold up the page in your pocket for everyone close by to read. */
  | { t: 'show' }
  | { t: 'chat'; text: string }
  /** Asks for a `pong` straight back, to measure the round trip. */
  | { t: 'ping'; n: number }
  | { t: 'start' }
  | { t: 'again' };

// ------------------------------------------------------------------ server → client

/** Per moving player: id, position, yaw, pitch, held assembly (or 0), held rotation, page (or 0). */
export type PlayerT = [
  id: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  held: number,
  rot: Rotation,
  page: number,
  /** Ticks left lying on the ground, and limping. */
  down: number,
  limp: number,
  /** Knock-downs so far: each new one starts a ragdoll. */
  knocks: number,
];
/** Per moving body: id, position, rotation. */
export type BodyT = [
  id: number,
  x: number,
  y: number,
  z: number,
  qx: number,
  qy: number,
  qz: number,
  qw: number,
];

export interface SnapshotMsg {
  t: 'snap';
  tick: number;
  /** Last input sequence number of yours the server applied. */
  ack: number;
  /** Your vertical speed, so prediction can resume from the server's state. */
  vy: number;
  players: PlayerT[];
  bodies: BodyT[];
  pages: BodyT[];
  round: RoundSummary | null;
}

export interface WorldMsg {
  t: 'world';
  tick: number;
  phase: RoomPhase;
  buildId: number;
  targetId: string;
  assemblies: AssemblyState[];
  pages: PageState[];
  round: RoundSummary | null;
  report: InspectionReport | null;
  furniture: FurnitureState;
  /** This round's model, in this round's colours (null outside a round). */
  target: TargetBuild | null;
}

export type ServerMsg =
  | { t: 'welcome'; you: number; room: string; token: string }
  | { t: 'error'; message: string }
  | {
      t: 'lobby';
      phase: RoomPhase;
      host: number;
      seconds: number;
      saboteurs: number;
      players: LobbyPlayer[];
    }
  /** Your secret role. Saboteurs also learn who the other saboteurs are. */
  | { t: 'role'; role: Role; partners: number[]; saboteurs: number }
  | { t: 'meeting'; meeting: MeetingView | null }
  | { t: 'furniture'; furniture: FurnitureState }
  /** Someone close by holds up a page for you to read. */
  | { t: 'shown'; from: number; printed: PrintedPage }
  | { t: 'chat'; from: number; text: string; scope: 'near' | 'all' | 'home' }
  | { t: 'pong'; n: number }
  /** A saboteur tool worked (only sent to the saboteur who used it). */
  | { t: 'sabotaged'; tool: SabotageTool; cooldown: number }
  | WorldMsg
  | { t: 'asm'; a: AssemblyState }
  /** Someone took or let go of an assembly, or it was lifted off or put back on the job site. */
  | { t: 'held'; id: number; heldBy: number | null; anchored: boolean; pos: Vec3T; rot: QuatT }
  | { t: 'asmDel'; id: number }
  | { t: 'page'; p: PageState }
  | SnapshotMsg
  | { t: 'fx'; events: SimEvent[] }
  | { t: 'report'; report: InspectionReport }
  | {
      t: 'result';
      result: MatchResult;
      reason: EndReason;
      winner: Winner;
      roles: [id: number, role: Role][];
      sentHome: number[];
    };

// ------------------------------------------------------------------ codec

const packr = new Packr({ useFloat32: FLOAT32_OPTIONS.DECIMAL_FIT, useRecords: false });

export function encode(msg: ClientMsg | ServerMsg): Uint8Array {
  return packr.pack(msg);
}

export function decode<T extends ClientMsg | ServerMsg>(data: Uint8Array): T {
  return packr.unpack(data) as T;
}
