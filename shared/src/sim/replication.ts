import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { GearId } from '../gear.ts';
import type { FurnitureState } from '../net/protocol.ts';
import type { PlacedBrick } from '../grid.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import type { Quat, Vec3 } from '../math.ts';
import { collidersOf } from './body.ts';
import type { Sim, BrickWorksState, Tool, Assembly } from './sim.ts';

/**
 * The world as the server tells clients it, and as a client (`Sim.replica`) mirrors it from what
 * it is told: assemblies, pages, gear, the furniture and the brick works.
 */
export class Replication {
  constructor(private readonly sim: Sim) {}

  /** Creates or replaces an assembly exactly as the server describes it. */
  replicaAssembly(
    id: number,
    bricks: PlacedBrick[],
    anchored: boolean,
    heldBy: number | null,
    version: number,
    pos: Vec3,
    rot: Quat,
  ): Assembly {
    const old = this.sim.assemblies.get(id);
    if (old) this.replicaRemove(old);
    const a = this.sim.createAssembly(bricks, pos, rot, anchored, undefined, undefined, id);
    a.version = version;
    if (heldBy !== null) this.sim.setHeld(a, heldBy);
    return a;
  }

  /** Changes who holds an assembly without rebuilding it. */
  replicaHeld(a: Assembly, heldBy: number | null, anchored: boolean): void {
    if (a.heldBy !== heldBy) this.sim.setHeld(a, heldBy);
    if (a.anchored !== anchored) {
      const { RigidBodyType } = this.sim.R;
      a.body.setBodyType(
        anchored ? RigidBodyType.Fixed : RigidBodyType.KinematicPositionBased,
        true,
      );
    }
    a.anchored = anchored;
  }

  replicaRemoveAssembly(id: number): void {
    const a = this.sim.assemblies.get(id);
    if (a) this.replicaRemove(a);
  }

  private replicaRemove(a: Assembly): void {
    for (const c of collidersOf(a)) this.sim.owners.delete(c.handle);
    this.sim.world.removeRigidBody(a.body);
    this.sim.assemblies.delete(a.id);
  }

  /**
   * Creates, moves into a pocket, hides, pins or puts back an instruction page: lying with its
   * middle at `pos` unless it is carried (by a player, or in the dog's mouth), hidden or pinned.
   */
  replicaPage(
    id: number,
    printed: PrintedPage | null,
    carriedBy: number | null,
    where: { hidden: boolean; pinned: number | null; dog: boolean },
    pos: Vec3,
    rot: Quat,
  ): void {
    const page = this.sim.pages.get(id) ?? this.sim.pageWork.newPage(printed, id);
    // A page first seen unread (in someone's pocket) learns which it is once it can be read.
    if (printed) page.step = printed.step;
    // Which hiding place it is in is never told, only that it is in one.
    page.hideout = null;
    if (where.pinned !== null) {
      page.printed = printed;
      page.carriedBy = null;
      page.hidden = false;
      this.sim.pageWork.pinPage(page, where.pinned);
      return;
    }
    page.hidden = where.hidden;
    page.printed = printed;
    page.version++;
    if (page.body) {
      this.sim.owners.delete(page.body.collider(0).handle);
      this.sim.world.removeRigidBody(page.body);
      page.body = null;
    }
    page.carriedBy = carriedBy;
    page.pinned = null;
    if (carriedBy === null && !where.hidden && !where.dog)
      this.sim.pageWork.placePage(page, pos, rot);
  }

  /**
   * Creates, hands over, hides or puts back a piece of gear: lying with its middle at `pos`
   * unless it is worn, hidden or (the leash) on the dog's pole.
   */
  replicaGear(
    id: number,
    kind: GearId,
    wornBy: number | null,
    where: { hidden: boolean; placed: boolean },
    pos: Vec3,
    rot: Quat,
  ): void {
    const item = this.sim.gear.get(id) ?? this.sim.gearHunt.newGear(kind, id);
    if (item.body) {
      this.sim.owners.delete(item.body.collider(0).handle);
      this.sim.world.removeRigidBody(item.body);
      item.body = null;
    }
    item.version++;
    item.hidden = where.hidden;
    item.hideout = null;
    if (where.placed) {
      item.placed = true;
      item.wornBy = null;
      if (!this.sim.dog.leashed) this.sim.dog.leash(this.sim.gearHunt.dogPole());
      return;
    }
    item.placed = false;
    item.wornBy = wornBy;
    if (wornBy === null && !where.hidden) this.sim.gearHunt.placeGear(item, pos, rot);
  }

  /**
   * Which hiding places stand open and which are padlocked, the power, and the brick works, as
   * clients are told it (`replicaFurniture` on their side).
   */
  furnitureState(): FurnitureState {
    const hideouts = [...this.sim.hideouts.values()];
    const { on, fixer, dead } = this.sim.power;
    return {
      open: hideouts.filter((h) => h.open).map((h) => h.def.id),
      locked: hideouts.filter((h) => h.locked).map((h) => h.def.id),
      used: [...this.sim.gadgets.values()].filter((g) => g.used).map((g) => g.def.id),
      carDoors: [...this.sim.carDoorsClicked],
      power: { on, fixer, dead },
      ...this.brickWorks(),
    };
  }

  /** Mirrors the hiding places, the power and the brick works as the server tells them. */
  replicaFurniture(f: FurnitureState): void {
    for (const [id, mould, colour, shots, part, jammed, fixer, out, making] of f.machines) {
      const m = this.sim.machines.get(id);
      if (!m) continue;
      if (fixer !== m.fixer) m.progress = 0;
      Object.assign(m, { mould, colour, shots, part, jammed, fixer, making });
      const clicks = this.sim.outputColliders.get(id) ?? [];
      m.out.forEach((_, slot) => {
        m.out[slot] = out[slot] ?? null;
        clicks[slot]?.setEnabled(m.out[slot] !== null);
      });
    }
    this.sim.replicaTools = new Map(f.tools);
    for (const p of this.sim.players.values()) p.tool = this.sim.replicaTools.get(p.id) ?? null;
    for (const h of this.sim.hideouts.values()) {
      this.sim.hiding.setOpen(h, f.open.includes(h.def.id));
      h.locked = f.locked.includes(h.def.id);
    }
    for (const g of this.sim.gadgets.values())
      this.sim.hiding.setUsed(g, f.used.includes(g.def.id));
    this.sim.carDoorsClicked.clear();
    for (const group of f.carDoors ?? []) this.sim.carDoorsClicked.add(group);
    if (f.power.fixer !== this.sim.power.fixer) this.sim.power.progress = 0;
    this.sim.power.on = f.power.on;
    this.sim.power.fixer = f.power.fixer;
    this.sim.power.dead = f.power.dead;
  }

  /**
   * The brick works as clients are told it: what is in each machine, what it is making and what
   * waits in its output area, and who carries what.
   */
  brickWorks(): BrickWorksState {
    return {
      machines: [...this.sim.machines.values()].map((m) => [
        m.def.id,
        m.mould,
        m.colour,
        m.shots,
        m.part,
        m.jammed,
        m.fixer,
        [...m.out],
        m.making,
      ]),
      tools: [...this.sim.players.values()].flatMap((p) =>
        p.tool ? [[p.id, p.tool] as [number, Tool]] : [],
      ),
    };
  }

  /** Poses a replicated body for the next step. */
  setPose(body: RigidBody, pos: Vec3, rot: Quat): void {
    body.setNextKinematicTranslation(pos);
    body.setNextKinematicRotation(rot);
  }
}
