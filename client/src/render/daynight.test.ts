import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GLOW_POOL, LAMP_LIT, atNight, nightOnly, setTimeOfDay, tagged } from './daynight.ts';

function scene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color();
  s.fog = new THREE.Fog(0);
  const lamp = tagged(nightOnly(new THREE.SpotLight(0xffffff, 10)), LAMP_LIT);
  const garden = nightOnly(new THREE.PointLight(0xffffff, 10));
  const fill = new THREE.Mesh(
    undefined,
    tagged(atNight(new THREE.MeshStandardMaterial({ emissiveIntensity: 1 }), 0.5), LAMP_LIT),
  );
  const pool = new THREE.Mesh(
    undefined,
    tagged(atNight(new THREE.MeshBasicMaterial({ opacity: 0.2 }), 0.6), GLOW_POOL),
  );
  s.add(lamp, garden, fill, pool);
  const time = (night: boolean, realLamps = false) =>
    setTimeOfDay(s, new THREE.HemisphereLight(), new THREE.DirectionalLight(), night, realLamps);
  return { lamp, garden, fill: fill.material, pool: pool.material, time };
}

describe('day and night', () => {
  it('switches the lamps on and the glows up at night only', () => {
    const { lamp, garden, fill, pool, time } = scene();
    time(true);
    expect([lamp.visible, garden.visible, fill.emissiveIntensity, pool.opacity]).toEqual([
      true,
      true,
      0.5,
      0.6,
    ]);
    time(false);
    expect([lamp.visible, garden.visible, fill.emissiveIntensity, pool.opacity]).toEqual([
      false,
      false,
      1,
      0.2,
    ]);
  });

  it('keeps the ceiling lamps on by day while their light is traced, and dims the glows', () => {
    const { lamp, garden, fill, pool, time } = scene();
    time(false, true);
    expect([lamp.visible, garden.visible, fill.emissiveIntensity]).toEqual([true, false, 0.5]);
    expect(pool.opacity).toBeLessThan(0.2);
    expect(lamp.intensity).toBeGreaterThan(10);
    time(true, true);
    expect(garden.visible).toBe(true);
    expect(pool.opacity).toBeLessThan(0.6);
    time(false);
    expect([lamp.visible, lamp.intensity, fill.emissiveIntensity, pool.opacity]).toEqual([
      false,
      10,
      1,
      0.2,
    ]);
  });
});
