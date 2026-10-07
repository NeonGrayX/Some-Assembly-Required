import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { GraphicsSettings } from '../graphics-settings.ts';
import { RayTracer } from './raytrace.ts';

/** Whether a mesh with this material hides what is behind it, for ambient occlusion. */
function solid(material: THREE.Material | THREE.Material[]): boolean {
  const all = Array.isArray(material) ? material : [material];
  return all.every((m) => !m.transparent && m.depthWrite && m.colorWrite && m.visible);
}

/** Name of the group of boxes that keep the sun out of the rooms in the shadow map. */
export const ROOM_SHADE = 'roomShade';

/** Ambient occlusion is at full strength up to `from` metres away and gone by `to`. */
const AO_FADE = { from: 6, to: 14 };

const SHADOW_MAP_SIZE = { off: 0, low: 1024, medium: 2048, high: 4096, traced: 2048 } as const;

/** The page's one ray tracer, and whether it is on. */
const rayTracer = new RayTracer();
let tracing = false;
let shaderKey = '';

// Every material passes through here when it is compiled, so the ray tracing reaches all of
// them (including bricks and players made later) without each one being set up by hand. The
// key makes three.js compile a separate program while tracing is on.
THREE.Material.prototype.onBeforeCompile = function (shader) {
  rayTracer.patch(shader, tracing);
};
THREE.Material.prototype.customProgramCacheKey = function () {
  return shaderKey;
};

/**
 * Applies the graphics settings to the renderer and scene: resolution, shadows (maps or ray
 * traced), and ambient occlusion. Everything can change while playing.
 */
export class Graphics {
  private settings: GraphicsSettings | null = null;
  private ao: { pass: GTAOPass; quad: FullScreenQuad; material: THREE.ShaderMaterial } | null =
    null;
  /** The house as built for this round: everything that never moves. */
  private house: THREE.Object3D | null = null;
  /** The house's meshes in the traced hierarchy, or null until it is built for this house. */
  private traced: THREE.Mesh[] | null = null;
  /** Told whenever shadows are switched to or from ray traced (the lamps' light changes too). */
  onTraced: (traced: boolean) => void = () => {};

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sun: THREE.DirectionalLight,
  ) {}

  /** A new house was built (every round is furnished differently). */
  setHouse(house: THREE.Object3D): void {
    this.house = house;
    this.traced = null;
    if (this.settings) this.apply(this.settings);
  }

  apply(g: GraphicsSettings): void {
    const before = this.settings;
    this.settings = { ...g };

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * g.scale);
    this.resizeAo();

    // Shadows. Ray traced: the house is traced, and only what moves goes in the shadow maps.
    const traced = g.shadows === 'traced';
    this.renderer.shadowMap.enabled = g.shadows !== 'off';
    const size = SHADOW_MAP_SIZE[g.shadows];
    if (size && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.radius = g.shadows === 'high' ? 2.5 : 1;
    if (traced && this.house && !this.traced) {
      // A few hundred milliseconds for the whole house, once per round.
      this.traced = rayTracer.build([this.house]);
    }
    tracing = traced;
    // What the house casts into the shadow maps: everything, unless it is traced instead.
    const inTrace = new Set(traced ? this.traced : []);
    this.house?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.userData.castsShadow ??= o.castShadow;
      o.castShadow = !inTrace.has(o) && !!o.userData.castsShadow;
    });
    const shade = this.house?.getObjectByName(ROOM_SHADE);
    if (shade) shade.visible = !traced;
    this.onTraced(traced);

    // Every program that depends on these is rebuilt.
    const key = `${traced ? 'rt' : ''}|${g.shadows === 'off' ? 'noshadow' : ''}`;
    if (key !== shaderKey || before?.shadows !== g.shadows) {
      shaderKey = key;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        for (const x of Array.isArray(m) ? m : m ? [m] : []) x.needsUpdate = true;
      });
    }

    if (g.ao && !this.ao) this.makeAo();
    if (!g.ao && this.ao) {
      this.ao.pass.dispose();
      this.ao.quad.dispose();
      this.ao.material.dispose();
      this.ao = null;
    }
  }

  /**
   * Ambient occlusion, worked out from the depth and normals of what is on screen and then
   * multiplied over the finished frame. The frame itself is drawn exactly as without it: drawn
   * through a separate buffer, the lamps' additive glows came out far brighter.
   */
  private makeAo(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const pass = new GTAOPass(this.scene, this.camera, size.x, size.y);
    // A tight radius and many samples keep the shading in the corners and crevices themselves,
    // without a grainy dark halo around every object; the denoise only evens out the grain.
    pass.updateGtaoMaterial({
      // The radius is measured on screen (in hundreds of pixels), not in metres: at a fixed
      // world radius, distant surfaces seen at a slant were sampled only a few pixels apart,
      // where snapping to pixels makes a flat surface look raised next to itself, so it shaded
      // itself (a grey band beyond a sharp line on ground and walls).
      screenSpaceRadius: true,
      radius: 0.4,
      distanceExponent: 2,
      thickness: 0.8,
      scale: 1,
      samples: 24,
    });
    pass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 4,
      normalPhi: 6,
      radius: 3,
      rings: 2,
      samples: 16,
    });
    // Only work out the occlusion; it is laid over the frame below.
    pass.output = GTAOPass.OUTPUT.Off;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tAO: { value: pass.pdRenderTarget.texture },
        tDepth: { value: pass.depthTexture },
        cameraNear: { value: this.camera.near },
        cameraFar: { value: this.camera.far },
        fadeFrom: { value: AO_FADE.from },
        fadeTo: { value: AO_FADE.to },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position.xy, 0.0, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tAO;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float fadeFrom;
        uniform float fadeTo;
        varying vec2 vUv;
        void main() {
          float depth = texture2D( tDepth, vUv ).r;
          float distance = - perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
          // Corner shading far off is not missed, and the screen's depth gets coarse there.
          float strength = 1.0 - smoothstep( fadeFrom, fadeTo, distance );
          // Occlusion this faint is noise on flat surfaces; real corners are far darker.
          float ao = min( 1.0, texture2D( tAO, vUv ).r / 0.92 );
          gl_FragColor = vec4( vec3( mix( 1.0, ao, strength ) ), 1.0 );
        }`,
      // Multiplies what is on screen by the occlusion.
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      depthTest: false,
      depthWrite: false,
    });
    this.ao = { pass, quad: new FullScreenQuad(material), material };
  }

  private resizeAo(): void {
    if (!this.ao) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.ao.pass.setSize(size.x, size.y);
  }

  /** The window changed size. */
  resize(): void {
    this.resizeAo();
  }

  render(): void {
    const r = this.renderer;
    r.render(this.scene, this.camera);
    if (!this.ao) return;
    // The occlusion is worked out from a depth and normal image of the scene drawn as if all
    // solid. Glows, halos, light pools, glass and shadow-only boxes are not: they would show up
    // as black squares and slabs.
    const hidden: THREE.Object3D[] = [];
    this.scene.traverseVisible((o) => {
      if (o instanceof THREE.Sprite || (o instanceof THREE.Mesh && !solid(o.material))) {
        hidden.push(o);
      }
    });
    for (const o of hidden) o.visible = false;
    this.ao.pass.render(r, null as never, null as never, 0, false);
    for (const o of hidden) o.visible = true;
    r.setRenderTarget(null);
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.ao.quad.render(r);
    r.autoClear = autoClear;
  }

  /** Triangles in the traced house (0 until ray tracing was first turned on). */
  get tracedTriangles(): number {
    return rayTracer.triangles;
  }
}
