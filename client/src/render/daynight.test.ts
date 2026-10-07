import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  GLOW_POOL,
  LAMP_LIT,
  POWERED,
  atNight,
  nightOnly,
  setTimeOfDay,
  tagged,
} from './daynight.ts';

function scene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color();
  s.fog = new THREE.Fog(0);
  const lamp = tagged(nightOnly(new THREE.SpotLight(0xffffff, 10)), LAMP_LIT);
  const garden = tagged(nightOnly(new THREE.PointLight(0xffffff, 10)), POWERED);
  const lantern = new THREE.Mesh(
    undefined,
    tagged(atNight(new THREE.MeshStandardMaterial({ emissiveIntensity: 0.15 }), 2.4), POWERED),
  );
  const porch = nightOnly(new THREE.PointLight(0xffffff, 10));
  const fill = new THREE.Mesh(
    undefined,
    tagged(atNight(new THREE.MeshStandardMaterial({ emissiveIntensity: 1 }), 0.5), LAMP_LIT),
  );
  const pool = new THREE.Mesh(
    undefined,
    tagged(atNight(new THREE.MeshBasicMaterial({ opacity: 0.2 }), 0.6), GLOW_POOL),
  );
  s.add(lamp, garden, lantern, porch, fill, pool);
  const time = (night: boolean, realLamps = false, power = true) =>
    setTimeOfDay(
      s,
      new THREE.HemisphereLight(),
      new THREE.DirectionalLight(),
      night,
      realLamps,
      power,
    );
  return {
    lamp,
    garden,
    lantern: lantern.material,
    porch,
    fill: fill.material,
    pool: pool.material,
    time,
  };
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

  it('puts the garden lamps out with the power, and back on when it is restored', () => {
    const { lamp, garden, lantern, porch, time } = scene();
    time(true, false, false);
    expect([lamp.visible, garden.visible, lantern.emissiveIntensity, porch.visible]).toEqual([
      false,
      false,
      0,
      true,
    ]);
    time(true);
    expect([lamp.visible, garden.visible, lantern.emissiveIntensity]).toEqual([true, true, 2.4]);
  });
});
