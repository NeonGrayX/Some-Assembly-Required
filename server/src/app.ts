import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect, createServer as createTcpServer } from 'node:net';
import type { Server as TcpServer, Socket } from 'node:net';
import RAPIER from '@dimforge/rapier3d-compat';
import { WebSocketServer } from 'ws';
import type { Tls } from './cert.ts';
import { relativePath } from './files.ts';
import type { FileSource } from './files.ts';
import { RoomManager } from './rooms.ts';

export interface ServerOptions {
  port: number;
  /** Where the client's files come from. */
  files: FileSource;
  /** Serve HTTPS with this certificate; plain HTTP when null. */
  tls: Tls | null;
  log?: (line: string) => void;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/** The game: client files and the WebSocket endpoint, on one port. */
export async function runServer(opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? ((line) => console.log(line));
  const serveFiles: RequestListener = (req, res) => sendFile(opts.files, req, res);

  await RAPIER.init();
  const rooms = new RoomManager(log);
  rooms.start();
  const web = opts.tls
    ? createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert }, serveFiles)
    : createHttpServer(serveFiles);
  const wss = new WebSocketServer({ server: web, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws) => rooms.attach(ws));

  // With HTTPS, someone typing the address without "https://" would get a broken page, so
  // the port also answers plain HTTP, with a redirect. The first byte tells them apart (a TLS
  // handshake always starts with 22), and the connection is relayed to the right server
  // listening privately on this machine. (Handing the socket straight to a server works in
  // Node but not in Bun, which runs the host executable.)
  let listener: TcpServer = web;
  const internal: TcpServer[] = [];
  const relayed = new Set<Socket>();
  if (opts.tls) {
    const redirect = createHttpServer((req, res) => {
      const host = req.headers.host ?? `localhost:${opts.port}`;
      res
        .writeHead(301, { location: `https://${host}${req.url ?? '/'}`, connection: 'close' })
        .end();
    });
    const webPort = await listen(web, 0, '127.0.0.1');
    const redirectPort = await listen(redirect, 0, '127.0.0.1');
    internal.push(web, redirect);
    listener = createTcpServer((socket) => {
      relayed.add(socket);
      socket.on('close', () => relayed.delete(socket));
      socket.on('error', () => socket.destroy());
      socket.once('data', (first) => {
        const target = connect(first[0] === 22 ? webPort : redirectPort, '127.0.0.1', () => {
          target.write(first);
          socket.pipe(target).pipe(socket);
        });
        target.on('error', () => socket.destroy());
        socket.on('close', () => target.destroy());
      });
    });
  }

  const port = await listen(listener, opts.port);
  return {
    port,
    close: async () => {
      rooms.stop();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
      // Idle keep-alive connections would otherwise hold the servers open for seconds.
      for (const socket of relayed) socket.destroy();
      web.closeAllConnections();
      for (const server of [listener, ...internal]) {
        await new Promise<void>((done) => server.close(() => done()));
      }
    },
  };
}

/**
 * Starts listening and resolves with the port. Without a host this means every address,
 * IPv6 included; where IPv6 is switched off Bun cannot do that, so it falls back to IPv4.
 */
async function listen(server: TcpServer, port: number, host?: string): Promise<number> {
  const attempt = (h?: string) =>
    new Promise<void>((done, fail) => {
      server.once('error', fail);
      const ready = () => {
        server.off('error', fail);
        done();
      };
      if (h) server.listen(port, h, ready);
      else server.listen(port, ready);
    });
  try {
    await attempt(host);
  } catch (err) {
    if (host || (err as NodeJS.ErrnoException).code === 'EADDRINUSE') throw err;
    await attempt('0.0.0.0');
  }
  const address = server.address();
  return typeof address === 'object' && address ? address.port : port;
}

function sendFile(files: FileSource, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = relativePath(url.pathname);
  if (rel === null) {
    res.writeHead(403).end();
    return;
  }
  // Anything that is not a file is a page of the game, such as a room link like /ABCD.
  const f = (rel && files(rel)) || files('index.html');
  if (!f) {
    res
      .writeHead(404, { 'content-type': 'text/plain' })
      .end('Client not built. Run `npm run build` first, or use `npm run dev`.');
    return;
  }
  res.writeHead(200, {
    'content-type': f.type,
    'content-length': f.data.length,
    'cache-control': f.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : f.data);
}
