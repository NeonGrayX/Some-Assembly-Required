import { describe, expect, it } from 'vitest';
import { PLATE_H, STUD } from './bricks.ts';
import type { BrickTypeId } from './bricks.ts';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick } from './grid.ts';
import {
  ORIENTATIONS,
  orientationKey,
  orientationOf,
  placedShape,
  placementsOnto,
  plainPlacement,
  sidewaysStuds,
} from './lattice.ts';
import type { LatticeStud } from './lattice.ts';
import { v3 } from './math.ts';
import { partBounds, partSolids, sideStudsOf } from './parts.ts';
import { bricksOf } from './net/protocol.ts';
import type { BrickT } from './net/protocol.ts';
import { aimAtBricks, computeSnap, latticeSnap } from './snap.ts';

let nextId = 1;
const brick = (type: BrickTypeId, p: Partial<PlacedBrick> = {}): PlacedBrick => ({
  id: nextId++,
  type,
  colour: 'red',
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
  ...p,
});

/** A 1x2 brick with studs on its side on a plate, its studs toward +z. */
function host(): { g: BrickGrid; side: PlacedBrick } {
  const side = brick('sidestuds1x2', { y: 1 });
  return { g: BrickGrid.from([brick('plate2x2'), side]), side };
}

/** Snaps `type` aimed at the +z face at z (in studs), x and y (in studs and plates). */
const aim = (g: BrickGrid, type: BrickTypeId, x: number, y: number, z: number) =>
  computeSnap(g, v3(x * STUD, y * PLATE_H, z * STUD), v3(0, 0, 1), type, 0);

describe('studs pointing sideways', () => {
  it('are the side studs of an upright part', () => {
    for (const type of [
      'sidestuds1x4',
      'headlight1x1',
      'bracket2x4',
      'sidestuds4sides1x1',
    ] as const)
      for (const rot of [0, 1, 2, 3] as const) {
        const p = { type, rot, x: 2, y: 3, z: 5 };
        expect(sidewaysStuds(p)).toEqual(sideStudsOf(p));
      }
  });

  it("are a sideways plate's studs, a plate out from the studs it is clipped to", () => {
    const plate = {
      type: 'plate1x2' as const,
      rot: 0 as const,
      face: '+z' as const,
      x: 0,
      y: 1.5,
      z: 1,
    };
    expect(sidewaysStuds(plate)).toEqual(
      expect.arrayContaining([
        { x: 0, z: 0, dir: '+z', y: 2.75, out: 1 },
        { x: 1, z: 0, dir: '+z', y: 2.75, out: 1 },
      ]),
    );
  });
});

