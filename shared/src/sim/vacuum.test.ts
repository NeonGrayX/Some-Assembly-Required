import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE, isTrashBin, trashBinMouth } from '../content/house.ts';
import { houseLayout } from '../content/layout.ts';
import type { Vec3 } from '../math.ts';
import { Sim, VACUUM_CAPACITY, vacuumRestPose } from './sim.ts';
import type { Player } from './sim.ts';
import { loadedPress } from './testing.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const run = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

const FRONT = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] } as const;

/** Turns a first-person view toward `target`. */
function look(sim: Sim, p: Player, target: Vec3) {
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

/** A player standing in front of the vacuum where it leans in the basement. */
function byVacuum(sim: Sim): Player {
  const { pos, yaw } = sim.vacuum;
  const p = sim.addPlayer({
    spawn: { x: pos.x - Math.sin(yaw) * 0.9, y: pos.y, z: pos.z - Math.cos(yaw) * 0.9 },
  });
  run(sim, 30);
  return p;
}

/** A player who took the vacuum and carried it to `at` in the yard, looking down -z. */
function withVacuum(sim: Sim, at = { x: -7.3, y: 0, z: -3 }): Player {
  const p = byVacuum(sim);
  look(sim, p, vacuumRestPose(sim.vacuum).pos);
  sim.act(p.id, { kind: 'grab' });
  sim.teleportPlayer(p, at);
  run(sim, 30);
  p.input.yaw = 0;
  p.input.pitch = 0;
  return p;
}

describe('the vacuum', () => {
  it('leans somewhere in the basement, and is picked up there with a click', () => {
    for (const level of [HOUSE, houseLayout(7)]) {
      const sim = new Sim(RAPIER, level, 1);
      expect(sim.vacuum).toMatchObject({ heldBy: null, leaning: true, pos: level.vacuum.pos });
      const p = byVacuum(sim);
      look(sim, p, vacuumRestPose(sim.vacuum).pos);
      sim.act(p.id, { kind: 'grab' });
      expect(sim.vacuum.heldBy).toBe(p.id);
    }
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = withVacuum(sim);
    expect(sim.vacuum.heldBy).toBe(p.id);
    expect(sim.events.some((e) => e.kind === 'vacuumUp')).toBe(true);
  });

  it('sucks up loose bricks on the floor ahead, and nothing behind', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = withVacuum(sim);
    const at = p.body.translation();
    const ahead = sim.spawnBrick('2x2', 'red', { x: at.x, y: 0.07, z: at.z - 0.7 });
    const behind = sim.spawnBrick('2x2', 'red', { x: at.x, y: 0.07, z: at.z + 0.7 });
    run(sim, 30);
    sim.act(p.id, { kind: 'grab' });
    expect(sim.events.at(-1)).toMatchObject({ kind: 'suck', count: 1 });
    expect(sim.assemblies.has(ahead.id)).toBe(false);
    expect(sim.assemblies.has(behind.id)).toBe(true);
    expect(sim.vacuum.load).toBe(1);
    // Pulls come one at a time, however fast the clicks.
    run(sim, 30);
    sim.events = [];
    sim.act(p.id, { kind: 'grab' });
    sim.act(p.id, { kind: 'grab' });
    expect(sim.events.filter((e) => e.kind === 'suck')).toHaveLength(1);
  });

  it('keeps pulling while the click is held, without touching what is aimed at', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = withVacuum(sim);
    const at = p.body.translation();
    const near = sim.spawnBrick('2x2', 'red', { x: at.x, y: 0.07, z: at.z - 0.5 });
    run(sim, 30);
    sim.act(p.id, { kind: 'grab' });
    expect(sim.assemblies.has(near.id)).toBe(false);
    const far = sim.spawnBrick('2x2', 'blue', { x: at.x, y: 0.07, z: at.z - 1 });
    run(sim, 30);
    sim.events = [];
    sim.act(p.id, { kind: 'suck' });
    expect(sim.events.at(-1)).toMatchObject({ kind: 'suck', count: 1 });
    expect(sim.assemblies.has(far.id)).toBe(false);
    expect(sim.vacuum.load).toBe(2);
    // Held pulls come no faster than clicks.
    sim.events = [];
    sim.act(p.id, { kind: 'suck' });
    expect(sim.events.filter((e) => e.kind === 'suck')).toHaveLength(0);
    // Without the vacuum it does nothing.
    sim.act(p.id, { kind: 'drop' });
    run(sim, 30);
    sim.events = [];
    sim.act(p.id, { kind: 'suck' });
    expect(sim.events).toHaveLength(0);
  });

  it('leaves the build alone', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const build = sim.build();
    run(sim, 30);
    const size = build.grid.size;
    // South of the job site, facing north (toward +z) at the baseplate's edge.
    const p = withVacuum(sim);
    sim.teleportPlayer(p, { x: 0, y: 0, z: -2.2 });
    run(sim, 10);
    p.input.yaw = Math.PI;
    for (let i = 0; i < 6; i++) {
      sim.act(p.id, { kind: 'grab' });
      run(sim, 30);
    }
    expect(sim.assemblies.has(build.id)).toBe(true);
    expect(build.anchored).toBe(true);
    expect(build.grid.size).toBe(size);
    expect(sim.vacuum.load).toBe(0);
  });

  it(`holds ${VACUUM_CAPACITY} bricks, then is emptied at a rubbish bin`, () => {
    // The laid-out house has its bins.
    const sim = new Sim(RAPIER, houseLayout(1), 1);
    const p = withVacuum(sim);
    const at = p.body.translation();
    const bricks = Array.from({ length: VACUUM_CAPACITY + 2 }, (_, i) =>
      sim.spawnBrick('1x1', 'red', {
        x: at.x - 0.3 + (i % 4) * 0.2,
        y: 0.07,
        z: at.z - 0.4 - Math.floor(i / 4) * 0.25,
      }),
    );
    run(sim, 30);
    for (let i = 0; i < 4; i++) {
      sim.act(p.id, { kind: 'grab' });
      run(sim, 30);
    }
    expect(sim.vacuum.load).toBe(VACUUM_CAPACITY);
    expect(bricks.filter((b) => sim.assemblies.has(b.id))).toHaveLength(2);
    expect(sim.events.some((e) => e.kind === 'vacuumFull')).toBe(true);

    // Carried over to a bin and clicked on it, it comes out empty.
    const bin = sim.level.boxes.find(isTrashBin)!;
    expect(bin).toBeDefined();
    const [fx, fz] = FRONT[bin.front ?? '-z'];
    const out = Math.max(bin.size.x, bin.size.z) / 2 + 0.9;
    sim.teleportPlayer(p, {
      x: bin.pos.x + fx * out,
      y: bin.pos.y - bin.size.y / 2,
      z: bin.pos.z + fz * out,
    });
    run(sim, 30);
    const m = trashBinMouth(bin);
    look(sim, p, { x: (m.x0 + m.x1) / 2, y: m.y, z: (m.z0 + m.z1) / 2 });
    sim.events = [];
    sim.act(p.id, { kind: 'grab' });
    expect(sim.events).toContainEqual(
      expect.objectContaining({ kind: 'binned', count: VACUUM_CAPACITY, playerId: p.id }),
    );
    expect(sim.vacuum.load).toBe(0);
    expect(sim.vacuum.heldBy).toBe(p.id);
  });

  it('is laid on the floor with G, and dropped by whoever is knocked over', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = withVacuum(sim);
    sim.act(p.id, { kind: 'drop' });
    expect(sim.vacuum).toMatchObject({ heldBy: null, leaning: false });
    run(sim, 5);
    look(sim, p, vacuumRestPose(sim.vacuum).pos);
    sim.act(p.id, { kind: 'grab' });
    expect(sim.vacuum.heldBy).toBe(p.id);
    sim.knockDown(p, { x: 0, y: 0, z: -1 });
    expect(sim.vacuum.heldBy).toBe(null);
  });

  it('keeps hands busy: no bricks while carrying it, no vacuum while carrying a brick', () => {
    let sim = new Sim(RAPIER, HOUSE, 1);
    let p = withVacuum(sim);
    const press = loadedPress(sim);
    p.body.setTranslation({ x: press.stand.x, y: 0.86, z: press.stand.z }, true);
    run(sim, 2);
    look(sim, p, press.target);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).toBe(null);
    expect(p.tool).toBe(null);

    sim = new Sim(RAPIER, HOUSE, 1);
    p = byVacuum(sim);
    // A brick on the floor beside the player, picked up.
    const at = p.body.translation();
    const { yaw } = sim.vacuum;
    const side = {
      x: at.x + Math.cos(yaw) * 0.7,
      y: sim.vacuum.pos.y + 0.07,
      z: at.z - Math.sin(yaw) * 0.7,
    };
    sim.spawnBrick('2x2', 'red', side);
    run(sim, 20);
    look(sim, p, side);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBe(null);
    look(sim, p, vacuumRestPose(sim.vacuum).pos);
    sim.act(p.id, { kind: 'place' });
    expect(sim.vacuum.heldBy).toBe(null);
  });
});
