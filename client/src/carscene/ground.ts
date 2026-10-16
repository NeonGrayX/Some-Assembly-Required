import * as THREE from 'three';
import { fbm, hash, noise, rng } from './kit.ts';
import { BACKDROP, SWEEP_GLSL } from './studio.ts';

/**
 * The ground the car stands on: a seamless studio floor, pale and warm round the car and greying
 * off into the distance, and on it a patch of cobbles set in moss with a ragged painted edge,
 * a scatter of single stones sunk in dark-rimmed holes round it, and tufts of bright grass.
 *
 * All of it is lit by one small shader of its own (`groundMaterial`): plain light from the key
 * and the studio round it, and soft shadows baked once into the floor (`bakeGroundShadows`), as
 * a big studio light casts them: blurred far from what casts them and dark close under it,
 * where shadow maps would draw them hard and grainy.
 */

/** Where the ground's baked shadows lie: the square they cover, in metres. */
export const BAKE = { x: 0.5, z: 0.5, size: 18, resolution: 1024 };

/** The light every ground material shares; the bake fills its two shadow textures in. */
export const GROUND_LIGHT = {
  tKey: { value: null as THREE.Texture | null },
  tSky: { value: null as THREE.Texture | null },
  bakeRect: {
    value: new THREE.Vector4(BAKE.x - BAKE.size / 2, BAKE.z + BAKE.size / 2, BAKE.size, BAKE.size),
  },
  keyDir: { value: new THREE.Vector3(0, 1, 0) },
  keyColour: { value: new THREE.Color(0.5, 0.5, 0.5) },
  ambient: { value: new THREE.Color(0.55, 0.55, 0.55) },
  /** How much of the studio's all-round light a shadow from above takes away. */
  skyDark: { value: 0.7 },
  /** How much of the key light its shadow takes away. */
  keyDark: { value: 0.85 },
};

/**
 * The floor's own colour, and how it fades with distance from `centre` (over `range`) into the
 * backdrop's sweep (`SWEEP_GLSL`), as seen from the camera, so no seam shows at the horizon.
 */
export const FLOOR = {
  near: { value: new THREE.Color(0xd9d1c5) },
  centre: { value: new THREE.Vector2(0.2, 0) },
  /** Half faded this far out (m), and how sharply. */
  range: { value: new THREE.Vector2(26, 1.25) },
};

const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vColour;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  vNormal = normalize( mat3( modelMatrix ) * normal );
  vUv = uv;
  #ifdef USE_COLOR
    vColour = color;
  #else
    vColour = vec3( 1.0 );
  #endif
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tKey;
uniform sampler2D tSky;
uniform vec4 bakeRect;
uniform vec3 keyDir;
uniform vec3 keyColour;
uniform vec3 ambient;
uniform float skyDark;
uniform float keyDark;
uniform vec3 tint;
uniform float shine;
uniform float grain;
${SWEEP_GLSL}
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float gNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1, 0 ) ), u.x ), mix( gHash( i + vec2( 0, 1 ) ), gHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float gFbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int k = 0; k < 4; k++ ) {
    s += a * gNoise( p );
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}
#ifdef USE_MAP
  uniform sampler2D map;
#endif
#ifdef FLOOR
  uniform vec3 floorNear;
  uniform vec2 floorCentre;
  uniform vec2 floorRange;
#endif
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying vec3 vColour;

