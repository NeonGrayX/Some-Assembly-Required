import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomListing } from '@sar/shared';
import { Bucket, clientAddress } from './rooms.ts';

/**
 * Room list requests one address may make: the room list asks every few seconds while it is
 * open, so this leaves room for a few players behind one address, but not for a flood.
 */
const REQUESTS = { perSecond: 1, burst: 10 };
/** The list is worked out at most this often, however many ask for it. */
const FRESH_MS = 1000;
/** Addresses remembered for rate limiting before the quiet ones are forgotten. */
const MAX_ADDRESSES = 10_000;
const QUIET_MS = 60_000;

/**
 * Answers `GET /rooms.json` with the open rooms (see `RoomManager.listing`), rate-limited per
 * address. Returns false for any other request.
 */
export function roomListHandler(
  listing: () => RoomListing[],
  now: () => number = () => performance.now(),
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const callers = new Map<string, { bucket: Bucket; seen: number }>();
  let cached: { body: string; at: number } | null = null;
  return (req, res) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/rooms.json') return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return true;
    }
    const t = now();
    const address = clientAddress(req);
    let caller = callers.get(address);
    if (!caller) {
      if (callers.size >= MAX_ADDRESSES) {
        for (const [a, c] of callers) if (t - c.seen > QUIET_MS) callers.delete(a);
        // Still full: everyone starts afresh rather than the map growing without end.
        if (callers.size >= MAX_ADDRESSES) callers.clear();
      }
      caller = { bucket: new Bucket(REQUESTS), seen: t };
      callers.set(address, caller);
    }
    caller.seen = t;
    if (!caller.bucket.take()) {
      res.writeHead(429, { 'retry-after': '5', 'cache-control': 'no-store' }).end();
      return true;
    }
    if (!cached || t - cached.at > FRESH_MS) {
      cached = { body: JSON.stringify({ rooms: listing() }), at: t };
    }
    res
      .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(req.method === 'HEAD' ? undefined : cached.body);
    return true;
  };
}
