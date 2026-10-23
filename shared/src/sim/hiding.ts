import { hideoutPartInWorld, dropSpot } from '../content/hideouts.ts';
import { add, scale, v3, yawQuat } from '../math.ts';
import { PAGE_SIZE, restingOn, GEAR_SIZE } from './body.ts';
import type { Sim, PageItem, GearItem, HideoutState, GadgetState, ColliderOwner } from './sim.ts';

/**
 * The hiding places and the scenery's other things a click works: opened and shut (pushing out
 * whoever stands in the way of a door), locked in a gear hunt, and the pages and gear tucked
 * into them. Their state stays on the `Sim` (`Sim.hideouts`, `Sim.gadgets`). Part of the `Sim`.
 */
export class HidingPlaces {
  constructor(private readonly sim: Sim) {}

  /** Opens a hiding place (whatever is inside comes out) or shuts it again. */
  toggleHideout(id: number, playerId?: number): void {
    const h = this.sim.hideouts.get(id);
    if (!h) return;
    if (h.locked) {
      // A padlock rattles for everyone but the key ring's wearer, for whom it comes off.
      const p = playerId === undefined ? undefined : this.sim.players.get(playerId);
      if (!p?.gear.has('keys')) {
        this.sim.events.push({ kind: 'locked', pos: h.def.pos, playerId });
        return;
      }
      h.locked = false;
      this.sim.furnitureVersion++;
      this.sim.events.push({ kind: 'unlock', pos: h.def.pos, playerId });
    }
    this.setOpen(h, !h.open);
    this.sim.events.push({
      kind: h.open ? 'open' : 'close',
      pos: h.def.pos,
      hideoutId: h.def.id,
      playerId,
    });
    if (!h.open) return;
    const drop = dropSpot(this.sim.level, h.def);
    h.contents.forEach((pageId, i) => {
      const page = this.sim.pages.get(pageId);
      if (!page) return;
      page.hidden = false;
      page.hideout = null;
      const at = add(drop, v3((i % 2) * 0.12, i * 0.02, 0));
      this.sim.pageWork.placePage(page, restingOn(at, PAGE_SIZE), yawQuat(h.def.facing));
      page.version++;
    });
    h.contents = [];
    h.gear.forEach((gearId, i) => {
      const item = this.sim.gear.get(gearId);
      if (!item) return;
      item.hidden = false;
      item.hideout = null;
      const at = add(drop, v3(-0.1 - i * 0.15, 0.1, 0));
      this.sim.gearHunt.placeGear(item, restingOn(at, GEAR_SIZE), yawQuat(h.def.facing));
      item.version++;
    });
    h.gear = [];
  }

  /** Padlocks a hiding place (Gear Hunt), until someone with the key ring opens it. */
  lockHideout(id: number): void {
    const h = this.sim.hideouts.get(id);
    if (!h || h.locked) return;
    h.locked = true;
    this.sim.furnitureVersion++;
  }

  /** Tucks a piece of gear into a hiding place and shuts it. */
  hideGearInHideout(item: GearItem, id: number): void {
    const h = this.sim.hideouts.get(id);
    if (!h) return;
    this.sim.gearHunt.detachGear(item);
    item.hidden = true;
    item.hideout = id;
    item.version++;
    h.gear.push(item.id);
    if (h.open) this.setOpen(h, false);
  }

  /** Tucks a page into a hiding place and shuts it, out of everyone's sight. */
  hideInHideout(page: PageItem, id: number): void {
    const h = this.sim.hideouts.get(id);
    if (!h) return;
    this.sim.pageWork.detachPage(page);
    page.hidden = true;
    page.hideout = id;
    page.version++;
    h.contents.push(page.id);
    if (h.open) this.setOpen(h, false);
  }

  /** Clicks a gadget (or unclicks it): its handles' click boxes go where they are for that. */
  setUsed(g: GadgetState, used: boolean): void {
    if (g.used === used) return;
    g.used = used;
    g.def.handles.forEach(({ box, used: moved }, i) => {
      const { pos, size } = used ? moved : box;
      const c = g.handles[i]!;
      c.setHalfExtents(scale(size, 0.5));
      c.setTranslationWrtParent(pos);
    });
    this.sim.furnitureVersion++;
  }

  /** Moves the door (drawer, lid…) and makes only it clickable once open. */
  setOpen(h: HideoutState, open: boolean): void {
    h.open = open;
    const pose = hideoutPartInWorld(h.def, open, h.opening);
    h.part.setHalfExtents(pose.half);
    h.part.setTranslationWrtParent(pose.centre);
    h.part.setRotationWrtParent(pose.rot);
    // An open door can be walked through, and pages fall past it.
    h.part.setSensor(open);
    const target: ColliderOwner = { kind: 'hideout', hideoutId: h.def.id };
    this.sim.owners.set(h.part.handle, target);
    if (h.body) this.sim.owners.set(h.body.handle, open ? { kind: 'static' } : target);
    this.sim.furnitureVersion++;
  }
}
