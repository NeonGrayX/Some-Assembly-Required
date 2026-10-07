import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { EYE_OFFSET, PLAYER_RADIUS, Sim, cameraPosition } from './sim.ts';
import type { Assembly, Player } from './sim.ts';
import { STUD, footprint } from '../bricks.ts';
import { add, length, rotate, sub, v3, yawOf } from '../math.ts';
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

/** How far ahead of the player's centre, the way they face, the nearest corner of `a` is. */
function nearestAhead(sim: Sim, p: Player, a: Assembly): number {
  const at = p.body.translation();
  const f = { x: -Math.sin(p.input.yaw), z: -Math.cos(p.input.yaw) };
  let near = Infinity;
  for (const b of a.grid.bricks.values()) {
    const { w, d } = footprint(b.type, b.rot);
    for (const x of [b.x, b.x + w]) {
      for (const z of [b.z, b.z + d]) {
        const r = sub(
          add(a.body.translation(), rotate(a.body.rotation(), v3(x * STUD, 0, z * STUD))),
          at,
        );
        near = Math.min(near, r.x * f.x + r.z * f.z);
      }
    }
  }
  return near;
}

describe('Sim', () => {
  it('keeps the camera out of walls, and a little clear of them when asked', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    // In the front yard with the south wall just behind: the boom would reach into it.
    p.body.setTranslation({ x: -6, y: 0.86, z: 4.6 }, true);
    settle(sim, 2);
    p.input.firstPerson = false;
    p.input.yaw = 0;
    p.input.pitch = 0;
    const eye = sim.eye(p);
    const want = cameraPosition(eye, p.input);
    expect(want.z).toBeGreaterThan(6);
    const ray = sim.sightline(p, eye, want);
    const ball = sim.sightline(p, eye, want, 0.25);
    const out = (at: Vec3) => length(sub(at, eye));
    expect(out(ray)).toBeLessThan(out(want) - 0.5);
    expect(ray.z).toBeLessThan(6);
    expect(out(ball)).toBeLessThan(out(ray));
    expect(out(ball)).toBeGreaterThan(out(ray) - 0.4);
    // The camera used for aiming is the plain line of sight.
    expect(sim.camera(p)).toEqual(ray);
    // Out in the open nothing holds it back.
    p.body.setTranslation({ x: -6, y: 0.86, z: -2 }, true);
    settle(sim, 2);
    const open = sim.eye(p);
    const free = cameraPosition(open, p.input);
    expect(sim.sightline(p, open, free)).toEqual(free);
    expect(sim.sightline(p, open, free, 0.25)).toEqual(free);
  });

  it('lets a player stand on the floor', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim, 120);
    expect(p.grounded).toBe(true);
    expect(sim.eye(p).y).toBeCloseTo(0.85 + EYE_OFFSET, 1);
  });

  it('sounds a dropped brick when it lands, not when it is let go of', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const bin = HOUSE.bins[0]!;
    lookAt(sim, p, { x: bin.pos.x, y: 0, z: bin.pos.z + 1.4 }, { ...bin.pos, y: 0.6 });
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
    settle(sim, 30);
    sim.events.length = 0;
    sim.act(p.id, { kind: 'drop' });
    expect(p.holding).toBeNull();
    // Nothing yet: the brick is still in the air.
    sim.step();
    expect(sim.events.filter((e) => e.kind === 'drop')).toHaveLength(0);
    settle(sim, 120);
    const drops = sim.events.filter((e) => e.kind === 'drop');
    expect(drops.length).toBeGreaterThanOrEqual(1);
    expect(drops.length).toBeLessThanOrEqual(3);
    expect(drops[0]!.count).toBe(1);
    expect(drops[0]!.speed).toBeGreaterThan(1.2);
    // Where it landed: on the floor, not where the hand let go.
    expect(drops[0]!.pos.y).toBeLessThan(0.3);
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

  it('snaps a piece built off the job site onto the baseplate in one go', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const plate = [...sim.assemblies.values()].find((a) => a.anchored)!;
    const piece = sim.spawnBuild(
      [
        { type: '2x4', colour: 'red', x: 0, y: 0, z: 0, rot: 0 },
        { type: '1x2', colour: 'blue', x: 0, y: 3, z: 0, rot: 0 },
      ],
      { x: 1.5, y: 0.02, z: 1.5 },
    );
    settle(sim, 30);
    lookAt(
      sim,
      p,
      { x: 1.7, y: 0, z: 2.6 },
      sim.brickPose(piece, piece.grid.bricks.values().next().value!).pos,
    );
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding?.assemblyId).toBe(piece.id);
    sim.act(p.id, { kind: 'rotate' });
    lookAt(sim, p, { x: 0, y: 0, z: 1.3 }, { x: 0, y: 0.04, z: 0 });
    settle(sim, 30);
    const preview = sim.snapPreview(p);
    expect(preview?.bricks).toHaveLength(2);
    sim.act(p.id, { kind: 'place' });
    expect(p.holding).toBeNull();
    expect(sim.assemblies.has(piece.id)).toBe(false);
    expect(plate.grid.size).toBe(3);
    const [low, high] = preview!.bricks.map((b) => plate.grid.bricks.get(b.id)!);
    // Still the same piece: the 1x2 on the end of the 2x4, both turned the same way.
    expect(low).toMatchObject({ type: '2x4', colour: 'red', y: 1 });
    expect(high).toMatchObject({ type: '1x2', colour: 'blue', y: 4, rot: low!.rot });
    expect(plate.grid.neighbours(high!)).toHaveLength(1);
    expect(sim.events.map((e) => e.kind)).toContain('snap');
  });

  it('never snaps the baseplate onto anything', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const plate = [...sim.assemblies.values()].find((a) => a.anchored)!;
    sim.spawnBuild([{ type: '2x4', colour: 'red', x: 0, y: 0, z: 0, rot: 0 }], {
      x: 3,
      y: 0.02,
      z: 1,
    });
    settle(sim, 10);
    lookAt(sim, p, { x: 0, y: 0, z: 1.3 }, { x: 0, y: 0.04, z: 0 });
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding?.assemblyId).toBe(plate.id);
    lookAt(sim, p, { x: 3, y: 0, z: 2 }, { x: 3.2, y: 0.12, z: 1.1 });
    expect(sim.snapPreview(p)).toBeNull();
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

  it('holds a brick broken off a build in the hands, however far it sits from its body', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    // Like a piece broken off a build: one brick, turned, far from its body's origin.
    const a = sim.spawnBuild([{ type: '2x4', colour: 'red', x: 6, y: 3, z: 4, rot: 1 }], {
      x: -11,
      y: 0.02,
      z: -11,
    });
    const brick = a.grid.bricks.values().next().value!;
    settle(sim, 60);
    const at = sim.brickPose(a, brick).pos;
    lookAt(sim, p, { x: at.x, y: 0, z: at.z + 1.3 }, at);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding?.assemblyId).toBe(a.id);
    settle(sim, 60);

    const target = sim.holdTarget(p, p.holding!, a);
    const held = sim.brickPose(a, brick);
    expect(Math.hypot(...Object.values(sub(held.pos, target.pos)))).toBeLessThan(0.05);
    // Straight across the hands: the brick's own heading matches the player's.
    const turn = Math.abs(Math.sin(yawOf(held.rot) - p.input.yaw));
    expect(turn).toBeLessThan(0.05);
    // A client drawing the brick from heldBrickPose puts it in the same place.
    const pose = sim.heldBrickPose(p, p.holding!, a);
    a.body.setTranslation(pose.pos, true);
    a.body.setRotation(pose.rot, true);
    const drawn = sim.brickPose(a, brick).pos;
    expect(Math.hypot(...Object.values(sub(drawn, target.pos)))).toBeLessThan(1e-4);
  });

  it('turns a brick pulled off a build straight across the hands', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const plate = [...sim.assemblies.values()].find((a) => a.anchored)!;
    const [brick] = sim.addBricks(plate, [
      { type: '2x4', colour: 'red', x: 0, y: 1, z: 0, rot: 0 },
    ]);
    settle(sim, 10);

    // Looking at it from the side, the brick lies along the player's view.
    const pos = sim.brickPose(plate, brick!).pos;
    lookAt(sim, p, { x: pos.x - 2, y: 0, z: pos.z }, pos);
    sim.act(p.id, { kind: 'pull' });
    expect(p.holding).not.toBeNull();
    expect(p.holding!.rot).toBe(0);
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

  it('keeps a carried baseplate out of the player while they sprint and turn', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const plate = [...sim.assemblies.values()].find((a) => a.anchored)!;
    const c = plate.body.translation();
    const middle = { x: c.x + 0.8, y: 0.02, z: c.z + 0.8 };
    lookAt(sim, p, { x: middle.x, y: 0, z: middle.z + 1.2 }, middle);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding?.assemblyId).toBe(plate.id);
    settle(sim, 30);
    p.input.sprint = true;
    p.input.forward = 1;
    let nearest = Infinity;
    for (let t = 0; t < 60; t++) {
      // Run straight, then swing round while running.
      if (t >= 30) p.input.yaw += 0.05;
      sim.step();
      nearest = Math.min(nearest, nearestAhead(sim, p, plate));
    }
    expect(plate.heldBy).toBe(p.id);
    expect(nearest).toBeGreaterThan(PLAYER_RADIUS);
  });

  it('keeps a brick in the hands while the player sprints', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const bin = HOUSE.bins[0]!;
    lookAt(sim, p, { x: bin.pos.x, y: 0, z: bin.pos.z + 1.4 }, { ...bin.pos, y: 0.6 });
    sim.act(p.id, { kind: 'grab' });
    const brick = sim.assemblies.get(p.holding!.assemblyId)!;
    // Away from the bins, toward open floor.
    p.input.yaw = Math.PI;
    settle(sim, 30);
    const from = p.body.translation();
    p.input.sprint = true;
    p.input.forward = 1;
    for (let t = 0; t < 30; t++) {
      sim.step();
      const target = sim.heldBrickPose(p, p.holding!, brick).pos;
      if (t > 10) expect(length(sub(brick.body.translation(), target))).toBeLessThan(0.05);
    }
    expect(length(sub(p.body.translation(), from))).toBeGreaterThan(2.5);
  });
});
