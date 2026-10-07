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

/** Makes `material` mark the stencil buffer wherever it is drawn (see `NO_AO`). */
function markStencil(material: THREE.Material): void {
  if (material.stencilWrite) return;
  material.stencilWrite = true;
  material.stencilRef = 1;
  material.stencilFunc = THREE.AlwaysStencilFunc;
  material.stencilZPass = THREE.ReplaceStencilOp;
}

/** Name of the group of boxes that keep the sun out of the rooms in the shadow map. */
export const ROOM_SHADE = 'roomShade';

/** Ambient occlusion is at full strength up to `from` metres away and gone by `to`. */
const AO_FADE = { from: 6, to: 14 };

/**
 * Set in an object's `userData` to leave it and everything under it out of the ambient
 * occlusion. For what moves on thin legs (players, the dog): worked out from the screen's
 * depth alone, the floor right around a leg looked tucked in behind it, so a dark smudge
 * floated around their feet. Their shadows and a contact shade (see `CONTACT`) ground them.
 */
export const NO_AO = 'noAo';

/**
 * Set in a mesh's `userData` as `{ r, y }` to darken what it rests on: a ball of radius `r`
 * at height `y` in the mesh's own frame (a leg's foot) shades the surfaces right around it.
 * What is left out of the ambient occlusion (see `NO_AO`) still needs that contact shading,
 * or its feet look like they hover; worked out exactly, it stays tight around the foot.
 */
export const CONTACT = 'contact';
/** At most this many feet are shaded (eight players and the dog). */
const MAX_CONTACTS = 24;

const SHADOW_MAP_SIZE = { off: 0, low: 1024, medium: 2048, high: 4096, traced: 4096 } as const;
/**
 * Ray traced, the sun's shadow map only holds what moves, so instead of the whole level it
 * covers this far (in metres, as the sun sees it) around where the camera looks: about ten
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
  /** The sun's shadow over the whole level, as set up for shadow maps. */
  private readonly at = new THREE.Vector3();
  private readonly sunBounds: Pick<THREE.OrthographicCamera, 'left' | 'right' | 'top' | 'bottom'>;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly sun: THREE.DirectionalLight,
  ) {
    const { left, right, top, bottom } = sun.shadow.camera;
    this.sunBounds = { left, right, top, bottom };
  }

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
    // Offsets that keep surfaces from shadowing themselves, at the cost of a gap between
    // a foot and the start of its shadow. Over the whole level's coarse map that was needed;
    // the traced map around the view is fine enough for a gap too small to see.
    this.sun.shadow.bias = traced ? -0.00005 : -0.0005;
    this.sun.shadow.normalBias = traced ? 0.006 : 0.02;
    const lampSize = LAMP_MAP_SIZE[g.shadows];
    this.house?.traverse((o) => {
      if (!(o instanceof THREE.SpotLight) || !o.castShadow || !lampSize) return;
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
        tNormal: { value: pass.normalTexture },
        projectionInverse: { value: new THREE.Matrix4() },
        cameraWorld: { value: new THREE.Matrix4() },
        contacts: { value: new Float32Array(MAX_CONTACTS * 4) },
        contactCount: { value: 0 },
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
        uniform sampler2D tNormal;
        uniform mat4 projectionInverse;
        uniform mat4 cameraWorld;
        uniform vec4 contacts[ ${MAX_CONTACTS} ];
        uniform int contactCount;
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
          ao = mix( 1.0, ao, strength );
          // Contact shading from each foot: how much of the sky a ball at the foot hides from
          // this surface (its solid angle, by how squarely the surface faces it).
          vec4 view = projectionInverse * vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
          vec3 world = ( cameraWorld * vec4( view.xyz / view.w, 1.0 ) ).xyz;
          vec3 normal = normalize( mat3( cameraWorld ) * unpackRGBToNormal( texture2D( tNormal, vUv ).rgb ) );
          float open = 1.0;
          for ( int i = 0; i < ${MAX_CONTACTS}; i ++ ) {
            if ( i >= contactCount ) break;
            vec3 to = contacts[ i ].xyz - world;
            float d = length( to );
            float r = contacts[ i ].w;
            float hidden = max( 0.0, dot( normal, to / d ) ) * r * r / ( d * d );
            // Faded out by four radii, so it ends without a visible edge.
            open *= 1.0 - clamp( hidden, 0.0, 1.0 ) * ( 1.0 - smoothstep( 2.0 * r, 4.0 * r, d ) );
          }
          gl_FragColor = vec4( vec3( ao * open ), 1.0 );
        }`,
      // Multiplies what is on screen by the occlusion, except where something left out of it
      // was drawn (marked in the stencil buffer as it was).
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc,
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

  /** Centres the sun's shadow map on where the camera looks (ray traced only). */
  private followSun(): void {
    const cam = this.sun.shadow.camera;
    cam.position.copy(this.sun.position);
    cam.lookAt(this.sun.target.position);
    cam.updateMatrixWorld();
    // A little ahead of the camera, on the ground: what is in view.
    const ahead = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (ahead.lengthSq() > 1e-6) ahead.normalize().multiplyScalar(TRACED_SUN_REACH * 0.5);
    const focus = this.camera.getWorldPosition(new THREE.Vector3()).add(ahead).setY(0);
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
    if (tracing) this.followSun();
    if (!this.ao) {
      r.render(this.scene, this.camera);
      return;
    }
    // The occlusion is worked out from a depth and normal image of the scene drawn as if all
    // solid. Glows, halos, light pools, glass and shadow-only boxes are not: they would show up
    // as black squares and slabs. What is left out of the occlusion is not drawn there either,
    // and marks where it is drawn in the frame itself, so the occlusion skips it there.
    const hidden: THREE.Object3D[] = [];
    const spheres: number[] = [];
    const visit = (o: THREE.Object3D, left: boolean) => {
      if (!o.visible) return;
      left ||= !!o.userData[NO_AO];
      if (left && o instanceof THREE.Mesh) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) markStencil(m);
      }
      const contact = o.userData[CONTACT] as { r: number; y: number } | undefined;
      if (contact && spheres.length < MAX_CONTACTS * 4) {
        const c = this.at.set(0, contact.y, 0).applyMatrix4(o.matrixWorld);
        spheres.push(c.x, c.y, c.z, contact.r);
      }
      if (
        (left && o !== this.scene) ||
        o instanceof THREE.Sprite ||
        (o instanceof THREE.Mesh && !solid(o.material))
      ) {
        hidden.push(o);
        if (!left) return;
      }
      for (const c of o.children) visit(c, left);
    };
    visit(this.scene, false);
    r.render(this.scene, this.camera);
    for (const o of hidden) o.visible = false;
    this.ao.pass.render(r, null as never, null as never, 0, false);
    for (const o of hidden) o.visible = true;
    const u = this.ao.material.uniforms;
    (u.contacts!.value as Float32Array).fill(0).set(spheres);
    u.contactCount!.value = spheres.length / 4;
    u.projectionInverse!.value.copy(this.camera.projectionMatrixInverse);
    u.cameraWorld!.value.copy(this.camera.matrixWorld);
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
