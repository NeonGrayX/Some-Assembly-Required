import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildBus } from './bus.ts';
import { HOVER, buildCar } from './car.ts';
import type { Car } from './car.ts';
import { CarDoors, doorsIn, notch } from './doors.ts';
import type { Swing } from './doors.ts';
import { buildSportsCar } from './sportscar.ts';

const v = (x: number, y: number) => new THREE.Vector2(x, y);
const area = (ps: THREE.Vector2[]) => Math.abs(THREE.ShapeUtils.area(ps));

/** The three vehicles, built once: the off-roader standing where the map has it. */
let car: Car, sports: Car, bus: Car;
beforeAll(() => {
  [car, sports, bus] = [buildCar(), buildSportsCar(), buildBus()];
  car.root.position.y = HOVER;
  car.root.updateMatrixWorld(true);
}, 120_000);

describe("the vehicles' doors", { timeout: 60_000 }, () => {
  it('cuts a door out of an outline, from an edge across it up to its top', () => {
    const square = [v(0, 0), v(4, 0), v(4, 2), v(0, 2)];
    const { rest, piece } = notch(square, [v(1, 0.5), v(3, 0.5)], true);
    expect(area(piece)).toBeCloseTo(3);
    expect(area(rest)).toBeCloseTo(5);
    const below = notch(square, [v(1, 1.5), v(3, 1.5)], false);
    expect(area(below.piece)).toBeCloseTo(3);
  });

  it('hangs four doors and a tailgate on the off-roader, two on the sports car and the bus door’s two leaves', () => {
    const doors = (c: Car) => doorsIn(c.root).filter((d) => d.userData.axis === 'y');
    expect(doors(car)).toHaveLength(5);
    expect(doors(sports)).toHaveLength(2);
    expect(doors(bus)).toHaveLength(2);
  });

  it('hangs a bonnet on each, and a boot lid on the sports car and a tailgate on the off-roader', () => {
    const lids = (c: Car) => doorsIn(c.root).map((d) => d.userData.what as string | undefined);
    expect(lids(car).filter(Boolean).sort()).toEqual(['bonnet', 'tailgate']);
    expect(lids(sports).filter(Boolean).sort()).toEqual(['bonnet', 'boot']);
    expect(lids(bus).filter(Boolean)).toEqual(['bonnet']);
  });

  it('lifts a bonnet at its nose and a boot lid at its tail', () => {
    const lid = (what: string) => doorsIn(sports.root).find((d) => d.userData.what === what)!;
    const [hood, boot] = [lid('bonnet'), lid('boot')];
    const doors = new CarDoors([hood, boot]);
    const tops = () => [hood, boot].map((d) => new THREE.Box3().setFromObject(d).max.y);
    const before = tops();
    for (const d of [hood, boot]) {
      doors.aimed = d;
      expect(doors.hint()).toEqual([{ control: 'use', text: `open the ${d.userData.what}` }]);
      doors.click();
    }
    doors.update(1, null);
    sports.root.updateMatrixWorld(true);
    const after = tops();
    expect(after[0]).toBeGreaterThan(before[0]! + 0.5);
    expect(after[1]).toBeGreaterThan(before[1]! + 0.15);
  });

  it('swings a door open with a click on it, out from the body, and shut with another', () => {
    const doors = new CarDoors(doorsIn(car.root));
    const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 100);
    // Before the off-roader's right front door, looking at it.
    camera.position.set(0.2, 1.8, 4.6);
    camera.lookAt(0.2, 1.4, 1);
    camera.updateMatrixWorld();
    const aim = { camera, head: new THREE.Vector3(0.2, 1.7, 2.6) };
    doors.update(0, aim);
    expect(doors.hint()).toEqual([{ control: 'use', text: 'open the door' }]);
    const door = doors.aimed!;
    const before = new THREE.Box3().setFromObject(door);
    expect(doors.click()).toBe(true);
    for (let t = 0; t < 1; t += 1 / 30) doors.update(1 / 30, null);
    expect((door.userData.swing as Swing).t).toBe(1);
    door.updateMatrixWorld(true);
    expect(new THREE.Box3().setFromObject(door).max.z).toBeGreaterThan(before.max.z + 0.5);
    // Swung out of the way of that look: clicked where it is now.
    doors.aimed = door;
    expect(doors.hint()).toEqual([{ control: 'use', text: 'shut the door' }]);
    doors.click();
    for (let t = 0; t < 1; t += 1 / 30) doors.update(1 / 30, null);
    expect(door.rotation.y).toBe(0);
  });

  it('swings both leaves of the bus door together', () => {
    const [a, b] = doorsIn(bus.root).filter((d) => d.userData.axis === 'y');
    const doors = new CarDoors([a!, b!]);
    doors.aimed = a!;
    doors.click();
    doors.update(1, null);
    expect(a!.rotation.y).not.toBe(0);
    expect(b!.rotation.y).toBeCloseTo(-a!.rotation.y);
  });
});
