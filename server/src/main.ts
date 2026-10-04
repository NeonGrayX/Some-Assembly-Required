import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 7777);
const STATIC_DIR = resolve(
  process.env.STATIC_DIR ?? join(fileURLToPath(import.meta.url), '../../../client/dist'),
);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(STATIC_DIR, rel);
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  // Unknown paths fall back to index.html so room links like /ABCD work later.
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res
      .writeHead(404, { 'content-type': 'text/plain' })
      .end('Client not built. Run `npm run build` first, or use `npm run dev`.');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

await RAPIER.init();
const rooms = new RoomManager();
rooms.start();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws) => rooms.attach(ws));

server.listen(PORT, () => {
  console.log(`Some Assembly Required server on port ${PORT}`);
  console.log(`  local:   http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  network: http://${a.address}:${PORT}`);
    }
  }
});
