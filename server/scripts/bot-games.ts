/**
 * Plays rounds between bots only, headless and as fast as the machine allows, and prints who
 * won: the way to check that bots finish builds and that builders and saboteurs win about as
 * often as each other.
 *
 *   npm run bot-games -w server -- --games 40 --players 6 --level normal --mode saboteur
 *
 * Options: --games N, --players N (all bots), --level easy|normal|hard|expert, --mode, --map
 * (or "all"), --build (or "all"), --seconds (round length), --seed (first seed), --jobs (games
 * at once; one per core by default), --trace (what each bot does; one game).
 *
 * Bots against people, with bots standing in for the people: --people N (how many of the
 * players), --as LEVEL (how well they play), --side saboteurs|builders (the side the other bots
 * take, as the lobby's "Bots play as" setting).
 */
import { fork } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  BUILDS,
  MAP_IDS,
  ROUND_OVERTIME_SECONDS,
  Room,
  TICK_RATE,
  isBotLevel,
  isBotSide,
  matchBuild,
} from '@sar/shared';
import type { GameMode, MapId, SimEvent } from '@sar/shared';

const args = process.argv.slice(2);
function opt(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
}

interface Game {
  seed: number;
  map: MapId;
  build: string;
  mode: GameMode;
  players: number;
  level: string;
  seconds: number;
  /** Stand-ins for people: how many, how well they play, and the side the real bots take. */
  people: number;
  peopleLevel: string;
  side: string;
}

interface Result extends Game {
  winner: string;
  reason: string;
  /** Seconds the round ran. */
  took: number;
  /** Correct bricks of the build at the end, out of how many. */
  correct: number;
  total: number;
  /** Steps the builders had read, out of how many. */
  known: number;
  steps: number;
  /** Innocents sent home by vote, and saboteurs caught. */
  homeInnocents: number;
  homeSaboteurs: number;
  /** Saboteur tools used, by tool. */
  tools: Record<string, number>;
  /** Meetings called. */
  meetings: number;
  /** Times the build broke. */
  breaks: number;
}

/** Event kinds the trace prints. */
const TRACED = new Set([
  'button',
  'swap',
  'forge',
  'hide',
  'tamper',
  'crunch',
  'break',
  'trip',
  'heavy',
  'sweep',
  'catapult',
  'throw',
  'drop',
]);

