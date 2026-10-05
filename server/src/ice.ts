import { createHmac } from 'node:crypto';
import type { IceServer } from '@sar/shared';

/** A public STUN server, so players on different networks can find a direct route. */
export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
/** How long TURN credentials handed to a player stay valid. */
const TURN_TTL_S = 24 * 60 * 60;

/**
 * The STUN and TURN servers voice chat uses, from the environment:
 *
 * - `SAR_STUN`: comma-separated STUN URLs, or `none` (default: a public Google STUN server).
 * - `SAR_TURN_URL`: comma-separated TURN URLs for a relay such as coturn, for players whose
 *   networks block direct connections; `SAR_TURN_SECRET` is coturn's `static-auth-secret`.
 *
 * TURN credentials are coturn's time-limited kind (its "REST API"): every player gets their
 * own, valid for a day, and the secret itself never leaves the server.
 */
export function iceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now,
): () => IceServer[] {
  const list = (v: string | undefined) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const stun =
    env.SAR_STUN?.trim().toLowerCase() === 'none' ? [] : list(env.SAR_STUN ?? DEFAULT_STUN);
  const turn = list(env.SAR_TURN_URL);
  const secret = env.SAR_TURN_SECRET ?? '';
  return () => {
    const servers: IceServer[] = [];
    if (stun.length) servers.push({ urls: stun });
    if (turn.length && secret) servers.push({ urls: turn, ...turnCredentials(secret, now()) });
    return servers;
  };
}

/** coturn's time-limited credentials: the username is the expiry time, signed with the secret. */
export function turnCredentials(
  secret: string,
  nowMs: number,
): { username: string; credential: string } {
  const username = `${Math.floor(nowMs / 1000) + TURN_TTL_S}:sar`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}
