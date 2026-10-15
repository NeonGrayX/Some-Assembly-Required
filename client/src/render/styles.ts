import * as THREE from 'three';
import { floorRect } from '@sar/shared';
import type { FloorRect, LevelDef, SurfaceName } from '@sar/shared';

/**
 * The game's painted style: every lit surface redrawn with its own texture, worked out in the
 * shader from where the surface is in the world (no image files, nothing to load, and the same
 * on every machine), in a chunky, hand-painted cartoon look: saturated colours, broad boards
 * with dark grooves and light worn edges, cells with lit rims, stroke-shaped grass tufts, and
 * turquoise water with foam along its shores. Under the paint, fine bumps catch the light, and
 * shiny things reflect the sky.
 */

/** What a surface is made of, which picks its texture. */
export const Surface = {
  /** Not known: a faint painted finish. */
  Auto: 0,
  Wall: 1,
  Wood: 2,
  /** Wooden floorboards. */
  Planks: 3,
  Tiles: 4,
  Fabric: 5,
  /** Sand, gravel or trodden earth. */
  Dirt: 6,
  Grass: 7,
  /** Shingles on top, plaster underneath (the ceiling). */
  Roof: 8,
  Concrete: 9,
  Metal: 10,
  Plastic: 11,
  /** Brickwork walls. */
  Masonry: 12,
  /** The house's yard: paving slabs. */
  Paving: 13,
  /** Left as it is: textured, see-through or glowing surfaces. */
  None: 14,
  /** A brick: moulded plastic like `Plastic`, its edges kept clean (see `paintedEdge`). */
  Brick: 15,
  /** Open water: ripples moving over it, and the sky mirrored in it at a slant. */
  Water: 16,
  /** A close-boarded fence's boards, painted on its flat face (see `makeFence`). */
  Fence: 17,
  /**
   * Ground that rises and falls (see `terrain.ts`): sand, grass or a steep bank of bare earth at
   * each point, as its vertices say (`GROUND_ATTRIBUTE`), with the edges between them painted
   * ragged.
   */
  Terrain: 18,
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

/**
 * A terrain's per-vertex ground (see `Surface.Terrain`): how grassy it is there, and how rocky
 * (steep and bare, a bank of earth where nothing grows), each 0 to 1 (sand where it is neither).
 */
export const GROUND_ATTRIBUTE = 'styleGround';
/** Set in a terrain's material's `userData`: the sea's level, where its sand turns wet. */
export const SEA_LEVEL = 'seaLevel';
/**
 * Set in the sea's material's `userData`: how far each point of it is from the shore and how
 * deep it is there (see `ShoreMap`), for the painted water's shallows and foam along a shore
 * of any shape.
 */
export const SHORE_MAP = 'shoreMap';

/**
 * Set in the sea's material's `userData`: the rocks and islets standing out of the open sea past
 * the shore map's reach (see `SeaRock`), for the painted water to ring them with foam as it does
 * its shores. Read with `seaRocksOf`, and set with `setSeaRocks` (which needs no new program).
 */
export const SEA_ROCKS = 'seaRocks';
/** The most rocks standing out of the open sea the painted water rings with foam. */
export const MAX_SEA_ROCKS = 20;

/**
 * A rock or islet standing out of the open sea, where the water meets it: an oval round its
 * middle (`x`, `z`), `a` along the way `turn` (radians round from x toward z) and `b` across.
 */
export interface SeaRock {
  x: number;
  z: number;
  a: number;
  b: number;
  turn: number;
}

/** The uniforms' values for a sea's rocks (see `SEA_ROCKS`): unused ones far out of the way. */
interface SeaRockUniforms {
  rocks: THREE.Vector4[];
  turns: THREE.Vector2[];
}

/** A sea material's rocks as its shader has them, made on first asking (none to start with). */
export function seaRocksOf(material: THREE.Material): SeaRockUniforms {
  let u = material.userData[SEA_ROCKS] as SeaRockUniforms | undefined;
  if (!u) {
    u = {
      rocks: Array.from({ length: MAX_SEA_ROCKS }, () => new THREE.Vector4(1e5, 1e5, 1, 1)),
      turns: Array.from({ length: MAX_SEA_ROCKS }, () => new THREE.Vector2(1, 0)),
    };
    material.userData[SEA_ROCKS] = u;
  }
  return u;
}

/**
 * Sets the rocks a sea's water rings with foam (the first `MAX_SEA_ROCKS` of them), in place,
 * so a program already made for it picks them up as it is.
 */
export function setSeaRocks(material: THREE.Material, rocks: SeaRock[]): void {
  const u = seaRocksOf(material);
  for (let i = 0; i < MAX_SEA_ROCKS; i++) {
    const r = rocks[i];
    if (r) {
      u.rocks[i]!.set(r.x, r.z, Math.max(r.a, 0.05), Math.max(r.b, 0.05));
      u.turns[i]!.set(Math.cos(r.turn), Math.sin(r.turn));
    } else {
      u.rocks[i]!.set(1e5, 1e5, 1, 1);
      u.turns[i]!.set(1, 0);
    }
  }
}

/**
 * How far from the shore and how deep the sea is round a level's land, in a texture over
 * `rect`: red is the square root of the distance out from the shore over `SHORE_RANGE` metres
 * (finer close in, where the foam is), green the depth over `DEPTH_RANGE`, and blue as red but
 * from whatever stands in the sea (a post, a rock, a ship's hull), whose foam is narrower (see
 * `shoreField` in terrain.ts).
 */
export interface ShoreMap {
  texture: THREE.Texture;
  rect: FloorRect;
}
/** The distance from the shore a shore map's red reaches (at 1), in metres. */
export const SHORE_RANGE = 8;
/** The depth a shore map's green reaches (at 1), in metres. */
export const DEPTH_RANGE = 4;

/**
 * The terrain's colours, as sRGB: its dry sand, the sand wet along the waterline, the sea bed
 * deep under the water, its grass, and the bare earth of its steep banks (the sand darker and
 * warmer, and wet and under the sea as it is), which it is painted in (see `terrainPick`).
 */
export const TERRAIN_COLOURS = {
  sand: 0xeecf94,
  wet: 0xbf9460,
  seabed: 0x3f8c84,
  grass: 0x789a4c,
  earth: 0xd2a872,
} as const;

const fract = (x: number) => x - Math.floor(x);

/** The painted shaders' hash (\`sHash\`), worked out here as they do it: in [0, 1). */
export function styleHash(x: number, y: number, z: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.103);
  let pz = fract(z * 0.0973);
  const d = px * (py + 33.33) + py * (px + 33.33) + pz * (pz + 33.33);
  px += d;
  py += d;
  pz += d;
  return fract((px + py) * pz);
}

/** The painted shaders' smooth noise (\`sNoise\`), worked out here as they do it: in [0, 1). */
export function styleNoise(x: number, y: number, z: number): number {
  const [ix, iy, iz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const s = (t: number) => t * t * (3 - 2 * t);
  const [fx, fy, fz] = [s(x - ix), s(y - iy), s(z - iz)];
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number) => styleHash(ix + dx, iy + dy, iz + dz);
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}

/** A colour as a GLSL vec3, in the shaders' linear space. */
const glslColour = (hex: number) => {
  const c = new THREE.Color(hex);
  return `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`;
};

/**
 * The terrain's earth over its sand, colour by colour in the shaders' linear space, as a GLSL
 * vec3: the sand times this is the earth, dry, wet or under the sea alike.
 */
const earthOverSand = () => {
  const [e, s] = [new THREE.Color(TERRAIN_COLOURS.earth), new THREE.Color(TERRAIN_COLOURS.sand)];
  return `vec3( ${(e.r / s.r).toFixed(4)}, ${(e.g / s.g).toFixed(4)}, ${(e.b / s.b).toFixed(4)} )`;
};

/** Set in a material's `userData` to say what it is made of (see `Surface`). */
export const SURFACE = 'surface';
/** A merged mesh's per-vertex surface (see `mergeStatic`), when it mixes several. */
export const SURFACE_ATTRIBUTE = 'styleSurface';
/** Set in a merged material's `userData` when its geometry carries `SURFACE_ATTRIBUTE`. */
export const SURFACE_PER_VERTEX = 'surfacePerVertex';

/** Tags `material` with what it is made of, and returns it. */
export function madeOf<M extends THREE.Material>(material: M, surface: Surface): M {
  material.userData[SURFACE] = surface;
  return material;
}

