import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { houseLayout } from '../content/layout.ts';
import type { Vec3 } from '../math.ts';
import { Sim, broomRestPose } from './sim.ts';
import type { Player } from './sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const run = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** Turns a first-person view toward `target`. */
function look(sim: Sim, p: Player, target: Vec3) {
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

/** A player standing in front of the broom where it leans in the basement. */
function byBroom(sim: Sim): Player {
  const { pos, yaw } = sim.broom;
  const p = sim.addPlayer({
    spawn: { x: pos.x - Math.sin(yaw) * 0.9, y: pos.y, z: pos.z - Math.cos(yaw) * 0.9 },
  });
  run(sim, 30);
  return p;
}

/** A player who took the broom and carried it to `at` in the yard, looking down -z. */
function withBroom(sim: Sim, at = { x: -7.3, y: 0, z: -3 }): Player {
  const p = byBroom(sim);
  look(sim, p, broomRestPose(sim.broom).pos);
  sim.act(p.id, { kind: 'grab' });
  sim.teleportPlayer(p, at);
  run(sim, 30);
  p.input.yaw = 0;
  p.input.pitch = 0;
  return p;
}

describe('the broom', () => {
  it('leans somewhere in the basement, and is picked up there with a click', () => {
    for (const level of [HOUSE, houseLayout(7)]) {
      const sim = new Sim(RAPIER, level, 1);
      expect(sim.broom).toMatchObject({ heldBy: null, leaning: true, pos: level.broom.pos });
      const p = byBroom(sim);
      look(sim, p, broomRestPose(sim.broom).pos);
      sim.act(p.id, { kind: 'grab' });
      expect(sim.broom.heldBy).toBe(p.id);
    }
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = withBroom(sim);
    expect(sim.broom.heldBy).toBe(p.id);
    expect(sim.events.some((e) => e.kind === 'broomUp')).toBe(true);
  });

  it('sweeps loose bricks on the floor ahead forward, and nothing behind', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = withBroom(sim);
    const at = p.body.translation();
    const ahead = sim.spawnBrick('2x2', 'red', { x: at.x, y: 0.07, z: at.z - 0.7 });
    const behind = sim.spawnBrick('2x2', 'red', { x: at.x, y: 0.07, z: at.z + 0.7 });
    run(sim, 30);
    const before = [ahead.body.translation().z, behind.body.translation().z];
    sim.act(p.id, { kind: 'grab' });
    expect(sim.events.at(-1)).toMatchObject({ kind: 'sweep', count: 1 });
    run(sim, 90);
    expect(ahead.body.translation().z).toBeLessThan(before[0]! - 0.4);
    expect(behind.body.translation().z).toBeCloseTo(before[1]!, 2);
    // Strokes come one at a time, however fast the clicks.
    sim.events = [];
    sim.act(p.id, { kind: 'grab' });
    sim.act(p.id, { kind: 'grab' });
    expect(sim.events.filter((e) => e.kind === 'sweep')).toHaveLength(1);
  });

  it('leaves the build alone, and what it sweeps into the build knocks nothing off', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const build = sim.build();
    sim.addBricks(
      build,
      Array.from({ length: 4 }, (_, i) => ({
        type: '2x4' as const,
        colour: 'blue' as const,
        x: 6,
        y: 1 + i * 3,
        z: 0,
        rot: 0 as const,
      })),
    );
    run(sim, 30);
    const size = build.grid.size;
    // South of the job site, sweeping north (toward +z) into the baseplate's edge.
    const p = withBroom(sim);
    expect(sim.broom.heldBy).toBe(p.id);
    sim.teleportPlayer(p, { x: 0, y: 0, z: -2.2 });
    run(sim, 10);
    p.input.yaw = Math.PI;
    const at = p.body.translation();
    const brick = sim.spawnBrick('2x4', 'red', { x: at.x - 0.1, y: 0.07, z: at.z + 0.5 });
    run(sim, 30);
    for (let i = 0; i < 6; i++) {
      sim.act(p.id, { kind: 'grab' });
      run(sim, 30);
    }
    expect(brick.body.translation().z).toBeGreaterThan(at.z + 1);
    expect(build.anchored).toBe(true);
    expect(build.grid.size).toBe(size);
    expect(sim.events.some((e) => e.kind === 'break')).toBe(false);
  });

  it('is laid on the floor with G, and dropped by whoever is knocked over', () => {
    const sim = new Sim(RAPIER, HOUSE, 1);
    const p = withBroom(sim);
    sim.act(p.id, { kind: 'drop' });
    expect(sim.broom).toMatchObject({ heldBy: null, leaning: false });
    run(sim, 5);
    look(sim, p, broomRestPose(sim.broom).pos);
    sim.act(p.id, { kind: 'grab' });
    expect(sim.broom.heldBy).toBe(p.id);
    sim.knockDown(p, { x: 0, y: 0, z: -1 });
    expect(sim.broom.heldBy).toBe(null);
  });

  it('keeps hands busy: no bricks while carrying it, no broom while carrying a brick', () => {
    const bin = HOUSE.bins.find((b) => b.id === 17)!;
    const binTop = { x: bin.pos.x, y: bin.pos.y + 0.6, z: bin.pos.z };
    let sim = new Sim(RAPIER, HOUSE, 1);
    let p = withBroom(sim);
    look(sim, p, binTop);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).toBe(null);

    sim = new Sim(RAPIER, HOUSE, 1);
    p = byBroom(sim);
    // A brick on the floor beside the player, picked up.
    const at = p.body.translation();
    const { yaw } = sim.broom;
    const side = {
      x: at.x + Math.cos(yaw) * 0.7,
      y: sim.broom.pos.y + 0.07,
      z: at.z - Math.sin(yaw) * 0.7,
    };
    sim.spawnBrick('2x2', 'red', side);
    run(sim, 20);
    look(sim, p, side);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBe(null);
    look(sim, p, broomRestPose(sim.broom).pos);
    sim.act(p.id, { kind: 'place' });
    expect(sim.broom.heldBy).toBe(null);
  });
});
