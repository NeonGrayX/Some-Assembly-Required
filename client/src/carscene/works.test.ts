import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MachineKind, MachineState } from '@sar/shared';
import type { MachinePicker } from '../ui/machinePicker.ts';
import { buildCarScene } from './scene.ts';
import { BrickWorksPlay } from './works.ts';

// The map is slow to build: one for every test, each with brick works of its own on it.
let map: ReturnType<typeof buildCarScene>;
beforeAll(async () => {
  await RAPIER.init();
  map = buildCarScene();
}, 120_000);

/** The brick works of a fresh car test map, working, and what it draws into. */
function works() {
  const scene = map;
  const hands = new THREE.Group();
  const play = new BrickWorksPlay(RAPIER, scene.machines, scene.root, hands);
  // Drawn once, as the first frame does.
  play.update(0, new THREE.Vector3(), null);
  const picker = { openColours: vi.fn(), openMoulds: vi.fn(), openPrints: vi.fn() };
  const machine = (kind: MachineKind): MachineState =>
    [...play.sim.machines.values()].find((m) => m.def.kind === kind)!;
  const model = (kind: MachineKind) => scene.machines.getObjectByName(kind)!;
  /** Where to stand before a machine: 1.1 m out from the middle of its front. */
  const before = (kind: MachineKind) =>
    model(kind).localToWorld(new THREE.Vector3(0, 0, MACHINE_FRONT[kind] + 1.1));
  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 100);
  /** Stands at `feet` a moment, the camera behind their head looking at `target`. */
  const look = (feet: THREE.Vector3, target: THREE.Vector3, seconds = 1 / 30) => {
    const head = feet.clone().setY(feet.y + 1.55);
    const dir = target.clone().sub(head).normalize();
    camera.position.copy(head).addScaledVector(dir, -3);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    for (let t = 0; t < seconds; t += 1 / 30) play.update(1 / 30, feet, { camera, head });
  };
  /** A point in a machine's model, in the world. */
  const on = (kind: MachineKind, x: number, y: number, z: number) =>
    model(kind).localToWorld(new THREE.Vector3(x, y, z));
  /** What lies in a place in a machine's output area, as drawn. */
  const drawn = (kind: MachineKind, slot = 0) =>
    play.views
      .get(machine(kind).def.id)!
      .outItems()
      .filter((o) => o.userData.slot === slot);
  /** The middle of what lies in a place in a machine's output area, as drawn. */
  const item = (kind: MachineKind, slot = 0) => {
    const box = new THREE.Box3();
    for (const o of drawn(kind, slot)) box.expandByObject(o);
    return box.getCenter(new THREE.Vector3());
  };
  /** What is drawn in a machine, bar its model: what is in it and waits in its output area. */
  const contents = (kind: MachineKind) => model(kind).getObjectByName('contents')!.children;
  return {
    play,
    picker: picker as unknown as MachinePicker,
    spy: picker,
    machine,
    model,
    before,
    look,
    on,
    drawn,
    item,
    contents,
    hands,
  };
}

/** How far each machine's front is out from its middle (half its depth). */
const MACHINE_FRONT: Record<MachineKind, number> = {
  silo: 0.75,
  press: 0.55,
  dispenser: 0.4,
  printer: 0.4,
};

describe("the car test map's brick works", { timeout: 60_000 }, () => {
  it('starts as the picture had it: a red bucket filled, two bricks moulded, a part to print', () => {
    const w = works();
    expect(w.machine('silo').out).toEqual([{ kind: 'bucket', colour: 'red' }]);
    expect(w.machine('press').out.filter(Boolean)).toHaveLength(2);
    expect(w.machine('printer').part).toEqual({ type: '2x4', colour: 'white' });
    w.look(w.before('silo'), w.on('silo', 0, 1.6, 0.75));
    expect(w.drawn('silo')).toHaveLength(1);
    expect(w.drawn('press', 1)).toHaveLength(1);
    expect(w.contents('printer')).toHaveLength(1);
  });

  it('takes the bucket off the silo’s grate with a click on it, into the hands', () => {
    const w = works();
    w.look(w.before('silo'), w.item('silo'));
    expect(w.play.aimed?.owner.kind).toBe('output');
    w.play.click(w.picker);
    w.look(w.before('silo'), w.item('silo'));
    expect(w.play.me.tool).toEqual({ kind: 'bucket', colour: 'red' });
    expect(w.drawn('silo')).toHaveLength(0);
    expect(w.hands.children).toHaveLength(1);
  });

  it('asks the colour at the silo with the game’s picker, then fills a bucket of it', () => {
    const w = works();
    const feet = w.before('silo');
    w.look(feet, w.item('silo'));
    w.play.click(w.picker);
    w.look(feet, w.on('silo', 0.4, 1.8, 0.75));
    expect(w.play.aimed?.owner.kind).toBe('machine');
    w.play.click(w.picker);
    expect(w.spy.openColours).toHaveBeenCalled();
    w.play.act({ kind: 'fill', colour: 'blue' });
    w.look(feet, w.on('silo', 0.4, 1.8, 0.75), 2.5);
    expect(w.machine('silo').out).toEqual([{ kind: 'bucket', colour: 'blue' }]);
    expect(w.drawn('silo')).toHaveLength(1);
  });

  it('moulds a part with a mould from the vendor and pellets from the silo', () => {
    const w = works();
    const press = w.machine('press');
    // Emptied first, to load it as a player would.
    Object.assign(press, { mould: null, colour: null, shots: 0 });
    w.look(w.before('silo'), w.item('silo'));
    w.play.click(w.picker);
    w.look(w.before('press'), w.on('press', 0.9, 1.0, 0.55));
    w.play.click(w.picker);
    expect(press.colour).toBe('red');
    expect(w.play.me.tool).toBeNull();
    w.look(w.before('dispenser'), w.on('dispenser', -0.3, 1.2, 0.4));
    w.play.click(w.picker);
    expect(w.spy.openMoulds).toHaveBeenCalled();
    w.play.act({ kind: 'mould', type: '1x2' });
    w.look(w.before('dispenser'), w.on('dispenser', -0.3, 1.2, 0.4), 2);
    w.look(w.before('dispenser'), w.item('dispenser'));
    expect(w.play.aimed?.owner.kind).toBe('output');
    w.play.click(w.picker);
    expect(w.play.me.tool).toEqual({ kind: 'mould', type: '1x2' });
    w.look(w.before('press'), w.on('press', 0.9, 1.0, 0.55));
    w.play.click(w.picker);
    w.look(w.before('press'), w.on('press', 0.9, 1.0, 0.55));
    expect(press.mould).toBe('1x2');
    expect(w.model('press').getObjectByName('mould')!.visible).toBe(true);
    w.play.click(w.picker);
    w.look(w.before('press'), w.on('press', 0.9, 1.0, 0.55), 3);
    expect(press.out[2]).toEqual({ kind: 'part', type: '1x2', colour: 'red' });
    expect(w.drawn('press', 2)).toHaveLength(1);
  });

  it('prints on the part on the printer’s bed through the picker, and hands it over', () => {
    const w = works();
    const feet = w.before('printer');
    w.look(feet, w.on('printer', 0, 0.9, 0.3));
    w.play.click(w.picker);
    expect(w.spy.openPrints).toHaveBeenCalled();
    w.play.act({ kind: 'print', job: -1 });
    w.look(feet, w.on('printer', 0, 0.9, 0.3));
    expect(w.machine('printer').part).toBeNull();
    expect(w.play.me.holding).not.toBeNull();
    expect(w.contents('printer')).toHaveLength(0);
  });
});
