import * as THREE from 'three';
import type { MeshWalker } from './meshWalk.ts';
import { insidePart } from './walk.ts';
import type { CarWalk } from './walk.ts';

/**
 * Where the following camera on the car test map may sit. It stays out on its boom whatever is
 * between it and the player (a lamp, a sign, the inspector's arch, a car), and comes in only
 * where it would itself be in something: a model's own triangles, a part of a prop, or one of
 * the coarse boxes of what is solid right through (a car, a machine, a house's wall). Two things it never sees
 * through: a floor or a ceiling, and a house's (or the bus's) walls, windows and doorways, so
 * that it stays inside with a player who is inside, and outside with one who is outside.
 */

/** How near the camera may come to anything before it clips (m). */
export const CLEAR = 0.2;
/** The nearest the camera comes in behind the player's head (m). */
const NEAR = 0.5;
/** How far it comes in at a time to get clear of a model's triangles (m). */
const STEP_IN = 0.05;

export interface FollowCamera {
  /** How far back along `dir` from `from` (the player's head) the camera can sit, up to `far`. */
  back(from: THREE.Vector3, dir: THREE.Vector3, far: number): number;
  /** How far along `dir` from `from` there is room, up to `far`. */
  side(from: THREE.Vector3, dir: THREE.Vector3, far: number): number;
}

export function followCamera(walk: CarWalk, walker: MeshWalker): FollowCamera {
  /**
   * Each box in its own axes (turned only about the upright, so distances hold): as it is, and
   * grown by how near the camera may come. A `slab` (a floor, a ceiling, a pavement) is never
   * looked through, however far past it the camera would come out.
   */
  const blocks = walk.camera.children.map((m) => {
    const mesh = m as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const solid = mesh.geometry.boundingBox!.clone();
    const size = solid.getSize(new THREE.Vector3());
    return {
      toLocal: mesh.matrixWorld.clone().invert(),
      solid,
      box: solid.clone().expandByScalar(CLEAR),
      slab: Math.min(size.x, size.z) >= 1.5 && size.y <= 0.6,
    };
  });
  /** The houses' rooms and the bus's cabin, each a box in its own axes. */
  const rooms = walk.rooms.map((r) => ({
    toLocal: r.frame.matrixWorld.clone().invert(),
    box: r.box,
  }));
  const local = new THREE.Ray();
  const point = new THREE.Vector3();
  const at = new THREE.Vector3();

  /**
   * How far the camera may go along `dir` from `from` for the rooms: from inside one, never out
   * through its doorway or a window; from outside, never in through them. Infinity if no room is
   * in the way.
   */
  function roomsAllow(from: THREE.Vector3, dir: THREE.Vector3): number {
    let d = Infinity;
    for (const r of rooms) {
      local.origin.copy(from).applyMatrix4(r.toLocal);
      local.direction.copy(dir).transformDirection(r.toLocal);
      if (!local.intersectBox(r.box, point)) continue;
      // Inside, the line's way out of the room; outside, its way in.
      d = Math.min(d, point.distanceTo(local.origin) - 0.25);
    }
    return d;
  }

  /** Where the line from `from` along `dir` goes into `box` of `b`, if it does from outside it. */
  function into(
    b: (typeof blocks)[number],
    box: THREE.Box3,
    from: THREE.Vector3,
    dir: THREE.Vector3,
  ): number {
    local.origin.copy(from).applyMatrix4(b.toLocal);
    if (box.containsPoint(local.origin)) return Infinity;
    local.direction.copy(dir).transformDirection(b.toLocal);
    return local.intersectBox(box, point) ? point.distanceTo(local.origin) : Infinity;
  }

  /** The box `p` is in that the line from `from` along `dir` goes into, and where; or null. */
  function inBlock(p: THREE.Vector3, from: THREE.Vector3, dir: THREE.Vector3): number | null {
    for (const b of blocks) {
      if (!b.box.containsPoint(local.origin.copy(p).applyMatrix4(b.toLocal))) continue;
      const t = into(b, b.box, from, dir);
      // The player stands in its margin (a ceiling close over them): it is not in the way.
      if (t !== Infinity) return t;
    }
    return null;
  }

  return {
    back(from, dir, far) {
      // Above the floor, wherever on it; never past a floor or a ceiling, nor through a room's
      // walls either way.
      let d = dir.y < 0 ? Math.min(far, (from.y - CLEAR - 0.02) / -dir.y) : far;
      d = Math.min(d, roomsAllow(from, dir));
      for (const b of blocks) if (b.slab) d = Math.min(d, into(b, b.solid, from, dir) - 0.3);
      d = Math.max(NEAR, d);
      // Clear of the models' triangles by as much as the player's head is, up to `CLEAR`: a
      // head right under a ceiling does not keep the camera in.
      const radius = Math.min(CLEAR, walker.clearance(from) * 0.9);
      for (let pass = 0; pass < 200 && d > NEAR; pass++) {
        at.copy(from).addScaledVector(dir, d);
        // In something solid right through: just short of where the line goes into it.
        const t = inBlock(at, from, dir);
        if (t !== null) {
          d = Math.max(NEAR, t - 0.05);
          continue;
        }
        // In a prop, or in among a model's own triangles: in, till it is clear of them.
        const clips =
          walk.props.some((part) => insidePart(part, at)) ||
          (radius >= 0.02 && walker.touches(at, radius));
        if (!clips) break;
        d = Math.max(NEAR, d - STEP_IN);
      }
      return d;
    },
    side(from, dir, far) {
      let d = Math.min(far, roomsAllow(from, dir));
      for (const b of blocks) d = Math.min(d, into(b, b.solid, from, dir) - CLEAR);
      d = Math.min(d, walker.reach(from, dir, Math.max(0, d), CLEAR));
      return Math.max(0, d);
    },
  };
}
