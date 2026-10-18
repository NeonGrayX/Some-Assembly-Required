import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BIG_HOUSE_BODY, BIG_WINDOWS } from './bighouse.ts';
import { MACHINE_SIZE } from '@sar/shared';
import { BODY } from './car.ts';
import { type Face, HOUSE_BODY, HOUSE_WINDOWS, type Opening } from './house.ts';
import { buildCarScene } from './scene.ts';

const scene = buildCarScene();
scene.root.updateMatrixWorld(true);

const boxOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);

/** `o`'s bounds in `frame`'s own axes, exact whatever way `frame` is turned. */
function boxIn(o: THREE.Object3D, frame: THREE.Object3D): THREE.Box3 {
  const toFrame = frame.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    const local = toFrame.clone().multiply(mesh.matrixWorld);
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(local));
  });
  return box;
}

type Pt = [number, number];

/** Whether triangle `t` crosses the rectangle `r` ([x0, y0, x1, y1]), by separating axes. */
function crosses(t: Pt[], r: [number, number, number, number]): boolean {
  const corners: Pt[] = [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[0], r[3]],
    [r[2], r[3]],
  ];
  const apart = (n: Pt, a: Pt[], b: Pt[]) => {
    const pa = a.map(([x, y]) => x * n[0] + y * n[1]);
    const pb = b.map(([x, y]) => x * n[0] + y * n[1]);
    return Math.max(...pa) < Math.min(...pb) || Math.min(...pa) > Math.max(...pb);
  };
  const axes: Pt[] = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < 3; i++) {
    const [a, b] = [t[i]!, t[(i + 1) % 3]!];
    axes.push([b[1] - a[1], a[0] - b[0]]);
  }
  return !axes.some((n) => (n[0] || n[1]) && apart(n, t, corners));
}

/**
 * The window frames (grown by `margin`) on each face of a house, each as the rectangle it covers
 * along the wall and up it, with the wall's inner plane: which axis, at what, and which way is in.
 */
function framesOf(body: typeof HOUSE_BODY, windows: Record<Face, Opening[]>, margin: number) {
  return (Object.entries(windows) as [Face, Opening[]][]).flatMap(([face, list]) => {
    const axis = face[1] === 'x' ? 0 : 2;
    const out = face[0] === '+' ? 1 : -1;
    const inner = out * ((axis === 0 ? body.depth : body.half) - body.wall);
    return list.map((o) => ({
      face,
      axis,
      out,
      inner,
      rect: [
        o.at - o.w / 2 - 0.06 - margin,
        o.y - o.h / 2 - 0.06 - margin,
        o.at + o.w / 2 + 0.06 + margin,
        o.y + o.h / 2 + 0.06 + margin,
      ] as [number, number, number, number],
    }));
  });
}