/** Tags every plain lit material under `root` that has no surface yet. */
export function madeOfAll(root: THREE.Object3D, surface: Surface): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) {
      if (x.userData[SURFACE] === undefined && surfaceOf(x) !== Surface.None) {
        x.userData[SURFACE] = surface;
      }
    }
  });
}

/** What each surface the maps name is (see `SurfaceName` in `@sar/shared`). */
const NAMED: Record<SurfaceName, Surface> = {
  wall: Surface.Wall,
  wood: Surface.Wood,
  planks: Surface.Planks,
  tiles: Surface.Tiles,
  fabric: Surface.Fabric,
  dirt: Surface.Dirt,
  grass: Surface.Grass,
  roof: Surface.Roof,
  concrete: Surface.Concrete,
  metal: Surface.Metal,
  masonry: Surface.Masonry,
  paving: Surface.Paving,
};

/**
 * Tags `material` with what a level's box says it is made of, if it says (else its colour and
 * finish are guessed from, see `surfaceOf`), and returns it.
 */
export function madeAs<M extends THREE.Material>(material: M, surface: SurfaceName | undefined): M {
  return surface === undefined ? material : madeOf(material, NAMED[surface]);
}

/**
 * Tags the materials under `root` painted exactly `colour` that have no surface yet: for a model
 * built in the colour of what it is made of (a level box's), its trimmings in other colours.
 */
export function madeOfColour(root: THREE.Object3D, colour: number, surface: Surface): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) {
      const c = (x as THREE.MeshStandardMaterial).color;
      if (x.userData[SURFACE] === undefined && c?.getHex() === colour)
        x.userData[SURFACE] = surface;
    }
  });
}

/** Tags the parts of a level box's model painted in its colour as made of what the box is. */
export function madeOfBox(root: THREE.Object3D, box: { colour: number; surface?: SurfaceName }) {
  if (box.surface !== undefined) madeOfColour(root, box.colour, NAMED[box.surface]);
}

const hsl = { h: 0, s: 0, l: 0 };

/** Whether a colour is the brown of wood. */
function woody(colour: THREE.Color): boolean {
  colour.getHSL(hsl, THREE.SRGBColorSpace);
  const hue = hsl.h * 360;
  return hue >= 12 && hue <= 45 && hsl.s >= 0.2 && hsl.s <= 0.7 && hsl.l >= 0.1 && hsl.l <= 0.6;
}

/**
 * What a room's floor is: what the level says, else guessed from its colour: boards, tiles,
 * concrete or carpet. A wooden floor is boards.
 */
export function floorSurface(floor: { colour: number; surface?: SurfaceName }): Surface {
  if (floor.surface !== undefined) {
    const named = NAMED[floor.surface];
    return named === Surface.Wood ? Surface.Planks : named;
  }
  const c = new THREE.Color(floor.colour);
  if (woody(c)) return Surface.Planks;
  c.getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.s < 0.1 && hsl.l < 0.62) return Surface.Concrete;
  if (hsl.l > 0.7) return Surface.Tiles;
  return Surface.Fabric;
}

/**
 * What the ground outside is: what the level says, else the house's paved yard if it keeps the
 * yard's colour, or sand, gravel or trodden earth.
 */
export function groundSurface(level: {
  groundColour?: number;
  groundSurface?: SurfaceName;
}): Surface {
  if (level.groundSurface !== undefined) return NAMED[level.groundSurface];
  return level.groundColour === undefined ? Surface.Paving : Surface.Dirt;
}

/**
 * What a material is made of: its tag if it has one, else a guess from its colour and finish.
 * Bricks, players, the level's boxes that say what they are and the like are tagged where they
 * are made; the rest is guessed.
 */
export function surfaceOf(material: THREE.Material): Surface {
  const tagged = material.userData[SURFACE] as Surface | undefined;
  if (tagged !== undefined) return tagged;
  if (!(material instanceof THREE.MeshStandardMaterial)) return Surface.None;
  if (material.map || material.transparent || material.opacity < 1) return Surface.None;
  if (material.metalness >= 0.4) return Surface.Metal;
  if (material.roughness >= 0.93) return Surface.Fabric;
  material.color.getHSL(hsl, THREE.SRGBColorSpace);
  if (material.roughness <= 0.5 && hsl.s > 0.3) return Surface.Plastic;
  if (woody(material.color)) return Surface.Wood;
  return Surface.Auto;
}

/**
 * The sun's glint on the sea further off, as sparkles (see `AFTER_LIGHTS`): from `from` metres
 * away to `to` it turns from the glint as lit into sparkles; there the sea is as rough as
 * `rough` (the glint's breadth); the sparkles are the water's cells `cell` metres across, each
 * flickering on or off `flicker` times a second, at most `most` of them lit where the glint is
 * at its `full` brightness or over, and lit `bright` times that. Nearer, the glint is held to
 * `near`.
 */
const GLINT = {
  from: 9,
  to: 26,
  rough: 0.12,
  cell: 0.4,
  flicker: 2.5,
  most: 0.35,
  full: 1.5,
  bright: 2.4,
  near: 4,
};

/** How many rectangles of water the painted water's shores are worked out from (see `SHORES`). */
const MAX_SHORES = 4;

const SHARED = /* glsl */ `
varying vec3 vStyleWorld;
varying vec3 vStyleNormal;
#ifdef STYLE_SURFACE_ATTR
  varying float vStyleSurface;
#endif
#ifdef STYLE_TERRAIN
  varying vec2 vStyleGround;
#endif
#ifdef STYLE_WATER
  /** The water's rectangles, as x0, z0, x1, z1, with the sides that are not shores far away. */
  uniform vec4 styleShores[ ${MAX_SHORES} ];
#endif
`;

const VERTEX_HEAD = /* glsl */ `
${SHARED}
#ifdef STYLE_SURFACE_ATTR
  attribute float ${SURFACE_ATTRIBUTE};
#endif
#ifdef STYLE_TERRAIN
  attribute vec2 ${GROUND_ATTRIBUTE};
#endif
`;

const VERTEX_BODY = /* glsl */ `
{
  vec4 styleWorld = vec4( transformed, 1.0 );
  vec3 styleNormal = objectNormal;
  #ifdef USE_BATCHING
    styleWorld = batchingMatrix * styleWorld;
    styleNormal = mat3( batchingMatrix ) * styleNormal;
  #endif
  #ifdef USE_INSTANCING
    styleWorld = instanceMatrix * styleWorld;
    styleNormal = mat3( instanceMatrix ) * styleNormal;
  #endif
  vStyleWorld = ( modelMatrix * styleWorld ).xyz;
  vStyleNormal = normalize( mat3( modelMatrix ) * styleNormal );
  #ifdef STYLE_SURFACE_ATTR
    vStyleSurface = ${SURFACE_ATTRIBUTE};
  #endif
  #ifdef STYLE_TERRAIN
    vStyleGround = ${GROUND_ATTRIBUTE};
  #endif
}
`;

/**
 * The painted water's shores slope down to meet the ground just past them: level all the way to
 * its edge, it hung clear of the lake's bed there, which showed under it as a dark line along
 * the shore wherever it was seen at a slant. Its sheet's points on a shore go down to the ground
 * and a few centimetres out over it, under the shore's own floor (see `waterSheet` in scene.ts,
 * which has a line of points a little way in from every side for the slope to start at).
 */
const WATER_VERTEX = /* glsl */ `
#if defined( STYLE_WATER ) && ! defined( STYLE_SHORE_MAP )
  {
    vec3 styleAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
    vec3 styleMove = vec3( 0.0 );
    for ( int i = 0; i < ${MAX_SHORES}; i ++ ) {
      vec4 r = styleShores[ i ];
      vec4 d = vec4( styleAt.x - r.x, styleAt.z - r.y, r.z - styleAt.x, r.w - styleAt.z );
      if ( min( min( d.x, d.y ), min( d.z, d.w ) ) < -0.01 ) continue;
      // Which shores of this rectangle the point is on.
      vec4 on = step( d, vec4( 0.01 ) );
      if ( on.x + on.y + on.z + on.w > 0.0 ) {
        styleMove = vec3( on.z - on.x, 0.0, on.w - on.y ) * 0.04 - vec3( 0.0, styleAt.y, 0.0 );
      }
    }
    transformed += inverse( mat3( modelMatrix ) ) * styleMove;
  }
#endif
`;

