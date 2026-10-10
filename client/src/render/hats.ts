import * as THREE from 'three';
import type { HatId } from '@sar/shared';

/**
 * The hats, as little low-poly shapes. Each is built in a space whose origin sits on the
 * brow line, a little above the middle of the head (see `HAT_Y` in `avatar.ts`), with -z
 * forward, and grows upwards from there. The hard hat is the one every player used to wear.
 */
export interface HatModel {
  group: THREE.Group;
  /** A cylinder standing in for the hat when it flies off a knocked-over player. */
  collider: HatCollider;
  /** A part that spins while the player moves (the propeller), if the hat has one. */
  spinner: THREE.Object3D | null;
}

/** A cylinder (half height, radius) centred `y` above the hat's origin. */
export interface HatCollider {
  halfHeight: number;
  radius: number;
  y: number;
}

const GOLD = 0xd4af37;
const BLACK = 0x1b1d22;

const mat = (color: number, roughness = 0.6) =>
  new THREE.MeshStandardMaterial({ color, roughness });

const CREAM = 0xf4f1ea;
const HARD_HAT = 0xffb000;

/**
 * How the knitted hats use the player's colour: a darker shade of the shirt, so the hat still
 * stands out against the head it sits on.
 */
const dyed = (colour: number) => mat(new THREE.Color(colour).multiplyScalar(0.5).getHex(), 0.7);

/**
 * The hat `id` in the player's colour, or null for a bare head. Every mesh casts a shadow and
 * sits at its own place in the hat's space.
 */
