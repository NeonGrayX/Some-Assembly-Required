import * as THREE from 'three';
import type { VisualStyle } from '../graphics-settings.ts';

/**
 * The sky in the realistic style: a dome round the camera, deep blue overhead and paling to a
 * haze at the horizon (the fog's own colour, so the far fence fades straight into it), with a
 * glow round the sun and soft clouds drifting across. At night it is dark blue with stars and
 * the moon where the sun was (the sun turns into the moon, see `daynight.ts`).
 *
 * The painted style's sky is deeper and bluer, with long brushed streaks of cloud swept across
 * it over the soft heaps, the way skies are painted behind the key art of an adventure game.
 *
 * The sky also lights the scene in both (see `bake`): its picture, with the ground under it, is
 * blurred into an environment map, so shade takes the sky's blue and glossy things reflect it.
 *
 * The other styles keep their flat sky colour: the outlines and washes of their screen pass are
 * worked out over the sky as well, and the classic style adds nothing at all.
 */

/** How the sky looks at one time of day; the horizon is the fog's colour. */
interface SkyLook {
  zenith: number;
  horizon: number;
  glow: number;
  clouds: number;
  cloudShade: number;
  stars: number;
}

const DAY: SkyLook = {
  zenith: 0x4a8fd6,
  horizon: 0x9fc9e8,
  glow: 0xfff1d6,
  clouds: 0xffffff,
  cloudShade: 0xb9c7d6,
  stars: 0,
};

const NIGHT: SkyLook = {
  zenith: 0x02040c,
  horizon: 0x070b18,
  glow: 0x9fb6e6,
  clouds: 0x1c2438,
  cloudShade: 0x0a0e1a,
  stars: 1,
};

const PAINTED_DAY: SkyLook = {
  zenith: 0x1f63c4,
  horizon: 0xb4dcf2,
  glow: 0xfff0c8,
  clouds: 0xffffff,
  cloudShade: 0xa7bdda,
  stars: 0,
};

const PAINTED_NIGHT: SkyLook = {
  zenith: 0x040a1e,
  horizon: 0x0b1430,
  glow: 0xb4c8f5,
  clouds: 0x26325a,
  cloudShade: 0x0d1430,
  stars: 1,
};

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  // On the far plane, behind everything.
  gl_Position = p.xyww;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 glow;
uniform vec3 clouds;
uniform vec3 cloudShade;
uniform vec3 sunDir;
uniform float stars;
uniform float time;
varying vec3 vDir;

