import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Walker } from '../testmap/walk.ts';
import { BALCONY, BIG_HOUSE_BODY, DOOR, STAIR } from './bighouse.ts';
import { HOUSE_BODY, HOUSE_DOOR } from './house.ts';
import { BUS_BACK_DOOR, BUS_BODY, BUS_CABIN, BUS_DOOR } from './bus.ts';
import { HOVER } from './car.ts';
import { BIG_HOUSE_PLACE, BUS_PLACE, HOUSE_PLACE, buildCarScene } from './scene.ts';
import { START, carWalk, gateDoors, slideDoors } from './walk.ts';

const scene = buildCarScene();
const walk = carWalk(scene);
const walker = () => new Walker(walk.solids, () => 0, -100);

/** Walks `w` toward (`x`, `z`) for `seconds`, as a player holding a key would. */
function toward(w: Walker, x: number, z: number, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    const [dx, dz] = [x - w.pos.x, z - w.pos.z];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    w.update(1 / 60, { x: dx / d, z: dz / d, run: false, jump: false });
  }
}

/** Where (`x`, `z`) in the small house's own axes is in the world. */
function inHouse(x: number, z: number): [number, number] {
  const [c, s] = [Math.cos(HOUSE_PLACE.heading), Math.sin(HOUSE_PLACE.heading)];
  return [HOUSE_PLACE.x + x * c + z * s, HOUSE_PLACE.z - x * s + z * c];
}

