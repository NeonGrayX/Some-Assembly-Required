import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { GraphicsSettings } from '../graphics-settings.ts';
import { RayTracer } from './raytrace.ts';

/** Name of the group of boxes that keep the sun out of the rooms in the shadow map. */
export const ROOM_SHADE = 'roomShade';

const SHADOW_MAP_SIZE = { off: 0, low: 1024, medium: 2048, high: 4096, traced: 2048 } as const;

let tracer: RayTracer | null = null;
let shaderKey = '';

// Every material passes through here when it is compiled, so the ray tracing reaches all of
// them (including bricks and players made later) without each one being set up by hand. The
// key makes three.js compile a separate program while tracing is on.
THREE.Material.prototype.onBeforeCompile = function (shader) {
  tracer?.patch(shader);
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
  private readonly rayTracer = new RayTracer();
  /** The house as built for this round: everything that never moves. */
  private house: THREE.Object3D | null = null;
  /** The house's meshes in the traced hierarchy, or null until it is built for this house. */
  private traced: THREE.Mesh[] | null = null;

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
      this.traced = this.rayTracer.build([this.house]);
    }
    tracer = traced ? this.rayTracer : null;
    // What the house casts into the shadow maps: everything, unless it is traced instead.
    const inTrace = new Set(traced ? this.traced : []);
    this.house?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.userData.castsShadow ??= o.castShadow;
      o.castShadow = !inTrace.has(o) && !!o.userData.castsShadow;
    });
    const shade = this.house?.getObjectByName(ROOM_SHADE);
    if (shade) shade.visible = !traced;

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
    pass.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 1, scale: 1 });
    // A wider, stronger denoise than the default, so edges come out smooth rather than grainy.
    pass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 8,
      rings: 2,
      samples: 16,
    });
    // Only work out the occlusion; it is laid over the frame below.
    pass.output = GTAOPass.OUTPUT.Off;
    const material = new THREE.ShaderMaterial({
      uniforms: { tAO: { value: pass.pdRenderTarget.texture }, intensity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4( position.xy, 0.0, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tAO;
        uniform float intensity;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4( vec3( mix( 1.0, texture2D( tAO, vUv ).r, intensity ) ), 1.0 );
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
    this.ao.pass.render(r, null as never, null as never, 0, false);
    r.setRenderTarget(null);
    const autoClear = r.autoClear;
    r.autoClear = false;
    this.ao.quad.render(r);
    r.autoClear = autoClear;
  }

  /** Triangles in the traced house (0 until ray tracing was first turned on). */
  get tracedTriangles(): number {
    return this.rayTracer.triangles;
  }
}
