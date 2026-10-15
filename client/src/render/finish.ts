import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * How a frame is finished with bloom on: drawn in high dynamic range into a buffer, then copied
 * to the screen with bloom (a soft glow spilling round whatever is brighter than white: the sun,
 * lamps, shine on glass and metal), tone mapped, and graded like the key art of an adventure
 * game: a little more colour and contrast, warm highlights over cooler shadows, and the corners
 * darkened a touch.
 *
 * The bloom is the usual chain of half-size buffers: the frame is halved down five times, each
 * pixel the average of the 4 × 4 under it (four bilinear taps), the brightest of it only at the
 * first step, then each level is added back onto the one above it through a 3 × 3 tent (four
 * bilinear taps again). Every level is a quarter of the one above, so all of them together cost
 * about a third of one full-size pass. (Call of Duty: Advanced Warfare's 13- and 9-tap filters
 * looked no different under a glow this soft, and took a software renderer some 40 ms longer a frame.)
 */

/** How many times the frame is halved for the bloom. */
const LEVELS = 5;

/** How much of the glow is added to the frame. */
const BLOOM = 0.22;
/** Brighter than white starts to glow, with a soft knee so the glow does not switch on. */
const THRESHOLD = 1.0;
/** How much the corners are darkened. */
const VIGNETTE = 0.22;

/** How a frame is graded: how much more colour, and how much more contrast round the middle. */
export interface Grade {
  saturation: number;
  contrast: number;
}

/** The game's own grade. */
export const GRADE: Readonly<Grade> = { saturation: 1.12, contrast: 0.18 };

const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** Halves the image: the 4 × 4 under each pixel, the brightest only at the first step. */
const DOWN = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 texel;
uniform float threshold;
varying vec2 vUv;

vec3 tap( vec2 o ) {
  vec3 c = texture2D( tSource, vUv + o * texel ).rgb;
  #ifdef PREFILTER
    // A broken pixel (a normal of zero length makes one now and then) would spread through
    // the whole chain into a blot, so it is dropped; and the taps are averaged squeezed, so a
    // blazing speck (the sun's glint on a glossy edge) is weighed down and cannot flicker into
    // a big glow.
    if ( any( isnan( c ) ) || any( isinf( c ) ) ) return vec3( 0.0 );
    c = min( c, vec3( 64.0 ) );
    c /= 1.0 + max( c.r, max( c.g, c.b ) ) * 0.25;
  #endif
  return c;
}
void main() {
  // Each tap between four pixels, so the four of them cover the 4 × 4 evenly.
  vec3 colour = ( tap( vec2( -1.0, -1.0 ) ) + tap( vec2( 1.0, -1.0 ) ) + tap( vec2( -1.0, 1.0 ) )
    + tap( vec2( 1.0, 1.0 ) ) ) * 0.25;
  #ifdef PREFILTER
    // Back from the squeeze the taps were averaged in (see \`tap\`): an even bright patch comes
    // out as bright as it was, a lone speck much dimmer.
    colour /= max( 1.0 - max( colour.r, max( colour.g, colour.b ) ) * 0.25, 0.05 );
    // Only what is brighter than the threshold, eased in over a knee half as wide; a single
    // blazing pixel (a glint) is tamed so it cannot flicker into a big blot.
    float bright = max( colour.r, max( colour.g, colour.b ) );
    float knee = threshold * 0.5;
    float soft = clamp( bright - threshold + knee, 0.0, 2.0 * knee );
    soft = soft * soft / ( 4.0 * knee + 1e-4 );
    colour *= max( soft, bright - threshold ) / max( bright, 1e-4 );
  #endif
  gl_FragColor = vec4( colour, 1.0 );
}
`;

/** Adds the level below, spread through a 3 × 3 tent, onto this one. */
const UP = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 texel;
varying vec2 vUv;

vec3 tap( vec2 o ) {
  return texture2D( tSource, vUv + o * texel ).rgb;
}
void main() {
  // Four bilinear taps half a pixel out, each the 2 × 2 round it: together the tent's
  // 1 2 1 / 2 4 2 / 1 2 1.
  vec3 colour = tap( vec2( -0.5, -0.5 ) ) + tap( vec2( 0.5, -0.5 ) ) + tap( vec2( -0.5, 0.5 ) )
    + tap( vec2( 0.5, 0.5 ) );
  gl_FragColor = vec4( colour * 0.25, 1.0 );
}
`;

