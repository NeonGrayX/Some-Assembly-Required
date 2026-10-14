import * as THREE from 'three';
import type { VisualStyle } from '../graphics-settings.ts';

/**
 * The sky in the realistic style: a dome round the camera, deep blue overhead and paling to a
 * haze at the horizon (the fog's own colour, so the far fence fades straight into it), with a
 * glow round the sun and soft clouds drifting across. At night it is dark blue with stars and
 * the moon where the sun was (the sun turns into the moon, see `daynight.ts`).
 *
 * The painted style's sky is deeper and bluer, with long brushed streaks of cloud swept across
 * it and heaps of cumulus painted in flat tones round the horizon, the way skies are painted
 * behind the key art of an adventure game.
 *
 * The sky also lights the scene in both (see `bakeLight`): its picture, with the ground under
 * it, is turned into a light probe, so shade takes the sky's blue and glossy things reflect its
 * colours.
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
  zenith: 0x1d62c2,
  horizon: 0xbfe2f4,
  glow: 0xffe6b8,
  clouds: 0xfff9ee,
  cloudShade: 0x8fa8d2,
  stars: 0,
};

const PAINTED_NIGHT: SkyLook = {
  zenith: 0x030a22,
  horizon: 0x0f1b3e,
  glow: 0xb4c8f5,
  clouds: 0x3c4c7e,
  cloudShade: 0x141d40,
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

#ifdef PAINTED
// How many cumulus lobes would fit round the horizon, side by side.
#define LOBES 72.0

/**
 * One row of a cumulus heap's lobes round the horizon at \`x\` (in lobes): the top of the
 * highest lobe there, its radius, and how far off its middle it is, across and up. A row's
 * lobes stand on its \`rise\` above the base, one a lobe apart, \`offset\` along.
 */
vec4 lobes( float x, float heap, float rise, float offset ) {
  vec4 best = vec4( 0.0, 1.0, 0.0, -1.0 );
  for ( int k = -1; k <= 1; k ++ ) {
    float id = mod( floor( x - offset ) + float( k ), LOBES );
    float h = hash( vec2( id, 5.1 + offset ) );
    float dx = mod( x - offset - ( id + 0.5 + ( h - 0.5 ) * 0.5 ) + LOBES * 0.5, LOBES )
      - LOBES * 0.5;
    float r = ( 0.55 + 0.5 * fract( h * 13.7 ) ) * ( 0.45 + 0.65 * heap );
    float bump = sqrt( max( r * r - dx * dx, 0.0 ) );
    // Sinking into the base towards the heap's ends, so it ends in small domes, not slivers.
    float sink = 1.1 - 0.8 * smoothstep( 0.0, 0.35, heap );
    float top = heap * heap * rise * ( 0.8 + 0.4 * fract( h * 7.31 ) ) + bump - r * sink;
    if ( top > best.x ) best = vec4( top, r, dx, top - bump );
  }
  return best;
}

/**
 * Heaps of cumulus standing round the horizon on a flat base, their tops round lobes, highest
 * in the middle of the heap, with a lower row of lobes in front of them. Painted in three flat
 * tones: a blue-grey body, the round face of each lobe lit in the sun's colour where it turns
 * towards the sun, and a darker blue-grey along the base. Worked out round the horizon (\`x\`, in
 * lobes) and up from it in the same units, so the lobes stay round; the heaps come and go along
 * the horizon with a smooth noise. Returns the colour and how much of the sky it covers.
 */
