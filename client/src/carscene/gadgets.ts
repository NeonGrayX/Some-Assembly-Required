import * as THREE from 'three';
import { does } from '../hints.ts';
import type { Hint } from '../hints.ts';
import type { Aim } from './works.ts';

/**
 * What can be used on the car test map besides the vehicles' doors and the brick works: the
 * houses' cupboards, fridges and wardrobes, their taps, hobs, lamps and screens, the letterboxes,
 * the street's crossing and bins, the site's power cabinet and portaloo, and the rest. Each is a
 * `Gadget` hung on its model where it is built (see `addGadget`); a click on it while the
 * crosshair is on it, within reach and in sight, uses it, and it moves as it does (a door
 * swinging, a lamp coming on, the crossing's lights changing).
 *
 * A part that moves or changes as it is used is named `MOVING`: kept out of the baking, so it can
 * move, and walked against as a collider of its own that goes with it (an open cupboard's door
 * stands in the way, a shut one's leaves the room before it).
 */

/** What a part that moves is named (see above). */
export const MOVING = 'moving';

/** The sounds gadgets make (see `Sfx`). */
export type Noise =
  | 'click'
  | 'button'
  | 'beep'
  | 'bell'
  | 'ready'
  | 'thump'
  | 'clunk'
  | 'splash'
  | 'powerOut'
  | 'powerOn'
  | 'lampOn'
  | 'lampOff'
  | 'tapOn'
  | 'tapOff'
  | 'hobOn'
  | 'hobOff'
  | 'screenOn'
  | 'screenOff'
  | 'chargeOn'
  | 'chargeOff'
  | 'valveOpen'
  | 'valveShut'
  | 'doorOpen'
  | 'doorShut'
  | 'lidOpen'
  | 'lidShut'
  | 'hatchOpen'
  | 'hatchShut';

/**
 * Where the gadgets' sounds go, each made at a place in the map: the map hands them to its sound
 * effects, quieter the further off they are. Silent until then (as in the tests).
 */
export const hearing: { play: (noise: Noise, at: THREE.Vector3) => void } = {
  play: () => {},
};

/** Plays `noise` at where `o` is. */
export function sound(noise: Noise, o: THREE.Object3D): void {
  hearing.play(noise, o.getWorldPosition(new THREE.Vector3()));
}

/** How far from the camera's line past the player's head a gadget can be used, in metres. */
const REACH = 2.6;

export interface Gadget {
  /** The parts aimed at to use it, each aimed at within its bounds. */
  readonly handles: THREE.Object3D[];
  /** What a click on it does now, or null if nothing. */
  hint(): string | null;
  /** A click on it. */
  use(): void;
  /** `dt` seconds on, the player standing at `who` (null if no one is about). */
  update(dt: number, who: THREE.Vector3 | null): void;
}

/** Hangs `gadget` on `o`, for `gadgetsIn` to find. Returns it. */
export function addGadget<G extends Gadget>(o: THREE.Object3D, gadget: G): G {
  ((o.userData.gadgets ??= []) as Gadget[]).push(gadget);
  return gadget;
}

/** Every gadget hung under `root`. */
export function gadgetsIn(root: THREE.Object3D): Gadget[] {
  const found: Gadget[] = [];
  root.traverse((o) => {
    if (o.userData.gadgets) found.push(...(o.userData.gadgets as Gadget[]));
  });
  return found;
}

/**
 * Something with two states, a click turning it from one to the other over `time` seconds: a
 * door open or shut, a lamp on or off. `pose` shows it `k` of the way from the first to the
 * second (eased), every step, so it can keep moving while it is on (water running); `says` is
 * what a click does from each.
 */
export class Toggle implements Gadget {
  /** Where it is going: true to its second state. */
  on: boolean;
  /** How far it has got there (0 to 1). */
  t: number;
  /** Where the player was at the last step (null if no one is about). */
  who: THREE.Vector3 | null = null;
  /** What a click on it sounds like from each state, as `says` says what it does (none if null). */
  noise: [Noise | null, Noise | null] = ['click', 'click'];

  constructor(
    readonly handles: THREE.Object3D[],
    private readonly says: readonly [string, string],
    private readonly pose: (k: number, dt: number) => void,
    private readonly time = 0.6,
    on = false,
  ) {
    this.on = on;
    this.t = on ? 1 : 0;
    pose(this.t, 0);
  }

  hint(): string {
    return this.says[this.on ? 1 : 0];
  }

  use(): void {
    const noise = this.noise[this.on ? 1 : 0];
    this.on = !this.on;
    if (noise && this.handles[0]) sound(noise, this.handles[0]);
  }

