import * as THREE from 'three';
import { BVHShaderGLSL, MeshBVH, MeshBVHUniformStruct } from 'three-mesh-bvh';
import { KEEP_SEPARATE } from './merge.ts';

/**
 * Ray traced shadows for the sun and the ceiling lamps. Browsers give no access to ray tracing
 * hardware, so the shaders trace themselves: every lit pixel sends one ray towards each light
 * through a bounding volume hierarchy of the house (walls, roof, furniture: everything that
 * never moves), built once when the level loads. Things that move (players, bricks, the dog,
 * doors) keep casting into an ordinary shadow map, and the two multiply.
 *
 * Exact and leak-free, so no shading tricks are needed to keep the sun out of the rooms, and the
 * lamps get shadows too. The cost is the rays: about one per lit pixel and light, which a gaming
 * graphics card shrugs off and a laptop's built-in one feels.
 */

const DEFINE = 'USE_RT_SHADOWS';

/** One ray from the surface to a light at a position (point and spot lights). */
const towards = (light: string) => /* glsl */ `
		#ifdef ${DEFINE}
		if ( directLight.visible ) {
			vec3 rtN = inverseTransformDirection( geometryNormal, viewMatrix );
			vec3 rtLight = ( vec4( ${light}.position, 0.0 ) * viewMatrix ).xyz + cameraPosition;
			vec3 rtTo = rtLight - vRtWorld;
			float rtDist = length( rtTo );
			vec3 rtL = rtTo / rtDist;
			if ( dot( rtN, rtL ) > 0.0 ) {
				directLight.color *= rtVisible( vRtWorld + rtN * RT_OFFSET, rtL, rtDist - RT_FIXTURE );
			}
		}
		#endif
`;

/** Inserted into the directional light loop: one ray towards the sun. */
const SUN_PATCH = /* glsl */ `
		#ifdef ${DEFINE}
		if ( directLight.visible ) {
			vec3 rtN = inverseTransformDirection( geometryNormal, viewMatrix );
			vec3 rtL = inverseTransformDirection( directLight.direction, viewMatrix );
			if ( dot( rtN, rtL ) > 0.0 ) {
				directLight.color *= rtVisible( vRtWorld + rtN * RT_OFFSET, rtL, 1e4 );
			}
		}
		#endif
`;

const RE_DIRECT =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

/**
 * three.js's light loop with a shadow ray added to its point, spot and directional lights, just
 * before each light is applied. Throws if three.js changed the loop so the patch no longer fits.
 */
export function patchLightLoop(chunk: string): string {
  const insertBefore = (text: string, section: string, patch: string) => {
    const start = text.indexOf(section);
    const at = start < 0 ? -1 : text.indexOf(RE_DIRECT, start);
    if (at < 0) throw new Error(`ray traced shadows: no ${section} in the light loop`);
    const lineStart = text.lastIndexOf('\n', at) + 1;
    return text.slice(0, lineStart) + patch + text.slice(lineStart);
  };
  let out = insertBefore(chunk, '#if ( NUM_POINT_LIGHTS > 0 )', towards('pointLight'));
  out = insertBefore(out, '#if ( NUM_SPOT_LIGHTS > 0 )', towards('spotLight'));
  out = insertBefore(out, '#if ( NUM_DIR_LIGHTS > 0 )', SUN_PATCH);
  return out;
}

const FRAGMENT_HEAD = /* glsl */ `
#ifdef ${DEFINE}
	#ifndef BVH_STACK_DEPTH
	#define BVH_STACK_DEPTH 60
	#endif
	#define RT_OFFSET 0.02
	// A lamp's own shade or lantern never shadows its bulb: hits this close to it do not count.
	#define RT_FIXTURE 0.35
	precision highp usampler2D;
	${BVHShaderGLSL.common_functions}
	${BVHShaderGLSL.bvh_struct_definitions}
	${BVHShaderGLSL.bvh_ray_functions}
	uniform BVH rtBvh;
	varying vec3 vRtWorld;

	/** 0 if anything that never moves lies within maxDist along the ray, 1 if not. */
	float rtVisible( vec3 origin, vec3 dir, float maxDist ) {
		uvec4 faceIndices = uvec4( 0u );
		vec3 faceNormal = vec3( 0.0 );
		vec3 barycoord = vec3( 0.0 );
		float side = 1.0;
		float dist = 0.0;
		bool hit = bvhIntersectFirstHit( rtBvh, origin, dir, faceIndices, faceNormal, barycoord, side, dist );
		return ( hit && dist < maxDist ) ? 0.0 : 1.0;
	}
#endif
`;

const VERTEX_HEAD = /* glsl */ `
#ifdef ${DEFINE}
	varying vec3 vRtWorld;
#endif
`;

const VERTEX_BODY = /* glsl */ `
#ifdef ${DEFINE}
	vec4 rtPosition = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		rtPosition = instanceMatrix * rtPosition;
	#endif
	vRtWorld = ( modelMatrix * rtPosition ).xyz;
#endif
`;

/** The house's static geometry, traced by every lit material while ray traced shadows are on. */
export class RayTracer {
  private readonly bvh = new MeshBVHUniformStruct();
  private readonly lightLoop = patchLightLoop(THREE.ShaderChunk.lights_fragment_begin);
  /** How many triangles the house came to, for the curious. */
  triangles = 0;

  /**
   * Builds the hierarchy from every mesh under `roots` that casts a shadow: subtrees marked
   * `KEEP_SEPARATE` (doors, drawers) and anything see-through are left out. Returns the meshes
   * used, which then no longer need to cast into the shadow map.
   */
  build(roots: THREE.Object3D[]): THREE.Mesh[] {
    for (const r of roots) r.updateMatrixWorld(true);
    const parts: Float32Array[] = [];
    const used: THREE.Mesh[] = [];
    const v = new THREE.Vector3();
    const visit = (o: THREE.Object3D) => {
      if (o.userData[KEEP_SEPARATE] || !o.visible) return;
      o.children.forEach(visit);
      if (!(o instanceof THREE.Mesh) || !o.castShadow) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      if (materials.some((m: THREE.Material) => m.transparent)) return;
      const g = o.geometry as THREE.BufferGeometry;
      const pos = g.attributes.position;
      if (!pos) return;
      const index = g.index;
      const count = index ? index.count : pos.count;
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(o.matrixWorld);
        out[i * 3] = v.x;
        out[i * 3 + 1] = v.y;
        out[i * 3 + 2] = v.z;
      }
      parts.push(out);
      used.push(o);
    };
    roots.forEach(visit);
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(all, 3));
    this.triangles = all.length / 9;
    this.bvh.updateFrom(new MeshBVH(geometry, { targetLeafSize: 4 }));
    return used;
  }

  /** Adds the tracing to a lit material's shaders (from `onBeforeCompile`). */
  patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
    if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) return;
    shader.defines = { ...shader.defines, [DEFINE]: '' };
    shader.uniforms.rtBvh = { value: this.bvh };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERTEX_HEAD}\nvoid main() {`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${FRAGMENT_HEAD}\nvoid main() {`)
      .replace('#include <lights_fragment_begin>', this.lightLoop);
  }

  dispose(): void {
    this.bvh.dispose();
  }
}
