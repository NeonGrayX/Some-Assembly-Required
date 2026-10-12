import { mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, decode, encode } from '@sar/shared';
import type { ServerMsg } from '@sar/shared';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { runServer } from './app.ts';
import { loadOrCreateCert } from './cert.ts';
import { relativePath } from './files.ts';
import type { FileSource } from './files.ts';
import { parseArgs } from './host.ts';

const page: FileSource = (rel) =>
  rel === 'index.html'
    ? {
        data: Buffer.from('<title>Some Assembly Required</title>'),
        type: 'text/html',
        immutable: false,
      }
    : null;

describe('the host', () => {
  it('never serves files outside the site', () => {
    expect(relativePath('/assets/main.js')).toBe('assets/main.js');
    expect(relativePath('/')).toBe('');
    expect(relativePath('/../secret')).toBe('secret');
    expect(relativePath('/assets/%2e%2e/%2e%2e/secret')).toBe('secret');
    expect(relativePath('/a/..%5c..%5csecret')).toBeNull();
    expect(relativePath('/%E0%A4%A')).toBeNull();
  });

  it('reads its options over the defaults', () => {
    const defaults = { https: true, open: true };
    expect(parseArgs([], defaults)).toMatchObject({ https: true, open: true, port: 7777 });
    expect(parseArgs(['--http', '--no-open', '--port', '8080'], defaults)).toMatchObject({
      https: false,
      open: false,
      port: 8080,
    });
    expect(parseArgs(['--port=9000'], defaults)?.port).toBe(9000);
    expect(parseArgs(['--help'], defaults)).toBeNull();
    expect(() => parseArgs(['--port', 'abc'], defaults)).toThrow(/port/);
    expect(() => parseArgs(['--fast'], defaults)).toThrow(/Unknown option/);
  });

  it('keeps its certificate, and makes a new one when the computer gets a new address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sar-cert-'));
    const first = await loadOrCreateCert(dir, ['192.168.1.20']);
    expect(first.created).toBe(true);
    expect(readFileSync(join(dir, 'cert.pem'), 'utf8')).toBe(first.cert);
    const again = await loadOrCreateCert(dir, ['192.168.1.20']);
    expect(again.created).toBe(false);
    expect(again.cert).toBe(first.cert);
    // 192.168.1.2 is a prefix of the address in the certificate, not the same address.
    const moved = await loadOrCreateCert(dir, ['192.168.1.2']);
    expect(moved.created).toBe(true);
  });

  it('answers plain HTTP on the HTTPS port with a redirect to HTTPS', async () => {
    const tls = await loadOrCreateCert(mkdtempSync(join(tmpdir(), 'sar-cert-')), []);
    const server = await runServer({ port: 0, files: page, tls, log: () => {} });
    try {
      const location = await new Promise<string | undefined>((done, fail) => {
        request(`http://localhost:${server.port}/ABCD`, (res) => done(res.headers.location))
          .on('error', fail)
          .end();
      });
      expect(location).toBe(`https://localhost:${server.port}/ABCD`);
    } finally {
      await server.close();
    }
  });

  it('serves the game for any path that is not a file, so room links work', async () => {
    const server = await runServer({ port: 0, files: page, tls: null, log: () => {} });
    try {
      const res = await fetch(`http://localhost:${server.port}/WXYZ`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toContain('<title>Some Assembly Required</title>');
    } finally {
      await server.close();
    }
  });

  it('keeps running after a malformed address or an oversized message', async () => {
    const server = await runServer({ port: 0, files: page, tls: null, log: () => {} });
    try {
      const base = `http://localhost:${server.port}`;
      expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(403);
      const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
      ws.on('error', () => {});
      await new Promise((done) => ws.on('open', done));
      ws.send(Buffer.alloc(100 * 1024));
      await new Promise((done) => ws.on('close', done));
      expect((await fetch(`${base}/`)).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it('limits how many rooms one address can open', async () => {
    const server = await runServer({ port: 0, files: page, tls: null, log: () => {} });
    const sockets: WebSocket[] = [];
    const open = () =>
      new Promise<ServerMsg>((done, fail) => {
        const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
        sockets.push(ws);
        ws.on('error', fail);
        ws.on('open', () => ws.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name: 'x' })));
        ws.on('message', (data: Buffer) => done(decode<ServerMsg>(new Uint8Array(data))));
      });
    try {
      for (let i = 0; i < 5; i++) expect((await open()).t).toBe('welcome');
      expect(await open()).toMatchObject({
        t: 'error',
        message: expect.stringMatching(/too many rooms/),
      });
    } finally {
      for (const ws of sockets) ws.terminate();
      await server.close();
    }
  });

  it('lists public rooms only, with no more than the list needs, and limits requests', async () => {
    const server = await runServer({ port: 0, files: page, tls: null, log: () => {} });
    const sockets: WebSocket[] = [];
    const open = (name: string, hidden = false) =>
      new Promise<WebSocket>((done, fail) => {
        const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
        sockets.push(ws);
        ws.on('error', fail);
        ws.on('open', () =>
          ws.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name, private: hidden })),
        );
        ws.once('message', () => done(ws));
      });
    try {
      await open('Ada');
      await open('Secret', true);
      // A room made private in its lobby leaves the list too.
      const later = await open('Later');
      later.send(encode({ t: 'settings', private: true }));
      await new Promise((r) => setTimeout(r, 50));
      const base = `http://localhost:${server.port}`;
      const res = await fetch(`${base}/rooms.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const { rooms } = (await res.json()) as { rooms: Record<string, unknown>[] };
      expect(rooms).toHaveLength(1);
      expect(Object.keys(rooms[0]!).sort()).toEqual(
        ['code', 'host', 'map', 'max', 'mode', 'players', 'playing'].sort(),
      );
      expect(rooms[0]).toMatchObject({ host: 'Ada', players: 1, max: 10, playing: false });
      const statuses: number[] = [];
      for (let i = 0; i < 15; i++) statuses.push((await fetch(`${base}/rooms.json`)).status);
      expect(statuses).toContain(429);
      expect((await fetch(`${base}/rooms.json`, { method: 'POST' })).status).toBe(405);
    } finally {
      for (const ws of sockets) ws.terminate();
      await server.close();
    }
  });
});
