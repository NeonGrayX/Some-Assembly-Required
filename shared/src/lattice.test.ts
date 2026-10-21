import { describe, expect, it } from 'vitest';
import { BRICK_TYPES, rowPlates } from './bricks.ts';
import type { BrickTypeId, Rotation } from './bricks.ts';
import { BUILDS } from './builds/catalog.ts';
import { BrickGrid } from './grid.ts';
import type { PlacedBrick, Placement } from './grid.ts';
import {
  AXES,
  LDU_PER_PLATE,
  LDU_PER_STUD,
  ORIENTATIONS,
  applyOrientation,
  axisVector,
  clutches,
  composeOrientations,
  invertOrientation,
  orientationByKey,
  orientationKey,
  orientationOf,
  placedShape,
} from './lattice.ts';
import type { LatticeStud, PartShape, Receiver } from './lattice.ts';
import { rotate, v3 } from './math.ts';
import type { Vec3 } from './math.ts';
import {
  FACINGS,
  PLATES_PER_STUD,
  bottomGrips,
  clipsOnto,
  emptyColumns,
  faceVector,
  hasCentreHollow,
  leafColumns,
  partAxes,
  partBox,
  partQuat,
  sideStudsOf,
  sidewaysAt,
  sidewaysOut,
  sidewaysSpan,
  sidewaysStudGrid,
  topStudCells,
} from './parts.ts';

const S = LDU_PER_STUD;
const P = LDU_PER_PLATE;
const TYPES = Object.keys(BRICK_TYPES) as BrickTypeId[];
const ROTS: Rotation[] = [0, 1, 2, 3];

/** The vector with any -0 made 0, to compare. */
const unsigned = (v: Vec3) => v3(v.x + 0, v.y + 0, v.z + 0);
const key = (v: Vec3) => `${v.x},${v.y},${v.z}`;
const sorted = (keys: Iterable<string>) => [...keys].sort();

/** A grid column (x, z) and a height in plates, as the lattice point at the stud's base. */
const columnPoint = (c: { x: number; z: number }, y: number) =>
  v3((c.x + 0.5) * S, y * P, (c.z + 0.5) * S);

/** The part's own row (along its own z) over grid column `c`, for an upright part. */
function ownRow(p: Placement, c: { x: number; z: number }): number {
  const b = partBox(p);
  const { z: az } = partAxes(p);
  const oz = (c.x + 0.5 - (b.x0 + b.x1) / 2) * az.x + (c.z + 0.5 - (b.z0 + b.z1) / 2) * az.z;
  return Math.round(oz + BRICK_TYPES[p.type].studsZ / 2 - 0.5);
}

/** The half-plate slots (x, half, z) the boxes of a shape reach into. */
function boxSlots(shape: PartShape): Set<string> {
  const out = new Set<string>();
  for (const { min, max } of shape.boxes)
    for (let x = Math.floor(min.x / S); x < Math.ceil(max.x / S); x++)
      for (let h = Math.floor(min.y / (P / 2)); h < Math.ceil(max.y / (P / 2)); h++)
        for (let z = Math.floor(min.z / S); z < Math.ceil(max.z / S); z++)
          out.add(`${x},${h},${z}`);
  return out;
}

/**
 * The half-plate slots (x, half, z) the grid filled before it went onto the lattice, as it
 * worked them out: upright parts whole layers over their footprint (less a quarter arc's hole,
 * a leaf plate's leaves half a plate up), sideways parts their cell and the half plates they
 * reach into.
 */
function gridSlots(p: Placement): Set<string> {
  const out = new Set<string>();
  const b = partBox(p);
  let h0 = 2 * b.y0;
  let h1 = 2 * b.y1;
  if (p.face) {
    const { y0, y1 } = sidewaysSpan(p);
    h0 = Math.floor(2 * y0 + 1e-6);
    h1 = Math.ceil(2 * y1 - 1e-6);
  }
  const empty = emptyColumns(p);
  const leaves = new Set(leafColumns(p).map((c) => `${c.x},${c.z}`));
  for (let h = h0; h < h1 + (leaves.size ? 1 : 0); h++)
    for (let x = b.x0; x < b.x1; x++)
      for (let z = b.z0; z < b.z1; z++) {
        const key = `${x},${z}`;
        if (leaves.has(key) ? h === h0 : h === h1 || empty.has(key)) continue;
        out.add(`${x},${h},${z}`);
      }
  return out;
}

