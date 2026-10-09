import * as THREE from 'three';
import { groundPieces, levelSites } from '@sar/shared';
import type { HideoutState, LevelDef } from '@sar/shared';
import { addHouseDetails, cutWindows, levelWindows, windowOpenings } from './details.ts';
import { Furniture, HIDEOUT_TRAVEL } from './furniture.ts';
import { isFence, makeBin, makeFence, makeHandrail, makeProp } from './props.ts';
import { groundAt, makeBell, makeCatapult, makeDoneButton } from './stations.ts';
import { makePole } from './gear.ts';

/**
 * The level's models built as `View` builds them, each named for what it belongs to, for the
 * model checks (see `models.test.ts` and `coplanar.ts`). Nothing is merged, so every piece
 * keeps its own mesh.
 */
export interface LevelModels {
  root: THREE.Group;
  furniture: Furniture;
  /** What each top-level object under `root` is. */
  owner(o: THREE.Object3D): string;
  /** Opens or shuts every hiding place, `fraction` of the way. */
  open(fraction: number): void;
}

const where = (p: { x: number; y: number; z: number }) =>
  `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;

export function buildLevelModels(level: LevelDef): LevelModels {
  const root = new THREE.Group();
  const names = new Map<THREE.Object3D, string>();
  const put = (name: string, ...objs: THREE.Object3D[]) => {
    for (const o of objs) {
      names.set(o, name);
      root.add(o);
    }
  };
  const ground = new THREE.MeshStandardMaterial({ color: level.groundColour ?? 0xc9b48f });
  for (const q of groundPieces(level)) {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(q.x1 - q.x0, q.z1 - q.z0), ground);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((q.x0 + q.x1) / 2, 0, (q.z0 + q.z1) / 2);
    put('ground', floor);
  }
  const openings = windowOpenings(level, levelWindows(level));
  for (const b of level.boxes) {
    const name = `${b.model ?? (isFence(b) ? 'fence' : 'wall')} at ${where(b.pos)}`;
    const prop = makeProp(b, level) ?? (isFence(b) ? makeFence(b) : null);
    if (prop) {
      put(name, prop);
      continue;
    }
    for (const piece of cutWindows(b, openings)) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(piece.size.x, piece.size.y, piece.size.z),
        new THREE.MeshStandardMaterial({ color: piece.colour }),
      );
      mesh.position.set(piece.pos.x, piece.pos.y, piece.pos.z);
      mesh.rotation.x = piece.tiltX ?? 0;
      put(name, mesh);
    }
  }
  for (const s of level.stairs ?? []) put(`handrail at ${where(s.pos)}`, makeHandrail(s));
  for (const bin of level.bins) put(`bin #${bin.id}`, makeBin(bin, level).group);
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf5c518 });
  const frame = (
    name: string,
    cx: number,
    cz: number,
    w: number,
    d: number,
    thick = 0.08,
    y = 0,
  ) => {
    for (const [x, z, sx, sz] of [
      // The long bars run on over the corners and the short ones stop at them, so no bar's end
      // lies in the plane of a side of what it rings.
      [cx, cz - d / 2, w + thick, thick],
      [cx, cz + d / 2, w + thick, thick],
      [cx - w / 2, cz, thick, d - thick],
      [cx + w / 2, cz, thick, d - thick],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.006, sz), yellow);
      m.position.set(x, y + 0.0035, z);
      put(name, m);
    }
  };
  const before = new Set(root.children);
  const furniture = new Furniture(root, level);
  for (const child of root.children) {
    if (before.has(child)) continue;
    const h = level.hideouts.find(
      (h) =>
        Math.abs(h.pos.x - child.position.x) < 1e-6 &&
        Math.abs(h.pos.y - child.position.y) < 1e-6 &&
        Math.abs(h.pos.z - child.position.z) < 1e-6,
    );
    names.set(
      child,
      h
        ? `${h.kind} #${h.id}`
        : level.lights.some(
              (l) => child.position.distanceTo(new THREE.Vector3(l.x, l.y, l.z)) < 1e-6,
            )
          ? `lamp at ${where(child.position)}`
          : child instanceof THREE.Mesh && child.geometry.type === 'PlaneGeometry'
            ? `room floor at ${where(child.position)}`
            : `${child.type} at ${where(child.position)}`,
    );
  }
  const trim = new THREE.Group();
  addHouseDetails(trim, level, levelWindows(level));
  put('trim', trim);
  levelSites(level).forEach((site, i) => {
    const bp = site.baseplate;
    frame(`site ${i} outline`, bp.x + 0.8, bp.z + 0.8, 2.6, 2.6);
    put(`bell ${i}`, makeBell(site.bell));
    put(`done button ${i}`, makeDoneButton(site.doneButton));
    const ins = site.inspector;
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(ins.size.x, 0.008, ins.size.z),
      new THREE.MeshStandardMaterial({ color: 0x2a2d33 }),
    );
    const floor = groundAt(level, ins.pos.x, ins.pos.z);
    pad.position.set(ins.pos.x, floor + 0.004, ins.pos.z);
    put(`inspector ${i}`, pad);
    frame(`inspector ${i} outline`, ins.pos.x, ins.pos.z, ins.size.x, ins.size.z, 0.1, floor);
    const side = i % 2 === 1 ? 1 : -1;
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.35, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
    );
    screen.position.set(ins.pos.x + side * (ins.size.x / 2 + 0.3), 1.5, ins.pos.z);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.9, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x3a3f47 }),
    );
    post.position.set(screen.position.x, 0.45, ins.pos.z);
    put(`inspector ${i} screen`, screen, post);
  });
  if (level.catapult) put('catapult', makeCatapult(level.catapult).group);
  const polePoint = level.dog.points[level.dog.start]!;
  const pole = makePole();
  pole.position.set(polePoint.x + 0.6, polePoint.y, polePoint.z + 0.6);
  put('dog pole', pole);
  for (const jarAt of [level.dog.treatJar, ...(level.dog.treatJars ?? [])]) {
    const biscuits = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.09, 12),
      new THREE.MeshStandardMaterial(),
    );
    biscuits.position.set(jarAt.x, jarAt.y + 0.05, jarAt.z);
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16),
      new THREE.MeshStandardMaterial(),
    );
    lid.position.set(jarAt.x, jarAt.y + 0.175, jarAt.z);
    put(`treat jar at ${where(jarAt)}`, biscuits, lid);
  }
  root.updateMatrixWorld(true);

  const owner = (o: THREE.Object3D) => {
    for (let v: THREE.Object3D | null = o; v; v = v.parent) {
      const n = names.get(v);
      if (n) return n;
    }
    return 'unknown';
  };
  const open = (fraction: number) => {
    const states = (open: boolean) =>
      new Map<number, HideoutState>(
        level.hideouts.map((h) => [h.id, { open, locked: false } as unknown as HideoutState]),
      );
    furniture.invalidate();
    furniture.sync(states(false), 1);
    furniture.sync(states(true), 2);
    furniture.animate(fraction * HIDEOUT_TRAVEL);
    root.updateMatrixWorld(true);
  };
  return { root, furniture, owner, open };
}
