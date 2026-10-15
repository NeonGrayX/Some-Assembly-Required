import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { GraphicsSettings } from '../graphics-settings.ts';
import { Finish } from './finish.ts';
import type { FinishAo } from './finish.ts';
import { RayTracer } from './raytrace.ts';
import { NO_AO, UNSEEN } from './layers.ts';
import { STYLE_TIME, SURFACE_PER_VERTEX, patchStyle, programKey } from './styles.ts';

/** Whether a mesh with this material hides what is behind it, for ambient occlusion. */
function solid(material: THREE.Material | THREE.Material[]): boolean {
  const all = Array.isArray(material) ? material : [material];
  return all.every((m) => !m.transparent && m.depthWrite && m.colorWrite && m.visible);
}

/** Ambient occlusion is at full strength up to `from` metres away and gone by `to`. */
const AO_FADE = { from: 6, to: 14 };

const SHADOW_MAP_SIZE = { off: 0, low: 1024, medium: 2048, high: 4096, traced: 4096 } as const;
/**
 * Ray traced, the sun's shadow map only holds what moves, so instead of the whole level it
 * covers this far (in metres, as the sun sees it) around where the camera looks: about four
 * times the texels per metre, for sharp shadows of players and bricks outdoors.
 */
const TRACED_SUN_REACH = 12;
/**
 * The ceiling lamps' shadow maps. A lamp's spreads over a cone far wider than a room, so it
 * needs many texels for a player's shadow under it to come out sharp.
 */
const LAMP_MAP_SIZE = { off: 0, low: 512, medium: 1024, high: 2048, traced: 2048 } as const;

/** The page's one ray tracer, and whether it is on. */
const rayTracer = new RayTracer();
let tracing = false;
let shaderKey = '';
/** The renderer the world is painted with (the page printer and others draw plainly). */
let styledRenderer: THREE.WebGLRenderer | null = null;

// Every material passes through here when it is compiled, so the ray tracing and the painted
// style reach all of them (including bricks and players made later) without each one being set
// up by hand. The key makes three.js compile a separate program for each.
THREE.Material.prototype.onBeforeCompile = function (shader, renderer) {
  rayTracer.patch(shader, tracing);
  if (renderer === styledRenderer) patchStyle(shader, this);
};
THREE.Material.prototype.customProgramCacheKey = function () {
  return `${shaderKey}${this.userData[SURFACE_PER_VERTEX] ? '|sv' : ''}|${programKey(this)}`;
};

/**
 * Applies the graphics settings to the renderer and scene: resolution, shadows (maps or ray
 * traced), and ambient occlusion. Everything can change while playing.
 */