/**
 * The slots the lattice says an upright part fills: what the grid fills, and a bracket's flange
 * in the column in front of it from half a stud under its lowest stud up to the plate's top. The
 * grid keeps the flange's room free only under the bracket's layer, so today a part can stand
 * in front of a bracket at the plate's own layer, through the top of the flange.
 */
function uprightSlots(p: Placement): Set<string> {
  const out = gridSlots(p);
  const t = BRICK_TYPES[p.type];
  const top = 2 * (p.y + t.plates);
  // A stepped part's low rows stop at their own height.
  if (t.step)
    for (const k of [...out]) {
      const [x, h, z] = k.split(',').map(Number) as [number, number, number];
      if (h >= 2 * (p.y + rowPlates(p.type, ownRow(p, { x, z })))) out.delete(k);
    }
  // A ring fills the column its end studs are on, from a quarter plate under the part's bottom
  // to a stud over the ring's middle.
  if (t.ring)
    for (const s of sideStudsOf(p).slice(0, 1))
      for (let h = 2 * p.y - 1; h < 2 * p.y + 4; h++) out.add(`${s.x},${h},${s.z}`);
  for (const s of sideStudsOf(p)) {
    if (s.out <= 0) continue;
    const v = faceVector(s.dir);
    // Down from the plate's top, or up from its bottom on an inverted bracket.
    const up = Math.ceil(2 * (s.y + PLATES_PER_STUD / 2) - 1e-6);
    for (let h = Math.floor(2 * (s.y - PLATES_PER_STUD / 2) + 1e-6); h < Math.max(top, up); h++)
      out.add(`${s.x + v.x},${h},${s.z + v.z}`);
  }
  return out;
}

/**
 * The slots the lattice says a sideways part fills: what the grid fills, and for a part set back
 * into a headlight brick's recess, the half plate it reaches into the cell behind (which the
 * grid checks on its own, letting only a recessed side have it).
 */
function sidewaysSlots(p: Placement): Set<string> {
  const out = gridSlots(p);
  if (sidewaysOut(p) >= 0) return out;
  const v = faceVector(p.face!);
  for (const k of [...out]) {
    const [x, h, z] = k.split(',').map(Number) as [number, number, number];
    out.add(`${x - v.x},${h},${z - v.z}`);
  }
  return out;
}

/** Placements of every type, upright, at every turn, and half a stud off where that is allowed. */
function uprightPlacements(): Placement[] {
  const out: Placement[] = [];
  for (const type of TYPES)
    for (const rot of ROTS) {
      out.push({ type, rot, x: 3, y: 2, z: 5 });
      if (hasCentreHollow(type)) out.push({ type, rot, x: 3.5, y: 2, z: 5.5 });
    }
  return out;
}

const HOSTS = TYPES.filter((t) => BRICK_TYPES[t].sideStuds?.length);

/**
 * One part for each size up to 4x4, thickness and bottom there is, of the parts thin enough to
 * clip on sideways before parts went onto the lattice: bigger ones are the same, only more of it.
 */
const MOUNTABLE = [
  ...new Map(
    TYPES.filter((t) => {
      const { plates, studsX, studsZ, shape, sideStuds } = BRICK_TYPES[t];
      const legacy =
        plates <= 2 && !sideStuds && !['quarter', 'leaf', 'curve', 'plant'].includes(shape ?? '');
      return legacy && studsX <= 4 && studsZ <= 4;
    }).map((t) => {
      const { studsX, studsZ, plates, bottom } = BRICK_TYPES[t];
      return [`${studsX},${studsZ},${plates},${bottom}`, t] as const;
    }),
  ).values(),
];

