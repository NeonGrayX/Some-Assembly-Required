import * as THREE from 'three';

/**
 * The reference picture's sky: a deep, even blue overhead paling toward the sea, with long soft
 * wisps of cloud swept across it in broad curves, brightest in their middles and fraying at
 * their ends. A dome round the camera, drawn behind everything.
 */

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 wisp;
uniform float time;
uniform vec3 glowDir;
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
  return 0.5 * noise( p ) + 0.25 * noise( p * 2.1 + 3.7 ) + 0.125 * noise( p * 4.3 + 1.3 ) + 0.0625;
}

void main() {
  vec3 dir = normalize( vDir );
  float up = dir.y;
  vec3 c = mix( horizon, zenith, pow( smoothstep( -0.05, 0.75, up ), 0.6 ) );
  // Paler and brighter on the sun's side, low down: the haze it lights.
  float side = max( dot( normalize( vec3( dir.x, 0.0, dir.z ) + 1e-4 ), glowDir ), 0.0 );
  c = mix( c, mix( horizon, vec3( 0.86, 0.95, 1.0 ), 0.3 ), side * side * ( 1.0 - smoothstep( 0.0, 0.8, up ) ) * 0.85 );
  if ( up > 0.0 ) {
    // The wisps on a plane overhead, stretched long across the view and bent into curves.
    vec2 q = dir.xz / ( up + 0.18 ) * 3.0;
    q = mat2( 0.96, -0.28, 0.28, 0.96 ) * q;
    q.y += sin( q.x * 0.21 ) * 0.7 + q.x * q.x * 0.008;
    q.x += time * 0.004;
    float band = fbm( vec2( q.x * 0.22, q.y * 1.6 ) );
    float body = smoothstep( 0.5, 0.9, band );
    // Brushed streaks along each wisp, frayed at its edges.
    float streaks = noise( vec2( q.x * 0.5, q.y * 14.0 ) );
    float w = body * ( 0.75 + 0.25 * streaks ) * smoothstep( 0.04, 0.3, up );
    c = mix( c, wisp, clamp( w * 0.5, 0.0, 1.0 ) );
    // Broad soft drifts of haze between the wisps.
    float drift = smoothstep( 0.45, 0.8, fbm( q * vec2( 0.06, 0.3 ) + 9.0 ) );
    c = mix( c, wisp, drift * 0.22 * smoothstep( 0.02, 0.25, up ) );
    // A faint wash of lighter blue through the sky.
    c += vec3( 0.03, 0.05, 0.08 ) * ( fbm( q * 0.15 + 5.0 ) - 0.5 );
  }
  gl_FragColor = vec4( c, 1.0 );
  #include <colorspace_fragment>
}
`;

export class PaintedSky {
  readonly mesh: THREE.Mesh;
  private readonly start = performance.now();

  constructor() {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        zenith: { value: new THREE.Color(0x2c72c0) },
        horizon: { value: new THREE.Color(0xa8e0f8) },
        wisp: { value: new THREE.Color(0xeef6fa) },
        time: { value: 0 },
        glowDir: { value: new THREE.Vector3(-0.85, 0, 0.5).normalize() },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.raycast = () => {};
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      camera.getWorldPosition(this.mesh.position);
      this.mesh.updateMatrixWorld();
      material.uniforms.time!.value = (performance.now() - this.start) / 1000;
    };
  }
}
