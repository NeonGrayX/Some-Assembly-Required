import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomListing } from '@sar/shared';
import { RateLimiter, clientAddress } from './limits.ts';
import type { ClientIpHeader } from './limits.ts';

/**
 * Room list requests one address may make: the room list asks every few seconds while it is
 * open, so this leaves room for a few players behind one address, but not for a flood.
 */
const REQUESTS = { perSecond: 1, burst: 10 };
/** The list is worked out at most this often, however many ask for it. */
const FRESH_MS = 1000;
/** How long an address stays remembered for rate limiting once it stops asking. */
const QUIET_MS = 60_000;

/**
 * Answers `GET /rooms.json` with the open rooms (see `RoomManager.listing`), rate-limited per
 * address. Returns false for any other request.
 */
export function roomListHandler(
  listing: () => RoomListing[],
  clientIpHeader: ClientIpHeader | null = null,
  now: () => number = () => performance.now(),
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const limits = new RateLimiter({ list: REQUESTS }, QUIET_MS, now);
  let cached: { body: string; at: number } | null = null;
  return (req, res) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/rooms.json') return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return true;
    }
    const t = now();
    if (!limits.take(clientAddress(req, clientIpHeader), 'list')) {
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
