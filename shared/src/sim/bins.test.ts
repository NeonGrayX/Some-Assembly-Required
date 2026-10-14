import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASEPLATE_SIZE, PLATE_H } from '../bricks.ts';
import { indoors, isTrashBin, trashBinMouth } from '../content/house.ts';
import type { BoxDef, LevelDef } from '../content/house.ts';
import { clearWalk, mapProblems, overlappingParts } from '../content/maps/common.ts';
import { MAPS } from '../content/maps/index.ts';
import type { Vec3 } from '../math.ts';
import { DOG_RADIUS } from './dog.ts';
import { Sim } from './sim.ts';
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

const FRONT = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] } as const;

/** A player standing in front of a bin, and the middle of its open top. */
function atBin(sim: Sim, bin: BoxDef): { p: Player; mouth: Vec3 } {
  const [fx, fz] = FRONT[bin.front ?? '-z'];
  const out = Math.max(bin.size.x, bin.size.z) / 2 + 0.6;
  const p = sim.addPlayer({ spawn: { x: bin.pos.x + fx * out, y: 0, z: bin.pos.z + fz * out } });
  run(sim, 30);
  const m = trashBinMouth(bin);
  return { p, mouth: { x: (m.x0 + m.x1) / 2, y: m.y, z: (m.z0 + m.z1) / 2 } };
}

const bins = (level: LevelDef) => level.boxes.filter(isTrashBin);

describe('rubbish bins', () => {
  it(
    'stand about every map, indoors and out, in reach and off the dog’s walks',
    { timeout: 60000 },
    () => {
      for (const map of MAPS) {
        for (const level of [map.plain, map.layout(1), map.layout(2)]) {
          const all = bins(level);
          const name = `${map.id}`;
          expect(all.length, name).toBeGreaterThanOrEqual(8);
          expect(
            all.some((b) => indoors(level, b.pos)),
            `${name} indoors`,
          ).toBe(true);
          expect(
            all.some((b) => !indoors(level, b.pos)),
            `${name} outdoors`,
          ).toBe(true);
          expect(mapProblems(level), name).toEqual([]);
          expect(
            overlappingParts(level).filter((o) => /Bin/.test(o)),
            name,
          ).toEqual([]);
          const { points, links } = level.dog;
          for (const b of all) {
            const r = {
              x0: b.pos.x - b.size.x / 2,
              x1: b.pos.x + b.size.x / 2,
              z0: b.pos.z - b.size.z / 2,
              z1: b.pos.z + b.size.z / 2,
            };
            for (const [i, j] of links)
              expect(clearWalk([r], points[i]!, points[j]!, DOG_RADIUS), name).toBe(true);
          }
        }
      }
    },
  );

  it('take the brick in hand when clicked with it, for good', () => {
    const sim = new Sim(RAPIER, MAPS[0]!.plain, 1);
    const bin = bins(sim.level)[0]!;
    const { p, mouth } = atBin(sim, bin);
    const brick = sim.spawnBrick('2x4', 'red', { ...sim.eye(p), y: 0.1 });
    run(sim, 20);
    look(sim, p, brick.body.worldCom());
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding?.assemblyId).toBe(brick.id);
    run(sim, 10);
    look(sim, p, mouth);
    sim.events.length = 0;
    sim.act(p.id, { kind: 'place' });
    expect(sim.assemblies.has(brick.id)).toBe(false);
    expect(p.holding).toBe(null);
    expect(sim.events).toContainEqual(
      expect.objectContaining({ kind: 'binned', count: 1, playerId: p.id }),
    );
  });

  it(
    'swallow a brick dropped or thrown into the open top, and leave one beside it be',
    { timeout: 60000 },
    () => {
      for (const map of MAPS) {
        const sim = new Sim(RAPIER, map.layout(1), 1);
        for (const bin of bins(sim.level)) {
          const m = trashBinMouth(bin);
          const mid = { x: (m.x0 + m.x1) / 2, z: (m.z0 + m.z1) / 2 };
          const dropped = sim.spawnBrick('2x2', 'blue', { ...mid, y: m.y + 0.8 });
          const beside = sim.spawnBrick('2x2', 'blue', {
            x: bin.pos.x + (bin.size.x / 2 + 0.6) * FRONT[bin.front ?? '-z'][0],
            y: 0.2,
            z: bin.pos.z + (bin.size.z / 2 + 0.6) * FRONT[bin.front ?? '-z'][1],
          });
          sim.events.length = 0;
          run(sim, 60);
          expect(sim.assemblies.has(dropped.id), `${map.id} ${bin.model}`).toBe(false);
          expect(sim.events.map((e) => e.kind)).toContain('binned');
          expect(sim.assemblies.has(beside.id), `${map.id} beside`).toBe(true);
        }
      }
    },
  );

  it("never take the team's build", () => {
    const sim = new Sim(RAPIER, MAPS[0]!.plain, 1);
    const p = sim.addPlayer();
    run(sim, 30);
    const plate = sim.level.baseplate;
    sim.teleportPlayer(p, { x: plate.x + BASEPLATE_SIZE / 2, y: 0, z: plate.z - 0.8 });
    run(sim, 10);
    look(sim, p, {
      x: plate.x + BASEPLATE_SIZE / 2,
      y: plate.y + PLATE_H,
      z: plate.z + 0.3,
    });
    sim.act(p.id, { kind: 'grab' });
    const build = sim.build().id;
    expect(p.holding?.assemblyId).toBe(build);
    // Carried over to a bin and clicked on it, it stays in the hands.
    const bin = bins(sim.level)[0]!;
    const m = trashBinMouth(bin);
    const mouth = { x: (m.x0 + m.x1) / 2, y: m.y, z: (m.z0 + m.z1) / 2 };
    const [fx, fz] = FRONT[bin.front ?? '-z'];
    const out = Math.max(bin.size.x, bin.size.z) / 2 + 0.9;
    sim.teleportPlayer(p, { x: bin.pos.x + fx * out, y: 0, z: bin.pos.z + fz * out });
    run(sim, 30);
    look(sim, p, mouth);
    sim.act(p.id, { kind: 'place' });
    run(sim, 30);
    expect(sim.assemblies.has(build)).toBe(true);
  });
});
