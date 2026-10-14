import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { VisualStyle } from '../graphics-settings.ts';
import { STUD, floorRect } from '@sar/shared';
import type { FloorRect, LevelDef, SurfaceName } from '@sar/shared';
import { THEMES, currentTheme, onThemeChange } from '../themes.ts';

/**
 * The game's visual styles. Classic is the original flat-coloured look and adds nothing. The
 * others redraw every lit surface with its own texture, worked out in the shader from where the
 * surface is in the world (no image files, nothing to load, and the same on every machine):
 *
 * - Painted: the realistic style's lighting, painted over in a chunky, hand-painted cartoon
 *   look: saturated colours, broad boards with dark grooves and light worn edges, cells with
 *   lit rims, stroke-shaped grass tufts, and turquoise water with foam along its shores. The
 *   Bricks theme draws the world this way.
 * - Realistic: wood grain, plank floors, tiled kitchens, plaster, paving, shingles, woven
 *   fabric and brushed metal, with fine bumps catching the light, shinier plastic bricks,
 *   reflections of the sky and gentle tone mapping.
 * - Cartoon: flat, punchy colours lit in a few hard bands, ink outlines round everything and
 *   along its creases, and inked seams and grain.
 * - Storybook: a watercolour picture book. Soft, pale washes that pool unevenly and darken at
 *   their edges, gentle shading with cool blue shadows, wobbly pencil lines and seams, and
 *   grainy cream paper under it all.
 * - Theme: drawn like the interface theme picked in Settings (see `themes.ts`), on the cartoon
 *   style's flat bands and outlines; the screen pass gives each theme its own finish.
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
  /**
   * A brick: moulded plastic like \`Plastic\`, and in the theme style kept in its own colour (see
   * \`MARK_BRICKS\`), so every player can tell the bricks apart whichever theme they play in.
   */
  Brick: 15,
  /** Open water: ripples moving over it, and the sky mirrored in it at a slant. */
  Water: 16,
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

/** How many rectangles of water the painted water's shores are worked out from (see `SHORES`). */
const MAX_SHORES = 4;

const SHARED = /* glsl */ `
varying vec3 vStyleWorld;
varying vec3 vStyleNormal;
#ifdef STYLE_SURFACE_ATTR
  varying float vStyleSurface;
#endif
#if defined( STYLE_PAINTED ) && defined( STYLE_WATER )
  /** The water's rectangles, as x0, z0, x1, z1, with the sides that are not shores far away. */
  uniform vec4 styleShores[ ${MAX_SHORES} ];
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
 * The painted water's shores slope down to meet the ground just past them: level all the way to
 * its edge, it hung clear of the lake's bed there, which showed under it as a dark line along
 * the shore wherever it was seen at a slant. Its sheet's points on a shore go down to the ground
 * and a few centimetres out over it, under the shore's own floor (see `waterSheet` in scene.ts,
 * which has a line of points a little way in from every side for the slope to start at).
 */
const WATER_VERTEX = /* glsl */ `
#if defined( STYLE_PAINTED ) && defined( STYLE_WATER )
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
 * The painted style's textures, in place of the realistic style's (see `styleDetail`), after
 * hand-painted game art: every board, tile, slab, brick and shingle its own shade, some warmer
 * and some cooler, its edges picked out with a lighter rim inside a dark groove; long strokes of
 * paint along wood's grain; big soft mottling on plaster and fabric; tufts in the grass and
 * pebbles in the sand; and water in turquoise shallows and blue depths with foam along its
 * shores. The detail is broad and soft rather than fine, so it reads from afar without
 * shimmering, and each surface costs about as many noise lookups as its realistic texture.
 */