float hash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float noise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ),
              mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
}
float fbm( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i ++ ) {
    v += a * noise( p );
    p = p * 2.07 + 13.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize( vDir );
  float up = dir.y;
  // Pale at the horizon, deepening overhead, and haze all the way down below it (seen from up
  // high, past the level's edge), the fog's colour.
  vec3 c = mix( horizon, zenith, pow( smoothstep( 0.0, 1.0, up ), 0.55 ) );
  float toSun = max( dot( dir, sunDir ), 0.0 );
  // The glow round the sun (or moon), wide and faint, and its disc.
  c += glow * ( pow( toSun, 8.0 ) * 0.25 + pow( toSun, 64.0 ) * 0.35 ) * ( 1.0 - 0.7 * stars );
  float disc = smoothstep( 0.9994, 0.9997, toSun );
  c = mix( c, glow * mix( 1.6, 1.1, stars ), disc );

  // Stars, twinkling a little, only well above the haze.
  if ( stars > 0.0 && up > 0.0 ) {
    vec2 cell = floor( dir.xz / ( up + 0.4 ) * 180.0 + dir.y * 40.0 );
    float h = hash( cell );
    float star = step( 0.994, h ) * ( 0.6 + 0.4 * sin( time * 2.0 + h * 400.0 ) );
    c += vec3( star ) * stars * smoothstep( 0.05, 0.3, up ) * ( 1.0 - disc );
  }

  // Clouds on a plane overhead, thinning towards the horizon where they would bunch up.
  if ( up > 0.0 ) {
    vec2 p = dir.xz / ( up + 0.12 ) * 1.4 + vec2( time * 0.006, time * 0.002 );
    float n = fbm( p );
    float cover = smoothstep( 0.5, 0.78, n ) * smoothstep( 0.0, 0.25, up );
    // Lit on top, shaded underneath where they are thick, bright towards the sun. (Their
    // thickness is the same noise: a second one cost as much again on slow graphics.)
    float thick = smoothstep( 0.62, 0.85, n );
    vec3 cloud = mix( clouds, cloudShade, thick * 0.6 ) + glow * pow( toSun, 6.0 ) * 0.25;
    c = mix( c, cloud, cover * 0.85 );
    #ifdef PAINTED
    {
      // Long brushed streaks swept across the sky on a slant, thinning at their ends, each
      // stroke a little brighter along its upper edge.
      vec2 q = dir.xz / ( up + 0.18 ) * 0.9 + vec2( time * 0.004, 0.0 );
      vec2 r = mat2( 0.8, -0.6, 0.6, 0.8 ) * q;
      float streak = fbm( vec2( r.x * 0.35, r.y * 3.2 ) );
      float wisp = smoothstep( 0.52, 0.8, streak ) * smoothstep( 0.02, 0.35, up )
        * ( 0.55 + 0.45 * noise( r * 0.6 + 4.0 ) );
      float edge = smoothstep( 0.6, 0.85, fbm( vec2( r.x * 0.35, r.y * 3.2 - 0.12 ) ) );
      vec3 brush = mix( clouds, cloudShade, 0.25 ) * ( 0.92 + 0.12 * edge );
      c = mix( c, brush + glow * pow( toSun, 5.0 ) * 0.2, wisp * 0.7 * ( 1.0 - cover * 0.6 ) );
    }
    #endif
  }
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** How big each face of the cube the sky is baked into is (it is blurred anyway). */
const BAKE_SIZE = 64;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly start = performance.now();
  /** What the sky is baked from: the sky itself and the ground under it (see `bake`). */
  private readonly bakeScene = new THREE.Scene();
  private readonly bakeGround: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private bakeCube: THREE.WebGLCubeRenderTarget | null = null;
  private bakeCamera: THREE.CubeCamera | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private baked: THREE.WebGLRenderTarget | null = null;
  private painted = false;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        zenith: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        glow: { value: new THREE.Color() },
        clouds: { value: new THREE.Color() },
        cloudShade: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        stars: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      // Drawn after the solid things, only where none of them is (and left out of the ambient
      // occlusion pass, which takes see-through things away).
      transparent: true,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    // Never in the way of what the player aims at.
    this.mesh.raycast = () => {};
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      // Centred on the camera, so it is always the same distance off whichever way it looks.
      camera.getWorldPosition(this.mesh.position);
      this.mesh.updateMatrixWorld();
      this.material.uniforms.time!.value = (performance.now() - this.start) / 1000;
    };
    // The sky's picture to bake: the same dome, round the cube's camera, over the ground.
    const dome = new THREE.Mesh(this.mesh.geometry, this.material);
    dome.frustumCulled = false;
    this.bakeGround = new THREE.Mesh(
      new THREE.CircleGeometry(5, 24),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
    );
    this.bakeGround.rotation.x = -Math.PI / 2;
    this.bakeGround.position.y = -0.4;
    this.bakeScene.add(dome, this.bakeGround);
    this.setTime(false, new THREE.Vector3(10, 8, 7.5));
  }

  /** Day or night, with the sun (or moon) towards `sunDir`, as the style draws it. */
  setTime(night: boolean, sunDir: THREE.Vector3, style: VisualStyle = 'realistic'): void {
    const painted = style === 'painted';
    if (painted !== this.painted) {
      this.painted = painted;
      this.material.defines = painted ? { PAINTED: '' } : {};
      this.material.needsUpdate = true;
    }
    const look = painted ? (night ? PAINTED_NIGHT : PAINTED_DAY) : night ? NIGHT : DAY;
    const u = this.material.uniforms;
    for (const k of ['zenith', 'horizon', 'glow', 'clouds', 'cloudShade'] as const)
      (u[k]!.value as THREE.Color).set(look[k]);
    u.stars!.value = look.stars;
    (u.sunDir!.value as THREE.Vector3).copy(sunDir).normalize();
  }

  /**
   * The sky as it is now, with `ground` (lit as the ground is) below the horizon, blurred into
   * an environment map for `scene.environment`: what lights shade and what glossy things
   * reflect. A few milliseconds, so only when the time of day, the style or the level changes.
   */
  bake(renderer: THREE.WebGLRenderer, ground: THREE.Color): THREE.Texture {
    this.bakeCube ??= new THREE.WebGLCubeRenderTarget(BAKE_SIZE, { type: THREE.HalfFloatType });
    this.bakeCamera ??= new THREE.CubeCamera(0.05, 20, this.bakeCube);
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    this.bakeGround.material.color.copy(ground);
    const target = renderer.getRenderTarget();
    this.bakeCamera.update(renderer, this.bakeScene);
    this.baked = this.pmrem.fromCubemap(this.bakeCube.texture, this.baked);
    renderer.setRenderTarget(target);
    return this.baked.texture;
  }
}
