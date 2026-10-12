import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { VisualStyle } from '../graphics-settings.ts';

/**
 * The game's visual styles. Classic is the original flat-coloured look and adds nothing. The
 * others redraw every lit surface with its own texture, worked out in the shader from where the
 * surface is in the world (no image files, nothing to load, and the same on every machine):
 *
 * - Realistic: wood grain, plank floors, tiled kitchens, plaster, paving, shingles, woven
 *   fabric and brushed metal, with fine bumps catching the light, shinier plastic bricks,
 *   reflections of the sky and gentle tone mapping.
 * - Cartoon: flat, punchy colours lit in a few hard bands, ink outlines round everything and
 *   along its creases, and inked seams and grain.
 * - Storybook: a watercolour picture book. Soft, pale washes that pool unevenly and darken at
 *   their edges, gentle shading with cool blue shadows, wobbly pencil lines and seams, and
 *   grainy cream paper under it all.
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
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

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

/** The colours the maps build with, and what each one is (see the maps in `@sar/shared`). */
const BY_COLOUR = new Map<number, Surface>([
  // The house.
  [0xece4d4, Surface.Wall],
  [0xbdb6a8, Surface.Concrete],
  [0x8d8a84, Surface.Concrete],
  [0x8c4b3a, Surface.Roof],
  [0x9a6b43, Surface.Wood],
  [0x6b4a2f, Surface.Wood],
  [0xd6b47c, Surface.Wood],
  [0x4f6d8f, Surface.Fabric],
  [0x5f7f6a, Surface.Fabric],
  [0x2b2d30, Surface.Metal],
  [0x8e979c, Surface.Metal],
  // The station.
  [0xa49c8c, Surface.Dirt],
  [0x9c5a44, Surface.Masonry],
  [0x4e4a46, Surface.Roof],
  [0xc9c1b1, Surface.Tiles],
  [0x8a6a45, Surface.Wood],
  [0x5c4a3c, Surface.Planks],
  [0x6e5a44, Surface.Wood],
  // The warehouse.
  [0x7f7b76, Surface.Concrete],
  [0x9aa3ad, Surface.Metal],
  [0x6e7378, Surface.Roof],
  [0xc9b8a0, Surface.Tiles],
  [0xa39a7e, Surface.Fabric],
  [0xb48f5a, Surface.Wood],
  [0xb9bec4, Surface.Metal],
  // The camp.
  [0x7d9b5a, Surface.Grass],
  [0xd8c79a, Surface.Dirt],
  [0xa08a5c, Surface.Dirt],
  [0x5b4027, Surface.Wood],
  [0x9a7b55, Surface.Wood],
  [0x7a5a3a, Surface.Wood],
  [0x7a7570, Surface.Concrete],
  [0xb98c5a, Surface.Wood],
  [0x6e4a2a, Surface.Roof],
  [0xc8c3bb, Surface.Wall],
  [0x6e6a66, Surface.Roof],
  [0xe8e2d4, Surface.Wall],
  [0xb9a27a, Surface.Tiles],
]);

const hsl = { h: 0, s: 0, l: 0 };

/** Whether a colour is the brown of wood. */
function woody(colour: THREE.Color): boolean {
  colour.getHSL(hsl, THREE.SRGBColorSpace);
  const hue = hsl.h * 360;
  return hue >= 12 && hue <= 45 && hsl.s >= 0.2 && hsl.s <= 0.7 && hsl.l >= 0.1 && hsl.l <= 0.6;
}

/** What a room's floor of this colour is: boards, tiles, concrete or carpet. */
export function floorSurface(colour: number): Surface {
  const known = BY_COLOUR.get(colour);
  if (known !== undefined) return known === Surface.Wood ? Surface.Planks : known;
  const c = new THREE.Color(colour);
  if (woody(c)) return Surface.Planks;
  c.getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.s < 0.1 && hsl.l < 0.62) return Surface.Concrete;
  if (hsl.l > 0.7) return Surface.Tiles;
  return Surface.Fabric;
}

