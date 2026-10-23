import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import type { Vec3 } from '../math.ts';
import { Sim, TIRED_DROP_TICKS, TIRED_TICKS, TUG_CLICKS, tiredFactor } from './sim.ts';
import type { Assembly, Player } from './sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const run = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** A stack of two 2x4 bricks: a build, not a loose brick. */
const tower = (sim: Sim, at: Vec3): Assembly =>
  sim.spawnBuild(
    [0, 3].map((y) => ({
      type: '2x4' as const,
      colour: 'blue' as const,
      x: 0,
      y,
      z: 0,
      rot: 0 as const,
    })),
    at,
  );

function standing(sim: Sim, at: Vec3): Player {
  const p = sim.addPlayer({ spawn: at });
  run(sim, 30);
  return p;
}

/** Points a first-person view at `target` and grabs it. */
function grab(sim: Sim, p: Player, target: Vec3) {
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
  sim.act(p.id, { kind: 'grab' });
}

function carrying(): { sim: Sim; a: Player; build: Assembly } {
  const sim = new Sim(RAPIER, HOUSE, 1);
  const a = standing(sim, { x: 0, y: 0, z: -10 });
  const build = tower(sim, { x: 0, y: 0, z: -11 });
  run(sim, 30);
  grab(sim, a, build.body.worldCom());
  expect(build.heldBy).toBe(a.id);
  run(sim, 10);
  return { sim, a, build };
}

describe('tugging a carried build', () => {
  it('takes it after enough quick clicks, not after slow ones', () => {
    const { sim, a, build } = carrying();
    const b = standing(sim, { x: 1.3, y: 0, z: -10.6 });
    const tugOnce = () => {
      grab(sim, b, build.body.worldCom());
      sim.step();
    };
    // Slow clicks never add up.
    for (let i = 0; i < TUG_CLICKS + 2; i++) {
      tugOnce();
      run(sim, 40);
    }
    expect(build.heldBy).toBe(a.id);
    expect(a.holding?.assemblyId).toBe(build.id);
    // Quick ones do.
    for (let i = 0; i < TUG_CLICKS; i++) tugOnce();
    expect(build.heldBy).toBe(b.id);
    expect(b.holding?.assemblyId).toBe(build.id);
    expect(a.holding).toBeNull();
  });
});

describe('carry fatigue', () => {
  it('slows a carrier, then makes them set the build down and not lift it again until rested', () => {
    const { sim, a, build } = carrying();
    expect(tiredFactor(a)).toBe(1);
    a.fatigue = TIRED_TICKS + (TIRED_DROP_TICKS - TIRED_TICKS) / 2;
    expect(tiredFactor(a)).toBeLessThan(1);
    a.fatigue = TIRED_DROP_TICKS - 1;
    run(sim, 1);
    expect(sim.events.some((e) => e.kind === 'tired' && e.playerId === a.id)).toBe(true);
    for (let i = 0; i < 180 && a.holding; i++) sim.step();
    expect(a.holding).toBeNull();
    expect(build.heldBy).toBeNull();
    run(sim, 30);

    // Too tired to lift it again straight away...
    grab(sim, a, build.body.worldCom());
    expect(build.heldBy).toBeNull();
    // ...but a single brick is fine.
    const brick = sim.spawnBuild(
      [{ type: '1x1' as const, colour: 'red' as const, x: 0, y: 0, z: 0, rot: 0 as const }],
      { x: 0.6, y: 0, z: -10.9 },
    );
    run(sim, 30);
    grab(sim, a, brick.body.worldCom());
    expect(brick.heldBy).toBe(a.id);
    sim.act(a.id, { kind: 'drop' });

    // Rested below the mark, they can carry it again.
    a.fatigue = TIRED_TICKS - 1;
    run(sim, 30);
    grab(sim, a, build.body.worldCom());
    expect(build.heldBy).toBe(a.id);
  });
});

describe('pickpocketing', () => {
  it('takes the page from a pocket after enough quick clicks on its owner', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const a = standing(sim, { x: 0, y: 0, z: -10 });
    const b = standing(sim, { x: 0, y: 0, z: -8.8 });
    const page = sim.pageWork.spawnPage(
      { step: 2, added: [], stamp: 'x' },
      { x: 0, y: 0.05, z: -10.8 },
    );
    run(sim, 30);
    grab(sim, a, page.body!.translation());
    expect(a.page).toBe(page.id);
    const pick = () => {
      grab(sim, b, sim.eye(a));
      sim.step();
    };
    for (let i = 0; i < TUG_CLICKS - 1; i++) pick();
    expect(a.page).toBe(page.id);
    pick();
    expect(a.page).toBeNull();
    expect(b.page).toBe(page.id);
    expect(page.carriedBy).toBe(b.id);
  });
});
