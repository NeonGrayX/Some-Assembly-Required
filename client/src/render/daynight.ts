import * as THREE from 'three';

/**
 * Set in a material's `userData` to make it glow differently at night: the value is its
 * `emissiveIntensity` at night if it has one, else its `opacity` (halos and light pools).
 * Its own value is what it shows by day. `mergeStatic` keeps the tag on merged materials.
 */
export const AT_NIGHT = 'atNight';

/** Set in a light's `userData` to switch it on at night only. */
export const NIGHT_ONLY = 'nightOnly';

/**
 * Set in a light's or material's `userData` to tie it to the ceiling lamps being on rather than
 * to the night: with ray traced shadows the lamps' real lights are on by day too, and what
 * fakes their light by day (the rooms' even fill, the baked shadows) is set as at night.
 */
export const LAMP_LIT = 'lampLit';

/**
 * Set in a material's `userData` to mark a glow faking a lamp's light on the ground. While the
 * lamps' real light is traced, it is dimmed to `TRACED_POOL` so the real light and shadows show.
 */
export const GLOW_POOL = 'glowPool';
const TRACED_POOL = 0.25;
/** How much brighter the lamps' lights burn while traced, standing in for the dimmed glows. */
const TRACED_LIGHT = 1.6;

/** Tags a light or material with `tag` (see `LAMP_LIT`, `GLOW_POOL`), and returns it. */
export function tagged<T extends { userData: Record<string, unknown> }>(x: T, tag: string): T {
  x.userData[tag] = true;
  return x;
}

/** Marks `light` as on at night only (see `NIGHT_ONLY`); it starts off, as by day. */
export function nightOnly<L extends THREE.Light>(light: L): L {
  light.userData[NIGHT_ONLY] = true;
  light.visible = false;
  return light;
}

/** Tags `material` with how brightly it glows at night (see `AT_NIGHT`), and returns it. */
export function atNight<M extends THREE.Material>(material: M, value: number): M {
  material.userData[AT_NIGHT] = value;
  return material;
}

/** How the sky and the outdoor lights look at one time of day. */
interface Sky {
  sky: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunIntensity: number;
}

const DAY: Sky = {
  sky: 0x9fc9e8,
  fogNear: 25,
  fogFar: 60,
  hemiSky: 0xdfefff,
  hemiGround: 0x6b5b45,
  hemi: 1.4,
  sun: 0xfff3dd,
  sunIntensity: 2.2,
};

/**
 * Moonlight: the sun stays where it is (so it is shut out of the house just the same) but turns
 * into a faint blue moon, and the sky and the light bouncing around go dark blue.
 */
const NIGHT: Sky = {
  sky: 0x070b18,
  fogNear: 12,
  fogFar: 40,
  hemiSky: 0x40548a,
  hemiGround: 0x15131a,
  hemi: 0.2,
  sun: 0x9fb6e6,
  sunIntensity: 0.22,
};

/**
 * Switches the scene between day and night. Nothing is added or removed: the lamps' lights are
 * switched on or off, and tagged materials change how brightly they glow. With `realLamps`
 * (ray traced shadows on), the ceiling lamps shine by day too and the glows faking the lamps'
 * light on the ground are dimmed, so the real light, its shadows and the corner shading show.
 */
export function setTimeOfDay(
  scene: THREE.Scene,
  hemi: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  night: boolean,
  realLamps = false,
): void {
  const s = night ? NIGHT : DAY;
  (scene.background as THREE.Color).set(s.sky);
  const fog = scene.fog as THREE.Fog;
  fog.color.set(s.sky);
  fog.near = s.fogNear;
  fog.far = s.fogFar;
  hemi.color.set(s.hemiSky);
  hemi.groundColor.set(s.hemiGround);
  hemi.intensity = s.hemi;
  sun.color.set(s.sun);
  sun.intensity = s.sunIntensity;

  const lampsOn = night || realLamps;
  const seen = new Set<THREE.Material>();
  scene.traverse((o) => {
    if (o.userData[NIGHT_ONLY]) {
      o.visible = o.userData[LAMP_LIT] ? lampsOn : night;
      const light = o as THREE.Light;
      o.userData.power ??= light.intensity;
      light.intensity = (o.userData.power as number) * (realLamps ? TRACED_LIGHT : 1);
    }
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const material of Array.isArray(m) ? m : [m]) {
      if (seen.has(material)) continue;
      seen.add(material);
      const at = material.userData[AT_NIGHT] as number | undefined;
      if (at === undefined) continue;
      const lit = material as THREE.MeshStandardMaterial;
      const key = lit.emissive ? 'emissiveIntensity' : 'opacity';
      material.userData.byDay ??= lit[key];
      const on = material.userData[LAMP_LIT] ? lampsOn : night;
      const value = on ? at : (material.userData.byDay as number);
      lit[key] = realLamps && material.userData[GLOW_POOL] ? value * TRACED_POOL : value;
    }
  });
}
