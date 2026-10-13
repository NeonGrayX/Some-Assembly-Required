import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { RateLimiter, clientAddress, clientIpHeaderFromEnv } from './limits.ts';

const request = (remoteAddress: string, headers: Record<string, string> = {}) =>
  ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;

describe("a player's address", () => {
  it('believes no header unless told which one the proxy sets', () => {
    const spoofed = request('192.168.1.5', {
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '5.6.7.8',
    });
    expect(clientAddress(spoofed, null)).toBe('192.168.1.5');
  });

  it("reads the trusted header, and only from a proxy's address", () => {
    const viaProxy = request('172.18.0.2', {
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '6.6.6.6, 5.6.7.8',
    });
    expect(clientAddress(viaProxy, 'cf-connecting-ip')).toBe('1.2.3.4');
    // The last hop is the one the proxy added; earlier ones are whatever the player sent.
    expect(clientAddress(viaProxy, 'x-forwarded-for')).toBe('5.6.7.8');
    expect(clientAddress(viaProxy, 'x-real-ip')).toBe('172.18.0.2');
    const direct = request('8.8.8.8', { 'cf-connecting-ip': '1.2.3.4' });
    expect(clientAddress(direct, 'cf-connecting-ip')).toBe('8.8.8.8');
  });

  it('takes the header from SAR_CLIENT_IP_HEADER', () => {
    expect(clientIpHeaderFromEnv({})).toBeNull();
    expect(clientIpHeaderFromEnv({ SAR_CLIENT_IP_HEADER: 'none' })).toBeNull();
    expect(clientIpHeaderFromEnv({ SAR_CLIENT_IP_HEADER: 'X-Forwarded-For' })).toBe(
      'x-forwarded-for',
    );
    expect(() => clientIpHeaderFromEnv({ SAR_CLIENT_IP_HEADER: 'forwarded' })).toThrow();
  });
});

describe('the rate limiter', () => {
  it('limits each address and kind on its own, and forgets quiet addresses', () => {
    const limits = new RateLimiter(
      { a: { perSecond: 0, burst: 2 }, b: { perSecond: 0, burst: 1 } },
      1000,
      () => 0,
    );
    expect([limits.take('x', 'a'), limits.take('x', 'a'), limits.take('x', 'a')]).toEqual([
      true,
      true,
      false,
    ]);
    expect(limits.take('x', 'b')).toBe(true);
    expect(limits.take('y', 'a')).toBe(true);
  });
});
