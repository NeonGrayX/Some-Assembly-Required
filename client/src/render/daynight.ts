import * as THREE from 'three';
import type { VisualStyle } from '../graphics-settings.ts';
import { setMetalShine } from './bricks.ts';

/**
 * Set in a material's `userData` to make it glow differently at night: the value is its
 * `emissiveIntensity` at night if it has one, else its `opacity` (halos and light pools).
 * Its own value is what it shows by day. `mergeStatic` keeps the tag on merged materials.
 */
export const AT_NIGHT = 'atNight';

/** Set in a light's `userData` to switch it on at night only. */
export const NIGHT_ONLY = 'nightOnly';
/** Kept in a night-only light's `userData`: its intensity as made, before tracing boosts it. */
const POWER = 'power';
/**
 * Kept in a material's `userData` beside `AT_NIGHT`: what it glows by day, its value as made
 * (`emissiveIntensity`, else `opacity`).
 */
const BY_DAY = 'byDay';

/** What a material tagged `AT_NIGHT` sets by day and night: its glow, else its opacity. */
const glowKey = (m: THREE.Material) =>
  (m as THREE.MeshStandardMaterial).emissive ? 'emissiveIntensity' : 'opacity';

/**
 * Set in a light's or material's `userData` to tie it to the ceiling lamps being on rather than
 * to the night: with ray traced shadows the lamps' real lights are on by day too, and what
 * fakes their light by day (the rooms' even fill, the baked shadows) is set as at night.
 */
export const LAMP_LIT = 'lampLit';

/**
 * Set in a light's or material's `userData` to make it go dark while the power is out: the
 * ceiling lamps' shades and glows, and the garden lamps with their lights. Everything tagged
 * `LAMP_LIT` goes dark with them.
 */
export const POWERED = 'powered';

/**
 * Set in a material's `userData` to mark a glow faking a lamp's light on the ground. While the
 * lamps' real light is traced, it is dimmed to `TRACED_POOL` so the real light and shadows show.
 */
export const GLOW_POOL = 'glowPool';
const TRACED_POOL = 0.25;
/** How much brighter the lamps' lights burn while traced, standing in for the dimmed glows. */
const TRACED_LIGHT = 1.6;

/**
 * Set in a mesh's `userData` for a lamp's own body around its light (a garden lamp's post and
 * lantern, a ceiling lamp's shade). Ray traced shadows leave it out of the traced house: the
 * light is a point inside it, so the lantern's base and the post right under it would cut a hard
 * wedge out of the glow the whole lantern gives. It still casts into the shadow maps, as what
 * moves does. `mergeStatic` keeps the tag.
 */
export const LAMP_FIXTURE = 'lampFixture';

/** Tags a light or material with `tag` (see `LAMP_LIT`, `GLOW_POOL`), and returns it. */
export function tagged<T extends { userData: Record<string, unknown> }>(x: T, tag: string): T {
  x.userData[tag] = true;
  return x;
}

/** Marks `light` as on at night only (see `NIGHT_ONLY`); it starts off, as by day. */
export function nightOnly<L extends THREE.Light>(light: L): L {
  light.userData[NIGHT_ONLY] = true;
  light.userData[POWER] = light.intensity;
  light.visible = false;
  return light;
}

/**
 * Tags `material` with how brightly it glows at night (see `AT_NIGHT`), and returns it. What
 * it is made with is what it shows by day.
 */
export function atNight<M extends THREE.Material>(material: M, value: number): M {
  material.userData[AT_NIGHT] = value;
  material.userData[BY_DAY] = (material as unknown as Record<string, number>)[glowKey(material)];
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
  /**
   * How strongly the sky's own picture lights the scene (see `Sky.bakeLight`), in the styles that
   * draw the sky; the hemisphere light then only adds the warmth bounced up off the ground.
   */
  env: number;
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
  env: 0,
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
  env: 0,
};

/**
 * The realistic style: lit by the sky's own picture (its blue overhead, the haze and the ground
 * below, the glow round the sun) instead of the even hemisphere light, so shade is a little blue
 * and glossy things reflect the sky's colours.
 */
const REALISTIC_DAY: Sky = { ...DAY, hemi: 0.5, env: 0.85 };
const REALISTIC_NIGHT: Sky = { ...NIGHT, hemi: 0.08, env: 0.9 };

/**
 * The painted style: a warm, strong sun over shade washed in the sky's deep blue, with a bright
 * hazy horizon further off (the surroundings fade into it).
 */
const PAINTED_DAY: Sky = {
  sky: 0xbfe2f4,
  fogNear: 42,
  fogFar: 180,
  hemiSky: 0xfff2dc,
  hemiGround: 0x8a6a48,
  hemi: 0.45,
  sun: 0xffe6c0,
  sunIntensity: 3.1,
  env: 0.95,
};
const PAINTED_NIGHT: Sky = {
  sky: 0x0f1b3e,
  fogNear: 26,
  fogFar: 140,
  hemiSky: 0x4a5f9a,
  hemiGround: 0x1a1622,
  hemi: 0.12,
  sun: 0xa9c0f0,
  sunIntensity: 0.35,
  env: 1.2,
};

/** The light at one time of day, in one style. */
export function lightingFor(look: VisualStyle, night: boolean): Readonly<Sky> {
  if (look === 'painted') return night ? PAINTED_NIGHT : PAINTED_DAY;
  if (look === 'realistic') return night ? REALISTIC_NIGHT : REALISTIC_DAY;
  return night ? NIGHT : DAY;
}

/**
 * Switches the scene between day and night. Nothing is added or removed: the lamps' lights are
 * switched on or off, and tagged materials change how brightly they glow. With `realLamps`
 * (ray traced shadows on), the ceiling lamps shine by day too and the glows faking the lamps'
 * light on the ground are dimmed, so the real light, its shadows and the corner shading show.
 * Without `power` the ceiling lamps are out, day or night, and so is all they light, and the
 * garden lamps are out too.
 */
export function setTimeOfDay(
  scene: THREE.Scene,
  hemi: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  night: boolean,
  realLamps = false,
  power = true,
  look: VisualStyle = 'classic',
): void {
  const s = lightingFor(look, night);
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
  setMetalShine(night ? 0.3 : 1);

  const lampsOn = power && (night || realLamps);
  const seen = new Set<THREE.Material>();
  scene.traverse((o) => {
    if (o.userData[NIGHT_ONLY]) {
      o.visible = o.userData[LAMP_LIT] ? lampsOn : night && (power || !o.userData[POWERED]);
      (o as THREE.Light).intensity = (o.userData[POWER] as number) * (realLamps ? TRACED_LIGHT : 1);
    }
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const material of Array.isArray(m) ? m : [m]) {
      if (seen.has(material)) continue;
      seen.add(material);
      const at = material.userData[AT_NIGHT] as number | undefined;
      if (at === undefined) continue;
      const key = glowKey(material);
      const lit = material as unknown as Record<typeof key, number>;
      // `mergeStatic` makes its materials anew, copying the night's value only: as made, they
      // still show the day's (nothing changes them before they are first seen here).
      material.userData[BY_DAY] ??= lit[key];
      const lamp = material.userData[LAMP_LIT] || material.userData[POWERED];
      const on = material.userData[LAMP_LIT] ? lampsOn : night;
      const value = lamp && !power ? 0 : on ? at : (material.userData[BY_DAY] as number);
      lit[key] = realLamps && material.userData[GLOW_POOL] ? value * TRACED_POOL : value;
    }
  });
}