/** What the ground outside is: the house's paved yard, or grass, sand or gravel. */
export function groundSurface(colour: number | undefined): Surface {
  if (colour === undefined) return Surface.Paving;
  const known = BY_COLOUR.get(colour);
  return known === Surface.Grass ? Surface.Grass : Surface.Dirt;
}

/**
 * What a material is made of: its tag if it has one, else a guess from its colour and finish.
 * Bricks, players and the like are tagged where they are made; most of the house is guessed.
 */
export function surfaceOf(material: THREE.Material): Surface {
  const tagged = material.userData[SURFACE] as Surface | undefined;
  if (tagged !== undefined) return tagged;
  if (!(material instanceof THREE.MeshStandardMaterial)) return Surface.None;
  if (material.map || material.transparent || material.opacity < 1) return Surface.None;
  if (material.metalness >= 0.4) return Surface.Metal;
  const known = BY_COLOUR.get(material.color.getHex());
  if (known !== undefined) return known;
  if (material.roughness >= 0.93) return Surface.Fabric;
  material.color.getHSL(hsl, THREE.SRGBColorSpace);
  if (material.roughness <= 0.5 && hsl.s > 0.3) return Surface.Plastic;
  if (woody(material.color)) return Surface.Wood;
  return Surface.Auto;
}

const SHARED = /* glsl */ `
varying vec3 vStyleWorld;
varying vec3 vStyleNormal;
#ifdef STYLE_SURFACE_ATTR
  varying float vStyleSurface;
#endif
`;

const VERTEX_HEAD = /* glsl */ `
${SHARED}
#ifdef STYLE_SURFACE_ATTR
  attribute float ${SURFACE_ATTRIBUTE};
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
}
`;

/**
 * The textures. Each surface gives back how much to brighten or darken it (`tint`), seams and
 * grain to ink in (`ink`), its bumps (`height`), a change to its roughness, and a value per tile,
 * board or slab (`cell`, or -1) that the cartoon style shades in two tones.
 */
