import type { IncomingMessage } from 'node:http';

/** A token bucket: `take` says whether one more message fits in the allowed rate. */
export class Bucket {
  private tokens: number;
  private last = performance.now();

  constructor(private readonly rate: { perSecond: number; burst: number }) {
    this.tokens = rate.burst;
  }

  take(): boolean {
    const now = performance.now();
    this.tokens = Math.min(
      this.rate.burst,
      this.tokens + ((now - this.last) / 1000) * this.rate.perSecond,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

/** Addresses remembered by a `RateLimiter` before the quiet ones are forgotten. */
const MAX_ADDRESSES = 10_000;

/**
 * Rate limits per address, one bucket per kind of request, forgetting addresses quiet for
 * `quietMs` rather than growing without end.
 */
export class RateLimiter<K extends string> {
  private readonly callers = new Map<string, { buckets: Map<K, Bucket>; seen: number }>();

  constructor(
    private readonly rates: Record<K, { perSecond: number; burst: number }>,
    private readonly quietMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  take(address: string, kind: K): boolean {
    const t = this.now();
    let caller = this.callers.get(address);
    if (!caller) {
      if (this.callers.size >= MAX_ADDRESSES) {
        for (const [a, c] of this.callers) if (t - c.seen > this.quietMs) this.callers.delete(a);
        // Still full: everyone starts afresh rather than the map growing without end.
        if (this.callers.size >= MAX_ADDRESSES) this.callers.clear();
      }
      caller = { buckets: new Map(), seen: t };
      this.callers.set(address, caller);
    }
    caller.seen = t;
    let bucket = caller.buckets.get(kind);
    if (!bucket) caller.buckets.set(kind, (bucket = new Bucket(this.rates[kind])));
    return bucket.take();
  }
}

/** The request headers a reverse proxy in front of the server may name the player's address in. */
export const CLIENT_IP_HEADERS = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'] as const;
export type ClientIpHeader = (typeof CLIENT_IP_HEADERS)[number];

/**
 * The header `SAR_CLIENT_IP_HEADER` says the reverse proxy in front of this server sets, or null
 * to trust none (no proxy: anyone could send any of them).
 */
export function clientIpHeaderFromEnv(env: NodeJS.ProcessEnv = process.env): ClientIpHeader | null {
  const v = env.SAR_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!v || v === 'none') return null;
  const found = CLIENT_IP_HEADERS.find((h) => h === v);
  if (!found) {
    throw new Error(
      `SAR_CLIENT_IP_HEADER must be none or one of ${CLIENT_IP_HEADERS.join(', ')}, not "${v}"`,
    );
  }
  return found;
}

const PROXY_ADDRESS = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:127\.|f[cd])/i;

/**
 * Who is connecting, as far as can be told: the socket's own address, or, when `trusted` names
 * the header the reverse proxy sets (deploy/) and the connection comes from that proxy on this
 * machine or a private network, the address the proxy passes on in it.
 */
export function clientAddress(req: IncomingMessage, trusted: ClientIpHeader | null): string {
  const direct = req.socket.remoteAddress ?? '';
  if (!trusted || !PROXY_ADDRESS.test(direct)) return direct;
  const raw = req.headers[trusted];
  const value = (Array.isArray(raw) ? raw.join(',') : raw) ?? '';
  // X-Forwarded-For lists every hop; the last is the one the trusted proxy added.
  const hops = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return hops.at(-1) || direct;
}
