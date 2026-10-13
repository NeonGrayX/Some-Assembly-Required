import { describe, expect, it } from 'vitest';
import { arenaGames, summarizeArena } from './arena.ts';
import type { MapId } from '../content/maps/index.ts';
import type { ArenaBot, ArenaResult } from './arena.ts';

const bots: ArenaBot[] = [
  { level: 'easy', role: 'saboteur' },
  { level: 'hard', role: null },
];

describe('arenaGames', () => {
  it('plays the same rounds every time, going round the maps', () => {
    const opts = {
      rounds: 5,
      maps: ['house', 'camp'] as MapId[],
      mode: 'saboteur' as const,
      seconds: 300,
      bots,
    };
    const games = arenaGames(opts);
    expect(games.map((g) => g.seed)).toEqual([1, 2, 3, 4, 5]);
    expect(games.map((g) => g.map)).toEqual(['house', 'camp', 'house', 'camp', 'house']);
    expect(arenaGames(opts)).toEqual(games);
  });
});

describe('summarizeArena', () => {
  const round = (over: Partial<ArenaResult>): ArenaResult => ({
    seed: 1,
    map: 'house',
    build: 'lighthouse',
    winner: 'builders',
    reason: 'done',
    took: 200,
    correct: 10,
    total: 10,
    meetings: 1,
    breaks: 0,
    seats: [
      { level: 'easy', role: 'saboteur', won: false, sentHome: true },
      { level: 'hard', role: 'builder', won: true, sentHome: false },
    ],
    ...over,
  });

  it('adds up wins, build times and who was sent home', () => {
    const s = summarizeArena([
      round({}),
      round({
        winner: 'saboteurs',
        reason: 'time',
        took: 300,
        correct: 5,
        breaks: 2,
        seats: [
          { level: 'easy', role: 'saboteur', won: true, sentHome: false },
          { level: 'hard', role: 'builder', won: false, sentHome: true },
        ],
      }),
    ]);
    expect(s.rounds).toBe(2);
    expect(s.wins).toEqual({ builders: 1, saboteurs: 1 });
    expect(s.buildTime).toBe(200);
    expect(s.built).toBeCloseTo(0.75);
    expect(s.saboteursCaught).toBe(1);
    expect(s.innocentsSentHome).toBe(1);
    expect(s.breaks).toBe(2);
    const sab = s.groups.find((g) => g.side === 'saboteurs')!;
    expect(sab).toEqual({ level: 'easy', side: 'saboteurs', seats: 2, wins: 1, sentHome: 1 });
  });
});
