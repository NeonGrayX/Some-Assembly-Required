import { BRICK_TYPES, COLOURS } from '../bricks.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import { machinePose } from '../content/house.ts';
import type { Vec3 } from '../math.ts';
import type { Sim, Player } from './sim.ts';

/**
 * What a saboteur does on purpose (swapping a brick's colour, jamming a machine or cutting the
 * power, reprinting and hiding pages), and machines breaking down by themselves.
 */
export class Sabotage {
  constructor(private readonly sim: Sim) {}

  /**
   * Swaps the aimed brick for its look-alike colour, in place. Returns where it happened, or
   * null if there was nothing to swap.
   */
  swapBrick(p: Player): Vec3 | null {
    const hit = this.sim.sight.aim(p);
    if (hit?.owner.kind !== 'brick') return null;
    const a = this.sim.assemblies.get(hit.owner.assemblyId);
    const b = a?.grid.bricks.get(hit.owner.brickId);
    if (!a || !b || BRICK_TYPES[b.type].fixture) return null;
    const near = COLOURS[b.colour].nearMiss[0];
    if (!near) return null;
    b.colour = near;
    a.version++;
    return hit.point;
  }

  /**
   * Tampers with the aimed machine (it jams until someone clears it) or the electrical panel
   * (the power goes out). Returns where it happened, or null if there was nothing to tamper with.
   */
  tamper(p: Player): Vec3 | null {
    const hit = this.sim.sight.aim(p);
    if (!hit || !this.sim.mayUse(p, hit.point)) return null;
    if (hit.owner.kind === 'panel') {
      if (!this.sim.power.on || this.sim.power.dead) return null;
      this.sim.working.breakPower();
      return hit.point;
    }
    if (hit.owner.kind !== 'machine') return null;
    const m = this.sim.machines.get(hit.owner.machineId);
    if (!m || m.jammed) return null;
    Object.assign(m, { jammed: true, fixer: null, progress: 0 });
    this.sim.furnitureVersion++;
    return hit.point;
  }

  /**
   * A machine breaks down by itself: it jams just as if a saboteur had tampered with it, but
   * with a clunk everyone close by hears. Returns false if it is jammed already.
   */
  breakMachine(id: number): boolean {
    const m = this.sim.machines.get(id);
    if (!m || m.jammed) return false;
    Object.assign(m, { jammed: true, fixer: null, progress: 0 });
    this.sim.furnitureVersion++;
    this.sim.events.push({ kind: 'breakdown', pos: machinePose(m.def).centre, machineId: id });
    return true;
  }

  /** Replaces what is printed on the page in the player's pocket. */
  reprintPocketPage(p: Player, printed: PrintedPage): boolean {
    const page = p.page === null ? undefined : this.sim.pages.get(p.page);
    if (!page || !page.printed) return false;
    page.printed = printed;
    page.version++;
    return true;
  }

  /** The hiding place the player aims at, if they have a page in their pocket to put in it. */
  hideoutForPocketPage(p: Player): number | null {
    if (p.page === null || !this.sim.pages.has(p.page)) return null;
    const hit = this.sim.sight.aim(p);
    return hit?.owner.kind === 'hideout' ? hit.owner.hideoutId : null;
  }

  /**
   * Puts the page in the player's pocket into the hiding place they aim at and shuts it. Returns
   * where it happened, or null if they aim at no hiding place or have no page.
   */
  hidePocketPage(p: Player): Vec3 | null {
    const id = this.hideoutForPocketPage(p);
    const page = p.page === null ? undefined : this.sim.pages.get(p.page);
    if (id === null || !page) return null;
    const h = this.sim.hideouts.get(id)!;
    this.sim.hiding.hideInHideout(page, id);
    this.sim.events.push({ kind: 'close', pos: h.def.pos, hideoutId: id, playerId: p.id });
    return h.def.pos;
  }
}
