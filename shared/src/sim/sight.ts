import type { Collider } from '@dimforge/rapier3d-compat';
import { machineOutputs, outputSlots, indoors } from '../content/house.ts';
import type { OutputSlot } from '../content/house.ts';
import { IDENTITY, add, conj, dot, length, rotate, scale, sub, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import { viewDir, REACH } from './body.ts';
import type { Sim, PlayerInput, Player, ColliderOwner, AimHit, ViewAsk } from './sim.ts';

/**
 * How far past where the aim meets a machine it may still find a thing lying in the machine's
 * output area (m), seen through the opening in the machine's front (`OutputSlot.mouth`):
 * enough to see to the back of the press's bay from in front and above.
 */
const OUTPUT_SEE_THROUGH = 0.35;
/** How far round the edge of an output area's opening the aim may pass, for its bevelled lip. */
const MOUTH_SLACK = 0.035;
// Camera (shared so the server can reproduce the client's aim ray)
export const CAMERA_DISTANCE = 2.6;
export const CAMERA_SHOULDER = 0.75;
export const CAMERA_LIFT = 0.3;
/** How near the camera's lens reaches round it (m): anything nearer it would cut through. */
const CAMERA_LENS = 0.1;
/** Camera position for a player, before any wall clipping the client may add. */
export function cameraPosition(
  eye: Vec3,
  input: Pick<PlayerInput, 'yaw' | 'pitch' | 'firstPerson'>,
): Vec3 {
  if (input.firstPerson) return eye;
  const dir = viewDir(input.yaw, input.pitch);
  const right = v3(Math.cos(input.yaw), 0, -Math.sin(input.yaw));
  return add(
    add(eye, scale(dir, -CAMERA_DISTANCE)),
    add(scale(right, CAMERA_SHOULDER), v3(0, CAMERA_LIFT, 0)),
  );
}

/**
 * What a player sees and aims at: the camera behind them (kept out of walls and floors), the
 * line of sight from it, and what the crosshair finds there (a brick, a machine, its output, a
 * gadget behind glass). The server works out the same aim as the client from the same input.
 * Part of the `Sim`.
 */
export class Sight {
  constructor(private readonly sim: Sim) {}

  /**
   * Where the player's camera is: behind their shoulder, pulled in where it would be in
   * something (see `sightline`). Aiming starts here, so clicks land on the crosshair.
   */
  camera(p: Player, eye: Vec3 = this.sim.eye(p), input: PlayerInput = p.input): Vec3 {
    return this.sightline(p, eye, cameraPosition(eye, input));
  }

  /**
   * Where on the way from `from` (somewhere the player sees from, like their eyes) to `to` a
   * camera can sit. It stays out at `to` whatever is between it and the player (a post, a
   * lamp, a machine), and comes in only where it would itself be in something: then to just
   * short of where the line goes into that. Two things it never sees through: the ground, a
   * floor or a ceiling; and the walls and windows between a building's inside and the outside,
   * so that it stays in with a player who is in, and out with one who is out. With a `radius`
   * the camera also keeps that much clear of what it would be in, so it slides along a surface
   * it approaches instead of jumping the moment it touches; the client's camera uses that to
   * ease in and out gently. Players, the dog and anything the sim does not own (a client's
   * ragdolls) are never in the way.
   */
  sightline(p: Player, from: Vec3, to: Vec3, radius = 0): Vec3 {
    const offset = sub(to, from);
    const dist = length(offset);
    if (dist < 1e-3) return to;
    const dir = scale(offset, 1 / dist);
    const held = p.holding ? this.sim.assemblies.get(p.holding.assemblyId)?.body : undefined;
    const flags = this.sim.R.QueryFilterFlags.EXCLUDE_SENSORS;
    const blocks = (c: Collider) => {
      const o = this.sim.owners.get(c.handle);
      return o !== undefined && o.kind !== 'player' && o.kind !== 'dog';
    };
    const ray = new this.sim.R.Ray(from, dir);
    /**
     * How far along the line the camera keeps out of what `only` picks, up to `far`: clear of
     * it by `radius` if it can be, else not looking through it; `far` if the line does not
     * meet it, and 0 if it starts in it.
     */
    const short = (far: number, only: (c: Collider) => boolean): number => {
      if (radius > 0) {
        const ball = new this.sim.R.Ball(radius);
        const hit = this.sim.world.castShape(
          from,
          IDENTITY,
          dir,
          ball,
          0,
          far,
          true,
          flags,
          undefined,
          p.collider,
          held,
          only,
        );
        if (!hit) return far;
        // Already touching it at the start (a low ceiling right over the head): there is no
        // clearance to keep, so settle for not looking through it.
        if (hit.time_of_impact > 0) return hit.time_of_impact;
      }
      const hit = this.sim.world.castRay(ray, far, true, flags, undefined, p.collider, held, only);
      if (!hit) return far;
      return hit.timeOfImpact > 0 ? hit.timeOfImpact - 0.15 : 0;
    };
    const least = Math.min(0.2, dist);
    // Never under the ground, a floor or a ceiling, nor across between indoors and out.
    let d = short(dist, (c) => blocks(c) && this.sim.floors.has(c.handle));
    d = Math.max(least, Math.min(d, this.sameSide(from, dir, d) - 0.15));
    // In something: in to where the line goes into it, and so on till it is clear.
    const lens = new this.sim.R.Ball(Math.max(radius, CAMERA_LENS));
    for (let pass = 0; pass < 8 && d > least; pass++) {
      const at = add(from, scale(dir, d));
      const hit = this.sim.world.intersectionWithShape(
        at,
        IDENTITY,
        lens,
        flags,
        undefined,
        p.collider,
        held,
        blocks,
      );
      if (!hit) break;
      const into = short(d, (c) => c.handle === hit.handle);
      // The player is in it themselves (a low ceiling right over the head): not in the way.
      if (into <= 0) break;
      d = Math.max(least, Math.min(into, d - 0.02));
    }
    return d >= dist ? to : add(from, scale(dir, d));
  }

  /**
   * How far along `dir` from `from` the line stays indoors if `from` is indoors, or out if it is
   * out (`indoors`): where it first crosses over, up to `far`; Infinity if it never does.
   */
  private sameSide(from: Vec3, dir: Vec3, far: number): number {
    const start = indoors(this.sim.level, from);
    const crossings: number[] = [];
    for (const { rect, y0, y1 } of this.sim.level.interiors) {
      let [t0, t1] = [0, far];
      for (const [o, d, lo, hi] of [
        [from.x, dir.x, rect.x0, rect.x1],
        [from.y, dir.y, y0, y1],
        [from.z, dir.z, rect.z0, rect.z1],
      ] as const) {
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) t0 = Infinity;
          continue;
        }
        const [a, b] = [(lo - o) / d, (hi - o) / d];
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
      }
      if (t0 <= t1) crossings.push(t0, t1);
    }
    crossings.sort((a, b) => a - b);
    for (const t of crossings)
      if (t > 0 && t < far && indoors(this.sim.level, add(from, scale(dir, t + 1e-4))) !== start)
        return t;
    return Infinity;
  }

  /** What the player is aiming at, within reach (or would aim at with the view `ask`). */
  aim(p: Player, ask?: ViewAsk): AimHit | null {
    const { origin, dir, skip } = this.aimRay(p, ask);
    const heldId = p.holding?.assemblyId;
    const hit = this.sim.world.castRayAndGetNormal(
      new this.sim.R.Ray(origin, dir),
      REACH + 0.4,
      true,
      undefined,
      undefined,
      p.collider,
      undefined,
      (c) => {
        const o = this.sim.owners.get(c.handle);
        // Not the brick in hand, nor anything the sim does not own (a client's ragdolls), nor
        // an empty place in an output area (switched off, but only from the next step).
        if (o?.kind === 'output') return !!this.sim.machines.get(o.machineId)?.out[o.slot];
        return o !== undefined && !(o.kind === 'brick' && o.assemblyId === heldId);
      },
    );
    if (!hit) return null;
    const owner = this.sim.owners.get(hit.collider.handle) ?? { kind: 'static' as const };
    const seen =
      owner.kind === 'machine' || owner.kind === 'output'
        ? this.seenOutput(owner, origin, dir, hit.timeOfImpact)
        : owner.kind === 'static'
          ? this.buriedGadget(hit.collider, origin, dir)
          : null;
    const at = seen ?? { owner, toi: hit.timeOfImpact, normal: hit.normal };
    return {
      point: add(origin, scale(dir, at.toi)),
      normal: at.normal,
      distance: skip + at.toi,
      owner: at.owner,
    };
  }

  /**
   * A handle of the scenery's (see `GadgetDef`) inside the box the ray from `origin` met, which
   * it goes on to: a level's boxes are rough, a tap's or a hob's taking in the counter it is on,
   * but the handle is drawn on the counter's top, in plain sight. The nearest, if any.
   */
  private buriedGadget(
    box: Collider,
    origin: Vec3,
    dir: Vec3,
  ): { owner: ColliderOwner; toi: number; normal: Vec3 } | null {
    let best: { owner: ColliderOwner; toi: number; normal: Vec3 } | null = null;
    const ray = new this.sim.R.Ray(origin, dir);
    for (const g of this.sim.gadgets.values()) {
      for (const c of g.handles) {
        if (!box.containsPoint(c.translation())) continue;
        const toi = c.castRay(ray, REACH + 0.4, true);
        if (toi < 0 || (best && toi >= best.toi)) continue;
        best = { owner: { kind: 'gadget', gadgetId: g.def.id }, toi, normal: scale(dir, -1) };
      }
    }
    return best;
  }

  /**
   * Of what lies in a machine's output area, the thing a ray that met the machine (or a place
   * in its output area) `toi` along was aimed at, if any. The places sit in the machine's front,
   * behind the face of its collider, which is a plain box: the press's bay is a recess in its
   * bed, the silo's grate stands between its legs. So a ray on its way to a thing seen there
   * can meet the box first; and the press's places are side by side, so a slanting ray can
   * cross a corner of the next one first. A place counts if the ray met it, or goes in through
   * its opening and reaches it within `OUTPUT_SEE_THROUGH` past where it met the machine; of
   * those, the one whose thing lies nearest the ray in there.
   */
  private seenOutput(
    owner: { kind: 'machine' | 'output'; machineId: number; slot?: number },
    origin: Vec3,
    dir: Vec3,
    toi: number,
  ): { owner: ColliderOwner; toi: number; normal: Vec3 } | null {
    const { machineId } = owner;
    const m = this.sim.machines.get(machineId);
    const clicks = this.sim.outputColliders.get(machineId);
    if (!m || !clicks || m.out.every((x) => x === null)) return null;
    const ray = new this.sim.R.Ray(origin, dir);
    const places = machineOutputs(m.def);
    const slots = outputSlots(m.def.kind, m.def.size);
    // The ray in the machine's own frame, to find where it crosses the machine's front.
    const unturn = conj(yawQuat(m.def.facing));
    const o = rotate(unturn, sub(origin, m.def.pos));
    const d = rotate(unturn, dir);
    const throughMouth = ({ z, x0, x1, y0, y1 }: OutputSlot['mouth']): boolean => {
      if (d.z >= 0) return false;
      const at = add(o, scale(d, (z - o.z) / d.z));
      const s = MOUTH_SLACK;
      return at.x >= x0 - s && at.x <= x1 + s && at.y >= y0 - s && at.y <= y1 + s;
    };
    let best: { owner: ColliderOwner; toi: number; normal: Vec3; off: number } | null = null;
    for (let slot = 0; slot < m.out.length; slot++) {
      if (!m.out[slot]) continue;
      const met = owner.kind === 'output' && owner.slot === slot;
      if (!met && !throughMouth(slots[slot]!.mouth)) continue;
      const at = clicks[slot]?.castRayAndGetNormal(ray, toi + OUTPUT_SEE_THROUGH, true);
      if (!at || at.timeOfImpact > REACH + 0.4) continue;
      // How far the thing lies from the ray where it passes through the place.
      const to = sub(places[slot]!.rest, origin);
      const along = Math.min(Math.max(dot(to, dir), at.timeOfImpact), at.timeOfImpact + 0.5);
      const off = length(sub(to, scale(dir, along)));
      if (best && best.off <= off) continue;
      const place = { kind: 'output' as const, machineId, slot };
      best = { owner: place, toi: at.timeOfImpact, normal: at.normal, off };
    }
    return best;
  }

  /** The ray `aim` casts: `skip` metres along from the camera, so it starts level with the player. */
  aimRay(p: Player, ask?: ViewAsk): { origin: Vec3; dir: Vec3; skip: number } {
    const eye = ask?.eye ?? this.sim.eye(p);
    const input = ask
      ? {
          ...p.input,
          yaw: ask.yaw ?? p.input.yaw,
          pitch: ask.pitch ?? p.input.pitch,
          firstPerson: ask.firstPerson ?? p.input.firstPerson,
        }
      : p.input;
    const cam = this.camera(p, eye, input);
    const dir = viewDir(input.yaw, input.pitch);
    // Start level with the player so things between the camera and the player are skipped.
    const skip = Math.max(0, dot(sub(eye, cam), dir) - 0.4);
    return { origin: add(cam, scale(dir, skip)), dir, skip };
  }
}