/** Plays one round and says how it went. */
function play(game: Game, trace: boolean): Result {
  let breaks = 0;
  let onTrace: ((events: SimEvent[]) => void) | null = null;
  const room = new Room(RAPIER, {
    code: 'BOTS',
    send: () => {},
    seed: game.seed,
    onEvents: (events) => {
      for (const e of events) if (e.kind === 'break') breaks++;
      onTrace?.(events);
    },
  });
  room.map = game.map;
  room.build = game.build;
  room.mode = game.mode;
  room.seconds = game.seconds;
  const level = isBotLevel(game.level) ? game.level : 'normal';
  if (isBotSide(game.side)) room.botSide = game.side;
  for (let i = 0; i < game.players; i++) {
    // Bots standing in for people: the room takes them for people (dealing roles, what experts
    // know), though they still play as bots.
    if (i < game.people) room.addStandIn(isBotLevel(game.peopleLevel) ? game.peopleLevel : level);
    else room.addBot(level);
  }
  if (trace) {
    room.squad.trace = (id, line) =>
      console.log(`  [${(room.squad.tick / TICK_RATE).toFixed(1)}] ${id}: ${line}`);
  }
  room.startRound();
  const round = room.round!;
  if (trace) {
    onTrace = (events) => {
      for (const e of events) {
        if (TRACED.has(e.kind)) {
          console.log(
            `  [${(room.squad.tick / TICK_RATE).toFixed(1)}] event ${e.kind} ${e.buttonId ?? ''} by ${e.playerId} at ${JSON.stringify(e.pos)}`,
          );
          if (e.kind === 'break') {
            const c = room.sim.buildCentre();
            for (const p of room.sim.players.values()) {
              const t = p.body.translation();
              const d = Math.hypot(t.x - c.x, t.z - c.z);
              const held = p.holding ? room.sim.assemblies.get(p.holding.assemblyId) : undefined;
              const h = held?.body.translation();
              console.log(
                `     player ${p.id} at ${d.toFixed(2)} from build, down ${p.down}, holding ${held ? `${held.grid.size} at ${Math.hypot(h!.x - c.x, h!.z - c.z).toFixed(2)} y ${h!.y.toFixed(2)}` : '-'} v ${JSON.stringify(p.body.linvel())}`,
              );
            }
            for (const a of room.sim.assemblies.values()) {
              const t = a.body.translation();
              const v = a.body.linvel();
              if (
                Math.hypot(t.x - c.x, t.z - c.z) < 2.5 &&
                Math.hypot(v.x, v.y, v.z) > 0.5 &&
                a.heldBy === null
              )
                console.log(
                  `     moving assembly ${a.id} size ${a.grid.size} v ${Math.hypot(v.x, v.y, v.z).toFixed(2)}`,
                );
            }
          }
        }
      }
    };
    console.log(
      `${round.target.id} on ${game.map}:`,
      [...round.roles].map(([id, role]) => `${id} ${role}`).join(', '),
    );
  }
  let tick = 0;
  let meetings = 0;
  let inMeeting = false;
  const fast = new Set<number>();
  while (room.phase === 'building' && tick < (game.seconds + ROUND_OVERTIME_SECONDS) * TICK_RATE) {
    room.update();
    tick++;
    if (!!round.meeting !== inMeeting) {
      inMeeting = !!round.meeting;
      if (inMeeting) meetings++;
    }
    if (trace) {
      for (const a of room.sim.assemblies.values()) {
        const v = a.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 3 && a.heldBy === null && !fast.has(a.id)) {
          fast.add(a.id);
          const t = a.body.translation();
          console.log(
            `  [${(tick / TICK_RATE).toFixed(1)}] fast ${a.id} size ${a.grid.size} at ${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)} v ${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`,
          );
        } else if (sp < 1) fast.delete(a.id);
      }
    }
    if (trace && tick % ((Number(opt('every', '30')) || 30) * TICK_RATE) === 0) {
      const m = matchBuild(round.target, room.sim.build().grid);
      const team = room.squad.teams[0]!;
      console.log(
        `t=${tick / TICK_RATE}s known ${team.knownSteps().known}/${round.target.steps.length}` +
          ` right ${m.counts.correct}/${m.counts.total} wrong ${m.counts.wrong + m.counts.close}` +
          ` extra ${m.extras.length} held ${room.sim.build().heldBy} dog ${room.sim.dog.mode}/${(room.sim.dog.ticksHungry / TICK_RATE).toFixed(0)} | ` +
          [...room.squad.bots.values()].map((b) => `${b.id} ${b.doing}`).join(', '),
      );
    }
  }
  const m = matchBuild(round.target, room.sim.build().grid);
  const tools: Record<string, number> = {};
  for (const [key, n] of (round as unknown as { uses: Map<string, number> }).uses) {
    const tool = key.split(':')[1]!;
    tools[tool] = (tools[tool] ?? 0) + n;
  }
  let homeInnocents = 0;
  let homeSaboteurs = 0;
  for (const id of round.sentHome) {
    if (round.roles.get(id) === 'saboteur') homeSaboteurs++;
    else homeInnocents++;
  }
  return {
    ...game,
    winner: round.winner ?? 'none',
    reason: round.endReason ?? 'none',
    took: Math.round(tick / TICK_RATE),
    correct: m.counts.correct,
    total: m.counts.total,
    known: room.squad.teams[0]?.knownSteps().known ?? 0,
    steps: round.target.steps.length,
    homeInnocents,
    homeSaboteurs,
    tools,
    meetings,
    breaks,
  };
}

/** The games asked for: seeds in turn, each with its map and build (picked by seed for "all"). */
function games(): Game[] {
  const count = Number(opt('games', '20'));
  const first = Number(opt('seed', '1'));
  const map = opt('map', 'all');
  const build = opt('build', 'all');
  const out: Game[] = [];
  for (let i = 0; i < count; i++) {
    const seed = first + i;
    out.push({
      seed,
      map: map === 'all' ? MAP_IDS[seed % MAP_IDS.length]! : (map as MapId),
      build: build === 'all' ? BUILDS[(seed * 7) % BUILDS.length]!.id : build,
      mode: opt('mode', 'saboteur') as GameMode,
      players: Number(opt('players', '6')),
      level: opt('level', 'normal'),
      seconds: Number(opt('seconds', '600')),
      people: Number(opt('people', '0')),
      peopleLevel: opt('as', 'normal'),
      side: opt('side', 'any'),
    });
  }
  return out;
}

