import * as THREE from 'three';
import { GEAR_SIZE } from '@sar/shared';
import type { GearId } from '@sar/shared';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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

/**
 * Goggles: two round lenses in rubber cups with brass rims, red so they read as "colour" from
 * afar, on an elastic strap: lying about, the strap loops out behind them; worn, it goes round
 * the head (`headRadius`).
 */
function goggles(headRadius = 0): THREE.Group {
  const g = new THREE.Group();
  const lens = mat(RED_LENS, 0.15, { transparent: true, opacity: 0.85 });
  const rim = mat(BRASS, 0.35, { metalness: 0.6 });
  const rubber = mat(STRAP, 0.85, { side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const cup = shadowed(
      new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.052, 0.03, 18, 1, true), rubber),
    );
    cup.rotation.x = Math.PI / 2;
    cup.position.set(side * 0.06, 0, 0.012);
    g.add(cup);
    const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 8, 18), rim));
    ring.position.set(side * 0.06, 0, 0);
    g.add(ring);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.042, 18), lens);
    glass.position.set(side * 0.06, 0, 0.002);
    g.add(glass);
  }
  const bridge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.012), rim));
  g.add(bridge);
  // The strap: worn, round the head behind them; lying about, a flat loop off one side.
  const r = headRadius || 0.075;
  const strap = shadowed(new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 4, 28), rubber));
  if (headRadius) {
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 1, 3);
    strap.position.z = headRadius - 0.015;
  } else {
    strap.scale.set(1.4, 0.8, 3);
    strap.position.y = -0.045 - r * 0.8;
  }
  g.add(strap);
  return g;
}

/** One work boot: a ridged rubber sole, the leather foot and ankle, laces and a steel toe cap. */
function boot(): THREE.Group {
  const g = new THREE.Group();
  const leather = mat(0x4a3222, 0.7);
  const sole = shadowed(
    new THREE.Mesh(new RoundedBoxGeometry(0.105, 0.025, 0.21, 2, 0.01), mat(0x1d1d1f, 0.9)),
  );
  sole.position.y = -0.0325;
  const foot = shadowed(
    new THREE.Mesh(new RoundedBoxGeometry(0.095, 0.05, 0.19, 2, 0.02), leather),
  );
  foot.position.set(0, -0.0, 0.0);
  const ankle = shadowed(
    new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.09, 0.09, 2, 0.02), leather),
  );
  ankle.position.set(0, 0.045, 0.05);
  const collar = shadowed(
    new THREE.Mesh(new RoundedBoxGeometry(0.096, 0.02, 0.096, 2, 0.008), mat(0x2b1d14, 0.8)),
  );
  collar.position.set(0, 0.09, 0.05);
  const cap = shadowed(
    new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1.2),
      mat(YELLOW, 0.45),
    ),
  );
  cap.position.set(0, -0.022, -0.05);
  g.add(sole, foot, ankle, collar, cap);
  // Laces up the front of the foot and ankle.
  const lace = mat(0xd9c9a0, 0.9);
  for (let k = 0; k < 4; k++) {
    const l = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.006, 0.008), lace));
    l.position.set(0, 0.022 + k * 0.022, 0.003 - (k > 1 ? 0 : 0.03 - k * 0.012));
    l.rotation.x = k > 1 ? 0 : -0.5;
    if (k > 1) l.position.z = 0.0045 - 0.0005;
    g.add(l);
  }
  return g;
}

/** A pair of work boots with yellow steel toe caps. */
function boots(): THREE.Group {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const b = boot();
    b.position.set(side * 0.07, 0, 0);
    b.rotation.y = side * 0.08;
    g.add(b);
  }
  return g;
}

/**
 * A headlamp: a lamp in a housing with a ridged bezel, its glass facing -z, on a hinge plate;
 * lying about, its elastic strap loops out behind it.
 */
function headlamp(lit: boolean, strap = false): THREE.Group {
  const g = new THREE.Group();
  const black = mat(STRAP, 0.6);
  const body = shadowed(new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.06, 0.05, 2, 0.015), black));
  g.add(body);
  const bezel = shadowed(
    new THREE.Mesh(
      // Open at the front, round the lens sunk into it.
      new THREE.CylinderGeometry(0.03, 0.032, 0.012, 16, 1, true),
      mat(STEEL, 0.35, { metalness: 0.7, side: THREE.DoubleSide }),
    ),
  );
  bezel.rotation.x = Math.PI / 2;
  bezel.position.z = -0.028;
  g.add(bezel);
  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.025, 16),
    new THREE.MeshStandardMaterial({
      color: 0xfff6d6,
      emissive: 0xfff2c0,
      emissiveIntensity: lit ? 3 : 0.3,
      roughness: 0.3,
    }),
  );
  glass.position.z = -0.031;
  glass.rotation.y = Math.PI;
  g.add(glass);
  const button = shadowed(
    new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 10), mat(RED_LENS, 0.4)),
  );
  button.position.set(0.02, 0.032, 0);
  g.add(button);
  if (strap) {
    const band = shadowed(
      new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.006, 4, 24).scale(1, 1, 3),
        mat(0x2f5fa8, 0.85),
      ),
    );
    band.rotation.x = Math.PI / 2;
    band.position.z = 0.1;
    g.add(band);
  }
  return g;
}

