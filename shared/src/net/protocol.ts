import { FLOAT32_OPTIONS, Packr } from 'msgpackr';
import type { BrickTypeId, ColourId, Rotation } from '../bricks.ts';
import type { MatchResult } from '../builds/match.ts';
import type { InspectionReport } from '../builds/report.ts';
import type { TargetBuild } from '../builds/types.ts';
import type { PlacedBrick } from '../grid.ts';
import type { Quat, Vec3 } from '../math.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { FaceId, HatId, ShirtId } from '../look.ts';
import type { GameMode, GearId } from '../gear.ts';
import type { EndReason, Role, SabotageTool, Winner } from '../round.ts';
import type { Action, Assembly, GearItem, PageItem, SimEvent } from '../sim/sim.ts';

/**
 * Everything that crosses the wire. The server owns the world; clients send inputs and
 * actions, and get back the world's structure (reliable messages) plus 20 Hz snapshots of
 * whatever moves.
 */

export const PROTOCOL_VERSION = 17;
/** Server ticks between snapshots (60 Hz simulation, 20 Hz snapshots). */
export const SNAPSHOT_EVERY = 3;
export const ROUND_LENGTHS = [5 * 60, 8 * 60, 10 * 60, 15 * 60];
export const MAX_PLAYERS = 10;
/** The lobby's build setting when the server picks a build at random each round. */
export const RANDOM_BUILD = 'random';

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

/** A piece of gear (Gear Hunt): lying about, worn, hidden, or the leash on the dog's pole. */
export interface GearState {
  id: number;
  kind: GearId;
  /** Who wears it (a player id), or null. */
  wornBy: number | null;
  /** Tucked away in some closed hiding place (which one is not told). */
  hidden: boolean;
  /** The leash, once it is on the pole with the dog at the end of it. */
  placed: boolean;
  pos: Vec3T;
  rot: QuatT;
}

/** Which hiding places stand open, which are padlocked, and whether the lights work. */
export interface FurnitureState {
  open: number[];
  /** Padlocked hiding places (Gear Hunt), until someone with the key ring opens them. */
  locked: number[];
  /** Off while the electrical panel is broken; `fixer` is whoever is fixing it. */
  power: { on: boolean; fixer: number | null };
}

export interface LobbyPlayer {
  id: number;
  name: string;
  colour: number;
  /** How they look: a hat, a face and a shirt (see `HATS`, `FACES`, `SHIRTS`). */
  hat: HatId;
  face: FaceId;
  shirt: ShirtId;
  ready: boolean;
  connected: boolean;
  /** Voted off the job site this round: watching, not playing. */
  home: boolean;
}

/** Saboteur count setting: -1 picks the usual number for the player count. */
export const SABOTEUR_SETTINGS = [-1, 0, 1, 2];

/** Time of day setting: 'random' picks day or night afresh for each round. */
export const TIMES_OF_DAY = ['day', 'night', 'random'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

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

export function gearState(g: GearItem): GearState {
  return {
    id: g.id,
    kind: g.kind,
    wornBy: g.wornBy,
    hidden: g.hideout !== null,
    placed: g.placed,
    pos: g.body ? toV(g.body.translation()) : [0, 0, 0],
    rot: g.body ? toQ(g.body.rotation()) : [0, 0, 0, 1],
  };
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
  /** Walking carefully (optional: older bots leave it out). */
  careful?: boolean;
  yaw: number;
  pitch: number;
  fp: boolean;
}

/** A STUN or TURN server, in the shape `RTCPeerConnection` takes. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Voice chat's WebRTC handshake, passed between two players' browsers through the server:
 * a session description (offer or answer), or one network route (ICE candidate).
 */
export type SignalData =
  | { sdp: { type: 'offer' | 'answer'; sdp: string } }
  | { ice: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } };

