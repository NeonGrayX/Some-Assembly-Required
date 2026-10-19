import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Intent } from '../testmap/walk.ts';

/**
 * Walking about the car test map against the models themselves, as the game's players walk: a
 * capsule moved by the physics engine's character controller, sliding along and stepping up onto
 * the very triangles the models are drawn with (the cars' wheels, mirrors and bumpers, a cone's
 * foot, a chair's legs, each step of a stair). What swings or slides (the vehicles' doors and
 * lids, the houses' doors) is a collider of its own that goes with it, so an open door can be
 * walked in through and a shut one cannot.
 *
 * Holding on into a gap narrower than their shoulders but wider than they are deep, the player
 * turns side-on and edges through it, and turns back once their shoulders are clear.
 */

/**
 * The player: the radius of the capsule they walk as, their height, how far their shoulders reach
 * out to each side (wider than the capsule: their arms hang outside it), and how deep they are
 * side-on, chest to back (half of it).
 */
export const RADIUS = 0.32;
export const HEIGHT = 1.75;
export const SHOULDER = 0.37;
export const SLIM = 0.17;
/** How far before and behind them a gap's sides are looked for (m). */
const REACH = 0.3;
/** How high they step up without jumping (m). */
const STEP = 0.45;
const GRAVITY = 15;
const JUMP = 6.2;
const WALK = 4.2;
const RUN = 7.5;
/** How fast they edge along side-on (m/s). */
const EDGE = 1.4;
/** The gap the controller keeps between the player and what they touch. */
const OFFSET = 0.02;

/** The colliders the player walks into, and the player's own, which nothing else meets. */
const WORLD = 0x0001;
const PLAYER = 0x0002;
const AGAINST_WORLD = (PLAYER << 16) | WORLD;

/** Whether `o` is not to be walked into: only light (a cone's hologram), or a decal on the ground. */
export function intangible(o: THREE.Object3D): boolean {
  if (o.name === 'hologram' || !o.visible) return true;
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh) return false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.every((m) => !m.depthWrite);
}

/**
 * The triangles of `o` and what hangs from it, in `frame`'s space (the world if null), but for
 * what `skip` says to leave out (and all that hangs from it).
 */
