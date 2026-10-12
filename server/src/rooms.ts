import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import RAPIER from '@dimforge/rapier3d-compat';
import { DT, Room, decode, encode, isHello } from '@sar/shared';
import type { ClientMsg, IceServer, ServerMsg } from '@sar/shared';
import { iceFromEnv } from './ice.ts';
import type { WebSocket } from 'ws';

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Rooms with nobody connected are closed after this long. */
const EMPTY_ROOM_MS = 2 * 60 * 1000;
/** A client this far behind on receiving gets no snapshots until it catches up. */
const MAX_BUFFERED = 256 * 1024;
/**
 * Rooms open at once, server-wide (`SAR_MAX_ROOMS` overrides it). Each holds a physics world,
 * so without a limit anyone could open rooms until the server runs out of memory.
 */
const MAX_ROOMS = Number(process.env.SAR_MAX_ROOMS) || 100;
/** Rooms one address may have open at once. */
const MAX_ROOMS_PER_ADDRESS = 5;
/**
 * Messages a connection may send: a steady rate with room for a burst (voice chat's handshakes
 * come in a rush). A client sends 60 inputs a second and little else, so only floods hit this.
 */
const MESSAGES = { perSecond: 300, burst: 600 };
/** Lobby messages (ready, look, team, settings, chat) are sent on to everyone, so fewer. */
const LOBBY_MESSAGES = { perSecond: 5, burst: 20 };
const LOBBY_KINDS = new Set(['ready', 'look', 'team', 'settings', 'chat']);

interface Entry {
  room: Room;
  sockets: Map<number, WebSocket>;
  emptySince: number | null;
  /** Where the player who opened it connected from (see `clientAddress`). */
  creator: string;
  /** When an error in this room's tick was last logged, so a stuck one does not flood the log. */
  loggedErrorAt: number;
}