export type ClientMsg =
  | {
      t: 'hello';
      v: number;
      name: string;
      room?: string;
      token?: string;
      hat?: string;
      face?: string;
      shirt?: string;
    }
  | InputMsg
  /**
   * View angles ride along so the server aims exactly where the player clicked, and `seq` is
   * the input it came after, so the server acts from the position the player saw.
   */
  | { t: 'act'; a: Action; seq: number; yaw: number; pitch: number; fp: boolean }
  | { t: 'ready'; ready: boolean }
  /** Change hat, face or shirt (whichever are given); only in the lobby, before ready. */
  | { t: 'look'; hat?: string; face?: string; shirt?: string }
  /** `build`: a build id from `BUILDS`, or `RANDOM_BUILD`. */
  | {
      t: 'settings';
      seconds?: number;
      saboteurs?: number;
      time?: TimeOfDay;
      build?: string;
      mode?: GameMode;
    }
  | { t: 'vote'; target: number }
  /** Hold up the page in your pocket for everyone close by to read. */
  | { t: 'show' }
  | { t: 'chat'; text: string }
  /** Asks for a `pong` straight back, to measure the round trip. */
  | { t: 'ping'; n: number }
  /** Voice chat handshake for one other player; the server passes it on. */
  | { t: 'signal'; to: number; data: SignalData }
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
  /** 1 while holding a dog treat. */
  treat: number,
  /** 1 while walking carefully. */
  careful: number,
  /** Heading of a carried build against the player's, so snapping it can be previewed. */
  yawOffset: number,
  /** Gear worn, as bits (see `gearBits`). */
  gear: number,
  /** 1 while up a ladder. */
  climbing: number,
];

/**
 * The dog: where it is, which way it faces, what it does (index into DOG_MODES), its page, and
 * who is patting it (0: nobody).
 */
export type DogT = [
  x: number,
  y: number,
  z: number,
  yaw: number,
  mode: number,
  page: number,
  patBy: number,
];
/**
 * The broom: who carries it (0: nobody), and while nobody does, the spot its head rests on, its
 * heading, and 1 if it leans where it is kept (0: lying on the floor).
 */
export type BroomT = [
  heldBy: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  leaning: number,
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
  /** Gear lying about (Gear Hunt). */
  gear: BodyT[];
  dog: DogT;
  broom: BroomT;
  round: RoundSummary | null;
}

export interface WorldMsg {
  t: 'world';
  tick: number;
  phase: RoomPhase;
  buildId: number;
  /** The seed the house is furnished from (see `houseLayout`), or null for the plain house. */
  layout: number | null;
  targetId: string;
  assemblies: AssemblyState[];
  pages: PageState[];
  round: RoundSummary | null;
  report: InspectionReport | null;
  furniture: FurnitureState;
  /** This round's model, in this round's colours (null outside a round). */
  target: TargetBuild | null;
  /** Whether this round is played at night. */
  night: boolean;
  /** How the round is played (the lobby's setting outside a round). */
  mode: GameMode;
  /** The gear of a gear hunt (empty in other modes). */
  gear: GearState[];
}

export type ServerMsg =
  /** `ice`: the STUN and TURN servers voice chat should use to reach other players. */
  | { t: 'welcome'; you: number; room: string; token: string; ice: IceServer[] }
  | { t: 'error'; message: string }
  | {
      t: 'lobby';
      phase: RoomPhase;
      host: number;
      seconds: number;
      saboteurs: number;
      /** The build the host picked for the next round, or `RANDOM_BUILD`. */
      build: string;
      time: TimeOfDay;
      mode: GameMode;
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
  | { t: 'signal'; from: number; data: SignalData }
  /** A saboteur tool worked (only sent to the saboteur who used it). */
  | { t: 'sabotaged'; tool: SabotageTool; cooldown: number; charges: number | null }
  | WorldMsg
  | { t: 'asm'; a: AssemblyState }
  /** Someone took or let go of an assembly, or it was lifted off or put back on the job site. */
  | { t: 'held'; id: number; heldBy: number | null; anchored: boolean; pos: Vec3T; rot: QuatT }
  | { t: 'asmDel'; id: number }
  | { t: 'page'; p: PageState }
  | { t: 'gear'; g: GearState }
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