const PAINTED_DETAIL = /* glsl */ `
#ifdef STYLE_PAINTED
/**
 * The edge of a board, tile or slab \`e\` metres in from its side: .x a dark groove \`groove\`
 * wide, .y a lighter rim \`rim\` wide inside it, fading softly into the middle. The rim goes once
 * it is thinner than a pixel or so, where it would only shimmer, and the groove fades to as much
 * as it covers of the pixel.
 */
vec2 paintedBevel( float e, float groove, float rim ) {
  float aa = max( fwidth( e ), 1e-5 );
  float inside = smoothstep( groove - aa, groove + aa, e );
  float g = ( 1.0 - inside ) * min( 1.0, groove * 2.0 / aa );
  float r = inside * ( 1.0 - smoothstep( groove + rim * 0.3, groove + rim + aa, e ) );
  return vec2( g, r * ( 1.0 - smoothstep( 0.4, 1.0, aa / rim ) ) );
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
  float stroke = mix( 0.5, smoothstep( 0.3, 0.7, s ), sFine( across * 30.0, 30.0 ) );
  float grain = sLine( ( f.x + s * 0.12 ) * 2.0 + cell, width * 0.5, 0.003 ) * sFine( bx * 2.0, 2.0 / width );
  // A knot: a dark heart in a lighter ring, on about one board in four.
  vec2 k = ( f - vec2( 0.3 + 0.4 * tone, 0.2 + 0.6 * fract( cell * 13.7 ) ) ) * vec2( width, len );
  float kr = length( k / vec2( 0.018, 0.04 ) );
  float knot = step( 0.75, fract( cell * 7.9 ) ) * sFine( kr * 0.5, 1.0 / 0.018 );
  float heart = knot * ( 1.0 - smoothstep( 0.6, 1.0, kr ) );
  float ring = knot * smoothstep( 0.9, 1.3, kr ) * ( 1.0 - smoothstep( 1.4, 2.4, kr ) );
  vec2 bevel = paintedBevel( e, 0.004, 0.02 );
  d.tint = 0.66 + 0.3 * cell + 0.24 * ( stroke - 0.5 ) + 0.22 * bevel.y + 0.12 * ring;
  d.ink = max( bevel.x, max( grain * 0.45, heart * 0.7 ) );
  d.warm = vec3( 0.07, 0.02, -0.05 ) * ( tone - 0.5 ) * 2.0;
  d.height = stroke * 0.4 + smoothstep( 0.0, 0.015, e ) - heart * 0.5;
  d.rough = ( cell - 0.5 ) * 0.1 - 0.05;
  d.cell = cell;
}

/** How rich the painted colours are, for each surface. */
float paintedSaturation( int k ) {
  // Wood kept a deep brown: richer, it went orange.
  if ( k == 2 || k == 3 ) return 1.0;
  // Plaster, sand and concrete only a little, so walls and floors stay calm behind the bright
  // bricks and players.
  if ( k == 1 || k == 6 || k == 9 ) return 1.12;
  if ( k == 7 ) return 1.15;
  return PAINTED_SATURATION;
}

/** How much the edges a surface curves round sharply are picked out (see \`AFTER_COLOUR\`). */
float paintedEdge( int k ) {
  if ( k == 10 ) return 1.0;
  if ( k == 2 ) return 0.7;
  // Bricks and players clean, in their own colours; water, grass and the ground have none.
  if ( k == 11 || k == 15 || k == 16 || k == 7 || k == 6 ) return 0.0;
  return 0.4;
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
    d.cell = cell;
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
    // Sand and earth: warm, in soft drifts, dotted with grit and scattered with painted
    // pebbles, each its own colour, lit on its top and with a dark rim round its foot.
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
  } else if ( k == 7 ) {
    // Grass, painted: broad patches of yellow-green and blue-green, darker clumps, and tufts in
    // short strokes, lighter toward their tips with a dark shadow at their foot, which fade to
    // the calm patches in the distance.
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
    d.cell = cell;
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
    d.cell = cell;
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
    d.cell = cell;
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
    d.cell = cell;
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
    // How far in from the nearest shore: the edge of the water's rectangles (see \`SHORES\`).
    float shore = -1e4;
    for ( int i = 0; i < ${MAX_SHORES}; i ++ ) {
      vec4 r = styleShores[ i ];
      shore = max( shore, min( min( p.x - r.x, r.z - p.x ), min( p.z - r.y, r.w - p.z ) ) );
    }
    shore = shore < -100.0 ? 1e3 : max( shore, 0.0 );
    // The shoreline wavers with the ripples.
    float s = shore + ( ra - 0.5 ) * 0.3 + ( rb - 0.5 ) * 0.15;
    float aa = fwidth( s );
    // A band of foam at the shore, swelling and ebbing as the waves lap, its edge broken up.
    float lap = 0.22 + 0.1 * sin( t * 1.1 + ( p.x + p.z ) * 0.4 );
    float band = 1.0 - smoothstep( lap - aa, lap + aa + 0.03, s + ( rf - 0.5 ) * 0.1 * fine );
    // Lines of foam rolling in toward it, broken, fading as they go further out.
    float roll = fract( s / 0.9 + t * 0.22 );
    float line = smoothstep( 0.8, 0.86, roll ) * ( 1.0 - smoothstep( 0.9, 0.97, roll ) )
      * smoothstep( 0.42, 0.58, rb ) * ( 1.0 - smoothstep( 0.6, 2.2, s ) )
      * ( 1.0 - smoothstep( 0.04, 0.1, aa ) );
    float foam = max( band, line * 0.8 );
    float depth = smoothstep( 0.3, 4.5, s + ( deep - 0.5 ) * 1.8 );
    vec3 water = mix( vec3( 0.1, 0.55, 0.52 ), vec3( 0.012, 0.13, 0.33 ), depth );
    // Lighter on the ripples' crests, as painted, with glints on the sharpest.
    water *= 0.88 + 0.3 * smoothstep( 0.5, 0.85, ( ra + rb ) * 0.5 );
    paintedSparkle = smoothstep( 0.84, 0.9, rf ) * smoothstep( 0.55, 0.7, ( ra + rb ) * 0.5 ) * fine * ( 1.0 - foam );
    paintedWater = vec4( mix( water, vec3( 0.92, 0.98, 1.0 ), max( foam, paintedSparkle ) ), max( mix( 0.86, 0.96, depth ), foam ) );
    d.height = ( ra + rb + 0.5 * rf * fine ) * 2.5 * ( 1.0 - foam ) + swell * 0.6;
    d.rough = -0.4 + foam * 0.7;
  #endif
  } else if ( k == 0 ) {
    d.tint = 1.0 + ( sFbm( p * 1.5 ) - 0.5 ) * 0.08;
    d.height = sNoise( p * 50.0 ) * 0.2;
  }
}
#endif
`;

/**
 * The textures. Each surface gives back how much to brighten or darken it (`tint`), seams and
 * grain to ink in (`ink`), its bumps (`height`), a change to its roughness, and a value per tile,
 * board or slab (`cell`, or -1) that the cartoon style shades in two tones.
 */