/**
 * The painted style's textures (see `styleDetail`), after hand-painted game art: every board,
 * tile, slab, brick and shingle its own shade, some warmer and some cooler, its edges picked out
 * with a lighter rim inside a dark groove; long strokes of paint along wood's grain; big soft
 * mottling on plaster and fabric; tufts in the grass and pebbles in the sand; and water in
 * turquoise shallows and blue depths with foam along its shores. The detail is broad and soft
 * rather than fine, so it reads from afar without shimmering.
 */
const PAINTED_DETAIL = /* glsl */ `
/**
 * The edge of a board, tile or slab \`e\` metres in from its side, where a pixel is \`pixel\`
 * metres across: .x a dark groove \`groove\` wide, .y a lighter rim \`rim\` wide inside it, fading
 * softly into the middle. The rim goes once it is thinner than a pixel or so, where it would only
 * shimmer, and the groove fades to as much as it covers of the pixel.
 */
vec2 paintedBevelAt( float e, float pixel, float groove, float rim ) {
  float aa = max( pixel, 1e-5 );
  float inside = smoothstep( groove - aa, groove + aa, e );
  float g = ( 1.0 - inside ) * min( 1.0, groove * 2.0 / aa );
  float r = inside * ( 1.0 - smoothstep( groove + rim * 0.3, groove + rim + aa, e ) );
  return vec2( g, r * ( 1.0 - smoothstep( 0.4, 1.0, aa / rim ) ) );
}

/**
 * The same, with the pixel's size in metres worked out from \`e\` itself. That goes wrong in the
 * pixels where \`e\` turns round (at a joint, and halfway across a board): when that matters,
 * \`paintedBevelAt\` takes it from what runs straight on across the joints instead.
 */
vec2 paintedBevel( float e, float groove, float rim ) {
  return paintedBevelAt( e, fwidth( e ), groove, rim );
}

/**
 * Boards \`width\` metres wide running along \`along\` (\`across\` them), \`len\` long with their
 * ends staggered: each its own shade, painted in long strokes along the grain with a dark grain
 * line or two swept round by them, a dark groove between boards with a worn, lighter edge
 * beside it, and a knot on some.
 */
void paintedBoards( inout StyleDetail d, float along, float across, float width, float len, float seed ) {
  float bx = across / width;
  float id = floor( bx );
  float bz = along / len + sHash( vec3( id, 7.0, seed ) );
  vec2 f = vec2( fract( bx ), fract( bz ) );
  float cell = sHash( vec3( id, floor( bz ), seed ) );
  float tone = fract( cell * 47.3 );
  float e = min( min( f.x, 1.0 - f.x ) * width, min( f.y, 1.0 - f.y ) * len );
  // Strokes a few centimetres wide and most of a metre long: hard-edged, as from a brush.
  float s = sNoise( vec3( along * 1.4, across * 30.0, cell * 13.0 ) );
  float stroke = mix( 0.5, smoothstep( 0.3, 0.7, s ), sFine( across * 30.0 ) );
  float grain = sLine( ( f.x + s * 0.12 ) * 2.0 + cell, width * 0.5, 0.003 ) * sFine( bx * 2.0 );
  // A knot: a dark heart in a lighter ring, on about one board in four.
  vec2 k = ( f - vec2( 0.3 + 0.4 * tone, 0.2 + 0.6 * fract( cell * 13.7 ) ) ) * vec2( width, len );
  float kr = length( k / vec2( 0.018, 0.04 ) );
  float knot = step( 0.75, fract( cell * 7.9 ) ) * sFine( kr * 0.5 );
  float heart = knot * ( 1.0 - smoothstep( 0.6, 1.0, kr ) );
  float ring = knot * smoothstep( 0.9, 1.3, kr ) * ( 1.0 - smoothstep( 1.4, 2.4, kr ) );
  vec2 bevel = paintedBevel( e, 0.004, 0.02 );
  d.tint = 0.66 + 0.3 * cell + 0.24 * ( stroke - 0.5 ) + 0.22 * bevel.y + 0.12 * ring;
  d.ink = max( bevel.x, max( grain * 0.45, heart * 0.7 ) );
  d.warm = vec3( 0.07, 0.02, -0.05 ) * ( tone - 0.5 ) * 2.0;
  d.height = stroke * 0.4 + smoothstep( 0.0, 0.015, e ) - heart * 0.5;
  d.rough = ( cell - 0.5 ) * 0.1 - 0.05;
}

/** How rich the painted colours are, for each surface. */
float paintedSaturation( int k ) {
  // Wood kept a deep brown: richer, it went orange.
  if ( k == 2 || k == 3 ) return 1.0;
  // Plaster, sand and concrete only a little, so walls and floors stay calm behind the bright
  // bricks and players.
  if ( k == 1 || k == 6 || k == 9 ) return 1.12;
  // The terrain as it is: its colours are painted rich already (see \`TERRAIN_COLOURS\`).
  if ( k == 18 ) return 1.0;
  if ( k == 7 ) return 1.15;
  return PAINTED_SATURATION;
}

/** How much the edges a surface curves round sharply are picked out (see \`AFTER_COLOUR\`). */
float paintedEdge( int k ) {
  if ( k == 10 ) return 1.0;
  if ( k == 2 ) return 0.7;
  // Bricks and players clean, in their own colours; water, grass and the ground have none.
  if ( k == 11 || k == 15 || k == 16 || k == 7 || k == 6 || k == 18 ) return 0.0;
  return 0.4;
}

/**
 * Sand and earth: warm, in soft drifts, dotted with grit and scattered with painted pebbles,
 * each its own colour, lit on its top and with a dark rim round its foot.
 */
void paintedSand( inout StyleDetail d, vec3 p ) {
  float drift = sFbm( p * 0.5 );
  float grit = smoothstep( 0.74, 0.8, sNoise( p * 24.0 ) ) * sFine( p * 24.0 );
  vec2 pc = p.xz * 7.0;
  vec2 pid = floor( pc );
  float ph = sHash( vec3( pid, 6.0 ) );
  // One hash a cell, spread into where the pebble lies, its size and its shade.
  vec2 centre = pid + 0.25 + 0.5 * fract( ph * vec2( 7.13, 31.7 ) );
  float size = 0.14 + 0.2 * fract( ph * 53.1 );
  vec2 off = ( pc - centre ) * vec2( 1.0, 1.35 ) / size;
  float pd = length( off );
  float pebble = ( 1.0 - smoothstep( 0.8, 1.0, pd ) ) * step( 0.66, ph ) * sFine( vec3( pc.x, 0.0, pc.y ) * 0.3 );
  // Lit from above and the far side, as the sun mostly is.
  float lit = smoothstep( 0.2, 0.8, -off.y * 0.8 + off.x * 0.3 ) * pebble;
  float shade = fract( ph * 97.3 );
  d.tint = 0.9 + 0.2 * drift - 0.08 * grit + pebble * ( ( shade - 0.5 ) * 0.4 + 0.25 * lit - 0.1 );
  d.ink = pebble * smoothstep( 0.65, 1.0, pd ) * 0.7;
  d.height = pebble * ( 1.0 - pd * pd ) * 2.0 - grit * 0.3;
  d.warm = vec3( 0.06, 0.02, -0.05 ) * ( drift - 0.5 ) * 2.0
    + pebble * vec3( -0.12, -0.04, 0.08 ) * step( 0.5, fract( ph * 11.3 ) );
  d.rough = pebble * -0.1;
}

/**
 * Grass, painted: broad patches of yellow-green and blue-green, darker clumps, and tufts in
 * short strokes, lighter toward their tips with a dark shadow at their foot, which fade to the
 * calm patches in the distance.
 */
void paintedGrass( inout StyleDetail d, vec3 p ) {
  float patches = sFbm( p * 0.45 );
  float clump = smoothstep( 0.45, 0.75, sNoise( vec3( p.x * 2.2, 0.5, p.z * 2.2 ) ) );
  vec2 gc = p.xz * 6.0;
  vec2 gid = floor( gc );
  float gh = sHash( vec3( gid, 7.0 ) );
  // Each tuft leans a little its own way from the painter's stroke, roughly along -z.
  float lean = ( fract( gh * 17.3 ) - 0.5 ) * 1.2;
  vec2 dir = vec2( sin( lean ), -cos( lean ) );
  vec2 g = gc - gid - ( 0.3 + 0.4 * fract( gh * vec2( 7.13, 31.7 ) ) );
  vec2 l = vec2( dot( g, dir ), dot( g, vec2( -dir.y, dir.x ) ) );
  float blade = length( l / vec2( 0.34, 0.09 ) );
  float shadow = length( ( l + vec2( 0.06, -0.05 ) ) / vec2( 0.34, 0.12 ) );
  float near = sFine( vec3( gc.x, 0.0, gc.y ) * 0.5 ) * step( 0.25, gh );
  float tuft = ( 1.0 - smoothstep( 0.7, 1.0, blade ) ) * near;
  float under = ( 1.0 - smoothstep( 0.6, 1.0, shadow ) ) * near * ( 1.0 - tuft );
  d.tint = 0.84 + 0.26 * patches - 0.16 * clump + tuft * ( 0.12 + 0.12 * l.x / 0.34 ) - under * 0.18;
  d.warm = mix( vec3( -0.12, -0.02, 0.16 ), vec3( 0.16, 0.06, -0.12 ), smoothstep( 0.4, 0.6, patches ) )
    + tuft * vec3( 0.06, 0.03, -0.04 );
  d.height = tuft * 2.0 - under + clump;
  d.rough = 0.1;
}

void paintedDetail( inout StyleDetail d, int k, vec3 p, vec3 n, vec3 an, vec2 uv, vec3 q ) {
  if ( k == 1 || ( k == 8 && n.y < 0.3 ) ) {
    // Plaster: big soft patches, warmer where they are lighter, and the faint marks of a broad
    // brush across them.
    float mottle = sFbm( p * 0.8 );
    float brush = sNoise( vec3( ( p.x + p.z ) * 1.6, p.y * 9.0, ( p.x - p.z ) * 1.6 ) );
    d.tint = 1.0 + ( mottle - 0.5 ) * 0.26 + ( brush - 0.5 ) * 0.06;
    d.warm = vec3( 0.05, 0.015, -0.05 ) * ( mottle - 0.5 ) * 2.0;
    d.height = brush * 0.5;
    d.rough = 0.05;
  } else if ( k == 2 ) {
    // Wood: boards along x on top (or z on faces looking along x), and upright on the sides,
    // as posts, legs and doors are mostly made: run along, the boards cut every post into a
    // stack of blocks. Upright, they are wide (a strip, such as a skirting board, then has a
    // joint only now and then) and long enough to be one board top to bottom.
    if ( an.y >= an.x && an.y >= an.z ) {
      paintedBoards( d, q.x, q.z, 0.2, 1.4, 2.0 );
    } else {
      paintedBoards( d, p.y, q.x, 0.32, 8.0, 2.0 );
    }
  } else if ( k == 3 ) {
    // Floorboards running along z, 16 cm wide.
    paintedBoards( d, uv.y, uv.x, 0.16, 1.6, 3.0 );
    d.tint *= 0.8;
  } else if ( k == 17 ) {
    // A fence's upright boards, 14 cm wide and each one piece from the gravel board to the
    // capping: each its own shade, darker and lighter in long soft patches up its length, and a
    // dark joint between boards with a worn, lighter edge beside it. Painted, the joints fade
    // evenly to a faint line far off; as real gaps, they were thinner than a pixel there and
    // came out as broken dashes. Nothing finer than a board runs across them, which would only
    // break up into moiré a few metres off.
    float bx = uv.x / 0.14;
    float cell = sHash( vec3( floor( bx ), 17.0, 4.0 ) );
    float e = min( fract( bx ), 1.0 - fract( bx ) ) * 0.14;
    float streak = sNoise( vec3( p.y * 1.6, floor( bx ), cell * 13.0 ) );
    vec2 bevel = paintedBevelAt( e, fwidth( uv.x ), 0.004, 0.015 );
    d.tint = 0.96 + 0.08 * cell + 0.08 * ( streak - 0.5 ) + 0.15 * bevel.y;
    d.ink = bevel.x;
    d.warm = vec3( 0.04, 0.01, -0.03 ) * ( fract( cell * 47.3 ) - 0.5 ) * 2.0;
    d.height = streak * 0.3;
    d.rough = ( cell - 0.5 ) * 0.1;
  } else if ( k == 4 ) {
    // Tiles, 30 cm square: a glaze pooled a little unevenly, a lighter rim inside each tile's
    // edge, and dark grout.
    vec2 t = uv / 0.3;
    vec2 f = fract( t );
    float cell = sHash( vec3( floor( t ), 5.0 ) );
    float glaze = sNoise( p * 4.0 );
    float e = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) * 0.3 + ( glaze - 0.5 ) * 0.006;
    vec2 bevel = paintedBevel( e, 0.004, 0.022 );
    d.tint = 0.93 + 0.12 * cell + ( glaze - 0.5 ) * 0.08 + 0.14 * bevel.y;
    d.ink = bevel.x;
    d.warm = vec3( 0.03, 0.0, -0.04 ) * ( fract( cell * 31.7 ) - 0.5 ) * 2.0;
    d.height = smoothstep( 0.0, 0.015, e );
    d.rough = mix( -0.35, 0.3, bevel.x );
  } else if ( k == 5 ) {
    // Fabric: soft and matt, in broad folds that wander, with a gentle nap.
    float wander = sNoise( p * 1.5 );
    float folds = 0.5 + 0.5 * sin( ( uv.x + uv.y * 0.4 ) * 9.0 + wander * 5.0 );
    float nap = sNoise( p * 7.0 );
    d.tint = 0.94 + ( folds - 0.5 ) * 0.22 + ( wander - 0.5 ) * 0.12 + ( nap - 0.5 ) * 0.05;
    d.warm = vec3( 0.03, 0.0, -0.03 ) * ( folds - 0.5 ) * 2.0;
    d.height = folds * 2.0 + nap * 0.3;
    d.rough = 0.1;
  } else if ( k == 6 ) {
    paintedSand( d, p );
  } else if ( k == 7 ) {
    paintedGrass( d, p );
  #ifdef STYLE_TERRAIN
  } else if ( k == 18 ) {
    terrainBank( d, p, n );
  #endif
  } else if ( k == 8 ) {
    // Shingles in chunky staggered rows, rounded at their foot, each its own shade: a light
    // band along the foot, and a dark line under each row where it overlaps the row below.
    // Down the slope is whichever way along z the roof faces.
    float row = uv.y * ( n.z < 0.0 ? -1.0 : 1.0 ) / 0.22;
    float rid = floor( row );
    float col = uv.x / 0.3 + 0.5 * mod( rid, 2.0 );
    vec2 f = vec2( fract( col ), fract( row ) );
    float cell = sHash( vec3( floor( col ), rid, 9.0 ) );
    float mottle = sNoise( p * 5.0 );
    float aa = fwidth( row );
    // How far above its rounded foot, in rows.
    float foot = 1.0 - 0.22 * ( 2.0 * f.x - 1.0 ) * ( 2.0 * f.x - 1.0 ) - f.y;
    float edge = smoothstep( -aa, aa, foot ) * ( 1.0 - smoothstep( 0.08, 0.2, foot ) );
    float under = max( 1.0 - smoothstep( -aa, aa, foot ), 1.0 - smoothstep( 0.0, 0.12 + aa, f.y ) );
    float seam = sLine( col, 0.3, 0.01 ) * step( 0.0, foot );
    float fade = 1.0 - smoothstep( 0.15, 0.4, aa );
    d.tint = 0.78 + 0.32 * cell + ( mottle - 0.5 ) * 0.1 + 0.2 * edge * fade;
    d.ink = max( under * 0.75 * fade, seam );
    d.warm = vec3( 0.06, 0.01, -0.05 ) * ( fract( cell * 23.9 ) - 0.5 ) * 2.0;
    d.height = ( f.y + max( foot, 0.0 ) ) * 0.6 - d.ink;
  } else if ( k == 9 ) {
    // Concrete cast in big slabs (panels on walls), a joint between them with a lighter edge
    // beside it, soft stains, and a few pores.
    vec2 s = uv / 1.5;
    vec2 f = fract( s );
    float cell = sHash( vec3( floor( s ), 9.0 ) );
    float stain = sFbm( p * 0.7 );
    float pores = smoothstep( 0.84, 0.9, sNoise( p * 30.0 ) ) * sFine( p * 30.0 );
    float e = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) ) * 1.5 + ( stain - 0.5 ) * 0.03;
    vec2 bevel = paintedBevel( e, 0.006, 0.045 );
    d.tint = 0.9 + 0.12 * cell + ( stain - 0.5 ) * 0.26 + 0.12 * bevel.y - 0.06 * pores;
    d.ink = max( bevel.x, pores * 0.2 );
    d.warm = vec3( 0.03, 0.01, -0.04 ) * ( fract( cell * 23.1 ) - 0.5 ) * 2.0;
    d.height = smoothstep( 0.0, 0.04, e ) - pores * 0.5;
    d.rough = 0.05;
  } else if ( k == 10 ) {
    // Painted metal: a broad, soft sheen; its edges are caught bright (see \`paintedEdge\`).
    float sheen = sNoise( vec3( q.x * 1.5, q.y * 6.0, q.z * 6.0 ) );
    d.tint = 0.95 + ( sheen - 0.5 ) * 0.2;
    d.rough = ( sheen - 0.5 ) * 0.2;
    d.height = sheen * 0.5;
  } else if ( k == 11 || k == 15 ) {
    // Moulded plastic: smooth and shiny, all but spotless.
    d.tint = 1.0 + ( sNoise( p * 8.0 ) - 0.5 ) * 0.03;
    d.rough = -0.12;
  } else if ( k == 12 ) {
    // Brickwork in stretcher bond: chunky bricks each its own shade, warmer or cooler, with a
    // lighter rim inside their edges and dark mortar sunk between them.
    float rowB = p.y / 0.075;
    float u = an.x > an.z ? p.z : p.x;
    float colB = u / 0.225 + 0.5 * mod( floor( rowB ), 2.0 );
    vec2 f = vec2( fract( colB ), fract( rowB ) );
    float cell = sHash( vec3( floor( colB ), floor( rowB ), 2.0 ) );
    float mottle = sNoise( p * 6.0 );
    float e = min( min( f.x, 1.0 - f.x ) * 0.225, min( f.y, 1.0 - f.y ) * 0.075 ) + ( mottle - 0.5 ) * 0.004;
    vec2 bevel = paintedBevel( e, 0.005, 0.012 ) * ( an.y > 0.5 ? 0.0 : 1.0 );
    d.tint = 0.8 + 0.3 * cell + ( mottle - 0.5 ) * 0.14 + 0.18 * bevel.y;
    d.ink = bevel.x;
    d.warm = vec3( 0.06, 0.0, -0.06 ) * ( fract( cell * 41.3 ) - 0.5 ) * 2.0;
    d.height = smoothstep( 0.0, 0.01, e ) * ( an.y > 0.5 ? 0.0 : 1.0 );
  } else if ( k == 13 ) {
    // Paving slabs in a running bond, each its own shade, warmer or cooler, worn in soft
    // patches, with a lighter rim inside its edges and dark joints between.
    float rowP = uv.y / 0.6;
    float colP = uv.x / 0.9 + 0.5 * mod( floor( rowP ), 2.0 );
    vec2 f = vec2( fract( colP ), fract( rowP ) );
    float cell = sHash( vec3( floor( colP ), floor( rowP ), 4.0 ) );
    float wear = sFbm( p * 0.9 );
    float e = min( min( f.x, 1.0 - f.x ) * 0.9, min( f.y, 1.0 - f.y ) * 0.6 ) + ( wear - 0.5 ) * 0.02;
    vec2 bevel = paintedBevel( e, 0.006, 0.035 );
    d.tint = 0.78 + 0.28 * cell + ( wear - 0.5 ) * 0.2 + 0.16 * bevel.y;
    d.ink = bevel.x;
    d.warm = vec3( 0.08, 0.02, -0.08 ) * ( fract( cell * 29.3 ) - 0.5 ) * 2.0;
    d.height = smoothstep( 0.0, 0.03, e );
    d.rough = 0.05;
  #ifdef STYLE_WATER
  } else if ( k == 16 ) {
    // Water: turquoise in the shallows by the shore, deepening to blue further out, ripples
    // running over it with glints of light on their crests, and foam along the shore that laps
    // in and out, with broken lines of it rolling in.
    float t = styleTime;
    float ra = sNoise( vec3( p.xz * 3.1 + vec2( t * 0.35, t * 0.12 ), t * 0.2 ) );
    float rb = sNoise( vec3( p.xz * vec2( 4.3, 3.7 ) - vec2( t * 0.18, -t * 0.29 ), 3.0 + t * 0.25 ) );
    float fine = sFine( p * 11.0 );
    float rf = sNoise( vec3( p.xz * 11.0 + vec2( t * 0.6, 0.0 ), t * 0.5 ) );
    float swell = sin( p.x * 0.9 + p.z * 0.4 + t * 0.8 ) + sin( p.z * 1.3 - p.x * 0.3 + t * 0.6 );
    float deep = sNoise( vec3( p.xz * 0.3, 1.0 ) );
    #ifdef STYLE_SHORE_MAP
      // How far out from the shore, and how deep: read from the shore map (see \`SHORE_MAP\`).
      // Both have run up to their most by its edges, and past them stay as there: stepping up to
      // far out past them painted a line of foam round it.
      // And how far from whatever stands in it.
      vec3 field = texture2D( styleShoreMap, ( p.xz - styleShoreRect.xy ) / styleShoreRect.zw ).rgb;
      float shore = field.r * field.r * ${SHORE_RANGE.toFixed(1)};
      float under = field.g * ${DEPTH_RANGE.toFixed(1)};
      float standing = field.b * field.b * ${SHORE_RANGE.toFixed(1)};
      // And from the rocks and islets standing out of the open sea past its reach (see
      // \`SEA_ROCKS\`), each as an oval turned its own way.
      for ( int i = 0; i < ${MAX_SEA_ROCKS}; i ++ ) {
        vec4 r = styleSeaRocks[ i ];
        vec2 turn = styleSeaRockTurns[ i ];
        vec2 o = p.xz - r.xy;
        vec2 q = vec2( dot( o, turn ), dot( o, vec2( - turn.y, turn.x ) ) ) / r.zw;
        float k = length( q );
        // How far out from the oval, near enough: its level over how fast it climbs.
        float beyond = ( k - 1.0 ) * k / max( length( q / r.zw ), 1e-4 );
        shore = min( shore, max( beyond, 0.0 ) );
      }
    #else
      // How far in from the nearest shore: the edge of the water's rectangles (see \`SHORES\`).
      float shore = -1e4;
      for ( int i = 0; i < ${MAX_SHORES}; i ++ ) {
        vec4 r = styleShores[ i ];
        shore = max( shore, min( min( p.x - r.x, r.z - p.x ), min( p.z - r.y, r.w - p.z ) ) );
      }
      shore = shore < -100.0 ? 1e3 : max( shore, 0.0 );
      float standing = 1e3;
    #endif
    // The shoreline wavers with the ripples.
    float wobble = ( ra - 0.5 ) * 0.3 + ( rb - 0.5 ) * 0.15;
    float s = shore + wobble;
    float aa = fwidth( s );
    // A band of foam at the shore, swelling and ebbing as the waves lap, its edge broken up.
    float lap = 0.22 + 0.1 * sin( t * 1.1 + ( p.x + p.z ) * 0.4 );
    float band = 1.0 - smoothstep( lap - aa, lap + aa + 0.03, s + ( rf - 0.5 ) * 0.1 * fine );
    // A narrower one, wavering less, round the foot of whatever stands in the water: as wide as
    // a shore's, a post stood on a white disc.
    float st = standing + wobble * 0.35;
    float aaSt = fwidth( st );
    band = max( band, 1.0 - smoothstep( lap * 0.45 - aaSt, lap * 0.45 + aaSt + 0.02, st + ( rf - 0.5 ) * 0.04 * fine ) );
    // Lines of foam rolling in toward them, broken, fading as they go further out.
    float sl = min( s, st );
    float roll = fract( sl / 0.9 + t * 0.22 );
    float line = smoothstep( 0.8, 0.86, roll ) * ( 1.0 - smoothstep( 0.9, 0.97, roll ) )
      * smoothstep( 0.42, 0.58, rb ) * ( 1.0 - smoothstep( 0.6, 2.2, sl ) )
      * ( 1.0 - smoothstep( 0.04, 0.1, fwidth( sl ) ) );
    float foam = max( band, line * 0.8 );
    #ifdef STYLE_SHORE_MAP
      // Turquoise in the shallows along the shore, blue further out and where the bed drops
      // away.
      float depth = max( smoothstep( 1.2, 7.0, shore + ( deep - 0.5 ) * 2.5 ), smoothstep( 0.4, 2.8, under ) );
      // Clear where it is only ankle deep, so the sand shows through, and as good as opaque out
      // over the deep (where the bed under it ends).
      float opacity = mix( 0.6, mix( 0.86, 0.97, depth ), smoothstep( 0.0, 0.45, under ) );
      opacity = mix( opacity, 1.0, smoothstep( 2.6, 3.8, under ) );
    #else
      float depth = smoothstep( 0.3, 4.5, s + ( deep - 0.5 ) * 1.8 );
      float opacity = mix( 0.86, 0.96, depth );
    #endif
    #ifdef STYLE_SHORE_MAP
      // The open sea's: bluer than a lake's, and brighter.
      vec3 water = mix( vec3( 0.03, 0.55, 0.66 ), vec3( 0.014, 0.15, 0.52 ), depth );
    #else
      vec3 water = mix( vec3( 0.1, 0.55, 0.52 ), vec3( 0.012, 0.13, 0.33 ), depth );
    #endif
    // Lighter on the ripples' crests, as painted, with glints on the sharpest.
    water *= 0.88 + 0.3 * smoothstep( 0.5, 0.85, ( ra + rb ) * 0.5 );
    paintedSparkle = smoothstep( 0.84, 0.9, rf ) * smoothstep( 0.55, 0.7, ( ra + rb ) * 0.5 ) * fine * ( 1.0 - foam );
    paintedWater = vec4( mix( water, vec3( 0.92, 0.98, 1.0 ), max( foam, paintedSparkle ) ), max( opacity, foam ) );
    d.height = ( ra + rb + 0.5 * rf * fine ) * 2.5 * ( 1.0 - foam ) + swell * 0.6;
    d.rough = -0.4 + foam * 0.7;
  #endif
  } else if ( k == 0 ) {
    d.tint = 1.0 + ( sFbm( p * 1.5 ) - 0.5 ) * 0.08;
    d.height = sNoise( p * 50.0 ) * 0.2;
  }
}
`;

