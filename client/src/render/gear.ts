import * as THREE from 'three';
import { GEAR_SIZE } from '@sar/shared';
import type { GearId } from '@sar/shared';
import type { Avatar } from './avatar.ts';

/*
 * The gear of a gear hunt: what a piece looks like lying about, and how it is worn on the
 * builder. Everything is procedural like the rest of the avatar, so no assets are needed.
 */

const mat = (
  color: number,
  roughness = 0.6,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

const STEEL = 0xb8bec4;
const BRASS = 0xc9a227;
const YELLOW = 0xf5c518;
const RED_LENS = 0xd33a2c;
const STRAP = 0x23252a;
const ROPE = 0xc8a46a;

const shadowed = (m: THREE.Mesh) => {
  m.castShadow = true;
  return m;
};

/** Goggles: two round lenses on a band, red so they read as "colour" from afar. */
function goggles(): THREE.Group {
  const g = new THREE.Group();
  const lens = mat(RED_LENS, 0.2, { transparent: true, opacity: 0.85 });
  const rim = mat(BRASS, 0.4);
  for (const side of [-1, 1]) {
    const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 16), rim));
    ring.position.set(side * 0.06, 0, 0);
    g.add(ring);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.042, 16), lens);
    glass.position.set(side * 0.06, 0, 0.002);
    g.add(glass);
  }
  const bridge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.012), rim));
  g.add(bridge);
  return g;
}

/** A pair of boots with yellow steel toe caps. */
function boots(): THREE.Group {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const boot = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.2), mat(0x4a3222)));
    boot.position.set(side * 0.07, 0, 0);
    g.add(boot);
    const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.06, 0.06), mat(YELLOW)));
    cap.position.set(side * 0.07, -0.01, -0.075);
    g.add(cap);
  }
  return g;
}

/** A headlamp: a short lamp on a strap, its glass facing -z. */
function headlamp(lit: boolean): THREE.Group {
  const g = new THREE.Group();
  const body = shadowed(
    new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), mat(STRAP)),
  );
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.03, 16),
    new THREE.MeshStandardMaterial({
      color: 0xfff6d6,
      emissive: 0xfff2c0,
      emissiveIntensity: lit ? 3 : 0.3,
      roughness: 0.3,
    }),
  );
  glass.position.z = -0.026;
  glass.rotation.y = Math.PI;
  g.add(glass);
  return g;
}

/** A ring of keys. */
function keys(): THREE.Group {
  const g = new THREE.Group();
  const ring = shadowed(
    new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 8, 16), mat(STEEL, 0.35)),
  );
  g.add(ring);
  for (let i = 0; i < 3; i++) {
    const key = shadowed(
      new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.005), mat(BRASS, 0.4)),
    );
    key.position.set((i - 1) * 0.02, -0.06, 0);
    key.rotation.z = (i - 1) * 0.3;
    g.add(key);
  }
  return g;
}

/** A coiled leash with a clip. */
function leash(): THREE.Group {
  const g = new THREE.Group();
  const coil = shadowed(
    new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.016, 8, 20), mat(ROPE, 0.9)),
  );
  g.add(coil);
  const clip = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.012), mat(STEEL, 0.35)),
  );
  clip.position.set(0.06, 0, 0);
  g.add(clip);
  return g;
}

/** A wide lifting belt with a buckle. */
function brace(r = 0.12): THREE.Group {
  const g = new THREE.Group();
  const band = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.09, 20, 1, true),
      mat(STRAP, 0.8, { side: THREE.DoubleSide }),
    ),
  );
  g.add(band);
  const buckle = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.012), mat(STEEL, 0.35)),
  );
  buckle.position.set(0, 0, -r - 0.006);
  g.add(buckle);
  return g;
}

