import { BASEMENT_SLAB, UPPER_FLOOR, UPPER_SLAB } from './content/house.ts';
import type { Vec3 } from './math.ts';

/**
 * Gear Hunt: the co-op mode without saboteurs. The job site starts in trouble (everything
 * looks grey, bricks litter the floor, the house is dark, cupboards are padlocked, the dog is
 * loose, the build is heavy) and each trouble has exactly one piece of gear hidden in the map
 * that fixes it for whoever wears it. Any amount can be worn at once, so one player alone can
 * finish the job. See docs/08-gear-hunt-mode.md.
 */

/** How a round is played: with hidden saboteurs, as a gear hunt, or plainly together. */
/**
 * How a round is played: with saboteurs; a gear hunt; plain co-op; blind build (saboteurs,
 * but one reader is the only one who can read the pages and cannot touch bricks); or rival
 * teams (two yards racing for the most accurate build, no saboteurs, no meetings).
 */
export const GAME_MODES = ['saboteur', 'gear', 'coop', 'blind', 'rival'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export function isGameMode(x: unknown): x is GameMode {
  return typeof x === 'string' && (GAME_MODES as readonly string[]).includes(x);
}

export const GEAR = [
  {
    id: 'goggles',
    name: 'Colour goggles',
    trouble: 'Without them every brick, bin and manual is grey, and no colour is named anywhere.',
    fix: 'See colours again. Tell the others what colour goes where.',
  },
  {
    id: 'boots',
    name: 'Steel-toe boots',
    trouble: 'Loose bricks litter the floors. Stepping on one hurts.',
    fix: 'Walk and run over anything on the floor.',
  },
  {
    id: 'headlamp',
    name: 'Headlamp',
    trouble: 'The power is out for good. Inside the house it is too dark to read.',
    fix: 'A beam from your hat. Anyone standing in it can read.',
  },
  {
    id: 'keys',
    name: 'Key ring',
    trouble: 'Some hiding places are padlocked.',
    fix: 'Opens padlocks. An opened one stays open to everyone.',
  },
  {
    id: 'leash',
    name: 'Leash',
    trouble: 'The dog steals pages and wrecks the build when it is hungry.',
    fix: 'Click the dog to leash it to the pole by its kennel for the rest of the round.',
  },
  {
    id: 'brace',
    name: 'Back brace',
    trouble: 'The build only lifts off the job site while you walk carefully.',
    fix: 'Carry the build at walking pace, and never trip with it.',
  },
] as const satisfies readonly { id: string; name: string; trouble: string; fix: string }[];

export type GearId = (typeof GEAR)[number]['id'];
export const GEAR_IDS: readonly GearId[] = GEAR.map((g) => g.id);

export function isGearId(x: unknown): x is GearId {
  return typeof x === 'string' && (GEAR_IDS as readonly string[]).includes(x);
}

export function gearName(id: GearId): string {
  return GEAR.find((g) => g.id === id)!.name;
}

/** Worn gear packed into one number for snapshots: bit `i` is `GEAR[i]`. */
export function gearBits(worn: Iterable<GearId>): number {
  let bits = 0;
  for (const id of worn) bits |= 1 << GEAR_IDS.indexOf(id);
  return bits;
}

export function gearFromBits(bits: number): Set<GearId> {
  const worn = new Set<GearId>();
  GEAR_IDS.forEach((id, i) => {
    if (bits & (1 << i)) worn.add(id);
  });
  return worn;
}

/** Hiding places that can take a padlock: the ones with a door, a lid, a flap or a drawer. */
export const LOCKABLE = new Set(['fridge', 'locker', 'cabinet', 'toolbox', 'chest', 'mailbox']);

/** Extra building time a gear hunt gets over the chosen round length: the first minutes go into finding gear. */
export const GEAR_HUNT_EXTRA_SECONDS = 3 * 60;

/** How far the headlamp's beam reaches, and how wide it is (cosine of the half angle). */
export const LAMP_REACH = 8;
export const LAMP_COS = Math.cos((38 * Math.PI) / 180);

/**
 * Whether a point is inside the house (any storey, the basement included) rather than in the
 * yard or up on a roof. The house's footprint is its two slabs; the roof over the break room is
 * one storey up, over the rest two.
 */
export function indoors(pos: Vec3): boolean {
  const x0 = Math.min(UPPER_SLAB.x0, BASEMENT_SLAB.x0);
  const x1 = Math.max(UPPER_SLAB.x1, BASEMENT_SLAB.x1);
  const z0 = Math.min(UPPER_SLAB.z0, BASEMENT_SLAB.z0);
  const z1 = Math.max(UPPER_SLAB.z1, BASEMENT_SLAB.z1);
  if (pos.x < x0 || pos.x > x1 || pos.z < z0 || pos.z > z1) return false;
  const storeys = pos.x < UPPER_SLAB.x1 ? 2 : 1;
  return pos.y < storeys * UPPER_FLOOR - 0.3;
}

/** A headlamp wearer's beam: from their eye, the way they look. */
export interface Beam {
  eye: Vec3;
  dir: Vec3;
}

/**
 * Whether a page at `pos` can be read: always outside, or while the lights work; inside a dark
 * house only in a headlamp's beam (the wearer's own, or anyone else's).
 */
export function litAt(pos: Vec3, night: boolean, powerOn: boolean, beams: Beam[]): boolean {
  if (!night || powerOn || !indoors(pos)) return true;
  return beams.some(({ eye, dir }) => {
    const dx = pos.x - eye.x;
    const dy = pos.y - eye.y;
    const dz = pos.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1) return true;
    if (dist > LAMP_REACH) return false;
    return (dx * dir.x + dy * dir.y + dz * dir.z) / dist >= LAMP_COS;
  });
}