/** The host's side studs as the grid has them and on the lattice, in the same order. */
function hostStuds(host: Placement): { grid: ReturnType<typeof sideStudsOf>; lat: LatticeStud[] } {
  return {
    grid: sideStudsOf(host),
    lat: placedShape(host).studs.filter((s) => s.kind === 'side'),
  };
}

/**
 * Sideways placements onto a host's side stud: each of the part's corner stud spots over it,
 * as snapping tries them, and near misses: half a plate up or down, a whole stud up, and its back
 * half a plate in or out.
 */
function sidewaysOnto(type: BrickTypeId, rot: Rotation, s: ReturnType<typeof sideStudsOf>[number]) {
  const face = s.dir;
  const v = faceVector(face);
  const size = sidewaysStudGrid({ type, rot, x: 0, y: 0, z: 0, face });
  const out: Placement[] = [];
  // Its corner studs: the ones between are like them.
  for (const i of new Set([0, size.along - 1]))
    for (const j of new Set([0, size.up - 1])) {
      const y = s.y - (j + 0.5) * PLATES_PER_STUD;
      for (const dy of [0, -0.5, 0.5, PLATES_PER_STUD])
        // Its back half a plate in or out, as far as a recess or a flange puts it.
        for (const dOut of [0, -0.5, 0.5].filter((d) => Math.abs(s.out + d) <= 0.5)) {
          const at = sidewaysAt(v.x ? s.x : s.z, face, s.out + dOut);
          const x = v.x ? at : s.x - i;
          const z = v.x ? s.z - i : at;
          out.push({ type, rot, face, x, y: y + dy, z });
        }
    }
  return out;
}

describe('orientations', () => {
  it('are the 24 right-handed turns square to the grid, each once', () => {
    expect(ORIENTATIONS).toHaveLength(24);
    expect(new Set(ORIENTATIONS.map(orientationKey)).size).toBe(24);
    for (const o of ORIENTATIONS) {
      const x = axisVector(o.x);
      const y = axisVector(o.y);
      const z = axisVector(o.z);
      // z = x × y
      expect(
        unsigned(v3(x.y * y.z - x.z * y.y, x.z * y.x - x.x * y.z, x.x * y.y - x.y * y.x)),
      ).toEqual(z);
      expect(orientationByKey(orientationKey(o))).toBe(o);
    }
    // Up points every way, four turns about each.
    for (const a of AXES) expect(ORIENTATIONS.filter((o) => o.y === a)).toHaveLength(4);
  });

  it('compose and invert as turns do', () => {
    const id = ORIENTATIONS[0]!;
    expect(orientationKey(id)).toBe('+y+x');
    for (const a of ORIENTATIONS) {
      expect(composeOrientations(a, invertOrientation(a))).toBe(id);
      expect(composeOrientations(invertOrientation(a), a)).toBe(id);
      for (const b of ORIENTATIONS) {
        const ab = composeOrientations(a, b);
        expect(ORIENTATIONS).toContain(ab);
        const v = v3(1, 2, 3);
        expect(applyOrientation(ab, v)).toEqual(applyOrientation(a, applyOrientation(b, v)));
      }
    }
  });

  it('upright turns come first, in the order of a rotation', () => {
    for (const rot of ROTS)
      expect(orientationOf({ type: '2x4', rot, x: 0, y: 0, z: 0 })).toBe(ORIENTATIONS[rot]);
  });

  it('match the way every placement is turned and drawn', () => {
    const placements: Placement[] = [
      ...uprightPlacements(),
      ...FACINGS.flatMap((face) =>
        ROTS.map((rot) => ({ type: 'tile1x2' as const, rot, face, x: 0, y: 0, z: 0 })),
      ),
    ];
    const seen = new Set<string>();
    for (const p of placements) {
      const o = orientationOf(p);
      seen.add(orientationKey(o));
      const axes = partAxes(p);
      const q = partQuat(p);
      for (const a of ['x', 'y', 'z'] as const) {
        const want = axisVector(o[a]);
        const r = rotate(q, axisVector(`+${a}`));
        expect(unsigned(axes[a])).toEqual(want);
        expect(
          Math.abs(r.x - want.x) + Math.abs(r.y - want.y) + Math.abs(r.z - want.z),
        ).toBeLessThan(1e-9);
      }
    }
    // Today's placements use the four upright turns and four for each side: 20 of the 24.
    expect(seen.size).toBe(20);
    expect([...seen].filter((k) => k.startsWith('-y'))).toEqual([]);
  });
});

