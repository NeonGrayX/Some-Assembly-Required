import { describe, expect, it } from 'vitest';
import type { RoomListing } from '@sar/shared';
import { parseListing, roomShown } from './rooms.ts';
import type { RoomFilter } from './rooms.ts';

const room = (r: Partial<RoomListing>): RoomListing => ({
  code: 'ABCD',
  host: 'Ada',
  map: 'house',
  mode: 'saboteur',
  players: 2,
  max: 10,
  playing: false,
  ...r,
});
const ALL: RoomFilter = { search: '', map: null, mode: null };

describe('the room list', () => {
  it('filters by map, game mode and a search of host names and codes', () => {
    const rooms = [
      room({ code: 'ABCD', host: 'Ada' }),
      room({ code: 'WXYZ', host: 'Bob', map: 'camp', mode: 'gear' }),
      room({ code: 'QRST', host: 'Adam', mode: 'coop' }),
    ];
    const codes = (f: Partial<RoomFilter>) =>
      rooms.filter((r) => roomShown(r, { ...ALL, ...f })).map((r) => r.code);
    expect(codes({})).toEqual(['ABCD', 'WXYZ', 'QRST']);
    expect(codes({ map: 'camp' })).toEqual(['WXYZ']);
    expect(codes({ mode: 'coop' })).toEqual(['QRST']);
    expect(codes({ search: ' ada ' })).toEqual(['ABCD', 'QRST']);
    expect(codes({ search: 'wxy' })).toEqual(['WXYZ']);
    expect(codes({ search: 'ada', mode: 'saboteur' })).toEqual(['ABCD']);
    expect(codes({ search: 'nobody' })).toEqual([]);
  });

  it('keeps only well-formed rooms from the server', () => {
    expect(parseListing(null)).toEqual([]);
    expect(parseListing({ rooms: 'no' })).toEqual([]);
    expect(
      parseListing({ rooms: [room({}), { code: 'abc' }, null, room({ code: '<b>' })] }),
    ).toEqual([room({})]);
  });
});
