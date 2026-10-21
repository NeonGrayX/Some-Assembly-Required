import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BRICK_TYPES, PLATE_H, STUD } from '@sar/shared';
import type { BrickTypeId } from '@sar/shared';
import { brickGeometry } from './bricks.ts';

// A real stud (4.8 mm across, 1.7 mm high, on an 8 mm grid with 3.2 mm plates), as drawn.
const STUD_RADIUS = STUD * 0.3;
const STUD_HEIGHT = PLATE_H * (1.7 / 3.2);

const meshOf = (type: BrickTypeId) =>
  new THREE.Mesh(brickGeometry(type), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const bottomOf = (type: BrickTypeId) => brickGeometry(type).userData.body.min.y as number;

/** Points over the top of a stud standing at (x, z) under the part, round and across it. */
function overStud(x: number, z: number): { x: number; z: number }[] {
  const out = [{ x, z }];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    for (const r of [0.5, 0.97]) {
      out.push({ x: x + Math.cos(a) * r * STUD_RADIUS, z: z + Math.sin(a) * r * STUD_RADIUS });
    }
  }
  return out;
}

/** How much room a part leaves over a stud at (x, z) under it: the lowest thing above it. */
function roomOver(type: BrickTypeId, x: number, z: number): number {
  const mesh = meshOf(type);
  const ray = new THREE.Raycaster();
  let low = Infinity;
  for (const p of overStud(x, z)) {
    ray.set(new THREE.Vector3(p.x, bottomOf(type) - 1e-4, p.z), new THREE.Vector3(0, 1, 0));
    const hit = ray.intersectObject(mesh)[0];
    if (hit) low = Math.min(low, hit.distance - 1e-4);
  }
  return low;
}

/** Studs under each cell, in the part's frame round its centre. */
function cells(type: BrickTypeId): { x: number; z: number }[] {
  const t = BRICK_TYPES[type];
  const out: { x: number; z: number }[] = [];
  for (let x = 0; x < t.studsX; x++)
    for (let z = 0; z < t.studsZ; z++)
      out.push({ x: (x + 0.5 - t.studsX / 2) * STUD, z: (z + 0.5 - t.studsZ / 2) * STUD });
  return out;
}