/**
 * The terrain (see `Surface.Terrain`): at each point sand, grass or a bank of bare earth, picked
 * from how grassy and rocky its vertices say it is with the edges between broken up by noise, so
 * they wander in tongues and clumps as painted rather than follow its triangles; each then
 * textured as that surface is in the style (and the earth as its own, below). Its colours are its
 * own too, picked with the ground: the sand wet along the waterline and darker under the sea, a
 * band of shade on the sand along the grass's edge, as though the grass stood up off it, and the
 * tips of the grass lighter along it. Rock is left to the rocks standing on it: the steep ground
 * is bare earth, the beach's sand darker and warmer, fading into the sand at its foot and under
 * a lip of grass at its top.
 */
const TERRAIN_DETAIL = /* glsl */ `
#ifdef STYLE_TERRAIN
uniform float styleSea;
/** The terrain's colour here, picked with its ground (see \`terrainPick\`). */
vec3 styleGroundColour;
/** How far into its bank the earth here is, 0 at its edge to 1 a little in (see \`terrainBank\`). */
float styleBank;

struct TerrainPick {
  /** Which surface it is: 6 sand, 7 grass, or 18 a bank of bare earth (see \`terrainBank\`). */
  int kind;
  /** How far into the grass and the bank (above 0) or out of them (below), in their weights. */
  float grass;
  float bank;
  /** How wet the sand is, along the waterline. */
  float wet;
};

TerrainPick terrainPick( vec3 p ) {
  TerrainPick t;
  // Tongues a few metres long, and clumps under one.
  float big = sNoise( p * 0.55 + 3.1 ) - 0.5;
  float clump = sNoise( vec3( p.x * 2.4, p.y * 1.2, p.z * 2.4 ) + 7.7 ) - 0.5;
  // And the grass's edge ragged with tufts, which fade out where they would only shimmer.
  float tufts = ( sNoise( vec3( p.x * 6.0, p.y * 2.0, p.z * 6.0 ) + 2.9 ) - 0.5 )
    * sFine( vec3( p.x * 6.0, 0.0, p.z * 6.0 ) );
  t.grass = vStyleGround.x - 0.5 + big * 0.4 + clump * 0.34 + tufts * 0.24;
  // The bank's edge as ragged, the turf over it breaking off in tongues and tufts.
  t.bank = vStyleGround.y - 0.5 + big * 0.3 + clump * 0.24 - tufts * 0.12;
  float above = p.y - styleSea;
  t.wet = 1.0 - smoothstep( 0.04, 0.14, above + clump * 0.08 );
  vec3 sand = mix( ${glslColour(TERRAIN_COLOURS.sand)}, ${glslColour(TERRAIN_COLOURS.wet)}, t.wet );
  // Under the sea: greener, and darker the deeper.
  sand = mix( sand, ${glslColour(TERRAIN_COLOURS.seabed)}, smoothstep( 0.0, 0.9, - above ) );
  sand *= 1.0 - 0.6 * smoothstep( 1.2, 5.0, - above );
  // Soft across a pixel, so the edges do not crawl as the view moves; the bank fades into the
  // sand at its foot over a hand or so, but stops sharp under the grass.
  float g = smoothstep( -1.0, 1.0, t.grass / max( fwidth( t.grass ), 1e-4 ) );
  float sharp = smoothstep( -1.0, 1.0, t.bank / max( fwidth( t.bank ), 1e-4 ) );
  float b = mix( smoothstep( -0.1, 0.1, t.bank ), sharp, g );
  styleBank = smoothstep( 0.0, 0.12, t.bank );
  vec3 ground = mix( sand, ${glslColour(TERRAIN_COLOURS.grass)}, g );
  styleGroundColour = mix( ground, sand * ${earthOverSand()}, b );
  t.kind = t.bank > 0.0 ? 18 : t.grass > 0.0 ? 7 : 6;
  return t;
}

// Written out with the other surfaces, further down (see \`PAINTED_DETAIL\`).
void paintedSand( inout StyleDetail d, vec3 p );

/**
 * Bare earth on a steep bank: the beach's sand (see \`paintedSand\`), in its own darker, warmer
 * colour (see \`terrainPick\`), washed into soft streaks running down it, darker in the gullies
 * between, each wandering a little from side to side; none at the bank's very edge, where it
 * fades into the sand.
 */
void terrainBank( inout StyleDetail d, vec3 p, vec3 n ) {
  paintedSand( d, p );
  // Across the slope: along the level, square to the way down it.
  vec2 down = n.xz / max( length( n.xz ), 1e-3 );
  float across = dot( p.xz, vec2( - down.y, down.x ) );
  float u = across + ( sNoise( vec3( across * 0.5, p.y * 0.6, 3.0 ) ) - 0.5 ) * 0.8;
  float streak = sNoise( vec3( u * 2.0, p.y * 0.3, 7.0 ) );
  float fine = ( sNoise( vec3( u * 6.0, p.y * 0.7, 9.0 ) ) - 0.5 ) * sFine( vec3( u * 6.0, p.y * 0.7, 0.0 ) );
  float gully = smoothstep( 0.5, 0.8, streak ) * styleBank;
  d.tint *= 1.0 - 0.16 * gully + 0.08 * fine * styleBank;
  d.warm += vec3( -0.03, -0.01, 0.03 ) * gully;
  d.height += ( streak * 1.5 + fine * 0.5 ) * styleBank;
}

/** Along the edges between the grounds, and the wet sand's shine (see \`TERRAIN_DETAIL\`). */
void terrainEdges( inout StyleDetail d, TerrainPick t ) {
  if ( t.kind == 6 ) {
    d.tint *= 1.0 - 0.2 * ( 1.0 - smoothstep( 0.0, 0.1, - t.grass ) );
    d.rough -= 0.35 * t.wet;
  } else if ( t.kind == 7 ) {
    float tip = 1.0 - smoothstep( 0.0, 0.08, t.grass );
    d.tint *= 1.0 + 0.16 * tip;
    d.warm += vec3( 0.08, 0.04, -0.06 ) * tip;
  } else {
    // A band of shade along the top of the bank, under the lip of the grass over it.
    d.tint *= 1.0 - 0.28 * ( 1.0 - smoothstep( 0.0, 0.12, t.bank ) ) * step( 0.0, t.grass );
    d.rough -= 0.35 * t.wet;
  }
}
#endif
`;

