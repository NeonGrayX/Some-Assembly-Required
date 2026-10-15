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
 * The studio as the car's reflections and all-round light see it: the pale floor below, grey
 * walls darkening upward, a big softbox high behind the car on the picture's right and a long
 * strip light on the camera's side. In place of three.js's `RoomEnvironment`, whose bright
 * ceiling lit everything facing up twice as strongly as its sides.
 */
export function studioEnvironment(key: THREE.Vector3): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        floor: { value: new THREE.Color(0.42, 0.4, 0.37) },
        wall: { value: new THREE.Color(0.3, 0.31, 0.33) },
        top: { value: new THREE.Color(0.16, 0.17, 0.19) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 floor;
        uniform vec3 wall;
        uniform vec3 top;
        varying vec3 vDir;
        void main() {
          float up = normalize( vDir ).y;
          vec3 c = up < 0.0 ? mix( wall, floor, smoothstep( 0.0, 0.3, -up ) ) : mix( wall, top, smoothstep( 0.0, 0.8, up ) );
          gl_FragColor = vec4( c, 1.0 );
        }`,
    }),
  );
  scene.add(room);
  const panel = (w: number, h: number, intensity: number, at: THREE.Vector3) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(intensity, intensity, intensity),
        side: THREE.DoubleSide,
      }),
    );
    m.position.copy(at);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(5, 5, 2.2, key.clone().normalize().multiplyScalar(8));
  panel(7, 1.6, 1.4, new THREE.Vector3(2, 3, -8));
  return scene;
}
