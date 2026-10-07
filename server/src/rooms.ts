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

interface Entry {
  room: Room;
  sockets: Map<number, WebSocket>;
  /** The socket of the player currently joining, who has no id yet. */
  joining: WebSocket | null;
  emptySince: number | null;
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
  attach(ws: WebSocket): void {
    let joined: { entry: Entry; id: number } | null = null;
    ws.binaryType = 'nodebuffer';
    ws.on('message', (data: Buffer) => {
      let msg: ClientMsg;
      try {
        msg = decode<ClientMsg>(new Uint8Array(data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      try {
        if (!joined) {
          if (!isHello(msg)) {
            sendTo(ws, { t: 'error', message: 'Please reload: the game was updated.' });
            ws.close();
            return;
          }
          joined = this.join(ws, msg);
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
    entry ??= this.create();
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
    // The room greets the new player during join(), before we know their id.
    entry.joining = ws;
    const result = entry.room.join(String(hello.name ?? ''), token, hello);
    entry.joining = null;
    if ('error' in result) {
      sendTo(ws, { t: 'error', message: result.error });
      ws.close();
      return null;
    }
    entry.sockets.set(result.id, ws);
    entry.emptySince = null;
    this.log(
      `room ${entry.room.code}: player ${result.id} joined (${entry.room.connectedCount} connected)`,
    );
    return { entry, id: result.id };
  }

  private create(): Entry {
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
      joining: null,
      emptySince: null,
      room: new Room(RAPIER, {
        code,
        seed: Math.floor(Math.random() * 2 ** 31),
        ice: this.ice,
        send: (id, msg) => {
          const ws = sockets.get(id) ?? entry.joining;
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
      entry.room.update();
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