  update(dt: number, who: THREE.Vector3 | null = null): void {
    this.who = who;
    const step = this.time > 0 ? dt / this.time : 1;
    this.t = this.on ? Math.min(1, this.t + step) : Math.max(0, this.t - step);
    this.pose(THREE.MathUtils.smootherstep(this.t, 0, 1), dt);
  }
}

/**
 * Something pressed, that does what it does for a while after: a button going in and out, a
 * bell ringing, a beacon flashing. `pose` shows it `since` seconds after it was last pressed
 * (Infinity before it ever is); `says` is what a click does.
 */
export class Press implements Gadget {
  since = Infinity;

  constructor(
    readonly handles: THREE.Object3D[],
    private readonly says: string,
    private readonly pose: (since: number, dt: number) => void,
    private readonly noise: Noise = 'button',
  ) {
    pose(this.since, 0);
  }

  hint(): string {
    return this.says;
  }

  use(): void {
    this.since = 0;
    if (this.handles[0]) sound(this.noise, this.handles[0]);
  }

  update(dt: number): void {
    this.since += dt;
    this.pose(this.since, dt);
  }
}

/**
 * Something that goes on by itself, used or not (a signal changing, a screen counting down):
 * `tick` is called every step with the seconds since the map began. No handles: nothing to
 * click.
 */
export class Clockwork implements Gadget {
  readonly handles: THREE.Object3D[] = [];
  private time = 0;

  constructor(private readonly tick: (time: number, dt: number) => void) {
    tick(0, 0);
  }

  hint(): null {
    return null;
  }

  use(): void {}

  update(dt: number): void {
    this.time += dt;
    this.tick(this.time, dt);
  }
}

/**
 * Marks `o` as fed by the map's mains (the power cabinet's switch, see `powerCabinet`): `set`
 * shows it with the power on (1) or off (0), or on its way between (flickering on).
 */
export function powered(o: THREE.Object3D, set: (k: number) => void): void {
  ((o.userData.powered ??= []) as ((k: number) => void)[]).push(set);
}

/** Everything under `root` fed by the mains. */
export function poweredIn(root: THREE.Object3D): ((k: number) => void)[] {
  const found: ((k: number) => void)[] = [];
  root.traverse((o) => {
    if (o.userData.powered) found.push(...(o.userData.powered as ((k: number) => void)[]));
  });
  return found;
}

/** What a hinge turns about, in its parent's axes. */
export type Axis = 'x' | 'y' | 'z';

/**
 * A part of `parent` that moves: a group named `MOVING` at `at`, and in it a group to build the
 * part in, in `parent`'s own axes (so it can be built where it stands, and turn or slide about
 * `at`). Returns both: the pivot to move, the leaf to build in.
 */
export function pivot(
  parent: THREE.Object3D,
  at: THREE.Vector3,
): { pivot: THREE.Group; leaf: THREE.Group } {
  const p = new THREE.Group();
  p.name = MOVING;
  p.position.copy(at);
  parent.add(p);
  const leaf = new THREE.Group();
  leaf.position.copy(at).negate();
  p.add(leaf);
  return { pivot: p, leaf };
}

/**
 * A door, a lid or a flap of `parent` on a hinge through `at` about `axis`, turning `open`
 * radians to open, built by `build` in `parent`'s axes; a click on it opens it and another shuts
 * it, `what` saying what it is. Returns the toggle, to hang more on.
 */
export function hingedDoor(
  parent: THREE.Object3D,
  what: string,
  at: THREE.Vector3,
  axis: Axis,
  open: number,
  build: (leaf: THREE.Group) => void,
  also?: (k: number, dt: number) => void,
): Toggle {
  const { pivot: p, leaf } = pivot(parent, at);
  build(leaf);
  const door = addGadget(
    parent,
    new Toggle([p], [`open the ${what}`, `shut the ${what}`], (k, dt) => {
      p.rotation[axis] = open * k;
      also?.(k, dt);
    }),
  );
  door.noise = ['doorOpen', 'doorShut'];
  return door;
}

/**
 * A lamp's glowing parts, which can be turned down: each of `materials` (one of the kit's shared
 * glows, which this copies, so that it turns down alone) set `k` of the way from off (a tenth of
 * its glow) to on. Returns the copies, to put on the lamp's parts, and the setter.
 */
export function dimmable<T extends THREE.MeshStandardMaterial[]>(
  ...materials: [...T]
): { mats: [...T]; set: (k: number) => void } {
  const mats = materials.map((m) => m.clone()) as [...T];
  const full = mats.map((m) => m.emissiveIntensity);
  return {
    mats,
    set: (k) => mats.forEach((m, i) => (m.emissiveIntensity = full[i]! * (0.03 + 0.97 * k))),
  };
}

