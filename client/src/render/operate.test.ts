import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACT_TIMES, MACHINE_SIZE } from '@sar/shared';
import type { MachineAct, MachineDef, MachineKind, MachineState, Made } from '@sar/shared';
import { animateAvatar, makeAvatar, reachPose } from './avatar.ts';
import { MachineView } from './brickworks.ts';
import type { MachineLook } from './brickworks.ts';
import { CarMachineView } from './carMachines.ts';
import { moveFor } from './operate.ts';
import { STRAY, stageOf } from './operating.ts';

beforeAll(() => {
  // Signs and displays are drawn on canvases: a stand-in that draws nothing will do.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 100 }) });
  Object.assign(globalThis, {
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
  });
});

/** A machine of a kind standing at the origin, facing +z: its own frame is the world's. */
const atOrigin = (kind: MachineKind): MachineDef => ({
  id: 1,
  kind,
  pos: { x: 0, y: 0, z: 0 },
  size: { ...MACHINE_SIZE[kind] },
  facing: 0,
});

/** What waits in each place of a machine of a kind's output area, a part on the printer's bed. */
function loaded(def: MachineDef): MachineState {
  const made: Made =
    def.kind === 'silo'
      ? { kind: 'bucket', colour: 'yellow' }
      : def.kind === 'dispenser'
        ? { kind: 'mould', type: 'slope2x2' }
        : { kind: 'part', type: '2x2', colour: 'blue' };
  const places = def.kind === 'press' ? 3 : 1;
  return {
    def,
    mould: '2x4',
    colour: 'red',
    shots: 5,
    part: def.kind === 'printer' ? { type: '2x4', colour: 'red' } : null,
    jammed: false,
    fixer: null,
    out: def.kind === 'printer' ? [] : Array.from({ length: places }, () => made),
    making: null,
    progress: 0,
  } as MachineState;
}

/** Every act on a machine of each kind, and the places taken from. */
const ACTS: Record<MachineKind, [MachineAct, number][]> = {
  press: [
    ['start', -1],
    ['pour', -1],
    ['mould', -1],
    ['take', 0],
    ['take', 1],
    ['take', 2],
  ],
  silo: [
    ['fill', -1],
    ['take', 0],
  ],
  dispenser: [
    ['start', -1],
    ['return', -1],
    ['take', 0],
  ],
  printer: [
    ['lay', -1],
    ['print', -1],
    ['take', -1],
  ],
};

const LOOKS: [string, (def: MachineDef) => MachineLook][] = [
  ['house', (def) => new MachineView(def)],
  ['car', (def) => new CarMachineView(def)],
];

/** How far off its target a hand may be, once the move has them there (m). */
const OFF = 0.03;
const dt = 1 / 60;

describe('operating the machines', () => {
  for (const [name, make] of LOOKS)
    for (const kind of Object.keys(ACTS) as MachineKind[])
      for (const [act, slot] of ACTS[kind]) {
        it(`puts the hands where the move has them: ${act} ${slot} at the ${name} ${kind}`, () => {
          const def = atOrigin(kind);
          const look = make(def);
          const m = loaded(def);
          look.update(m, {});
          const part = act === 'lay' ? look.bedModel() : null;
          const taken =
            act === 'take' && kind !== 'printer'
              ? (() => {
                  // (Taken: drawn where it lay till the hands get it.)
                  look.update({ ...m, out: m.out.map((x, i) => (i === slot ? null : x)) }, {});
                  return look.keptModel(slot);
                })()
              : act === 'take' || act === 'print'
                ? look.bedModel()
                : null;
          const stage = stageOf(look, act, slot, part ?? taken);
          const move = moveFor(act, stage)!;
          expect(move.length).toBeCloseTo(ACT_TIMES[act].seconds);
          const a = makeAvatar(0x1e5bc6, null);
          let worst = 0;
          let at = '';
          for (let t = 0; t <= move.length; t += dt) {
            const f = move.frame(t);
            // Never stepping further from where the sim has them than the view lets them.
            expect(f.stand.clone().setY(0).distanceTo(stage.station), `t ${t}`).toBeLessThan(STRAY);
            a.group.position.set(f.stand.x, stage.height + f.stand.y, f.stand.z);
            a.group.rotation.set(0, f.turn, 0);
            a.group.updateMatrixWorld(true);
            const local = (v: THREE.Vector3 | null) => (v ? a.group.worldToLocal(v.clone()) : null);
            const hands: [THREE.Vector3 | null, THREE.Vector3 | null] = [
              local(f.hands[0]),
              local(f.hands[1]),
            ];
            const operate = { hands, ...reachPose(hands), look: local(f.look) };
            animateAvatar(a, { limping: false, carrying: false, careful: false, operate }, dt);
            if (t < 0.35) continue;
            a.group.updateMatrixWorld(true);
            for (const i of [0, 1] as const) {
              const want = f.hands[i];
              if (!want) continue;
              const off = a.hands[i].getWorldPosition(new THREE.Vector3()).distanceTo(want);
              if (off > worst) {
                worst = off;
                at = `hand ${i} at ${t.toFixed(2)}s`;
              }
            }
          }
          expect(worst, at).toBeLessThan(OFF);
        });
      }
});
