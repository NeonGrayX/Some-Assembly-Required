import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Surface, madeOf } from '../render/styles.ts';
import url from './assets/pirate-assets.glb?url';

/**
 * The pirate assets modelled in Blender (the galleon, the tavern and the shop, the cannon,
 * barrels, palms, rocks and the rest), each one baked to a colour and a normal texture of its
 * own and exported together as one .glb (see `scripts/bake-pirate-assets.py`). Each sits on its
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
 * Each asset's paint, darker or lighter than baked, so they sit together under the map's light
 * as the picture's do: its wood a deeper, greyer brown and its rocks paler.
 */
const TINT: Partial<Record<AssetName, [number, number, number]>> = {
  Tavern: [0.72, 0.64, 0.6],
  Shack: [0.72, 0.64, 0.6],
  PirateShip: [0.8, 0.7, 0.64],
  Cannon: [0.85, 0.8, 0.78],
  Barrel: [0.8, 0.72, 0.68],
  RopeBridge: [0.8, 0.72, 0.68],
  RopeFence: [0.8, 0.72, 0.68],
  Sign: [0.8, 0.72, 0.68],
  CliffRocks: [1.45, 1.42, 1.38],
  Boulder: [1.35, 1.32, 1.28],
  Rock: [1.35, 1.32, 1.28],
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
      if (m.name.endsWith('_glow')) {
        m.emissive.set(0xffffff);
        m.emissiveMap = m.map;
        m.emissiveIntensity = GLOW;
        o.castShadow = false;
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