function triangles(
  o: THREE.Object3D,
  frame: THREE.Matrix4 | null,
  skip: (o: THREE.Object3D) => boolean,
): { vertices: Float32Array; indices: Uint32Array } {
  const meshes: THREE.Mesh[] = [];
  const take = (node: THREE.Object3D, top: boolean) => {
    if ((!top && skip(node)) || intangible(node)) return;
    if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
    for (const c of node.children) take(c, false);
  };
  take(o, true);
  let [nv, ni] = [0, 0];
  for (const mesh of meshes) {
    const count = mesh.geometry.attributes.position!.count;
    nv += count;
    ni += mesh.geometry.index?.count ?? count;
  }
  const vertices = new Float32Array(nv * 3);
  const indices = new Uint32Array(ni);
  const m = new THREE.Matrix4();
  let [v, k] = [0, 0];
  for (const mesh of meshes) {
    m.copy(mesh.matrixWorld);
    if (frame) m.premultiply(frame);
    const e = m.elements;
    const pos = mesh.geometry.attributes.position!;
    const base = v;
    for (let i = 0; i < pos.count; i++, v++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      vertices[v * 3] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      vertices[v * 3 + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      vertices[v * 3 + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
    }
    const index = mesh.geometry.index;
    if (index) for (let i = 0; i < index.count; i++) indices[k++] = base + index.getX(i);
    else for (let i = 0; i < pos.count; i++) indices[k++] = base + i;
  }
  return weld(vertices, indices);
}

/** How fine (m) the colliders keep the models' shapes: corners closer than this are one. */
const GRAIN = 0.02;

/**
 * `vertices` snapped to a grid `GRAIN` fine and those that fall together made one, and the
 * triangles that are left with no area (a rounded edge's bevels, mostly) dropped: much the same
 * shape in far fewer triangles.
 */
function weld(
  vertices: Float32Array,
  indices: Uint32Array,
): { vertices: Float32Array; indices: Uint32Array } {
  const at = new Map<number, number>();
  const kept: number[] = [];
  const remap = new Uint32Array(vertices.length / 3);
  // Each corner's grid cell as one number: within 1.3 km of the middle either way, each way.
  const span = 1 << 17;
  for (let i = 0; i < remap.length; i++) {
    const x = Math.round(vertices[i * 3]! / GRAIN);
    const y = Math.round(vertices[i * 3 + 1]! / GRAIN);
    const z = Math.round(vertices[i * 3 + 2]! / GRAIN);
    const key = ((x + span / 2) * span + (y + span / 2)) * span + (z + span / 2);
    let n = at.get(key);
    if (n === undefined) {
      n = kept.length / 3;
      at.set(key, n);
      kept.push(x * GRAIN, y * GRAIN, z * GRAIN);
    }
    remap[i] = n;
  }
  const out = new Uint32Array(indices.length);
  let k = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [remap[indices[t]!]!, remap[indices[t + 1]!]!, remap[indices[t + 2]!]!];
    if (a === b || b === c || a === c) continue;
    out[k++] = a;
    out[k++] = b;
    out[k++] = c;
  }
  return { vertices: new Float32Array(kept), indices: out.slice(0, k) };
}

/** Something that moves, with the collider that goes with it. */
interface Mover {
  node: THREE.Object3D;
  collider: RAPIER.Collider;
  at: THREE.Matrix4;
}

const turnOf = new THREE.Quaternion();
const placeOf = new THREE.Vector3();
const sizeOf = new THREE.Vector3();

const IDENTITY: RAPIER.Rotation = { x: 0, y: 0, z: 0, w: 1 };

/** A quaternion turning `yaw` about the upright. */
function yawRotation(yaw: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export class MeshWalker {
  readonly pos = new THREE.Vector3();
  vy = 0;
  grounded = true;
  /** Which way they face (yaw, facing -z at 0, as the game's avatars do). */
  heading = 0;
  /** While they squeeze through a gap: the way along it (x, z, a unit long), else null. */
  squeeze: { x: number; z: number } | null = null;
  /** How fast they edge along it (m/s), to their right if more than 0. */
  edging = 0;

  private readonly world: RAPIER.World;
  private readonly controller: RAPIER.KinematicCharacterController;
  /**
   * Upright, and side-on: as thin as they are deep (only edging along, never turning in it),
   * flat underfoot so that edging up a step it stands on the step's edge.
   */
  private readonly body: RAPIER.Collider;
  private readonly slim: RAPIER.Collider;
  private readonly movers: Mover[] = [];

  /**
   * `solid` is what stands in the way, as it is drawn, but for what `moves` says moves (which
   * goes with it, wherever it is moved to); the floor is the ground at y = 0, on for good.
   */
  constructor(
    private readonly R: typeof RAPIER,
    solid: THREE.Object3D[],
    moves: (o: THREE.Object3D) => boolean,
  ) {
    const world = new R.World({ x: 0, y: 0, z: 0 });
    this.world = world;
    const groups = (PLAYER << 16) | 0xffff;
    const fixed = (desc: RAPIER.ColliderDesc) =>
      world.createCollider(desc.setCollisionGroups((WORLD << 16) | 0xffff));
    fixed(R.ColliderDesc.cuboid(300, 0.5, 300).setTranslation(0, -0.5, 0));
    for (const o of solid) {
      o.updateWorldMatrix(true, true);
      const { vertices, indices } = triangles(o, null, moves);
      if (indices.length) fixed(R.ColliderDesc.trimesh(vertices, indices));
      o.traverse((m) => {
        if (m === o || !moves(m)) return;
        // Each in its own space, so that it can be put where it has moved to.
        const { vertices, indices } = triangles(
          m,
          this.frame(m).invert(),
          (n) => n !== m && moves(n),
        );
        if (!indices.length) return;
        const collider = fixed(R.ColliderDesc.trimesh(vertices, indices));
        this.movers.push({ node: m, collider, at: new THREE.Matrix4() });
      });
    }
    this.follow();
    const half = HEIGHT / 2;
    this.body = world.createCollider(
      R.ColliderDesc.capsule(half - RADIUS, RADIUS).setCollisionGroups(groups & ~0xffff),
    );
    this.slim = world.createCollider(
      R.ColliderDesc.roundCylinder(half - 0.04, SLIM - 0.04, 0.04).setCollisionGroups(
        groups & ~0xffff,
      ),
    );
    this.controller = world.createCharacterController(OFFSET);
    this.controller.enableSnapToGround(STEP);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);
    world.step();
  }

  /** `o`'s place and turn in the world, without its scale (which its triangles keep). */
  private frame(o: THREE.Object3D): THREE.Matrix4 {
    o.matrixWorld.decompose(placeOf, turnOf, sizeOf);
    return new THREE.Matrix4().compose(placeOf, turnOf, new THREE.Vector3(1, 1, 1));
  }

  /** Puts each moving thing's collider where it now is; whether any had moved. */
  private follow(): boolean {
    let moved = false;
    for (const m of this.movers) {
      m.node.updateWorldMatrix(true, false);
      if (m.at.equals(m.node.matrixWorld)) continue;
      m.at.copy(m.node.matrixWorld);
      m.node.matrixWorld.decompose(placeOf, turnOf, sizeOf);
      m.collider.setTranslation(placeOf);
      m.collider.setRotation(turnOf);
      moved = true;
    }
    return moved;
  }

  /** Where the middle of their capsule is, over feet at `p`. */
  private middle(p: THREE.Vector3): RAPIER.Vector {
    return { x: p.x, y: p.y + HEIGHT / 2 + OFFSET, z: p.z };
  }

  /**
   * Whether they would stand clear of everything at `p`, upright: a little off what they stand
   * on, so that it does not count (nor the floor, which side-on they can sink a little into).
   */
  private room(p: THREE.Vector3): boolean {
    const shape = this.body.shape;
    const at = this.middle(p);
    at.y += 0.05;
    return !this.world.intersectionWithShape(
      at,
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      undefined,
      AGAINST_WORLD,
    );
  }

  /**
   * Moves `c` by `delta` as far as it goes, from feet at `pos`; how far it went. Stepping up no
   * higher than there is room overhead: the controller steps up only where it can rise the whole
   * way, which under a stair's upper flight or a ceiling it could not.
   */
  private move(c: RAPIER.Collider, delta: RAPIER.Vector, from = this.pos): RAPIER.Vector {
    const at = this.middle(from);
    c.setTranslation(at);
    const up = { x: 0, y: 1, z: 0 };
    const over = this.world.castShape(
      at,
      c.rotation(),
      up,
      c.shape,
      0,
      STEP,
      false,
      undefined,
      AGAINST_WORLD,
    );
    const room = over ? over.time_of_impact - 0.01 : STEP;
    this.controller.enableAutostep(Math.max(0.01, Math.min(STEP, room)), 0.1, false);
    this.controller.computeColliderMovement(c, delta, undefined, AGAINST_WORLD);
    return this.controller.computedMovement();
  }

  /**
   * Moves `c` by `delta` (along the ground) up onto what holds it up, if it can: lifted as
   * little of `STEP` as gets it on (so that on a steep stair it is not lifted into the flight
   * over), on, and down onto it. How far it went, and whether it stands at the end; or null if
   * it gets no further on so.
   */
  private climb(c: RAPIER.Collider, delta: RAPIER.Vector): RAPIER.Vector | null {
    const flat = Math.hypot(delta.x, delta.z);
    const q = new THREE.Vector3();
    for (const h of [0.2, 0.32, STEP]) {
      const up = this.move(c, { x: 0, y: h, z: 0 });
      if (up.y < h * 0.5) return null;
      q.set(this.pos.x, this.pos.y + up.y, this.pos.z);
      const on = this.move(c, { x: delta.x, y: 0, z: delta.z }, q);
      if (Math.hypot(on.x, on.z) < flat * 0.5) continue;
      q.x += on.x;
      q.z += on.z;
      const down = this.move(c, { x: 0, y: -up.y - 0.05, z: 0 }, q);
      if (!this.controller.computedGrounded()) continue;
      return { x: on.x, y: up.y + down.y, z: on.z };
    }
    return null;
  }

  /** How far `p` is from the nearest thing solid (the floor too, the player not). */
  clearance(p: THREE.Vector3): number {
    const near = this.world.projectPoint(p, true, undefined, AGAINST_WORLD);
    return near ? Math.hypot(near.point.x - p.x, near.point.y - p.y, near.point.z - p.z) : Infinity;
  }

  /** Whether a ball `radius` round at `p` would touch anything solid (the player aside). */
  touches(p: THREE.Vector3, radius: number): boolean {
    const ball = new this.R.Ball(radius);
    return !!this.world.intersectionWithShape(p, IDENTITY, ball, undefined, AGAINST_WORLD);
  }

  /**
   * How far a ball `radius` round goes from `from` along `dir` (a unit long), up to `far`, before
   * it touches anything solid.
   */
  reach(from: THREE.Vector3, dir: THREE.Vector3, far: number, radius: number): number {
    const ball = new this.R.Ball(radius);
    const hit = this.world.castShape(
      from,
      IDENTITY,
      dir,
      ball,
      0,
      far,
      true,
      undefined,
      AGAINST_WORLD,
    );
    return hit ? hit.time_of_impact : far;
  }

  /** Puts them on whatever stands at (`x`, `z`), no higher than `reach` (2 m if not given). */
  spawn(x: number, z: number, reach = 2): void {
    const top = reach + 0.01;
    const ray = new this.R.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, top + 1, true, undefined, AGAINST_WORLD);
    this.pos.set(x, hit ? top - hit.timeOfImpact : 0, z);
    this.vy = 0;
    this.grounded = true;
    this.squeeze = null;
  }

  update(dt: number, intent: Intent): void {
    if (this.follow()) this.world.step();
    const p = this.pos;
    const want = Math.hypot(intent.x, intent.z);
    if (this.grounded && intent.jump && !this.squeeze) {
      this.vy = JUMP;
      this.grounded = false;
    } else if (this.grounded && this.vy <= 0) this.vy = 0;
    else this.vy -= GRAVITY * dt;
    this.edging = 0;
    const a = this.squeeze;
    const speed = intent.run ? RUN : WALK;
    let along = 0;
    const step = new THREE.Vector3();
    if (a) {
      along = Math.max(-1, Math.min(1, intent.x * a.x + intent.z * a.z));
      step.set(a.x * along * EDGE * dt, this.vy * dt, a.z * along * EDGE * dt);
    } else step.set(intent.x * speed * dt, this.vy * dt, intent.z * speed * dt);
    const c = a ? this.slim : this.body;
    let went = this.move(c, step);
    this.grounded = this.controller.computedGrounded();
    // Held up on the ground: a step up, perhaps, that the controller would not take (it rises a
    // whole step's height to look, too high on a stair as steep as the big house's).
    const flat = Math.hypot(step.x, step.z);
    if (this.grounded && flat > 1e-4 && Math.hypot(went.x, went.z) < flat * 0.9) {
      const up = this.climb(c, step);
      if (up && Math.hypot(up.x, up.z) > Math.hypot(went.x, went.z)) went = up;
      this.grounded = true;
    }
    p.x += went.x;
    p.y += went.y;
    p.z += went.z;
    if (this.grounded && this.vy < 0) this.vy = 0;
    // Bumped their head.
    if (this.vy > 0 && went.y < step.y * 0.5) this.vy = 0;

    if (a) this.edge(a, along, went, dt, want);
    else if (this.grounded && want > 0.5) this.wedged(intent.x / want, intent.z / want);

    // Side-on while squeezing, their right toward the way along the gap.
    if (this.squeeze) this.heading = Math.atan2(-this.squeeze.x, -this.squeeze.z) + Math.PI / 2;
    else if (want > 0.05) this.heading = Math.atan2(-intent.x, -intent.z);
    this.body.setTranslation(this.middle(p));
  }

  /**
   * Whether, standing at `p` and going along (`ux`, `uz`), something is in the way of their
   * shoulders on both sides: between their hips and their head, out past where the capsule
   * keeps them from but within their shoulders' reach, and within `REACH` before or behind
   * them (so that a gap across their way at a slant is found, its sides one before the other);
   * and nothing in the way between (as a wall before them would be, rather than a gap).
   */
  private tight(p: THREE.Vector3, ux: number, uz: number): boolean {
    const turn = yawRotation(Math.atan2(-uz, ux));
    const inner = 0.1;
    const half = (HEIGHT - STEP) / 2;
    const y = p.y + STEP + half;
    const hits = (shape: RAPIER.Shape, out: number) =>
      !!this.world.intersectionWithShape(
        { x: p.x - uz * out, y, z: p.z + ux * out },
        turn,
        shape,
        undefined,
        AGAINST_WORLD,
      );
    const side = this.R.ColliderDesc.cuboid(REACH, half, (SHOULDER - inner) / 2).shape;
    const between = this.R.ColliderDesc.cuboid(REACH, half, inner * 0.8).shape;
    return [-1, 1].every((s) => hits(side, (s * (inner + SHOULDER)) / 2)) && !hits(between, 0);
  }

  /**
   * Going along (`ux`, `uz`) into a gap narrower than their shoulders (held up by it, or only
   * brushing it either side) where side-on they would get on, they turn side-on to squeeze
   * through.
   */
  private wedged(ux: number, uz: number): void {
    const p = this.pos;
    const ahead = new THREE.Vector3(p.x + ux * 0.1, p.y, p.z + uz * 0.1);
    if (!this.tight(ahead, ux, uz)) return;
    const on = this.move(this.slim, new THREE.Vector3(ux * 0.06, 0, uz * 0.06));
    if (on.x * ux + on.z * uz >= 0.03) this.squeeze = { x: ux, z: uz };
  }

  /**
   * Edged `along` the gap (`went` this frame), they turn back to walk on once there is room to
   * stand upright (shouldered a little aside, if need be) and their shoulders are clear, there
   * and a little further on the way they go; or, asking to go off another way, once there is
   * room where they stand.
   */
  private edge(
    a: { x: number; z: number },
    along: number,
    went: RAPIER.Vector,
    dt: number,
    want: number,
  ): void {
    const p = this.pos;
    this.edging = dt > 0 ? (went.x * a.x + went.z * a.z) / dt : 0;
    const q = new THREE.Vector3();
    const room = (s: number) => {
      for (const k of [0, 0.04, -0.04, 0.08, -0.08]) {
        q.set(p.x + a.x * s - a.z * k, p.y, p.z + a.z * s + a.x * k);
        if (this.room(q) && !this.tight(q, a.x, a.z)) return q.clone();
      }
      return null;
    };
    if (Math.abs(along) <= 0.3 && want > 0.5) {
      // Off another way: as soon as they can stand upright.
      for (const k of [0, 0.04, -0.04, 0.08, -0.08]) {
        q.set(p.x - a.z * k, p.y, p.z + a.x * k);
        if (!this.room(q)) continue;
        [p.x, p.z] = [q.x, q.z];
        this.squeeze = null;
        return;
      }
      return;
    }
    const here = room(0);
    if (!here) return;
    const out = Math.abs(along) > 0.3 ? room(Math.sign(along) * 0.1) : room(0.1) && room(-0.1);
    if (!out) return;
    p.x = here.x;
    p.z = here.z;
    this.squeeze = null;
  }
}
