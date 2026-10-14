/**
 * Starts a host, loads the page, joins a room over the WebSocket and checks the server
 * welcomes the player. Exits non-zero on failure. Given a URL instead, it checks a server
 * that is already running (a Docker container, say).
 *
 *   tsx server/scripts/smoke-host.ts <host executable | path/to/main.ts | URL> [--https]
 *     [--ca cert.pem]
 *
 * Over HTTPS it trusts exactly the host's own self-signed certificate: the one the started
 * host makes, or the one `--ca` names for a server already running.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { get } from 'node:https';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, decode, encode } from '@sar/shared';
import type { ServerMsg } from '@sar/shared';
import WebSocket from 'ws';

const [command, ...rest] = process.argv.slice(2);
if (!command)
  throw new Error('usage: smoke-host.ts <host executable | main.ts | URL> [--https] [--ca file]');
const given = /^https?:\/\//.test(command) ? new URL(command) : null;
const https = given ? given.protocol === 'https:' : rest.includes('--https');
const caArg = rest.indexOf('--ca');
let caFile = caArg >= 0 ? rest[caArg + 1] : undefined;

/** A port nothing is listening on right now, from the system. */
const freePort = () =>
  new Promise<number>((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });

const port = given ? Number(given.port || (https ? 443 : 80)) : await freePort();
let output = '';
let child: ChildProcess | null = null;
if (!given) {
  const script = command.endsWith('.ts');
  const args = [
    ...(script ? ['--import', 'tsx', command] : []),
    '--port',
    String(port),
    '--no-open',
    https ? '--https' : '--http',
  ];
  const dataDir = mkdtempSync(join(tmpdir(), 'sar-smoke-'));
  // Where the host keeps the certificate it makes (server/src/cert.ts).
  caFile ??= join(dataDir, 'cert.pem');
  const started = spawn(script ? process.execPath : command, args, {
    env: { ...process.env, SAR_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.stdout.on('data', (d) => (output += d));
  started.stderr.on('data', (d) => (output += d));
  child = started;
}

const fail = (why: string): never => {
  console.error(`smoke test failed: ${why}\n--- host output ---\n${output}`);
  child?.kill();
  process.exit(1);
};
setTimeout(() => fail('timed out'), 60_000).unref();

const host = given?.hostname ?? 'localhost';
const base = `${https ? 'https' : 'http'}://${host}:${port}`;

/** The host's certificate, once it has made it; undefined trusts the usual authorities. */
const ca = () => (caFile && existsSync(caFile) ? readFileSync(caFile, 'utf8') : undefined);

/** The page at `url`, over HTTPS with only the host's certificate trusted. */
const fetchPage = (url: string): Promise<string> =>
  https
    ? new Promise((done, failed) => {
        get(url, { ca: ca() }, (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (d: string) => (text += d));
          res.on('end', () => done(text));
          res.on('error', failed);
        }).on('error', failed);
      })
    : fetch(url).then((r) => r.text());

// Wait for the server to answer: it is starting (a fresh process or container).
let page = '';
let lastError = '';
for (let i = 0; i < 200 && !page; i++) {
  await new Promise((r) => setTimeout(r, 200));
  page = await fetchPage(base).catch((err: Error) => ((lastError = err.message), ''));
}
if (!page) fail(`the server never answered (last error: ${lastError || 'none'})`);
if (!page.includes('<title>Some Assembly Required</title>')) fail('the page is not the game');

const ws = new WebSocket(`${https ? 'wss' : 'ws'}://${host}:${port}/ws`, { ca: ca() });
ws.binaryType = 'arraybuffer';
ws.on('open', () => ws.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name: 'Smoke' })));
ws.on('error', (e) => fail(`websocket: ${e.message}`));
ws.on('message', (data: ArrayBuffer) => {
  const msg = decode<ServerMsg>(new Uint8Array(data));
  if (msg.t === 'error') fail(`server said: ${msg.message}`);
  if (msg.t !== 'welcome') return;
  console.log(`smoke test passed: page loaded and joined room ${msg.room} at ${base}`);
  ws.close();
  child?.kill();
  process.exit(0);
});