/**
 * A signal's lens in `colour`, which can be lit and put out: lit (1) it glows `full`; dark (0)
 * it shows its colour faintly, as an unlit lens does. Returns it and the setter.
 */
export function signalLens(
  colour: number,
  full = 3,
): { mat: THREE.MeshStandardMaterial; set: (k: number) => void } {
  const m = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, roughness: 0.3 });
  const c = new THREE.Color(colour);
  return {
    mat: m,
    set: (k) => {
      m.color.copy(c).multiplyScalar(0.15 + 0.85 * k);
      m.emissiveIntensity = full * k;
    },
  };
}

/** Running water, falling or spraying: pale blue, see-through, glowing a little, never solid. */
export function waterMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xb8e6f4,
    emissive: 0x3d86b5,
    emissiveIntensity: 0.35,
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
}

/** How far along a ray it goes clear of the map (Infinity if all the way): what hides a gadget. */
export type Sight = (from: THREE.Vector3, dir: THREE.Vector3, far: number) => number;

/** The map's gadgets, working, and the one the crosshair is on. */
export class Gadgets {
  /** The gadget the crosshair is on: what a click uses. */
  aimed: Gadget | null = null;
  /** Each handle's bounds in its own axes, a little grown so that thin ones can be aimed at. */
  private readonly aims: { gadget: Gadget; node: THREE.Object3D; box: THREE.Box3 }[] = [];
  private readonly ray = new THREE.Ray();
  private readonly toLocal = new THREE.Matrix4();
  private readonly hit = new THREE.Vector3();

  /** Built before the scene is baked: the handles' bounds come from their meshes. */
  constructor(
    readonly list: Gadget[],
    private readonly sight: Sight = () => Infinity,
  ) {
    for (const gadget of list)
      for (const node of gadget.handles) {
        node.updateWorldMatrix(true, true);
        const toNode = node.matrixWorld.clone().invert();
        const box = new THREE.Box3();
        const m = new THREE.Matrix4();
        node.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.visible) return;
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          m.multiplyMatrices(toNode, mesh.matrixWorld);
          box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m));
        });
        if (box.isEmpty()) continue;
        // At least a few centimetres every way, a button as much as a door.
        const size = box.getSize(new THREE.Vector3());
        const grow = new THREE.Vector3(
          Math.max(0.01, (0.08 - size.x) / 2),
          Math.max(0.01, (0.08 - size.y) / 2),
          Math.max(0.01, (0.08 - size.z) / 2),
        );
        box.expandByVector(grow);
        this.aims.push({ gadget, node, box });
      }
  }

  /** Each gadget `dt` seconds on, the player at `who`, and aims where the camera looks. */
  update(dt: number, aim: Aim | null, who: THREE.Vector3 | null = null): void {
    for (const g of this.list) g.update(dt, who);
    this.aimed = aim ? this.aimFrom(aim) : null;
  }

  /**
   * The gadget on the camera's line from just before the player's head, within reach, nearest
   * first, and nothing of the map before it.
   */
  private aimFrom({ camera, head }: Aim): Gadget | null {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const skip = Math.max(0, head.clone().sub(camera.position).dot(dir) - 0.4);
    const from = camera.position.clone().addScaledVector(dir, skip);
    let best: Gadget | null = null;
    let near = REACH;
    for (const a of this.aims) {
      this.toLocal.copy(a.node.matrixWorld).invert();
      this.ray.origin.copy(from).applyMatrix4(this.toLocal);
      this.ray.direction.copy(dir).transformDirection(this.toLocal);
      if (!this.ray.intersectBox(a.box, this.hit)) continue;
      // Back in the world's measure (the handle's axes may be scaled).
      const d = this.hit.applyMatrix4(a.node.matrixWorld).distanceTo(from);
      if (d < near && a.gadget.hint() !== null) [best, near] = [a.gadget, d];
    }
    // Its surface lies inside its bounds: anything nearer than where the line goes into them
    // is in front of it (a wall, another thing).
    if (best && this.sight(from, dir, near) < near - 0.03) return null;
    return best;
  }

  /** A click: uses the gadget aimed at. Whether there was one. */
  click(): boolean {
    if (!this.aimed) return false;
    this.aimed.use();
    return true;
  }

  /** What a click would do. */
  hint(): Hint {
    const says = this.aimed?.hint();
    return says ? [does('use', says)] : [];
  }
}
