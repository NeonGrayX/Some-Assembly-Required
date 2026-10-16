import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Surface, madeOf } from '../render/styles.ts';
import url from './assets/pirate-assets.glb?url';

/**
 * The pirate assets modelled in Blender (the galleon, the tavern and the shop, the cannon,
 * barrels, palms, rocks and the rest), each one baked to a colour, a normal and a
 * roughness-metalness texture of its own and exported together as one .glb (see `scripts/bake-pirate-assets.py`). Each sits on its
 * origin with its front toward +z.
 */

export const ASSETS = [
  'Barrel',
  'Bottle',
  'Boulder',
  'Bush',
  'Cannon',
  'CliffRocks',
  'Flag',
  'Lantern',
  'PalmTree',
  'PirateShip',
  'RedBush',
  'Rock',
  'RopeBridge',
  'RopeCoil',
  'RopeFence',
  'Sack',
  'Shack',
  'ShipBell',
  'Sign',
  'Tavern',
] as const;
export type AssetName = (typeof ASSETS)[number];

/** How brightly lit windows and lantern glass glow by day. */
const GLOW = 0.6;
/**
 * How much leaves glow with their own colour: the sun shines through them in the picture, so
 * even their shade is a bright yellow-green.
 */
const LEAF_GLOW = 0.15;
const LEAVES: AssetName[] = ['Bush', 'RedBush', 'PalmTree'];
/**
 * How rough everything is against its modelled roughness: a little glossier, so the sun leaves
 * highlights along wood, iron and leaves as in the picture.
 */
const GLOSS = 0.7;
/** How much more metal than modelled some are: the cannon's iron, which shines. */
const METAL: Partial<Record<AssetName, number>> = { Cannon: 1.0 };
/**
 * How much lighter the cannon's iron is drawn than modelled, and how light at most: gunmetal
 * grey, not near black.
 */
const IRON = { lift: 3.6, most: 0.3 };

/** `m` with its metal parts (the cannon's iron) drawn a neutral grey, lighter (see `IRON`). */
function gunmetal(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = function (shader, renderer) {
    THREE.Material.prototype.onBeforeCompile.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
      float grey = min( dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) * ${IRON.lift.toFixed(2)}, ${IRON.most.toFixed(2)} );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( grey ), smoothstep( 0.05, 0.15, metalnessFactor ) );`,
    );
  };
  m.customProgramCacheKey = function () {
    return `${THREE.Material.prototype.customProgramCacheKey.call(this)}|gunmetal`;
  };
}

/**
 * Each asset's paint, lighter than baked, so they sit together under the map's light as the
 * picture's do: its rocks a pale warm grey.
 */
const TINT: Partial<Record<AssetName, [number, number, number]>> = {
  CliffRocks: [1.5, 1.48, 1.44],
  Boulder: [1.4, 1.38, 1.34],
  Rock: [1.4, 1.38, 1.34],
};

export class PirateAssets {
  constructor(private readonly models: Map<AssetName, THREE.Object3D>) {}

  /** The space `name` takes, round its origin, unturned and unscaled. */
  box(name: AssetName): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.models.get(name)!);
  }

  /**
   * A copy of `name` in `parent`, its origin at (`x`, `y`, `z`), turned `yaw` about y and
   * scaled by `scale`.
   */
  place(
    parent: THREE.Object3D,
    name: AssetName,
    x: number,
    y: number,
    z: number,
    yaw = 0,
    scale = 1,
  ): THREE.Object3D {
    const model = this.models.get(name)!.clone();
    model.position.set(x, y, z);
    model.rotation.set(0, yaw, 0);
    model.scale.setScalar(scale);
    parent.add(model);
    return model;
  }
}

/** Reads the assets' .glb, each asset under its own name. */
export async function loadPirateAssets(): Promise<PirateAssets> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const models = new Map<AssetName, THREE.Object3D>();
  for (const node of [...gltf.scene.children]) {
    // Blender names a copy "Barrel.001", which three.js reads as "Barrel001".
    const name = ASSETS.find((n) => node.name === n || node.name.startsWith(n));
    if (!name || models.has(name)) continue;
    node.position.set(0, 0, 0);
    node.rotation.set(0, 0, 0);
    node.scale.set(1, 1, 1);
    node.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = o.receiveShadow = true;
      const m = o.material as THREE.MeshStandardMaterial;
      const tint = TINT[name];
      if (tint) m.color.setRGB(...tint);
      // The textures' roughness and metalness, scaled.
      m.roughness *= GLOSS;
      if (m.metalnessMap) m.metalness = METAL[name] ?? 1;
      if (name === 'Cannon') gunmetal(m);
      if (m.name.endsWith('_glow')) {
        m.emissive.set(0xffffff);
        m.emissiveMap = m.map;
        m.emissiveIntensity = GLOW;
        o.castShadow = false;
      } else if (LEAVES.includes(name)) {
        m.emissive.set(0xffffff);
        m.emissiveMap = m.map;
        m.emissiveIntensity = LEAF_GLOW;
      } else if (m.name.endsWith('_glass')) {
        m.transparent = true;
        m.opacity = 0.8;
      }
      // Their textures are their paint: the game's own painted style leaves them as they are.
      madeOf(m, Surface.None);
    });
    models.set(name, node);
  }
  return new PirateAssets(models);
}
