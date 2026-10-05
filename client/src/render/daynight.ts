import * as THREE from 'three';

/**
 * Set in a material's `userData` to make it glow differently at night: the value is its
 * `emissiveIntensity` at night if it has one, else its `opacity` (halos and light pools).
 * Its own value is what it shows by day. `mergeStatic` keeps the tag on merged materials.
 */
export const AT_NIGHT = 'atNight';

/** Set in a light's `userData` to switch it on at night only. */
export const NIGHT_ONLY = 'nightOnly';

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
 * Switches the scene between day and night. Nothing is added or removed: the garden lamps'
 * lights are switched on or off, and tagged materials change how brightly they glow.
 */
export function setTimeOfDay(
  scene: THREE.Scene,
  hemi: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  night: boolean,
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

  const seen = new Set<THREE.Material>();
  scene.traverse((o) => {
    if (o.userData[NIGHT_ONLY]) o.visible = night;
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
      lit[key] = night ? at : (material.userData.byDay as number);
    }
  });
}
