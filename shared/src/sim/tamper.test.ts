import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_LIGHTHOUSE as LIGHTHOUSE } from '../builds/testing.ts';
import { BASEMENT_FLOOR, HOUSE } from '../content/house.ts';
import { COOLDOWNS, MACHINE_BREAKS_AFTER, Round, WITNESS_RANGE } from '../round.ts';
import { Sim, UNJAM_SECONDS } from './sim.ts';
import type { Action, Player } from './sim.ts';
import { awaitHandout, loadedPress, machine } from './testing.ts';
import type { Vec3 } from '../math.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const settle = (sim: Sim, ticks = 60) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

const act = (sim: Sim, p: Player, action: Action) => {
  sim.act(p.id, action);
  awaitHandout(sim, p.id);
};

/** Teleports the player and points a first-person view at `target`. */
function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  p.body.setTranslation({ x: standAt.x, y: standAt.y + 0.86, z: standAt.z }, true);
  for (let i = 0; i < 3; i++) sim.step();
  const eye = sim.eye(p);
  p.input.firstPerson = true;
  p.input.yaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
  p.input.pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
}

function game() {
  const sim = new Sim(RAPIER, HOUSE);
  const ids = Array.from(
    { length: 4 },
    (_, i) => sim.addPlayer({ spawn: { x: i - 2, y: 0, z: 4 } }).id,
  );
  const round = new Round(sim, LIGHTHOUSE, { seconds: 300, seed: 3, players: ids, saboteurs: 1 });
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      round.update();
    }
  };
  run(20);
  sim.events = [];
  const saboteur = ids.find((id) => round.role(id) === 'saboteur')!;
  const builder = ids.find((id) => round.role(id) === 'builder')!;
  return { sim, round, run, saboteur, builder };
}

describe('the brick works without power', () => {
  it('makes, fills, hands out and prints nothing until the panel is fixed', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    sim.breakPower();
    expect(sim.machinesPowered).toBe(false);

    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'mould', type: '2x4' });
    expect(p.tool).toBeNull();

    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    expect(p.tool).toBeNull();

    const press = loadedPress(sim, '2x4', 'red');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(p.holding).toBeNull();

    // The lights come back on, and the machines with them.
    sim.restorePower();
    act(sim, p, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
  });

  it('keeps the brick works running in a gear hunt, where the panel is dead for good', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    sim.hazards.add('headlamp');
    sim.breakPower();
    expect(sim.machinesPowered).toBe(true);
    const press = loadedPress(sim, '2x4', 'red');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(p.holding).not.toBeNull();
  });
});

describe('tampering', () => {
  it('jams a machine until a builder stays at it long enough to clear the jam', () => {
    const { sim, round, run, saboteur, builder } = game();
    const press = loadedPress(sim, '2x4', 'red');
    const s = sim.players.get(saboteur)!;
    const b = sim.players.get(builder)!;

    // Builders have no such tool.
    lookAt(sim, b, press.stand, press.target);
    expect(round.sabotage(builder, 'tamper')).toBe(false);
    b.body.setTranslation({ x: 1, y: 0.86, z: 4 }, true);

    lookAt(sim, s, press.stand, press.target);
    sim.events = [];
    expect(round.sabotage(saboteur, 'tamper')).toBe(true);
    expect(press.m.jammed).toBe(true);
    // A tell, for those close enough to see it.
    const tell = sim.events.find((e) => e.kind === 'tamper');
    expect(tell).toMatchObject({ playerId: saboteur, witnessRange: WITNESS_RANGE });
    expect(round.cooldown(saboteur, 'tamper')).toBe(COOLDOWNS.tamper);
    s.body.setTranslation({ x: 0, y: 0.86, z: 4 }, true);

    // Jammed, it makes nothing: a click sets about clearing it instead.
    lookAt(sim, b, press.stand, press.target);
    sim.act(b.id, { kind: 'grab' });
    awaitHandout(sim, b.id);
    expect(b.holding).toBeNull();
    expect(press.m.fixer).toBe(b.id);
    // Walking off halfway leaves it jammed.
    run(Math.round((UNJAM_SECONDS / 2) * 60));
    b.body.setTranslation({ x: 0, y: 0.86, z: 4 }, true);
    run(5);
    expect(press.m.fixer).toBeNull();
    expect(press.m.jammed).toBe(true);

    lookAt(sim, b, press.stand, press.target);
    sim.act(b.id, { kind: 'grab' });
    sim.events = [];
    let cleared = false;
    for (let i = 0; i < UNJAM_SECONDS * 60 + 5; i++) {
      sim.step();
      cleared ||= sim.events.some((e) => e.kind === 'unjammed' && e.playerId === b.id);
    }
    expect(cleared).toBe(true);
    expect(press.m).toMatchObject({ jammed: false, fixer: null, progress: 0 });
    // And it works again, with what was in it.
    act(sim, b, { kind: 'grab' });
    expect(b.holding).not.toBeNull();
  });

  it('cuts the power at the electrical panel, which stops the machines too', () => {
    const { sim, round, run, saboteur } = game();
    const s = sim.players.get(saboteur)!;
    const panel = sim.panel!;
    const box = HOUSE.boxes.find((x) => x.model === 'panel')!;
    lookAt(sim, s, { x: box.pos.x, y: BASEMENT_FLOOR, z: box.pos.z - 0.9 }, panel);
    expect(sim.aim(s)?.owner).toEqual({ kind: 'panel' });
    sim.events = [];
    expect(round.sabotage(saboteur, 'tamper')).toBe(true);
    expect(sim.power.on).toBe(false);
    expect(sim.machinesPowered).toBe(false);
    expect(sim.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['powerOut', 'tamper']));
    // Out already: nothing more to cut.
    run(COOLDOWNS.tamper * 60 + 5);
    expect(round.sabotage(saboteur, 'tamper')).toBe(false);
  });

  it('has a machine break down by itself every three to five minutes, with no tell', () => {
    const { sim, round } = game();
    const breaks: number[] = [];
    let t = 0;
    for (let i = 0; i < 9 * 60 * 60 && round.phase === 'building'; i++) {
      sim.step();
      round.update();
      t += 1 / 60;
      for (const e of sim.events) {
        if (e.kind !== 'breakdown') continue;
        breaks.push(t);
        expect(e.playerId).toBeUndefined();
        expect(e.witnessRange).toBeUndefined();
        expect(sim.machines.get(e.machineId!)!.jammed).toBe(true);
        t = 0;
      }
      sim.events = [];
    }
    expect(breaks.length).toBeGreaterThanOrEqual(1);
    for (const gap of breaks) {
      expect(gap).toBeGreaterThanOrEqual(MACHINE_BREAKS_AFTER.min - 0.1);
      expect(gap).toBeLessThanOrEqual(MACHINE_BREAKS_AFTER.max + 0.1);
    }
  });

  it('tells clients which machines are jammed and who is clearing them', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim, 5);
    const press = machine(sim, 'press');
    Object.assign(press.m, { jammed: true, fixer: p.id });
    const replica = new Sim(RAPIER, HOUSE, 1, { replica: true });
    replica.replicaFurniture([], { on: true, fixer: null }, [], sim.brickWorks());
    expect(replica.machines.get(press.m.def.id)).toMatchObject({ jammed: true, fixer: p.id });
  });
});
