import * as THREE from 'three';
import { fbm, hash, noise, paintedOnce, rng } from './kit.ts';
import { polygonField } from './paint.ts';
import type { Field, Rect } from './paint.ts';
import { BACKDROP, SWEEP_GLSL } from './studio.ts';

export { mix, polygonField } from './paint.ts';
export type { Field } from './paint.ts';

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
export const BAKE = { x: -3.0, z: -9.5, size: 42, resolution: 2560 };

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

/** Bakes the ground's shadows over the square round (`x`, `z`), `size` a side, from now on. */
export function bakeOver(area: { x: number; z: number; size: number }): void {
  Object.assign(BAKE, area);
  GROUND_LIGHT.bakeRect.value.set(
    area.x - area.size / 2,
    area.z + area.size / 2,
    area.size,
    area.size,
  );
}

/**
 * The floor's own colour, and how it fades with distance from `centre` (over `range`) into the
 * backdrop's sweep (`SWEEP_GLSL`), as seen from the camera, so no seam shows at the horizon.
 */
export const FLOOR = {
  near: { value: new THREE.Color(0xd9d1c5) },
  centre: { value: new THREE.Vector2(0.2, 0) },
  /** Half faded this far out (m), and how sharply. */
  range: { value: new THREE.Vector2(26, 1.25) },
  /**
   * The key's light across it, dying off away from where it falls: the way toward the light
   * (x, z), how far along that way it is gone and where it is full, and how dark it leaves the
   * floor where it is gone (1 for even light).
   */
  pool: { value: new THREE.Vector4(1, 0, -1, 0) },
  poolDark: { value: 1 },
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
  uniform vec4 floorPool;
  uniform float floorPoolDark;
#endif
#if defined( FLOOR ) || defined( HAZE )
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
    albedo = floorNear * mix( floorPoolDark, 1.0, smoothstep( floorPool.z, floorPool.w, dot( vWorld.xz, floorPool.xy ) ) );
  #endif
  #if defined( FLOOR ) || defined( HAZE )
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
    // A wet sheen: the key's highlight, tight enough to glint, and the studio mirrored at a glance.
    vec3 v = normalize( cameraPosition - vWorld );
    float spec = pow( max( dot( n, normalize( v + keyDir ) ), 0.0 ), 120.0 ) * ( 1.0 - key * keyDark );
    float fres = 0.04 + 0.96 * pow( 1.0 - max( dot( n, v ), 0.0 ), 5.0 );
    // Flat tops mirror more of the studio, as wet stone laid level does.
    float level = 1.0 + 0.8 * smoothstep( 0.93, 0.98, n.y );
    colour += shine * ( keyColour * spec * 2.6 + sweep( reflect( -v, n ).y ) * fres * level * ( 1.0 - sky * skyDark ) );
  }
  gl_FragColor = vec4( colour, alpha );
  #if defined( FLOOR ) || defined( HAZE )
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
    /** Faded into the backdrop with distance as the floor is (for what stands out past a map). */
    haze?: boolean;
    shine?: number;
    grain?: number;
  } = {},
): THREE.ShaderMaterial {
  const defines: Record<string, string> = {};
  if (o.map) defines.USE_MAP = '';
  if (o.floor) defines.FLOOR = '';
  if (o.haze) defines.HAZE = '';
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
      floorPool: FLOOR.pool,
      floorPoolDark: FLOOR.poolDark,
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

/** `poly` (round the origin) cut by the line `n · v = d`, keeping the side toward the origin. */
function clip(poly: THREE.Vector2[], n: THREE.Vector2, d: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = a.dot(n) - d;
    const db = b.dot(n) - d;
    if (da <= 0) out.push(a);
    if (da < 0 !== db < 0) out.push(a.clone().lerp(b, da / (da - db)));
  }
  return out;
}

/**
 * Whether a flagstone's cell reads as a stone: no corner sharper than 70 degrees, and no more
 * than 2.4 times as long as it is wide.
 */
