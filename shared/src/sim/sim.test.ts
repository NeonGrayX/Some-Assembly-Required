import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { EYE_OFFSET, Sim } from './sim.ts';
import type { Player } from './sim.ts';
import type { Vec3 } from '../math.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const settle = (sim: Sim, ticks = 60) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** Teleports the player and points a first-person view at `target`. */
function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: 0.86, z: standAt.z }, true);
  // Bring a held brick along, otherwise it is left behind and dropped.
  const held = p.holding && sim.assemblies.get(p.holding.assemblyId);
  held?.body.setTranslation({ x: standAt.x, y: 1.4, z: standAt.z - 0.6 }, true);
  settle(sim, 2);
  const eye = sim.eye(p);
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-dx, -dz);
  p.input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

describe('Sim', () => {
  it('lets a player stand on the floor', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim, 120);
    expect(p.grounded).toBe(true);
    expect(sim.eye(p).y).toBeCloseTo(0.85 + EYE_OFFSET, 1);
  });

  it('takes a brick from a bin and snaps it onto the baseplate', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const bin = HOUSE.bins[0]!;
    lookAt(sim, p, { x: bin.pos.x, y: 0, z: bin.pos.z + 1.4 }, { ...bin.pos, y: 0.6 });
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
    settle(sim, 30);

    const plate = [...sim.assemblies.values()].find((a) => a.anchored)!;
    lookAt(sim, p, { x: 0, y: 0, z: 1.3 }, { x: 0, y: 0.04, z: 0 });
    settle(sim, 30);
    expect(sim.snapPreview(p)).not.toBeNull();
    sim.act(p.id, { kind: 'place' });
    expect(p.holding).toBeNull();
    expect(plate.grid.size).toBe(2);
    expect(sim.events.map((e) => e.kind)).toContain('snap');
  });

  it('breaks a tall tower that is dropped on the floor', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const tower = sim.spawnBuild(
      Array.from({ length: 6 }, (_, i) => ({
        type: '1x1' as const,
        colour: 'red' as const,
        x: 0,
        y: i * 3,
        z: 0,
        rot: 0 as const,
      })),
      { x: 4, y: 3, z: 4 },
    );
    settle(sim, 180);
    expect(tower.grid.size).toBeLessThan(6);
    expect(sim.events.some((e) => e.kind === 'break')).toBe(true);
  });

  it('keeps a sturdy build intact after a gentle drop', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const build = sim.spawnBuild(
      [
        { type: '2x4', colour: 'red', x: 0, y: 0, z: 0, rot: 0 },
        { type: '2x4', colour: 'red', x: 0, y: 3, z: 0, rot: 0 },
      ],
      { x: 4, y: 0.1, z: 4 },
    );
    settle(sim, 120);
    expect(build.grid.size).toBe(2);
  });

  it('pulling a supporting brick out drops what it was holding up', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const plate = [...sim.assemblies.values()].find((a) => a.anchored)!;
    // A 1x1 pillar with a 2x4 bridge on top, and a second pillar far away.
    const [pillar] = sim.addBricks(plate, [
      { type: '1x1', colour: 'red', x: 0, y: 1, z: 0, rot: 0 },
      { type: '2x4', colour: 'red', x: 0, y: 4, z: 0, rot: 0 },
      { type: '1x1', colour: 'red', x: 8, y: 1, z: 0, rot: 0 },
    ]);
    settle(sim, 10);

    const pos = sim.brickPose(plate, pillar!).pos;
    lookAt(sim, p, { x: pos.x - 2, y: 0, z: pos.z }, { ...pos, y: pos.y - 0.03 });
    sim.act(p.id, { kind: 'pull' });
    expect(p.holding?.assemblyId).not.toBe(plate.id);
    expect(plate.grid.size).toBe(2); // baseplate and the far pillar
    const loose = [...sim.assemblies.values()].filter((a) => !a.anchored && a.heldBy === null);
    expect(loose.map((a) => a.grid.size)).toEqual([1]); // the 2x4 is free and falls
  });

  it('carries a build along when the player walks', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const build = sim.spawnBuild(
      [
        { type: '2x4', colour: 'blue', x: 0, y: 0, z: 0, rot: 0 },
        { type: '2x2', colour: 'blue', x: 1, y: 3, z: 0, rot: 0 },
      ],
      { x: -11, y: 0.02, z: -11 },
    );
    settle(sim, 60);
    const centre = build.body.worldCom();
    lookAt(sim, p, { x: centre.x, y: 0, z: centre.z + 1.3 }, centre);
    sim.act(p.id, { kind: 'grab' });
    expect(build.heldBy).toBe(p.id);

    p.input.forward = 1;
    settle(sim, 90);
    expect(build.heldBy).toBe(p.id);
    expect(build.body.worldCom().z).toBeLessThan(centre.z - 1.5);
    expect(build.grid.size).toBe(2);
  });
});