describe('the car test map', () => {
  it('builds every mesh with sound geometry', () => {
    const broken: string[] = [];
    scene.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.attributes.position!.array;
      if (pos.length === 0 || Array.from(pos).some((v) => !Number.isFinite(v)))
        broken.push(`${mesh.parent?.name ?? ''}/${mesh.geometry.type}`);
    });
    expect(broken).toEqual([]);
  });

  it('stands the car on its wheels, on the ground', () => {
    for (const w of scene.car.wheels) expect(boxOf(w).min.y).toBeCloseTo(0, 3);
    // Nothing of the body hangs below the wheels.
    expect(boxOf(scene.car.root).min.y).toBeGreaterThan(-0.005);
  });

  it('parks the sports car on its wheels beside the off-roader, clear of it', () => {
    for (const w of scene.sports.wheels) expect(boxOf(w).min.y).toBeCloseTo(0, 3);
    expect(boxOf(scene.sports.root).min.y).toBeGreaterThan(-0.005);
    expect(boxOf(scene.sports.root).intersectsBox(boxOf(scene.car.root))).toBe(false);
  });

  it('parks the bus on its wheels beyond the sports car, clear of both cars', () => {
    for (const w of scene.bus.wheels) expect(boxOf(w).min.y).toBeCloseTo(0, 3);
    expect(boxOf(scene.bus.root).min.y).toBeGreaterThan(-0.005);
    expect(boxOf(scene.bus.root).intersectsBox(boxOf(scene.sports.root))).toBe(false);
    expect(boxOf(scene.bus.root).intersectsBox(boxOf(scene.car.root))).toBe(false);
  });

  it('stands the house on the ground behind the cars, clear of them all', () => {
    expect(boxOf(scene.house).min.y).toBeGreaterThan(-0.01);
    expect(boxOf(scene.house).min.y).toBeLessThan(0.01);
    for (const v of [scene.car, scene.sports, scene.bus])
      expect(boxOf(scene.house).intersectsBox(boxOf(v.root))).toBe(false);
  });

  it('stands the big house on the ground across the street, clear of everything', () => {
    const big = boxOf(scene.bigHouse);
    expect(big.min.y).toBeGreaterThan(-0.01);
    expect(big.min.y).toBeLessThan(0.01);
    for (const v of [scene.car, scene.sports, scene.bus])
      expect(big.intersectsBox(boxOf(v.root))).toBe(false);
    expect(big.intersectsBox(boxOf(scene.house))).toBe(false);
    for (const prop of scene.street.children.filter((c) => c.name === 'prop'))
      expect(big.intersectsBox(boxOf(prop))).toBe(false);
  });

  it("keeps both houses' furniture inside their walls, standing on their floors", () => {
    for (const [house, body] of [
      [scene.house, HOUSE_BODY],
      [scene.bigHouse, BIG_HOUSE_BODY],
    ] as const) {
      const pieces = house.children.filter((c) => c.name === 'furniture');
      expect(pieces.length).toBeGreaterThan(8);
      for (const piece of pieces) {
        const box = boxIn(piece, house);
        expect(Math.max(-box.min.x, box.max.x)).toBeLessThan(body.depth - body.wall + 0.02);
        expect(Math.max(-box.min.z, box.max.z)).toBeLessThan(body.half - body.wall + 0.02);
        expect(box.min.y).toBeGreaterThan(body.plinth - 0.005);
        expect(box.max.y).toBeLessThan(body.eave);
      }
    }
  });

  it("keeps both houses' furniture clear of their windows", () => {
    const hits: string[] = [];
    for (const [house, body, windows] of [
      [scene.house, HOUSE_BODY, HOUSE_WINDOWS],
      [scene.bigHouse, BIG_HOUSE_BODY, BIG_WINDOWS],
    ] as const) {
      const frames = framesOf(body, windows, 0.05);
      const toHouse = house.matrixWorld.clone().invert();
      for (const piece of house.children) {
        if (!['furniture', 'stairs', 'rail'].includes(piece.name)) continue;
        piece.traverse((m) => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh) return;
          const local = toHouse.clone().multiply(mesh.matrixWorld);
          const pos = mesh.geometry.attributes.position!;
          const index = mesh.geometry.index;
          const n = index ? index.count : pos.count;
          const p = [0, 0, 0].map(() => new THREE.Vector3());
          for (let i = 0; i < n; i += 3) {
            for (let k = 0; k < 3; k++)
              p[k]!.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k).applyMatrix4(local);
            for (const f of frames) {
              // Only what stands against the wall, within a hand of it.
              const near = Math.min(...p.map((q) => f.out * (f.inner - q.getComponent(f.axis))));
              if (near > 0.15 || near < -0.1) continue;
              const along = f.axis === 0 ? 2 : 0;
              const t = p.map((q): Pt => [q.getComponent(along), q.y]);
              if (crosses(t, f.rect)) {
                hits.push(`${house.name} ${f.face} ${f.rect[0].toFixed(2)}: ${piece.name}`);
                break;
              }
            }
          }
        });
      }
    }
    expect([...new Set(hits)]).toEqual([]);
  });

  it('slides the doors into their walls clear of the windows', () => {
    for (const [house, body, windows] of [
      [scene.house, HOUSE_BODY, HOUSE_WINDOWS],
      [scene.bigHouse, BIG_HOUSE_BODY, BIG_WINDOWS],
    ] as const) {
      const frames = framesOf(body, windows, 0.02);
      const doors = house.getObjectsByProperty('name', 'door');
      expect(doors.length).toBeGreaterThan(0);
      for (const d of doors) {
        const home = d.position.x;
        d.position.x += d.userData.slide as number;
        d.updateMatrixWorld(true);
        const box = boxIn(d, house);
        d.position.x = home;
        d.updateMatrixWorld(true);
        // In the wall's thickness, through no window's frame.
        const thin = box.max.x - box.min.x < box.max.z - box.min.z ? 0 : 2;
        expect(thin === 0 ? box.max.x - box.min.x : box.max.z - box.min.z).toBeLessThan(body.wall);
        for (const f of frames) {
          if (f.axis !== thin) continue;
          const mid = (box.min.getComponent(thin) + box.max.getComponent(thin)) / 2;
          if (Math.abs(mid - (f.inner + (f.out * body.wall) / 2)) > body.wall / 2) continue;
          const along = thin === 0 ? 2 : 0;
          const apart =
            box.max.getComponent(along) < f.rect[0] ||
            box.min.getComponent(along) > f.rect[2] ||
            box.max.y < f.rect[1] ||
            box.min.y > f.rect[3];
          expect(apart).toBe(true);
        }
      }
    }
  });

  it('stands the brick works on its pad east of the cars, each machine at its size, clear of all', () => {
    const kinds = ['silo', 'press', 'dispenser', 'printer'] as const;
    const machines = kinds.map((k) => scene.machines.getObjectByName(k)!);
    const others = [scene.car.root, scene.sports.root, scene.bus.root, scene.house, scene.bigHouse];
    for (const [i, m] of machines.entries()) {
      const box = boxIn(m, m);
      const size = MACHINE_SIZE[kinds[i]!];
      expect(box.min.y).toBeCloseTo(0, 2);
      // Within its box (a little over for handles and lamps that stand proud).
      expect(box.max.x - box.min.x).toBeLessThan(size.x + 0.12);
      expect(box.max.y - box.min.y).toBeLessThan(size.y + 0.25);
      expect(box.max.z - box.min.z).toBeLessThan(size.z + 0.25);
      const world = boxOf(m);
      for (const o of [...others, ...machines.filter((n) => n !== m)])
        expect(world.intersectsBox(boxOf(o))).toBe(false);
      for (const prop of scene.street.children.filter((c) => c.name === 'prop'))
        expect(world.intersectsBox(boxOf(prop))).toBe(false);
    }
  });

  it('lays the street on the ground, its props on the pavement, clear of the vehicles', () => {
    expect(boxOf(scene.street).min.y).toBeGreaterThan(-0.01);
    expect(boxOf(scene.street).min.y).toBeLessThan(0.01);
    const props = scene.street.children.filter((c) => c.name === 'prop');
    expect(props.length).toBeGreaterThan(15);
    for (const prop of props) {
      expect(boxOf(prop).min.y).toBeCloseTo(prop.position.y, 2);
      for (const v of [scene.car, scene.sports, scene.bus])
        expect(boxOf(prop).intersectsBox(boxOf(v.root))).toBe(false);
      expect(boxOf(prop).intersectsBox(boxOf(scene.house))).toBe(false);
    }
  });

  it('keeps the cargo on the roof, above the glasshouse', () => {
    const cargo = scene.car.root.getObjectByName('cargo')!;
    expect(boxOf(cargo).min.y).toBeGreaterThan(BODY.roof);
  });

  it('stands the cones on the ground, the knocked-over one lying on its side', () => {
    for (const cone of scene.cones) expect(boxOf(cone).min.y).toBeCloseTo(0, 2);
    const fallen = boxOf(scene.cones[scene.cones.length - 1]!);
    const size = fallen.getSize(new THREE.Vector3());
    // Longer along the ground than it is tall.
    expect(Math.max(size.x, size.z)).toBeGreaterThan(size.y * 1.5);
  });
});
