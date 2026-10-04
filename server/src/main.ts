import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

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

// M0: a minimal endpoint so the client can show it is connected. Rooms and the
// authoritative simulation arrive in M3.
const wss = new WebSocketServer({ server, path: '/ws' });
let nextClient = 1;
wss.on('connection', (ws) => {
  const id = nextClient++;
  ws.send(JSON.stringify({ type: 'welcome', id, players: wss.clients.size }));
  ws.on('message', (data) => ws.send(data.toString()));
});

server.listen(PORT, () => {
  console.log(`Some Assembly Required server on port ${PORT}`);
  console.log(`  local:   http://localhost:${PORT}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  network: http://${a.address}:${PORT}`);
    }
  }
});