vec4 cumulus( vec3 dir, float up, float toSun ) {
  // Read on a circle round the horizon, so the heaps join up behind the camera.
  float heap = smoothstep( 0.45, 0.85, noise( normalize( dir.xz ) * 2.6 + 11.0 ) );
  if ( heap <= 0.0 ) return vec4( 0.0 );
  float x = atan( dir.z, dir.x ) * ( LOBES / 6.2832 );
  // Up from the clouds' flat base.
  float y = up * ( LOBES / 6.2832 ) - 0.8;
  const float soft = 0.04;
  vec4 back = lobes( x, heap, 2.2, 0.0 );
  vec4 front = lobes( x, heap, 1.0, 0.5 );
  // The front row in front wherever it stands, the back row over it.
  bool before = y < front.x;
  vec4 lobe = before ? front : back;
  float top = max( back.x, front.x );
  float cover = smoothstep( 0.0, soft, y ) * ( 1.0 - smoothstep( top - soft, top, y ) );
  float sunX = atan( sunDir.z, sunDir.x ) * ( LOBES / 6.2832 );
  float side = clamp( mod( sunX - x + LOBES * 0.5, LOBES ) - LOBES * 0.5, -1.0, 1.0 ) * 0.6;
  // Where on the lobe's ball this is, and so which way its surface faces.
  vec2 at = vec2( lobe.z, y - lobe.w ) / lobe.y;
  float off = dot( at, at );
  vec3 normal = vec3( at, sqrt( max( 1.0 - off, 0.0 ) ) );
  float lit = step( off, 1.0 )
    * smoothstep( 0.25, 0.35, dot( normal, normalize( vec3( side, 1.0, 0.7 ) ) ) );
  // The shaded base no more than a third of the cloud's height, so small ones are still white.
  float base = min( 0.35, top * 0.3 );
  float under = 1.0 - smoothstep( base - 0.05, base + 0.05, y );
  vec3 c = mix( clouds, cloudShade, 0.5 );
  c = mix( c, clouds + glow * pow( toSun, 4.0 ) * 0.35, lit );
  c = mix( c, cloudShade, under );
  // The back row a shade darker just over the front row's lobes, behind them.
  if ( ! before ) c *= 1.0 - 0.08 * ( 1.0 - smoothstep( 0.0, 0.25, y - front.x ) );
  // Hazier the lower they stand, towards the horizon's own colour.
  c = mix( c, horizon, 0.3 * ( 1.0 - smoothstep( 0.0, 2.5, y ) ) );
  return vec4( c, cover );
}

/**
 * The painted sky: a deep, saturated blue overhead, paling quickly to a bright haze at the
 * horizon, washed unevenly as if by a broad brush, with long brushed streaks of cloud swept
 * across it on a slant, the cumulus heaps round the horizon in front of them, and a warm glow
 * round the sun. At night, the same in deep navy, with stars and moonlit clouds.
 */
vec3 paintedSky( vec3 dir, float up ) {
  float toSun = max( dot( dir, sunDir ), 0.0 );
  float high = max( up, 0.0 );
  // The streaks' plane overhead, flattened so they bunch up less towards the horizon, swept
  // round to their slant and bent into long curves.
  vec2 q = mat2( 0.8, -0.6, 0.6, 0.8 ) * ( dir.xz / ( high + 0.5 ) * 2.0 );
  q.y += q.x * q.x * 0.07;
  q.x += time * 0.006;
  vec3 c = mix( horizon, zenith, pow( smoothstep( -0.02, 0.85, up ), 0.5 ) );
  c *= 1.0 + ( noise( q * 0.12 + 3.0 ) - 0.5 ) * 0.14 * smoothstep( 0.0, 0.3, up );
  c += glow * ( pow( toSun, 6.0 ) * 0.3 + pow( toSun, 48.0 ) * 0.45 ) * ( 1.0 - 0.7 * stars );
  float disc = smoothstep( 0.9994, 0.9997, toSun );
  c = mix( c, glow * mix( 1.6, 1.1, stars ), disc );

  if ( stars > 0.0 && up > 0.0 ) {
    vec2 cell = floor( dir.xz / ( up + 0.4 ) * 180.0 + dir.y * 40.0 );
    float h = hash( cell );
    float star = step( 0.994, h ) * ( 0.6 + 0.4 * sin( time * 2.0 + h * 400.0 ) );
    c += vec3( star ) * stars * smoothstep( 0.05, 0.3, up ) * ( 1.0 - disc );
  }

  if ( up > 0.0 ) {
    // Each stroke paler and thicker in its middle, thinning at its ends, with the bristles'
    // lines along it (smoothed out where they would get finer than a pixel).
    float s = noise( vec2( q.x * 0.25, q.y * 2.0 ) ) * 0.65
      + noise( vec2( q.x * 0.6, q.y * 4.5 ) + 7.0 ) * 0.35;
    float stroke = smoothstep( 0.5, 0.85, s );
    float lines = q.y * 40.0;
    float bristles = mix( noise( vec2( q.x * 0.9, lines ) ), 0.5,
      smoothstep( 0.3, 0.9, fwidth( lines ) ) );
    // (None where they are seen end on, towards the sun and away from it: they ran up from the
    // horizon there like beams of light.)
    float along = abs( dot( dir.xz / max( length( dir.xz ), 1e-4 ), vec2( 0.8, 0.6 ) ) );
    float wisp = stroke * ( 0.55 + 0.45 * bristles ) * smoothstep( 0.06, 0.4, up )
      * ( 1.0 - smoothstep( 0.6, 0.95, along ) );
    vec3 brush = mix( cloudShade, clouds, 0.5 + 0.5 * stroke ) + glow * pow( toSun, 5.0 ) * 0.2;
    c = mix( c, brush, wisp * 0.7 );
  }
  // (Never near straight up or down, where the way round the horizon is not defined.)
  if ( up > -0.02 && up < 0.4 ) {
    vec4 heaps = cumulus( dir, up, toSun );
    c = mix( c, heaps.rgb, heaps.a );
  }
  return c;
}
#else
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
#endif