describe('parts on sideways parts', () => {
  it('clip a tile onto a plate clipped onto side studs', () => {
    const { g, side } = host();
    const plate = aim(g, 'plate1x2', 1, 2.75, 1)!;
    expect(plate).toMatchObject({ face: '+z', x: 0, y: 1.5, z: 1 });
    const p = brick('plate1x2', plate);
    expect(g.add(p)).toEqual({ ok: true });
    // Aimed at the plate's front, a plate out from the brick's side.
    const tile = aim(g, 'tile1x2', 1, 2.75, 1.4)!;
    expect(tile).toMatchObject({ face: '+z', x: 0, y: 1.5, z: 1.4 });
    const t = brick('tile1x2', tile);
    expect(g.add(t)).toEqual({ ok: true });
    expect(g.neighbours(t)).toEqual([{ lower: p.id, upper: t.id, studs: 2 }]);
    expect(g.neighbours(p)).toEqual([
      { lower: side.id, upper: p.id, studs: 2 },
      { lower: p.id, upper: t.id, studs: 2 },
    ]);
    // Taking the plate away leaves the tile on its own.
    g.remove(p.id);
    expect(g.components()).toHaveLength(2);
  });

  it('build out from a headlight brick, plate on plate on its stud', () => {
    const g = BrickGrid.from([brick('plate2x2'), brick('headlight1x1', { y: 1 })]);
    let z = 0.8;
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const p = brick('plate1x1', { face: '+z', x: 0, y: 1.5, z });
      expect(g.add(p), `plate ${i}`).toEqual({ ok: true });
      ids.push(p.id);
      // A plate is 0.4 of a stud thick.
      z += 0.4;
    }
    expect(g.components()).toHaveLength(1);
    expect(g.neighbours(g.bricks.get(ids[1]!)!).map((c) => [c.lower, c.upper])).toEqual([
      [ids[0], ids[1]],
      [ids[1], ids[2]],
    ]);
  });

  it('keep off the studs of a sideways plate unless they take them', () => {
    const { g } = host();
    g.add(brick('plate1x2', { face: '+z', x: 0, y: 1.5, z: 1 }));
    // Half a plate up, a tile's back is on the plate's studs.
    expect(g.check({ type: 'tile1x2', face: '+z', rot: 0, x: 0, y: 2, z: 1.4 })).toEqual({
      ok: false,
      reason: 'overlap',
    });
    // A brick on the plate under it, right in front of the sideways plate's studs.
    expect(g.check({ type: '1x2', rot: 0, x: 0, y: 1, z: 1 })).toEqual({
      ok: false,
      reason: 'overlap',
    });
  });

  it('clip on both sides of a brick with studs on two sides, and build out from each', () => {
    const g = BrickGrid.from([
      brick('plate1x3', { rot: 1, z: -1 }),
      brick('sidestuds2sides1x1', { y: 1 }),
    ]);
    const front = brick('plate1x1', { face: '+z', x: 0, y: 1.5, z: 1 });
    const back = brick('plate1x1', { face: '-z', x: 0, y: 1.5, z: -1 });
    expect(g.add(front)).toEqual({ ok: true });
    expect(g.add(back)).toEqual({ ok: true });
    expect(g.add(brick('tile1x1', { face: '+z', x: 0, y: 1.5, z: 1.4 }))).toEqual({ ok: true });
    expect(g.add(brick('tile1x1', { face: '-z', x: 0, y: 1.5, z: -1.4 }))).toEqual({ ok: true });
    expect(g.components()).toHaveLength(1);
  });
});

