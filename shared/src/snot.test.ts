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
  sidewaysStuds,
} from './lattice.ts';
import type { LatticeStud } from './lattice.ts';
import { v3 } from './math.ts';
import { partBounds, sideStudsOf } from './parts.ts';
import { computeSnap } from './snap.ts';

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
