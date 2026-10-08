import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS, hideoutBody, hideoutPart } from '@sar/shared';
import type { BoxModel, HideoutDef } from '@sar/shared';
import { hideoutInterior, hideoutPartDetails } from './interiors.ts';
import { makeProp } from './props.ts';

const camp = MAPS.find((m) => m.id === 'camp')!.layout(1);
/** The models made for the camp. */
const CAMP_MODELS: BoxModel[] = [
  'log',
  'stump',
  'pine',
  'deck',
  'rock',
  'post',
  'picnicTable',
  'canoe',
  'wheel',
];

/** The bounds of an object built at the origin, in its own frame. */
function bounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

describe("the camp's models", () => {
  it('draws every kind of box the camp uses', () => {
    const kinds = new Set(camp.boxes.map((b) => b.model).filter(Boolean));
    for (const kind of CAMP_MODELS) expect(kinds.has(kind), kind).toBe(true);
    // (Lamp posts draw a glow texture, which wants a browser's canvas.)
    for (const b of camp.boxes) {
      if (!b.model || b.model === 'lampPost') continue;
      expect(makeProp(b, camp)!.children.length, b.model).toBeGreaterThan(0);
    }
  });

  it("keeps each model inside the box it collides as, apart from a pine's boughs", () => {
    for (const b of camp.boxes) {
      if (!b.model || !CAMP_MODELS.includes(b.model) || b.model === 'pine') continue;
      const prop = makeProp(b, camp)!;
      // Undo the placement, so the bounds are about the box's centre.
      prop.position.set(0, 0, 0);
      prop.rotation.y = 0;
      const box = bounds(prop);
      const sideways = b.front === '-x' || b.front === '+x';
      const half = {
        x: (sideways ? b.size.z : b.size.x) / 2,
        y: b.size.y / 2,
        z: (sideways ? b.size.x : b.size.z) / 2,
      };
      const slack = 0.035;
      const name = `${b.model} ${b.size.x}x${b.size.y}x${b.size.z}`;
      expect(box.min.x, name).toBeGreaterThanOrEqual(-half.x - slack);
      expect(box.max.x, name).toBeLessThanOrEqual(half.x + slack);
      expect(box.min.y, name).toBeGreaterThanOrEqual(-half.y - slack);
      expect(box.max.y, name).toBeLessThanOrEqual(half.y + slack);
      expect(box.min.z, name).toBeGreaterThanOrEqual(-half.z - slack);
      expect(box.max.z, name).toBeLessThanOrEqual(half.z + slack);
    }
  });

  it('gives a pine boughs that spread well beyond its trunk, above head height', () => {
    const tree = camp.boxes.find((b) => b.model === 'pine')!;
    const prop = makeProp(tree, camp)!;
    prop.position.set(0, 0, 0);
    const box = bounds(prop);
    expect(box.max.x).toBeGreaterThan(tree.size.y * 0.15);
    // The treehouse's tree keeps its boughs above the deck round it.
    const tall = camp.boxes.find((b) => b.model === 'pine' && b.size.y > 10)!;
    const deck = camp.boxes.find((b) => b.model === 'deck' && Math.abs(b.pos.x - tall.pos.x) < 2)!;
    expect(tall.size.y * 0.42).toBeGreaterThan(deck.pos.y + deck.size.y / 2 + 1.8);
  });

  it('draws the tent and the cool box hollow, with the flap and lid where the part is', () => {
    for (const kind of ['tent', 'coolbox'] as const) {
      const def = camp.hideouts.find((h) => h.kind === kind)!;
      const interior = hideoutInterior(def, 0x5f8a4a)!;
      expect(interior.children.length, kind).toBeGreaterThan(3);
      const body = hideoutBody(def)!;
      const box = bounds(interior);
      const slack = 0.03;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(box.min[axis], `${kind} ${axis}`).toBeGreaterThanOrEqual(
          body.centre[axis] - body.half[axis] - slack,
        );
        expect(box.max[axis], `${kind} ${axis}`).toBeLessThanOrEqual(
          body.centre[axis] + body.half[axis] + slack,
        );
      }
    }
    // The tent's flap fills the panel the simulation clicks on, and no more.
    const tent = camp.hideouts.find((h) => h.kind === 'tent')!;
    const part = new THREE.Group();
    hideoutPartDetails(part, tent, 0x5f8a4a);
    const flap = bounds(part);
    const panel = hideoutPart(tent, false);
    expect(flap.max.y).toBeCloseTo(panel.half.y, 1);
    expect(flap.min.x).toBeGreaterThanOrEqual(-panel.half.x - 0.01);
    expect(flap.max.x).toBeLessThanOrEqual(panel.half.x + 0.01);
  });

  it('builds a tent with no handle and no hinges', () => {
    const def: HideoutDef = {
      id: 1,
      kind: 'tent',
      pos: { x: 0, y: 0.75, z: 0 },
      size: { x: 1.6, y: 1.5, z: 2.2 },
      facing: 0,
    };
    // Nothing of the flap sticks out in front past the zip's pull.
    const part = new THREE.Group();
    hideoutPartDetails(part, def, 0x5f8a4a);
    expect(bounds(part).min.z).toBeGreaterThan(-0.03);
  });
});