/** All rooms on this server, their connections, and the fixed-rate loop that runs them. */
export class RoomManager {
  private readonly rooms = new Map<string, Entry>();
  private stats = { ticks: 0, ms: 0 };
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly log: (line: string) => void = console.log,
    private readonly ice: () => IceServer[] = iceFromEnv(),
  ) {}

  /** Handles one WebSocket from the first message to the last. */
  attach(ws: WebSocket, req?: IncomingMessage): void {
    let joined: { entry: Entry; id: number } | null = null;
    const address = req ? clientAddress(req) : '';
    const messages = new Bucket(MESSAGES);
    const lobbyMessages = new Bucket(LOBBY_MESSAGES);
    ws.binaryType = 'nodebuffer';
    // A frame that breaks the rules (too big, malformed) is an 'error' on the socket, which
    // would otherwise be thrown and stop the whole server. The socket closes after it.
    ws.on('error', () => ws.terminate());
    ws.on('message', (data: Buffer) => {
      if (!messages.take()) return;
      let msg: ClientMsg;
      try {
        msg = decode<ClientMsg>(new Uint8Array(data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      if (LOBBY_KINDS.has(msg.t) && !lobbyMessages.take()) return;
      try {
        if (!joined) {
          if (!isHello(msg)) {
            sendTo(ws, { t: 'error', message: 'Please reload: the game was updated.' });
            ws.close();
            return;
          }
          joined = this.join(ws, msg, address);
          return;
        }
        joined.entry.room.handle(joined.id, msg);
      } catch (err) {
        this.log(`error handling ${msg.t}: ${(err as Error).stack}`);
      }
    });
    ws.on('close', () => {
      if (!joined) return;
      const { entry, id } = joined;
      if (entry.sockets.get(id) === ws) {
        entry.sockets.delete(id);
        entry.room.disconnect(id);
      }
    });
  }

  private join(
    ws: WebSocket,
    hello: Extract<ClientMsg, { t: 'hello' }>,
    address: string,
  ): { entry: Entry; id: number } | null {
    const code = String(hello.room ?? '')
      .toUpperCase()
      .trim();
    let entry = code ? this.rooms.get(code) : undefined;
    if (code && !entry) {
      sendTo(ws, {
        t: 'error',
        message: `There is no room ${code}. Check the code, or create a new room.`,
      });
      ws.close();
      return null;
    }
    if (!entry) {
      const full =
        this.rooms.size >= MAX_ROOMS
          ? 'The server is full right now. Please try again in a few minutes.'
          : address &&
              [...this.rooms.values()].filter((e) => e.creator === address).length >=
                MAX_ROOMS_PER_ADDRESS
            ? 'You have too many rooms open. Close one, or wait a couple of minutes.'
            : null;
      if (full) {
        sendTo(ws, { t: 'error', message: full });
        ws.close();
        return null;
      }
      entry = this.create(address);
    }
    const token = typeof hello.token === 'string' ? hello.token : undefined;
    // A reconnect replaces the player's old connection, if it is somehow still open.
    const returning = token
      ? [...entry.room.clients.values()].find((c) => c.token === token)
      : undefined;
    if (returning) {
      const old = entry.sockets.get(returning.id);
      entry.sockets.delete(returning.id);
      if (old && old !== ws) old.close();
    }
    const result = entry.room.join(String(hello.name ?? ''), token, hello, (id) =>
      entry.sockets.set(id, ws),
    );
    if ('error' in result) {
      sendTo(ws, { t: 'error', message: result.error });
      ws.close();
      return null;
    }
    entry.emptySince = null;
    this.log(
      `room ${entry.room.code}: player ${result.id} joined (${entry.room.connectedCount} connected)`,
    );
    return { entry, id: result.id };
  }

  private create(creator: string): Entry {
    const randomCode = () =>
      Array.from(
        { length: 4 },
        () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)],
      ).join('');
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const sockets = new Map<number, WebSocket>();
    const entry: Entry = {
      sockets,
      emptySince: null,
      creator,
      loggedErrorAt: -Infinity,
      room: new Room(RAPIER, {
        code,
        seed: Math.floor(Math.random() * 2 ** 31),
        ice: this.ice,
        // A reconnect token is all it takes to play as someone, so it must not be guessable.
        token: () => randomBytes(18).toString('base64url'),
        send: (id, msg) => {
          const ws = sockets.get(id);
          if (!ws || ws.readyState !== ws.OPEN) return;
          if (msg.t === 'snap' && ws.bufferedAmount > MAX_BUFFERED) return;
          sendTo(ws, msg);
        },
      }),
    };
    this.rooms.set(code, entry);
    this.log(`room ${code} created`);
    return entry;
  }

  /** Runs every room at a fixed 60 Hz, catching up a few ticks after a hiccup. */
  start(): void {
    let last = performance.now();
    let acc = 0;
    this.timers.push(
      setInterval(() => {
        const now = performance.now();
        acc = Math.min(acc + (now - last) / 1000, DT * 5);
        last = now;
        while (acc >= DT) {
          acc -= DT;
          this.tick(now);
        }
      }, 1000 * DT),
      setInterval(() => this.report(), 60_000),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private tick(now: number): void {
    const t0 = performance.now();
    for (const [code, entry] of this.rooms) {
      if (entry.room.connectedCount === 0) {
        entry.emptySince ??= now;
        if (now - entry.emptySince > EMPTY_ROOM_MS) {
          this.rooms.delete(code);
          this.log(`room ${code} closed`);
          continue;
        }
      }
      // One room going wrong must not stop the others (an error thrown from this timer would
      // end the whole process).
      try {
        entry.room.update();
      } catch (err) {
        if (now - entry.loggedErrorAt > 10_000) {
          entry.loggedErrorAt = now;
          this.log(`room ${code}: error in tick: ${(err as Error).stack}`);
        }
      }
    }
    this.stats.ticks++;
    this.stats.ms += performance.now() - t0;
  }

  private report(): void {
    if (!this.rooms.size) return;
    let players = 0;
    for (const e of this.rooms.values()) players += e.room.connectedCount;
    const avg = this.stats.ms / Math.max(1, this.stats.ticks);
    this.log(`${this.rooms.size} rooms, ${players} players, ${avg.toFixed(2)} ms per tick`);
    this.stats = { ticks: 0, ms: 0 };
  }

  /** For tests and the bot script. */
  get roomCodes(): string[] {
    return [...this.rooms.keys()];
  }
}

function sendTo(ws: WebSocket, msg: ServerMsg): void {
  ws.send(encode(msg));
}

/** A token bucket: `take` says whether one more message fits in the allowed rate. */
class Bucket {
  private tokens: number;
  private last = performance.now();

  constructor(private readonly rate: { perSecond: number; burst: number }) {
    this.tokens = rate.burst;
  }

  take(): boolean {
    const now = performance.now();
    this.tokens = Math.min(
      this.rate.burst,
      this.tokens + ((now - this.last) / 1000) * this.rate.perSecond,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

const PROXY_ADDRESS = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|f[cd])/i;

/**
 * Who is connecting, as far as can be told: the socket's own address, or behind a reverse proxy
 * on this machine or a private network (deploy/), the address the proxy passes on.
 */
export function clientAddress(req: IncomingMessage): string {
  const direct = req.socket.remoteAddress ?? '';
  if (!PROXY_ADDRESS.test(direct)) return direct;
  const header = (name: string) => {
    const v = req.headers[name];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
  };
  // Cloudflare's own header first (the arrow-lab.de deployment), then the last hop a proxy
  // such as Caddy added.
  const forwarded = header('x-forwarded-for')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return header('cf-connecting-ip') || forwarded.at(-1) || direct;
}