/** A piece of gear as it lies in the world, centred on its collider (GEAR_SIZE). */
export function makeGearProp(kind: GearId): THREE.Group {
  const g = new THREE.Group();
  let model: THREE.Group;
  switch (kind) {
    case 'goggles':
      model = goggles();
      model.rotation.x = -Math.PI / 2;
      model.position.y = -GEAR_SIZE.y / 2 + 0.02;
      break;
    case 'boots':
      model = boots();
      model.position.y = -GEAR_SIZE.y / 2 + 0.045;
      break;
    case 'headlamp':
      model = headlamp(false);
      model.position.y = -GEAR_SIZE.y / 2 + 0.035;
      break;
    case 'keys':
      model = keys();
      model.rotation.x = -Math.PI / 2;
      model.position.y = -GEAR_SIZE.y / 2 + 0.02;
      break;
    case 'leash':
      model = leash();
      model.rotation.x = -Math.PI / 2;
      model.position.y = -GEAR_SIZE.y / 2 + 0.02;
      break;
    case 'brace':
      model = brace(0.1);
      model.position.y = -GEAR_SIZE.y / 2 + 0.045;
      break;
  }
  g.add(model);
  // A small tag under it, so a piece is spotted from a way off.
  const tag = new THREE.Mesh(
    new THREE.BoxGeometry(GEAR_SIZE.x, 0.01, GEAR_SIZE.z),
    mat(YELLOW, 0.5, { emissive: YELLOW, emissiveIntensity: 0.25 }),
  );
  tag.position.y = -GEAR_SIZE.y / 2;
  tag.receiveShadow = true;
  g.add(tag);
  return g;
}

/** The pole by the dog's kennel that the leash goes on. */
export function makePole(): THREE.Group {
  const g = new THREE.Group();
  const post = shadowed(
    new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 10), mat(0x9a6b43, 0.8)),
  );
  post.position.y = 0.55;
  g.add(post);
  const ring = shadowed(
    new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 8, 16), mat(STEEL, 0.35)),
  );
  ring.position.y = 0.95;
  g.add(ring);
  return g;
}

/** The height on the pole the leash is tied at. */
export const POLE_TIE_HEIGHT = 0.95;