/**
 * The textures. Each surface gives back how much to brighten or darken it (`tint`), seams and
 * grain to ink in (`ink`), its bumps (`height`), a change to its roughness, and a warmer or
 * cooler shade (`warm`).
 */
const FRAGMENT_HEAD = /* glsl */ `
${SHARED}
uniform float styleSurface;
uniform float styleTime;
#ifdef STYLE_WATER
  /** The painted water's colour and opacity, and its glints, from \`paintedDetail\`. */
  vec4 paintedWater;
  float paintedSparkle;
#endif
#ifdef STYLE_SHORE_MAP
  /**
   * How far from the shore and how deep the sea is (see \`SHORE_MAP\`), over the rectangle with
   * its corner at .xy and .zw across.
   */
  uniform sampler2D styleShoreMap;
  uniform vec4 styleShoreRect;
  /** The rocks standing out of the open sea (see \`SEA_ROCKS\`): middles and sizes, and turns. */
  uniform vec4 styleSeaRocks[ ${MAX_SEA_ROCKS} ];
  uniform vec2 styleSeaRockTurns[ ${MAX_SEA_ROCKS} ];
#endif
#ifdef STYLE_SHORE_MAP
  /** How far the sea here is past where its ripples break up the sun's glint (0 to 1). */
  float styleGlintFar() {
    return smoothstep( ${GLINT.from.toFixed(1)}, ${GLINT.to.toFixed(1)}, length( vViewPosition ) );
  }
#endif

#define PAINTED_SATURATION 1.3

struct StyleDetail { float tint; float ink; float height; float rough; vec3 warm; };

float sHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
float sNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( sHash( i ), sHash( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( sHash( i + vec3( 0, 1, 0 ) ), sHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( sHash( i + vec3( 0, 0, 1 ) ), sHash( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( sHash( i + vec3( 0, 1, 1 ) ), sHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
float sFbm( vec3 p ) {
  return 0.5 * sNoise( p ) + 0.25 * sNoise( p * 2.03 + 1.7 ) + 0.125 * sNoise( p * 4.01 + 3.1 )
    + 0.0625;
}
/** 1 on a line every whole number of \`f\` (cells of \`size\` metres), \`width\` metres wide. */
float sLine( float f, float size, float width ) {
  float w = width / size * 0.5;
  float d = abs( f - floor( f + 0.5 ) );
  float aa = fwidth( f );
  return 1.0 - smoothstep( w - aa, w + aa, d );
}
/** Fades fine detail (\`f\`: the position scaled to its cells) out where it would shimmer. */
float sFine( float f ) {
  return 1.0 - smoothstep( 0.35, 0.9, fwidth( f ) );
}
/**
 * The same for detail that varies along several axes (\`f\`: the position scaled to the detail's
 * cells): it fades as soon as it gets too fine along any of them. Judged along one axis alone,
 * a floor seen along the other (into the distance) kept its fine weave or speckle, which broke
 * up into moiré.
 */
float sFine( vec3 f ) {
  vec3 w = fwidth( f );
  return 1.0 - smoothstep( 0.35, 0.9, max( max( w.x, w.y ), w.z ) );
}
${TERRAIN_DETAIL}
${PAINTED_DETAIL}

StyleDetail styleDetail( float kind, vec3 p, vec3 n ) {
  StyleDetail d = StyleDetail( 1.0, 0.0, 0.0, 0.0, vec3( 0.0 ) );
  int k = int( kind + 0.5 );
  #ifdef STYLE_TERRAIN
    // Sand, grass or a bank of earth, each then textured as itself.
    TerrainPick terrain = terrainPick( p );
    k = terrain.kind;
  #endif
  vec3 an = abs( n );
  // The face's own axes: \`uv\` across it, \`q\` with the wood's grain along x.
  vec2 uv;
  vec3 q;
  if ( an.y >= an.x && an.y >= an.z ) {
    uv = p.xz;
    q = p;
  } else if ( an.x >= an.z ) {
    uv = vec2( p.z, p.y );
    q = p.zyx;
  } else {
    uv = p.xy;
    q = p;
  }

  paintedDetail( d, k, p, n, an, uv, q );
  #ifdef STYLE_TERRAIN
    terrainEdges( d, terrain );
  #endif
  return d;
}

vec3 stylePerturb( vec3 surfPos, vec3 surfNorm, float h, float faceDir ) {
  vec2 dHdxy = vec2( dFdx( h ), dFdy( h ) );
  vec3 sigmaX = normalize( dFdx( surfPos ) );
  vec3 sigmaY = normalize( dFdy( surfPos ) );
  vec3 r1 = cross( sigmaY, surfNorm );
  vec3 r2 = cross( surfNorm, sigmaX );
  float det = dot( sigmaX, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`;