const FRAGMENT_HEAD = /* glsl */ `
${SHARED}
uniform float styleSurface;

#if defined( STYLE_CARTOON )
  #define STYLE_MIN_LINE 0.012
#else
  #define STYLE_MIN_LINE 0.0
#endif

struct StyleDetail { float tint; float ink; float height; float rough; float cell; vec3 warm; };

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
  float w = max( width, STYLE_MIN_LINE ) / size * 0.5;
  float d = abs( f - floor( f + 0.5 ) );
  float aa = fwidth( f );
  return 1.0 - smoothstep( w - aa, w + aa, d );
}
/** Fades fine detail (\`f\`, repeating \`freq\` times a metre) out where it would shimmer. */
float sFine( float f, float freq ) {
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

StyleDetail styleDetail( float kind, vec3 p, vec3 n ) {
  StyleDetail d = StyleDetail( 1.0, 0.0, 0.0, 0.0, -1.0, vec3( 0.0 ) );
  int k = int( kind + 0.5 );
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

  if ( k == 1 || ( k == 8 && n.y < 0.3 ) ) {
    // Plaster: a soft mottle and a fine stipple.
    d.tint = 1.0 + ( sFbm( p * 1.3 ) - 0.5 ) * 0.14 + ( sNoise( p * 45.0 ) - 0.5 ) * 0.07 * sFine( p * 45.0 );
    d.height = sNoise( p * 70.0 ) * 0.6 + sNoise( p * 17.0 ) * 0.4;
    d.rough = 0.05;
  } else if ( k == 2 ) {
    // Wood: grain lines along x (along z on faces looking along x), with streaks between.
    float warp = sNoise( vec3( q.x * 0.8, q.y * 3.0, q.z * 3.0 ) );
    float rings = ( q.y + q.z * 0.7 + warp * 0.25 ) * 14.0;
    float grain = sLine( rings, 1.0 / 14.0, 0.012 ) * sFine( rings, 14.0 );
    float streak = sNoise( vec3( q.x * 1.2, q.y * 60.0, q.z * 60.0 ) ) * sFine( vec3( 0.0, q.y, q.z ) * 60.0 );
    d.tint = 0.88 + 0.2 * streak - 0.12 * grain;
    d.ink = sLine( ( q.y + q.z * 0.7 + warp * 0.3 ) * 4.0, 0.25, 0.008 ) * 0.7;
    d.height = streak * 0.4 - grain * 0.6;
  } else if ( k == 3 ) {
    // Floorboards running along z, 16 cm wide, their ends staggered.
    float bx = uv.x / 0.16;
    float id = floor( bx );
    float bz = ( uv.y + sHash( vec3( id, 7.0, 3.0 ) ) * 2.0 ) / 1.6;
    float jid = floor( bz );
    float cell = sHash( vec3( id, jid, 1.0 ) );
    float streak = sNoise( vec3( uv.x * 70.0, p.y, uv.y * 1.5 ) ) * sFine( uv.x * 70.0, 70.0 );
    d.ink = max( sLine( bx, 0.16, 0.004 ), sLine( bz, 1.6, 0.004 ) );
    d.tint = 0.84 + 0.24 * cell + 0.12 * ( streak - 0.5 ) - 0.25 * d.ink;
    d.height = streak * 0.3 - d.ink;
    d.rough = ( cell - 0.5 ) * 0.1 - 0.1;
    d.cell = cell;
  } else if ( k == 4 ) {
    // Tiles, 30 cm square, with darker grout.
    vec2 t = uv / 0.3;
    float cell = sHash( vec3( floor( t ), 5.0 ) );
    d.ink = max( sLine( t.x, 0.3, 0.008 ), sLine( t.y, 0.3, 0.008 ) );
    d.tint = 0.96 + 0.07 * cell + ( sNoise( p * 9.0 ) - 0.5 ) * 0.04 - 0.3 * d.ink;
    d.height = -d.ink;
    d.rough = mix( -0.4, 0.2, d.ink );
    d.cell = cell;
  } else if ( k == 5 ) {
    // Fabric: a fine weave and soft blotches.
    vec2 w = uv * 260.0;
    float fade = sFine( vec3( w, 0.0 ) );
    float weave = ( 0.5 + 0.5 * sin( w.x ) * sin( w.y ) ) * fade;
    d.tint = 1.0 + ( weave - 0.5 * fade ) * 0.16 + ( sFbm( p * 6.0 ) - 0.5 ) * 0.12;
    d.height = weave * 0.6;
    d.rough = 0.05;
  } else if ( k == 6 ) {
    // Sand and gravel: speckles and stones.
    float speck = sNoise( p * 90.0 ) * sFine( p * 90.0 );
    float stones = smoothstep( 0.6, 0.75, sNoise( p * 22.0 ) );
    float blotch = sFbm( p * 0.6 );
    d.tint = 0.86 + 0.25 * blotch + ( speck - 0.5 ) * 0.18 - stones * 0.12;
    d.ink = stones * step( 0.9, sNoise( p * 22.0 + 4.0 ) );
    d.height = stones + speck * 0.3;
    d.warm = vec3( 0.06, 0.02, -0.06 ) * ( blotch - 0.5 ) * 2.0;
  } else if ( k == 7 ) {
    // Grass: blades and patches, yellower where it is thin.
    float blades = sNoise( vec3( p.x * 110.0, p.y * 4.0, p.z * 110.0 ) ) * sFine( vec3( p.x, 0.0, p.z ) * 110.0 );
    float blotch = sFbm( p * 0.5 );
    d.tint = 0.78 + 0.35 * blotch + ( blades - 0.5 ) * 0.3;
    d.ink = smoothstep( 0.82, 0.86, sNoise( vec3( p.x * 9.0, 0.0, p.z * 9.0 ) ) );
    d.height = blades;
    d.warm = vec3( 0.12, 0.06, -0.1 ) * smoothstep( 0.5, 0.8, blotch );
    d.rough = 0.1;
  } else if ( k == 8 ) {
    // Shingles in staggered rows.
    float row = uv.y / 0.22;
    float col = uv.x / 0.32 + 0.5 * mod( floor( row ), 2.0 );
    float cell = sHash( vec3( floor( col ), floor( row ), 9.0 ) );
    d.ink = max( sLine( row, 0.22, 0.012 ), sLine( col, 0.32, 0.008 ) );
    d.tint = 0.82 + 0.3 * cell + ( sNoise( p * 30.0 ) - 0.5 ) * 0.1 - 0.3 * d.ink;
    d.height = fract( row ) * 0.6 - d.ink;
    d.cell = cell;
  } else if ( k == 9 ) {
    // Concrete: stains and pores.
    float pores = smoothstep( 0.78, 0.84, sNoise( p * 55.0 ) ) * sFine( p * 55.0 );
    d.tint = 1.0 + ( sFbm( p * 0.9 ) - 0.5 ) * 0.2 + ( sNoise( p * 25.0 ) - 0.5 ) * 0.08 - pores * 0.2;
    d.ink = pores * 0.5;
    d.height = sNoise( p * 25.0 ) * 0.3 - pores;
    d.rough = 0.05;
  } else if ( k == 10 ) {
    // Brushed metal.
    float brush = sNoise( vec3( q.x * 3.0, q.y * 300.0, q.z * 300.0 ) ) * sFine( vec3( 0.0, q.y, q.z ) * 300.0 );
    d.tint = 1.0 + ( brush - 0.5 ) * 0.12;
    d.rough = ( brush - 0.5 ) * 0.25;
  } else if ( k == 11 ) {
    // Moulded plastic: smooth and shiny, all but spotless.
    d.tint = 1.0 + ( sNoise( p * 8.0 ) - 0.5 ) * 0.03;
    d.rough = -0.12;
  } else if ( k == 12 ) {
    // Brickwork in stretcher bond, with mortar between.
    float rowB = p.y / 0.075;
    float u = an.x > an.z ? p.z : p.x;
    float colB = u / 0.225 + 0.5 * mod( floor( rowB ), 2.0 );
    float cell = sHash( vec3( floor( colB ), floor( rowB ), 2.0 ) );
    d.ink = an.y > 0.5 ? 0.0 : max( sLine( rowB, 0.075, 0.01 ), sLine( colB, 0.225, 0.01 ) );
    d.tint = 0.82 + 0.3 * cell + ( sNoise( p * 40.0 ) - 0.5 ) * 0.12;
    d.warm = vec3( 0.25 ) * d.ink;
    d.height = -d.ink;
    d.cell = cell;
  } else if ( k == 13 ) {
    // Paving slabs in a running bond, worn and stained.
    float rowP = uv.y / 0.6;
    float colP = uv.x / 0.9 + 0.5 * mod( floor( rowP ), 2.0 );
    float cell = sHash( vec3( floor( colP ), floor( rowP ), 4.0 ) );
    float speck = sNoise( p * 80.0 ) * sFine( p * 80.0 );
    d.ink = max( sLine( rowP, 0.6, 0.01 ), sLine( colP, 0.9, 0.01 ) );
    d.tint = 0.88 + 0.16 * cell + ( sFbm( p * 1.5 ) - 0.5 ) * 0.16 + ( speck - 0.5 ) * 0.1 - 0.3 * d.ink;
    d.height = speck * 0.3 - d.ink;
    d.rough = 0.05;
    d.cell = cell;
  } else if ( k == 0 ) {
    d.tint = 1.0 + ( sFbm( p * 1.5 ) - 0.5 ) * 0.06;
    d.height = sNoise( p * 50.0 ) * 0.2;
  }
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
vec3 styleBase = max( diffuseColor.rgb, vec3( 1e-3 ) );
#if defined( STYLE_CARTOON )
  {
    // Flat, brighter colours, tiles and boards in two tones, and inked seams.
    vec3 c = diffuseColor.rgb;
    float grey = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
    c = max( mix( vec3( grey ), c, 1.3 ), 0.0 );
    if ( styleD.cell >= 0.0 ) c *= 0.93 + 0.14 * step( 0.5, styleD.cell );
    // Seams inked by how much of the pixel they cover: cut off at half, a seam thinner than a
    // pixel broke up into dashes along its length.
    c *= 1.0 - 0.5 * smoothstep( 0.0, 0.5, styleD.ink );
    diffuseColor.rgb = c;
  }
#elif defined( STYLE_STORYBOOK )
  {
    // A watercolour wash: the texture half as strong, the colour a little paler (as if thinned
    // on cream paper), the pigment pooling in soft blotches, and pencilled seams.
    vec3 c = ( diffuseColor.rgb + styleD.warm * 0.6 * diffuseColor.rgb ) * mix( 1.0, styleD.tint, 0.5 );
    c = mix( c, vec3( 0.91, 0.85, 0.71 ), 0.15 );
    float pool = sFbm( vStyleWorld * 0.8 + 11.0 );
    float grain = ( sNoise( vStyleWorld * 14.0 ) - 0.5 ) * sFine( vStyleWorld * 14.0 );
    c *= 0.84 + 0.32 * pool + 0.1 * grain;
    diffuseColor.rgb = max( c * ( 1.0 - 0.3 * styleD.ink ), 0.0 );
  }
#else
  diffuseColor.rgb = max( ( diffuseColor.rgb + styleD.warm * diffuseColor.rgb ) * styleD.tint, 0.0 );
#endif
`;

