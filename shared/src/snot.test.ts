import { describe, expect, it } from 'vitest';
import { PLATE_H, STUD } from './bricks.ts';
import type { BrickTypeId } from './bricks.ts';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick } from './grid.ts';
import { sidewaysStuds } from './lattice.ts';
import { v3 } from './math.ts';
import { sideStudsOf } from './parts.ts';
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