/** After the material's colour: the texture goes on (and the roughness, below). */
const AFTER_COLOUR = /* glsl */ `
#ifdef STYLE_SURFACE_ATTR
  float styleKind = vStyleSurface;
#else
  float styleKind = styleSurface;
#endif
StyleDetail styleD = styleDetail( styleKind, vStyleWorld, normalize( vStyleNormal ) );
#ifdef STYLE_TERRAIN
  // The terrain in its own colours, picked with its ground (see \`terrainPick\`), its edges
  // painted ragged rather than blended along its triangles as its vertex colours are.
  diffuseColor.rgb = styleGroundColour;
#endif
vec3 styleBase = max( diffuseColor.rgb, vec3( 1e-3 ) );
diffuseColor.rgb = max( ( diffuseColor.rgb + styleD.warm * diffuseColor.rgb ) * styleD.tint, 0.0 );
{
  // Richer colours, seams painted in as dark grooves, and faces turned up a little lighter, as
  // painted with the light from above. Where a surface curves sharply round an edge (a bevel, a
  // rail, a rim), it is picked out lighter, as worn paint and polish catch the light in
  // hand-painted art: the curve is how fast the normal turns per metre.
  int kind = int( styleKind + 0.5 );
  vec3 c = diffuseColor.rgb;
  float grey = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = max( mix( vec3( grey ), c, paintedSaturation( kind ) ), 0.0 );
  c *= 1.0 - 0.55 * styleD.ink;
  vec3 sn = normalize( vStyleNormal );
  float curve = length( fwidth( sn ) ) / max( length( fwidth( vStyleWorld ) ), 1e-4 );
  c *= 1.0 + 0.5 * smoothstep( 8.0, 30.0, curve ) * paintedEdge( kind );
  c *= 1.0 + 0.08 * sn.y;
  diffuseColor.rgb = c;
  #ifdef STYLE_WATER
    diffuseColor = paintedWater;
  #endif
}
`;