describe('thick parts sideways and parts turned any way', () => {
  /** The placement of `type` turned `orient` that takes the stud `s`, by its first receiver. */
  const onto = (type: BrickTypeId, orient: string, s: LatticeStud): PlacedBrick => {
    const p = placementsOnto(type, s).find((q) => q.orient === orient);
    if (!p) throw new Error(`no ${orient} ${type} on ${JSON.stringify(s)}`);
    return brick(type, p);
  };

  it('clip a slope onto a headlight brick by its bottom', () => {
    const g = BrickGrid.from([brick('plate2x2'), brick('headlight1x1', { y: 1 })]);
    // A 2x1 slope, its bottom in the recess, standing up two studs from the brick's stud.
    const slope = brick('slope1x2', { face: '+z', x: 0, y: 1.5, z: 0.8 });
    expect(g.add(slope)).toEqual({ ok: true });
    expect(g.neighbours(slope)).toHaveLength(1);
    // Three plates thick, it reaches out past the cell in front of the brick.
    expect(g.check({ type: 'plate1x1', x: 0, y: 2, z: 1, rot: 0 })).toMatchObject({ ok: false });
  });

  it('put a bracket on a bracket, its flange sideways, and build on from it', () => {
    const g = BrickGrid.from([brick('plate2x2'), brick('1x1', { y: 1 })]);
    const first = brick('bracket1x1', { y: 4 });
    expect(g.add(first)).toEqual({ ok: true });
    const flange = placedShape(first).studs.find((s) => s.kind === 'side')!;
    // Its flange up, the second bracket's flange would lie on the first one's top, over its
    // stud: a flange reaches 1.5 plates past the back of its plate.
    expect(g.check(onto('bracket1x1', '+z-x', flange))).toEqual({ ok: false, reason: 'overlap' });
    // Its flange to the side, it fits, and its stud points that way.
    const second = onto('bracket1x1', '+z+y', flange);
    expect(g.add(second)).toEqual({ ok: true });
    expect(g.neighbours(second)).toEqual([{ lower: first.id, upper: second.id, studs: 1 }]);
    const out = placedShape(second).studs.find((s) => s.kind === 'side')!;
    expect(out.dir).toBe('+x');
    const tile = onto('tile1x1', '+x+y', out);
    expect(g.add(tile)).toEqual({ ok: true });
    expect(g.components()).toHaveLength(1);
  });

  it('hang a part upside down from studs pointing down', () => {
    // A bracket on a plate whose flange hangs down past the plate's front.
    const g = BrickGrid.from([brick('plate1x2', { y: 1 })]);
    const first = brick('bracket1x1', { y: 2 });
    expect(g.add(first)).toEqual({ ok: true });
    const flange = placedShape(first).studs.find((s) => s.kind === 'side')!;
    // This time the second bracket's flange points down, under its plate.
    const second = onto('bracket1x1', '+z+x', flange);
    expect(g.add(second)).toEqual({ ok: true });
    const down = placedShape(second).studs.find((s) => s.dir === '-y')!;
    expect(down).toBeDefined();
    // A plate upside down on that stud, and another upside down on that one's studs.
    const a = onto('plate1x2', '-y+z', down);
    expect(g.add(a)).toEqual({ ok: true });
    const b = onto('plate1x2', '-y+z', placedShape(a).studs[0]!);
    expect(g.add(b)).toEqual({ ok: true });
    expect(g.neighbours(b)).toEqual([{ lower: a.id, upper: b.id, studs: 2 }]);
    expect(g.components()).toHaveLength(1);
  });

  it('turn every part every way, its body where its bounds are', () => {
    const ldu = (m: { x: number; y: number; z: number }) =>
      v3(
        Math.round((m.x / STUD) * 20),
        Math.round((m.y / PLATE_H) * 8),
        Math.round((m.z / STUD) * 20),
      );
    for (const type of ['2x4', 'slope2x3', 'tile1x2', 'sidestuds1x4', 'cone1x1'] as const)
      for (const o of ORIENTATIONS) {
        const p = { type, rot: 0 as const, orient: orientationKey(o), x: 1, y: 2.25, z: 3.5 };
        expect(orientationOf(p)).toBe(o);
        const min = ldu(partBounds(p).min);
        const max = ldu(partBounds(p).max);
        expect(min).toEqual(v3(20, 18, 70));
        for (const b of placedShape(p).boxes)
          for (const k of ['x', 'y', 'z'] as const) {
            expect(b.min[k]).toBeGreaterThanOrEqual(min[k]);
            expect(b.max[k]).toBeLessThanOrEqual(max[k]);
          }
        // Its studs stand on the outside of its body.
        for (const s of placedShape(p).studs)
          expect(
            ['x', 'y', 'z'].some(
              (k) => s.at[k as 'x'] === min[k as 'x'] || s.at[k as 'x'] === max[k as 'x'],
            ),
          ).toBe(true);
      }
  });
});

