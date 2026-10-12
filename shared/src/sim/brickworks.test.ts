import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE } from '../content/house.ts';
import { rivalLevel } from '../content/rival.ts';
import { MANGA_SHOP } from '../builds/mangashop.ts';
import { assemblyState, bricksOf } from '../net/protocol.ts';
import { BUCKET_SHOTS, Sim } from './sim.ts';
import type { Player } from './sim.ts';
import { loadedPress, machine } from './testing.ts';
import type { Vec3 } from '../math.ts';
import type { BrickTypeId } from '../bricks.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const settle = (sim: Sim, ticks = 60) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

/** Teleports the player and points a first-person view at `target`. */
function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: 0.86, z: standAt.z }, true);
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

/** Takes the mould for a part from the dispenser. */
function takeMould(sim: Sim, p: Player, type: BrickTypeId) {
  const dispenser = machine(sim, 'dispenser');
  lookAt(sim, p, dispenser.stand, dispenser.target);
  sim.act(p.id, { kind: 'mould', type });
}

const heldPart = (sim: Sim, p: Player) => {
  const a = sim.assemblies.get(p.holding!.assemblyId)!;
  return a.grid.bricks.values().next().value!;
};

describe('the brick works', () => {
  it('has two moulding machines, the silo, the mould dispenser and the printer', () => {
    expect(HOUSE.machines.map((m) => m.kind).sort()).toEqual([
      'dispenser',
      'press',
      'press',
      'printer',
      'silo',
    ]);
  });

  it('makes a part from a mould from the dispenser and a bucket of pellets from the silo', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    // A plain click on the dispenser does nothing: the part has to be picked.
    sim.act(p.id, { kind: 'grab' });
    expect(p.tool).toBeNull();
    sim.act(p.id, { kind: 'mould', type: 'slope2x2' });
    expect(p.tool).toEqual({ kind: 'mould', type: 'slope2x2' });

    // Hands full: no brick and no bucket while carrying the mould.
    const press = machine(sim, 'press');
    lookAt(sim, p, press.stand, press.target);
    sim.act(p.id, { kind: 'place' });
    expect(p.tool).toBeNull();
    expect(press.m.mould).toBe('slope2x2');
    // No pellets yet: nothing comes out.
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).toBeNull();

    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    // A plain click on the silo does nothing: the colour has to be picked.
    sim.act(p.id, { kind: 'grab' });
    expect(p.tool).toBeNull();
    sim.act(p.id, { kind: 'fill', colour: 'dark-blue' });
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'dark-blue' });
    // Filled again with another colour, the bucket holds that.
    sim.act(p.id, { kind: 'fill', colour: 'lime' });
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'lime' });

    lookAt(sim, p, press.stand, press.target);
    sim.act(p.id, { kind: 'grab' });
    expect(p.tool).toBeNull();
    expect(press.m).toMatchObject({ colour: 'lime', shots: BUCKET_SHOTS });
    sim.events.length = 0;
    sim.act(p.id, { kind: 'grab' });
    expect(heldPart(sim, p)).toMatchObject({ type: 'slope2x2', colour: 'lime' });
    expect(press.m.shots).toBe(BUCKET_SHOTS - 1);
    expect(sim.events.map((e) => e.kind)).toContain('moulded');
  });

  it('runs out of pellets after a bucket', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = loadedPress(sim, '1x1', 'yellow');
    for (let i = 0; i < BUCKET_SHOTS; i++) {
      lookAt(sim, p, press.stand, press.target);
      sim.act(p.id, { kind: 'grab' });
      expect(p.holding).not.toBeNull();
      sim.act(p.id, { kind: 'drop' });
      settle(sim, 2);
    }
    expect(press.m).toMatchObject({ colour: null, shots: 0, mould: '1x1' });
    lookAt(sim, p, press.stand, press.target);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).toBeNull();
  });

  it('puts a mould or bucket away, and swaps one mould for another at the dispenser', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    takeMould(sim, p, '2x4');
    sim.act(p.id, { kind: 'mould', type: 'plate1x1' });
    expect(p.tool).toEqual({ kind: 'mould', type: 'plate1x1' });
    // Back into the dispenser.
    sim.act(p.id, { kind: 'place' });
    expect(p.tool).toBeNull();

    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    sim.act(p.id, { kind: 'fill', colour: 'red' });
    sim.act(p.id, { kind: 'drop' });
    expect(p.tool).toBeNull();
    expect(sim.events.map((e) => e.kind)).toContain('toolDown');
  });

  it('only hands out a mould at the dispenser, for a part it makes', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    sim.act(p.id, { kind: 'mould', type: '2x4' });
    expect(p.tool).toBeNull();
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    for (const type of ['baseplate16', 'no-such-part', 7, null, '__proto__']) {
      sim.act(p.id, { kind: 'mould', type } as never);
      expect(p.tool).toBeNull();
    }
    // Nor with a bucket in hand.
    lookAt(sim, p, silo.stand, silo.target);
    sim.act(p.id, { kind: 'fill', colour: 'red' });
    lookAt(sim, p, dispenser.stand, dispenser.target);
    sim.act(p.id, { kind: 'mould', type: '2x4' });
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'red' });
  });

  it('only fills a bucket at the silo, in a colour it has', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = machine(sim, 'press');
    lookAt(sim, p, press.stand, press.target);
    sim.act(p.id, { kind: 'fill', colour: 'red' });
    expect(p.tool).toBeNull();
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    for (const colour of ['baseplate-green', 'gold-leaf', 7, null]) {
      sim.act(p.id, { kind: 'fill', colour } as never);
      expect(p.tool).toBeNull();
    }
    // Nor with a brick in hand.
    const loaded = loadedPress(sim);
    lookAt(sim, p, loaded.stand, loaded.target);
    sim.act(p.id, { kind: 'grab' });
    lookAt(sim, p, silo.stand, silo.target);
    sim.act(p.id, { kind: 'fill', colour: 'red' });
    expect(p.tool).toBeNull();
  });

  it("prints one of the round's pictures on a part, and only on a part of its type", () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    sim.loadPrints(MANGA_SHOP);
    expect(sim.level.svgs).toBe(MANGA_SHOP.svgs);
    const jobs = sim.printJobs;
    const sign = jobs.findIndex((j) => j.type === 'tile1x4' && j.prints.top === 'manga-shop');
    expect(sign).toBeGreaterThanOrEqual(0);
    const other = jobs.findIndex((j) => j.type !== 'tile1x4');
    expect(other).toBeGreaterThanOrEqual(0);

    const press = loadedPress(sim, 'tile1x4', 'black');
    lookAt(sim, p, press.stand, press.target);
    sim.act(p.id, { kind: 'grab' });
    const printer = machine(sim, 'printer');
    lookAt(sim, p, printer.stand, printer.target);
    sim.act(p.id, { kind: 'place' });
    expect(p.holding).toBeNull();
    expect(printer.m.part).toEqual({ type: 'tile1x4', colour: 'black' });

    // A print for another part, or one that does not exist, does nothing.
    for (const job of [other, jobs.length, 1.5, -2]) {
      sim.act(p.id, { kind: 'print', job });
      expect(p.holding).toBeNull();
      expect(printer.m.part).not.toBeNull();
    }
    sim.act(p.id, { kind: 'print', job: sign });
    expect(printer.m.part).toBeNull();
    const tile = heldPart(sim, p);
    expect(tile).toMatchObject({ type: 'tile1x4', colour: 'black', prints: { top: 'manga-shop' } });
    // It goes over the wire with its print.
    const held = sim.assemblies.get(p.holding!.assemblyId)!;
    expect(bricksOf(assemblyState(held))[0]!.prints).toEqual({ top: 'manga-shop' });

    // Back on the bed and out again unprinted: it keeps the print it has.
    sim.act(p.id, { kind: 'place' });
    sim.act(p.id, { kind: 'grab' });
    expect(heldPart(sim, p).prints).toEqual({ top: 'manga-shop' });
  });

  it('keeps the reader and the other team away from the machines', () => {
    const sim = new Sim(RAPIER, rivalLevel(HOUSE));
    const p = sim.addPlayer();
    settle(sim);
    p.team = 0;
    const theirs = loadedPress(sim, '2x4', 'red', 1);
    lookAt(sim, p, theirs.stand, theirs.target);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).toBeNull();
    const silo = machine(sim, 'silo', 1);
    lookAt(sim, p, silo.stand, silo.target);
    sim.act(p.id, { kind: 'fill', colour: 'red' });
    expect(p.tool).toBeNull();

    const theirDispenser = machine(sim, 'dispenser', 1);
    lookAt(sim, p, theirDispenser.stand, theirDispenser.target);
    sim.act(p.id, { kind: 'mould', type: '2x4' });
    expect(p.tool).toBeNull();

    p.handsOff = true;
    const ourDispenser = machine(sim, 'dispenser', 0);
    lookAt(sim, p, ourDispenser.stand, ourDispenser.target);
    sim.act(p.id, { kind: 'mould', type: '2x4' });
    expect(p.tool).toBeNull();
    const ours = loadedPress(sim, '2x4', 'red', 0);
    lookAt(sim, p, ours.stand, ours.target);
    sim.act(p.id, { kind: 'grab' });
    expect(p.holding).toBeNull();
    const ourSilo = machine(sim, 'silo', 0);
    lookAt(sim, p, ourSilo.stand, ourSilo.target);
    sim.act(p.id, { kind: 'fill', colour: 'red' });
    expect(p.tool).toBeNull();
  });

  it('tells clients what is in the machines and who carries what', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = loadedPress(sim, '2x2', 'blue');
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    const before = sim.furnitureVersion;
    sim.act(p.id, { kind: 'fill', colour: 'teal' });
    expect(sim.furnitureVersion).toBeGreaterThan(before);
    const works = sim.brickWorks();

    const replica = new Sim(RAPIER, HOUSE, 1, { replica: true });
    replica.replicaFurniture([], { on: true, fixer: null }, [], works);
    expect(replica.machines.get(press.m.def.id)).toMatchObject({ mould: '2x2', colour: 'blue' });
    // A player the client hears of only later still shows what they carry.
    const late = replica.addPlayer({ id: p.id, replicated: true });
    expect(late.tool).toEqual({ kind: 'bucket', colour: 'teal' });
  });
});