function summary(results: Result[]): void {
  const wins = new Map<string, number>();
  for (const r of results) wins.set(r.winner, (wins.get(r.winner) ?? 0) + 1);
  const n = results.length;
  console.log(`\n${n} games`);
  for (const [w, k] of [...wins].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${w.padEnd(10)} ${String(k).padStart(4)}  ${((100 * k) / n).toFixed(0)}%`);
  }
  const reasons = new Map<string, number>();
  for (const r of results) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  console.log('  ends:', [...reasons].map(([k, v]) => `${k} ${v}`).join(', '));
  const built = results.filter((r) => r.winner === 'builders');
  if (built.length) {
    const avg = built.reduce((s, r) => s + r.took, 0) / built.length;
    console.log(`  builders' wins took ${avg.toFixed(0)}s on average`);
  }
  const home = results.reduce((s, r) => s + r.homeInnocents, 0);
  const caught = results.reduce((s, r) => s + r.homeSaboteurs, 0);
  console.log(
    `  sent home: ${caught} saboteurs, ${home} innocents; meetings ${results.reduce((s, r) => s + r.meetings, 0)}`,
  );
  const tools: Record<string, number> = {};
  for (const r of results)
    for (const [k, v] of Object.entries(r.tools)) tools[k] = (tools[k] ?? 0) + v;
  console.log(
    '  saboteur tools used:',
    Object.entries(tools)
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
  );
  const byWinner = (w: string) => results.filter((r) => r.winner === w);
  for (const w of ['builders', 'saboteurs']) {
    const rs = byWinner(w);
    if (rs.length)
      console.log(
        `  ${w} won by: ${[...new Set(rs.map((r) => r.reason))].map((x) => `${x} ${rs.filter((r) => r.reason === x).length}`).join(', ')}`,
      );
  }
}

await RAPIER.init();

if (process.send && args.includes('--child')) {
  // A child playing games for the parent: each game comes and goes as a message, so nothing
  // printed along the way can garble a result.
  const send = process.send.bind(process);
  process.on('message', (game: Game) => send(play(game, false)));
} else if (args.includes('--trace')) {
  const r = play(games()[0]!, true);
  console.log(r);
} else {
  const todo = games();
  const jobs = Number(opt('jobs', String(os.availableParallelism?.() ?? os.cpus().length)));
  const self = fileURLToPath(import.meta.url);
  const results: Result[] = [];
  let failed = 0;
  let next = 0;
  const t0 = performance.now();
  /** One child process, playing games one after another until there are none left. */
  const worker = async (): Promise<void> => {
    const child = fork(self, ['--child'], { execArgv: process.execArgv });
    const exited = new Promise<string>((done) => {
      child.on('exit', (code, signal) => done(`the game process stopped (${signal ?? code})`));
      child.on('error', (err) => done(err.message));
    });
    try {
      while (next < todo.length) {
        const game = todo[next++]!;
        child.send(game);
        const r = await Promise.race([
          new Promise<Result>((done) => child.once('message', (m) => done(m as Result))),
          exited.then((why) => Promise.reject(new Error(why))),
        ]).catch((err: Error) => {
          failed++;
          console.log(`seed ${game.seed}: no result: ${err.message}`);
          return null;
        });
        if (!r) return;
        results.push(r);
        console.log(
          `seed ${r.seed} ${r.map}/${r.build}: ${r.winner} (${r.reason}) at ${r.took}s,` +
            ` ${r.correct}/${r.total} right, read ${r.known}/${r.steps}, breaks ${r.breaks}, home ${r.homeSaboteurs} sab ${r.homeInnocents} inn`,
        );
      }
    } finally {
      child.kill();
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, todo.length) }, worker));
  // Games no process was left to play.
  failed += todo.length - next;
  summary(results);
  console.log(`  ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  if (failed) {
    console.error(`${failed} of ${todo.length} games failed`);
    process.exitCode = 1;
  }
}
