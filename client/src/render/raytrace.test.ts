import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { patchLightLoop } from './raytrace.ts';

describe('ray traced shadows', () => {
  it("fit into this three.js version's light loop: one ray per point light, spot and sun", () => {
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const patched = patchLightLoop(chunk);
    expect(patched.match(/rtVisible\(/g)).toHaveLength(3);
    // Each ray goes in just before its light is applied, inside that light's own loop.
    const point = patched.indexOf('pointLight.position, 0.0');
    const spot = patched.indexOf('spotLight.position, 0.0');
    expect(spot).toBeGreaterThan(patched.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'));
    expect(spot).toBeLessThan(patched.indexOf('#if ( NUM_SUN_LIGHTS > 0 )'));
    const sun = patched.indexOf('directLight.direction, viewMatrix');
    expect(point).toBeGreaterThan(patched.indexOf('#if ( NUM_POINT_LIGHTS > 0 )'));
    expect(point).toBeLessThan(patched.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )'));
    expect(sun).toBeGreaterThan(patched.indexOf('#if ( NUM_DIR_LIGHTS > 0 )'));
    expect(sun).toBeLessThan(patched.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )'));
    // Nothing else changed.
    expect(patched.replace(/\n\t\t#ifdef USE_RT_SHADOWS[\s\S]*?#endif\n/g, '')).toBe(chunk);
  });
});
