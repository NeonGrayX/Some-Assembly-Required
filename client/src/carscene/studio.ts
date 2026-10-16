import * as THREE from 'three';

/**
 * The studio's backdrop: a seamless sweep, darkest high up, paling smoothly down past the
 * horizon into the floor (whose far edge takes the same sweep, see `FLOOR` in `ground.ts`), with
 * a soft pool of light thrown on it behind the car. A dome round the camera, drawn behind
 * everything.
 */

export const BACKDROP = {
  /** The sweep's colour looking well down at the floor, and well up. */
  low: { value: new THREE.Color() },
  top: { value: new THREE.Color() },
  /** The pool of light on it: its colour added, and the way it lies (level, from the car). */
  pool: { value: new THREE.Color() },
  poolDir: { value: new THREE.Vector3(-0.71, 0.05, 0.7).normalize() },
};

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}
`;

/**
 * The sweep, by how far up the view looks (`up`, the sine of its elevation): an even blend in
 * gamma, as a painted gradient, across about 17 degrees either side of the horizon.
 */
export const SWEEP_GLSL = /* glsl */ `
uniform vec3 sweepLow;
uniform vec3 sweepTop;
vec3 sweep( float up ) {
  float s = smoothstep( -0.22, 0.38, up );
  return pow( mix( pow( sweepLow, vec3( 1.0 / 2.2 ) ), pow( sweepTop, vec3( 1.0 / 2.2 ) ), s ), vec3( 2.2 ) );
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 pool;
uniform vec3 poolDir;
varying vec3 vDir;
${SWEEP_GLSL}
void main() {
  vec3 dir = normalize( vDir );
  vec3 c = sweep( dir.y );
  float near = max( dot( dir, poolDir ), 0.0 );
  c += pool * pow( near, 60.0 );
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function buildBackdrop(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      sweepLow: BACKDROP.low,
      sweepTop: BACKDROP.top,
      pool: BACKDROP.pool,
      poolDir: BACKDROP.poolDir,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.name = 'backdrop';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.raycast = () => {};
  mesh.onBeforeRender = (_r, _s, camera) => {
    camera.getWorldPosition(mesh.position);
    mesh.updateMatrixWorld();
  };
  return mesh;
}

/**
 * The studio as the car's reflections and all-round light see it: the lit floor below, a bright
 * band at the horizon, grey walls darkening upward, and softboxes: one high behind the car on
 * the picture's right, strips overhead and on the camera's side, and the lit backdrop. In place of three.js's `RoomEnvironment`, whose bright
 * ceiling lit everything facing up twice as strongly as its sides.
 */
export function studioEnvironment(key: THREE.Vector3): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        floor: { value: new THREE.Color(0.48, 0.46, 0.43) },
        under: { value: new THREE.Color(0.1, 0.1, 0.1) },
        wall: { value: new THREE.Color(0.14, 0.15, 0.16) },
        top: { value: new THREE.Color(0.06, 0.065, 0.075) },
        horizon: { value: new THREE.Color(0.62, 0.63, 0.65) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 floor;
        uniform vec3 under;
        uniform vec3 wall;
        uniform vec3 top;
        uniform vec3 horizon;
        varying vec3 vDir;
        void main() {
          float up = normalize( vDir ).y;
          // Below, the lit floor out toward the horizon, darker straight down: the flanks mirror
          // it, lighter along their tops than their feet.
          vec3 below = mix( mix( wall, floor, smoothstep( 0.0, 0.08, -up ) ), under, smoothstep( 0.14, 0.45, -up ) );
          vec3 c = up < 0.0 ? below : mix( wall, top, smoothstep( 0.0, 0.8, up ) );
          // The bright line where the backdrop sweeps into the floor: what runs along a car's
          // flanks in a studio picture.
          c = mix( c, horizon, exp( - pow( ( up - 0.04 ) / 0.07, 2.0 ) ) );
          gl_FragColor = vec4( c, 1.0 );
        }`,
    }),
  );
  scene.add(room);
  const panel = (w: number, h: number, intensity: number, at: THREE.Vector3, tint = 0xffffff) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(tint).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      }),
    );
    m.position.copy(at);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  // The key's softbox, a long strip overhead that lays a highlight along the bonnet and roof,
  // and the strip on the camera's side that runs one down the flanks.
  panel(4.5, 4.5, 1.2, key.clone().normalize().multiplyScalar(8));
  panel(9, 1.2, 0.8, new THREE.Vector3(0.5, 8, -1.5));
  panel(8, 1.0, 4, new THREE.Vector3(3, 3.2, -7.5));
  // The lit backdrop behind the car, low: what the bonnet and roof mirror, seen from the camera.
  panel(13, 4, 1.2, new THREE.Vector3(-0.69, 0.27, 0.67).multiplyScalar(8.5), 0xc8dcf0);
  return scene;
}
