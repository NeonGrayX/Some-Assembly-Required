import { BRICK_TYPES } from '../bricks.ts';
import type { Rotation } from '../bricks.ts';
import type { Placement, PlacedBrick } from '../grid.ts';
import {
  computeGroupSnap,
  computeLayerSnap,
  latticeSnap,
  sideSnap,
  spinSnap,
  snapLayer,
} from '../snap.ts';
import type { SnapLayer } from '../snap.ts';
import { frameQuat, unframeMetres, unframeTurn } from '../frames.ts';
import type { Frame } from '../frames.ts';
import { conj, length, mulQuat, rotate, scale, sub, v3, yawOf } from '../math.ts';
import { QUARTER } from './body.ts';
import { REACH, assemblyMass, collidersOf, isLooseBrick, viewDir } from './body.ts';
import type { Sim, Player, Assembly, SnapPreview, ViewAsk } from './sim.ts';

const THROW_SPEED = 7;

/**
 * Putting down what a player holds: where the brick or build in hand would snap onto the one
 * they aim at (the preview), snapping it on there, setting it down, letting go of it and
 * throwing it. Part of the `Sim`.
 */
export class Placing {
  constructor(private readonly sim: Sim) {}

  /**
   * Where the held brick, or the held piece of bricks clutched together, would snap right now,
   * if anywhere. A build with the baseplate in it is never snapped onto anything. While a layer
   * is locked (Shift), the bricks keep to it for as long as they still clutch something there.
   */
  snapPreview(p: Player, ask?: ViewAsk): SnapPreview | null {
    return this.snap(p, ask)?.preview ?? null;
  }

  snap(p: Player, ask?: ViewAsk): { preview: SnapPreview; layer: SnapLayer | null } | null {
    const held = this.sim.heldAssembly(p);
    if (!held || !p.holding) return null;
    const bricks = [...held.grid.bricks.values()];
    if (bricks.some((b) => BRICK_TYPES[b.type].fixture)) return null;
    // Flipped, it goes on by its other hole only, never onto a locked layer.
    const flip = isLooseBrick(held) && (ask?.flip ?? p.holding.flip ?? false);
    const lock = ask?.lock !== undefined ? ask.lock : p.snapLock;
    const locked = lock && this.sim.assemblies.get(lock.targetId);
    if (lock && locked && !flip && this.snapsOnto(held, locked)) {
      const ray = this.sim.sight.aimRay(p, ask);
      const inv = conj(locked.body.rotation());
      const origin = rotate(inv, sub(ray.origin, locked.body.translation()));
      const dir = rotate(inv, ray.dir);
      const { group, rot } = this.snapGroup(p, held, locked, ask);
      const placements = computeLayerSnap(locked.grid, origin, dir, group, rot, lock, REACH + 0.4);
      const preview = placements && this.snapPreviewOf(locked, bricks, placements);
      if (preview && this.sim.mayUse(p, preview.pos)) return { preview, layer: lock };
    }
    const hit = this.sim.sight.aim(p, ask);
    if (hit?.owner.kind !== 'brick') return null;
    const t = this.sim.assemblies.get(hit.owner.assemblyId);
    if (!t || !this.snapsOnto(held, t)) return null;
    if (!this.sim.mayUse(p, hit.point)) return null;
    const inv = conj(t.body.rotation());
    // On the lattice of the part aimed at: turned 45° off the grid, if it is.
    const frame = t.grid.bricks.get(hit.owner.brickId)?.frame;
    const onGrid = rotate(inv, sub(hit.point, t.body.translation()));
    const local = frame ? unframeMetres(frame, onGrid) : onGrid;
    const normal = frame ? unframeTurn(frame, rotate(inv, hit.normal)) : rotate(inv, hit.normal);
    const { group, rot } = this.snapGroup(p, held, t, ask, frame);
    // A single part aimed at the side of a build clips onto the side studs there; failing
    // that or a top or bottom, it goes onto whatever studs face out there, turned to take them.
    const single = isLooseBrick(held);
    const sideways = single && Math.abs(normal.y) < 0.3;
    const type = bricks[0]!.type;
    let placements = flip
      ? [latticeSnap(t.grid, local, normal, type, rot, true, frame)].filter((x) => x !== null)
      : sideways
        ? [sideSnap(t.grid, local, normal, type, rot, frame)].filter((x) => x !== null)
        : computeGroupSnap(t.grid, local, normal, group, rot, frame);
    if (!placements?.length && single && !flip)
      placements = [latticeSnap(t.grid, local, normal, type, rot, false, frame)].filter(
        (x) => x !== null,
      );
    if (!placements?.length) return null;
    // Turned 45° on, where it hangs on one stud alone.
    const spun =
      single && (ask?.eighth ?? p.holding.eighth) ? spinSnap(t.grid, placements[0]!) : null;
    if (spun) placements = [spun];
    const preview = this.snapPreviewOf(t, bricks, placements);
    if (spun) preview.turned45 = true;
    const square = !sideways && !flip && !spun && !frame && !placements[0]!.orient;
    return { preview, layer: square ? snapLayer(local, normal) : null };
  }

  /** Whether something held may snap onto `t`: not itself, not held, not frozen, upright. */
  private snapsOnto(held: Assembly, t: Assembly): boolean {
    if (t === held || t.heldBy !== null || t.frozen) return false;
    return rotate(t.body.rotation(), v3(0, 1, 0)).y >= 0.9; // not tipped over
  }

