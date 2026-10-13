import type RAPIER from '@dimforge/rapier3d-compat';
import { BUILDS } from '../builds/catalog.ts';
import { matchBuild } from '../builds/match.ts';
import type { MapId } from '../content/maps/index.ts';
import type { GameMode } from '../gear.ts';
import { Room } from '../net/room.ts';
import type { ChosenRole, EndReason, Role, Winner } from '../round.ts';
import { TICK_RATE } from '../sim/sim.ts';
import type { BotLevel } from './skill.ts';

/**
 * Rounds played between bots only, headless and as fast as the machine allows, to see how
 * well bots of each level do against each other. Each round's seed lays out the map and picks
 * the build, so the same settings play the same rounds every time.
 */

/** The modes bots can play against each other in. */
export const ARENA_MODES = ['saboteur', 'blind', 'coop'] as const satisfies readonly GameMode[];
export type ArenaMode = (typeof ARENA_MODES)[number];

/** One bot in the arena: how well it plays, and the role it is dealt (null: at random). */
export interface ArenaBot {
  level: BotLevel;
  role: ChosenRole | null;
}

/** One round to play. */
export interface ArenaGame {
  seed: number;
  map: MapId;
  build: string;
  mode: ArenaMode;
  seconds: number;
  bots: ArenaBot[];
}

/** How one bot did in a round. */
export interface ArenaSeat {
  level: BotLevel;
  role: Role;
  /** Its side won the round. */
  won: boolean;
  /** Voted off the job site. */
  sentHome: boolean;
}

/** How a round went. */
export interface ArenaResult {
  seed: number;
  map: MapId;
  build: string;
  winner: Winner | 'none';
  reason: EndReason | 'none';
  /** Seconds of play the round took (not how long it took to compute). */
  took: number;
  /** Correct bricks of the build at the end, out of how many. */
  correct: number;
  total: number;
  meetings: number;
  /** Times the build broke. */
  breaks: number;
  seats: ArenaSeat[];
}

/** The side a role plays for. */
const sideOf = (role: Role): 'builders' | 'saboteurs' =>
  role === 'saboteur' ? 'saboteurs' : 'builders';

/**
 * Plays one round to its end. `progress` is told how far through the round's time it is (0 to
 * 1) now and then; returning true from it stops the round where it is.
 */
export function playArena(
  R: typeof RAPIER,
  game: ArenaGame,
  progress?: (done: number) => boolean | void,
): ArenaResult {
  let breaks = 0;
  const room = new Room(R, {
    code: 'ARENA',
    send: () => {},
    seed: game.seed,
    rolePicks: true,
    onEvents: (events) => {
      for (const e of events) if (e.kind === 'break') breaks++;
    },
  });
  room.map = game.map;
  room.build = game.build;
  room.mode = game.mode;
  room.seconds = game.seconds;
  const ids: number[] = [];
  for (const bot of game.bots) {
    const r = room.addBot(bot.level);
    if ('error' in r) throw new Error(r.error);
    room.chooseRole(r.id, game.mode === 'coop' ? null : bot.role);
    ids.push(r.id);
  }
  room.startRound();
  const round = room.round!;
  let tick = 0;
  let meetings = 0;
  let inMeeting = false;
  // Meetings stop the clock, so a round may run a while past its length.
  const limit = (game.seconds + 120) * TICK_RATE;
  while (room.phase === 'building' && tick < limit) {
    room.update();
    tick++;
    if (!!round.meeting !== inMeeting) {
      inMeeting = !!round.meeting;
      if (inMeeting) meetings++;
    }
    if (
      progress &&
      tick % TICK_RATE === 0 &&
      progress(Math.min(1, tick / (game.seconds * TICK_RATE)))
    )
      break;
  }
  const m = matchBuild(round.target, room.sim.build().grid);
  const home = new Set(round.sentHome);
  return {
    seed: game.seed,
    map: game.map,
    build: game.build,
    winner: round.winner ?? 'none',
    reason: round.endReason ?? 'none',
    took: Math.round(tick / TICK_RATE),
    correct: m.counts.correct,
    total: m.counts.total,
    meetings,
    breaks,
    seats: ids.map((id, i) => {
      const role = round.roles.get(id) ?? 'builder';
      return {
        level: game.bots[i]!.level,
        role,
        won: round.winner === sideOf(role),
        sentHome: home.has(id),
      };
    }),
  };
}

/**
 * The rounds for a run: `rounds` seeds in turn from `firstSeed`, going round the maps, each
 * with a build picked by its seed.
 */
export function arenaGames(opts: {
  rounds: number;
  maps: readonly MapId[];
  mode: ArenaMode;
  seconds: number;
  bots: ArenaBot[];
  firstSeed?: number;
}): ArenaGame[] {
  const first = opts.firstSeed ?? 1;
  return Array.from({ length: opts.rounds }, (_, i) => {
    const seed = first + i;
    return {
      seed,
      map: opts.maps[i % opts.maps.length]!,
      build: BUILDS[(seed * 7) % BUILDS.length]!.id,
      mode: opts.mode,
      seconds: opts.seconds,
      bots: opts.bots,
    };
  });
}

/** How a group of bots (one level on one side) did over the rounds it played. */
export interface ArenaGroup {
  level: BotLevel;
  side: 'builders' | 'saboteurs';
  /** Seats played: one per bot per round. */
  seats: number;
  wins: number;
  sentHome: number;
}

export interface ArenaSummary {
  rounds: number;
  /** Rounds each side won (and 'nobody' or 'none' when neither did). */
  wins: Record<string, number>;
  /** Rounds by how they ended. */
  reasons: Record<string, number>;
  /** Average seconds of play in rounds the builders won by finishing the build. */
  buildTime: number | null;
  /** Average share of the build that was right at the end. */
  built: number;
  saboteursCaught: number;
  innocentsSentHome: number;
  meetings: number;
  breaks: number;
  groups: ArenaGroup[];
}

export function summarizeArena(results: readonly ArenaResult[]): ArenaSummary {
  const count = (key: (r: ArenaResult) => string) => {
    const out: Record<string, number> = {};
    for (const r of results) out[key(r)] = (out[key(r)] ?? 0) + 1;
    return out;
  };
  const sum = (f: (r: ArenaResult) => number) => results.reduce((s, r) => s + f(r), 0);
  const finished = results.filter((r) => r.winner === 'builders' && r.reason === 'done');
  const groups = new Map<string, ArenaGroup>();
  let caught = 0;
  let innocents = 0;
  for (const r of results) {
    for (const s of r.seats) {
      const side = sideOf(s.role);
      if (s.sentHome) {
        if (side === 'saboteurs') caught++;
        else innocents++;
      }
      const key = `${s.level}:${side}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { level: s.level, side, seats: 0, wins: 0, sentHome: 0 }));
      g.seats++;
      if (s.won) g.wins++;
      if (s.sentHome) g.sentHome++;
    }
  }
  return {
    rounds: results.length,
    wins: count((r) => r.winner),
    reasons: count((r) => r.reason),
    buildTime: finished.length
      ? sum((r) => (finished.includes(r) ? r.took : 0)) / finished.length
      : null,
    built: results.length ? sum((r) => (r.total ? r.correct / r.total : 0)) / results.length : 0,
    saboteursCaught: caught,
    innocentsSentHome: innocents,
    meetings: sum((r) => r.meetings),
    breaks: sum((r) => r.breaks),
    groups: [...groups.values()],
  };
}