/** The leash's rope between the pole and the dog's collar, redrawn each frame. */
export class LeashLine {
  readonly line: THREE.Line;
  private readonly positions = new Float32Array(3 * 8);

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: ROPE }));
    this.line.frustumCulled = false;
  }

  /** Hangs the rope from `a` to `b` with a little sag. */
  update(a: THREE.Vector3, b: THREE.Vector3): void {
    const n = this.positions.length / 3;
    const sag = Math.min(0.25, a.distanceTo(b) * 0.15);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.positions[i * 3] = a.x + (b.x - a.x) * t;
      this.positions[i * 3 + 1] = a.y + (b.y - a.y) * t - sag * Math.sin(t * Math.PI);
      this.positions[i * 3 + 2] = a.z + (b.z - a.z) * t;
    }
    (this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Worn gear on an avatar: the parts added, so they can be taken off again. */
export interface WornGear {
  parts: THREE.Object3D[];
  /** The headlamp's light, to aim where the player looks. */
  light: THREE.SpotLight | null;
  /**
   * What holds the headlamp's light. It goes in the scene, not on the avatar, and follows the
   * head each frame (`followHead`): the avatar is hidden when the camera comes in close, and a
   * light under a hidden object goes out with it.
   */
  mount: THREE.Object3D | null;
  /** The lamp on the brow, tilted up and down with the beam. */
  lamp: THREE.Object3D | null;
}

/** How far the headlamp's beam reaches and how wide it is, matching the shared reading rule. */
const LAMP_DISTANCE = 9;
const LAMP_ANGLE = (40 * Math.PI) / 180;

/**
 * Puts a piece of gear on the builder: goggles over the eyes, toe caps on the boots, the lamp
 * on the brow (with a real light), keys and the coiled leash on the belt, the brace round the
 * waist. Returns what was added.
 */
export function wearGear(avatar: Avatar, kind: GearId): WornGear {
  const parts: THREE.Object3D[] = [];
  let light: THREE.SpotLight | null = null;
  let mount: THREE.Object3D | null = null;
  let lamp: THREE.Object3D | null = null;
  const put = (parent: THREE.Object3D, o: THREE.Object3D) => {
    parent.add(o);
    parts.push(o);
  };
  switch (kind) {
    case 'goggles': {
      const g = goggles();
      // Over the eyes, on the front of the head (the head's radius is 0.2).
      g.position.set(0, 0.03, -0.19);
      put(avatar.head, g);
      break;
    }
    case 'boots': {
      for (const [i, leg] of avatar.legs.entries()) {
        // A steel cap over the toe of the boot at the end of the leg (see `makeAvatar`), a
        // hair bigger than it: flush, they flicker.
        const toe = leg.getObjectByName('toe');
        if (toe instanceof THREE.Mesh) {
          const cap = shadowed(new THREE.Mesh(toe.geometry.clone(), mat(YELLOW)));
          cap.scale.setScalar(1.08);
          cap.position.y = 0.001;
          put(toe, cap);
        } else {
          const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.07), mat(YELLOW)));
          cap.position.set((i ? 1 : -1) * 0.12, -0.6, -0.1);
          put(avatar.group, cap);
        }
      }
      break;
    }
    case 'headlamp': {
      lamp = headlamp(true);
      lamp.position.set(0, 0.11, -0.18);
      put(avatar.head, lamp);
      light = new THREE.SpotLight(0xfff1c8, 18, LAMP_DISTANCE, LAMP_ANGLE, 0.5, 1.2);
      light.position.set(0, 0.11, -0.2);
      light.target.position.set(0, 0.11, -3);
      light.castShadow = false;
      mount = new THREE.Group();
      mount.matrixAutoUpdate = false;
      mount.add(light, light.target);
      parts.push(mount);
      break;
    }
    // On the outside of the body (its radius is 0.25) and clear of the arms hanging at its
    // sides: they used to sit inside it, out of sight.
    case 'keys': {
      // Hanging from the belt at the front, right of the buckle.
      const k = keys();
      k.position.set(0.12, -0.2, -0.24);
      put(avatar.torso, k);
      break;
    }
    case 'leash': {
      // Coiled on the back of the belt, on the left.
      const l = leash();
      l.position.set(-0.15, -0.25, 0.22);
      put(avatar.torso, l);
      break;
    }
    case 'brace': {
      // Round the waist above the belt, over the shirt and a hi-vis vest.
      const b = brace(0.29);
      b.position.set(0, -0.06, 0);
      put(avatar.torso, b);
      break;
    }
  }
  return { parts, light, mount, lamp };
}

const _at = new THREE.Vector3();
const _aim = new THREE.Quaternion();
const _look = new THREE.Euler(0, 0, 0, 'YXZ');
const _one = new THREE.Vector3(1, 1, 1);

/**
 * Puts worn gear's light at the avatar's head, shining the way the player looks (up and down
 * too, as the shared reading rule has it), and tilts the lamp on the brow to match. Call after
 * posing the avatar.
 */
export function followHead(
  worn: WornGear,
  avatar: Avatar,
  yaw: number,
  pitch: number,
  on: boolean,
): void {
  if (!worn.mount) return;
  worn.mount.visible = on;
  avatar.head.getWorldPosition(_at);
  _aim.setFromEuler(_look.set(pitch, yaw, 0));
  worn.mount.matrix.compose(_at, _aim, _one);
  worn.mount.matrixWorldNeedsUpdate = true;
  if (worn.lamp) worn.lamp.rotation.x = pitch - avatar.head.rotation.x;
}

export function removeGear(worn: WornGear): void {
  for (const o of worn.parts) o.removeFromParent();
  for (const o of worn.parts) {
    o.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    });
  }
  worn.light?.dispose();
}