describe('brick geometry', () => {
  it('leaves room inside a sloped part for the stud it sits on', () => {
    for (const type of ['cheese1x1', 'slope1x2', 'slope2x2', 'slope2x3'] as const) {
      for (const c of cells(type)) {
        expect(roomOver(type, c.x, c.z), `${type} at ${c.x},${c.z}`).toBeGreaterThan(STUD_HEIGHT);
      }
    }
  });

  it("tips a leaf plate's leaves up over the studs round its plate", () => {
    // Its plate in the (0, 0) cell, a stud under each of the other three.
    const [hx, hz] = [-STUD / 2, -STUD / 2];
    for (const [x, z] of [
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      expect(roomOver('leaf2x2', hx + x * STUD, hz + z * STUD), `at ${x},${z}`).toBeGreaterThan(
        STUD_HEIGHT,
      );
    }
  });

  it("keeps a leaf plate's leaves under a part on its stud", () => {
    const mesh = meshOf('leaf2x2');
    const top = (brickGeometry('leaf2x2').userData.body as THREE.Box3).max.y;
    const ray = new THREE.Raycaster();
    // Down onto its plate's cell, round the stud on top.
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const [x, z] = [-STUD + (i / 10) * STUD, -STUD + (j / 10) * STUD];
        if (Math.hypot(x + STUD / 2, z + STUD / 2) < STUD_RADIUS + 1e-3) continue;
        ray.set(new THREE.Vector3(x, top + STUD, z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(mesh)[0];
        if (hit) expect(hit.point.y, `at ${x},${z}`).toBeLessThanOrEqual(top + 1e-6);
      }
  });

  it('notches round and curved walls where they cross a stud', () => {
    const studs: [BrickTypeId, { x: number; z: number }[]][] = [
      ['roundplate2x2', cells('roundplate2x2')],
      ['round2x2', cells('round2x2')],
      ['roundtile2x2', cells('roundtile2x2')],
      ['roundcorner3x3', cells('roundcorner3x3')],
      ['arc3x3', cells('arc3x3')],
    ];
    for (const [type, at] of studs) {
      for (const c of at) {
        expect(roomOver(type, c.x, c.z), `${type} at ${c.x},${c.z}`).toBeGreaterThan(STUD_HEIGHT);
      }
    }
  });

  it('keeps the rim of a round part everywhere but close round a stud', () => {
    for (const [type, studs] of [
      ['roundplate2x2', cells('roundplate2x2')],
      ['round2x2', cells('round2x2')],
      ['roundtile2x2', cells('roundtile2x2')],
    ] as const) {
      const mesh = meshOf(type);
      const ray = new THREE.Raycaster();
      // The middle of the rim, a fifth of a stud thick.
      const r = STUD - 0.002 / 2 - STUD * 0.1;
      let kept = 0;
      for (let a = 0; a < 360; a += 2) {
        const x = Math.cos((a * Math.PI) / 180) * r;
        const z = Math.sin((a * Math.PI) / 180) * r;
        if (studs.some((q) => Math.hypot(x - q.x, z - q.z) < STUD_RADIUS + STUD * 0.05)) continue;
        ray.set(new THREE.Vector3(x, bottomOf(type) - 1e-4, z), new THREE.Vector3(0, 1, 0));
        const hit = ray.intersectObject(mesh)[0];
        expect(hit?.distance, `${type} at ${a} degrees`).toBeLessThan(1e-3);
        kept++;
      }
      expect(kept, type).toBeGreaterThan(20);
    }
  });

  it('reaches out from the walls to touch the studs under a brick', () => {
    for (const type of ['1x1', '1x4', '2x4', 'plate2x2'] as const) {
      const t = BRICK_TYPES[type];
      const mesh = meshOf(type);
      const ray = new THREE.Raycaster();
      const y = bottomOf(type) + STUD_HEIGHT / 2;
      for (const c of cells(type)) {
        // Out toward each wall the stud is next to.
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].filter(([dx, dz]) => {
          const edge = dx ? (t.studsX * STUD) / 2 : (t.studsZ * STUD) / 2;
          return Math.abs((dx ? c.x : c.z) + (dx || dz!) * (STUD / 2)) >= edge - 1e-9;
        });
        for (const [dx, dz] of dirs) {
          ray.set(new THREE.Vector3(c.x, y, c.z), new THREE.Vector3(dx, 0, dz));
          const hit = ray.intersectObject(mesh)[0];
          expect(hit?.distance, `${type} at ${c.x},${c.z} toward ${dx},${dz}`).toBeCloseTo(
            STUD_RADIUS,
            5,
          );
        }
      }
    }
  });

  it('makes a bracket one piece, its flange against the plate and not split between rows', () => {
    for (const type of ['bracket1x1', 'bracket1x2', 'bracket2x4', 'bracket1x2x2'] as const) {
      const t = BRICK_TYPES[type];
      const mesh = meshOf(type);
      const ray = new THREE.Raycaster();
      const front = (t.studsZ * STUD) / 2;
      // Down the seam between the plate's front and the flange: nothing gets through.
      for (const z of [front - 0.0005, front, front + 0.0005]) {
        ray.set(new THREE.Vector3(0.01, 1, z), new THREE.Vector3(0, -1, 0));
        const hits = ray.intersectObject(mesh);
        const top = hits[0]?.point.y ?? -Infinity;
        expect(top, `${type} at z ${z}`).toBeGreaterThan(
          brickGeometry(type).userData.body.max.y - 0.002,
        );
      }
      // Into the flange's front from below the plate, all the way down: one face, no slit.
      const low = Math.min(...(t.sideStuds ?? []).map((s) => s.y)) * PLATE_H;
      const bottom = bottomOf(type) + low - STUD / 2 + 0.002;
      for (let y = bottom; y < brickGeometry(type).userData.body.max.y - 0.002; y += 0.001) {
        ray.set(new THREE.Vector3(0.01, y, 1), new THREE.Vector3(0, 0, -1));
        const hit = ray.intersectObject(mesh).find((h) => Math.abs(h.point.x - 0.01) < 1e-9);
        expect(hit?.point.z, `${type} at y ${y}`).toBeGreaterThan(front);
      }
    }
  });

  it("stands an inverted bracket's flange up from its plate's bottom, in one piece", () => {
    for (const type of ['invbracket1x2', 'invbracket1x2x2'] as const) {
      const t = BRICK_TYPES[type];
      const mesh = meshOf(type);
      const body = brickGeometry(type).userData.body as THREE.Box3;
      const front = (t.studsZ * STUD) / 2;
      const high = Math.max(...t.sideStuds!.map((s) => s.y)) * PLATE_H + STUD / 2;
      const ray = new THREE.Raycaster();
      // Into the flange's front from the plate's bottom up past its top: one face, no slit.
      for (let y = body.min.y + 0.002; y < body.min.y + high - 0.002; y += 0.001) {
        ray.set(new THREE.Vector3(0.01, y, 1), new THREE.Vector3(0, 0, -1));
        const hit = ray.intersectObject(mesh).find((h) => Math.abs(h.point.x - 0.01) < 1e-9);
        expect(hit?.point.z, `${type} at y ${y}`).toBeGreaterThan(front);
      }
      // Down onto the flange's top, over the plate's top.
      ray.set(new THREE.Vector3(0.01, 1, front + 0.001), new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(mesh)[0]?.point.y).toBeGreaterThan(body.max.y + PLATE_H);
    }
  });

  it("draws a 1x2 - 1x4 bracket's flange a stud past its plate at either end", () => {
    const body = brickGeometry('bracket1x2to1x4').userData.body as THREE.Box3;
    const ray = new THREE.Raycaster();
    for (const x of [-1.9, -1.1, 1.1, 1.9].map((k) => k * STUD)) {
      ray.set(new THREE.Vector3(x, body.max.y - PLATE_H, 1), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(meshOf('bracket1x2to1x4'))[0];
      expect(hit?.point.z, `at x ${x}`).toBeGreaterThan(STUD / 2);
    }
  });

  it("puts a jumper's one stud in its middle, and a hole through the round tile's", () => {
    const ray = new THREE.Raycaster();
    for (const type of ['jumper1x2', 'jumper2x2'] as const) {
      const body = brickGeometry(type).userData.body as THREE.Box3;
      ray.set(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(meshOf(type))[0]?.point.y).toBeGreaterThan(body.max.y);
      // Not over the cells, where a plate's studs are.
      ray.set(new THREE.Vector3(STUD / 2, 1, 0), new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(meshOf(type))[0]?.point.y).toBeLessThan(body.max.y + 1e-6);
    }
    // Straight down through the middle of the tile with a hole, and not the plain one.
    ray.set(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(meshOf('roundtile2x2hole'))).toHaveLength(0);
    expect(ray.intersectObject(meshOf('roundtile2x2')).length).toBeGreaterThan(0);
  });

  it("steps a 2x2 plate with side studs' back row down a plate, its studs on each row's top", () => {
    const body = brickGeometry('sidestudplate2x2').userData.body as THREE.Box3;
    const mesh = meshOf('sidestudplate2x2');
    const ray = new THREE.Raycaster();
    const down = (z: number) => {
      ray.set(new THREE.Vector3(0.001, 1, z), new THREE.Vector3(0, -1, 0));
      return ray.intersectObject(mesh)[0]?.point.y ?? -Infinity;
    };
    // Between the studs: the back row's top a plate under the front row's.
    expect(down(-STUD / 2 - 0.0005)).toBeCloseTo(body.max.y - PLATE_H, 4);
    expect(down(STUD / 2 + 0.0005)).toBeCloseTo(body.max.y, 4);
    // On the studs: each a stud's height over its own row.
    ray.set(new THREE.Vector3(-STUD / 2, 1, -STUD / 2), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(
      body.max.y - PLATE_H + STUD_HEIGHT,
      4,
    );
  });

  it('draws a 2x2 plate with side studs and a 1x1 plate with a ring each in one piece', () => {
    /** The outline's segments, as the game draws it round a part. */
    const edges = (type: BrickTypeId) => {
      const pos = new THREE.EdgesGeometry(brickGeometry(type), 30).getAttribute('position');
      const out: [THREE.Vector3, THREE.Vector3][] = [];
      for (let i = 0; i < pos.count; i += 2)
        out.push([
          new THREE.Vector3().fromBufferAttribute(pos, i),
          new THREE.Vector3().fromBufferAttribute(pos, i + 1),
        ]);
      return out;
    };
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    // No line down the stepped part's sides under the step, where its rows meet.
    const step = brickGeometry('sidestudplate2x2').userData.body as THREE.Box3;
    const low = step.max.y - PLATE_H;
    const seams = edges('sidestudplate2x2').filter(
      ([a, b]) =>
        near(Math.abs(a.x), step.max.x) &&
        near(a.x, b.x) &&
        near(a.z, 0) &&
        near(b.z, 0) &&
        Math.min(a.y, b.y) < low - 1e-6,
    );
    expect(seams).toEqual([]);
    // No line across the plate's top where the ring's neck meets it, and the neck is as thick
    // as the plate: its top and bottom are the plate's.
    const plate = brickGeometry('ringplate1x1').userData.body as THREE.Box3;
    const across = edges('ringplate1x1').filter(
      ([a, b]) =>
        near(a.z, plate.max.z) &&
        near(b.z, plate.max.z) &&
        near(a.y, b.y) &&
        Math.abs((a.x + b.x) / 2) < STUD * 0.15,
    );
    expect(across).toEqual([]);
    const ray = new THREE.Raycaster();
    const neck = plate.max.z + STUD * 0.1;
    ray.set(new THREE.Vector3(0, 1, neck), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(meshOf('ringplate1x1'))[0]?.point.y).toBeCloseTo(plate.max.y, 6);
    ray.set(new THREE.Vector3(0, -1, neck), new THREE.Vector3(0, 1, 0));
    expect(ray.intersectObject(meshOf('ringplate1x1'))[0]?.point.y).toBeCloseTo(plate.min.y, 6);
  });

  it("draws a 1x1 plate's ring a stud out from its middle, a hole through it along x", () => {
    const body = brickGeometry('ringplate1x1').userData.body as THREE.Box3;
    const mesh = meshOf('ringplate1x1');
    const y = body.min.y + 0.75 * PLATE_H;
    const ray = new THREE.Raycaster();
    // Along its hole, nothing; just over the hole, the ring and its end studs.
    ray.set(new THREE.Vector3(1, y, STUD), new THREE.Vector3(-1, 0, 0));
    expect(ray.intersectObject(mesh)).toHaveLength(0);
    ray.set(new THREE.Vector3(1, y + STUD * 0.25, STUD), new THREE.Vector3(-1, 0, 0));
    expect(ray.intersectObject(mesh)[0]?.point.x).toBeCloseTo(0.2 * STUD + STUD_HEIGHT, 4);
    // Down onto it: its top over the plate's, its bottom a quarter plate under the plate's.
    ray.set(new THREE.Vector3(0, 1, STUD), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(y + 0.4 * STUD, 4);
    ray.set(new THREE.Vector3(0, -1, STUD), new THREE.Vector3(0, 1, 0));
    expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(body.min.y - PLATE_H / 4, 4);
  });

  it('draws no outline round the sides of a brick between its bottom and top', () => {
    for (const type of ['1x1', '2x4', 'plate1x2', '1x2x3'] as const) {
      const body = brickGeometry(type).userData.body as THREE.Box3;
      const edges = new THREE.EdgesGeometry(brickGeometry(type), 25).getAttribute('position');
      const onSide = (x: number, z: number) =>
        Math.abs(Math.abs(x) - body.max.x) < 1e-6 || Math.abs(Math.abs(z) - body.max.z) < 1e-6;
      const inside = (y: number) => y > body.min.y + 1e-6 && y < body.max.y - 1e-6;
      for (let i = 0; i < edges.count; i += 2) {
        const [y0, y1] = [edges.getY(i), edges.getY(i + 1)];
        const flat = Math.abs(y0 - y1) < 1e-9;
        const side =
          onSide(edges.getX(i), edges.getZ(i)) && onSide(edges.getX(i + 1), edges.getZ(i + 1));
        expect(flat && side && inside(y0), `${type}: a line round its side at ${y0}`).toBe(false);
      }
    }
  });

  it('draws no seam round the top of a round part', () => {
    for (const type of ['roundplate2x2', 'roundtile2x2', 'round2x2', 'dish2x2'] as const) {
      const body = brickGeometry(type).userData.body as THREE.Box3;
      const top = body.max.y;
      const edges = new THREE.EdgesGeometry(brickGeometry(type), 25).getAttribute('position');
      // A 2x2 round part's radius: a stud, less the gap between parts.
      const r = STUD - 0.002;
      for (let i = 0; i < edges.count; i += 2) {
        const [y0, y1] = [edges.getY(i), edges.getY(i + 1)];
        if (Math.abs(y0 - top) > 1e-6 || Math.abs(y1 - top) > 1e-6) continue;
        const [x, z] = [edges.getX(i), edges.getZ(i)];
        const at = Math.hypot(x, z);
        // Round the rim, round an axle hole in the middle or round the foot of a stud on top.
        const stud = cells(type).some((c) => Math.hypot(x - c.x, z - c.z) < STUD_RADIUS + 1e-4);
        expect(at > r - 1e-3 || at < STUD * 0.35 || stud, `${type}: an edge on top at ${at}`).toBe(
          true,
        );
      }
    }
  });
});
