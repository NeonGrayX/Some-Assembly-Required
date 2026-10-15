import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAMERA_DISTANCE,
  CAMERA_LIFT,
  EYE_OFFSET,
  MAPS,
  PLAYER_FEET,
  groundHeight,
  hideoutBody,
  hideoutPart,
} from '@sar/shared';
import type { BoxModel, HideoutDef } from '@sar/shared';
import { hideoutInterior, tentDoor } from './interiors.ts';
import { painted } from './nature.ts';
import { makeProp } from './props.ts';
import { Surface } from './styles.ts';

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

/** The bounds of the parts of an object meant to stay in its box (not those marked `besideBox`). */
function boxedBounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  const out = new THREE.Box3();
  o.traverse((m) => {
    if (m instanceof THREE.Mesh && !m.userData.besideBox)
      out.union(new THREE.Box3().setFromObject(m));
  });
  return out;
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

  it("keeps each model inside the box it collides as, apart from a pine's boughs and a post's slot", () => {
    for (const b of camp.boxes) {
      if (!b.model || !CAMP_MODELS.includes(b.model) || b.model === 'pine') continue;
      const prop = makeProp(b, camp)!;
      // Undo the placement, so the bounds are about the box's centre.
      prop.position.set(0, 0, 0);
      prop.rotation.y = 0;
      const box = boxedBounds(prop);
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
    // The treehouse's tree keeps its boughs above the deck round it, out of the way of the
    // camera over the shoulder of a player standing up there and looking down.
    const tall = camp.boxes.find((b) => b.model === 'pine' && b.size.y > 10)!;
    const deck = camp.boxes.find((b) => b.model === 'deck' && Math.abs(b.pos.x - tall.pos.x) < 2)!;
    const deckTop = deck.pos.y + deck.size.y / 2;
    const lookout = makeProp(tall, camp)!;
    lookout.position.set(0, 0, 0);
    lookout.updateMatrixWorld(true);
    let lowest = Infinity;
    lookout.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.type === 'ConeGeometry')
        lowest = Math.min(lowest, new THREE.Box3().setFromObject(o).min.y + tall.size.y / 2);
    });
    const eyes = deckTop + PLAYER_FEET + EYE_OFFSET;
    expect(lowest).toBeGreaterThan(eyes + CAMERA_LIFT + CAMERA_DISTANCE);
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
    // The tent's door fills the panel the simulation clicks on, and no more, shut or rolled up.
    const tent = camp.hideouts.find((h) => h.kind === 'tent')!;
    const door = tentDoor(tent, 0x5f8a4a);
    const panel = hideoutPart(tent, false);
    for (const amount of [0, 0.5, 1]) {
      door.roll(amount);
      const flap = bounds(door.group);
      expect(flap.max.y, `${amount}`).toBeCloseTo(panel.half.y, 1);
      expect(flap.min.x, `${amount}`).toBeGreaterThanOrEqual(-panel.half.x - 0.06);
      expect(flap.max.x, `${amount}`).toBeLessThanOrEqual(panel.half.x + 0.06);
    }
  });

  it("rolls a tent's door up to the sides from the zip in the middle", () => {
    const def = camp.hideouts.find((h) => h.kind === 'tent')!;
    const { x: w, y: h } = def.size;
    const door = tentDoor(def, 0x5f8a4a);
    // Open, nothing is left across the middle of the doorway at a crouch.
    door.roll(1);
    const low = vertices(door.group).filter((p) => p.y < 0);
    expect(low.length).toBeGreaterThan(0);
    for (const p of low) expect(Math.abs(p.x), `${p.x}, ${p.y}`).toBeGreaterThan(w * 0.1);
    // Shut, canvas covers the doorway right across the bottom.
    door.roll(0);
    const shut = bounds(door.group);
    expect(shut.min.x).toBeLessThan(-w / 2 + 0.01);
    expect(shut.max.x).toBeGreaterThan(w / 2 - 0.01);
    expect(shut.min.y).toBeLessThan(-h * 0.45);
  });

  it('builds a tent with no handle and no hinges', () => {
    const def: HideoutDef = {
      id: 1,
      kind: 'tent',
      pos: { x: 0, y: 0.75, z: 0 },
      size: { x: 1.6, y: 1.5, z: 2.2 },
      facing: 0,
    };
    // Nothing of the door sticks out in front past the zip's pull.
    expect(bounds(tentDoor(def, 0x5f8a4a).group).min.z).toBeGreaterThan(-0.03);
  });
});