const FRAGMENT_HEAD = /* glsl */ `
${SHARED}
uniform float styleSurface;
uniform float styleTime;
#if defined( STYLE_PAINTED ) && defined( STYLE_WATER )
  /** The painted water's colour and opacity, and its glints, from \`paintedDetail\`. */
  vec4 paintedWater;
  float paintedSparkle;
#endif

#define PAINTED_SATURATION 1.3

#if defined( STYLE_PIXEL )
  // Seams a texel wide, so they still show at the texel's middle.
  #define STYLE_MIN_LINE STYLE_TEXEL
#elif defined( STYLE_CARTOON )
  #define STYLE_MIN_LINE 0.012
#else
  #define STYLE_MIN_LINE 0.0
#endif

#ifdef STYLE_PIXEL
  /** How big a screen pixel is, in metres, where this surface is (see \`PIXELATE\`). */
  float stylePixelSize;
  /** Fades detail finer than a texel out, and all of it once texels get smaller than pixels. */
  float sTexelFine( float freq ) {
    return ( 1.0 - smoothstep( 0.35, 0.9, freq * STYLE_TEXEL ) )
      * ( 1.0 - smoothstep( 0.5, 1.0, stylePixelSize / STYLE_TEXEL ) );
  }
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
  #ifdef STYLE_PIXEL
    // Read at each texel's middle: on or off, a texel at a time.
    float aa = 0.0;
  #else
    float aa = fwidth( f );
  #endif
  return 1.0 - smoothstep( w - aa, w + aa, d );
}
/** Fades fine detail (\`f\`, repeating \`freq\` times a metre) out where it would shimmer. */
float sFine( float f, float freq ) {
  #ifdef STYLE_PIXEL
    return sTexelFine( freq );
  #else
    return 1.0 - smoothstep( 0.35, 0.9, fwidth( f ) );
  #endif
}
/**
 * The same for detail that varies along several axes (\`f\`: the position scaled to the detail's
 * cells): it fades as soon as it gets too fine along any of them. Judged along one axis alone,
 * a floor seen along the other (into the distance) kept its fine weave or speckle, which broke
 * up into moiré.
 */
float sFine( vec3 f ) {
  #ifdef STYLE_PIXEL
    // Speckle finer than a texel is read once per texel, as pixel art's own noise.
    return sTexelFine( 0.0 );
  #else
    vec3 w = fwidth( f );
    return 1.0 - smoothstep( 0.35, 0.9, max( max( w.x, w.y ), w.z ) );
  #endif
}
${PAINTED_DETAIL}

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

  #ifdef STYLE_PAINTED
    paintedDetail( d, k, p, n, an, uv, q );
  #else
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
    // Sand and gravel: a fine grain, soft drifts, and pebbles scattered on it, each its own
    // shade with a lit top and a shadowed foot.
    float speck = sNoise( p * 90.0 ) * sFine( p * 90.0 );
    float blotch = sFbm( p * 0.6 );
    vec2 pc = p.xz * 9.0;
    vec2 pid = floor( pc );
    float ph = sHash( vec3( pid, 6.0 ) );
    // One hash a cell, spread into where the pebble lies, its size and its shade.
    vec2 centre = pid + 0.25 + 0.5 * fract( ph * vec2( 7.13, 31.7 ) );
    float size = 0.12 + 0.18 * fract( ph * 53.1 );
    float pd = length( ( pc - centre ) * vec2( 1.0, 1.3 ) ) / size;
    float pebble = ( 1.0 - smoothstep( 0.75, 1.0, pd ) ) * step( 0.45, ph ) * sFine( vec3( pc.x, 0.0, pc.y ) * 0.25 );
    float lit = dot( pc - centre, vec2( 0.6, 0.6 ) ) / size;
    d.tint = 0.9 + 0.16 * blotch + ( speck - 0.5 ) * 0.16
      + pebble * ( ( fract( ph * 97.3 ) - 0.5 ) * 0.5 - 0.08 * lit );
    d.ink = pebble * smoothstep( 0.6, 1.0, pd ) * 0.6;
    d.height = pebble * ( 1.0 - pd * pd ) * 2.0 + speck * 0.3;
    d.warm = vec3( 0.05, 0.02, -0.05 ) * ( blotch - 0.5 ) * 2.0;
    d.rough = pebble * -0.1;
  } else if ( k == 7 ) {
    // Grass: blades and patches, yellower where it is thin, and darker tufts.
    float blades = sNoise( vec3( p.x * 110.0, p.y * 4.0, p.z * 110.0 ) ) * sFine( vec3( p.x, 0.0, p.z ) * 110.0 );
    float blotch = sFbm( p * 0.5 );
    // Tufts round the dark specks, from the same noise.
    float tuft = sNoise( vec3( p.x * 9.0, 0.0, p.z * 9.0 ) );
    float clumps = smoothstep( 0.55, 0.8, tuft );
    d.tint = 0.8 + 0.32 * blotch + ( blades - 0.5 ) * 0.3 - clumps * 0.14;
    d.ink = smoothstep( 0.82, 0.86, tuft );
    d.height = blades + clumps;
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
  } else if ( k == 11 || k == 15 ) {
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
  #ifdef STYLE_WATER
  } else if ( k == 16 ) {
    // Water: two sets of ripples running different ways, over slow swells, and darker
    // patches where it is deeper.
    float t = styleTime;
    vec2 a = p.xz * 3.1 + vec2( t * 0.35, t * 0.12 );
    vec2 b = p.xz * vec2( 4.3, 3.7 ) - vec2( t * 0.18, -t * 0.29 );
    float ripples = sNoise( vec3( a, t * 0.2 ) ) + sNoise( vec3( b, 3.0 + t * 0.25 ) )
      + 0.5 * sNoise( vec3( p.xz * 11.0 + vec2( t * 0.6, 0.0 ), t * 0.5 ) ) * sFine( p * 11.0 );
    float swell = sin( p.x * 0.9 + p.z * 0.4 + t * 0.8 ) + sin( p.z * 1.3 - p.x * 0.3 + t * 0.6 );
    float deep = sFbm( vec3( p.xz * 0.25, 1.0 ) );
    d.tint = 0.8 + 0.3 * deep + ( ripples - 1.25 ) * 0.08;
    d.height = ripples * 2.5 + swell * 0.6;
    d.rough = -0.4;
    d.warm = vec3( -0.06, 0.02, 0.06 ) * ( 1.0 - deep );
  #endif
  } else if ( k == 0 ) {
    d.tint = 1.0 + ( sFbm( p * 1.5 ) - 0.5 ) * 0.06;
    d.height = sNoise( p * 50.0 ) * 0.2;
  }
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

/**
 * Arcade: every surface drawn in texels a quarter of a stud across, on a grid fixed to the
 * world, as if the objects were made of pixel art (instead of the frame being blown up into big
 * pixels). Each fragment is coloured, textured, lit and shadowed as at the middle of its texel:
 * \`styleAB\` is how many screen pixels across and down that middle is, along the surface, so
 * anything that changes smoothly over it (texture coordinates, normals, shadow lookups) is read
 * there by stepping that far along its screen derivatives (\`STYLE_AT\`).
 */
const PIXELATE = /* glsl */ `
#ifdef STYLE_PIXEL
  vec2 styleAB = vec2( 0.0 );
  vec3 styleTexel = vStyleWorld;
  {
    vec3 p = vStyleWorld;
    vec3 an = abs( normalize( vStyleNormal ) );
    vec3 s = ( floor( p / STYLE_TEXEL ) + 0.5 ) * STYLE_TEXEL;
    // Snapped across the face only: along its normal it stays where it is.
    vec3 q = an.y >= an.x && an.y >= an.z ? vec3( s.x, p.y, s.z )
      : an.x >= an.z ? vec3( p.x, s.y, s.z ) : vec3( s.x, s.y, p.z );
    vec3 dx = dFdx( p );
    vec3 dy = dFdy( p );
    stylePixelSize = max( length( dx ), length( dy ) );
    float xx = dot( dx, dx );
    float xy = dot( dx, dy );
    float yy = dot( dy, dy );
    float det = xx * yy - xy * xy;
    vec3 d = q - p;
    vec2 r = vec2( dot( d, dx ), dot( d, dy ) );
    if ( det > 1e-24 ) styleAB = vec2( yy * r.x - xy * r.y, xx * r.y - xy * r.x ) / det;
    styleTexel = p + styleAB.x * dx + styleAB.y * dy;
  }
  #define STYLE_AT( v ) ( ( v ) + styleAB.x * dFdx( v ) + styleAB.y * dFdy( v ) )
