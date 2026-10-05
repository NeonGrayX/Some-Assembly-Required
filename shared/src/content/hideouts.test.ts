import { describe, expect, it } from 'vitest';
import { makeRng, v3 } from '../math.ts';
import {
  boxesOverlap,
  DRAWER_TRAVEL,
  dropSpot,
  fullOpening,
  hideoutBody,
  hideoutPartInWorld,
  inWorld,
  lidHeight,
  openingIn,
} from './hideouts.ts';
import type { PartPose } from './hideouts.ts';
import { HOUSE } from './house.ts';
import type { BoxDef, HideoutDef, HideoutKind, LevelDef } from './house.ts';

const SIZES: Record<HideoutKind, { x: number; y: number; z: number }> = {
  fridge: { x: 0.8, y: 1.8, z: 0.7 },
  locker: { x: 0.6, y: 2, z: 0.8 },
  cabinet: { x: 1.2, y: 0.7, z: 0.5 },
  drawer: { x: 0.9, y: 0.22, z: 0.1 },
  chest: { x: 0.8, y: 0.6, z: 0.6 },
  toolbox: { x: 0.7, y: 0.3, z: 0.35 },
  mailbox: { x: 0.35, y: 0.3, z: 0.45 },
  rug: { x: 1.4, y: 0.02, z: 1 },
  cushion: { x: 1.2, y: 0.1, z: 0.7 },
};

const box = (b: BoxDef): PartPose => ({
  centre: b.pos,
  half: v3(b.size.x / 2, b.size.y / 2, b.size.z / 2),
  rot: { x: 0, y: 0, z: 0, w: 1 },
});

/**
 * A small room with furniture thrown in at random: backs to a wall, squeezed into corners,
 * with a pillar or a crate close in front or beside them.
 */
function randomRoom(seed: number): LevelDef {
  const rng = makeRng(seed);
  const boxes: BoxDef[] = [
    { pos: v3(0, 1.3, 3), size: v3(6.2, 2.6, 0.2), colour: 0 },
    { pos: v3(0, 1.3, -3), size: v3(6.2, 2.6, 0.2), colour: 0 },
    { pos: v3(3, 1.3, 0), size: v3(0.2, 2.6, 6), colour: 0 },
    { pos: v3(-3, 1.3, 0), size: v3(0.2, 2.6, 6), colour: 0 },
  ];
  const hideouts: HideoutDef[] = [];
  const kinds = Object.keys(SIZES) as HideoutKind[];
  for (let id = 1; hideouts.length < 3; id++) {
    const kind = kinds[Math.floor(rng() * kinds.length)]!;
    const size = SIZES[kind];
    // Back against one of the four walls, facing into the room, anywhere along it.
    const side = Math.floor(rng() * 4);
    const facing = (side * Math.PI) / 2;
    const along = (rng() - 0.5) * (5.8 - size.x);
    // A lid hinged at its back edge swings out behind its box, so boxes with lids stand
    // off the wall by a bit more than the lid is thick, as they would in a real room.
    const lidded = kind === 'toolbox' || kind === 'chest';
    const behind = lidded ? lidHeight({ id, kind, pos: v3(), size, facing: 0 }) + 0.02 : 0;
    const out = 2.9 - size.z / 2 - behind;
    const fwd = v3(-Math.sin(facing), 0, -Math.cos(facing));
    const right = v3(Math.cos(facing), 0, -Math.sin(facing));
    const y = kind === 'drawer' ? 0.6 : size.y / 2;
    const pos = v3(-fwd.x * out + right.x * along, y, -fwd.z * out + right.z * along);
    const def: HideoutDef = { id, kind, pos, size, facing };
    // Nothing may overlap anything else when shut.
    const shut = [hideoutPartInWorld(def, false)];
    const body = hideoutBody(def);
    if (body) shut.push(inWorld(def, body));
    const taken = [...boxes.slice(4).map(box), ...hideouts.flatMap(allOf)];
    if (shut.some((s) => taken.some((t) => boxesOverlap(s, t)))) continue;
    hideouts.push(def);
    // Sometimes something stands close by: a pillar in front, or a crate to the side.
    if (rng() < 0.6) {
      const ahead = size.z / 2 + 0.15 + rng() * 0.5;
      const aside = (rng() - 0.5) * 2 * (size.x / 2 + 0.3);
      const p = v3(
        pos.x + fwd.x * ahead + right.x * aside,
        0.5,
        pos.z + fwd.z * ahead + right.z * aside,
      );
      const crate: BoxDef = { pos: p, size: v3(0.3, 1, 0.3), colour: 0 };
      if (!allOf(def).some((s) => boxesOverlap(s, box(crate)))) boxes.push(crate);
    }
  }
  return { ...HOUSE, floorSize: 6, boxes, bins: [], ladders: [], hideouts };
}

