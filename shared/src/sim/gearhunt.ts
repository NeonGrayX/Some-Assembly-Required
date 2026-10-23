import type { BrickTypeId, ColourId } from '../bricks.ts';
import type { GearId } from '../gear.ts';
import { add, scale, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import { restingOn, GEAR_SIZE, MAX_LOOSE_BRICKS } from './body.ts';
import type { Sim, Player, GearItem } from './sim.ts';

/** The litter of a gear hunt: small bricks scattered around every dog point, this far out. */
const LITTER_SPREAD = 1.1;
const LITTER_TYPES: BrickTypeId[] = ['1x1', '1x2', 'plate1x2'];
/** The colours litter comes in: the everyday ones. */
const LITTER_COLOURS: ColourId[] = ['red', 'white', 'yellow', 'blue', 'light-grey', 'black'];

/**
 * The gear of a gear hunt: put out about the map or hidden, picked up and put on, dropped, and
 * what some of it does (the leash holds the dog by its pole), and the litter scattered round
 * the dog's points. Its state stays on the `Sim` (`Sim.gear`). Part of the `Sim`.
 */
export class GearHunt {
  constructor(private readonly sim: Sim) {}

  /** Puts a piece of gear into the world (Gear Hunt), lying at `pos`. */
  spawnGear(kind: GearId, pos: Vec3, yaw = 0, id = this.sim.newId()): GearItem {
    const item = this.newGear(kind, id);
    this.placeGear(item, restingOn(pos, GEAR_SIZE), yawQuat(yaw));
    return item;
  }

  /** Puts a piece of gear straight into a hiding place, shut. */
  spawnGearInHideout(kind: GearId, hideoutId: number): GearItem {
    const item = this.newGear(kind, this.sim.newId());
    this.sim.hiding.hideGearInHideout(item, hideoutId);
    return item;
  }

  /** A piece of gear that is nowhere yet. */
  newGear(kind: GearId, id: number): GearItem {
    const item: GearItem = {
      id,
      kind,
      body: null,
      wornBy: null,
      hidden: false,
      hideout: null,
      placed: false,
      version: 0,
    };
    this.sim.gear.set(item.id, item);
    return item;
  }

  /** Puts a piece of gear into the world with its middle at `centre`. */
  placeGear(item: GearItem, at: Vec3, rot: Quat, linvel: Vec3 = v3()): void {
    const { R } = this.sim;
    const centre = this.sim.aboveGround(at, GEAR_SIZE.y / 2 + 0.01, GEAR_SIZE.x / 2);
    const body = this.sim.world.createRigidBody(
      (this.sim.replica ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(rot)
        .setLinvel(linvel.x, linvel.y, linvel.z)
        .setLinearDamping(1.5)
        .setAngularDamping(3),
    );
    const c = this.sim.world.createCollider(
      R.ColliderDesc.cuboid(GEAR_SIZE.x / 2, GEAR_SIZE.y / 2, GEAR_SIZE.z / 2)
        .setDensity(120)
        .setFriction(1),
      body,
    );
    this.sim.owners.set(c.handle, { kind: 'gear', gearId: item.id });
    item.body = body;
    item.wornBy = null;
    item.placed = false;
  }

  /** Takes a piece of gear out of the world, and off whoever wears it. */
  detachGear(item: GearItem): void {
    if (item.body) {
      this.sim.owners.delete(item.body.collider(0).handle);
      this.sim.world.removeRigidBody(item.body);
      item.body = null;
    }
    if (item.wornBy !== null) this.sim.players.get(item.wornBy)?.gear.delete(item.kind);
    item.wornBy = null;
    item.placed = false;
  }

  /** Picking gear up puts it on: it works at once, and shows on the builder. */
  takeGear(p: Player, item: GearItem): void {
    if (!item.body || p.gear.has(item.kind)) return;
    const pos = item.body.translation();
    this.detachGear(item);
    item.wornBy = p.id;
    item.version++;
    p.gear.add(item.kind);
    this.sim.events.push({ kind: 'gearOn', pos, playerId: p.id, gear: item.kind });
  }

  /** Takes a piece of gear off and drops it at the player's feet, for someone else. */
  dropGear(p: Player, kind: GearId): void {
    const item = [...this.sim.gear.values()].find((g) => g.wornBy === p.id && g.kind === kind);
    if (!item) return;
    const yaw = p.input.yaw;
    const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw));
    // Let go of a little below the hands.
    const pos = add(this.sim.eye(p), add(scale(f, 0.5), v3(0, -0.5, 0)));
    this.detachGear(item);
    this.placeGear(item, restingOn(pos, GEAR_SIZE), yawQuat(yaw), scale(f, 0.8));
    item.version++;
    this.sim.events.push({ kind: 'gearOff', pos, playerId: p.id, gear: kind });
  }

  /** Where the dog's pole stands: by its kennel, at its starting point. */
  dogPole(): Vec3 {
    return this.sim.level.dog.points[this.sim.level.dog.start]!;
  }

  /**
   * The leash's wearer clicked the dog: the leash goes on the pole with the dog at the end of
   * it, for the rest of the round. Returns false if the dog is leashed already.
   */
  leashDog(p: Player): boolean {
    const item = [...this.sim.gear.values()].find((g) => g.wornBy === p.id && g.kind === 'leash');
    if (!item || this.sim.dog.leashed) return false;
    this.detachGear(item);
    item.placed = true;
    item.version++;
    this.sim.dog.leash(this.dogPole());
    this.sim.events.push({ kind: 'leash', pos: this.sim.dog.feet, playerId: p.id, gear: 'leash' });
    return true;
  }

  /**
   * Scatters a gear hunt's litter: small loose bricks around every dog point, which between
   * them cover every path through the yard and house. Returns how many were put down.
   */
  spawnLitter(perPoint: number, rng: () => number): number {
    const points = this.sim.level.dog.points;
    let n = 0;
    for (const point of points) {
      for (let i = 0; i < perPoint; i++) {
        const type = LITTER_TYPES[Math.floor(rng() * LITTER_TYPES.length)]!;
        const colour = LITTER_COLOURS[Math.floor(rng() * LITTER_COLOURS.length)]!;
        const angle = rng() * Math.PI * 2;
        const out = 0.3 + rng() * LITTER_SPREAD;
        const at = add(point, v3(Math.cos(angle) * out, 0.12, Math.sin(angle) * out));
        this.sim.spawnBrick(type, colour, at, yawQuat(rng() * Math.PI));
        n++;
      }
    }
    this.sim.looseLimit = MAX_LOOSE_BRICKS + n;
    return n;
  }
}