#endif
`;

/** Arcade: the lights, their shadows and the view read at the texel's middle (see \`PIXELATE\`). */
const PIXEL_LIGHTS = /* glsl */ `
#ifdef STYLE_PIXEL
  normal = normalize( STYLE_AT( normal ) );
  vec3 styleViewPos = ( viewMatrix * vec4( styleTexel, 1.0 ) ).xyz;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vec4 styleDirShadow[ NUM_DIR_LIGHT_SHADOWS ];
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      styleDirShadow[ i ] = STYLE_AT( vDirectionalShadowCoord[ i ] );
    }
    #pragma unroll_loop_end
  #endif
  #if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
    vec4 stylePointShadow[ NUM_POINT_LIGHT_SHADOWS ];
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
      stylePointShadow[ i ] = STYLE_AT( vPointShadowCoord[ i ] );
    }
    #pragma unroll_loop_end
  #endif
  #if NUM_SPOT_LIGHT_COORDS > 0
    vec4 styleSpotCoord[ NUM_SPOT_LIGHT_COORDS ];
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
      styleSpotCoord[ i ] = STYLE_AT( vSpotLightCoord[ i ] );
    }
    #pragma unroll_loop_end
  #endif
#endif
`;

/** In the light loop, what `PIXEL_LIGHTS` reads at the texel's middle stands in for its own. */
const PIXEL_LOOP: [string, string][] = [
  [
    'vec3 geometryPosition = - vViewPosition;',
    '#ifdef STYLE_PIXEL\n  vec3 geometryPosition = styleViewPos;\n#else\n  vec3 geometryPosition = - vViewPosition;\n#endif',
  ],
  [
    'vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );',
    '#ifdef STYLE_PIXEL\n  vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( - styleViewPos );\n#else\n  vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );\n#endif',
  ],
  ['vDirectionalShadowCoord[ i ]', 'styleDirShadow[ i ]'],
  ['vPointShadowCoord[ i ]', 'stylePointShadow[ i ]'],
  ['vSpotLightCoord[ i ]', 'styleSpotCoord[ i ]'],
];

/** After the material's colour: the texture goes on (and the roughness, below). */
const AFTER_COLOUR = /* glsl */ `
#ifdef STYLE_SURFACE_ATTR
  float styleKind = vStyleSurface;
#else
  float styleKind = styleSurface;
#endif
#ifdef STYLE_PIXEL
  StyleDetail styleD = styleDetail( styleKind, styleTexel, normalize( vStyleNormal ) );
#else
  StyleDetail styleD = styleDetail( styleKind, vStyleWorld, normalize( vStyleNormal ) );
#endif
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
#ifdef STYLE_PAINTED
  {
    // Painted: richer colours, seams painted in as dark grooves, and faces turned up a little
    // lighter, as painted with the light from above. Where a surface curves sharply round an
    // edge (a bevel, a rail, a rim), it is picked out lighter, as worn paint and polish catch
    // the light in hand-painted art: the curve is how fast the normal turns per metre.
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
#endif
#ifdef STYLE_PIXEL
  // Each texel a shade lighter or darker, as hand-placed pixels are (gone where texels get
  // smaller than the screen's own pixels, which would only shimmer).
  diffuseColor.rgb *= 1.0 + ( sHash( floor( styleTexel / STYLE_TEXEL ) + 0.37 ) - 0.5 ) * 0.08 * sTexelFine( 0.0 );
#endif
`;

/**
 * The rooms are filled with light through their emissive colour (see \`lightIndoors\`), which
 * would wash the texture out: it gets the texture too.
 */
const AFTER_EMISSIVE = /* glsl */ `
totalEmissiveRadiance *= diffuseColor.rgb / styleBase;
#if defined( STYLE_PAINTED ) && defined( STYLE_WATER ) && NUM_DIR_LIGHTS > 0
  // The painted water's glints shine with the sun (or the moon), and bloom.
  totalEmissiveRadiance += paintedSparkle * directionalLights[ 0 ].color * 0.4;
#endif
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
    // Fine bumps fade out with distance; water's ripples reach further.
    #ifdef STYLE_WATER
      float reach = 3.0;
    #else
      float reach = 1.0;
    #endif
    float near = 1.0 - smoothstep( 6.0 * reach, 18.0 * reach, length( vViewPosition ) );
    normal = stylePerturb( - vViewPosition, normal, styleD.height * 0.02 * near, faceDirection );
  }
