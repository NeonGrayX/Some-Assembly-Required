import * as THREE from 'three';
import { does } from '../hints.ts';
import type { Hint } from '../hints.ts';
import type { Aim } from './works.ts';

/**
 * The vehicles' doors, bonnets and boots, each cut out of its body and hung on a hinge: a door at
 * its front edge (the off-roader's tailgate at its side), a bonnet or a boot lid along its edge by
 * the windscreen or the tail; or, as the bus's, run on a rail, sliding (see `rail`). A click on
 * one swings or slides it open, another shuts it.
 */

/** What a door's hinge is named: kept apart from the baking, so it can swing. */
export const CAR_DOOR = 'car door';

/**
 * How far a door has got open (0 shut, 1 open), and which way it is going: shared by the leaves of
 * a door that open together. Each hinge's `userData.open` is how far it turns, about its axis
 * (`userData.axis`: the upright, or across the car for a lid); a sliding door's (axis `slide`)
 * `userData.out` and `userData.along` how far it moves, first out and then along.
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

/** What of `outline` lies to the right of the upright at `x` if `right`, else to its left. */
export function clipX(outline: THREE.Vector2[], x: number, right: boolean): THREE.Vector2[] {
  const inside = (p: THREE.Vector2) => (right ? p.x >= x : p.x <= x);
  const out: THREE.Vector2[] = [];
  for (const [i, p] of outline.entries()) {
    const q = outline[(i + 1) % outline.length]!;
    if (inside(p)) out.push(p.clone());
    if (inside(p) !== inside(q)) out.push(p.clone().lerp(q, (x - p.x) / (q.x - p.x)));
  }
  return out;
}

/** How high `outline` is over `x`: its highest crossing of the upright there. */
export function topOf(outline: THREE.Vector2[], x: number): number {
  return crossing(outline, x, true).p.y;
}

/**
 * A lid cut off the top of `outline` (a slab's, bevelled `bevel`) over `floor` (a line across it
 * from left to right): its top where the slab's is, `thick` deep under that. Returns the lid, and
 * the outline left with the well under it.
 */
export function lidOff(
  outline: THREE.Vector2[],
  floor: THREE.Vector2[],
  thick: number,
  bevel: number,
): { lid: THREE.Vector2[]; rest: THREE.Vector2[] } {
  const { piece } = notch(outline, floor, true);
  // The piece's top, from end to end along the outline: all but the floor it was cut over.
  const top = piece.slice(0, piece.length - floor.length);
  if (top[0]!.x > top[top.length - 1]!.x) top.reverse();
  for (const p of top) p.y += bevel;
  const under = top.map((p) => new THREE.Vector2(p.x, p.y - thick)).reverse();
  return { lid: [...top, ...under], rest: notch(outline, widen(floor, bevel, true), true).rest };
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

/** What a hinge turns about: the upright (a door), or across the car (a bonnet or a boot lid). */
export type HingeAxis = 'y' | 'z';
/** How much of its way a sliding door spends standing out from the body before it runs along. */
const OUT = 0.3;

/**
 * Hangs a door on `car` on a hinge through `at`, turning by `open` about `axis` to open, as `swing`
 * goes (its own, unless it opens with another). Returns the door, to build in the car's own frame.
 */
export function hang(
  car: THREE.Object3D,
  at: THREE.Vector3,
  open: number,
  axis: HingeAxis = 'y',
  swing: Swing = { t: 0, shut: true },
): THREE.Group {
  const hinge = new THREE.Group();
  hinge.name = CAR_DOOR;
  hinge.position.copy(at);
  hinge.userData.open = open;
  hinge.userData.axis = axis;
  hinge.userData.swing = swing;
  car.add(hinge);
  const door = new THREE.Group();
  door.position.copy(at).negate();
  hinge.add(door);
  return door;
}

/**
 * Runs a sliding door on `car`: opening, it stands out by `out` from where it is shut, then runs
 * on by `along`, as `swing` goes (its own, unless it opens with another). Returns the door, to
 * build in the car's own frame.
 */
export function rail(
  car: THREE.Object3D,
  out: THREE.Vector3,
  along: THREE.Vector3,
  swing: Swing = { t: 0, shut: true },
): THREE.Group {
  const runner = new THREE.Group();
  runner.name = CAR_DOOR;
  runner.userData.axis = 'slide';
  runner.userData.out = out;
  runner.userData.along = along;
  runner.userData.swing = swing;
  car.add(runner);
  const door = new THREE.Group();
  runner.add(door);
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

/**
 * The houses' doors under `root` slid open, and the bus's `bus`: as a game of the car scene has
 * them, nothing in its houses shutting them.
 */
export function openForGame(root: THREE.Object3D, bus: THREE.Object3D): void {
  root.traverse((o) => {
    const slide = o.userData.slide as number | undefined;
    if (o.name === 'door' && slide !== undefined) o.position.x += slide;
  });
  const busDoors = doorsIn(bus).filter((d) => d.userData.axis === 'slide');
  for (const d of busDoors) (d.userData.swing as Swing).shut = false;
  new CarDoors(busDoors).update(1, null);
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
      if (d.userData.axis === 'slide') {
        const { out, along } = d.userData as { out: THREE.Vector3; along: THREE.Vector3 };
        d.position
          .copy(out)
          .multiplyScalar(THREE.MathUtils.smootherstep(t, 0, OUT))
          .addScaledVector(along, THREE.MathUtils.smootherstep(t, OUT, 1));
        continue;
      }
      const turn = (d.userData.open as number) * THREE.MathUtils.smootherstep(t, 0, 1);
      d.rotation[d.userData.axis as HingeAxis] = turn;
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
    const what = (this.aimed.userData.what as string | undefined) ?? 'door';
    return [does('use', `${s.shut ? 'open' : 'shut'} the ${what}`)];
  }
}
