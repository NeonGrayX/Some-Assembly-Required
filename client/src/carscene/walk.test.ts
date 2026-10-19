import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BALCONY, BIG_HOUSE_BODY, DOOR, STAIR } from './bighouse.ts';
import { HOUSE_BODY, HOUSE_DOOR } from './house.ts';
import { BUS_BACK_DOOR, BUS_BODY, BUS_CABIN, BUS_DOOR, BUS_LOW } from './bus.ts';
import { HOVER } from './car.ts';
import { CAR_DOOR, CarDoors, doorsIn } from './doors.ts';
import type { Swing } from './doors.ts';
import { MeshWalker } from './meshWalk.ts';
import {
  BIG_HOUSE_PLACE,
  BUS_PLACE,
  BUS_STOP,
  DRESSING,
  EDGES,
  HOUSE_PLACE,
  JOB_SITE,
  buildCarScene,
} from './scene.ts';
import { STREET } from './street.ts';
import { START, carWalk, slideDoors } from './walk.ts';

await RAPIER.init();
const scene = buildCarScene();
const walk = carWalk(scene);
const carDoors = new CarDoors(doorsIn(scene.root));
const w = new MeshWalker(
  RAPIER,
  [
    scene.car.root,
    scene.sports.root,
    scene.bus.root,
    scene.house,
    scene.bigHouse,
    scene.street,
    scene.machines,
    scene.site,
    ...scene.cones,
  ],
  (o) => o.name === CAR_DOOR || o.name === 'door',
);

/** A frame of the map going on: the houses' doors sliding, the vehicles' swinging. */
function tick(): void {
  slideDoors(walk.doors, w.pos, 1 / 60);
  carDoors.update(1 / 60, null);
}

/** Walks toward (`x`, `z`) for `seconds`, as a player holding a key would. */
function toward(x: number, z: number, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) {
    const [dx, dz] = [x - w.pos.x, z - w.pos.z];
    const d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    w.update(1 / 60, { x: dx / d, z: dz / d, run: false, jump: false });
    tick();
  }
}

/** Where (`x`, `z`) in the small house's own axes is in the world. */
function inHouse(x: number, z: number): [number, number] {
  const [c, s] = [Math.cos(HOUSE_PLACE.heading), Math.sin(HOUSE_PLACE.heading)];
  return [HOUSE_PLACE.x + x * c + z * s, HOUSE_PLACE.z - x * s + z * c];
}

