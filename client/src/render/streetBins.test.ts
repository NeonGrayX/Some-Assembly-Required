import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS, TRASH_BIN_SIZE, isTrashBin, trashBinMouth } from '@sar/shared';
import { TippingBin, TippingBins, streetBinModel } from './streetBins.ts';

const chevron = MAPS.find((m) => m.id === 'chevron')!;

describe('Chevron Street’s bins', () => {
  it('are all the street’s, drawn with the scene', { timeout: 60000 }, () => {
    for (const level of [chevron.plain, chevron.layout(1), chevron.layout(2)]) {
      const bins = level.boxes.filter(isTrashBin);
      expect(bins.length).toBeGreaterThanOrEqual(8);
      for (const b of bins) {
        expect(b.model).toBe('streetBin');
        expect(b.scenery).toBe(true);
      }
    }
  });

  it('fill the box they collide as, the shut street bin’s', { timeout: 60000 }, () => {
    const g = new THREE.Group();
    streetBinModel(g, 0x2c6670);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g);
    const s = TRASH_BIN_SIZE.streetBin;
    for (const [lo, hi, size] of [
      [box.min.x, box.max.x, s.x],
      [box.min.y, box.max.y, s.y],
      [box.min.z, box.max.z, s.z],
    ] as const) {
      expect(lo).toBeCloseTo(-size / 2, 3);
      expect(hi).toBeCloseTo(size / 2, 3);
    }
  });

  it(
    'tip their face out toward their front when a brick goes in, and shut on it',
    { timeout: 60000 },
    () => {
      const level = chevron.layout(1);
      const box = level.boxes.find((b) => b.model === 'streetBin' && b.front === '-z')!;
      const bins = new TippingBins([box], new THREE.Group());
      const bin = bins.bins[0]!;
      const m = trashBinMouth(box);
      bins.binned({ x: (m.x0 + m.x1) / 2, y: m.y, z: (m.z0 + m.z1) / 2 }, false, 1, 'blue');
      const front = () => {
        bin.group.updateMatrixWorld(true);
        return new THREE.Box3().setFromObject(bin.group).min.z;
      };
      const shut = box.pos.z - box.size.z / 2;
      expect(front()).toBeCloseTo(shut, 2);
      for (let i = 0; i < 30; i++) bins.update(1 / 60);
      // Open: its face out in front of its box, toward -z, and the brick on its way in.
      expect(front()).toBeLessThan(shut - 0.25);
      expect(bin.load).toBe(1);
      for (let i = 0; i < 200; i++) bins.update(1 / 60);
      expect(front()).toBeCloseTo(shut, 2);
      expect(bin.load).toBe(0);
    },
  );

  it('take what the vacuum empties out, in a puff of dust', { timeout: 60000 }, () => {
    const box = chevron.layout(1).boxes.find((b) => b.model === 'streetBin')!;
    const bin = new TippingBin(box);
    bin.binned(true, 6);
    expect(bin.load).toBe(6);
    for (let i = 0; i < 300; i++) bin.update(1 / 60);
    expect(bin.load).toBe(0);
  });
});