#endif
`;

/**
 * Realistic: the sky and ground reflected, from the hemisphere light and the sky's own light
 * probe (see \`Sky.bakeLight\`); three.js reflects nothing without an environment map, so metal
 * looked black and plastic dull. Not where there is one (the metallic bricks'), which reflects
 * better.
 */
const AFTER_LIGHT_MAPS = /* glsl */ `
#ifdef STYLE_REALISTIC
  // Water is clearer to see into from above, and mirrors the sky the more, the flatter it is
  // looked across.
  #ifdef STYLE_WATER
    float styleFresnel = pow( 1.0 - clamp( dot( normal, geometryViewDir ), 0.0, 1.0 ), 4.0 );
    #ifdef STYLE_PAINTED
      // Painted water has its own opacity (see \`paintedDetail\`).
      diffuseColor.a = mix( diffuseColor.a, 1.0, styleFresnel );
    #else
      diffuseColor.a = mix( diffuseColor.a * 0.85, 1.0, styleFresnel );
    #endif
  #endif
  #if ( NUM_HEMI_LIGHTS > 0 || defined( USE_LIGHT_PROBES ) ) && ! defined( USE_ENVMAP )
  {
    vec3 reflected = reflect( - geometryViewDir, normal );
    #ifdef STYLE_WATER
      float mirror = 0.12 + 0.75 * styleFresnel;
    #else
      float mirror = 0.35;
    #endif
    #if NUM_HEMI_LIGHTS > 0
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
        radiance += getHemisphereLightIrradiance( hemisphereLights[ i ], reflected ) * mirror;
      }
    #endif
    #ifdef USE_LIGHT_PROBES
      radiance += getLightProbeIrradiance( lightProbe, reflected ) * mirror;
    #endif
  }
  #endif
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
    // Metal keeps its reflection (all the colour it has), in bands like the rest.
    vec3 mirror = reflectedLight.indirectSpecular;
    float shiny = dot( mirror, vec3( 0.2126, 0.7152, 0.0722 ) );
    float mBand = exp2( floor( log2( max( shiny, 1e-4 ) ) * 2.0 + 0.5 ) / 2.0 );
    reflectedLight.indirectSpecular = mix( mirror * 0.3, mirror / max( shiny, 1e-4 ) * mBand, step( 0.5, metalnessFactor ) );
  }
#elif defined( STYLE_PAINTED )
  {
    // The shade a little richer in colour, as painted, and a soft light from the sky round the
    // edges of things turned away from the view.
    vec3 shade = reflectedLight.indirectDiffuse;
    float l = dot( shade, vec3( 0.2126, 0.7152, 0.0722 ) );
    reflectedLight.indirectDiffuse = max( mix( vec3( l ), shade, 1.25 ), 0.0 );
    float rim = pow( 1.0 - clamp( dot( normal, geometryViewDir ), 0.0, 1.0 ), 3.0 );
    reflectedLight.indirectDiffuse += shade * rim * 0.6;
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
    reflectedLight.indirectSpecular *= mix( 0.25, 0.85, step( 0.5, metalnessFactor ) );
  }
#endif
`;

/**
 * The theme style marks bricks in the frame's alpha (0.5 instead of 1), so its screen pass can
 * keep them in their own colour (see \`themed\` below). See-through bricks lower the alpha under
 * them in the same way, through their blending (see \`setThemeGlass\` in bricks.ts).
 */
const MARK_BRICKS = /* glsl */ `
#ifdef STYLE_THEME
  if ( int( styleKind + 0.5 ) == ${Surface.Brick} ) gl_FragColor.a = 0.5;
