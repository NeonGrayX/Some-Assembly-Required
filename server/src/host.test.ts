import { mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