function allOf(def: HideoutDef): PartPose[] {
  const body = hideoutBody(def);
  return [hideoutPartInWorld(def, false), ...(body ? [inWorld(def, body)] : [])];
}

describe('hiding places anywhere', () => {
  it('stop opening at whatever is in the way, in any layout', () => {
    let stopped = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const level = randomRoom(seed);
      const walls = [
        ...level.boxes.map(box),
        { centre: v3(0, -0.5, 0), half: v3(3, 0.5, 3), rot: { x: 0, y: 0, z: 0, w: 1 } },
      ];
      for (const def of level.hideouts) {
        const opening = openingIn(level, def);
        expect(opening).toBeGreaterThanOrEqual(0);
        expect(opening).toBeLessThanOrEqual(fullOpening(def));
        if (opening < fullOpening(def)) stopped++;
        if (def.kind === 'rug' || def.kind === 'cushion') continue;
        const open = hideoutPartInWorld(def, true, opening);
        const others = level.hideouts.filter((o) => o !== def).flatMap(allOf);
        const solid = [...walls, ...others];
        // A drawer's tray stays in its housing; doors and lids must be clear of everything.
        if (def.kind !== 'drawer') {
          for (const s of solid) {
            expect(boxesOverlap(open, s), `seed ${seed}: ${def.kind} #${def.id}`).toBe(false);
          }
          // Against a wall or in a corner, a door or lid still opens to at least square.
          if (!level.boxes.slice(4).length) expect(opening).toBeGreaterThan(1.5);
        }
        // What comes out lands clear of everything.
        const spot = dropSpot(level, def);
        const page = {
          centre: v3(spot.x, 0.03, spot.z),
          half: v3(0.15, 0.03, 0.15),
          rot: { x: 0, y: 0, z: 0, w: 1 },
        };
        const blocked = solid.filter((s) => boxesOverlap(page, s));
        expect(blocked, `seed ${seed}: drop by ${def.kind} #${def.id}`).toEqual([]);
      }
    }
    // The random rooms did put things in the way now and then.
    expect(stopped).toBeGreaterThan(5);
  });

  it('pulls a drawer out only as far as a wall in front allows', () => {
    const drawer: HideoutDef = {
      id: 1,
      kind: 'drawer',
      pos: v3(0, 0.6, 0),
      size: SIZES.drawer,
      facing: 0,
    };
    const wall: BoxDef = { pos: v3(0, 1, -0.25), size: v3(2, 2, 0.1), colour: 0 };
    const level: LevelDef = { ...HOUSE, boxes: [wall], bins: [], ladders: [], hideouts: [drawer] };
    // Front at z = -0.05, wall face at z = -0.2.
    expect(openingIn(level, drawer)).toBeCloseTo(0.15, 1);
    expect(openingIn(level, drawer)).toBeLessThan(DRAWER_TRAVEL);
  });

  it('keeps a door from swinging through a ladder', () => {
    const cabinet: HideoutDef = {
      id: 1,
      kind: 'cabinet',
      pos: v3(0, 0.35, 0),
      size: SIZES.cabinet,
      facing: 0,
    };
    // A ladder standing across where the door would swing to.
    const level: LevelDef = {
      ...HOUSE,
      boxes: [],
      bins: [],
      hideouts: [cabinet],
      ladders: [{ pos: v3(-0.6, 0, -1), width: 0.6, height: 3, facing: 0 }],
    };
    const opening = openingIn(level, cabinet);
    expect(opening).toBeGreaterThan(0.8);
    expect(opening).toBeLessThan(1.3);
  });
});
