import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { HOUSE, OUTPUT_ROOM, machineFront, machineOutputs } from '../content/house.ts';
import { rivalLevel } from '../content/rival.ts';
import { MANGA_SHOP } from '../builds/mangashop.ts';
import { assemblyState, bricksOf } from '../net/protocol.ts';
import { BUCKET_SHOTS, MAKE_TICKS, Sim, UNJAM_SECONDS, WORK_TICKS, cameraPosition } from './sim.ts';
import type { Action, Player } from './sim.ts';
import { aimAt, awaitMachine, finishWork, loadedPress, machine, takeOut } from './testing.ts';
import { ACT_STAND, ACT_TIMES, actStation } from './operate.ts';
import { seconds } from './time.ts';
import { add, rotate, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import type { BrickTypeId } from '../bricks.ts';

beforeAll(async () => {
  await RAPIER.init();
});

const settle = (sim: Sim, ticks = 60) => {
  for (let i = 0; i < ticks; i++) sim.step();
};

const act = (sim: Sim, p: Player, action: Action) => sim.act(p.id, action);

/** Teleports the player and points a first-person view at `target`. */
function lookAt(sim: Sim, p: Player, standAt: Vec3, target: Vec3) {
  // Ending whatever they were at, as the game's teleports do.
  p.work = null;
  p.body.setTranslation({ x: standAt.x, y: 0.86, z: standAt.z }, true);
  const held = p.holding && sim.assemblies.get(p.holding.assemblyId);
  held?.body.setTranslation({ x: standAt.x, y: 1.4, z: standAt.z - 0.6 }, true);
  settle(sim, 2);
  aimAt(sim, p, target);
}

/** Has the dispenser drop the mould for a part in its hatch, and takes it out. */
function takeMould(sim: Sim, p: Player, type: BrickTypeId) {
  const dispenser = machine(sim, 'dispenser');
  lookAt(sim, p, dispenser.stand, dispenser.target);
  act(sim, p, { kind: 'mould', type });
  takeOut(sim, p, dispenser);
}

/**
 * Points the player's third-person view (the default) so the crosshair, seen from the camera
 * over their shoulder, lies on `target`. The camera moves with the view, so a few rounds.
 */
function aimFromBehind(sim: Sim, p: Player, target: Vec3) {
  p.input.firstPerson = false;
  let from = sim.eye(p);
  for (let k = 0; k < 30; k++) {
    p.input.yaw = Math.atan2(-(target.x - from.x), -(target.z - from.z));
    p.input.pitch = Math.atan2(target.y - from.y, Math.hypot(target.x - from.x, target.z - from.z));
    from = cameraPosition(sim.eye(p), p.input);
  }
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
    act(sim, p, { kind: 'grab' });
    expect(dispenser.m.making).toBeNull();
    // The mould drops into the hatch, not into the hands: whoever picked it stands by till it is
    // there, and takes it out.
    act(sim, p, { kind: 'mould', type: 'slope2x2' });
    expect(dispenser.m.making).toMatchObject({ made: { kind: 'mould', type: 'slope2x2' } });
    expect(p.tool).toBeNull();
    expect(takeOut(sim, p, dispenser)).toBe(true);
    expect(p.tool).toEqual({ kind: 'mould', type: 'slope2x2' });
    expect(dispenser.m.out).toEqual([null]);

    const press = machine(sim, 'press');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'place' });
    expect(p.tool).toBeNull();
    expect(press.m.mould).toBe('slope2x2');
    // No pellets yet: it makes nothing.
    act(sim, p, { kind: 'grab' });
    expect(press.m.making).toBeNull();

    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    // A plain click on the silo does nothing: the colour has to be picked.
    act(sim, p, { kind: 'grab' });
    expect(silo.m.making).toBeNull();
    act(sim, p, { kind: 'fill', colour: 'dark-blue' });
    expect(p.tool).toBeNull();
    expect(silo.m.making).toMatchObject({ made: { kind: 'bucket', colour: 'dark-blue' } });
    takeOut(sim, p, silo);
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'dark-blue' });
    // Another colour, taken with a bucket in hand: that bucket takes the place of the first.
    act(sim, p, { kind: 'fill', colour: 'lime' });
    takeOut(sim, p, silo);
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'lime' });
    expect(silo.m.out).toEqual([null]);

    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(p.tool).toBeNull();
    expect(press.m).toMatchObject({ colour: 'lime', shots: BUCKET_SHOTS });
    sim.events.length = 0;
    act(sim, p, { kind: 'grab' });
    expect(press.m.shots).toBe(BUCKET_SHOTS - 1);
    expect(sim.events.map((e) => e.kind)).toContain('moulded');
    expect(p.holding).toBeNull();
    expect(press.m.making?.made).toEqual({ kind: 'part', type: 'slope2x2', colour: 'lime' });
    takeOut(sim, p, press);
    expect(heldPart(sim, p)).toMatchObject({ type: 'slope2x2', colour: 'lime' });
    expect(press.m.out).toEqual([null]);
  });

  it('says which mould and colour each step was, and where it goes, for the machines to show', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const seen = () => {
      const e = sim.events.filter((e) => e.machineId !== undefined);
      sim.events.length = 0;
      return e.map(({ kind, mould, colour, slot }) => ({ kind, mould, colour, slot }));
    };
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'mould', type: 'slope2x2' });
    expect(seen()).toEqual([{ kind: 'dispense', mould: 'slope2x2', colour: undefined, slot: 0 }]);
    // Made, and taken out by whoever stands by for it.
    awaitMachine(sim, dispenser.m);
    expect(seen()).toEqual([
      { kind: 'ready', mould: 'slope2x2', colour: undefined, slot: 0 },
      { kind: 'toolUp', mould: 'slope2x2', colour: undefined, slot: 0 },
    ]);
    expect(p.tool).toEqual({ kind: 'mould', type: 'slope2x2' });
    const press = machine(sim, 'press');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'place' });
    expect(seen()).toEqual([
      { kind: 'mouldIn', mould: 'slope2x2', colour: undefined, slot: undefined },
    ]);
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'lime' });
    expect(seen()).toEqual([{ kind: 'fill', mould: undefined, colour: 'lime', slot: 0 }]);
    takeOut(sim, p, silo);
    expect(seen()).toEqual([
      { kind: 'ready', mould: undefined, colour: 'lime', slot: 0 },
      { kind: 'toolUp', mould: undefined, colour: 'lime', slot: 0 },
    ]);
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(seen()).toEqual([{ kind: 'pour', mould: undefined, colour: 'lime', slot: undefined }]);
    act(sim, p, { kind: 'grab' });
    expect(seen()).toEqual([{ kind: 'moulded', mould: 'slope2x2', colour: 'lime', slot: 0 }]);
    awaitMachine(sim, press.m);
    expect(seen()).toEqual([{ kind: 'ready', mould: 'slope2x2', colour: 'lime', slot: 0 }]);
  });

  it('leaves what it made in its output area for anyone, if whoever asked for it is not by it', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    const q = sim.addPlayer();
    settle(sim);
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    // The one who asked for it is taken off elsewhere while the silo works.
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'mould', type: '2x2' });
    lookAt(sim, p, add(silo.stand, v3(0, 0, 3)), silo.target);
    expect(dispenser.m.making).not.toBeNull();
    expect(silo.m.making).not.toBeNull();
    // It waits on the grate however long nobody takes it.
    settle(sim, MAKE_TICKS.bucket + 600);
    expect(silo.m.out).toEqual([{ kind: 'bucket', colour: 'red' }]);
    expect(p.tool).toBeNull();
    // Someone else may take it.
    lookAt(sim, q, silo.stand, silo.target);
    expect(takeOut(sim, q, silo)).toBe(true);
    expect(q.tool).toEqual({ kind: 'bucket', colour: 'red' });
    expect(silo.m.out).toEqual([null]);
    // Nothing is left to take.
    lookAt(sim, p, silo.stand, silo.outs[0]!);
    act(sim, p, { kind: 'grab' });
    expect(p.tool).toBeNull();
  });

  it('makes one thing at a time, and nothing more while its output area is full', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = loadedPress(sim, '1x1', 'yellow');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    // Busy: a second click while it moulds makes nothing more.
    act(sim, p, { kind: 'grab' });
    expect(press.m.shots).toBe(BUCKET_SHOTS - 1);
    // Its tray holds one part: left there, it makes nothing more, and uses no pellets, till the
    // part is taken out.
    expect(OUTPUT_ROOM.press).toBe(1);
    lookAt(sim, p, press.stand, press.target);
    awaitMachine(sim, press.m);
    const part = { kind: 'part', type: '1x1', colour: 'yellow' };
    expect(press.m.out).toEqual([part]);
    act(sim, p, { kind: 'grab' });
    expect(press.m.making).toBeNull();
    expect(press.m.shots).toBe(BUCKET_SHOTS - 1);
    takeOut(sim, p, press);
    expect(press.m.out).toEqual([null]);
    act(sim, p, { kind: 'drop' });
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(press.m.making).toMatchObject({ slot: 0 });

    // The silo's grate and the dispenser's hatch hold one each.
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    awaitMachine(sim, silo.m);
    act(sim, p, { kind: 'fill', colour: 'blue' });
    expect(silo.m.making).toBeNull();
    expect(silo.m.out).toEqual([{ kind: 'bucket', colour: 'red' }]);
  });

  it('runs out of pellets after a bucket', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = loadedPress(sim, '1x1', 'yellow');
    for (let i = 0; i < BUCKET_SHOTS; i++) {
      lookAt(sim, p, press.stand, press.target);
      act(sim, p, { kind: 'grab' });
      takeOut(sim, p, press);
      expect(p.holding).not.toBeNull();
      act(sim, p, { kind: 'drop' });
      settle(sim, 2);
    }
    expect(press.m).toMatchObject({ colour: null, shots: 0, mould: '1x1' });
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(press.m.making).toBeNull();
    expect(press.m.out).toEqual([null]);
  });

  it('takes a part out only with free hands, and a mould or a bucket in place of its own kind', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    takeOut(sim, p, silo);
    // With a bucket in hand, a mould stays in the hatch.
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'mould', type: '2x4' });
    takeOut(sim, p, dispenser);
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'red' });
    expect(dispenser.m.out).toEqual([{ kind: 'mould', type: '2x4' }]);
    act(sim, p, { kind: 'drop' });
    takeOut(sim, p, dispenser);
    expect(p.tool).toEqual({ kind: 'mould', type: '2x4' });

    // With a mould in hand, or a brick, a part stays in the tray.
    const press = loadedPress(sim, '2x2', 'blue');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    // (The click put the mould in: the press makes its own part.)
    expect(press.m.mould).toBe('2x4');
    act(sim, p, { kind: 'grab' });
    // (Off elsewhere while it moulds, so it waits in the tray.)
    lookAt(sim, p, press.stand, press.target);
    awaitMachine(sim, press.m);
    // A mould in hand: clicking the tray takes nothing.
    takeMould(sim, p, 'plate1x1');
    lookAt(sim, p, press.stand, press.target);
    takeOut(sim, p, press);
    expect(p.holding).toBeNull();
    expect(p.tool).toEqual({ kind: 'mould', type: 'plate1x1' });
    expect(press.m.out[0]).toEqual({ kind: 'part', type: '2x4', colour: 'blue' });
    act(sim, p, { kind: 'drop' });
    // Nor with the vacuum (a click with it sucks, so try the other click too).
    (sim as unknown as { vacuuming: { takeVacuum(p: Player): void } }).vacuuming.takeVacuum(p);
    expect(sim.vacuum.heldBy).toBe(p.id);
    aimAt(sim, p, press.outs[0]!);
    act(sim, p, { kind: 'place' });
    act(sim, p, { kind: 'grab' });
    expect(p.holding).toBeNull();
    expect(press.m.out[0]).toEqual({ kind: 'part', type: '2x4', colour: 'blue' });
    act(sim, p, { kind: 'drop' });
    expect(sim.vacuum.heldBy).toBeNull();
    // A brick in hand: clicking the tray takes nothing, and drops nothing in it either.
    const brick = sim.spawnBrick('1x1', 'red', { x: press.stand.x, y: 1.2, z: press.stand.z });
    sim.carrying.hold(p, brick);
    takeOut(sim, p, press);
    expect(p.holding?.assemblyId).toBe(brick.id);
    expect(press.m.out[0]).toEqual({ kind: 'part', type: '2x4', colour: 'blue' });
    aimAt(sim, p, press.outs[0]!);
    act(sim, p, { kind: 'place' });
    expect(p.holding?.assemblyId).toBe(brick.id);
    expect(press.m.out[0]).not.toBeNull();
    act(sim, p, { kind: 'throw' });
    takeOut(sim, p, press);
    expect(heldPart(sim, p)).toMatchObject({ type: '2x4', colour: 'blue' });
  });

  it('puts a mould or bucket away, and takes back a mould at the dispenser', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    takeMould(sim, p, '2x4');
    takeMould(sim, p, 'plate1x1');
    expect(p.tool).toEqual({ kind: 'mould', type: 'plate1x1' });
    // Back into the dispenser.
    act(sim, p, { kind: 'place' });
    expect(p.tool).toBeNull();

    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    takeOut(sim, p, silo);
    act(sim, p, { kind: 'drop' });
    expect(p.tool).toBeNull();
    expect(sim.events.map((e) => e.kind)).toContain('toolDown');
  });

  it('only drops a mould in the hatch at the dispenser, for a part it makes', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'mould', type: '2x4' });
    expect(silo.m.making).toBeNull();
    const dispenser = machine(sim, 'dispenser');
    expect(dispenser.m.making).toBeNull();
    lookAt(sim, p, dispenser.stand, dispenser.target);
    for (const type of ['baseplate16', 'no-such-part', 7, null, '__proto__']) {
      act(sim, p, { kind: 'mould', type } as never);
      expect(dispenser.m.making).toBeNull();
    }
    // The mould goes in the hatch, not into the hands.
    act(sim, p, { kind: 'mould', type: '2x4' });
    expect(dispenser.m.making).toMatchObject({ made: { kind: 'mould', type: '2x4' } });
  });

  it('only fills a bucket at the silo, in a colour it has', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = machine(sim, 'press');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    const silo = machine(sim, 'silo');
    expect(silo.m.making).toBeNull();
    expect(press.m.making).toBeNull();
    lookAt(sim, p, silo.stand, silo.target);
    for (const colour of ['baseplate-green', 'gold-leaf', 7, null]) {
      act(sim, p, { kind: 'fill', colour } as never);
      expect(silo.m.making).toBeNull();
    }
    act(sim, p, { kind: 'fill', colour: 'red' });
    expect(silo.m.making).toMatchObject({ made: { kind: 'bucket', colour: 'red' } });
  });

  it('takes an order whatever is in hand, and keeps it there', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const brick = sim.spawnBrick('1x1', 'red', { x: 0, y: 1.2, z: 0 });
    sim.carrying.hold(p, brick);
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'mould', type: '2x4' });
    expect(dispenser.m.making).toMatchObject({ made: { kind: 'mould', type: '2x4' } });
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    expect(silo.m.making).toMatchObject({ made: { kind: 'bucket', colour: 'red' } });
    // At a moulding machine a click with a brick in hand is a `place`.
    const press = loadedPress(sim, '2x2', 'blue');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'place' });
    expect(press.m.making).toMatchObject({ made: { kind: 'part', type: '2x2', colour: 'blue' } });
    expect(p.holding?.assemblyId).toBe(brick.id);
  });

  it('lets a click on something already taken do nothing, not work the machine behind it', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    // A double click on a mould in the hatch: the first takes it, the second (which still saw
    // it there) does not put it straight back.
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'mould', type: '2x4' });
    awaitMachine(sim, dispenser.m);
    aimAt(sim, p, dispenser.outs[0]!);
    act(sim, p, { kind: 'grab', output: true });
    act(sim, p, { kind: 'grab', output: true });
    expect(p.tool).toEqual({ kind: 'mould', type: '2x4' });
    expect(dispenser.m.out).toEqual([null]);
    // A click meant for the dispenser itself still puts it back.
    act(sim, p, { kind: 'grab' });
    expect(p.tool).toBeNull();

    // At a moulding machine, the second click of a double click makes nothing more.
    const press = loadedPress(sim, '2x4', 'red');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    awaitMachine(sim, press.m);
    aimAt(sim, p, press.outs[0]!);
    act(sim, p, { kind: 'grab', output: true });
    expect(p.holding).not.toBeNull();
    act(sim, p, { kind: 'place', output: true });
    expect(press.m.making).toBeNull();
    expect(press.m.shots).toBe(BUCKET_SHOTS - 1);
    expect(p.holding).not.toBeNull();
  });

  it('takes the thing under the crosshair, seen over the shoulder or through the eyes', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const at = {
      silo: machine(sim, 'silo'),
      dispenser: machine(sim, 'dispenser'),
      press: loadedPress(sim, '2x4', 'red'),
    };
    lookAt(sim, p, at.silo.stand, at.silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    lookAt(sim, p, at.dispenser.stand, at.dispenser.target);
    act(sim, p, { kind: 'mould', type: '2x2' });
    lookAt(sim, p, at.press.stand, at.press.target);
    act(sim, p, { kind: 'grab' });
    // (Each left where it is made: they are off elsewhere meanwhile.)
    lookAt(sim, p, at.press.stand, at.press.target);
    awaitMachine(sim, at.press.m);
    awaitMachine(sim, at.silo.m);
    awaitMachine(sim, at.dispenser.m);
    // How high above its rest point the middle of each thing is.
    const up = { silo: 0.13, dispenser: 0.05, press: 0.02 };
    for (const kind of ['silo', 'dispenser', 'press'] as const) {
      const { m } = at[kind];
      const turn = yawQuat(m.def.facing);
      const front = machineFront(m.def);
      machineOutputs(m.def).forEach((o, slot) => {
        // Straight in front of the place, near and further off. The press's bay is low in its
        // front, so from right up against it the camera behind sees only the press's top.
        const across = rotate(
          yawQuat(-m.def.facing),
          v3(o.rest.x - front.x, 0, o.rest.z - front.z),
        );
        for (const dist of [1, 1.4, 1.8, 2.2]) {
          const stand = add(front, rotate(turn, v3(across.x, 0, dist)));
          p.body.setTranslation({ x: stand.x, y: 0.86, z: stand.z }, true);
          settle(sim, 2);
          const middle = { ...o.rest, y: o.rest.y + up[kind] };
          for (const view of ['third', 'first']) {
            if (view === 'third') aimFromBehind(sim, p, middle);
            else aimAt(sim, p, middle);
            expect(sim.aim(p)?.owner, `${kind} ${slot} from ${dist} m, ${view} person`).toEqual({
              kind: 'output',
              machineId: m.def.id,
              slot,
            });
          }
        }
      });
    }
    // Aimed at the machine itself, a click is still for the machine.
    lookAt(sim, p, at.press.stand, at.press.target);
    expect(sim.aim(p)?.owner).toEqual({ kind: 'machine', machineId: at.press.m.def.id });
  });

  it('keeps what waits in an output area out of the way of a player walking up to it', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const silo = machine(sim, 'silo');
    const walkUp = () => {
      lookAt(sim, p, silo.stand, silo.target);
      p.input.forward = 1;
      settle(sim, 90);
      p.input.forward = 0;
      return p.body.translation();
    };
    const empty = walkUp();
    act(sim, p, { kind: 'fill', colour: 'red' });
    awaitMachine(sim, silo.m);
    expect(silo.m.out[0]).not.toBeNull();
    const full = walkUp();
    expect(Math.hypot(full.x - empty.x, full.z - empty.z)).toBeLessThan(0.01);
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
    act(sim, p, { kind: 'grab' });
    takeOut(sim, p, press);
    const printer = machine(sim, 'printer');
    lookAt(sim, p, printer.stand, printer.target);
    act(sim, p, { kind: 'place' });
    expect(p.holding).toBeNull();
    expect(printer.m.part).toEqual({ type: 'tile1x4', colour: 'black' });

    // A print for another part, or one that does not exist, does nothing.
    for (const job of [other, jobs.length, 1.5, -2]) {
      act(sim, p, { kind: 'print', job });
      expect(p.holding).toBeNull();
      expect(printer.m.part).not.toBeNull();
    }
    // Printed where it lies on the bed, and taken off once the print is done.
    act(sim, p, { kind: 'print', job: sign });
    expect(printer.m.part).toEqual({
      type: 'tile1x4',
      colour: 'black',
      prints: { top: 'manga-shop' },
    });
    expect(p.holding).toBeNull();
    finishWork(sim, p);
    expect(printer.m.part).toBeNull();
    const tile = heldPart(sim, p);
    expect(tile).toMatchObject({ type: 'tile1x4', colour: 'black', prints: { top: 'manga-shop' } });
    // It goes over the wire with its print.
    const held = sim.assemblies.get(p.holding!.assemblyId)!;
    expect(bricksOf(assemblyState(held))[0]!.prints).toEqual({ top: 'manga-shop' });

    // Back on the bed and out again unprinted: it keeps the print it has.
    lookAt(sim, p, printer.stand, printer.target);
    act(sim, p, { kind: 'place' });
    act(sim, p, { kind: 'grab' });
    expect(heldPart(sim, p).prints).toEqual({ top: 'manga-shop' });
  });

  it('keeps the reader and the other team away from the machines and what they made', () => {
    const sim = new Sim(RAPIER, rivalLevel(HOUSE));
    const p = sim.addPlayer();
    const them = sim.addPlayer();
    settle(sim);
    p.team = 0;
    them.team = 1;
    const theirs = loadedPress(sim, '2x4', 'red', 1);
    lookAt(sim, p, theirs.stand, theirs.target);
    act(sim, p, { kind: 'grab' });
    expect(theirs.m.making).toBeNull();
    const silo = machine(sim, 'silo', 1);
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    expect(silo.m.making).toBeNull();

    const theirDispenser = machine(sim, 'dispenser', 1);
    lookAt(sim, p, theirDispenser.stand, theirDispenser.target);
    act(sim, p, { kind: 'mould', type: '2x4' });
    expect(theirDispenser.m.making).toBeNull();
    // What their machines made is theirs to take.
    lookAt(sim, them, theirs.stand, theirs.target);
    act(sim, them, { kind: 'grab' });
    sim.teleportPlayer(them, v3(theirs.stand.x + 3, 0, theirs.stand.z + 3));
    awaitMachine(sim, theirs.m);
    lookAt(sim, p, theirs.stand, theirs.target);
    takeOut(sim, p, theirs);
    expect(p.holding).toBeNull();
    expect(theirs.m.out[0]).not.toBeNull();

    p.handsOff = true;
    const ourDispenser = machine(sim, 'dispenser', 0);
    lookAt(sim, p, ourDispenser.stand, ourDispenser.target);
    act(sim, p, { kind: 'mould', type: '2x4' });
    expect(ourDispenser.m.making).toBeNull();
    const ours = loadedPress(sim, '2x4', 'red', 0);
    lookAt(sim, p, ours.stand, ours.target);
    act(sim, p, { kind: 'grab' });
    expect(ours.m.making).toBeNull();
    const ourSilo = machine(sim, 'silo', 0);
    lookAt(sim, p, ourSilo.stand, ourSilo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    expect(ourSilo.m.making).toBeNull();
    // Nor does the reader take anything out.
    p.handsOff = false;
    act(sim, p, { kind: 'fill', colour: 'red' });
    p.handsOff = true;
    takeOut(sim, p, ourSilo);
    expect(p.tool).toBeNull();
    expect(ourSilo.m.out).toEqual([{ kind: 'bucket', colour: 'red' }]);
  });

  it('finishes what it was making when it jams, and what it made can still be taken', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = loadedPress(sim, '2x4', 'red');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(sim.sabotage.breakMachine(press.m.def.id)).toBe(true);
    // It still comes out, for whoever stands by for it.
    expect(takeOut(sim, p, press)).toBe(true);
    expect(heldPart(sim, p)).toMatchObject({ type: '2x4', colour: 'red' });
    // Jammed, it makes nothing more: a click sets about clearing the jam.
    act(sim, p, { kind: 'drop' });
    act(sim, p, { kind: 'grab' });
    expect(press.m.making).toBeNull();
    expect(press.m.fixer).toBe(p.id);
  });

  it('tells clients what is in the machines, what waits to be taken and who carries what', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const q = sim.addPlayer();
    settle(sim);
    const press = loadedPress(sim, '2x2', 'blue');
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    // (Off elsewhere while it is made, so it waits in the tray.)
    lookAt(sim, p, press.stand, press.target);
    awaitMachine(sim, press.m);
    // Someone else fills a bucket at the silo and takes it, while the dispenser makes a mould.
    const silo = machine(sim, 'silo');
    lookAt(sim, q, silo.stand, silo.target);
    const before = sim.furnitureVersion;
    act(sim, q, { kind: 'fill', colour: 'teal' });
    expect(sim.furnitureVersion).toBeGreaterThan(before);
    takeOut(sim, q, silo);
    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'mould', type: '1x2' });
    const told = sim.replication.furnitureState();

    const replica = new Sim(RAPIER, HOUSE, 1, { replica: true });
    replica.replication.replicaFurniture(told);
    const part = { kind: 'part', type: '2x2', colour: 'blue' };
    expect(replica.machines.get(press.m.def.id)).toMatchObject({
      mould: '2x2',
      colour: 'blue',
      out: [part],
      making: null,
    });
    expect(replica.machines.get(dispenser.m.def.id)).toMatchObject({
      making: { made: { kind: 'mould', type: '1x2' }, slot: 0 },
    });
    // A player the client hears of only later still shows what they carry.
    const late = replica.addPlayer({ id: q.id, replicated: true });
    expect(late.tool).toEqual({ kind: 'bucket', colour: 'teal' });
    // Its aim finds the part waiting in the tray.
    const me = replica.addPlayer();
    me.body.setTranslation({ x: press.stand.x, y: 0.86, z: press.stand.z }, true);
    replica.step();
    aimAt(replica, me, press.outs[0]!);
    expect(replica.aim(me)?.owner).toEqual({ kind: 'output', machineId: press.m.def.id, slot: 0 });
    // Once it is taken, the tray is empty there too.
    replica.replication.replicaFurniture({
      ...told,
      machines: told.machines.map((m) =>
        m[0] === press.m.def.id ? [...m.slice(0, 7), [null], null] : m,
      ) as typeof told.machines,
    });
    aimAt(replica, me, press.outs[0]!);
    expect(replica.aim(me)?.owner.kind).not.toBe('output');
  });

  it('keeps each place in an output area inside the machine but for a lip out of its front', () => {
    for (const def of HOUSE.machines) {
      const outs = machineOutputs(def);
      expect(outs).toHaveLength(OUTPUT_ROOM[def.kind]);
      for (const o of outs) {
        const local = (v: Vec3) => {
          const d = { x: v.x - def.pos.x, z: v.z - def.pos.z };
          const c = Math.cos(def.facing);
          const s = Math.sin(def.facing);
          return { x: c * d.x - s * d.z, y: v.y - def.pos.y, z: s * d.x + c * d.z };
        };
        const rest = local(o.rest);
        const aim = local(o.aim);
        expect(Math.abs(rest.x)).toBeLessThan(def.size.x / 2);
        expect(rest.z).toBeLessThan(def.size.z / 2);
        expect(rest.y).toBeGreaterThan(0);
        expect(aim.z).toBeGreaterThan(def.size.z / 2);
        expect(aim.z).toBeLessThan(def.size.z / 2 + 0.1);
      }
    }
  });
});

