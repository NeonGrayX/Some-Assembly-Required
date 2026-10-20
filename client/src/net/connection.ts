import type RAPIER from '@dimforge/rapier3d-compat';
import { DT, Room, decode, encode } from '@sar/shared';
import type { ClientMsg, ServerMsg } from '@sar/shared';

/** A link to whoever runs the room: a server over WebSocket, or a room inside this tab. */
export interface Connection {
  send(msg: ClientMsg): void;
  close(): void;
  onMessage: (msg: ServerMsg) => void;
  /** Called once when the link is gone for good. */
  onClose: (reason: string) => void;
}

/** Opens a WebSocket to the game server that served this page. */
export function wsConnection(): Promise<Connection> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  const conn: Connection = {
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg) as Uint8Array<ArrayBuffer>);
    },
    close: () => ws.close(),
    onMessage: () => {},
    onClose: () => {},
  };
  ws.onmessage = (e) => conn.onMessage(decode<ServerMsg>(new Uint8Array(e.data as ArrayBuffer)));
  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.onclose = () => conn.onClose('The connection to the server was lost.');
      resolve(conn);
    };
    ws.onerror = () => reject(new Error('Could not reach the game server.'));
  });
}

/**
 * Runs a room inside this tab for solo play, with no server at all. Messages still go through
 * the real codec so solo play exercises exactly what goes over the wire.
 */
let soloServerMs = 0;

/** Time the in-tab solo server spent since the last call (ms), for the frame-time panel. */
export function takeSoloServerMs(): number {
  const ms = soloServerMs;
  soloServerMs = 0;
  return ms;
}

/** A solo game's link, with the room itself for demo mode to drive directly. */
export type LocalConnection = Connection & { room: Room };

/**
 * `seed` lays out the maps; a benchmark passes a fixed one so every run plays in the same house.
 * Players other than this tab's (a benchmark's crowd) can join the room directly; nothing sent
 * to them goes anywhere.
 */
export function localConnection(R: typeof RAPIER, seed = Date.now() >>> 0): LocalConnection {
  let clientId = -1;
  const room = new Room(R, {
    code: 'SOLO',
    seed,
    // Nobody else is here to keep the saboteurs secret from.
    rolePicks: true,
    send: (id, msg) => {
      if (id !== clientId) return;
      const copy = decode<ServerMsg>(encode(msg));
      queueMicrotask(() => conn.onMessage(copy));
    },
  });
  let last = performance.now();
  let acc = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    const started = now;
    acc = Math.min(acc + (now - last) / 1000, DT * 5);
    last = now;
    while (acc >= DT) {
      acc -= DT;
      room.update();
    }
    soloServerMs += performance.now() - started;
  }, 1000 * DT);
  const conn: LocalConnection = {
    room,
    send: (msg) => {
      const copy = decode<ClientMsg>(encode(msg));
      if (copy.t === 'hello') {
        room.join(copy.name, undefined, (id) => (clientId = id));
        return;
      }
      room.handle(clientId, copy);
    },
    close: () => clearInterval(timer),
    onMessage: () => {},
    onClose: () => {},
  };
  return conn;
}

/** Delays everything in both directions, to try the game on a bad connection (?lag=150). */
export function withLag(inner: Connection, ms: number): Connection {
  const conn: Connection = {
    send: (msg) => setTimeout(() => inner.send(msg), ms / 2),
    close: () => inner.close(),
    onMessage: () => {},
    onClose: () => {},
  };
  inner.onMessage = (msg) => setTimeout(() => conn.onMessage(msg), ms / 2);
  inner.onClose = (reason) => conn.onClose(reason);
  return conn;
}
