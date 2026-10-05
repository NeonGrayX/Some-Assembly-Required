import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STUN, iceFromEnv } from './ice.ts';

describe('voice chat ICE servers', () => {
  it('uses a public STUN server unless told otherwise', () => {
    expect(iceFromEnv({})()).toEqual([{ urls: [DEFAULT_STUN] }]);
    expect(iceFromEnv({ SAR_STUN: 'none' })()).toEqual([]);
    expect(iceFromEnv({ SAR_STUN: 'stun:a:1, stun:b:2' })()).toEqual([
      { urls: ['stun:a:1', 'stun:b:2'] },
    ]);
  });

  it('hands out coturn time-limited TURN credentials, never the secret', () => {
    const now = 1_700_000_000_000;
    const servers = iceFromEnv(
      {
        SAR_STUN: 'none',
        SAR_TURN_URL: 'turn:turn.example.org:3478,turns:turn.example.org:5349',
        SAR_TURN_SECRET: 'sesame',
      },
      () => now,
    )();
    expect(servers).toHaveLength(1);
    const turn = servers[0]!;
    expect(turn.urls).toEqual(['turn:turn.example.org:3478', 'turns:turn.example.org:5349']);
    // Valid for a day from now, signed the way coturn checks it.
    expect(turn.username).toBe(`${now / 1000 + 86_400}:sar`);
    expect(turn.credential).toBe(
      createHmac('sha1', 'sesame').update(turn.username!).digest('base64'),
    );
    expect(JSON.stringify(servers)).not.toContain('sesame');
    // A TURN address without a secret is useless to clients, so it is left out.
    expect(iceFromEnv({ SAR_STUN: 'none', SAR_TURN_URL: 'turn:x' })()).toEqual([]);
  });
});