export function makeHat(id: HatId, colour: number): HatModel | null {
  if (id === 'none') return null;
  const group = new THREE.Group();
  let spinner: THREE.Object3D | null = null;
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    y: number,
    x = 0,
    z = 0,
  ) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  /** The top half of a sphere pulled down over the head, like a knitted hat. */
  const dome = (material: THREE.Material, squash: number) => {
    const m = add(
      new THREE.SphereGeometry(0.215, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      material,
      -0.05,
    );
    m.scale.y = squash;
    return m;
  };
  let collider: HatCollider;
  switch (id) {
    case 'hardhat': {
      // A dome with a ridge over the top and a brim that juts out at the front, the dark
      // headband showing under it.
      const shell = mat(HARD_HAT, 0.35);
      const dome = add(
        new THREE.SphereGeometry(0.218, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        shell,
        -0.02,
      );
      dome.scale.y = 0.85;
      const brim = add(new THREE.CylinderGeometry(0.24, 0.245, 0.02, 32), shell, -0.025, 0, -0.025);
      brim.scale.z = 1.14;
      add(new THREE.CylinderGeometry(0.212, 0.212, 0.025, 32, 1, true), mat(BLACK, 0.8), -0.045);
      const ridge = add(new THREE.TorusGeometry(0.21, 0.022, 8, 24, Math.PI), shell, -0.02);
      ridge.rotation.y = Math.PI / 2;
      ridge.scale.y = 0.85;
      collider = { halfHeight: 0.1, radius: 0.25, y: 0.07 };
      break;
    }
    case 'cap': {
      const cloth = dyed(colour);
      dome(cloth, 0.5);
      // The peak: a half disc out of the front of the rim, drooping a little.
      const peak = add(
        new THREE.CylinderGeometry(0.17, 0.17, 0.016, 20, 1, false, Math.PI / 2, Math.PI),
        cloth,
        -0.045,
        0,
        -0.11,
      );
      peak.scale.z = 0.8;
      peak.rotation.x = -0.15;
      collider = { halfHeight: 0.05, radius: 0.22, y: 0.02 };
      break;
    }
    case 'beanie': {
      const wool = dyed(colour);
      dome(wool, 0.9);
      add(new THREE.CylinderGeometry(0.225, 0.225, 0.06, 16), mat(CREAM, 0.9), -0.04);
      add(new THREE.SphereGeometry(0.055, 10, 8), mat(CREAM, 0.9), 0.17);
      collider = { halfHeight: 0.13, radius: 0.22, y: 0.07 };
      break;
    }
    case 'tophat': {
      const silk = mat(BLACK, 0.35);
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 20), silk, 0.01);
      add(new THREE.CylinderGeometry(0.16, 0.15, 0.3, 20), silk, 0.17);
      add(new THREE.CylinderGeometry(0.165, 0.165, 0.04, 20), mat(0xc91a1a, 0.6), 0.05);
      collider = { halfHeight: 0.16, radius: 0.18, y: 0.16 };
      break;
    }
    case 'cowboy': {
      const felt = mat(0x8b5a2b, 0.8);
      add(new THREE.CylinderGeometry(0.32, 0.32, 0.02, 20), felt, 0.01);
      // The brim curls up at the sides.
      const curl = add(new THREE.TorusGeometry(0.3, 0.025, 6, 20), felt, 0.03);
      curl.rotation.x = Math.PI / 2;
      curl.scale.y = 0.8;
      add(new THREE.CylinderGeometry(0.13, 0.16, 0.17, 16), felt, 0.1);
      add(new THREE.CylinderGeometry(0.165, 0.165, 0.03, 16), mat(0x3b2a1a, 0.7), 0.04);
      collider = { halfHeight: 0.1, radius: 0.3, y: 0.09 };
      break;
    }
    case 'party': {
      add(new THREE.ConeGeometry(0.14, 0.34, 16), mat(0xe84393, 0.5), 0.17);
      const rim = add(new THREE.TorusGeometry(0.14, 0.015, 6, 20), mat(0xf5c518, 0.6), 0.005);
      rim.rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(0.04, 10, 8), mat(0xf5c518, 0.6), 0.35);
      collider = { halfHeight: 0.17, radius: 0.12, y: 0.17 };
      break;
    }
    case 'crown': {
      const gold = mat(GOLD, 0.3);
      add(new THREE.CylinderGeometry(0.19, 0.17, 0.1, 8), gold, 0.05);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(
          new THREE.ConeGeometry(0.045, 0.1, 4),
          gold,
          0.14,
          Math.sin(a) * 0.165,
          Math.cos(a) * 0.165,
        );
      }
      add(new THREE.SphereGeometry(0.03, 8, 6), mat(0xc91a1a, 0.2), 0.05, 0, -0.18);
      collider = { halfHeight: 0.1, radius: 0.2, y: 0.1 };
      break;
    }
    case 'chef': {
      const linen = mat(CREAM, 0.9);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 16), linen, 0.045);
      const puff = add(new THREE.SphereGeometry(0.23, 16, 10), linen, 0.2);
      puff.scale.y = 0.7;
      collider = { halfHeight: 0.17, radius: 0.23, y: 0.17 };
      break;
    }
    case 'cone': {
      const orange = mat(0xf26b1d, 0.6);
      add(new THREE.BoxGeometry(0.4, 0.02, 0.4), orange, 0.01);
      add(new THREE.ConeGeometry(0.17, 0.36, 12), orange, 0.19);
      // A reflective stripe: a slice of the cone, a hair wider, part way up.
      add(new THREE.CylinderGeometry(0.07, 0.095, 0.05, 12), mat(CREAM, 0.4), 0.195);
      collider = { halfHeight: 0.19, radius: 0.14, y: 0.19 };
      break;
    }
    case 'propeller': {
      dome(dyed(colour), 0.85);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), mat(BLACK, 0.5), 0.17);
      spinner = add(new THREE.BoxGeometry(0.3, 0.012, 0.04), mat(0xc91a1a, 0.5), 0.215);
      collider = { halfHeight: 0.13, radius: 0.22, y: 0.08 };
      break;
    }
    case 'brick': {
      // A 2x2 brick worn like a hat, in the player's colour.
      const plastic = mat(colour, 0.35);
      add(new THREE.BoxGeometry(0.32, 0.19, 0.32), plastic, 0.065);
      for (const x of [-0.08, 0.08]) {
        for (const z of [-0.08, 0.08]) {
          add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), plastic, 0.18, x, z);
        }
      }
      collider = { halfHeight: 0.115, radius: 0.2, y: 0.085 };
      break;
    }
  }
  return { group, collider, spinner };
}
