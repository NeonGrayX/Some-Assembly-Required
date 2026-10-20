import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  MAPS,
  RIVAL_ID_OFFSET,
  hasDoor,
  hideoutPartInWorld,
  rivalLevel,
  rotate,
  sub,
} from '@sar/shared';
import { CHEVRON_LAYOUT } from '../carscene/chevronLayout.ts';
import { Toggle } from '../carscene/gadgets.ts';
import { clickables } from '../carscene/hiding.ts';
import { DEMO_PAGE } from '../carscene/jobsite.ts';
import { buildCarScene } from '../carscene/scene.ts';
import { buildScenery } from './chevron.ts';

const chevron = MAPS.find((m) => m.id === 'chevron')!;

describe('Chevron Street’s scenery', () => {
  it('leaves the corkboards bare for the round’s own pages', { timeout: 120000 }, () => {
    const level = chevron.layout(1);
    const view = buildScenery(level, level.scenery!);
    let pages = 0;
    view.root.traverse((o) => {
      if (o.name === DEMO_PAGE) pages++;
    });
    expect(pages).toBe(0);
  });

  it('clicks each door where it is drawn, shut and open', { timeout: 120000 }, () => {
    const level = chevron.layout(1);
    const view = buildScenery(level, level.scenery!);
    const doors = level.hideouts.filter((h) => hasDoor(h) && h.door);
    expect(doors.length).toBeGreaterThan(5);
    const wrong: string[] = [];
    for (const def of doors) {
      const hideout = view.hideouts.get(def.id)!;
      const leaf = (hideout as unknown as { toggle: Toggle }).toggle.handles[0]!;
      for (const open of [false, true]) {
        hideout.setAmount(open ? 1 : 0);
        view.root.updateMatrixWorld(true);
        const drawn = new THREE.Box3().setFromObject(leaf).getCenter(new THREE.Vector3());
        const part = hideoutPartInWorld(def, open);
        // The drawn leaf's middle, in the clicked box's own frame: inside it, give or take.
        const q = part.rot;
        const local = rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, sub(drawn, part.centre));
        const out = (['x', 'y', 'z'] as const).some(
          (a) => Math.abs(local[a]) > part.half[a] + 0.06,
        );
        if (out) wrong.push(`${def.kind} ${def.id} ${open ? 'open' : 'shut'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it(
    'numbers each lamp, tap and the rest as the level does, wherever the cars park',
    {
      timeout: 300000,
    },
    () => {
      for (const level of [chevron.layout(2), rivalLevel(chevron.layout(3))]) {
        const def = level.scenery!;
        const wrong: string[] = [];
        // The scene as `buildScenery` builds it, before its baking leaves the handles' meshes
        // where they were: the second yard's turned about the dividing line.
        for (const k of level.divide ? [0, 1] : [0]) {
          const scene = buildCarScene({
            layout: CHEVRON_LAYOUT,
            noWorks: true,
            parked: def.parked,
          });
          const copy = scene.root;
          if (k === 0) copy.position.set(def.x, 0, def.z);
          else {
            copy.position.set(-def.x, 0, 2 * level.divide!.z - def.z);
            copy.rotation.y = Math.PI;
          }
          const gadgets = clickables(copy);
          // Each handle as it is drawn to start with (water a tap runs is no part of it).
          copy.updateMatrixWorld(true);
          const drawn = new Map<THREE.Object3D, THREE.Box3>();
          for (const h of gadgets.flatMap((g) => g.handles)) {
            const box = new THREE.Box3().setFromObject(h);
            drawn.set(h, box.applyMatrix4(h.matrixWorld.clone().invert()));
          }
          for (const used of [false, true]) {
            copy.updateMatrixWorld(true);
            for (const g of level.gadgets!) {
              const i = g.id - 1 - k * RIVAL_ID_OFFSET;
              if (i < 0 || i >= RIVAL_ID_OFFSET) continue;
              const gadget = gadgets[i];
              if (!gadget || gadget.handles.length !== g.handles.length) {
                wrong.push(`#${g.id} not drawn`);
                continue;
              }
              gadget.handles.forEach((h, n) => {
                const { pos, size } = used ? g.handles[n]!.used : g.handles[n]!.box;
                const c = drawn
                  .get(h)!
                  .clone()
                  .applyMatrix4(h.matrixWorld)
                  .getCenter(new THREE.Vector3());
                const out = (['x', 'y', 'z'] as const).some(
                  (a) => Math.abs(c[a] - pos[a]) > size[a] / 2 + 0.02,
                );
                if (out) wrong.push(`#${g.id} handle ${n} ${used ? 'clicked' : 'as it starts'}`);
              });
            }
            for (const g of gadgets) {
              if (g instanceof Toggle) {
                g.use();
                g.update(100);
              }
            }
          }
          expect(gadgets).toHaveLength(level.gadgets!.length / (level.divide ? 2 : 1));
        }
        expect(wrong).toEqual([]);
      }
    },
  );
});