describe('walking about the car test map', () => {
  it('starts the player on the pavement, clear of everything', () => {
    const w = walker();
    w.spawn(START.x, START.z);
    expect(w.pos.y).toBeCloseTo(0.15, 2);
    const at = w.pos.clone();
    walk.solids.pushOut(w.pos);
    expect(w.pos.distanceTo(at)).toBeLessThan(1e-6);
  });

  it('walks across the street, up the steps and in at the big house door', () => {
    const w = walker();
    const doorZ = BIG_HOUSE_PLACE.z + BIG_HOUSE_BODY.half;
    const x = BIG_HOUSE_PLACE.x + DOOR.at;
    w.spawn(x, -17);
    toward(w, x, doorZ - 1.5, 6);
    expect(w.pos.z).toBeCloseTo(doorZ - 1.5, 1);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
  });

  it('climbs the big house stair to the floor above', () => {
    const w = walker();
    const { x, z } = BIG_HOUSE_PLACE;
    const iz = BIG_HOUSE_BODY.half - BIG_HOUSE_BODY.wall;
    const sz = z - iz + STAIR.width / 2 + 0.02;
    w.spawn(x + STAIR.x - 0.6, sz, 1);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
    toward(w, x + STAIR.x + STAIR.run + 1.0, sz, 4);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.floor + 0.2, 1);
    expect(w.pos.x).toBeCloseTo(x + STAIR.x + STAIR.run + 1.0, 1);
  });

  it('walks in under the stair where it is high enough, and no further', () => {
    const w = walker();
    const { x, z } = BIG_HOUSE_PLACE;
    const iz = BIG_HOUSE_BODY.half - BIG_HOUSE_BODY.wall;
    const under = z - iz + 0.4;
    // In from the kitchen under its high end, then along the back wall toward its foot.
    w.spawn(x + 1.8, z - 1.2, 1);
    toward(w, x + 1.8, under, 2);
    expect(w.pos.z).toBeCloseTo(under, 1);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
    toward(w, x + STAIR.x, under, 4);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
    // Stopped where the treads come down to a head's height.
    expect(w.pos.x).toBeGreaterThan(x + STAIR.x + STAIR.run * 0.45);
    expect(w.pos.x).toBeLessThan(x + STAIR.x + STAIR.run * 0.75);
  });

  it('walks out through the glass door onto the balcony, and the rail keeps them on it', () => {
    const w = walker();
    const { x, z } = BIG_HOUSE_PLACE;
    const up = BIG_HOUSE_BODY.floor + 0.2;
    w.spawn(x + 0.2, z + BIG_HOUSE_BODY.half - 1.2, up + 0.1);
    expect(w.pos.y).toBeCloseTo(up, 2);
    toward(w, x + 0.2, z + BIG_HOUSE_BODY.half + BALCONY.out + 1, 3);
    expect(w.pos.y).toBeCloseTo(up, 2);
    expect(w.pos.z).toBeGreaterThan(z + BIG_HOUSE_BODY.half + 0.5);
    expect(w.pos.z).toBeLessThan(z + BIG_HOUSE_BODY.half + BALCONY.out);
  });

  it('keeps the player out through the small house wall, in through its door', () => {
    const w = walker();
    const out = inHouse(HOUSE_BODY.depth + 1.2, 1.2);
    const into = inHouse(0, 1.2);
    w.spawn(...out);
    toward(w, ...into, 2);
    const [hx] = inHouse(HOUSE_BODY.depth, 1.2);
    expect(Math.abs(w.pos.x - into[0])).toBeGreaterThan(Math.abs(hx - into[0]));
    const door = inHouse(HOUSE_BODY.depth + 1.0, HOUSE_DOOR.at);
    const inside = inHouse(HOUSE_BODY.depth - 0.9, HOUSE_DOOR.at);
    w.spawn(...door);
    toward(w, ...inside, 2);
    expect(Math.hypot(w.pos.x - inside[0], w.pos.z - inside[1])).toBeLessThan(0.1);
    expect(w.pos.y).toBeCloseTo(HOUSE_BODY.plinth, 1);
  });

  it('stops the player at the cars', () => {
    const w = walker();
    w.spawn(0, 4);
    toward(w, 0, 0, 2);
    expect(w.pos.z).toBeGreaterThan(1);
  });

  it('gives the camera the lamps and the lights up to their heads, not only their feet', () => {
    const tall = scene.street.children
      .filter((c) => c.name === 'prop')
      .map((c) => new THREE.Box3().setFromObject(c))
      .filter((b) => b.max.y > 3);
    expect(tall.length).toBeGreaterThan(3);
    const boxes = walk.camera.children.map((m) => new THREE.Box3().setFromObject(m));
    for (const prop of tall) {
      const top = Math.max(...boxes.filter((b) => b.intersectsBox(prop)).map((b) => b.max.y));
      expect(top).toBeGreaterThan(prop.max.y - 0.05);
    }
  });

  it('keeps a room round the inside of each house and the bus for the camera', () => {
    expect(walk.rooms).toHaveLength(3);
    for (const r of walk.rooms) expect(r.box.min.y).toBeGreaterThan(0.3);
  });

  it('finds the houses’ doors: the two front doors and the glass door’s two leaves', () => {
    expect(walk.doors).toHaveLength(4);
  });

  it('slides each door into its wall as the player comes near, and shut as they go', () => {
    const at = new THREE.Vector3();
    for (const d of walk.doors) {
      const home = d.position.x;
      d.parent!.localToWorld(at.copy(d.position));
      const near = at.clone().setY(at.y - 1);
      for (let k = 0; k < 120; k++) slideDoors([d], near, 1 / 60);
      expect(d.position.x - home).toBeCloseTo(d.userData.slide as number, 2);
      const far = near.clone().setX(near.x + 10);
      for (let k = 0; k < 120; k++) slideDoors([d], far, 1 / 60);
      expect(d.position.x).toBeCloseTo(home, 2);
    }
  });

  it('walks up into the bus at its door, down the aisle and out of its back door', () => {
    const swings = new Set(walk.gates.map((g) => g.swing));
    const doors = (open: boolean) => {
      for (const sw of swings) Object.assign(sw, { t: open ? 1 : 0, shut: !open });
      gateDoors(walk.gates);
    };
    // Where (`x`, `z`) in the bus's own axes is in the world.
    const at = (x: number, z: number): [number, number] => [BUS_PLACE.x + x, BUS_PLACE.z + z];
    const mid = (BUS_DOOR.x0 + BUS_DOOR.x1) / 2;
    const floor = HOVER + BUS_CABIN.floor;
    const w = walker();
    // Shut, the door keeps them out.
    doors(false);
    w.spawn(...at(mid, BUS_BODY.half + 1.2));
    toward(w, ...at(mid, 0.2), 3);
    expect(w.pos.z).toBeGreaterThan(at(0, BUS_CABIN.inner)[1]);
    // Open, up the steps and in, back along the aisle, and out at the tail.
    doors(true);
    w.spawn(...at(mid, BUS_BODY.half + 1.2));
    toward(w, ...at(mid, 0.1), 3);
    expect(w.pos.y).toBeCloseTo(floor, 1);
    expect(w.pos.z).toBeCloseTo(at(0, 0.1)[1], 1);
    toward(w, ...at(0.6, 0), 2);
    toward(w, ...at(BUS_BODY.rear + 0.6, 0), 6);
    expect(w.pos.x).toBeCloseTo(at(BUS_BODY.rear + 0.6, 0)[0], 1);
    expect(w.pos.y).toBeCloseTo(floor, 1);
    toward(w, ...at(BUS_BODY.rear - 1.2, 0), 3);
    expect(w.pos.x).toBeCloseTo(at(BUS_BODY.rear - 1.2, 0)[0], 1);
    // And shut, the back door keeps them out at the tail.
    doors(false);
    toward(w, ...at(BUS_BODY.rear + 0.6, 0), 3);
    expect(w.pos.x).toBeLessThan(at(BUS_BODY.rear, 0)[0]);
    expect(BUS_BACK_DOOR.half * 2).toBeGreaterThan(0.64);
  });
});