function stoneLike(cell: THREE.Vector2[]): boolean {
  const n = cell.length;
  for (let i = 0; i < n; i++) {
    const a = cell[(i + n - 1) % n]!.clone().sub(cell[i]!);
    const b = cell[(i + 1) % n]!.clone().sub(cell[i]!);
    if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) continue;
    if (a.angleTo(b) < (70 * Math.PI) / 180) return false;
  }
  // Its extent along each edge's direction, and across it.
  let worst = 1;
  for (let i = 0; i < n; i++) {
    const d = cell[(i + 1) % n]!.clone().sub(cell[i]!).normalize();
    const across = new THREE.Vector2(-d.y, d.x);
    const span = (v: THREE.Vector2) => {
      const ks = cell.map((p) => p.dot(v));
      return Math.max(...ks) - Math.min(...ks);
    };
    const [l, w] = [span(d), span(across)];
    worst = Math.max(worst, Math.max(l, w) / Math.max(1e-6, Math.min(l, w)));
  }
  return worst <= 2.4;
}

/** A closed outline with its corners cut, once: twice over, they read as rounded. */
export function chaikin(poly: THREE.Vector2[]): THREE.Vector2[] {
  return poly.flatMap((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    return [a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75)];
  });
}

/** A loose stone's outline: a flattened, slightly uneven round, `r` across at its widest. */
function pebble(r: number, rand: () => number): THREE.Vector2[] {
  const stretch = 0.75 + rand() * 0.5;
  const pts = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const k = r * (0.8 + rand() * 0.25);
    return new THREE.Vector3(Math.cos(a) * k * stretch, 0, Math.sin(a) * k);
  });
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal')
    .getSpacedPoints(28)
    .slice(0, -1)
    .map((p) => new THREE.Vector2(p.x, p.z));
}

/**
 * A flagstone in `outline` (x, z round its middle): flat on top nearly to its edge, then
 * rounded over sharply and sunk into the ground at its rim. Its top's edge is lighter, as if
 * worn and catching the light, its middle a little darker, and moss creeps up its foot.
 */
