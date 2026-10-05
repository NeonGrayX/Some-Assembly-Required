import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { generate } from 'selfsigned';

export interface Tls {
  key: string;
  cert: string;
}

/** Renewed this long before it runs out, so a long session never hits the end. */
const RENEW_MS = 30 * 24 * 3600 * 1000;
const VALID_DAYS = 825;

/**
 * A self-signed certificate for `localhost` and the given addresses, kept in `dir` and reused
 * so players only click through the browser's warning once. A new one is made when the
 * machine has an address the old one does not cover, or when it is close to running out.
 */
export async function loadOrCreateCert(
  dir: string,
  addresses: string[],
): Promise<Tls & { created: boolean }> {
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  if (existsSync(keyPath) && existsSync(certPath)) {
    const key = readFileSync(keyPath, 'utf8');
    const cert = readFileSync(certPath, 'utf8');
    if (covers(cert, addresses)) return { key, cert, created: false };
  }
  const now = new Date();
  const pems = await generate([{ name: 'commonName', value: 'Some Assembly Required host' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - 60_000),
    notAfterDate: new Date(now.getTime() + VALID_DAYS * 24 * 3600 * 1000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...addresses.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(keyPath, pems.private, { mode: 0o600 });
  writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert, created: true };
}

/** Whether `pem` is still valid for a while and names every one of `addresses`. */
function covers(pem: string, addresses: string[]): boolean {
  try {
    const cert = new X509Certificate(pem);
    if (new Date(cert.validTo).getTime() - Date.now() < RENEW_MS) return false;
    const names = (cert.subjectAltName ?? '').split(', ');
    return addresses.every((ip) => names.includes(`IP Address:${ip}`));
  } catch {
    return false;
  }
}