/**
 * The rooms are filled with light through their emissive colour (see \`lightIndoors\`), which
 * would wash the texture out: it gets the texture too.
 */
const AFTER_EMISSIVE = /* glsl */ `
totalEmissiveRadiance *= diffuseColor.rgb / styleBase;
#if defined( STYLE_WATER ) && NUM_DIR_LIGHTS > 0
  // The painted water's glints shine with the sun (or the moon), and bloom.
  totalEmissiveRadiance += paintedSparkle * directionalLights[ 0 ].color * 0.4;
#endif
`;

const AFTER_ROUGHNESS = /* glsl */ `
roughnessFactor = clamp( roughnessFactor + styleD.rough, 0.04, 1.0 );
#ifdef STYLE_SHORE_MAP
  // Out past where its ripples are drawn, the sea is as rough as they would make it, so the
  // sun's glint on it spreads over as wide a path as on a rippled sea (and is broken into
  // sparkles there, see \`AFTER_LIGHTS\`), rather than shrink to a point as on a mirror.
  roughnessFactor = mix( roughnessFactor, ${GLINT.rough.toFixed(2)}, styleGlintFar() );
#endif
`;

/** The bumps, fading out with distance (where they would only sparkle). */
const AFTER_NORMAL = /* glsl */ `
{
  // Fine bumps fade out with distance; water's ripples reach further.
  #ifdef STYLE_WATER
    float reach = 3.0;
  #else
    float reach = 1.0;
  #endif
  float near = 1.0 - smoothstep( 6.0 * reach, 18.0 * reach, length( vViewPosition ) );
  normal = stylePerturb( - vViewPosition, normal, styleD.height * 0.02 * near, faceDirection );
}
`;

/**
 * The sky and ground reflected, from the hemisphere light, which carries the sky's own
 * light (see `Sky.bakeLight`); three.js reflects nothing without an environment map, so metal
 * looked black and plastic dull. Not where there is one (the metallic bricks'), which reflects
 * better.
 */
const AFTER_LIGHT_MAPS = /* glsl */ `
// Water is clearer to see into from above, and mirrors the sky the more, the flatter it is looked
// across (on top of its own opacity, see \`paintedDetail\`).
#ifdef STYLE_WATER
  float styleFresnel = pow( 1.0 - clamp( dot( normal, geometryViewDir ), 0.0, 1.0 ), 4.0 );
  diffuseColor.a = mix( diffuseColor.a, 1.0, styleFresnel );
#endif
#if NUM_HEMI_LIGHTS > 0 && ! defined( USE_ENVMAP )
{
  vec3 reflected = reflect( - geometryViewDir, normal );
  #ifdef STYLE_WATER
    float mirror = 0.12 + 0.75 * styleFresnel;
  #else
    float mirror = 0.35;
  #endif
  for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
    radiance += getHemisphereLightIrradiance( hemisphereLights[ i ], reflected ) * mirror;
  }
}
#endif
`;