/** Every vertex of the shown meshes under `o`, in its parent's frame. */
function vertices(o: THREE.Object3D): THREE.Vector3[] {
  o.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  o.traverseVisible((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    const pos = m.geometry.attributes.position!;
    for (let i = 0; i < pos.count; i++)
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  });
  return out;
}

describe("the camp's models stand the right way up", () => {
  it('pitches a tent with its walls meeting at the ridge, not at the floor', () => {
    const def = camp.hideouts.find((h) => h.kind === 'tent')!;
    const { x: w, y: h } = def.size;
    const points = vertices(hideoutInterior(def, 0x5f8a4a)!);
    // Near the ridge the canvas is only in the middle.
    const high = points.filter((p) => p.y > h / 2 - 0.1);
    expect(high.length).toBeGreaterThan(0);
    for (const p of high) expect(Math.abs(p.x)).toBeLessThan(w * 0.15);
    // And it reaches out to both sides at the floor.
    const low = points.filter((p) => p.y < -h / 2 + 0.1);
    expect(Math.max(...low.map((p) => p.x))).toBeGreaterThan(w * 0.4);
    expect(Math.min(...low.map((p) => p.x))).toBeLessThan(-w * 0.4);
  });

  it('stands a picnic table on legs that splay out to the ground', () => {
    const b = camp.boxes.find((x) => x.model === 'picnicTable')!;
    const prop = makeProp(b, camp)!;
    prop.position.set(0, 0, 0);
    prop.rotation.y = 0;
    const points = vertices(prop);
    const { y: h, z: d } = b.size;
    // The feet are out under the benches, wider than the top.
    const feet = points.filter((p) => p.y < -h / 2 + 0.03);
    expect(feet.length).toBeGreaterThan(0);
    expect(Math.max(...feet.map((p) => Math.abs(p.z)))).toBeGreaterThan(d / 2 - 0.15);
    // Just under the top, the legs are in close.
    const legsUnderTop = points.filter((p) => p.y > h / 2 - 0.12 && p.y < h / 2 - 0.05);
    expect(Math.max(...legsUnderTop.map((p) => Math.abs(p.z)))).toBeLessThan(d * 0.35);
  });
});

const island = MAPS.find((m) => m.id === 'island')!.layout(1);
/** The models made for the island. */
const ISLAND_MODELS: BoxModel[] = [
  'palm',
  'boulder',
  'barrel',
  'cannon',
  'ropeRail',
  'ropeFence',
  'hull',
  'mast',
  'flagpole',
  'gableRoof',
  'storey',
  'piling',
  'barrelBin',
  'lanternPost',
  'ropeCoil',
  'anchor',
];
/**
 * The island's models that reach out of their boxes on purpose: a palm's trunk leans and its
 * fronds spread, a ship's bow and bulwarks, a mast's yards and sails, a flag, a rope rail's
 * ropes running on to the next length's post, what stands out from an upper storey's walls
 * (and the braces under its jetty), an old mooring post's lean, a harbour lantern's arm, and a
 * coil of rope or an anchor lying on the slope of the ground, tipped with it.
 */
const SPREADING: BoxModel[] = [
  'palm',
  'hull',
  'mast',
  'flagpole',
  'ropeRail',
  'storey',
  'piling',
  'lanternPost',
  'ropeCoil',
  'anchor',
];

/** A model built for a box of the island, at the origin and turned back to face -z. */
function islandProp(
  model: BoxModel,
  which = 0,
): { b: (typeof island.boxes)[number]; prop: THREE.Object3D } {
  const b = island.boxes.filter((x) => x.model === model)[which]!;
  const prop = makeProp(b, island)!;
  prop.position.set(0, 0, 0);
  prop.rotation.y = 0;
  return { b, prop };
}

