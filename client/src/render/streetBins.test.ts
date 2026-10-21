import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS, TRASH_BIN_SIZE, isTrashBin, trashBinMouth } from '@sar/shared';
import { BIN_FRONT, streetBin } from '../carscene/street.ts';
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
    'close the sides of the gap their face tips out of, shut, part open and open',
    { timeout: 60000 },
    () => {
      // In the bin's own axes (its front +x): where its body's side walls end at the front, and
      // where the face's side returns end at the back, in the face's axes as they are shut; the
      // face's top back corner is about this far from the hinge (less its rounding).
      const BODY = 0.156;
      const FACE_BACK = 0.16;
      const REACH = 0.83;
      const g = new THREE.Group();
      const bin = streetBin(g);
      const { hinge } = BIN_FRONT;
      const centre = new THREE.Vector2(hinge.x, hinge.y);
      const ray = new THREE.Raycaster();
      const shut = new THREE.Vector2();
      for (const k of [0, 0.25, 0.5, 0.75, 1]) {
        bin.tip(k);
        g.updateMatrixWorld(true);
        const angle = bin.front.rotation.z;
        const open: string[] = [];
        let seen = 0;
        for (let x = BODY + 0.002; x < 0.7; x += 0.005)
          for (let y = 0.082; y < 0.95; y += 0.005) {
            // In the wedge: in front of the body, behind the tipped face, under its top.
            if (Math.hypot(x - hinge.x, y - hinge.y) > REACH) continue;
            shut.set(x, y).rotateAround(centre, -angle);
            if (shut.x > FACE_BACK) continue;
            seen++;
            // Looking in from either side, the first thing in the way is on that side: a wall, a
            // side of the scoop or a lip, not the rubbish inside or the far side, or nothing.
            for (const side of [1, -1]) {
              ray.set(new THREE.Vector3(x, y, side * 0.5), new THREE.Vector3(0, 0, -side));
              const hit = ray.intersectObject(g, true)[0];
              if (!hit || hit.point.z * side < 0.15)
                open.push(`(${x.toFixed(3)}, ${y.toFixed(3)}) from ${side > 0 ? '+z' : '-z'}`);
            }
          }
        if (k > 0) expect(seen).toBeGreaterThan(50 * k);
        expect(open, `tipped ${k} of the way`).toEqual([]);
      }
    },
  );

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