/** A ring of keys: three keys with toothed blades, and a leather fob. */
function keys(): THREE.Group {
  const g = new THREE.Group();
  const ring = shadowed(
    new THREE.Mesh(
      new THREE.TorusGeometry(0.04, 0.005, 8, 20),
      mat(STEEL, 0.3, { metalness: 0.8 }),
    ),
  );
  g.add(ring);
  const metals = [BRASS, STEEL, 0xa7713a];
  for (let i = 0; i < 3; i++) {
    const key = new THREE.Group();
    const m = mat(metals[i]!, 0.35, { metalness: 0.7 });
    const bow = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.005, 14), m));
    bow.rotation.x = Math.PI / 2;
    const blade = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.004), m));
    blade.position.y = -0.04;
    key.add(bow, blade);
    for (let t = 0; t < 3; t++) {
      const tooth = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.007, 0.004), m));
      tooth.position.set(0.008, -0.03 - t * 0.012, 0);
      key.add(tooth);
    }
    key.position.set((i - 1) * 0.024, -0.05, (i - 1) * 0.001);
    key.rotation.z = (i - 1) * 0.35;
    g.add(key);
  }
  const fob = shadowed(
    new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.05, 0.006, 2, 0.004), mat(0x7a3b1c, 0.7)),
  );
  fob.position.set(0.045, -0.035, 0.004);
  fob.rotation.z = -0.6;
  g.add(fob);
  return g;
}

/** A leash: the rope coiled in loops, its hand loop, and the snap clip. */
function leash(): THREE.Group {
  const g = new THREE.Group();
  const rope = mat(ROPE, 0.9);
  for (let k = 0; k < 3; k++) {
    const coil = shadowed(
      new THREE.Mesh(new THREE.TorusGeometry(0.058 - k * 0.004, 0.009, 6, 22), rope),
    );
    coil.position.set(k * 0.004, k * 0.003, k * 0.012 - 0.012);
    coil.rotation.set(0.12 * (k - 1), 0.1 * (k - 1), 0);
    g.add(coil);
  }
  const loop = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 16), rope));
  loop.position.set(-0.075, 0.02, 0);
  loop.scale.set(1, 1.5, 1);
  g.add(loop);
  const steel = mat(STEEL, 0.3, { metalness: 0.8 });
  const hook = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 8), steel));
  hook.rotation.z = Math.PI / 2;
  hook.position.set(0.08, 0, 0);
  const eye = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, 6, 12), steel));
  eye.position.set(0.105, 0, 0);
  g.add(hook, eye);
  return g;
}

/** A wide lifting belt with a buckle, stitched along both edges. */
function brace(r = 0.12): THREE.Group {
  const g = new THREE.Group();
  const band = shadowed(
    new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.09, 20, 1, true),
      mat(STRAP, 0.8, { side: THREE.DoubleSide }),
    ),
  );
  g.add(band);
  // The stitching, just outside the band near each edge, front and back (where the arms hang at
  // its sides, it would be in their way).
  const thread = mat(YELLOW, 0.7, { side: THREE.DoubleSide });
  const arc = (Math.PI * 5) / 9;
  for (const y of [-0.035, 0.035]) {
    for (const from of [Math.PI - arc / 2, -arc / 2]) {
      const seam = new THREE.Mesh(
        new THREE.CylinderGeometry(r + 0.002, r + 0.002, 0.004, 10, 1, true, from, arc),
        thread,
      );
      seam.position.y = y;
      g.add(seam);
    }
  }
  const buckle = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.008), mat(STEEL, 0.3, { metalness: 0.7 })),
  );
  buckle.position.set(0, 0, -r - 0.004);
  // The strap's end through it, kept flat so a carrying arm still clears it.
  const pin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.02, 0.004), mat(STRAP, 0.8)));
  pin.position.set(0, 0, -r - 0.01);
  g.add(buckle, pin);
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
      model = headlamp(false, true);
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
  /** The headlamp's light, shining out of the lamp on the brow. */
  light: THREE.SpotLight | null;
  /** The lamp on the brow, tilted up and down to shine where the player looks. */
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
  let lamp: THREE.Object3D | null = null;
  const put = (parent: THREE.Object3D, o: THREE.Object3D) => {
    parent.add(o);
    parts.push(o);
  };
  switch (kind) {
    case 'goggles': {
      // Over the eyes, on the front of the head (the head's radius is 0.2), the strap round it.
      const g = goggles(0.205);
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
      // Out of its glass, straight ahead.
      light = new THREE.SpotLight(0xfff1c8, 18, LAMP_DISTANCE, LAMP_ANGLE, 0.5, 1.2);
      light.position.set(0, 0, -0.03);
      light.target.position.set(0, 0, -3);
      light.castShadow = false;
      lamp.add(light, light.target);
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
  return { parts, light, lamp };
}

/**
 * Tilts the headlamp on the brow to shine where the player looks, up and down too, as the shared
 * reading rule has it. Call after posing the avatar.
 */
export function aimHeadlamp(worn: WornGear, avatar: Avatar, pitch: number): void {
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
