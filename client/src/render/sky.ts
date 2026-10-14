import * as THREE from 'three';

/**
 * The sky in the realistic style: a dome round the camera, deep blue overhead and paling to a
 * haze at the horizon (the fog's own colour, so the far fence fades straight into it), with a
 * glow round the sun and soft clouds drifting across. At night it is dark blue with stars and
 * the moon where the sun was (the sun turns into the moon, see `daynight.ts`).
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
  }
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly start = performance.now();

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
    this.setTime(false, new THREE.Vector3(10, 8, 7.5));
  }

  /** Day or night, with the sun (or moon) towards `sunDir`. */
  setTime(night: boolean, sunDir: THREE.Vector3): void {
    const look = night ? NIGHT : DAY;
    const u = this.material.uniforms;
    for (const k of ['zenith', 'horizon', 'glow', 'clouds', 'cloudShade'] as const)
      (u[k]!.value as THREE.Color).set(look[k]);
    u.stars!.value = look.stars;
    (u.sunDir!.value as THREE.Vector3).copy(sunDir).normalize();
  }
}
