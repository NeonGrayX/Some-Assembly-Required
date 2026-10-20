import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS, hasDoor, hideoutPartInWorld, rotate, sub } from '@sar/shared';
import type { Toggle } from '../carscene/gadgets.ts';
import { DEMO_PAGE } from '../carscene/jobsite.ts';
import { buildScenery } from './chevron.ts';

const chevron = MAPS.find((m) => m.id === 'chevron')!;

describe('Chevron Street’s scenery', () => {
  it('leaves the corkboards bare for the round’s own pages', { timeout: 60000 }, () => {
    const level = chevron.layout(1);
    const view = buildScenery(level, level.scenery!);
    let pages = 0;
    view.root.traverse((o) => {
      if (o.name === DEMO_PAGE) pages++;
    });
    expect(pages).toBe(0);
  });

  it('clicks each door where it is drawn, shut and open', { timeout: 60000 }, () => {
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
});