void main() {
  vec3 dir = normalize( vDir );
  float up = dir.y;
  #ifdef PAINTED
    vec3 c = paintedSky( dir, up );
  #else
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
  #endif
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * How big each face of the cube the sky is baked into is: a light probe keeps only its broad
 * shape, so a few pixels a face are plenty.
 */
const BAKE_SIZE = 16;

/**
 * How much of the sky's colour its light keeps: in its full blue, the rooms (lit by it as if
 * through the roof) came out blue.
 */
const BAKE_SATURATION = 0.5;

export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly start = performance.now();
  /** What the sky is baked from: the sky itself and the ground under it (see `bakeLight`). */
  private readonly bakeScene = new THREE.Scene();
  private readonly bakeGround: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private bakeCube: THREE.WebGLCubeRenderTarget | null = null;
  private bakeCamera: THREE.CubeCamera | null = null;
  private bakePixels: Uint8Array | null = null;
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
   * The sky as it is now, with `ground` (lit as the ground is) below the horizon, as a light
   * probe: the light shade gets from the sky and what glossy things reflect of it. Read back
   * from a small cube once, so only when the time of day, the style or the level changes. (An
   * environment map looks much the same, but costs every pixel two filtered lookups into it.)
   */
  bakeLight(renderer: THREE.WebGLRenderer, ground: THREE.Color, probe: THREE.LightProbe): void {
    this.bakeCube ??= new THREE.WebGLCubeRenderTarget(BAKE_SIZE, {
      // Stored as sRGB so the dark night sky keeps its shades in 8 bits.
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: false,
    });
    this.bakeCamera ??= new THREE.CubeCamera(0.05, 20, this.bakeCube);
    this.bakeGround.material.color.copy(ground);
    const target = renderer.getRenderTarget();
    this.bakeCamera.update(renderer, this.bakeScene);
    renderer.setRenderTarget(target);
    const pixels = (this.bakePixels ??= new Uint8Array(BAKE_SIZE * BAKE_SIZE * 4));
    projectCube(renderer, this.bakeCube, pixels, probe.sh);
    for (const c of probe.sh.coefficients) {
      const grey = c.x * 0.2126 + c.y * 0.7152 + c.z * 0.0722;
      c.lerp(toPixel.setScalar(grey), 1 - BAKE_SATURATION);
    }
  }
}

const corner = new THREE.Vector3();
const toPixel = new THREE.Vector3();
const colour = new THREE.Color();
const basis = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * Projects what `cube` shows onto `sh` (as three.js's `LightProbeGenerator` does, but reading
 * the pixels back at once rather than over the next frames).
 */
function projectCube(
  renderer: THREE.WebGLRenderer,
  cube: THREE.WebGLCubeRenderTarget,
  pixels: Uint8Array,
  sh: THREE.SphericalHarmonics3,
): void {
  const size = cube.width;
  const pixel = 2 / size;
  const c = sh.zero().coefficients;
  let total = 0;
  for (let face = 0; face < 6; face++) {
    renderer.readRenderTargetPixels(cube, 0, 0, size, size, pixels, face);
    for (let i = 0; i < pixels.length; i += 4) {
      colour.setRGB(
        pixels[i]! / 255,
        pixels[i + 1]! / 255,
        pixels[i + 2]! / 255,
        THREE.SRGBColorSpace,
      );
      const index = i / 4;
      const col = -(1 - ((index % size) + 0.5) * pixel);
      const row = 1 - (Math.floor(index / size) + 0.5) * pixel;
      if (face === 0) corner.set(1, row, -col);
      else if (face === 1) corner.set(-1, row, col);
      else if (face === 2) corner.set(col, 1, -row);
      else if (face === 3) corner.set(col, -1, row);
      else if (face === 4) corner.set(col, row, 1);
      else corner.set(-col, row, -1);
      // Each pixel weighed by the solid angle it covers.
      const lengthSq = corner.lengthSq();
      const weight = 4 / (Math.sqrt(lengthSq) * lengthSq);
      total += weight;
      THREE.SphericalHarmonics3.getBasisAt(toPixel.copy(corner).normalize(), basis);
      for (let j = 0; j < 9; j++) {
        c[j]!.x += basis[j]! * colour.r * weight;
        c[j]!.y += basis[j]! * colour.g * weight;
        c[j]!.z += basis[j]! * colour.b * weight;
      }
    }
  }
  for (const v of c) v.multiplyScalar((4 * Math.PI) / total);
}
