import * as THREE from 'three';
import { atNight, nightOnly } from './daynight.ts';
import { LAMP_GLOW, glowMaterial } from './furniture.ts';

/** A garden lamp's light at night: its intensity, and how far it reaches. */
const LIGHT_POWER = 16;
const LIGHT_REACH = 10;

const iron = new THREE.MeshStandardMaterial({ color: 0x2f3336, roughness: 0.45, metalness: 0.6 });

/**
 * A garden lamp post `h` high, in a frame centred on its box: a black iron post with a glowing
 * lantern on top. By day the lantern is barely on; at night it glows, with a halo around it,
 * a warm pool on the ground under it, and a light reaching the yard around it.
 */
export function gardenLamp(g: THREE.Object3D, h: number): void {
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const foot = -h / 2;
  add(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 12), iron, foot + 0.08);
  add(new THREE.CylinderGeometry(0.035, 0.045, h - 0.3, 10), iron, foot + 0.16 + (h - 0.3) / 2);

  // The lantern: a glowing box with a frame, a roof and a finial.
  const lantern = foot + h - 0.02;
  add(new THREE.BoxGeometry(0.2, 0.04, 0.2), iron, lantern - 0.15);
  const glass = add(
    new THREE.BoxGeometry(0.16, 0.24, 0.16),
    atNight(
      new THREE.MeshStandardMaterial({
        color: 0x4a4436,
        emissive: LAMP_GLOW,
        emissiveIntensity: 0.15,
      }),
      2.4,
    ),
    lantern,
  );
  glass.castShadow = false;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const bar = add(new THREE.BoxGeometry(0.02, 0.26, 0.02), iron, lantern);
      bar.position.x = sx * 0.085;
      bar.position.z = sz * 0.085;
    }
  const roof = add(new THREE.ConeGeometry(0.17, 0.12, 4), iron, lantern + 0.18);
  roof.rotation.y = Math.PI / 4;
  add(new THREE.SphereGeometry(0.025, 8, 6), iron, lantern + 0.255);

  const halo = new THREE.Sprite(atNight(new THREE.SpriteMaterial(glowMaterial(0)), 0.75));
  halo.scale.setScalar(1.6);
  halo.position.y = lantern;
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    atNight(new THREE.MeshBasicMaterial(glowMaterial(0)), 0.6),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = foot + 0.012;
  // At night each lantern lights what is around it: no shadows, so it stays cheap.
  const light = nightOnly(new THREE.PointLight(LAMP_GLOW, LIGHT_POWER, LIGHT_REACH, 2));
  light.position.y = lantern;
  g.add(halo, pool, light);
}