void main() {
  vec3 albedo = tint * vColour;
  float alpha = 1.0;
  #ifdef USE_MAP
    vec4 t = texture2D( map, vUv );
    albedo *= t.rgb;
    alpha = t.a;
    if ( alpha < 0.004 ) discard;
  #endif
  #ifdef FLOOR
    albedo = floorNear;
    float fade = 1.0 - 1.0 / ( 1.0 + pow( distance( vWorld.xz, floorCentre ) / floorRange.x, floorRange.y ) );
  #endif
  vec2 b = vec2( ( vWorld.x - bakeRect.x ) / bakeRect.z, ( bakeRect.y - vWorld.z ) / bakeRect.w );
  float inside = step( 0.0, b.x ) * step( b.x, 1.0 ) * step( 0.0, b.y ) * step( b.y, 1.0 );
  float key = inside * texture2D( tKey, b ).a;
  float sky = inside * texture2D( tSky, b ).a;
  vec3 n = normalize( vNormal );
  if ( grain > 0.0 ) {
    // Grit: blotches and speckle in its colour, and a fine bumpiness that breaks up its light.
    vec2 q = vWorld.xz;
    float blotch = gFbm( q * 7.0 + 3.1 );
    float speck = gNoise( q * 70.0 );
    albedo *= mix( 1.0, 0.7 + 0.6 * blotch + 0.3 * ( speck - 0.5 ), grain );
    float e = 0.004;
    float h0 = gFbm( q * 22.0 );
    vec2 slope = vec2( gFbm( ( q + vec2( e, 0.0 ) ) * 22.0 ) - h0, gFbm( ( q + vec2( 0.0, e ) ) * 22.0 ) - h0 ) / e;
    n = normalize( n - grain * 0.012 * vec3( slope.x, 0.0, slope.y ) );
  }
  float lit = max( dot( n, keyDir ), 0.0 );
  vec3 light = ambient * ( 0.6 + 0.4 * n.y ) * ( 1.0 - sky * skyDark ) + keyColour * lit * ( 1.0 - key * keyDark );
  vec3 colour = albedo * light;
  if ( shine > 0.0 ) {
    // A wet sheen: the key's highlight, and the studio mirrored at a glance.
    vec3 v = normalize( cameraPosition - vWorld );
    float spec = pow( max( dot( n, normalize( v + keyDir ) ), 0.0 ), 60.0 ) * ( 1.0 - key * keyDark );
    float fres = 0.04 + 0.96 * pow( 1.0 - max( dot( n, v ), 0.0 ), 5.0 );
    colour += shine * ( keyColour * spec * 1.6 + sweep( reflect( -v, n ).y ) * fres * ( 1.0 - sky * skyDark ) );
  }
  gl_FragColor = vec4( colour, alpha );
  #ifdef FLOOR
    gl_FragColor.rgb = mix( gl_FragColor.rgb, sweep( normalize( vWorld - cameraPosition ).y ), fade );
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
blank.needsUpdate = true;

/**
 * A material lit like the rest of the ground: `colour`, times the vertex colours if
 * `vertexColors`, times `map` (whose alpha cuts it out) if given; `shine` wets it, with a
 * highlight and a little of the studio mirrored in it, and `grain` roughens it with grit.
 */
export function groundMaterial(
  colour: number,
  o: {
    map?: THREE.Texture;
    vertexColors?: boolean;
    floor?: boolean;
    shine?: number;
    grain?: number;
  } = {},
): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (o.map) defines.USE_MAP = '';
  if (o.floor) defines.FLOOR = '';
  if (!GROUND_LIGHT.tKey.value) GROUND_LIGHT.tKey.value = GROUND_LIGHT.tSky.value = blank;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...GROUND_LIGHT,
      tint: { value: new THREE.Color(colour) },
      shine: { value: o.shine ?? 0 },
      grain: { value: o.grain ?? 0 },
      map: { value: o.map ?? null },
      floorNear: FLOOR.near,
      sweepLow: BACKDROP.low,
      sweepTop: BACKDROP.top,
      floorCentre: FLOOR.centre,
      floorRange: FLOOR.range,
    },
    defines,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: o.vertexColors ?? false,
    transparent: !!o.map,
    depthWrite: !o.map,
  });
  return m;
}

/** A field over the ground: below 0 inside the patch, rising through 0 at its edge. */
export type Field = (x: number, z: number) => number;

/** A field over the ground: how far a point is outside `outline` (negative inside), in metres. */
function polygonField(outline: [number, number][]): Field {
  return (x, z) => {
    let inside = false;
    let best = Infinity;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, zi] = outline[i]!;
      const [xj, zj] = outline[j]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      const dx = xj - xi;
      const dz = zj - zi;
      const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - xi - t * dx, z - zi - t * dz));
    }
    return inside ? -best : best;
  };
}