#endif
`;

const DEFINES: Record<VisualStyle, string | null> = {
  theme: 'STYLE_CARTOON',
  classic: null,
  painted: 'STYLE_PAINTED',
  realistic: 'STYLE_REALISTIC',
  cartoon: 'STYLE_CARTOON',
  storybook: 'STYLE_STORYBOOK',
};

/**
 * The style the world is drawn in: in the theme style, the interface theme's, except that Bricks
 * (the game's own look) draws the world painted.
 */
export function worldStyle(style: VisualStyle): VisualStyle {
  return style === 'theme' && currentTheme() === 'bricks' ? 'painted' : style;
}

/** What tells a material's program apart from others in the same style (see `patchStyle`). */
export function programKey(material: THREE.Material): string {
  return material.userData[SURFACE] === Surface.Water ? 'w' : '';
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
 * Adds `style` to a material's shaders (from `onBeforeCompile`). The surface uniform goes on
 * every time, since three.js keeps the uniforms from a material's latest compile.
 */
export function patchStyle(
  shader: THREE.WebGLProgramParametersWithUniforms,
  material: THREE.Material,
  style: VisualStyle,
  /** The theme style in Arcade: the objects drawn in pixels (see `PIXELATE`). */
  pixel = false,
): void {
  const define = DEFINES[style];
  const lit = shader.fragmentShader.includes('#include <lights_fragment_end>');
  if (lit) {
    shader.uniforms.styleSurface = { value: surfaceOf(material) };
    shader.uniforms.styleTime = STYLE_TIME;
  }
  if (!define) return;
  // Unlit things (glows, screens, signs) keep their look; the screen pass does the rest.
  if (!lit) return;
  shader.defines = { ...shader.defines, [define]: '' };
  // The painted style is the realistic one's textures, bumps and shine, painted over.
  if (style === 'painted') shader.defines.STYLE_REALISTIC = '';
  if (style === 'theme') shader.defines.STYLE_THEME = '';
  if (pixel) {
    shader.defines.STYLE_PIXEL = '';
    shader.defines.STYLE_TEXEL = (STUD / 4).toFixed(4);
  }
  if (material.userData[SURFACE_PER_VERTEX]) {
    shader.defines.STYLE_SURFACE_ATTR = '';
  }
  // Water's ripples and reflections are worked out only in its own program, not in every
  // surface's (see `programKey`).
  if (material.userData[SURFACE] === Surface.Water) {
    shader.defines.STYLE_WATER = '';
    shader.uniforms.styleShores = { value: shoresOf(material) };
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
  let f = shader.fragmentShader.replace(
    'void main() {',
    `${FRAGMENT_HEAD}\nvoid main() {\n${PIXELATE}`,
  );
  if (pixel) {
    // The light loop, written out (unless the ray tracer already has), to read it per texel.
    f = f.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin);
    for (const [from, to] of PIXEL_LOOP) {
      if (!f.includes(from)) throw new Error(`styles: three.js has no "${from}" any more`);
      f = f.replaceAll(from, to);
    }
    f = f.replace(
      '#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'STYLE_AT( vMapUv )'),
    );
  }
  f = insertAfter(f, 'color_fragment', AFTER_COLOUR);
  f = insertAfter(f, 'roughnessmap_fragment', AFTER_ROUGHNESS);
  f = insertAfter(f, 'normal_fragment_maps', AFTER_NORMAL + PIXEL_LIGHTS);
  f = insertAfter(f, 'emissivemap_fragment', AFTER_EMISSIVE);
  f = insertAfter(f, 'lights_fragment_maps', AFTER_LIGHT_MAPS);
  f = insertAfter(f, 'lights_fragment_end', AFTER_LIGHTS);
  f = insertAfter(f, 'dithering_fragment', MARK_BRICKS);
  shader.fragmentShader = f;
}

/** Tone mapping for each style: filmic for the realistic one. */
export const TONE_MAPPING: Record<VisualStyle, { mapping: THREE.ToneMapping; exposure: number }> = {
  theme: { mapping: THREE.NoToneMapping, exposure: 1 },
  classic: { mapping: THREE.NoToneMapping, exposure: 1 },
  painted: { mapping: THREE.NeutralToneMapping, exposure: 1 },
  realistic: { mapping: THREE.NeutralToneMapping, exposure: 1.1 },
  cartoon: { mapping: THREE.NoToneMapping, exposure: 1 },
  storybook: { mapping: THREE.NoToneMapping, exposure: 1 },
};

/**
 * The theme style's finish, one per interface theme (in the order of `THEMES`), worked out on the
 * frame's final colours with the theme's own (`paper`, `inkColour` and three hues):
 *
 * - Pop: loud colours, thick ink outlines, and comic-book dots in the shadows.
 * - Bauhaus: a poster in red, yellow, blue, black and cream, with heavy black lines.
 * - Blueprint: a cyanotype, shaded in blue and coloured in, white lines on a drafting grid.
 * - Arcade: objects made of pixel art (texels fixed to them, not to the screen), in the PICO-8
 *   palette, with scanlines.
 * - Broadsheet: a colour supplement, pale washes of colour shaded in halftone dots of ink.
 * - Washi: soft watercolours on paper, sumi ink in the shadows, brushed outlines.
 * - Cyberpunk: the world dark, outlined in neon of each surface's own colour that glows.
 * - Horizon: light and clean, clear colours with fine grey lines.
 */
const THEMED = /* glsl */ `
const float LINE_WEIGHT[ 8 ] = float[ 8 ]( 1.6, 2.0, 0.8, 1.0, 1.0, 1.4, 1.0, 0.7 );
/** How much of each theme's own finish a brick takes on. */
const float BRICK_TINGE[ 8 ] = float[ 8 ]( 0.15, 0.15, 0.25, 0.2, 0.25, 0.25, 0.3, 0.1 );
const vec3 PICO[ 16 ] = vec3[ 16 ](
  vec3( 0.0 ), vec3( 29, 43, 83 ) / 255.0, vec3( 126, 37, 83 ) / 255.0, vec3( 0, 135, 81 ) / 255.0,
  vec3( 171, 82, 54 ) / 255.0, vec3( 95, 87, 79 ) / 255.0, vec3( 194, 195, 199 ) / 255.0,
  vec3( 255, 241, 232 ) / 255.0, vec3( 255, 0, 77 ) / 255.0, vec3( 255, 163, 0 ) / 255.0,
  vec3( 255, 236, 39 ) / 255.0, vec3( 0, 228, 54 ) / 255.0, vec3( 41, 173, 255 ) / 255.0,
  vec3( 131, 118, 156 ) / 255.0, vec3( 255, 119, 168 ) / 255.0, vec3( 255, 204, 170 ) / 255.0
);

float luma( vec3 c ) {
  return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
}
vec3 saturation( vec3 c, float s ) {
  return max( mix( vec3( luma( c ) ), c, s ), 0.0 );
}
/** Hue, saturation and value, each 0 to 1. */
vec3 toHsv( vec3 c ) {
  vec4 k = vec4( 0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0 );
  vec4 p = mix( vec4( c.bg, k.wz ), vec4( c.gb, k.xy ), step( c.b, c.g ) );
  vec4 q = mix( vec4( p.xyw, c.r ), vec4( c.r, p.yzx ), step( p.x, c.r ) );
  float d = q.x - min( q.w, q.y );
  return vec3( abs( q.z + ( q.w - q.y ) / ( 6.0 * d + 1e-10 ) ), d / ( q.x + 1e-10 ), q.x );
}
vec3 fromHsv( vec3 c ) {
  vec3 p = abs( fract( c.xxx + vec3( 1.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 );
  return c.z * mix( vec3( 1.0 ), clamp( p - 1.0, 0.0, 1.0 ), c.y );
}
/**
 * A soft, pale version of a colour on \`base\`, keeping its hue (made a little stronger first,
 * so bricks of nearby colours stay apart) and some of its lightness (so black, grey and white
 * bricks do too).
 */
vec3 pastel( vec3 c, vec3 base, float pale ) {
  return mix( saturation( c, 1.35 ), base, pale );
}
/** 1 inside a dot of a halftone screen at 45 degrees, cell pixels apart, as big as dark needs. */
float halftone( vec2 px, float cell, float dark ) {
  vec2 r = mat2( 0.7071, -0.7071, 0.7071, 0.7071 ) * px / cell;
  float d = length( fract( r ) - 0.5 );
  float radius = sqrt( clamp( dark, 0.0, 1.0 ) ) * 0.7;
  float aa = 0.8 / cell;
  return 1.0 - smoothstep( radius - aa, radius + aa, d );
}
/**
 * Cyberpunk's neon for a surface of colour \`c\`: its own hue, bright. Greys, which have no hue
 * worth the name, glow pink when warm (cream walls, wood, sand) and cyan when cool or plain grey.
 * Only the hue picks, not how bright the surface is, so a brick's lit and shaded faces (and the
 * same brick seen from anywhere) glow alike.
 */
vec3 neonOf( vec3 c ) {
  vec3 hsv = toHsv( c );
  vec3 own = fromHsv( vec3( hsv.x, max( hsv.y, 0.75 ), 1.0 ) );
  float warm = ( 1.0 - smoothstep( 0.15, 0.2, min( hsv.x, 1.0 - hsv.x ) ) ) * smoothstep( 0.08, 0.14, hsv.y );
  vec3 grey = mix( hueB, hueA, warm );
  return mix( grey, own, smoothstep( 0.3, 0.5, hsv.y ) * step( 0.03, hsv.z ) );
}
/** 1 on a one-pixel line every cell pixels. */
float gridLine( float f, float cell ) {
  return 1.0 - step( 1.0, mod( f, cell ) );
}
vec3 nearestPico( vec3 c ) {
  vec3 best = PICO[ 0 ];
  float bestD = 1e9;
  for ( int i = 0; i < 16; i ++ ) {
    vec3 d = c - PICO[ i ];
    float dd = dot( d * d, vec3( 0.3, 0.59, 0.11 ) );
    if ( dd < bestD ) {
      bestD = dd;
      best = PICO[ i ];
    }
  }
  return best;
}

vec3 themed( vec3 c, float ink, float glow, vec3 neonColour, float sky, float brick, vec2 px ) {
  vec3 own = c;
  float l = luma( c );
  vec3 hsv = toHsv( c );
  float t = thickness;
  if ( look == 0 ) {
    // Pop.
    c = saturation( c, 1.45 );
    c = mix( c, c * 0.45, halftone( px, 3.5 * t, ( 0.5 - l ) * 1.5 ) * ( 1.0 - sky ) );
    c = mix( c, mix( c, hueC, 0.55 ), sky );
    c = mix( c, inkColour, ink );
  } else if ( look == 1 ) {
    // Bauhaus.
    vec3 poster;
    if ( l < 0.15 ) {
      poster = inkColour;
    } else if ( hsv.y < 0.5 || hsv.z < 0.3 ) {
      poster = l > 0.6 ? paper : l > 0.33 ? mix( paper, inkColour, 0.2 ) : mix( paper, inkColour, 0.72 );
    } else {
      float toRed = min( hsv.x, 1.0 - hsv.x );
      float toYellow = abs( hsv.x - 0.13 );
      float toBlue = abs( hsv.x - 0.6 );
      poster = toRed < toYellow && toRed < toBlue ? hueA : toYellow < toBlue ? hueB : hueC;
      poster *= l < 0.3 ? 0.78 : 1.0;
    }
    c = mix( poster, paper, sky );
    c = mix( c, inkColour, ink );
  } else if ( look == 2 ) {
    // Blueprint.
    // Shaded in the drawing's blue, then coloured in as with pencils, so bricks keep their colour.
    float shade = smoothstep( 0.04, 0.95, l );
    vec3 drawn = mix( paper, hueC, shade * 0.85 );
    vec3 pencil = mix( saturation( c, 1.4 ), inkColour, 0.2 ) * ( 0.55 + 0.45 * shade );
    c = mix( drawn, pencil, smoothstep( 0.3, 0.55, hsv.y ) * 0.75 );
    c = mix( c, inkColour, smoothstep( 0.85, 1.0, l ) * 0.4 );
    c = mix( c, paper, sky );
    float minor = max( gridLine( px.x, 10.0 * t ), gridLine( px.y, 10.0 * t ) );
    float major = max( gridLine( px.x, 50.0 * t ), gridLine( px.y, 50.0 * t ) );
    c = mix( c, inkColour, max( minor * 0.07, major * 0.16 ) );
    c = mix( c, inkColour, ink * 0.9 );
  } else if ( look == 3 ) {
    // Arcade: the objects themselves are drawn in texels (see \`PIXELATE\`); here they go into
    // the palette, with some of the real colour kept (fully snapped, the busy scenes broke up).
    vec3 s = saturation( c, 1.25 );
    c = mix( nearestPico( s ), s, 0.35 );
    c = mix( c, PICO[ 0 ], step( 0.5, ink ) );
    c *= 0.9 + 0.1 * step( 1.0, mod( px.y, 3.0 ) );
  } else if ( look == 4 ) {
    // Broadsheet.
    // A colour supplement: each surface in a pale wash of its own colour, shaded in ink dots.
    float dots = halftone( px, 4.0 * t, 1.0 - pow( l, 0.45 ) - 0.2 ) * ( 1.0 - sky );
    c = mix( pastel( c / max( max( c.r, max( c.g, c.b ) ), 0.25 ) * 0.85, paper, 0.42 ), paper, sky );
    c = mix( c, inkColour, dots * 0.8 );
    c *= 0.97 + 0.03 * noise( px * 0.5 );
    c = mix( c, inkColour, ink );
  } else if ( look == 5 ) {
    // Washi.
    // Soft watercolours on the paper, pooling unevenly, with sumi ink in the shadows.
    float pool = 0.82 + 0.36 * noise( px / ( 40.0 * t ) );
    float wash = pow( 1.0 - l, 1.6 ) * 0.6 * pool;
    c = pastel( c, paper, 0.5 ) * ( 0.92 + 0.08 * pool );
    c = mix( c, inkColour, clamp( wash - 0.15, 0.0, 1.0 ) );
    c = mix( c, paper, sky );
    c *= 0.95 + 0.05 * noise( px * 0.7 );
    c = mix( c, inkColour, ink * ( 0.5 + 0.5 * noise( px / ( 6.0 * t ) ) ) );
  } else if ( look == 6 ) {
    // Cyberpunk.
    // Dark, but each surface still in its own colour; the neon round it is that colour too.
    float vivid = smoothstep( 0.3, 0.5, hsv.y );
    c = paper + mix( c * vec3( 0.3, 0.24, 0.42 ), saturation( c, 1.5 ) * 0.45, vivid );
    c = mix( c, mix( paper, vec3( 0.2, 0.07, 0.32 ), vUv.y ), sky );
    c += neonColour * ( ink * 0.95 + glow * 0.6 );
  } else {
    // Horizon.
    // Clean and bright, but with its colours and contrast kept (whitened any more, it looked
    // like fog).
    c = mix( saturation( c, 1.05 ), vec3( 1.0 ), 0.06 );
    c = mix( c, mix( paper, vec3( 1.0 ), vUv.y ), sky );
    c = mix( c, inkColour, ink * 0.55 );
  }
  // Bricks: in their own colour, only tinged with the theme's, so a red brick is plainly red to
  // every player whatever theme each one plays in (the bricks are what the players talk about).
  // Lines drawn over them stay as the theme draws them.
  vec3 kept = mix( own, c, BRICK_TINGE[ look ] );
  c = mix( c, mix( kept, c, ink ), brick );
  return clamp( c, 0.0, 1.0 );
}
`;

/**
 * The cartoon and storybook styles' last step: the frame is drawn into a buffer, then copied to
 * the screen with lines wherever the depth jumps (outlines) or bends (creases), read from the
 * depth alone. Cartoon inks them; storybook pencils them in with a slight waver and gaps, darkens the
 * edges of each wash the way watercolour dries, and lays it all on grainy cream paper. The theme
 * style finishes the frame the way the interface theme looks (see `THEMED` below).
 */
export class ScreenPass {
  readonly target: THREE.WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly material: THREE.ShaderMaterial;
  /** Stops watching for another interface theme, in the theme style. */
  private readonly unwatchTheme: (() => void) | null = null;

  /**
   * `antialias`: draw the buffer multisampled. Not with ambient occlusion, which is laid over
   * the frame in a second pass: three.js throws a multisampled buffer's samples away once it
   * resolves them, so the second pass would draw over nothing.
   */
  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    readonly style: 'cartoon' | 'storybook' | 'theme',
    readonly antialias: boolean,
    /**
     * Whether all but the sky is bricks: the build editor's scene, whose materials are not marked
     * (see `MARK_BRICKS`), holds nothing else.
     */
    allBricks = false,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const depth = new THREE.DepthTexture(size.x, size.y);
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: antialias ? 4 : 0,
      depthTexture: depth,
    });
    this.material = new THREE.ShaderMaterial({
      defines:
        style === 'storybook'
          ? { STORYBOOK: '' }
          : style === 'theme'
            ? { THEMED: '', ...(allBricks ? { ALL_BRICKS: '' } : {}) }
            : {},
      uniforms: {
        look: { value: 0 },
        paper: { value: new THREE.Vector3() },
        inkColour: { value: new THREE.Vector3() },
        hueA: { value: new THREE.Vector3() },
        hueB: { value: new THREE.Vector3() },
        hueC: { value: new THREE.Vector3() },
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
        uniform int look;
        uniform vec3 paper;
        uniform vec3 inkColour;
        uniform vec3 hueA;
        uniform vec3 hueB;
        uniform vec3 hueC;
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
        #ifdef THEMED
          ${THEMED}
        #endif
        void main() {
          vec2 o = texel * thickness;
          #ifdef THEMED
            // Screen pixels, so the dots, grids and scanlines keep their size at any resolution.
            vec2 px = vUv / texel;
            vec2 uv = vUv;
            float ink = edges( uv, o * LINE_WEIGHT[ look ] );
            // Cyberpunk: a glow around the neon lines, in the colour of what they ring (read from
            // the nearest of the neighbours: the lines sit on the far side of an edge).
            float glow = 0.0;
            vec3 neonColour = vec3( 0.0 );
            if ( look == 6 ) {
              glow = max( edges( uv, o * 3.0 ) * 0.5, edges( uv, o * 6.0 ) * 0.25 );
              vec2 r = o * 4.0;
              vec2 near = uv;
              float nearZ = viewZ( uv );
              for ( int i = 0; i < 8; i ++ ) {
                float a = float( i ) * 0.7854;
                vec2 at = uv + vec2( cos( a ), sin( a ) ) * r;
                float z = viewZ( at );
                if ( z < nearZ * 0.98 ) {
                  nearZ = z;
                  near = at;
                }
              }
              neonColour = neonOf( clamp( texture2D( tColor, near ).rgb, 0.0, 1.0 ) );
            }
            float sky = step( 1.0, texture2D( tDepth, uv ).r );
            vec4 frame = texture2D( tColor, uv );
            // Bricks are marked by an alpha of 0.5 (see \`MARK_BRICKS\`).
            #ifdef ALL_BRICKS
              float brick = 1.0 - sky;
            #else
              float brick = clamp( ( 1.0 - frame.a ) * 2.0, 0.0, 1.0 ) * ( 1.0 - sky );
            #endif
            gl_FragColor = vec4( frame.rgb, 1.0 );
          #elif defined( STORYBOOK )
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
          #ifdef THEMED
            gl_FragColor.rgb = themed( clamp( gl_FragColor.rgb, 0.0, 1.0 ), ink, glow, neonColour, sky, brick, px );
          #endif
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
    if (style === 'theme') {
      this.readTheme();
      this.unwatchTheme = onThemeChange(() => this.readTheme());
    }
  }

  /** The interface theme's look and its colours (`--sar-world-*` in style.css). */
  private readTheme(): void {
    const u = this.material.uniforms;
    const id = currentTheme();
    u.look!.value = Math.max(
      0,
      THEMES.findIndex((t) => t.id === id),
    );
    const css = getComputedStyle(document.documentElement);
    const colour = new THREE.Color();
    const rgb = { r: 0, g: 0, b: 0 };
    for (const [uniform, token] of [
      ['paper', 'paper'],
      ['inkColour', 'ink'],
      ['hueA', 'a'],
      ['hueB', 'b'],
      ['hueC', 'c'],
    ] as const) {
      const value = css.getPropertyValue(`--sar-world-${token}`).trim();
      colour.set(value || '#808080').getRGB(rgb, THREE.SRGBColorSpace);
      (u[uniform]!.value as THREE.Vector3).set(rgb.r, rgb.g, rgb.b);
    }
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
    this.unwatchTheme?.();
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}
