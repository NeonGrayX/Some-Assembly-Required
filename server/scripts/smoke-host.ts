/**
 * Starts a host, loads the page, joins a room over the WebSocket and checks the server
 * welcomes the player. Exits non-zero on failure. Given a URL instead, it checks a server
 * that is already running (a Docker container, say).
 *
 *   tsx server/scripts/smoke-host.ts <host executable | path/to/main.ts | URL> [--https]
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, decode, encode } from '@sar/shared';
import type { ServerMsg } from '@sar/shared';
import WebSocket from 'ws';

const [command, ...rest] = process.argv.slice(2);
if (!command) throw new Error('usage: smoke-host.ts <host executable | main.ts | URL> [--https]');
const given = /^https?:\/\//.test(command) ? new URL(command) : null;
const https = given ? given.protocol === 'https:' : rest.includes('--https');
const port = given
  ? Number(given.port || (https ? 443 : 80))
  : 7700 + Math.floor(Math.random() * 90);
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
  child = spawn(script ? process.execPath : command, args, {
    env: { ...process.env, SAR_DATA_DIR: mkdtempSync(join(tmpdir(), 'sar-smoke-')) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));
}

const fail = (why: string): never => {
  console.error(`smoke test failed: ${why}\n--- host output ---\n${output}`);
  child?.kill();
  process.exit(1);
};
setTimeout(() => fail('timed out'), 60_000).unref();

// The host's certificate is self-signed: this test trusts it on purpose.
if (https) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const host = given?.hostname ?? 'localhost';
const base = `${https ? 'https' : 'http'}://${host}:${port}`;
let page = '';
for (let i = 0; i < 200 && !page; i++) {
  await new Promise((r) => setTimeout(r, 200));
  page = await fetch(base)
    .then((r) => r.text())
    .catch(() => '');
}
if (!page.includes('<title>Some Assembly Required</title>')) fail('the page did not load');

const ws = new WebSocket(`${https ? 'wss' : 'ws'}://${host}:${port}/ws`, {
  rejectUnauthorized: false,
});
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