describe('parts on the lattice', () => {
  it('every stud, side stud and receiver is on the lattice', () => {
    for (const p of uprightPlacements()) {
      const s = placedShape(p);
      for (const v of [...s.studs, ...s.receivers].map((a) => a.at))
        for (const n of [v.x, v.y, v.z]) expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('upright parts have the studs on top the grid gives them', () => {
    for (const p of uprightPlacements()) {
      // Each on its own row's top: lower on a stepped part's low rows.
      const top = (c: { x: number; z: number }) => p.y + rowPlates(p.type, ownRow(p, c));
      const lat = placedShape(p).studs.filter((s) => s.kind === 'top');
      expect(
        lat.every((s) => s.dir === '+y'),
        p.type,
      ).toBe(true);
      expect(sorted(lat.map((s) => key(s.at))), `${p.type} ${p.rot}`).toEqual(
        sorted(topStudCells(p).map((c) => key(columnPoint(c, top(c))))),
      );
    }
  });

  it('upright parts have the side studs the grid gives them, where they stand out', () => {
    for (const p of uprightPlacements()) {
      const { grid, lat } = hostStuds(p);
      expect(lat).toHaveLength(grid.length);
      grid.forEach((s, i) => {
        const v = faceVector(s.dir);
        const off = S / 2 + s.out * P;
        const c = columnPoint(s, s.y);
        expect(lat[i]!.dir, `${p.type} ${p.rot}`).toBe(s.dir);
        expect(lat[i]!.at).toEqual(v3(c.x + v.x * off, c.y, c.z + v.z * off));
        expect(!!lat[i]!.open).toBe(!!BRICK_TYPES[p.type].openSideStuds);
      });
    }
  });

  it('upright parts take studs where the grid has them take them', () => {
    for (const p of uprightPlacements()) {
      const grips = bottomGrips(p);
      const all = placedShape(p).receivers;
      const rs = all.filter((r) => r.dir === '-y');
      const at = (kinds: Receiver['kind'][]) =>
        sorted(rs.filter((r) => kinds.includes(r.kind)).map((r) => key(r.at)));
      // The rest is a hole on top, only where the part has one.
      expect(all.length - rs.length).toBe(BRICK_TYPES[p.type].topHole ? 1 : 0);
      expect(at(['hole', 'bar']), `${p.type} ${p.rot}`).toEqual(
        sorted(grips.under.map((c) => key(columnPoint(c, p.y)))),
      );
      expect(at(['around'])).toEqual(sorted(grips.around.map((c) => key(columnPoint(c, p.y)))));
      const bar = BRICK_TYPES[p.type].bottom === 'bar';
      expect(rs.every((r) => (r.kind === 'bar') === bar)).toBe(true);
    }
  });

  it('upright parts fill the slots the grid fills, and a bracket its whole flange', () => {
    for (const p of uprightPlacements())
      expect(sorted(boxSlots(placedShape(p))), `${p.type} ${p.rot} ${p.x}`).toEqual(
        sorted(uprightSlots(p)),
      );
  });

  it('sideways parts clip onto the side studs the grid clips them onto, and fill its slots', () => {
    let clipped = 0;
    let missed = 0;
    for (const hostType of HOSTS)
      for (const hostRot of ROTS) {
        const host: Placement = { type: hostType, rot: hostRot, x: 4, y: 3, z: 4 };
        const { grid, lat } = hostStuds(host);
        for (const s of grid)
          for (const type of MOUNTABLE)
            for (const rot of ROTS)
              for (const p of sidewaysOnto(type, rot, s)) {
                const shape = placedShape(p);
                const name = `${type} ${rot} ${p.face} on ${hostType} ${hostRot}`;
                grid.forEach((t, i) => {
                  const want = clipsOnto(p, t);
                  const got = shape.receivers.some((r) => clutches(lat[i]!, r));
                  if (got !== want) expect({ got, want, p }, name).toBeUndefined();
                  if (want) clipped++;
                  else missed++;
                });
                const slots = sidewaysSlots(p);
                const boxes = boxSlots(shape);
                if (slots.size !== boxes.size || [...slots].some((k) => !boxes.has(k)))
                  expect(sorted(boxes), name).toEqual(sorted(slots));
              }
      }
    // Both outcomes came up plenty.
    expect(clipped).toBeGreaterThan(1000);
    expect(missed).toBeGreaterThan(1000);
    // Tens of thousands of placements: a few seconds alone, more beside the other tests.
  }, 60_000);

  it('a sideways plate offers its studs straight out from the side studs it is clipped to', () => {
    const host: Placement = { type: 'sidestuds1x2', rot: 0, x: 0, y: 1, z: 0 };
    const plate: Placement = { type: 'plate1x2', rot: 0, face: '+z', x: 0, y: 1.5, z: 1 };
    const side = hostStuds(host).lat;
    const studs = placedShape(plate).studs;
    expect(studs.map((s) => s.dir)).toEqual(['+z', '+z']);
    expect(sorted(studs.map((s) => key(s.at)))).toEqual(
      sorted(side.map((s) => key(v3(s.at.x, s.at.y, s.at.z + P)))),
    );
    expect(side.every((s) => placedShape(plate).receivers.some((r) => clutches(s, r)))).toBe(true);
  });
});

describe('every part of every build on the lattice', () => {
  const bricks = (build: (typeof BUILDS)[number]): PlacedBrick[] => {
    let id = 1;
    return build.steps.flatMap((s) => s.bricks).map((b) => ({ ...b, id: id++ }));
  };

  it('fills the slots the grid fills', () => {
    for (const build of BUILDS)
      for (const b of bricks(build)) {
        const want = b.face ? sidewaysSlots(b) : uprightSlots(b);
        expect(sorted(boxSlots(placedShape(b))), `${build.id} ${b.type}`).toEqual(sorted(want));
      }
  });

  it('clutches where the grid connects parts', () => {
    for (const build of BUILDS) {
      const list = bricks(build);
      const grid = BrickGrid.from(list);
      const shapes = new Map(list.map((b) => [b.id, placedShape(b)]));
      const topStuds = new Map<string, LatticeStud[]>();
      for (const shape of shapes.values())
        for (const s of shape.studs)
          if (s.kind === 'top') topStuds.set(key(s.at), [...(topStuds.get(key(s.at)) ?? []), s]);
      for (const c of grid.connections()) {
        const lower = grid.bricks.get(c.lower)!;
        const upper = grid.bricks.get(c.upper)!;
        const studs = shapes.get(c.lower)!.studs;
        const rs = shapes.get(c.upper)!.receivers;
        const name = `${build.id}: ${upper.type} on ${lower.type}`;
        if (upper.face) {
          // One connection per side stud the part clips onto.
          const n = studs.filter((s) => s.kind === 'side' && rs.some((r) => clutches(s, r))).length;
          expect(n, name).toBe(c.studs);
          continue;
        }
        const tops = studs.filter((s) => s.kind === 'top');
        const meets = (r: Receiver) => tops.some((s) => clutches(s, r));
        // A centre hollow between four studs holds with all four there, from any parts.
        const around = rs.filter((r) => r.kind === 'around');
        const held = around.every((r) =>
          [...(topStuds.get(key(r.at)) ?? [])].some((s) => clutches(s, r)),
        );
        const n =
          rs.filter((r) => r.kind !== 'around' && meets(r)).length +
          (around.length && held ? around.filter(meets).length : 0);
        expect(n, name).toBe(c.studs);
      }
    }
  });
});