describe("the island's models", () => {
  it('draws every kind of box the island uses', () => {
    const kinds = new Set(island.boxes.map((b) => b.model).filter(Boolean));
    for (const kind of ISLAND_MODELS) expect(kinds.has(kind), kind).toBe(true);
    // (Harbour lanterns, like lamp posts, draw a glow texture: see below.)
    for (const b of island.boxes) {
      if (!b.model || b.model === 'lanternPost' || b.model === 'collider') continue;
      expect(makeProp(b, island)!.children.length, b.model).toBeGreaterThan(0);
    }
  });

  it('keeps each model inside the box it collides as, apart from those that spread out of it', () => {
    for (const b of island.boxes) {
      if (!b.model || !ISLAND_MODELS.includes(b.model) || SPREADING.includes(b.model)) continue;
      const prop = makeProp(b, island)!;
      prop.position.set(0, 0, 0);
      prop.rotation.y = 0;
      const box = boxedBounds(prop);
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

  it('gives a palm fronds that spread well beyond its trunk, all of them above head height', () => {
    for (const [i, b] of island.boxes.filter((x) => x.model === 'palm').entries()) {
      const { prop } = islandProp('palm', i);
      const box = bounds(prop);
      expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeGreaterThan(
        b.size.y * 0.4,
      );
      // Whatever reaches a metre out from the trunk's foot is well over a player's head.
      const head = -b.size.y / 2 + 2.2;
      for (const p of vertices(prop))
        if (Math.hypot(p.x, p.z) > 1.2) expect(p.y, `${p.x}, ${p.z}`).toBeGreaterThan(head);
    }
  });

  it("hangs a mast's yards and sails across its ship, and the bow out ahead of the hull", () => {
    const { b: hull, prop: ship } = islandProp('hull');
    // The island's ship lies along x: the yards run across it, along z, braced round a little.
    expect(hull.size.x).toBeGreaterThan(hull.size.z);
    for (const [i, b] of island.boxes.filter((x) => x.model === 'mast').entries()) {
      const { prop: mast } = islandProp('mast', i);
      const sails = new THREE.Box3();
      mast.updateMatrixWorld(true);
      mast.traverse((o) => {
        // (Its square sails: not the jib out along the bowsprit.)
        if (
          o instanceof THREE.Mesh &&
          o.material === painted(Surface.Fabric, true) &&
          o.name !== 'jib'
        )
          sails.union(new THREE.Box3().setFromObject(o));
      });
      expect(sails.max.z - sails.min.z, `${b.size.y}`).toBeGreaterThan(hull.size.z);
      expect(sails.max.x - sails.min.x, `${b.size.y}`).toBeLessThan(hull.size.z);
    }
    // Turned back to face -z, the bow reaches out ahead of the hull's box.
    expect(bounds(ship).min.z).toBeLessThan(-hull.size.x / 2 - 1);
  });

  it("keeps a ship's rigging over the heads of those on its deck, or out along its sides", () => {
    const hull = island.boxes.find((b) => b.model === 'hull')!;
    const deck = hull.pos.y + hull.size.y / 2;
    // A player standing anywhere on the deck inside the bulwarks, as tall as one is.
    const reach = new THREE.Box3(
      new THREE.Vector3(hull.pos.x - hull.size.x / 2, deck + 0.01, hull.pos.z - hull.size.z / 2),
      new THREE.Vector3(hull.pos.x + hull.size.x / 2, deck + 1.9, hull.pos.z + hull.size.z / 2),
    );
    reach.expandByVector(new THREE.Vector3(0, 0, -0.2));
    for (const b of island.boxes.filter((x) => x.model === 'mast')) {
      const mast = makeProp(b, island)!;
      mast.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      mast.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const pos = o.geometry.attributes.position!;
        for (let k = 0; k < pos.count; k++) {
          p.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
          // (Bar the mast itself, round its foot.)
          if (!reach.containsPoint(p) || Math.hypot(p.x - b.pos.x, p.z - b.pos.z) < 0.3) continue;
          expect.fail(
            `mast at ${b.pos.x}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
          );
        }
      });
    }
  });

  it('draws a barrel in a thousand-odd triangles, its shadow cast by a plain drum inside it', () => {
    // There are a couple of dozen on the island, with the bins, and the shadow map draws what
    // casts again: a drum of a few dozen triangles just inside its staves casts the shadow its
    // staves and hoops would.
    for (const model of ['barrel', 'barrelBin'] as const) {
      const { prop } = islandProp(model);
      let triangles = 0;
      let casting = 0;
      const cores: THREE.Mesh[] = [];
      prop.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.geometry.type === 'BoxGeometry') return;
        const g = o.geometry as THREE.BufferGeometry;
        const n = (g.index ?? g.attributes.position!).count / 3;
        triangles += n;
        if (o.castShadow) casting += n;
        if (o.name === 'shadow core') cores.push(o);
      });
      expect(triangles, model).toBeLessThan(1600);
      expect(casting, model).toBeLessThan(150);
      // The drum casts, and fills the barrel near enough for its shadow to be the barrel's.
      expect(cores.length, model).toBe(1);
      expect(cores[0]!.castShadow, model).toBe(true);
      const barrel = bounds(prop).getSize(new THREE.Vector3());
      const drum = bounds(cores[0]!).getSize(new THREE.Vector3());
      for (const axis of ['x', 'y', 'z'] as const)
        expect(drum[axis] / barrel[axis], `${model} ${axis}`).toBeGreaterThan(0.85);
    }
  });

  it("casts the shadows of a rope fence's ropes and the bridge rail's", () => {
    // A few centimetres thick, they throw lines across the bridge's deck and the sand.
    for (const model of ['ropeFence', 'ropeRail'] as const) {
      const ropes: THREE.Mesh[] = [];
      islandProp(model).prop.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry.type === 'TubeGeometry') ropes.push(o);
      });
      expect(ropes.length, model).toBeGreaterThanOrEqual(2);
      for (const rope of ropes) expect(rope.castShadow, model).toBe(true);
    }
  });

  it('leaves a barrel bin open, with the bricks thrown in lying down inside it', () => {
    const { b, prop } = islandProp('barrelBin');
    const bricks: THREE.Box3[] = [];
    prop.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.type === 'BoxGeometry') bricks.push(bounds(o));
    });
    expect(bricks.length).toBeGreaterThan(0);
    for (const brick of bricks) {
      // Down under the rim, well in from the staves.
      expect(brick.max.y).toBeLessThan(b.size.y / 2 - 0.08);
      for (const p of [brick.min, brick.max]) expect(Math.hypot(p.x, p.z)).toBeLessThan(0.26);
    }
  });
});

describe("the island's harbour lanterns", () => {
  // Their glow is drawn on a canvas: a stand-in that draws nothing will do.
  const before = (globalThis as { document?: unknown }).document;
  beforeAll(() => {
    const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {}, width: 100 }) });
    Object.assign(globalThis, {
      document: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
    });
  });
  afterAll(() => {
    Object.assign(globalThis, { document: before });
  });

  /** Which way along x and z each front faces. */
  const AHEAD = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] } as const;

  it("hangs each lantern out in front of its post, its glass at about a lamp post's", () => {
    const posts = island.boxes.filter((b) => b.model === 'lanternPost');
    expect(posts.length).toBeGreaterThan(0);
    for (const b of posts) {
      const prop = makeProp(b, island)!;
      prop.updateMatrixWorld(true);
      const lights: THREE.PointLight[] = [];
      prop.traverse((o) => {
        if (o instanceof THREE.PointLight) lights.push(o);
      });
      // It lights the night as a lamp post does, from its glass.
      expect(lights.length).toBe(1);
      const glass = lights[0]!.getWorldPosition(new THREE.Vector3());
      const name = `lantern at ${b.pos.x}, ${b.pos.z}`;
      expect(glass.y - groundHeight(island, glass.x, glass.z), name).toBeGreaterThan(1.95);
      expect(glass.y - groundHeight(island, glass.x, glass.z), name).toBeLessThan(2.35);
      const [ax, az] = AHEAD[b.front ?? '-z'];
      const out = (glass.x - b.pos.x) * ax + (glass.z - b.pos.z) * az;
      expect(out, name).toBeGreaterThan(Math.max(b.size.x, b.size.z) / 2 + 0.3);
    }
  });

  it("keeps what reaches out of a lantern post's box over the heads of those under it", () => {
    for (const b of island.boxes.filter((x) => x.model === 'lanternPost')) {
      const prop = makeProp(b, island)!;
      prop.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      prop.traverse((o) => {
        // (Bar the glow's pool on the ground.)
        if (!(o instanceof THREE.Mesh) || (o.material as THREE.Material).transparent) return;
        const pos = o.geometry.attributes.position!;
        for (let k = 0; k < pos.count; k++) {
          p.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
          const inside =
            Math.abs(p.x - b.pos.x) < b.size.x / 2 + 0.03 &&
            Math.abs(p.z - b.pos.z) < b.size.z / 2 + 0.03;
          if (!inside)
            expect(p.y - groundHeight(island, p.x, p.z), `${b.pos.x}, ${b.pos.z}`).toBeGreaterThan(
              2 * PLAYER_FEET,
            );
        }
      });
    }
  });
});