describe('snapping onto any studs', () => {
  it('turns a part upside down onto studs pointing down', () => {
    const g = BrickGrid.from([brick('plate1x2', { y: 1 })]);
    const first = brick('bracket1x1', { y: 2 });
    g.add(first);
    const flange = placedShape(first).studs.find((s) => s.kind === 'side')!;
    const second = brick(
      'bracket1x1',
      placementsOnto('bracket1x1', flange).find((p) => p.orient === '+z+x')!,
    );
    expect(g.add(second)).toEqual({ ok: true });
    const down = placedShape(second).studs.find((s) => s.dir === '-y')!;
    // Aimed from below at the flange's underside, right under its stud.
    const hit = v3((down.at.x / 20) * STUD, (down.at.y / 8) * PLATE_H, (down.at.z / 20) * STUD);
    const p = computeSnap(g, hit, v3(0, -1, 0), 'plate1x1', 0);
    expect(p).toMatchObject({ type: 'plate1x1' });
    expect(p!.orient?.startsWith('-y')).toBe(true);
    expect(g.add(brick('plate1x1', p!))).toEqual({ ok: true });
  });

  it('comes back sideways where that says it', () => {
    const { g } = host();
    const p = latticeSnap(g, v3(0.5 * STUD, 2.75 * PLATE_H, STUD), v3(0, 0, 1), 'tile1x1', 0);
    expect(p).toEqual({ type: 'tile1x1', rot: expect.any(Number), face: '+z', x: 0, y: 1.5, z: 1 });
  });

  it('puts the plain forms back the way they were', () => {
    for (const p of [
      { type: '2x4' as const, rot: 1 as const, x: 2, y: 3, z: 4 },
      { type: 'cone1x1' as const, rot: 0 as const, x: 2.5, y: 3, z: 4.5 },
      { type: 'tile1x2' as const, rot: 1 as const, face: '-x' as const, x: 2.2, y: 1.5, z: 4 },
      { type: 'slope1x2' as const, rot: 3 as const, face: '+z' as const, x: 2, y: 1.5, z: 4.8 },
    ]) {
      const box = partBounds(p);
      const turned = {
        type: p.type,
        rot: 0 as const,
        orient: orientationKey(orientationOf(p)),
        x: box.min.x / STUD,
        y: box.min.y / PLATE_H,
        z: box.min.z / STUD,
      };
      const back = plainPlacement(turned);
      expect(back.orient).toBeUndefined();
      expect(placedShape(back)).toEqual(placedShape(p));
    }
  });
});