describe('working a machine', () => {
  it('walks the player up to their station for what they do, works it a while, and lets them go', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = machine(sim, 'press');
    // From further back than they stand to work it.
    const turn = yawQuat(press.m.def.facing);
    const back = add(press.stand, rotate(turn, v3(0, 0, 0.8)));
    lookAt(sim, p, back, press.target);
    p.tool = { kind: 'mould', type: '2x4' };
    act(sim, p, { kind: 'grab' });
    expect(press.m.mould).toBe('2x4');
    const work = p.work!;
    expect(work).toMatchObject({ machineId: press.m.def.id, act: 'mould', there: false });
    // Before the mould's place, out from the machine's front.
    const station = add(
      press.m.def.pos,
      rotate(turn, v3(actStation('press', 'mould')!, 0, press.m.def.size.z / 2 + ACT_STAND)),
    );
    expect(Math.hypot(work.spot.x - station.x, work.spot.z - station.z)).toBeLessThan(1e-6);
    const off = () => {
      const at = p.body.translation();
      return Math.hypot(at.x - work.spot.x, at.z - work.spot.z);
    };
    const from = off();
    expect(from).toBeGreaterThan(0.5);
    settle(sim, 90);
    expect(p.work?.there).toBe(true);
    expect(off()).toBeLessThan(0.15);
    settle(sim, seconds(ACT_TIMES.mould.seconds));
    expect(p.work).toBeNull();
  });

  it('begins what it makes only once their hands have set it going', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const silo = machine(sim, 'silo');
    const turn = yawQuat(silo.m.def.facing);
    lookAt(sim, p, add(silo.stand, rotate(turn, v3(0.6, 0, 0.6))), silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    expect(p.work).toMatchObject({ act: 'fill', there: false });
    const ordered = sim.tick;
    while (!p.work?.there) sim.step();
    const walked = sim.tick - ordered;
    expect(walked).toBeGreaterThan(5);
    // Done as long after they set the bucket under the tap as it takes to fill.
    const done = ordered + walked + seconds(ACT_TIMES.fill.lead) + MAKE_TICKS.bucket;
    expect(Math.abs(silo.m.making!.at - done)).toBeLessThanOrEqual(1);
    awaitMachine(sim, silo.m);
    expect(Math.abs(sim.tick - done)).toBeLessThanOrEqual(1);
    // Taking it out, once their hands are done, is an act of its own, from its place.
    while (p.work?.act === 'fill') sim.step();
    expect(p.work).toMatchObject({ act: 'take', slot: 0 });
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'red' });
  });

  it('keeps them at a jammed machine till its jam is cleared', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = machine(sim, 'press');
    sim.sabotage.breakMachine(press.m.def.id);
    lookAt(sim, p, press.stand, press.target);
    act(sim, p, { kind: 'grab' });
    expect(press.m.fixer).toBe(p.id);
    settle(sim, WORK_TICKS + 10);
    expect(p.work).not.toBeNull();
    settle(sim, UNJAM_SECONDS * 60);
    expect(press.m.jammed).toBe(false);
    settle(sim, 2);
    expect(p.work).toBeNull();
  });

  it('keeps them at the machine till they are done, whatever they press', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    const press = machine(sim, 'press');
    lookAt(sim, p, press.stand, press.target);
    p.tool = { kind: 'bucket', colour: 'red' };
    act(sim, p, { kind: 'grab' });
    expect(p.work).toMatchObject({ act: 'pour' });
    while (!p.work?.there) sim.step();
    const at = p.body.translation();
    // Walking off, jumping and running all do nothing till the pour is done.
    Object.assign(p.input, { forward: -1, right: 1, jump: true, sprint: true });
    settle(sim, 30);
    expect(p.work).toMatchObject({ act: 'pour' });
    const still = p.body.translation();
    expect(Math.hypot(still.x - at.x, still.z - at.z)).toBeLessThan(0.02);
    // Done, they go.
    settle(sim, seconds(ACT_TIMES.pour.seconds));
    expect(p.work).toBeNull();
    settle(sim, 10);
    const gone = p.body.translation();
    expect(Math.hypot(gone.x - at.x, gone.z - at.z)).toBeGreaterThan(0.3);
    Object.assign(p.input, { forward: 0, right: 0, jump: false, sprint: false });
  });

  it('stands by what they set it making, and takes it out once it is made', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    /** Steps till they are done at the machine, and says what they did there in turn. */
    const through = (): string[] => {
      const acts: string[] = [];
      for (let k = 0; k < 20 * 60 && p.work; k++) {
        if (acts.at(-1) !== p.work.act) acts.push(p.work.act);
        sim.step();
      }
      return acts;
    };
    const silo = machine(sim, 'silo');
    lookAt(sim, p, silo.stand, silo.target);
    act(sim, p, { kind: 'fill', colour: 'red' });
    expect(through()).toEqual(['fill', 'take']);
    expect(p.tool).toEqual({ kind: 'bucket', colour: 'red' });
    expect(silo.m.out).toEqual([null]);

    const dispenser = machine(sim, 'dispenser');
    lookAt(sim, p, dispenser.stand, dispenser.target);
    act(sim, p, { kind: 'drop' });
    act(sim, p, { kind: 'mould', type: '2x2' });
    expect(through()).toEqual(['start', 'wait', 'take']);
    expect(p.tool).toEqual({ kind: 'mould', type: '2x2' });
    expect(dispenser.m.out).toEqual([null]);

    const press = loadedPress(sim, '1x1', 'yellow');
    lookAt(sim, p, press.stand, press.target);
    p.tool = null;
    act(sim, p, { kind: 'grab' });
    expect(p.work).toMatchObject({ act: 'start' });
    expect(through()).toEqual(['start', 'wait', 'take']);
    expect(heldPart(sim, p)).toMatchObject({ type: '1x1', colour: 'yellow' });
    expect(press.m.out).toEqual([null]);

    // With their hands full of something else, it waits in the tray for anyone.
    aimAt(sim, p, press.target);
    act(sim, p, { kind: 'grab' });
    expect(through()).toEqual(['start', 'wait']);
    expect(press.m.out).toEqual([{ kind: 'part', type: '1x1', colour: 'yellow' }]);
  });

  it('prints on the part where it lies on the bed, and hands it over once printed', () => {
    const sim = new Sim(RAPIER, HOUSE);
    const p = sim.addPlayer();
    settle(sim);
    sim.loadPrints(MANGA_SHOP);
    const sign = sim.printJobs.findIndex((j) => j.type === 'tile1x4');
    const printer = machine(sim, 'printer');
    printer.m.part = { type: 'tile1x4', colour: 'black' };
    lookAt(sim, p, printer.stand, printer.target);
    act(sim, p, { kind: 'print', job: sign });
    // On the bed, printed on, till the print is done.
    expect(p.work).toMatchObject({ act: 'print' });
    expect(printer.m.part).toMatchObject({ prints: sim.printJobs[sign]!.prints });
    expect(printer.m.making).toMatchObject({ slot: -1 });
    expect(p.holding).toBeNull();
    // Nobody takes it off meanwhile.
    const q = sim.addPlayer();
    lookAt(sim, q, printer.stand, printer.target);
    act(sim, q, { kind: 'grab' });
    expect(q.holding).toBeNull();
    while (p.work?.act !== 'take') {
      expect(printer.m.part).not.toBeNull();
      sim.step();
    }
    expect(printer.m.part).toBeNull();
    expect(heldPart(sim, p)).toMatchObject({ type: 'tile1x4', prints: { top: 'manga-shop' } });
  });
});