/** Moss, its ragged rim and dark streaks, painted into a texture over `rect` (x0, z0, w, d). */
function patchTexture(
  field: Field,
  rect: [number, number, number, number],
  perMetre: number,
): THREE.DataTexture {
  const [x0, z0, w, d] = rect;
  const W = Math.round(w * perMetre);
  const H = Math.round(d * perMetre);
  const data = new Uint8Array(W * H * 4);
  const dark = [0x26, 0x30, 0x1c];
  const mid = [0x4a, 0x62, 0x2a];
  const light = [0x8a, 0xa8, 0x48];
  const dirt = [0x3a, 0x34, 0x2a];
  const rim = [0x66, 0x70, 0x7c];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + ((i + 0.5) / W) * w;
      // Rows run along z: the texture's v is 1 at z0 + d (see `patch`).
      const z = z0 + (1 - (j + 0.5) / H) * d;
      // The edge roughened, and dragged out into streaks along x, as by a dry brush.
      const rough = (fbm(x * 0.35, z * 0.35, 8, 3, 4) - 0.5) * 0.9;
      const streak = (noise(x * 0.6, z * 9, 1000, 5) - 0.5) * 0.6;
      const f = field(x, z) + rough + streak * 0.6;
      const k = (j * W + i) * 4;
      if (f > 0.42) {
        data[k + 3] = 0;
        continue;
      }
      let c: number[];
      let a: number;
      if (f > 0.0) {
        // The rim: a grey wash, broken and streaky, fading out.
        const t = f / 0.42;
        const broken = noise(x * 3, z * 14, 1000, 9);
        a = Math.max(0, (1 - t) * (0.55 + 0.6 * broken) - 0.15);
        c = rim.map((v) => v * (0.85 + 0.3 * broken));
      } else {
        const m = fbm(x * 0.25, z * 0.25, 8, 13, 4);
        const fleck = noise(x * 18, z * 18, 1000, 17);
        const base = m < 0.5 ? mix(dark, mid, m / 0.5) : mix(mid, light, (m - 0.5) / 0.5);
        c = mix(base, light, Math.max(0, fleck - 0.7) * 1.6);
        // Clumps: darker hollows between brighter cushions.
        const clump = fbm(x * 0.25, z * 0.25, 40, 29, 3);
        c = mix(c, dark, Math.max(0, 0.42 - clump) * 2);
        c = mix(c, light, Math.max(0, clump - 0.6) * 1.8);
        // Bare dark earth showing through it here and there.
        c = mix(c, dirt, Math.max(0, fbm(x * 0.9, z * 0.9, 8, 19, 3) - 0.55) * 2.2);
        // Greyer toward the edge, where the moss gives out.
        c = mix(c, rim, Math.max(0, 1 + f / 0.25) * 0.6);
        a = 1;
      }
      data[k] = c[0]!;
      data[k + 1] = c[1]!;
      data[k + 2] = c[2]!;
      data[k + 3] = Math.round(Math.min(1, a) * 255);
    }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function mix(a: number[], b: number[], t: number): number[] {
  const k = Math.max(0, Math.min(1, t));
  return a.map((v, i) => v + (b[i]! - v) * k);
}

/**
 * A cobble: an uneven pebble outline, `r` across at its widest, domed up `height` and sinking
 * into the ground at its rim. Its top is lighter than its sides, and mottled.
 */