describe('walking about the car test map', () => {
  it('starts the player on the pavement, clear of everything', () => {
    w.spawn(START.x, START.z);
    expect(w.pos.y).toBeCloseTo(0.15, 1);
    const at = w.pos.clone();
    for (let k = 0; k < 30; k++) w.update(1 / 60, { x: 0, z: 0, run: false, jump: false });
    expect(w.pos.distanceTo(at)).toBeLessThan(0.02);
  });

  it('walks across the street, up the steps and in at the big house door', () => {
    const doorZ = BIG_HOUSE_PLACE.z + BIG_HOUSE_BODY.half;
    const x = BIG_HOUSE_PLACE.x + DOOR.at;
    w.spawn(x, -17);
    toward(x, doorZ - 1.5, 6);
    expect(w.pos.z).toBeCloseTo(doorZ - 1.5, 1);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
  });

  it('climbs the big house stair to the floor above', () => {
    const { x, z } = BIG_HOUSE_PLACE;
    const iz = BIG_HOUSE_BODY.half - BIG_HOUSE_BODY.wall;
    const sz = z - iz + STAIR.width / 2 + 0.02;
    w.spawn(x + STAIR.x - 0.6, sz, 1);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
    toward(x + STAIR.x + STAIR.run + 1.0, sz, 4);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.floor + 0.2, 1);
    expect(w.pos.x).toBeCloseTo(x + STAIR.x + STAIR.run + 1.0, 1);
  });

  it('walks in under the stair where it is high enough, and no further', () => {
    const { x, z } = BIG_HOUSE_PLACE;
    const iz = BIG_HOUSE_BODY.half - BIG_HOUSE_BODY.wall;
    const under = z - iz + 0.4;
    // In from the kitchen under its high end, then along the back wall toward its foot.
    w.spawn(x + 1.8, z - 1.2, 1);
    toward(x + 1.8, under, 2);
    expect(w.pos.z).toBeCloseTo(under, 1);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
    toward(x + STAIR.x, under, 4);
    expect(w.pos.y).toBeCloseTo(BIG_HOUSE_BODY.plinth, 1);
    // Stopped where the treads come down to a head's height.
    expect(w.pos.x).toBeGreaterThan(x + STAIR.x + STAIR.run * 0.45);
    expect(w.pos.x).toBeLessThan(x + STAIR.x + STAIR.run * 0.75);
  });

  it('walks out through the glass door onto the balcony, and the rail keeps them on it', () => {
    const { x, z } = BIG_HOUSE_PLACE;
    const up = BIG_HOUSE_BODY.floor + 0.2;
    w.spawn(x + 0.2, z + BIG_HOUSE_BODY.half - 1.2, up + 0.1);
    expect(w.pos.y).toBeCloseTo(up, 2);
    toward(x + 0.2, z + BIG_HOUSE_BODY.half + BALCONY.out + 1, 3);
    expect(w.pos.y).toBeCloseTo(up, 2);
    expect(w.pos.z).toBeGreaterThan(z + BIG_HOUSE_BODY.half + 0.5);
    expect(w.pos.z).toBeLessThan(z + BIG_HOUSE_BODY.half + BALCONY.out);
  }, 20000);

  it('keeps the player out through the small house wall, in through its door', () => {
    const out = inHouse(HOUSE_BODY.depth + 1.2, 1.2);
    const into = inHouse(0, 1.2);
    w.spawn(...out);
    toward(...into, 2);
    const [hx] = inHouse(HOUSE_BODY.depth, 1.2);
    expect(Math.abs(w.pos.x - into[0])).toBeGreaterThan(Math.abs(hx - into[0]));
    const door = inHouse(HOUSE_BODY.depth + 1.0, HOUSE_DOOR.at);
    const inside = inHouse(HOUSE_BODY.depth - 0.9, HOUSE_DOOR.at);
    w.spawn(...door);
    toward(...inside, 2);
    expect(Math.hypot(w.pos.x - inside[0], w.pos.z - inside[1])).toBeLessThan(0.1);
    expect(w.pos.y).toBeCloseTo(HOUSE_BODY.plinth, 1);
  });

  it('stops the player at the cars', () => {
    w.spawn(0, 4);
    toward(0, 0, 2);
    expect(w.pos.z).toBeGreaterThan(1);
  });

  it('holds the cars to their shape: in past the wheels to the side between them', () => {
    w.spawn(0, -3);
    toward(0, 0, 2);
    // The off-roader's wheels stand out to 1.44 m; between them its side is in at about 1 m.
    expect(w.pos.z).toBeLessThan(-1.3);
    expect(w.pos.z).toBeGreaterThan(-1.5);
  });

  it('stops the player at a car’s door where it stands open, as it swings', () => {
    const hinges = doorsIn(scene.car.root).filter((d) => d.userData.axis === 'y');
    const swing = (open: boolean) => {
      for (const d of hinges)
        Object.assign(d.userData.swing as Swing, { t: open ? 1 : 0, shut: !open });
      tick();
    };
    // Along the off-roader's side, clear of its wheels and mirrors, from between its doors.
    const walkBy = () => {
      w.spawn(-0.2, -1.7);
      toward(0.9, -1.7, 2);
      return w.pos.x;
    };
    swing(false);
    expect(walkBy()).toBeCloseTo(0.9, 1);
    // Open, the front door stands out across the way.
    swing(true);
    expect(walkBy()).toBeLessThan(0.3);
    swing(false);
  });

  it('walks between the off-roader’s nose and the cone before it, upright', () => {
    w.spawn(3.1, -0.2);
    let squeezed = false;
    for (let t = 0; t < 3; t += 1 / 60) {
      toward(2.3, -3.0, 1 / 60);
      squeezed ||= w.squeeze !== null;
    }
    expect(Math.hypot(w.pos.x - 2.3, w.pos.z + 3.0)).toBeLessThan(0.1);
    expect(squeezed).toBe(false);
  });

  it('squeezes side-on between the off-roader’s tail and the cone behind it, either way', () => {
    const a: [number, number] = [-3.6, -1.45];
    const b: [number, number] = [-1.6, -1.95];
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      w.spawn(...from);
      let side = false;
      for (let t = 0; t < 4; t += 1 / 60) {
        toward(...to, 1 / 60);
        if (w.squeeze) {
          side = true;
          // Turned side-on, their right the way they edge.
          const way = Math.atan2(-w.squeeze.x, -w.squeeze.z);
          expect(Math.cos(w.heading - way)).toBeCloseTo(0, 5);
        }
      }
      expect(side).toBe(true);
      expect(Math.hypot(w.pos.x - to[0], w.pos.z - to[1])).toBeLessThan(0.1);
      // And facing the usual way again, out the far side.
      expect(w.squeeze).toBeNull();
    }
  });

  it('squeezes there holding straight on, never slipping in past the cone or the car', () => {
    w.spawn(-3.6, -1.45);
    const [ux, uz] = [2.0 / Math.hypot(2.0, 0.5), -0.5 / Math.hypot(2.0, 0.5)];
    let side = false;
    for (let t = 0; t < 3; t += 1 / 60) {
      w.update(1 / 60, { x: ux, z: uz, run: false, jump: false });
      side ||= w.squeeze !== null;
      // On the ground all the way, not up over either (until, well past them, it steps up onto
      // the job site's pad).
      if (w.pos.x < 3) expect(w.pos.y).toBeLessThan(0.05);
    }
    expect(side).toBe(true);
    expect(w.squeeze).toBeNull();
    expect(w.pos.x).toBeGreaterThan(0);
  });

  it('does not squeeze at a wall, nor at a car’s side', () => {
    const ways: [number, number][][] = [
      [inHouse(HOUSE_BODY.depth + 1.2, 1.2), inHouse(0, 1.2)],
      [
        [0, -3],
        [0, 0],
      ],
    ];
    for (const [from, to] of ways) {
      w.spawn(...from!);
      for (let t = 0; t < 2; t += 1 / 60) {
        toward(...to!, 1 / 60);
        expect(w.squeeze).toBeNull();
      }
    }
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

  it('walks up into the bus at its door, down the aisle, out of its back door and in again up its step', () => {
    const swings = new Set(doorsIn(scene.bus.root).map((d) => d.userData.swing as Swing));
    const doors = (open: boolean) => {
      for (const sw of swings) Object.assign(sw, { t: open ? 1 : 0, shut: !open });
      tick();
    };
    // Where (`x`, `z`) in the bus's own axes is in the world.
    const at = (x: number, z: number): [number, number] => [BUS_PLACE.x + x, BUS_PLACE.z + z];
    const mid = (BUS_DOOR.x0 + BUS_DOOR.x1) / 2;
    const floor = HOVER - BUS_LOW + BUS_CABIN.floor;
    // Shut, the door keeps them out.
    doors(false);
    w.spawn(...at(mid, BUS_BODY.half + 1.2));
    toward(...at(mid, 0.2), 3);
    expect(w.pos.z).toBeGreaterThan(at(0, BUS_CABIN.inner)[1]);
    // Open, up the steps and in, back along the aisle, and out at the tail.
    doors(true);
    w.spawn(...at(mid, BUS_BODY.half + 1.2));
    toward(...at(mid, 0.1), 3);
    expect(w.pos.y).toBeCloseTo(floor, 1);
    expect(w.pos.z).toBeCloseTo(at(0, 0.1)[1], 1);
    toward(...at(0.6, 0), 2);
    toward(...at(BUS_BODY.rear + 0.6, 0), 6);
    expect(w.pos.x).toBeCloseTo(at(BUS_BODY.rear + 0.6, 0)[0], 1);
    expect(w.pos.y).toBeCloseTo(floor, 1);
    toward(...at(BUS_BODY.rear - 1.2, 0), 3);
    expect(w.pos.x).toBeCloseTo(at(BUS_BODY.rear - 1.2, 0)[0], 1);
    // Back in up the steps let into its bumper, and out again.
    toward(...at(BUS_BODY.rear + 0.6, 0), 3);
    expect(w.pos.x).toBeCloseTo(at(BUS_BODY.rear + 0.6, 0)[0], 1);
    expect(w.pos.y).toBeCloseTo(floor, 1);
    toward(...at(BUS_BODY.rear - 1.2, 0), 3);
    // And shut, the back door keeps them out at the tail.
    doors(false);
    toward(...at(BUS_BODY.rear + 0.6, 0), 3);
    expect(w.pos.x).toBeLessThan(at(BUS_BODY.rear, 0)[0]);
    expect(BUS_BACK_DOOR.half * 2).toBeGreaterThan(0.64);
  }, 20000);
});

