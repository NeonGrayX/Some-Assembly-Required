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
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { BUILDS, MAP_IDS, Room, isBotLevel, matchBuild } from '@sar/shared';
import type { GameMode, MapId } from '@sar/shared';

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
}

/** Plays one round and says how it went. */
function play(game: Game, trace: boolean): Result {
  const room = new Room(RAPIER, { code: 'BOTS', send: () => {}, seed: game.seed });
  room.map = game.map;
  room.build = game.build;
  room.mode = game.mode;
  room.seconds = game.seconds;
  const level = isBotLevel(game.level) ? game.level : 'normal';
  for (let i = 0; i < game.players; i++) room.addBot(level);
  if (trace) {
    room.squad.trace = (id, line) =>
      console.log(`  [${(room.squad.tick / 60).toFixed(1)}] ${id}: ${line}`);
  }
  room.startRound();
  const round = room.round!;
  if (trace) {
    const witness = room.squad.witness.bind(room.squad);
    room.squad.witness = (events) => {
      for (const e of events) {
        if (['button', 'swap', 'forge', 'hide', 'crunch', 'break', 'trip', 'heavy', 'sweep', 'catapult', 'throw', 'drop'].includes(e.kind)) {
          console.log(`  [${(room.squad.tick / 60).toFixed(1)}] event ${e.kind} ${e.buttonId ?? ""} by ${e.playerId} at ${JSON.stringify(e.pos)}`);
          if (e.kind === 'break') {
            const c = room.sim.buildCentre();
            for (const p of room.sim.players.values()) {
              const t = p.body.translation();
              const d = Math.hypot(t.x - c.x, t.z - c.z);
              const held = p.holding ? room.sim.assemblies.get(p.holding.assemblyId) : undefined;
              const h = held?.body.translation();
              console.log(`     player ${p.id} at ${d.toFixed(2)} from build, down ${p.down}, holding ${held ? `${held.grid.size} at ${Math.hypot(h!.x - c.x, h!.z - c.z).toFixed(2)} y ${h!.y.toFixed(2)}` : '-'} v ${JSON.stringify(p.body.linvel())}`);
            }
            for (const a of room.sim.assemblies.values()) {
              const t = a.body.translation();
              const v = a.body.linvel();
              if (Math.hypot(t.x - c.x, t.z - c.z) < 2.5 && Math.hypot(v.x, v.y, v.z) > 0.5 && a.heldBy === null) console.log(`     moving assembly ${a.id} size ${a.grid.size} v ${Math.hypot(v.x, v.y, v.z).toFixed(2)}`);
            }
          }
        }
      }
      witness(events);
    };
    console.log(
      `${round.target.id} on ${game.map}:`,
      [...round.roles].map(([id, role]) => `${id} ${role}`).join(', '),
    );
  }
  let tick = 0;
  const fast = new Set<number>();
  while (room.phase === 'building' && tick < (game.seconds + 30) * 60) {
    room.update();
    tick++;
    if (trace) {
      for (const a of room.sim.assemblies.values()) {
        const v = a.body.linvel();
        const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > 3 && a.heldBy === null && !fast.has(a.id)) {
          fast.add(a.id);
          const t = a.body.translation();
          console.log(`  [${(tick / 60).toFixed(1)}] fast ${a.id} size ${a.grid.size} at ${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)} v ${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`);
        } else if (sp < 1) fast.delete(a.id);
      }
    }
    if (trace && tick % ((Number(opt('every', '30')) || 30) * 60) === 0) {
      const m = matchBuild(round.target, room.sim.build().grid);
      const team = room.squad.teams[0]!;
      console.log(
        `t=${tick / 60}s known ${team.knownSteps().known}/${round.target.steps.length}` +
          ` right ${m.counts.correct}/${m.counts.total} wrong ${m.counts.wrong + m.counts.close}` +
          ` extra ${m.extras.length} held ${room.sim.build().heldBy} dog ${room.sim.dog.mode}/${(room.sim.dog.ticksHungry / 60).toFixed(0)} | ` +
          [...room.squad.bots.values()].map((b) => `${b.id} ${b.doing}`).join(', '),
      );
    }
  }
  const m = matchBuild(round.target, room.sim.build().grid);
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
    took: Math.round(tick / 60),
    correct: m.counts.correct,
    total: m.counts.total,
    known: room.squad.teams[0]?.knownSteps().known ?? 0,
    steps: round.target.steps.length,
    homeInnocents,
    homeSaboteurs,
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
  console.log(`  sent home: ${caught} saboteurs, ${home} innocents`);
}

await RAPIER.init();

if (args.includes('--one')) {
  // A child playing one game for the parent, answering in JSON.
  const game = JSON.parse(opt('one', '{}')) as Game;
  process.stdout.write(JSON.stringify(play(game, false)));
} else if (args.includes('--trace')) {
  const r = play(games()[0]!, true);
  console.log(r);
} else {
  const todo = games();
  const jobs = Number(opt('jobs', String(os.availableParallelism?.() ?? os.cpus().length)));
  const self = fileURLToPath(import.meta.url);
  const results: Result[] = [];
  let next = 0;
  const t0 = performance.now();
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const game = todo[next++]!;
      const out = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [
          ...process.execArgv,
          self,
          '--one',
          JSON.stringify(game),
        ]);
        let text = '';
        child.stdout.on('data', (d: Buffer) => (text += d.toString()));
        child.stderr.on('data', (d: Buffer) => process.stderr.write(d));
        child.on('error', reject);
        child.on('close', () => resolve(text));
      });
      try {
        const r = JSON.parse(out) as Result;
        results.push(r);
        console.log(
          `seed ${r.seed} ${r.map}/${r.build}: ${r.winner} (${r.reason}) at ${r.took}s,` +
            ` ${r.correct}/${r.total} right, read ${r.known}/${r.steps}, home ${r.homeSaboteurs} sab ${r.homeInnocents} inn`,
        );
      } catch {
        console.log(`seed ${game.seed}: no result`);
      }
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  summary(results);
  console.log(`  ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