  /** The held bricks in their own grid, and how they turn to go onto `t`. */
  private snapGroup(
    p: Player,
    held: Assembly,
    t: Assembly,
    ask?: ViewAsk,
    frame?: Frame,
  ): { group: Placement[]; rot: Rotation } {
    // Turned as the lattice it goes on is.
    const tRot = frame ? mulQuat(t.body.rotation(), frameQuat(frame)) : t.body.rotation();
    const bricks = [...held.grid.bricks.values()];
    // A single brick goes on at the heading it has in the hands; a piece keeps its own bricks'
    // headings, turned by how its hold point is turned against the target.
    const single = isLooseBrick(held);
    const yaw = ask?.yaw ?? p.input.yaw;
    const turn = ask?.rot ?? p.holding!.rot;
    const rel = single
      ? yaw + turn * QUARTER - yawOf(tRot)
      : yawOf(this.sim.holdTarget(p, { ...p.holding!, rot: turn }, held, yaw).rot) - yawOf(tRot);
    const rot = (((Math.round(rel / QUARTER) % 4) + 4) % 4) as Rotation;
    const group = single
      ? [{ ...bricks[0]!, x: 0, y: 0, z: 0, rot: 0 as Rotation, face: undefined }]
      : bricks;
    return { group, rot };
  }

  private snapPreviewOf(t: Assembly, bricks: PlacedBrick[], placements: Placement[]): SnapPreview {
    const out = placements.map((placement, i) => ({
      id: bricks[i]!.id,
      placement: {
        type: placement.type,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        rot: placement.rot,
        ...(placement.face ? { face: placement.face } : {}),
        ...(placement.orient ? { orient: placement.orient } : {}),
        ...(placement.frame ? { frame: placement.frame } : {}),
      },
      ...this.sim.brickPose(t, placement),
    }));
    return { targetId: t.id, bricks: out, pos: out[0]!.pos, rot: out[0]!.rot };
  }

  /**
   * Holding Shift (the sprint key) with something in hand locks snapping to the layer it snaps
   * to as the key goes down; letting go of the key, or of what is held, unlocks it.
   */
  trackSnapLock(p: Player): void {
    const pressed = p.input.sprint && p.holding !== null;
    if (!pressed) p.snapLock = null;
    else if (!p.snapLockKey) {
      const s = this.snap(p);
      p.snapLock = s?.layer ? { ...s.layer, targetId: s.preview.targetId } : null;
    }
    p.snapLockKey = pressed;
  }

  /** A click with something in hand; `output` as in `Action`. */
  place(p: Player, output = false): void {
    const hit = this.sim.sight.aim(p);
    if (this.sim.interact(p, hit)) return;
    // Machines work with a click whatever is in hand; what is in their output areas is only
    // taken with the hands free for it, and nothing is dropped there instead.
    if (hit?.owner.kind === 'machine') {
      if (!output && this.sim.mayUse(p, hit.point))
        this.sim.works.useMachine(p, hit.owner.machineId);
      return;
    }
    if (hit?.owner.kind === 'output') {
      if (this.sim.mayUse(p, hit.point))
        this.sim.works.takeOut(p, hit.owner.machineId, hit.owner.slot);
      return;
    }
    if (p.tool) return;
    const preview = this.snapPreview(p);
    const held = this.sim.heldAssembly(p);
    if (!preview || !held) return this.setDown(p);
    const target = this.sim.assemblies.get(preview.targetId)!;
    const placed: PlacedBrick[] = preview.bricks.map((b) => {
      const { colour, prints } = held.grid.bricks.get(b.id)!;
      return { ...b.placement, id: b.id, colour, ...(prints ? { prints } : {}) };
    });
    this.sim.removeAssembly(held);
    // The preview checked the bricks as a whole: none overlaps, and the piece clutches on.
    for (const b of placed) {
      target.grid.insert(b);
      this.sim.addCollider(target, b);
    }
    this.sim.collidersChanged(target);
    target.version++;
    target.body.wakeUp();
    this.sim.events.push({ kind: 'snap', pos: preview.pos });
  }

  /** Lets go of a single brick, or starts lowering a build to the ground. */
  setDown(p: Player): void {
    const a = this.sim.heldAssembly(p);
    if (a && p.holding && !isLooseBrick(a)) p.holding.settingDown ??= 0;
    else this.release(p);
  }

  release(p: Player): void {
    const a = this.sim.heldAssembly(p);
    p.holding = null;
    if (!a) return;
    this.sim.setHeld(a, null);
    // Something let go of in the air sounds when it lands (see `handleImpacts`); something
    // already resting on the ground, set down gently, just settles.
    if (length(a.body.linvel()) < 0.5 && this.resting(a)) {
      a.lastDropTick = this.sim.tick;
      this.sim.events.push({
        kind: 'drop',
        pos: a.body.worldCom(),
        count: a.grid.size,
        speed: 0.5,
      });
    }
  }

  /** Whether `a` rests against anything that is not part of it. */
  private resting(a: Assembly): boolean {
    for (const c of collidersOf(a)) {
      let rests = false;
      this.sim.world.contactPairsWith(c, (other) => {
        const o = this.sim.owners.get(other.handle);
        if (o?.kind === 'brick' && o.assemblyId === a.id) return;
        if (this.sim.touching(c, other)) rests = true;
      });
      if (rests) return true;
    }
    return false;
  }

  throwHeld(p: Player): void {
    const a = this.sim.heldAssembly(p);
    if (!a) return;
    this.release(p);
    const push = THROW_SPEED / Math.max(1, assemblyMass(a) / 5);
    a.body.setLinvel(scale(viewDir(p.input.yaw, p.input.pitch), push), true);
  }
}