describe("walking into the map's fittings", () => {
  it('steps up onto the job site’s pad', () => {
    w.spawn(JOB_SITE.x + 2.6, JOB_SITE.z);
    toward(JOB_SITE.x, JOB_SITE.z, 3);
    expect(w.pos.x).toBeCloseTo(JOB_SITE.x, 1);
    expect(w.pos.y).toBeGreaterThan(0.03);
  });

  it('walks in under the bus stop’s roof, and no further than its seat', () => {
    w.spawn(BUS_STOP.x, BUS_STOP.z - 1.7);
    toward(BUS_STOP.x, BUS_STOP.z - 0.1, 3);
    expect(w.pos.z).toBeCloseTo(BUS_STOP.z - 0.1, 1);
    expect(w.pos.y).toBeLessThan(0.05);
    toward(BUS_STOP.x, BUS_STOP.z + 1.5, 2);
    expect(w.pos.z).toBeLessThan(BUS_STOP.z + 0.6);
    expect(w.pos.y).toBeLessThan(0.05);
  });

  it('is stopped by the road barriers, the hoarding and the skip, not up over them', () => {
    const { inset } = EDGES.barriers;
    const { skip } = DRESSING;
    const ways: [[number, number], [number, number], (x: number, z: number) => boolean][] = [
      [[STREET.x0 + 3, -15], [STREET.x0 - 2, -15], (x) => x > STREET.x0 + inset],
      [[EDGES.hoarding.x - 1.5, -5], [EDGES.hoarding.x + 2, -5], (x) => x < EDGES.hoarding.x],
      [[skip.x, skip.z - 2.2], [skip.x, skip.z], (_, z) => z < skip.z - 0.75],
    ];
    for (const [from, to, short] of ways) {
      w.spawn(...from);
      toward(...to, 3);
      expect(short(w.pos.x, w.pos.z)).toBe(true);
      expect(w.pos.y).toBeLessThan(0.2);
    }
  });
});
