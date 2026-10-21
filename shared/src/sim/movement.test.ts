import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import type { BoxDef, LevelDef } from '../content/house.ts';
import { levelFor } from '../content/maps/index.ts';
import { IDENTITY, length } from '../math.ts';
import { PLAYER_FEET, PLAYER_GROUPS, PLAYER_HALF_HEIGHT, PLAYER_RADIUS, Sim } from './sim.ts';
import type { Player } from './sim.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const settle = (sim: Sim, ticks: number) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** A block on the lawn in front of the spawn, `x0`..`x1` across and `z0`..`z1` along. */
const block = (x0: number, x1: number, z0: number, z1: number, height: number): BoxDef => ({
  pos: { x: (x0 + x1) / 2, y: height / 2, z: (z0 + z1) / 2 },
  size: { x: x1 - x0, y: height, z: z1 - z0 },
  colour: 0x808080,
});

/**
 * A player standing on the open lawn (with `boxes` on it too), at (`x`, `z`) facing -z, with
 * nothing pressed.
 */
function onLawn(boxes: BoxDef[] = [], x = 0, z = 3.5) {
  const level: LevelDef = { ...HOUSE, boxes: [...HOUSE.boxes, ...boxes] };
  const sim = new Sim(RAPIER, level);
  const p = sim.addPlayer();
  sim.teleportPlayer(p, { x, y: 0, z });
  settle(sim, 30);
  p.input.yaw = 0;
  return { sim, p };
}

const feet = (p: { body: { translation(): { y: number } } }) =>
  p.body.translation().y - PLAYER_FEET;

describe('moving as in car-test.html', () => {
  it('goes at once at the pace asked for, and stops at once', () => {
    const { sim, p } = onLawn();
    p.input.forward = 1;
    sim.step();
    expect(length(p.vel)).toBeCloseTo(4.2, 3);
    p.input.sprint = true;
    sim.step();
    expect(length(p.vel)).toBeCloseTo(7.5, 3);
    p.input.forward = 0;
    sim.step();
    expect(length(p.vel)).toBe(0);
  });

  it('steers in the air as on the ground', () => {
    const { sim, p } = onLawn();
    p.input.forward = 1;
    settle(sim, 10);
    p.input.jump = true;
    sim.step();
    p.input.jump = false;
    p.input.forward = -1;
    settle(sim, 10);
    expect(p.grounded).toBe(false);
    expect(p.vel.z).toBeCloseTo(4.2, 3);
  });

  it('jumps about 1.3 m', () => {
    const { sim, p } = onLawn();
    const ground = feet(p);
    p.input.jump = true;
    sim.step();
    p.input.jump = false;
    let top = ground;
    for (let i = 0; i < 90; i++) {
      sim.step();
      top = Math.max(top, feet(p));
    }
    expect(top - ground).toBeGreaterThan(1.2);
    expect(top - ground).toBeLessThan(1.35);
  });

  // A step of 0.45 m, and their round foot rides up an edge a little higher, as in car-test.
  it('steps up onto anything a little over knee high, and no higher', () => {
    for (const [height, onto] of [
      [0.25, true],
      [0.44, true],
      [0.55, true],
      [0.7, false],
    ] as const) {
      const { sim, p } = onLawn([block(-1.5, 1.5, -1, 1, height)]);
      p.input.forward = 1;
      let top = 0;
      for (let i = 0; i < 40; i++) {
        sim.step();
        top = Math.max(top, feet(p));
      }
      expect(top > height - 0.05, `${height} m`).toBe(onto);
    }
  });

  it('slips off an edge only the rim of their round foot rests on', () => {
    const { sim, p } = onLawn([block(-1.5, 1.5, -1, 1, 1)]);
    // Out past the edge of the block's top, their feet over nothing.
    sim.teleportPlayer(p, { x: 0, y: 1.02, z: 1.22 });
    settle(sim, 60);
    expect(feet(p)).toBeLessThan(0.1);
    expect(p.body.translation().z).toBeGreaterThan(1.2);
  });

  it('turns side-on to squeeze through a gap narrower than their shoulders', () => {
    // Two walls with a gap 0.5 m wide between them.
    const walls = [block(-3, -0.25, -0.2, 0.2, 2), block(0.25, 3, -0.2, 0.2, 2)];
    const { sim, p } = onLawn(walls, 0, 2);
    p.input.forward = 1;
    let squeezed = false;
    for (let i = 0; i < 180; i++) {
      sim.step();
      squeezed ||= p.squeeze !== null;
    }
    expect(squeezed).toBe(true);
    expect(p.squeeze).toBe(null);
    expect(p.body.translation().z).toBeLessThan(-1);
  });

  it('does not squeeze through a gap narrower than they are deep', () => {
    const walls = [block(-3, -0.15, -0.2, 0.2, 2), block(0.15, 3, -0.2, 0.2, 2)];
    const { sim, p } = onLawn(walls, 0, 2);
    p.input.forward = 1;
    settle(sim, 180);
    expect(p.body.translation().z).toBeGreaterThan(0.2);
  });
});

/** Whether `p`'s capsule overlaps anything they walk into more than `deep` (m). */
function caught(sim: Sim, p: Player, deep = 0.05): boolean {
  return !!sim.world.intersectionWithShape(
    p.collider.translation(),
    IDENTITY,
    new RAPIER.Capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS - deep),
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    PLAYER_GROUPS,
    p.collider,
  );
}

/** How many times the character controller was stopped by something over `ticks` of `sim`. */
function hitsOver(sim: Sim, p: Player, ticks: number): number {
  const c = p.controller;
  const move = c.computeColliderMovement.bind(c);
  let hits = 0;
  c.computeColliderMovement = (...a) => {
    move(...a);
    hits += c.numComputedCollisions();
  };
  for (let i = 0; i < ticks; i++) sim.step();
  c.computeColliderMovement = move;
  return hits;
}

describe('caught inside what they walk into', () => {
  it('is put out beside it, the nearest way', () => {
    const { sim, p } = onLawn([block(-1.5, 1.5, -1, 1, 1)]);
    // Halfway into the block's front.
    const at = p.collider.translation();
    p.body.setTranslation({ x: 0, y: at.y, z: 1.1 }, true);
    p.collider.setTranslation({ x: 0, y: at.y, z: 1.1 });
    sim.step();
    expect(caught(sim, p)).toBe(false);
    const q = p.body.translation();
    expect(q.z).toBeGreaterThan(1.1);
    expect(q.z).toBeLessThan(1.5);
    expect(Math.abs(q.x)).toBeLessThan(1e-3);
  });

  it('gets out of a wheel arch at once, rather than the controller going round in it', () => {
    // Chevron Street, the offroader parked beside where they stand: their capsule well into the
    // triangles round its front wheel, thousands of them, pushing on toward them. The
    // controller made every pass it makes in there, over all of them, every move: most of a
    // second a tick.
    const sim = new Sim(RAPIER, levelFor('chevron', 1));
    const p = sim.addPlayer();
    sim.teleportPlayer(p, { x: 9.95, y: 0, z: 1.9 });
    // The world's first step: queries meet nothing till then.
    sim.step();
    expect(caught(sim, p)).toBe(true);
    p.input.forward = 1;
    p.input.yaw = 0.6;
    // (It was stopped over 800 times in those ten ticks, at 20 a move.)
    expect(hitsOver(sim, p, 10)).toBeLessThan(200);
    expect(caught(sim, p)).toBe(false);
  });
});