describe('new parts', () => {
  /** Where a lattice point is, in metres, for aiming at it. */
  const metres = (at: { x: number; y: number; z: number }) =>
    v3((at.x / 20) * STUD, (at.y / 8) * PLATE_H, (at.z / 20) * STUD);

  it('put a part on a 1x2 jumper half a stud off the grid', () => {
    const g = BrickGrid.from([brick('plate2x2')]);
    const jumper = brick('jumper1x2', { y: 1 });
    expect(g.add(jumper)).toEqual({ ok: true });
    const [stud] = placedShape(jumper).studs;
    expect(stud!.at).toEqual(v3(20, 16, 10));
    // Aimed at its top: a 1x1 plate on its one stud, half a stud along.
    const p = computeSnap(g, metres(stud!.at), v3(0, 1, 0), 'plate1x1', 0)!;
    expect(partBounds(p).min.x / STUD).toBeCloseTo(0.5);
    const plate = brick('plate1x1', p);
    expect(g.add(plate)).toEqual({ ok: true });
    expect(g.neighbours(plate)).toEqual([{ lower: jumper.id, upper: plate.id, studs: 1 }]);
    // A 1x2 plate square on it would sit on its stud between its own.
    expect(g.check({ type: 'plate1x2', x: 0, y: 2, z: 0, rot: 0 })).toMatchObject({ ok: false });
  });

  it('put a 2x2 jumper on one stud, or on four', () => {
    const one = BrickGrid.from([brick('plate2x2'), brick('plate1x1', { x: 1, y: 1, z: 1 })]);
    const centred = brick('jumper2x2', { x: 0.5, y: 2, z: 0.5 });
    expect(one.add(centred)).toEqual({ ok: true });
    expect(placedShape(centred).studs.map((t) => t.at)).toEqual([v3(30, 24, 30)]);
    const four = BrickGrid.from([brick('plate2x2')]);
    expect(four.add(brick('jumper2x2', { y: 1 }))).toEqual({ ok: true });
  });

  it('clip a tile onto the flange of an inverted bracket, over its plate', () => {
    const g = BrickGrid.from([brick('plate2x2')]);
    const bracket = brick('invbracket1x2', { y: 1 });
    expect(g.add(bracket)).toEqual({ ok: true });
    const flange = placedShape(bracket).studs.filter((t) => t.kind === 'side');
    // Its studs stand 1.25 plates up from its bottom, half a plate out from its front.
    expect(flange.map((t) => t.at)).toEqual([v3(10, 18, 24), v3(30, 18, 24)]);
    // A plate fits on its top; the flange fills the front of the cell in front of it.
    expect(g.check({ type: 'plate1x2', x: 0, y: 2, z: 0, rot: 0 })).toMatchObject({ ok: true });
    expect(g.check({ type: 'plate1x2', x: 0, y: 2, z: 1, rot: 0 })).toMatchObject({ ok: false });
    const p = computeSnap(g, metres(v3(20, 18, 24)), v3(0, 0, 1), 'tile1x2', 0)!;
    expect(p).toMatchObject({ face: '+z' });
    const tile = brick('tile1x2', p);
    expect(g.add(tile)).toEqual({ ok: true });
    expect(g.neighbours(tile)).toEqual([{ lower: bracket.id, upper: tile.id, studs: 2 }]);
    // The 2x2 one takes a 2x2 tile, two studs over two.
    const tall = BrickGrid.from([brick('plate2x2'), brick('invbracket1x2x2', { y: 1 })]);
    const q = computeSnap(tall, metres(v3(20, 28, 24)), v3(0, 0, 1), 'tile2x2', 0)!;
    const big = brick('tile2x2', q);
    expect(tall.add(big)).toEqual({ ok: true });
    expect(tall.neighbours(big)[0]?.studs).toBe(4);
  });

  it("clip a 1x4 tile onto a 1x2 - 1x4 bracket's flange, past its plate's ends", () => {
    const g = BrickGrid.from([brick('plate4x4'), brick('1x4', { y: 1 })]);
    const bracket = brick('bracket1x2to1x4', { x: 1, y: 4 });
    expect(g.add(bracket)).toEqual({ ok: true });
    const flange = placedShape(bracket).studs.filter((t) => t.kind === 'side');
    expect(flange.map((t) => t.at.x)).toEqual([10, 30, 50, 70]);
    const p = computeSnap(g, metres(v3(40, 30, 24)), v3(0, 0, 1), 'tile1x4', 0)!;
    const tile = brick('tile1x4', p);
    expect(g.add(tile)).toEqual({ ok: true });
    expect(g.neighbours(tile)).toEqual([{ lower: bracket.id, upper: tile.id, studs: 4 }]);
  });

  it('reverse a stud through a round tile with a hole', () => {
    const g = BrickGrid.from([brick('plate2x2')]);
    const tile = brick('roundtile2x2hole', { y: 1 });
    expect(g.add(tile)).toEqual({ ok: true });
    const hole = placedShape(tile).receivers.find((r) => r.dir === '+y')!;
    expect(hole.at).toEqual(v3(20, 16, 20));
    // Aimed at its top: a plate goes on upside down, its stud down into the hole.
    const p = computeSnap(g, metres(hole.at), v3(0, 1, 0), 'plate1x1', 0)!;
    expect(p.orient?.startsWith('-y')).toBe(true);
    const plate = brick('plate1x1', p);
    expect(g.add(plate)).toEqual({ ok: true });
    // The stud is the plate's, so it is the plate that holds the tile.
    expect(g.neighbours(plate)).toEqual([{ lower: plate.id, upper: tile.id, studs: 1 }]);
    // Its studs point down now, and parts hang on from below.
    expect(placedShape(plate).studs[0]!.dir).toBe('-y');
  });

  it('put parts on both rows of a 2x2 plate with side studs, and clip one onto its studs', () => {
    const g = BrickGrid.from([brick('plate2x2')]);
    const step = brick('sidestudplate2x2', { y: 1 });
    expect(g.add(step)).toEqual({ ok: true });
    const studs = placedShape(step).studs;
    // Its back row's studs a plate up, its raised front row's two; its side studs on the front
    // 1.25 plates up.
    expect(studs.filter((t) => t.kind === 'top').map((t) => t.at)).toEqual([
      v3(10, 16, 10),
      v3(10, 24, 30),
      v3(30, 16, 10),
      v3(30, 24, 30),
    ]);
    expect(studs.filter((t) => t.kind === 'side').map((t) => t.at)).toEqual([
      v3(10, 18, 40),
      v3(30, 18, 40),
    ]);
    // What the physics and aiming meet is stepped as well.
    expect(partSolids(step).map((b) => b.max.y / PLATE_H)).toEqual([2, 3]);
    // A 1x2 plate on the back row sits a plate up, beside the raised row.
    const p = computeSnap(g, metres(v3(20, 16, 10)), v3(0, 1, 0), 'plate1x2', 0)!;
    expect(p).toMatchObject({ x: 0, y: 2, z: 0 });
    const plate = brick('plate1x2', p);
    expect(g.add(plate)).toEqual({ ok: true });
    expect(g.neighbours(plate)).toEqual([{ lower: step.id, upper: plate.id, studs: 2 }]);
    // A 1x2 tile on its side studs reaches half a plate over the raised row.
    const q = computeSnap(g, metres(v3(20, 18, 40)), v3(0, 0, 1), 'tile1x2', 0)!;
    expect(q).toMatchObject({ face: '+z' });
    const tile = brick('tile1x2', q);
    expect(g.add(tile)).toEqual({ ok: true });
    expect(g.neighbours(tile)).toEqual([{ lower: step.id, upper: tile.id, studs: 2 }]);
    expect(partBounds(tile).max.y / PLATE_H).toBeCloseTo(3.5);
  });

  it("clip parts onto both ends of a 1x1 plate's ring", () => {
    // The ring hangs a quarter plate under the plate's bottom, so over a stud it does not fit.
    const g = BrickGrid.from([brick('plate2x2')]);
    expect(g.check({ type: 'ringplate1x1', x: 0, y: 1, z: 0, rot: 0 })).toMatchObject({
      ok: false,
    });
    const ring = brick('ringplate1x1', { y: 1, z: 1 });
    expect(g.add(ring)).toEqual({ ok: true });
    // Its ends are open studs either way along it, 6 LDU up, a stud out from the plate.
    const ends = placedShape(ring).studs.filter((t) => t.kind === 'side');
    expect(ends.map((t) => [t.at, t.dir, t.open])).toEqual([
      [v3(14, 14, 50), '+x', true],
      [v3(6, 14, 50), '-x', true],
    ]);
    // Nothing else fits where the ring is.
    expect(g.check({ type: 'plate1x1', x: 0, y: 1, z: 2, rot: 0 })).toMatchObject({ ok: false });
    // Aimed at, the ring is there to aim at.
    const hit = aimAtBricks(g.bricks.values(), metres(v3(60, 14, 50)), v3(-1, 0, 0));
    expect(hit?.brickId).toBe(ring.id);
    for (const [at, dir] of [
      [v3(14, 14, 50), v3(1, 0, 0)],
      [v3(6, 14, 50), v3(-1, 0, 0)],
    ] as const) {
      const p = computeSnap(g, metres(at), dir, 'tile1x1', 0)!;
      expect(p.face).toBe(dir.x > 0 ? '+x' : '-x');
      const tile = brick('tile1x1', p);
      expect(g.add(tile)).toEqual({ ok: true });
      expect(g.neighbours(tile)).toEqual([{ lower: ring.id, upper: tile.id, studs: 1 }]);
      // Its back is on the ring's end, a stud square round the ring's middle.
      const b = partBounds(tile);
      expect((dir.x > 0 ? b.min.x : b.max.x) / STUD).toBeCloseTo(at.x / 20);
      expect((b.min.y + b.max.y) / 2 / PLATE_H).toBeCloseTo(at.y / 8);
    }
  });
});

describe('turned parts over the network', () => {
  it('keep their orientation in the brick tuple', () => {
    const state = {
      id: 1,
      anchored: false,
      heldBy: null,
      version: 1,
      pos: [0, 0, 0] as [number, number, number],
      rot: [0, 0, 0, 1] as [number, number, number, number],
      bricks: [
        [1, 'plate1x1', 'red', 0, 1, 0, 0, '-y+x'],
        [2, 'tile1x1', 'red', 0, 1.5, 1, 0, '+z'],
        [3, '1x1', 'red', 0, 1, 0, 0],
      ] as BrickT[],
    };
    expect(bricksOf(state).map((b) => [b.orient, b.face])).toEqual([
      ['-y+x', undefined],
      [undefined, '+z'],
      [undefined, undefined],
    ]);
  });
});