/**
 * The rooms are filled with light through their emissive colour (see \`lightIndoors\`), which
 * would wash the texture out: it gets the texture too.
 */
const AFTER_EMISSIVE = /* glsl */ `
totalEmissiveRadiance *= diffuseColor.rgb / styleBase;
`;

const AFTER_ROUGHNESS = /* glsl */ `
#ifdef STYLE_REALISTIC
  roughnessFactor = clamp( roughnessFactor + styleD.rough, 0.04, 1.0 );
#endif
`;

/** Bumps, fading out with distance (where they would only sparkle). */
const AFTER_NORMAL = /* glsl */ `
#ifdef STYLE_REALISTIC
  {
    float near = 1.0 - smoothstep( 6.0, 18.0, length( vViewPosition ) );
    normal = stylePerturb( - vViewPosition, normal, styleD.height * 0.02 * near, faceDirection );
  }
#endif
`;

/**
 * Realistic: the sky and ground reflected, from the hemisphere light (three.js reflects
 * nothing without an environment map, so metal looked black and plastic dull).
 */
const AFTER_LIGHT_MAPS = /* glsl */ `
#if defined( STYLE_REALISTIC ) && NUM_HEMI_LIGHTS > 0
  {
    vec3 reflected = reflect( - geometryViewDir, normal );
    for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
      radiance += getHemisphereLightIrradiance( hemisphereLights[ i ], reflected ) * 0.35;
    }
  }
#endif
`;