/** The frame with its bloom and ambient occlusion, tone mapped and graded, onto the screen. */
const COMPOSITE = /* glsl */ `
#include <packing>
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float bloom;
uniform float vignette;
uniform float saturation;
uniform float contrast;
uniform vec2 resolution;
#ifdef AO
  uniform sampler2D tAO;
  uniform sampler2D tDepth;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float fadeFrom;
  uniform float fadeTo;
#endif
varying vec2 vUv;

float luma( vec3 c ) {
  return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
}
/** Khronos PBR Neutral: keeps hues and saturation, rolls the highlights off to white. */
vec3 neutral( vec3 color ) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min( color.r, min( color.g, color.b ) );
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak < startCompression ) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / ( peak + d - startCompression );
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
  return mix( color, vec3( newPeak ), g );
}
float hash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

void main() {
  vec3 c = texture2D( tScene, vUv ).rgb;
  if ( any( isnan( c ) ) ) c = vec3( 0.0 );
  #ifdef AO
  {
    float depth = texture2D( tDepth, vUv ).r;
    if ( depth < 1.0 ) {
      float distance = - perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
      // Corner shading far off is not missed, and the screen's depth gets coarse there.
      float strength = 1.0 - smoothstep( fadeFrom, fadeTo, distance );
      // Occlusion this faint is noise on flat surfaces; real corners are far darker.
      float ao = min( 1.0, texture2D( tAO, vUv ).r / 0.92 );
      c *= mix( 1.0, ao, strength );
    }
  }
  #endif
  c += texture2D( tBloom, vUv ).rgb * bloom;
  c = neutral( c );
  {
    // A little more colour, and contrast round the middle greys.
    float l = luma( c );
    c = max( mix( vec3( l ), c, saturation ), 0.0 );
    c = mix( c, c * c * ( 3.0 - 2.0 * c ), contrast );
    // Warm in the light, cooler in the shade.
    l = luma( c );
    c *= mix( vec3( 0.97, 0.99, 1.04 ), vec3( 1.03, 1.0, 0.96 ), smoothstep( 0.15, 0.75, l ) );
  }
  // The corners darkened a little, as through a lens.
  vec2 v = ( vUv - 0.5 ) * vec2( resolution.x / resolution.y, 1.0 );
  c *= 1.0 - vignette * smoothstep( 0.25, 1.1, dot( v, v ) * 1.6 );
  gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
  #include <colorspace_fragment>
  // A whisper of noise, so the smooth gradients of the sky do not band: half a step of the
  // screen's own, after sRGB (before it, the dark sky's steps are many times as big).
  gl_FragColor.rgb += ( hash( gl_FragCoord.xy ) - 0.5 ) / 255.0;
}
`;

/** What `Finish.render` needs to lay ambient occlusion over the frame. */
export interface FinishAo {
  ao: THREE.Texture;
  depth: THREE.Texture;
  near: number;
  far: number;
  fadeFrom: number;
  fadeTo: number;
}

export class Finish {
  /** Where the frame is drawn, multisampled, before it is finished. */
  readonly target: THREE.WebGLRenderTarget;
  private readonly levels: THREE.WebGLRenderTarget[] = [];
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private size = new THREE.Vector2();

