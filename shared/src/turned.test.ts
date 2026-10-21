import { describe, expect, it } from 'vitest';
import { PLATE_H, STUD } from './bricks.ts';
import type { BrickTypeId } from './bricks.ts';
import {
  canonicalPlacement,
  composeFrames,
  decodeFrame,
  encodeFrame,
  frameKey,
  latticeMove,
  spinFrame,
} from './frames.ts';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick, Placement } from './grid.ts';
import { v3 } from './math.ts';
import { placedCentre, placedColliders } from './parts.ts';
import { sideSnap } from './snap.ts';
import { matchBuild } from './builds/match.ts';
import { parseBuildFile, stringifyBuildFile } from './builds/file.ts';
import type { TargetBrick, TargetBuild } from './builds/types.ts';
import { allBins } from './builds/variant.ts';
import { bricksOf } from './net/protocol.ts';
import type { AssemblyState, BrickT } from './net/protocol.ts';

let next = 1;
const brick = (type: BrickTypeId, p: Partial<PlacedBrick> = {}): PlacedBrick => ({
  id: next++,
  type,
  colour: 'red',
  x: 0,
  y: 0,
  z: 0,
  rot: 0,
  ...p,
});

/** `p` turned 45° (times `eighths`) about the stud at `pivot` (LDU) pointing `+y`, as said best. */
const spun = <T extends Placement>(p: T, pivot = v3(10, 8, 10), eighths = 1): T =>
  canonicalPlacement({ ...p, frame: spinFrame(pivot, '+y', eighths) });

describe('frames', () => {
  it('turns exactly: eight eighths are no turn, two a quarter turn the lattice has', () => {
    let f = spinFrame(v3(10, 8, 10), '+y');
    const one = f;
    for (let i = 1; i < 8; i++) f = composeFrames(one, f);
    expect(latticeMove(f)).toMatchObject({ d: { x: 0, y: 0, z: 0 } });
    expect(latticeMove(f)!.o).toMatchObject({ x: '+x', y: '+y', z: '+z' });
    expect(latticeMove(spinFrame(v3(10, 8, 10), '+y'))).toBeNull();
    // Twice 45° about a stud is a quarter turn about it: back on the grid, turned.
    const twice = canonicalPlacement(spun(brick('1x2'), v3(10, 8, 10), 1));
    const again = canonicalPlacement({
      ...twice,
      frame: composeFrames(spinFrame(v3(10, 8, 10), '+y'), twice.frame!),
    });
    expect(again.frame).toBeUndefined();
    expect(again.rot).toBe(1);
  });

  it('puts parts turned about studs on one line in one frame, and others in their own', () => {
    // A brick turned on a stud, and another turned on the stud right above it.
    const low = spun(brick('1x1', { y: 1 }), v3(10, 8, 10));
    const high = spun(brick('1x1', { y: 4 }), v3(10, 32, 10));
    expect(frameKey(low.frame)).toBe(frameKey(high.frame));
    // Turned 135° is turned 45° and a quarter turn: the same lattice, said the same way.
    const more = spun(brick('1x1', { y: 4 }), v3(10, 32, 10), 3);
    expect(frameKey(more.frame)).toBe(frameKey(high.frame));
    // Turned on the next stud over: another lattice.
    const beside = spun(brick('1x1', { x: 1, y: 1 }), v3(30, 8, 10));
    expect(frameKey(beside.frame)).not.toBe(frameKey(low.frame));
  });

  it('writes a frame as 24 numbers and reads it back, but only a true turn', () => {
    const f = spinFrame(v3(10, 8, 10), '+x', 3);
    expect(decodeFrame(encodeFrame(f))).toEqual(f);
    const stretched = encodeFrame(f);
    stretched[0] = 2;
    expect(decodeFrame(stretched)).toBeNull();
    expect(decodeFrame([1, 2, 3])).toBeNull();
  });

  it('draws and collides a turned part turned about its stud', () => {
    const p = spun(brick('1x1', { y: 1 }));
    // Its middle stays over the stud it is turned about.
    const c = placedCentre(p);
    expect(c.x).toBeCloseTo(0.5 * STUD);
    expect(c.z).toBeCloseTo(0.5 * STUD);
    const [box] = placedColliders(p);
    expect(Math.abs(box!.rot.y)).toBeCloseTo(Math.sin(Math.PI / 8));
  });
});