/**
 * Cartoon: the light in hard bands (on a log scale, so it bands the same by day, at night and
 * under a lamp), and a crisp highlight. Storybook: the light evened out, as a painter would,
 * with the shadows washed in a cool blue and hardly any shine.
 */
const AFTER_LIGHTS = /* glsl */ `
#if defined( STYLE_CARTOON )
  {
    const float bandsPerDoubling = 1.4;
    vec3 albedo = max( material.diffuseColor, vec3( 0.02 ) );
    vec3 diffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
    vec3 lightLevel = diffuse / albedo;
    float lum = max( dot( lightLevel, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
    float f = log2( lum ) * bandsPerDoubling;
    float band = floor( f ) + smoothstep( 0.9, 1.0, fract( f ) );
    float banded = exp2( ( band + 0.55 ) / bandsPerDoubling );
    float scale = banded / lum;
    reflectedLight.directDiffuse *= scale;
    reflectedLight.indirectDiffuse *= scale;
    vec3 spec = reflectedLight.directSpecular;
    float s = dot( spec, vec3( 0.2126, 0.7152, 0.0722 ) );
    reflectedLight.directSpecular = spec / max( s, 1e-4 ) * smoothstep( 0.22, 0.26, s ) * 0.5;
    reflectedLight.indirectSpecular *= 0.3;
  }
#elif defined( STYLE_STORYBOOK )
  {
    vec3 albedo = max( material.diffuseColor, vec3( 0.02 ) );
    vec3 diffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
    float lum = max( dot( diffuse / albedo, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
    vec3 scale = pow( lum, 0.6 ) / lum * mix( vec3( 0.8, 0.86, 1.15 ), vec3( 1.0 ), smoothstep( 0.2, 0.9, lum ) );
    reflectedLight.directDiffuse *= scale;
    reflectedLight.indirectDiffuse *= scale;
    reflectedLight.directSpecular *= 0.15;
    reflectedLight.indirectSpecular *= 0.25;
  }
#endif
`;