/**
 * The shade a little richer in colour, as painted, and a soft light from the sky round the edges
 * of things turned away from the view.
 */
const AFTER_LIGHTS = /* glsl */ `
{
  vec3 shade = reflectedLight.indirectDiffuse;
  float l = dot( shade, vec3( 0.2126, 0.7152, 0.0722 ) );
  reflectedLight.indirectDiffuse = max( mix( vec3( l ), shade, 1.25 ), 0.0 );
  float rim = pow( 1.0 - clamp( dot( normal, geometryViewDir ), 0.0, 1.0 ), 3.0 );
  reflectedLight.indirectDiffuse += shade * rim * 0.6;
}
#ifdef STYLE_SHORE_MAP
{
  // The sun's (or the moon's) glint on the sea further off, broken into a field of sparkles:
  // a cell of the water's here and there catches the light for a moment, more of them toward
  // the middle of the glint. Lit as smooth as it is, the far water mirrored the sun as one soft
  // white blob, which the bloom only spread wider. Near by, the ripples break it up themselves.
  float far = styleGlintFar();
  vec3 glint = reflectedLight.directSpecular;
  float strength = min( 1.0, max( glint.r, max( glint.g, glint.b ) ) / ${GLINT.full.toFixed(1)} );
  vec2 cell = vStyleWorld.xz / ${GLINT.cell.toFixed(2)};
  vec2 id = floor( cell );
  // Each cell flickers on and off in its own time.
  float flick = floor( styleTime * ${GLINT.flicker.toFixed(1)} + sHash( vec3( id, 3.0 ) ) * 17.0 );
  float lit = step( 1.0 - ${GLINT.most.toFixed(2)} * strength, sHash( vec3( id, flick ) ) );
  vec2 off = fract( cell ) - 0.5
    - ( vec2( sHash( vec3( id, flick + 5.0 ) ), sHash( vec3( id, flick + 9.0 ) ) ) - 0.5 ) * 0.5;
  float spark = lit * ( 1.0 - smoothstep( 0.08, 0.26, length( off ) ) );
  // Where the cells shrink to a pixel or two, what they come to on the whole.
  spark = mix( spark, ${GLINT.most.toFixed(2)} * strength * 0.12, smoothstep( 0.3, 0.7, fwidth( cell.x ) ) );
  vec3 sparkle = min( glint, vec3( ${GLINT.full.toFixed(1)} ) ) * spark * ${GLINT.bright.toFixed(1)};
  // Near by, kept bright but not blinding, so the bloom round it stays tight.
  reflectedLight.directSpecular = mix( min( glint, vec3( ${GLINT.near.toFixed(1)} ) ), sparkle, far );
}
#endif
`;

/** What tells a material's program apart from the others (see `patchStyle`). */
export function programKey(material: THREE.Material): string {
  const surface = material.userData[SURFACE] as Surface | undefined;
  if (surface === Surface.Water) return material.userData[SHORE_MAP] ? 'ws' : 'w';
  return surface === Surface.Terrain ? 't' : '';
}

/** Seconds, for what moves on its own (water); `Graphics.render` keeps it going. */
export const STYLE_TIME = { value: 0 };

/**
 * Set in the water's material's `userData`: the level's rectangles of water (`FloorRect`s),
 * whose sides are its shores, for the painted water's shallows, foam and sloping edge. A side
 * that is no shore (where the water meets the wall round the level) is moved far out of the way.
 */
export const SHORES = 'shores';

/**
 * A level's water as its shores, for `SHORES`: its rectangles, bar their sides along the level's
 * edge, where the water meets the wall round the level instead (or, past it, the country's own
 * lake, which carries on from the level's shore).
 */
export function levelShores(level: LevelDef): FloorRect[] {
  const floor = floorRect(level);
  const EDGE = 0.01;
  // Far out of the way: where a side that is no shore goes.
  const FAR = 1e4;
  return (level.water ?? []).map((w) => ({
    x0: w.x0 > floor.x0 + EDGE ? w.x0 : -FAR,
    x1: w.x1 < floor.x1 - EDGE ? w.x1 : FAR,
    z0: w.z0 > floor.z0 + EDGE ? w.z0 : -FAR,
    z1: w.z1 < floor.z1 - EDGE ? w.z1 : FAR,
  }));
}

/** The water's rectangles for its shader (see `MAX_SHORES`), the rest far out of the way. */
function shoresOf(material: THREE.Material): THREE.Vector4[] {
  const rects = (material.userData[SHORES] ?? []) as FloorRect[];
  return Array.from({ length: MAX_SHORES }, (_, i) => {
    const r = rects[i];
    return r ? new THREE.Vector4(r.x0, r.z0, r.x1, r.z1) : new THREE.Vector4(1e4, 1e4, -1e4, -1e4);
  });
}

/** Thrown away by `replace` without a word if three.js renamed a chunk, so it is checked. */
function insertAfter(source: string, chunk: string, code: string): string {
  const include = `#include <${chunk}>`;
  if (!source.includes(include)) throw new Error(`styles: three.js has no ${include} any more`);
  return source.replace(include, `${include}\n${code}`);
}

/**
 * Paints a material's shaders (from `onBeforeCompile`). The surface uniform goes on every time,
 * since three.js keeps the uniforms from a material's latest compile.
 */
export function patchStyle(
  shader: THREE.WebGLProgramParametersWithUniforms,
  material: THREE.Material,
): void {
  // Unlit things (glows, screens, signs) keep their look.
  if (!shader.fragmentShader.includes('#include <lights_fragment_end>')) return;
  shader.uniforms.styleSurface = { value: surfaceOf(material) };
  shader.uniforms.styleTime = STYLE_TIME;
  // A copy: three.js hands over the material's own defines, which are not this program's alone.
  shader.defines = { ...shader.defines };
  if (material.userData[SURFACE_PER_VERTEX]) {
    shader.defines.STYLE_SURFACE_ATTR = '';
  }
  // Water's ripples and reflections are worked out only in its own program, not in every
  // surface's (see `programKey`).
  if (material.userData[SURFACE] === Surface.Water) {
    shader.defines.STYLE_WATER = '';
    shader.uniforms.styleShores = { value: shoresOf(material) };
    const map = material.userData[SHORE_MAP] as ShoreMap | undefined;
    if (map) {
      shader.defines.STYLE_SHORE_MAP = '';
      const r = map.rect;
      shader.uniforms.styleShoreMap = { value: map.texture };
      shader.uniforms.styleShoreRect = {
        value: new THREE.Vector4(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0),
      };
      const rocks = seaRocksOf(material);
      shader.uniforms.styleSeaRocks = { value: rocks.rocks };
      shader.uniforms.styleSeaRockTurns = { value: rocks.turns };
    }
  }
  // The terrain's sand, grass and earth are picked in its own program (see `programKey`).
  if (material.userData[SURFACE] === Surface.Terrain) {
    shader.defines.STYLE_TERRAIN = '';
    shader.uniforms.styleSea = {
      value: (material.userData[SEA_LEVEL] as number | undefined) ?? -1e3,
    };
  }
  shader.vertexShader = insertAfter(
    insertAfter(
      shader.vertexShader.replace('void main() {', `${VERTEX_HEAD}\nvoid main() {`),
      'begin_vertex',
      WATER_VERTEX,
    ),
    'project_vertex',
    VERTEX_BODY,
  );
  let f = shader.fragmentShader.replace('void main() {', `${FRAGMENT_HEAD}\nvoid main() {`);
  f = insertAfter(f, 'color_fragment', AFTER_COLOUR);
  f = insertAfter(f, 'roughnessmap_fragment', AFTER_ROUGHNESS);
  f = insertAfter(f, 'normal_fragment_maps', AFTER_NORMAL);
  f = insertAfter(f, 'emissivemap_fragment', AFTER_EMISSIVE);
  f = insertAfter(f, 'lights_fragment_maps', AFTER_LIGHT_MAPS);
  f = insertAfter(f, 'lights_fragment_end', AFTER_LIGHTS);
  shader.fragmentShader = f;
}