describe('BrickGrid across frames', () => {
  it('turns a 1x1 brick 45° on one stud, clear of the studs round it', () => {
    const base = brick('plate4x4');
    const g = BrickGrid.from([base]);
    const p = spun(brick('1x1', { x: 1, y: 1, z: 1 }), v3(30, 8, 30));
    expect(g.check(p)).toEqual({ ok: true });
    expect(g.neighbours(p)).toEqual([{ lower: base.id, upper: p.id, studs: 1 }]);
    expect(g.hangsOn(p)).toEqual({ at: expect.anything(), dir: '+y' });
    g.insert(p);
    // A brick on the next stud runs into its corner; one two studs off does not.
    expect(g.check(brick('1x1', { x: 2, y: 1, z: 1 }))).toMatchObject({ ok: false });
    expect(g.check(brick('1x1', { x: 3, y: 1, z: 1 }))).toEqual({ ok: true });
    // A plate on top of it, on its stud, is on its lattice.
    const top = { ...brick('plate1x1', { x: p.x, y: 4, z: p.z }), frame: p.frame };
    expect(g.check(top)).toEqual({ ok: true });
    expect(g.neighbours(top)).toEqual([{ lower: p.id, upper: top.id, studs: 1 }]);
    expect(g.hangsOn(top)).toMatchObject({ dir: '+y' });
    // Square to the grid on it, a plate takes its stud too: the stud stays where it was.
    const square = brick('plate1x1', { x: 1, y: 4, z: 1 });
    expect(g.check(square)).toEqual({ ok: true });
    expect(g.neighbours(square)).toEqual([{ lower: p.id, upper: square.id, studs: 1 }]);
  });

  it('builds an octagonal column: plates on four sides, and on four more turned 45°', () => {
    const g = BrickGrid.from([brick('plate4x4', { x: -2, z: -2 })]);
    const low = brick('sidestuds4sides1x1', { y: 1 });
    g.insert(low);
    // Above it, the same brick turned 45° about the stud it stands on.
    const high = spun(brick('sidestuds4sides1x1', { y: 4 }), v3(10, 32, 10));
    expect(g.check(high)).toEqual({ ok: true });
    g.insert(high);
    // A plate on each side of each: the high brick's sides seen square in its own frame.
    const { frame, ...own } = high;
    const plain = BrickGrid.from([{ ...own, id: 999 }]);
    const sides = [v3(1, 0, 0), v3(-1, 0, 0), v3(0, 0, 1), v3(0, 0, -1)];
    for (const core of [low, own]) {
      for (const n of sides) {
        const hit = v3(
          (core.x + 0.5 + n.x * 0.5) * STUD,
          (core.y + 1.5) * PLATE_H,
          (core.z + 0.5 + n.z * 0.5) * STUD,
        );
        const on = core === low ? g : plain;
        const p = sideSnap(on, hit, n, 'plate1x1', 0);
        expect(p).not.toBeNull();
        const plate = brick('plate1x1', core === low ? p! : canonicalPlacement({ ...p!, frame }));
        expect(g.check(plate)).toEqual({ ok: true });
        g.insert(plate);
        expect(g.neighbours(plate)).toEqual([
          { lower: core === low ? low.id : high.id, upper: plate.id, studs: 1 },
        ]);
      }
    }
    expect(g.components()).toHaveLength(1);
    // The high plates stand out the diagonals: as far out along x as along z.
    for (const b of g.bricks.values())
      if (b.type === 'plate1x1' && b.frame) {
        const c = placedCentre(b);
        expect(Math.abs(c.x - 0.5 * STUD)).toBeCloseTo(Math.abs(c.z - 0.5 * STUD));
      }
  });
});

describe('turned parts in builds, files and messages', () => {
  // A 1x1 brick turned 45° on the baseplate's stud (8, 8), and a plate on top of it.
  const base: PlacedBrick = { ...brick('baseplate16'), id: 0, colour: 'baseplate-green' };
  const post = spun(brick('1x1', { x: 8, y: 1, z: 8 }), v3(170, 8, 170));
  const cap = {
    ...brick('plate1x1', { x: post.x, y: 4, z: post.z, colour: 'blue' }),
    frame: post.frame,
  };
  const target: TargetBuild = {
    id: 'turned',
    name: 'Turned',
    steps: [post, cap].map(({ id: _id, ...b }) => ({ bricks: [b as TargetBrick] })),
  };

  it('builds the turned parts on the baseplate and matches them', () => {
    const g = BrickGrid.from([base]);
    expect(g.add(post)).toEqual({ ok: true });
    expect(g.add(cap)).toEqual({ ok: true });
    expect(matchBuild(target, g)).toMatchObject({ passed: true, counts: { correct: 2 } });
    // Square on the same stud instead, it is wrong.
    const square = BrickGrid.from([base, brick('1x1', { x: 8, y: 1, z: 8 })]);
    expect(matchBuild(target, square).counts.correct).toBe(0);
  });

  it('writes a build with turned parts as version 4, and reads it back the same', () => {
    const text = stringifyBuildFile(target);
    expect(JSON.parse(text).version).toBe(4);
    const r = parseBuildFile(text, allBins());
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.build.steps.flatMap((s) => s.bricks)).toEqual(target.steps.flatMap((s) => s.bricks));
    // A version 3 file cannot say it.
    const old = JSON.parse(text);
    old.version = 3;
    const bad = parseBuildFile(JSON.stringify(old), allBins());
    expect(bad.ok).toBe(false);
  });

  it('sends a turned part to the clients on its lattice', () => {
    const t: BrickT = [
      post.id,
      post.type,
      post.colour,
      post.x,
      post.y,
      post.z,
      post.rot,
      null,
      null,
      encodeFrame(post.frame!),
    ];
    const [back] = bricksOf({
      id: 1,
      anchored: true,
      heldBy: null,
      version: 0,
      bricks: [t],
      pos: [0, 0, 0],
      rot: [0, 0, 0, 1],
    } as AssemblyState);
    expect(back).toEqual(post);
  });
});