export class Graphics {
  private settings: GraphicsSettings | null = null;
  private ao: { pass: GTAOPass; quad: FullScreenQuad; material: THREE.ShaderMaterial } | null =
    null;
  /**
   * The house as built for this round: everything that never moves. None on a map with nothing
   * standing (the build editor's), where even ray traced shadows come from the shadow maps.
   */
  private house: THREE.Object3D | null = null;
  /** The house's meshes in the traced hierarchy, or null until it is built for this house. */
  private traced: THREE.Mesh[] | null = null;
  /** Told whenever shadows are switched to or from ray traced (the lamps' light changes too). */
  onTraced: (traced: boolean) => void = () => {};
  /** The sun's shadow over the whole level, as set up for shadow maps. */
  private sunBounds: Pick<THREE.OrthographicCamera, 'left' | 'right' | 'top' | 'bottom'>;
  /** The bloom and grading, while bloom is on (see `Finish`). */
  private finish: Finish | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sun: THREE.DirectionalLight,
  ) {
    const { left, right, top, bottom } = sun.shadow.camera;
    this.sunBounds = { left, right, top, bottom };
    styledRenderer = renderer;
    // Set before anything is compiled, as three.js builds it into every program.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
  }

  /** The height of the ground under a point, where the traced sun's shadow is centred. */
  private ground: (x: number, z: number) => number = () => 0;

  /**
   * A new house was built (every round is furnished differently), or none (`house`), with the
   * height of its level's ground everywhere (`ground`, flat at 0 unless given).
   */
  setHouse(house: THREE.Object3D | null, ground: (x: number, z: number) => number = () => 0): void {
    this.house = house;
    this.ground = ground;
    // The view fits the sun's shadow to each level before handing its house over.
    const { left, right, top, bottom } = this.sun.shadow.camera;
    this.sunBounds = { left, right, top, bottom };
    this.traced = null;
    if (this.settings) this.apply(this.settings);
  }

  apply(g: GraphicsSettings): void {
    const before = this.settings;
    this.settings = { ...g };

    this.setPixelRatio();
    this.resizeAo();

    // Shadows. Ray traced: the house is traced, and only what moves goes in the shadow maps.
    const traced = g.shadows === 'traced' && this.house !== null;
    this.renderer.shadowMap.enabled = g.shadows !== 'off';
    const size = SHADOW_MAP_SIZE[g.shadows];
    if (size && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.sun.shadow.radius = g.shadows === 'high' ? 2.5 : 1;
    // Your own builder casts its shadow even while the camera is in close and cannot see it.
    this.sun.shadow.camera.layers.enable(UNSEEN);
    // Offsets that keep surfaces from shadowing themselves, at the cost of a gap between
    // a foot and the start of its shadow. Over the whole level's coarse map that was needed;
    // the traced map around the view is fine enough for a gap too small to see.
    this.sun.shadow.bias = traced ? -0.00005 : -0.0005;
    this.sun.shadow.normalBias = traced ? 0.006 : 0.02;
    const lampSize = LAMP_MAP_SIZE[g.shadows];
    this.house?.traverse((o) => {
      if (!(o instanceof THREE.SpotLight) || !o.castShadow || !lampSize) return;
      // Traced, the map only holds what moves, all rounded and smoothed by the filtering, so
      // no offset is needed: even a small one left a thin lit ring around each foot.
      o.shadow.bias = traced ? 0 : -0.0005;
      o.shadow.normalBias = traced ? 0 : 0.02;
      o.shadow.camera.layers.enable(UNSEEN);
      if (o.shadow.mapSize.x === lampSize) return;
      o.shadow.mapSize.set(lampSize, lampSize);
      o.shadow.map?.dispose();
      o.shadow.map = null;
    });
    if (traced && this.house && !this.traced) {
      // A few hundred milliseconds for the whole house, once per round.
      this.traced = rayTracer.build([this.house]);
    }
    tracing = traced;
    if (!traced) {
      Object.assign(this.sun.shadow.camera, this.sunBounds);
      this.sun.shadow.camera.updateProjectionMatrix();
    }
    // What the house casts into the shadow maps: everything, unless it is traced instead.
    const inTrace = new Set(traced ? this.traced : []);
    this.house?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.userData.castsShadow ??= o.castShadow;
      o.castShadow = !inTrace.has(o) && !!o.userData.castsShadow;
    });
    this.onTraced(traced);

    // The frame goes through bloom and grading, if it is on.
    if (this.finish && (!g.bloom || this.finish.withAo !== g.ao)) {
      this.finish.dispose();
      this.finish = null;
    }
    if (g.bloom && !this.finish) {
      this.finish = new Finish(this.renderer, g.ao);
      this.resizeFinish();
    }

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
      // Only what is this thick (in metres) shades what lies behind it on screen: a table leg is
      // a few centimetres deep, and counted as a solid wall it cast a dark band on the floor
      // beside it.
      thickness: 0.2,
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
          if ( depth >= 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
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

  /** The drawing resolution: the screen's at the chosen scale. */
  private setPixelRatio(): void {
    const g = this.settings;
    if (!g) return;
    const ratio = Math.min(window.devicePixelRatio, 2) * g.scale;
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.resizeFinish();
  }

  private resizeFinish(): void {
    if (!this.finish) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.finish.setSize(size.x, size.y);
  }

  /** The window changed size. */
  resize(): void {
    this.setPixelRatio();
    this.resizeAo();
  }

  /** Centres the sun's shadow map on where the camera looks (ray traced only). */
  private followSun(): void {
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld();
    // A little ahead of the camera, on the ground: what is in view.
    const ahead = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (ahead.lengthSq() > 1e-6) ahead.normalize().multiplyScalar(TRACED_SUN_REACH * 0.5);
    const focus = this.camera.getWorldPosition(new THREE.Vector3()).add(ahead);
    focus.setY(this.ground(focus.x, focus.z));
    focus.applyMatrix4(cam.matrixWorldInverse);
    // Moved a whole texel at a time, so the edges do not crawl as the camera moves.
    const texel = (2 * TRACED_SUN_REACH) / this.sun.shadow.mapSize.x;
    const x = Math.round(focus.x / texel) * texel;
    const y = Math.round(focus.y / texel) * texel;
    if (cam.left === x - TRACED_SUN_REACH && cam.bottom === y - TRACED_SUN_REACH) return;
    Object.assign(cam, {
      left: x - TRACED_SUN_REACH,
      right: x + TRACED_SUN_REACH,
      bottom: y - TRACED_SUN_REACH,
      top: y + TRACED_SUN_REACH,
    });
    cam.updateProjectionMatrix();
  }

  render(): void {
    const r = this.renderer;
    STYLE_TIME.value = performance.now() / 1000;
    if (tracing) this.followSun();
    // With bloom on, the frame is drawn into a buffer and finished on its way to the screen.
    const target = this.finish?.target ?? null;
    r.setRenderTarget(target);
    if (!this.ao) {
      r.render(this.scene, this.camera);
      this.finish?.render(r, null);
      return;
    }
    // The occlusion is worked out from a depth and normal image of the scene drawn as if all
    // solid. Glows, halos, light pools, glass and shadow-only boxes are not: they would show up
    // as black squares and slabs. Nor is what is tagged `NO_AO`.
    const hidden: THREE.Object3D[] = [];
    const visit = (o: THREE.Object3D) => {
      if (!o.visible) return;
      if (
        o instanceof THREE.Sprite ||
        (o instanceof THREE.Mesh && !solid(o.material)) ||
        o.userData[NO_AO]
      ) {
        hidden.push(o);
        return;
      }
      for (const c of o.children) visit(c);
    };
    visit(this.scene);
    // The camera's range changes with the map (the build editor's is set to the build).
    this.ao.material.uniforms.cameraNear!.value = this.camera.near;
    this.ao.material.uniforms.cameraFar!.value = this.camera.far;
    r.render(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    this.ao.pass.render(r, null as never, null as never, 0, false);
    for (const o of hidden) o.visible = true;
    if (this.finish) {
      // Laid on as the frame is finished: see `Finish.render`.
      const ao: FinishAo = {
        ao: this.ao.pass.pdRenderTarget.texture,
        depth: this.ao.pass.depthTexture,
        near: this.camera.near,
        far: this.camera.far,
        fadeFrom: AO_FADE.from,
        fadeTo: AO_FADE.to,
      };
      this.finish.render(r, ao);
      return;
    }
    r.setRenderTarget(target);
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