  constructor(
    renderer: THREE.WebGLRenderer,
    /** Whether the frame's ambient occlusion is laid on here (see `render`). */
    readonly withAo: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    for (let i = 0; i < LEVELS; i++) {
      const level = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
      });
      level.texture.minFilter = level.texture.magFilter = THREE.LinearFilter;
      level.texture.generateMipmaps = false;
      this.levels.push(level);
    }
    const shader = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: QUAD_VERTEX,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
    this.prefilter = shader(DOWN, {
      tSource: { value: null },
      texel: { value: new THREE.Vector2() },
      threshold: { value: THRESHOLD },
    });
    this.prefilter.defines.PREFILTER = '';
    this.down = shader(DOWN, {
      tSource: { value: null },
      texel: { value: new THREE.Vector2() },
      threshold: { value: 0 },
    });
    this.up = shader(UP, {
      tSource: { value: null },
      texel: { value: new THREE.Vector2() },
    });
    // Each level is added onto the one above it.
    this.up.blending = THREE.CustomBlending;
    this.up.blendSrc = THREE.OneFactor;
    this.up.blendDst = THREE.OneFactor;
    this.composite = shader(COMPOSITE, {
      tScene: { value: this.target.texture },
      tBloom: { value: this.levels[0]!.texture },
      bloom: { value: BLOOM },
      vignette: { value: VIGNETTE },
      saturation: { value: GRADE.saturation },
      contrast: { value: GRADE.contrast },
      resolution: { value: new THREE.Vector2() },
      tAO: { value: null },
      tDepth: { value: null },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 100 },
      fadeFrom: { value: 0 },
      fadeTo: { value: 1 },
    });
    this.composite.toneMapped = false;
    if (withAo) this.composite.defines.AO = '';
    this.setSize(size.x, size.y);
  }

  setSize(width: number, height: number): void {
    if (this.size.x === width && this.size.y === height) return;
    this.size.set(width, height);
    this.target.setSize(width, height);
    let w = width;
    let h = height;
    for (const level of this.levels) {
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
      level.setSize(w, h);
    }
    (this.composite.uniforms.resolution!.value as THREE.Vector2).set(width, height);
  }

  /**
   * Finishes the frame drawn into `target` onto the screen, graded by `grade`, laying `ao` over
   * it first (the ambient occlusion is worked out after the frame, and three.js throws a
   * multisampled buffer's samples away once it resolves them, so it cannot be blended onto the
   * buffer).
   */
  render(renderer: THREE.WebGLRenderer, ao: FinishAo | null, grade: Grade = GRADE): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    // Down the chain, the brightest only from the frame itself.
    let source: THREE.Texture = this.target.texture;
    let sourceSize = this.size;
    this.levels.forEach((level, i) => {
      const material = i === 0 ? this.prefilter : this.down;
      material.uniforms.tSource!.value = source;
      (material.uniforms.texel!.value as THREE.Vector2).set(1 / sourceSize.x, 1 / sourceSize.y);
      this.quad.material = material;
      renderer.setRenderTarget(level);
      this.quad.render(renderer);
      source = level.texture;
      sourceSize = new THREE.Vector2(level.width, level.height);
    });
    // Back up it, each level added onto the one above.
    for (let i = LEVELS - 1; i > 0; i--) {
      const from = this.levels[i]!;
      this.up.uniforms.tSource!.value = from.texture;
      (this.up.uniforms.texel!.value as THREE.Vector2).set(1 / from.width, 1 / from.height);
      this.quad.material = this.up;
      renderer.setRenderTarget(this.levels[i - 1]!);
      this.quad.render(renderer);
    }
    const u = this.composite.uniforms;
    u.saturation!.value = grade.saturation;
    u.contrast!.value = grade.contrast;
    if (ao) {
      u.tAO!.value = ao.ao;
      u.tDepth!.value = ao.depth;
      u.cameraNear!.value = ao.near;
      u.cameraFar!.value = ao.far;
      u.fadeFrom!.value = ao.fadeFrom;
      u.fadeTo!.value = ao.fadeTo;
    }
    this.quad.material = this.composite;
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.target.dispose();
    for (const level of this.levels) level.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.composite]) m.dispose();
    this.quad.dispose();
  }
}
