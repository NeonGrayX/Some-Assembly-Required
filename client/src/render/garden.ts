import * as THREE from 'three';
import { GLOW_POOL, LAMP_FIXTURE, POWERED, atNight, nightOnly, tagged } from './daynight.ts';
import { LAMP_GLOW, glowMaterial } from './furniture.ts';
import { FLOOR_LAYERS } from './layers.ts';
import { bevelBox, bevelCylinder } from './shapes.ts';

/** A garden lamp's light at night: its intensity, and how far it reaches. */
const LIGHT_POWER = 16;
const LIGHT_REACH = 10;

const iron = new THREE.MeshStandardMaterial({ color: 0x2f3336, roughness: 0.45, metalness: 0.6 });

/**
 * A garden lamp post `h` high, in a frame centred on its box: a black iron post with a glowing
 * lantern on top. By day the lantern is barely on; at night it glows, with a halo around it,
 * a warm pool on the ground under it, and a light reaching the yard around it. They run off the
 * house's power, so while it is out they are dark, day or night. On hilly ground the pool lies
 * over the floor `floorAt` gives (the ground or decking, in the lamp's frame); without it, flat
 * at the post's foot.
 */
export function gardenLamp(
  g: THREE.Object3D,
  h: number,
  floorAt?: (x: number, z: number) => number,
): void {
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.y = y;
    m.castShadow = true;
    m.userData[LAMP_FIXTURE] = true;
    g.add(m);
    return m;
  };
  const foot = -h / 2;
  // Cast iron, its edges rounded: the base, the post up from it and the lantern's floor.
  add(bevelCylinder(0.09, 0.11, 0.16, 12), iron, foot + 0.08);
  add(bevelCylinder(0.035, 0.045, h - 0.3, 10), iron, foot + 0.16 + (h - 0.3) / 2);

  // The lantern: a glowing box with a frame, a roof and a finial.
  const lantern = foot + h - 0.02;
  add(bevelBox(0.2, 0.04, 0.2), iron, lantern - 0.15);
  const glass = add(new THREE.BoxGeometry(0.16, 0.24, 0.16), lanternGlass(), lantern);
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

  lanternGlow(g, new THREE.Vector3(0, lantern, 0), foot, floorAt);
}

/**
 * The glass of an outdoor lantern (a garden lamp's, a harbour lantern's): barely lit by day,
 * glowing at night, and dark while the power is out. Each lantern has its own.
 */
export function lanternGlass(): THREE.MeshStandardMaterial {
  return tagged(
    atNight(
      new THREE.MeshStandardMaterial({
        color: 0x4a4436,
        emissive: LAMP_GLOW,
        emissiveIntensity: 0.15,
      }),
      2.4,
    ),
    POWERED,
  );
}

/**
 * What an outdoor lantern whose glass is at `at` (in `g`'s frame) gives off at night: a halo
 * round the glass, a warm pool on the ground under it and a light reaching what is around it,
 * all dark by day and while the power is out (see `gardenLamp`). The pool lies over the floor
 * `floorAt` gives (in `g`'s frame), or flat at `foot`.
 */
export function lanternGlow(
  g: THREE.Object3D,
  at: THREE.Vector3,
  foot: number,
  floorAt?: (x: number, z: number) => number,
): void {
  const halo = new THREE.Sprite(
    tagged(atNight(new THREE.SpriteMaterial(glowMaterial(0)), 0.75), POWERED),
  );
  halo.scale.setScalar(1.6);
  halo.position.copy(at);
  const pool = new THREE.Mesh(
    poolGeometry(at.x, at.z, foot, floorAt),
    tagged(tagged(atNight(new THREE.MeshBasicMaterial(glowMaterial(0)), 0.6), GLOW_POOL), POWERED),
  );
  // At night each lantern lights what is around it: no shadows, so it stays cheap.
  const light = tagged(
    nightOnly(new THREE.PointLight(LAMP_GLOW, LIGHT_POWER, LIGHT_REACH, 2)),
    POWERED,
  );
  light.position.copy(at);
  g.add(halo, pool, light);
}

/**
 * The ground a lantern's pool of light lies on, 6 m square round (`x`, `z`): flat at `foot`,
 * or draped over `floorAt` a little over it (its squares are bigger than the ground's, so it
 * keeps clear of the bumps between them).
 */
function poolGeometry(
  x: number,
  z: number,
  foot: number,
  floorAt?: (x: number, z: number) => number,
): THREE.BufferGeometry {
  if (!floorAt)
    return new THREE.PlaneGeometry(6, 6)
      .rotateX(-Math.PI / 2)
      .translate(x, foot + FLOOR_LAYERS.gardenPool, z);
  const geometry = new THREE.PlaneGeometry(6, 6, 12, 12).rotateX(-Math.PI / 2).translate(x, 0, z);
  const pos = geometry.attributes.position!;
  for (let k = 0; k < pos.count; k++)
    pos.setY(k, floorAt(pos.getX(k), pos.getZ(k)) + FLOOR_LAYERS.gardenPool + 0.03);
  return geometry;
}