const DEFINES: Record<VisualStyle, string | null> = {
  classic: null,
  realistic: 'STYLE_REALISTIC',
  cartoon: 'STYLE_CARTOON',
  storybook: 'STYLE_STORYBOOK',
};

/** Thrown away by `replace` without a word if three.js renamed a chunk, so it is checked. */
function insertAfter(source: string, chunk: string, code: string): string {
  const include = `#include <${chunk}>`;
  if (!source.includes(include)) throw new Error(`styles: three.js has no ${include} any more`);
  return source.replace(include, `${include}\n${code}`);
}

/**
 * Adds `style` to a material's shaders (from `onBeforeCompile`). The surface uniform goes on
 * every time, since three.js keeps the uniforms from a material's latest compile.
 */
export function patchStyle(
  shader: THREE.WebGLProgramParametersWithUniforms,
  material: THREE.Material,
  style: VisualStyle,
): void {
  const define = DEFINES[style];
  const lit = shader.fragmentShader.includes('#include <lights_fragment_end>');
  if (lit) shader.uniforms.styleSurface = { value: surfaceOf(material) };
  if (!define) return;
  // Unlit things (glows, screens, signs) keep their look; the screen pass does the rest.
  if (!lit) return;
  shader.defines = { ...shader.defines, [define]: '' };
  if (material.userData[SURFACE_PER_VERTEX]) {
    shader.defines.STYLE_SURFACE_ATTR = '';
  }
  shader.vertexShader = insertAfter(
    shader.vertexShader.replace('void main() {', `${VERTEX_HEAD}\nvoid main() {`),
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

/** Tone mapping for each style: filmic for the realistic one. */
export const TONE_MAPPING: Record<VisualStyle, { mapping: THREE.ToneMapping; exposure: number }> = {
  classic: { mapping: THREE.NoToneMapping, exposure: 1 },
  realistic: { mapping: THREE.NeutralToneMapping, exposure: 1.1 },
  cartoon: { mapping: THREE.NoToneMapping, exposure: 1 },
  storybook: { mapping: THREE.NoToneMapping, exposure: 1 },
};

/**
 * The cartoon and storybook styles' last step: the frame is drawn into a buffer, then copied to
 * the screen with lines wherever the depth jumps (outlines) or bends (creases), read from the
 * depth alone. Cartoon inks them; storybook pencils them in with a slight waver and gaps, darkens the
 * edges of each wash the way watercolour dries, and lays it all on grainy cream paper.
 */
export class ScreenPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;

  /**
   * `antialias`: draw the buffer multisampled. Not with ambient occlusion, which is laid over
   * the frame in a second pass: three.js throws a multisampled buffer's samples away once it
   * resolves them, so the second pass would draw over nothing.
   */
  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    readonly style: 'cartoon' | 'storybook',
    readonly antialias: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const depth = new THREE.DepthTexture(size.x, size.y, THREE.UnsignedInt248Type);
    depth.format = THREE.DepthStencilFormat;
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: antialias ? 4 : 0,
      stencilBuffer: true,
      depthTexture: depth,
    });
    this.material = new THREE.ShaderMaterial({
      defines: style === 'storybook' ? { STORYBOOK: '' } : {},
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: depth },
        texel: { value: new THREE.Vector2(1 / size.x, 1 / size.y) },
        thickness: { value: 1 },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position.xy, 0.0, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 texel;
        uniform float thickness;
        uniform float cameraNear;
        uniform float cameraFar;
        varying vec2 vUv;
        float viewZ( vec2 uv ) {
          return - perspectiveDepthToViewZ( texture2D( tDepth, uv ).r, cameraNear, cameraFar );
        }
        float hash( vec2 p ) {
          vec3 q = fract( vec3( p.xyx ) * 0.1031 );
          q += dot( q, q.yzx + 33.33 );
          return fract( ( q.x + q.y ) * q.z );
        }
        float noise( vec2 p ) {
          vec2 i = floor( p );
          vec2 f = fract( p );
          f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ),
                      mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
        }
        /** Outlines and creases at \`uv\`, 0 to 1, \`o\` apart. */
        float edges( vec2 uv, vec2 o ) {
          float z = viewZ( uv );
          float zl = viewZ( uv - vec2( o.x, 0.0 ) );
          float zr = viewZ( uv + vec2( o.x, 0.0 ) );
          float zd = viewZ( uv - vec2( 0.0, o.y ) );
          float zu = viewZ( uv + vec2( 0.0, o.y ) );
          // Outlines: on the far side of a jump in depth, so they ring what is in front.
          float nearest = min( min( zl, zr ), min( zd, zu ) );
          float outline = smoothstep( 0.02, 0.05, ( z - nearest ) / z );
          // Creases: where 1/depth (straight across any flat surface) bends, against how steeply
          // it runs, so a floor or ceiling seen edge-on (where the depth is coarse) stays clean.
          float w = 1.0 / z;
          float bendX = abs( 1.0 / zl + 1.0 / zr - 2.0 * w ) / ( abs( 1.0 / zr - 1.0 / zl ) + 0.002 * w );
          float bendY = abs( 1.0 / zd + 1.0 / zu - 2.0 * w ) / ( abs( 1.0 / zu - 1.0 / zd ) + 0.002 * w );
          float crease = smoothstep( 0.3, 0.6, max( bendX, bendY ) ) * ( 1.0 - smoothstep( 10.0, 25.0, z ) );
          float ink = max( outline, crease ) * ( 1.0 - smoothstep( 25.0, 50.0, z ) );
          // Not along the screen's own edges, where the neighbours fall off it.
          vec2 inside = step( o, uv ) * step( uv, 1.0 - o );
          return ink * inside.x * inside.y;
        }
        void main() {
          vec2 o = texel * thickness;
          #ifdef STORYBOOK
            // Screen pixels, in steps of the line weight, so the paper looks the same at any size.
            vec2 px = vUv / o;
            // A slight hand-drawn waver: the lines are read from a little to one side or the other.
            vec2 wobble = vec2( noise( px * 0.03 ), noise( px * 0.03 + 17.0 ) ) - 0.5;
            vec2 uv = vUv + wobble * o * 1.2;
            vec4 colour = texture2D( tColor, vUv );
            // The pencil: lighter in places, and broken here and there.
            float pencil = edges( uv, o ) * ( 0.5 + 0.35 * noise( px * 0.6 ) )
              * smoothstep( 0.2, 0.45, noise( px * 0.05 + 40.0 ) );
            // Watercolour dries darker at a wash's edge: darken where the colour changes.
            vec2 r = o * 2.5;
            vec3 around = ( texture2D( tColor, vUv + vec2( r.x, 0.0 ) ).rgb + texture2D( tColor, vUv - vec2( r.x, 0.0 ) ).rgb
              + texture2D( tColor, vUv + vec2( 0.0, r.y ) ).rgb + texture2D( tColor, vUv - vec2( 0.0, r.y ) ).rgb ) * 0.25;
            vec3 c = min( colour.rgb, vec3( 4.0 ) );
            float rim = min( dot( abs( min( around, vec3( 4.0 ) ) - c ), vec3( 1.0 ) ) / ( dot( c, vec3( 1.0 ) ) + 0.3 ), 1.0 );
            c *= 1.0 - 0.3 * rim;
            // The sky left mostly as bare paper.
            if ( texture2D( tDepth, vUv ).r >= 1.0 ) c = mix( c, vec3( 0.9, 0.86, 0.76 ), 0.45 );
            gl_FragColor = vec4( c, 1.0 );
          #else
            vec4 colour = texture2D( tColor, vUv );
            float ink = edges( vUv, o );
            // Punchier colours, the sky's too.
            float grey = dot( colour.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            vec3 bright = max( mix( vec3( grey ), colour.rgb, 1.2 ), 0.0 );
            // The ink is a deep shade of what it is drawn over, as if inked by hand in that colour.
            gl_FragColor = vec4( mix( bright, bright * 0.12, ink ), 1.0 );
          #endif
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #ifdef STORYBOOK
            // Soft, warm highlights, as the paper is the whitest a painting gets.
            vec3 s = gl_FragColor.rgb;
            s = s / ( 1.0 + 0.2 * s ) * vec3( 1.2, 1.18, 1.1 );
            // Cross-hatching in the darkest shadows.
            float dark = 1.0 - smoothstep( 0.12, 0.32, dot( s, vec3( 0.2126, 0.7152, 0.0722 ) ) );
            float h1 = abs( fract( ( px.x + px.y ) / 4.0 ) - 0.5 );
            float h2 = abs( fract( ( px.x - px.y ) / 4.0 ) - 0.5 );
            float hatch = max( 1.0 - smoothstep( 0.05, 0.15, h1 ), ( 1.0 - smoothstep( 0.05, 0.15, h2 ) ) * step( 0.6, dark ) );
            s *= 1.0 - 0.25 * hatch * dark * smoothstep( 0.3, 0.6, noise( px * 0.04 + 5.0 ) );
            // Graphite.
            s = mix( s, vec3( 0.25, 0.23, 0.22 ), pencil );
            // The paper's tooth and mottling, and a little darker towards the corners.
            float tooth = noise( px * 0.9 ) * 0.6 + noise( px * 0.23 ) * 0.4;
            s *= 0.93 + 0.07 * tooth + 0.04 * noise( px * 0.015 + 9.0 );
            vec2 v = vUv - 0.5;
            s *= 1.0 - 0.25 * dot( v, v );
            gl_FragColor.rgb = clamp( s, 0.0, 1.0 );
          #endif
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.texel!.value.set(1 / width, 1 / height);
    // Two pixels at 1080 lines, so the lines keep their weight at any resolution.
    this.material.uniforms.thickness!.value = Math.max(1.5, height / 540);
  }

  /** Copies the frame drawn into `target` to the screen. */
  render(renderer: THREE.WebGLRenderer): void {
    this.material.uniforms.cameraNear!.value = this.camera.near;
    this.material.uniforms.cameraFar!.value = this.camera.far;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}
