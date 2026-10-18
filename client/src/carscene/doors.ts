import * as THREE from 'three';
import { does } from '../hints.ts';
import type { Hint } from '../hints.ts';
import type { Aim } from './works.ts';

/**
 * The vehicles' doors, each cut out of its body and hung on a hinge at its front edge (or, the
 * bus's leaves, at their outer edges): a click on one swings it open, another shuts it.
 */

/** What a door's hinge is named: kept apart from the baking, so it can swing. */
export const CAR_DOOR = 'car door';

/**
 * How far a door has got open (0 shut, 1 open), and which way it is going: shared by the leaves of
 * a door that open together. Each hinge's `userData.open` is how far it turns, about the upright.
 */
export interface Swing {
  t: number;
  shut: boolean;
}

/** How long a door takes to swing open or shut, in seconds. */
const SWING_TIME = 0.6;
/** How far from the camera's line past the player's head a door can be clicked, in metres. */
const REACH = 2.6;

/** `shape`'s outline as points, without the one closing it. */
export function outlinePoints(shape: THREE.Shape): THREE.Vector2[] {
  return shape.getPoints(12).filter((p, i, all) => p.distanceTo(all[(i + 1) % all.length]!) > 1e-6);
}

/**
 * Where `outline` crosses the upright at `x`: the highest crossing if `up`, else the lowest, with
 * where along the outline it is (its edge's index, and how far along that edge).
 */
function crossing(outline: THREE.Vector2[], x: number, up: boolean) {
  const n = outline.length;
  let best: { s: number; p: THREE.Vector2 } | null = null;
  for (let i = 0; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    if (a.x < x === b.x < x) continue;
    const t = (x - a.x) / (b.x - a.x);
    const p = new THREE.Vector2(x, a.y + (b.y - a.y) * t);
    if (!best || (up ? p.y > best.p.y : p.y < best.p.y)) best = { s: i + t, p };
  }
  if (!best) throw new Error(`no crossing at x = ${x}`);
  return best;
}

/**
 * Splits `outline` along `edge`, a line across it from left to right: the piece of it beyond the
 * edge (above it if `up`, else below it) between the uprights at the edge's ends, and the rest of
 * it, notched where the piece was. Each upright crosses the outline once beyond the edge.
 */
export function notch(
  outline: THREE.Vector2[],
  edge: THREE.Vector2[],
  up: boolean,
): { rest: THREE.Vector2[]; piece: THREE.Vector2[] } {
  const n = outline.length;
  const [x0, x1] = [edge[0]!.x, edge[edge.length - 1]!.x];
  const a = crossing(outline, x0, up);
  const b = crossing(outline, x1, up);
  // The outline's points from `a` on round to `b`, and from `b` round to `a`.
  const since = (s: number, from: number) => (s - from + n) % n;
  const ab: THREE.Vector2[] = [];
  const ba: THREE.Vector2[] = [];
  const order = outline
    .map((p, k) => ({ p, d: since(k, a.s) }))
    .filter(({ d }) => d > 0)
    .sort((u, v) => u.d - v.d);
  for (const { p, d } of order) (d < since(b.s, a.s) ? ab : ba).push(p.clone());
  const within = (ps: THREE.Vector2[]) => ps.every((p) => p.x > x0 - 1e-6 && p.x < x1 + 1e-6);
  const back = edge.slice().reverse();
  if (within(ab)) return { piece: [a.p, ...ab, b.p, ...back], rest: [b.p, ...ba, a.p, ...edge] };
  return { piece: [b.p, ...ba, a.p, ...edge], rest: [a.p, ...ab, b.p, ...back] };
}

/**
 * `edge` moved `by` away from the piece it cuts (down if that is above it, else up), its ends out
 * `by` either way: where to notch a slab bevelled `by`, so the notch's edges come out on `edge`.
 */
export function widen(edge: THREE.Vector2[], by: number, up: boolean): THREE.Vector2[] {
  const last = edge.length - 1;
  return edge.map(
    (p, i) => new THREE.Vector2(p.x + (i === 0 ? -by : i === last ? by : 0), p.y + (up ? -by : by)),
  );
}

/**
 * Hangs a door on `car` on a hinge upright through (`x`, `z`), turning by `open` about it to open,
 * as `swing` goes (its own, unless it opens with another). Returns the door, to build in the car's
 * own frame.
 */
export function hang(
  car: THREE.Object3D,
  x: number,
  z: number,
  open: number,
  swing: Swing = { t: 0, shut: true },
): THREE.Group {
  const hinge = new THREE.Group();
  hinge.name = CAR_DOOR;
  hinge.position.set(x, 0, z);
  hinge.userData.open = open;
  hinge.userData.swing = swing;
  car.add(hinge);
  const door = new THREE.Group();
  door.position.set(-x, 0, -z);
  hinge.add(door);
  return door;
}

/** Every door's hinge under `root`. */
export function doorsIn(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === CAR_DOOR) found.push(o);
  });
  return found;
}

/** The vehicles' doors, swinging, and the one the crosshair is on. */
export class CarDoors {
  /** The door's hinge the crosshair is on: what a click opens or shuts. */
  aimed: THREE.Object3D | null = null;
  private readonly ray = new THREE.Raycaster();

  constructor(readonly doors: THREE.Object3D[]) {}

  /** Swings each door on toward open or shut, and aims where the camera looks. */
  update(dt: number, aim: Aim | null): void {
    const step = dt / SWING_TIME;
    for (const s of new Set(this.doors.map((d) => d.userData.swing as Swing)))
      s.t = s.shut ? Math.max(0, s.t - step) : Math.min(1, s.t + step);
    for (const d of this.doors) {
      const { t } = d.userData.swing as Swing;
      d.rotation.y = (d.userData.open as number) * THREE.MathUtils.smootherstep(t, 0, 1);
    }
    this.aimed = aim ? this.aimFrom(aim) : null;
  }

  /** The door on the camera's line from just before the player's head, within reach. */
  private aimFrom({ camera, head }: Aim): THREE.Object3D | null {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const skip = Math.max(0, head.clone().sub(camera.position).dot(dir) - 0.4);
    this.ray.set(camera.position.clone().addScaledVector(dir, skip), dir);
    this.ray.far = REACH;
    let o: THREE.Object3D | null = this.ray.intersectObjects(this.doors, true)[0]?.object ?? null;
    while (o && o.name !== CAR_DOOR) o = o.parent;
    return o;
  }

  /** A click: opens the door aimed at, or shuts it. Whether there was one. */
  click(): boolean {
    if (!this.aimed) return false;
    const s = this.aimed.userData.swing as Swing;
    s.shut = !s.shut;
    return true;
  }

  /** What a click would do. */
  hint(): Hint {
    if (!this.aimed) return [];
    const s = this.aimed.userData.swing as Swing;
    return [does('use', s.shut ? 'open the door' : 'shut the door')];
  }
}