function cobble(r: number, seed: number, height: number): THREE.BufferGeometry {
  const rand = rng(seed);
  const n = 9;
  const stretch = 0.75 + rand() * 0.6;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.78 + rand() * 0.3);
    pts.push(new THREE.Vector3(Math.cos(a) * k * stretch, 0, Math.sin(a) * k));
  }
  // A smooth closed curve through the points: the rim, and rings shrinking in to the top.
  const around = new THREE.CatmullRomCurve3(pts, true, 'centripetal').getSpacedPoints(32);
  around.pop();
  const seg = around.length;
  const rings = 6;
  // How high a ring sits, from the top (0) out to the rim (1) and a skirt just under the ground.
  const lift = (t: number) => (t > 1 ? -0.02 : height * Math.sqrt(Math.max(0, 1 - t ** 3)) - 0.006);
  const position: number[] = [0, lift(0), 0];
  const flat = 0.15 + rand() * 0.2;
  for (let k = 1; k <= rings + 1; k++) {
    const t = k / rings;
    const at = Math.min(t, 1) + (t > 1 ? 0.06 : 0);
    for (const p of around) {
      // A little lumpy, and some stones worn flatter on top.
      const lump = 1 + (noise(p.x * 9 + seed, p.z * 9, 1000, 31) - 0.5) * 0.4;
      position.push(p.x * at, lift(t) * lump * (1 - flat * (1 - t)), p.z * at);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < seg; j++) index.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let k = 0; k < rings; k++)
    for (let j = 0; j < seg; j++) {
      const a = 1 + k * seg + j;
      const b = 1 + k * seg + ((j + 1) % seg);
      index.push(a, b, b + seg, a, b + seg, a + seg);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array((position.length / 3) * 3);
  const tone = 0.8 + rand() * 0.4;
  for (let i = 0; i < position.length / 3; i++) {
    const x = position[i * 3]!;
    const z = position[i * 3 + 2]!;
    const up = nor.getY(i);
    const mottle = 0.86 + 0.28 * fbm(x * 3 + seed * 0.37, z * 3, 6, 41, 3);
    const v = tone * mottle * (0.5 + 0.6 * Math.max(0, up) ** 2);
    // Moss creeping up its foot.
    const moss = Math.max(0, Math.min(1, 1 - (position[i * 3 + 1]! + 0.006) / 0.022)) * 0.6;
    col.set(
      [v * 0.95, v, v * 1.07].map((c, j) => c + ([0.32, 0.44, 0.2][j]! - c) * moss),
      i * 3,
    );
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A tuft of grass: a handful of thin blades fanning out from one spot. */
function tuft(seed: number, size: number): THREE.BufferGeometry {
  const rand = rng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  // Some tufts darker, some with dry, yellowing tips.
  const base = new THREE.Color(0x4f8a22).multiplyScalar(0.75 + rand() * 0.4);
  const tip = new THREE.Color(0xb6e05a).lerp(new THREE.Color(0xc9b862), rand() * 0.6);
  const blades = 7 + Math.floor(rand() * 5);
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2;
    const lean = 0.15 + rand() * 0.45;
    const h = size * (0.6 + rand() * 0.5);
    const w = 0.012 + rand() * 0.01;
    const ox = (rand() - 0.5) * size * 0.25;
    const oz = (rand() - 0.5) * size * 0.25;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Two segments, bending outward toward the tip.
    const p0 = [ox - dz * w, 0, oz + dx * w];
    const p1 = [ox + dz * w, 0, oz - dx * w];
    const mid = [ox + dx * lean * h * 0.35, h * 0.55, oz + dz * lean * h * 0.35];
    const p2 = [mid[0]! - dz * w * 0.6, mid[1]!, mid[2]! + dx * w * 0.6];
    const p3 = [mid[0]! + dz * w * 0.6, mid[1]!, mid[2]! - dx * w * 0.6];
    const top = [ox + dx * lean * h, h, oz + dz * lean * h];
    pos.push(...p0, ...p1, ...p3, ...p0, ...p3, ...p2, ...p2, ...p3, ...top);
    const lo = base.clone();
    const mi = base.clone().lerp(tip, 0.5);
    for (const c of [lo, lo, mi, lo, mi, mi, mi, mi, tip]) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export interface GroundLayout {
  /** The cobbled patch's outline, round its edge (x, z). */
  patch: [number, number][];
  /** The single stones in holes round it: where, and how big. */
  holes: { x: number; z: number; r: number }[];
  /** Tufts of grass: where, and how tall. */
  tufts: { x: number; z: number; size: number }[];
}

export interface Ground {
  root: THREE.Group;
  floor: THREE.Mesh;
  /** Whether a point is on the cobbles (for the tests). */
  onPatch: (x: number, z: number) => boolean;
}

export function buildGround(layout: GroundLayout): Ground {
  const root = new THREE.Group();
  root.name = 'ground';
  // The floor: a great disc, fading to the studio's grey far off.
  const floorGeo = new THREE.CircleGeometry(280, 96);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, groundMaterial(0xffffff, { floor: true }));
  floor.receiveShadow = false;
  floor.name = 'floor';
  root.add(floor);

  const field = polygonField(layout.patch);
  // The patch's texture covers the outline's bounds, with room for the rim.
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of layout.patch) {
    minX = Math.min(minX, x - 0.9);
    maxX = Math.max(maxX, x + 0.9);
    minZ = Math.min(minZ, z - 0.9);
    maxZ = Math.max(maxZ, z + 0.9);
  }
  const rect: [number, number, number, number] = [minX, minZ, maxX - minX, maxZ - minZ];
  const moss = patchTexture(field, rect, 128);
  const patchGeo = new THREE.PlaneGeometry(rect[2], rect[3]);
  patchGeo.rotateX(-Math.PI / 2);
  const patch = new THREE.Mesh(
    patchGeo,
    groundMaterial(0xffffff, { map: moss, shine: 0.2, grain: 0.7 }),
  );
  // PlaneGeometry's v runs from its far edge (-z after the turn) to its near one: flipped, as
  // the texture's rows were painted from z0 + d down.
  patch.position.set(minX + rect[2] / 2, 0.004, minZ + rect[3] / 2);
  patch.renderOrder = 1;
  root.add(patch);

  // The cobbles: a jittered grid over the patch, each stone where the moss is thick.
  const stoneMat = groundMaterial(0x76818f, { vertexColors: true, shine: 0.55, grain: 1 });
  const rand = rng(7);
  const step = 0.42;
  for (let gz = minZ; gz < maxZ; gz += step * 0.87)
    for (
      let gx = minX + ((Math.round((gz - minZ) / (step * 0.87)) % 2) * step) / 2;
      gx < maxX;
      gx += step
    ) {
      const x = gx + (rand() - 0.5) * step * 0.35;
      const z = gz + (rand() - 0.5) * step * 0.35;
      const rough = (fbm(x * 0.35, z * 0.35, 8, 3, 4) - 0.5) * 0.9;
      if (field(x, z) + rough > -0.08) continue;
      const r = step * (0.55 + rand() * 0.1);
      const stone = new THREE.Mesh(
        cobble(r, Math.floor(rand() * 1e6), 0.032 + rand() * 0.018),
        stoneMat,
      );
      stone.position.set(x, 0, z);
      stone.rotation.y = rand() * Math.PI * 2;
      root.add(stone);
    }

  // The single stones round the patch, each in a ragged dark-rimmed hole.
  const holeTex = holeTexture();
  for (const [i, h] of layout.holes.entries()) {
    const ring = new THREE.PlaneGeometry(h.r * 3.2, h.r * 2.6);
    ring.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(ring, groundMaterial(0xffffff, { map: holeTex }));
    m.position.set(h.x, 0.003, h.z);
    m.rotation.y = hash(i, 3, 5) * Math.PI * 2;
    m.renderOrder = 1;
    root.add(m);
    const stone = new THREE.Mesh(cobble(h.r * 0.8, 100 + i, 0.03), stoneMat);
    stone.position.set(h.x, -0.008, h.z);
    stone.rotation.y = hash(i, 4, 5) * Math.PI * 2;
    root.add(stone);
  }

  // Grass, lit like the car (it is thin enough that the baked light would flatten it).
  const grass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  for (const [i, t] of layout.tufts.entries()) {
    const m = new THREE.Mesh(tuft(30 + i, t.size), grass);
    m.position.set(t.x, 0, t.z);
    m.castShadow = true;
    root.add(m);
  }
  // And small sprigs scattered between the cobbles.
  const sprigs = rng(11);
  for (let i = 0; i < 80; i++) {
    const x = minX + sprigs() * rect[2];
    const z = minZ + sprigs() * rect[3];
    const size = 0.06 + sprigs() * 0.09;
    if (field(x, z) > -0.25) continue;
    const m = new THREE.Mesh(tuft(500 + i, size), grass);
    m.position.set(x, 0, z);
    m.rotation.y = sprigs() * Math.PI * 2;
    root.add(m);
  }

  return {
    root,
    floor,
    onPatch: (x, z) => field(x, z) < 0,
  };
}

/** A hole: a dark ragged ring with a darker hollow in it, the stone sitting inside. */
function holeTexture(): THREE.DataTexture {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S - 0.5;
      const v = (j + 0.5) / S - 0.5;
      const a = Math.atan2(v, u);
      const r = Math.hypot(u, v) * 2;
      const rag = (noise(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + 5, 1000, 21) - 0.5) * 0.35;
      const streak = (noise(u * 4, v * 30, 1000, 23) - 0.5) * 0.3;
      const edge = 0.72 + rag + streak;
      const k = (j * S + i) * 4;
      if (r > edge) {
        data[k + 3] = 0;
        continue;
      }
      const inner = r < 0.5 + rag * 0.5;
      const shade = inner ? 0.14 : 0.22 + 0.1 * noise(u * 20, v * 20, 1000, 25);
      data[k] = shade * 255;
      data[k + 1] = shade * 255;
      data[k + 2] = shade * 1.06 * 255;
      data[k + 3] = Math.round(Math.min(1, (edge - r) / 0.12) * 255);
    }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The layer the bake's shadow catcher is drawn on, and nothing else. */
const BAKE_LAYER = 7;

/**
 * Bakes the ground's soft shadows from whatever under `scene` casts one: the key light's, from
 * many directions round `key` (the light is big, so its shadow blurs out from what casts it), and
 * the studio's all-round light, from all over the sky (dark only close under things). Each is the
 * average of `samples` shadow maps, laid on the ground's shared light (`GROUND_LIGHT`).
 */
export function bakeGroundShadows(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  key: THREE.Vector3,
  o: { samples?: number; spread?: number } = {},
): { key: THREE.WebGLRenderTarget; sky: THREE.WebGLRenderTarget } {
  const samples = o.samples ?? 64;
  const spread = o.spread ?? 0.22;
  const size = BAKE.size;
  const res = BAKE.resolution;
  const make = () =>
    new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    });
  const keyTarget = make();
  const skyTarget = make();

  const catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({
      opacity: 1 / samples,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    }),
  );
  catcher.position.set(BAKE.x, 0.001, BAKE.z);
  catcher.receiveShadow = true;
  catcher.layers.set(BAKE_LAYER);
  scene.add(catcher);

  const camera = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.1, 60);
  camera.position.set(BAKE.x, 30, BAKE.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(BAKE.x, 0, BAKE.z);
  camera.layers.set(BAKE_LAYER);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0;
  light.shadow.radius = 1;
  const reach = size * 0.75;
  Object.assign(light.shadow.camera, {
    left: -reach,
    right: reach,
    top: reach,
    bottom: -reach,
    near: 0.1,
    far: 80,
  });
  light.shadow.camera.updateProjectionMatrix();
  light.target.position.set(BAKE.x, 0, BAKE.z);
  // Lights only count where the camera can see them: this one by both.
  light.layers.enable(BAKE_LAYER);
  scene.add(light, light.target);

  // The other lights' shadows are left out while baking.
  const others: THREE.Light[] = [];
  scene.traverse((x) => {
    if ((x as THREE.Light).isLight && x !== light && (x as THREE.Light).castShadow) {
      others.push(x as THREE.Light);
      (x as THREE.Light).castShadow = false;
    }
  });
  // Nor is the backdrop drawn into the bake.
  const background = scene.background;
  scene.background = null;
  const wasEnabled = renderer.shadowMap.enabled;
  const wasAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  // Shadow maps draw only what the rendering camera's layers see, so each direction's map is
  // drawn by a camera that sees the scene but looks at nothing (into a 1 px target), then the
  // catcher alone by the bake's camera.
  const casterCam = new THREE.PerspectiveCamera(1, 1, 0.1, 0.2);
  casterCam.position.set(0, 1000, 0);
  casterCam.lookAt(0, 2000, 0);
  casterCam.updateMatrixWorld();
  const scratch = new THREE.WebGLRenderTarget(1, 1);
  const before = {
    target: renderer.getRenderTarget(),
    autoClear: renderer.autoClear,
    clear: renderer.getClearColor(new THREE.Color()),
    alpha: renderer.getClearAlpha(),
  };
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);

  const k = key.clone().normalize();
  // Two directions square to the key, for spreading round it.
  const t1 = new THREE.Vector3(0, 1, 0).cross(k).normalize();
  const t2 = k.clone().cross(t1).normalize();
  const rand = rng(11);
  const dir = new THREE.Vector3();
  for (const [target, sky] of [
    [keyTarget, false],
    [skyTarget, true],
  ] as const) {
    renderer.setRenderTarget(target);
    renderer.clear();
    for (let i = 0; i < samples; i++) {
      if (sky) {
        // All over the sky, more from overhead, none from near the horizon.
        const a = rand() * Math.PI * 2;
        const up = 0.3 + 0.7 * Math.sqrt(rand());
        const flat = Math.sqrt(1 - up * up);
        dir.set(Math.cos(a) * flat, up, Math.sin(a) * flat);
      } else {
        // Round the key, over a disc: the light's size seen from the car.
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * spread;
        dir
          .copy(k)
          .addScaledVector(t1, Math.cos(a) * r)
          .addScaledVector(t2, Math.sin(a) * r)
          .normalize();
      }
      light.position.set(BAKE.x, 0, BAKE.z).addScaledVector(dir, 30);
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
      // A fresh shadow map for each direction.
      light.shadow.needsUpdate = true;
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(scratch);
      renderer.render(scene, casterCam);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    }
  }

  renderer.setRenderTarget(before.target);
  renderer.autoClear = before.autoClear;
  renderer.setClearColor(before.clear, before.alpha);
  renderer.shadowMap.enabled = wasEnabled;
  renderer.shadowMap.autoUpdate = wasAuto;
  scratch.dispose();
  scene.background = background;
  for (const l of others) l.castShadow = true;
  scene.remove(catcher, light, light.target);
  catcher.geometry.dispose();
  (catcher.material as THREE.Material).dispose();
  light.dispose();

  GROUND_LIGHT.tKey.value = keyTarget.texture;
  GROUND_LIGHT.tSky.value = skyTarget.texture;
  GROUND_LIGHT.keyDir.value.copy(k);
  return { key: keyTarget, sky: skyTarget };
}
