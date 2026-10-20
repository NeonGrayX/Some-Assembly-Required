import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VACUUM_DOCK, VACUUM_FROM_WALL } from '@sar/shared';
import { vacuumDock } from './dock.ts';
import { HOUSE_BODY } from './house.ts';

describe('the vacuum’s dock', () => {
  it('fits the site office’s wall and plinth, where Chevron Street keeps the vacuum', () => {
    // The vacuum stands 0.3 m out from the wall's inside (see `chevronTry`), leaning back.
    expect(VACUUM_DOCK.wall).toBeCloseTo(0.3 - HOUSE_BODY.wall + VACUUM_FROM_WALL, 3);
    expect(VACUUM_DOCK.plinth.high).toBe(HOUSE_BODY.plinth);
  });

  it(
    'is fixed to the wall, behind the vacuum’s head, and no wider than the alley needs',
    { timeout: 60000 },
    () => {
      const dock = vacuumDock();
      dock.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(dock);
      expect(box.max.z).toBeCloseTo(VACUUM_DOCK.wall, 3);
      expect(box.min.z).toBeGreaterThan(0.09);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.001);
      expect(box.max.x - box.min.x).toBeLessThan(0.8);
    },
  );
});