export function cobble(
  outline: THREE.Vector2[],
  seed: number,
  height: number,
): THREE.BufferGeometry {
  const rand = rng(seed);
  const seg = outline.length;
  const rings = 10;
  // How high a ring sits, from the top (0) out to the rim (1) and a skirt just under the ground.
  const lift = (t: number) => {
    if (t > 1) return -0.02;
    const over = t <= 0.9 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2));
    return height * over + height * 0.12 * (1 - t * t) - 0.004;
  };
  const position: number[] = [0, lift(0), 0];
  const ringOf: number[] = [0];
  for (let k = 1; k <= rings + 1; k++) {
    const t = k / rings;
    const at = Math.min(t, 1) + (t > 1 ? 0.04 : 0);
    for (const p of outline) {
      const lump = 1 + (noise(p.x * 9 + seed, p.y * 9, 1000, 31) - 0.5) * 0.3;
      position.push(p.x * at, lift(t) * lump, p.y * at);
      ringOf.push(t);
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
  // The outline may wind either way: face the top up.
  if ((geo.attributes.normal as THREE.BufferAttribute).getY(0) < 0) {
    for (let i = 0; i < index.length; i += 3)
      [index[i + 1], index[i + 2]] = [index[i + 2]!, index[i + 1]!];
    geo.setIndex(index);
    geo.computeVertexNormals();
  }
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array((position.length / 3) * 3);
  const tone = 0.8 + rand() * 0.35;
  for (let i = 0; i < position.length / 3; i++) {
    const x = position[i * 3]!;
    const z = position[i * 3 + 2]!;
    const t = ringOf[i]!;
    const up = nor.getY(i);
    const mottle = 0.86 + 0.28 * fbm(x * 3 + seed * 0.37, z * 3, 6, 41, 3);
    const rimLight = t > 0.85 && t < 0.95 ? 1.1 : 1;
    const v = tone * mottle * rimLight * (0.92 + 0.08 * t) * (0.5 + 0.6 * Math.max(0, up) ** 2);
    // Moss creeping up its foot.
    const moss = Math.max(0, Math.min(1, 1 - (position[i * 3 + 1]! + 0.006) / 0.02)) * 0.6;
    col.set(
      [v * 0.97, v, v * 1.04].map((c, j) => c + ([0.32, 0.44, 0.2][j]! - c) * moss),
      i * 3,
    );
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A tuft of grass: a handful of thin blades fanning out from one spot. */
export function tuft(seed: number, size: number, dense = false): THREE.BufferGeometry {
  const rand = rng(seed);
  const pos: number[] = [];
  const col: number[] = [];
  // Some tufts darker, some with dry, yellowing tips.
  const base = new THREE.Color(0x8aa83c).multiplyScalar(0.75 + rand() * 0.4);
  const tip = new THREE.Color(0xd8e890).lerp(new THREE.Color(0xc9b862), rand() * 0.5);
  const blades = dense ? 6 + Math.floor(rand() * 4) : 4 + Math.floor(rand() * 3);
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
  // Walked through, not into (see `passable`).
  geo.userData.grass = true;
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

/**
 * A patch of cobbles in `outline` (x, z): moss with a ragged painted rim, and flagstones packed
 * in it with thin joints, a few small sprigs of grass between them; `seed` picks its stones.
 */
export function cobblePatch(
  outline: [number, number][],
  seed = 7,
): { root: THREE.Group; field: Field } {
  const root = new THREE.Group();
  root.name = 'cobbles';
  const field = polygonField(outline);
  // The patch's texture covers the outline's bounds, with room for the rim.
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of outline) {
    minX = Math.min(minX, x - 0.9);
    maxX = Math.max(maxX, x + 0.9);
    minZ = Math.min(minZ, z - 0.9);
    maxZ = Math.max(maxZ, z + 0.9);
  }
  const rect: [number, number, number, number] = [minX, minZ, maxX - minX, maxZ - minZ];
  const moss = paintedOnce({ kind: 'moss', outline, rect, perMetre: 128 });
  const patchGeo = new THREE.PlaneGeometry(rect[2], rect[3]);
  patchGeo.rotateX(-Math.PI / 2);
  const patch = new THREE.Mesh(
    patchGeo,
    groundMaterial(0xffffff, { map: moss, shine: 0.6, grain: 0.7 }),
  );
  // PlaneGeometry's v runs from its far edge (-z after the turn) to its near one: flipped, as
  // the texture's rows were painted from z0 + d down.
  patch.position.set(minX + rect[2] / 2, 0.004, minZ + rect[3] / 2);
  patch.renderOrder = 1;
  root.add(patch);

  // The flagstones: the cells of a jittered grid's points, each cut back from its neighbours
  // by half a joint and its corners rounded, so they pack close with thin joints of moss, and
  // vary in size where points are missing.
  const stoneMat = groundMaterial(0x737c86, { vertexColors: true, shine: 0.9, grain: 0.6 });
  const rand = rng(seed);
  const step = 0.42;
  const joint = 0.03;
  const seeds: THREE.Vector2[] = [];
  for (let gz = minZ; gz < maxZ; gz += step * 0.87)
    for (
      let gx = minX + ((Math.round((gz - minZ) / (step * 0.87)) % 2) * step) / 2;
      gx < maxX;
      gx += step
    )
      // Some points left out, so their neighbours grow into the gap: long stones and big ones
      // among the small.
      if (rand() > 0.07)
        seeds.push(
          new THREE.Vector2(gx + (rand() - 0.5) * step * 0.7, gz + (rand() - 0.5) * step * 0.7),
        );
  for (const p of seeds) {
    const rough = (fbm(p.x * 0.35, p.y * 0.35, 8, 3, 4) - 0.5) * 0.9;
    // A few run on out into the brushed rim.
    // A fringe of moss round them, inside the patch's edge.
    if (field(p.x, p.y) + rough > -0.15) continue;
    let cell = [
      new THREE.Vector2(-step, -step),
      new THREE.Vector2(step, -step),
      new THREE.Vector2(step, step),
      new THREE.Vector2(-step, step),
    ];
    for (const q of seeds) {
      const d = q.clone().sub(p);
      if (d.lengthSq() === 0 || d.length() > step * 2.2) continue;
      cell = clip(cell, d.clone().normalize(), d.length() / 2 - joint / 2);
    }
    // Only rounded slabs: none sharp-cornered or long and thin.
    if (cell.length < 3 || !stoneLike(cell)) continue;
    const stone = new THREE.Mesh(
      cobble(chaikin(chaikin(chaikin(cell))), Math.floor(rand() * 1e6), 0.018 + rand() * 0.01),
      stoneMat,
    );
    stone.position.set(p.x, 0, p.y);
    root.add(stone);
  }

  // Grass, lit like the car (it is thin enough that the baked light would flatten it).
  const grass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  // And a few small sprigs between the flagstones.
  const sprigs = rng(seed + 4);
  for (let i = 0, placed = 0; i < 80 && placed < 6; i++) {
    const x = minX + sprigs() * rect[2];
    const z = minZ + sprigs() * rect[3];
    const size = 0.06 + sprigs() * 0.09;
    if (field(x, z) > -0.25) continue;
    placed++;
    const m = new THREE.Mesh(tuft(500 + i, size), grass);
    m.position.set(x, 0, z);
    m.rotation.y = sprigs() * Math.PI * 2;
    root.add(m);
  }

  return { root, field };
}

/**
 * The open ground a map covers past its street and its yards: a lot of rolled gravel, ruts worn
 * in it, and lawns, each in its outline with its edge brushed out as the moss's is, and paths of
 * slabs over the lawns.
 */
export interface GroundCover {
  /**
   * The lot: its outline, the tracks worn in it (see `PaintJob`), and the rectangle its texture
   * covers, which can cut it off straight short of its brushed edge (where a rival lot meets it).
   */
  gravel: { outline: [number, number][]; tracks: [number, number][][]; rect: Rect };
  lawns: { outline: [number, number][]; rect: Rect }[];
  /** The paths, each a rectangle of slabs (x0, z0, its width along x and depth along z). */
  paths: Rect[];
}

/**
 * `cover` laid on the ground (its lot, if it has one): under the road, the pavements and the
 * cobbles, the paths over it.
 */
export function coverGround(
  cover: Omit<GroundCover, 'gravel'> & Partial<Pick<GroundCover, 'gravel'>>,
  o: { perMetre?: number; slabs?: number; haze?: boolean } = {},
): THREE.Group {
  const { perMetre = 64, slabs = 100, haze } = o;
  const root = new THREE.Group();
  root.name = 'cover';
  // Drawn before the rest of the ground's painted layers (the road's at 0.5, the cobbles' at 1),
  // which lie over them: the lot and the lawns first, then the paths.
  const under = { y: 0.0015, order: 0.2 };
  const over = { y: 0.0025, order: 0.3 };
  const lay = (rect: Rect, map: THREE.Texture, shine: number, grain: number, at = under) => {
    const geo = new THREE.PlaneGeometry(rect[2], rect[3]);
    geo.rotateX(-Math.PI / 2);
    // Seen from afar (faded into the haze), a duller sheen and no grit, which would glitter.
    const m = new THREE.Mesh(
      geo,
      groundMaterial(0xffffff, {
        map,
        shine: haze ? shine * 0.4 : shine,
        grain: haze ? 0 : grain,
        haze,
      }),
    );
    m.position.set(rect[0] + rect[2] / 2, at.y, rect[1] + rect[3] / 2);
    m.renderOrder = at.order;
    root.add(m);
  };
  const { gravel } = cover;
  if (gravel) lay(gravel.rect, paintedOnce({ kind: 'gravel', ...gravel, perMetre }), 0.1, 0.9);
  for (const l of cover.lawns)
    lay(l.rect, paintedOnce({ kind: 'lawn', ...l, perMetre }), 0.05, 0.5);
  for (const [i, p] of cover.paths.entries()) {
    const job = { kind: 'paving', w: p[2], d: p[3], perMetre: slabs, seed: 221 + 2 * i } as const;
    lay(p, paintedOnce(job), 0.35, 0.5, over);
  }
  return root;
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

  const patch = cobblePatch(layout.patch);
  root.add(patch.root);
  const { field } = patch;

  // The single stones round the patch, each in a ragged dark-rimmed hole.
  const holeMat = groundMaterial(0xffffff, { map: holeTexture(), shine: 0.5 });
  // The stones in the holes, paler and dry.
  const looseMat = groundMaterial(0x8a9098, { vertexColors: true, shine: 0.3, grain: 0.6 });
  for (const [i, h] of layout.holes.entries()) {
    const ring = new THREE.PlaneGeometry(h.r * 4.5, h.r * 3.6);
    ring.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(ring, holeMat);
    m.position.set(h.x, 0.003, h.z);
    m.rotation.y = hash(i, 3, 5) * Math.PI * 2;
    m.renderOrder = 1;
    root.add(m);
    const stone = new THREE.Mesh(cobble(pebble(h.r * 0.9, rng(100 + i)), 100 + i, 0.02), looseMat);
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
    const m = new THREE.Mesh(tuft(30 + i, t.size * 1.1, true), grass);
    m.position.set(t.x, 0, t.z);
    m.castShadow = true;
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
      const shade = inner ? 0.15 : 0.25 + 0.08 * noise(u * 20, v * 20, 1000, 25);
      data[k] = shade * 255;
      data[k + 1] = shade * 255;
      data[k + 2] = shade * 1.06 * 255;
      data[k + 3] = Math.round(Math.min(1, (edge - r) / 0.25) * 255);
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

/** Whether the depth pass draws `mesh` as nothing but its triangles, as `joinCasters` does. */
function plainCaster(mesh: THREE.Mesh): boolean {
  if (mesh.constructor !== THREE.Mesh || Array.isArray(mesh.material)) return false;
  const m = mesh.material as THREE.Material & {
    wireframe?: boolean;
    displacementMap?: THREE.Texture | null;
    displacementScale?: number;
  };
  const geo = mesh.geometry;
  return (
    m.visible &&
    !m.wireframe &&
    !(m.alphaTest > 0) &&
    !m.alphaToCoverage &&
    !(m.displacementMap && m.displacementScale !== 0) &&
    !m.clippingPlanes?.length &&
    !mesh.customDepthMaterial &&
    mesh.onBeforeShadow === THREE.Object3D.prototype.onBeforeShadow &&
    !Object.keys(geo.morphAttributes).length &&
    !!geo.attributes.position &&
    geo.drawRange.start === 0 &&
    geo.drawRange.count === Infinity
  );
}

/** How big the squares are that the bake's joined casters are cut into, in metres. */
const CASTER_CELL = 6;

/**
 * Everything that casts a shadow under `scene`, joined for the bake: each plain mesh's triangles
 * moved into the world and put into one mesh for each side its shadow is drawn from and square
 * of the ground it stands over, so each of the bake's many shadow maps takes a draw call for
 * each square it sees rather than one for every part (over a thousand on Chevron Street,
 * sixty-four maps over, seconds of the page standing still), and what is out of a map's sight is
 * left out of it as before. What the depth pass draws otherwise (cut out by a texture, displaced,
 * with a hook or a depth material of its own) is left to cast its own. Returns the joined meshes,
 * which are not yet in the scene, and the meshes they stand in for, whose own shadows are to be
 * turned off while they do.
 */
function joinCasters(
  scene: THREE.Object3D,
  camera: THREE.Camera,
  vsm: boolean,
): { joined: THREE.Mesh[]; taken: THREE.Mesh[] } {
  scene.updateMatrixWorld(true);
  const flip = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide };
  const sides = new Map<THREE.Side, THREE.Mesh[]>();
  const taken: THREE.Mesh[] = [];
  scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow || !mesh.layers.test(camera.layers)) return;
    if (!plainCaster(mesh)) return;
    const m = mesh.material as THREE.Material;
    // The side the depth pass draws, as three.js picks it.
    const side = m.shadowSide ?? (vsm || m.side === THREE.DoubleSide ? m.side : flip[m.side]);
    let list = sides.get(side);
    if (!list) sides.set(side, (list = []));
    list.push(mesh);
    taken.push(mesh);
  });
  const joined: THREE.Mesh[] = [];
  const v = new THREE.Vector3();
  for (const [side, meshes] of sides) {
    let points = 0;
    let corners = 0;
    for (const { geometry: g } of meshes) {
      points += g.attributes.position!.count;
      corners += g.index ? g.index.count : g.attributes.position!.count;
    }
    // Every point in the world, and every triangle's corners, in one list.
    const position = new Float32Array(points * 3);
    const all = new Uint32Array(corners);
    let p = 0;
    let c = 0;
    for (const mesh of meshes) {
      const g = mesh.geometry;
      const pos = g.attributes.position!;
      const first = p;
      for (let i = 0; i < pos.count; i++, p++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        position[p * 3] = v.x;
        position[p * 3 + 1] = v.y;
        position[p * 3 + 2] = v.z;
      }
      const n = g.index ? g.index.count : pos.count;
      // A mirrored mesh's triangles turn the other way round once in the world: turned back.
      const mirrored = mesh.matrixWorld.determinant() < 0;
      for (let i = 0; i < n; i++) {
        const k = mirrored ? i - (i % 3) + [0, 2, 1][i % 3]! : i;
        all[c++] = first + (g.index ? g.index.getX(k) : k);
      }
    }
    // Each triangle to the square its middle stands over.
    const triangles = corners / 3;
    const cellOf = new Int32Array(triangles);
    const cells = new Map<number, { count: number; corners?: Float32Array; box: THREE.Box3 }>();
    for (let t = 0; t < triangles; t++) {
      let x = 0;
      let z = 0;
      for (let k = 0; k < 3; k++) {
        const i = all[t * 3 + k]! * 3;
        x += position[i]!;
        z += position[i + 2]!;
      }
      const key =
        (Math.floor(x / 3 / CASTER_CELL) + 4096) * 8192 + Math.floor(z / 3 / CASTER_CELL) + 4096;
      cellOf[t] = key;
      const cell = cells.get(key);
      if (cell) cell.count++;
      else cells.set(key, { count: 1, box: new THREE.Box3() });
    }
    for (const cell of cells.values()) {
      cell.corners = new Float32Array(cell.count * 9);
      cell.count = 0;
    }
    for (let t = 0; t < triangles; t++) {
      const cell = cells.get(cellOf[t]!)!;
      for (let k = 0; k < 3; k++) {
        v.fromArray(position, all[t * 3 + k]! * 3);
        v.toArray(cell.corners!, cell.count);
        cell.count += 3;
        cell.box.expandByPoint(v);
      }
    }
    const material = new THREE.MeshBasicMaterial({ side, shadowSide: side, colorWrite: false });
    for (const cell of cells.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(cell.corners!, 3));
      geometry.boundingSphere = cell.box.getBoundingSphere(new THREE.Sphere());
      const caster = new THREE.Mesh(geometry, material);
      caster.castShadow = true;
      caster.layers.mask = camera.layers.mask;
      caster.matrixAutoUpdate = false;
      joined.push(caster);
    }
  }
  return { joined, taken };
}

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
  const { joined, taken } = joinCasters(
    scene,
    casterCam,
    renderer.shadowMap.type === THREE.VSMShadowMap,
  );
  for (const m of taken) m.castShadow = false;
  for (const m of joined) scene.add(m);
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
  for (const m of taken) m.castShadow = true;
  for (const m of joined) {
    scene.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  scene.remove(catcher, light, light.target);
  catcher.geometry.dispose();
  (catcher.material as THREE.Material).dispose();
  light.dispose();

  GROUND_LIGHT.tKey.value = keyTarget.texture;
  GROUND_LIGHT.tSky.value = skyTarget.texture;
  GROUND_LIGHT.keyDir.value.copy(k);
  return { key: keyTarget, sky: skyTarget };
}
