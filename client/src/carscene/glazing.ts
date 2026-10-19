import * as THREE from 'three';
import { weather } from './car.ts';
import { notch, outlinePoints, widen } from './doors.ts';
import { put, rbox, slab } from './kit.ts';

/**
 * A run of a shell's outline to sink glass into: from `a` to `c` (in the outline's own order,
 * along a straight of it), sunk from `e0` along it to `e1` short of its end.
 */
export type GlassRun = [a: THREE.Vector2, c: THREE.Vector2, e0: number, e1: number];

/**
 * A hollow shell's cabin: how thick its skin is inside its bevels (each `b` more), the height
 * its floor comes no lower than, and what lines it inside (seen from within only).
 */
export interface Hollow {
  skin: number;
  floor: number;
  lining: THREE.Material;
  /** Along x, where its floor is left open onto a well below. */
  open?: [number, number];
  /**
   * Whether its tail is left open, its skin broken all up the outline's back (a straight up at
   * its least x), its lining stopping this far in from there: for a wall built apart.
   */
  openTail?: number;
}

/**
 * A glazed shell, its glass set into it rather than laid on it: a slab of `outline` (its side,
 * extruded across `half` × 2), built as two sides `pillar` thick with `openings` cut through each
 * (side windows, their frames rolling into them `b` deep, the glass a little way in) and a middle
 * between them a hair lower, sunk `d` under each of `runs` with the glass laid in the recess, so
 * the pillars stand either side of it.
 *
 * `hollow`, the middle is only a skin round a cabin, broken under each run's glass, so the cabin
 * is seen through every window: the side windows and the glass sunk in the runs. Its lining runs
 * round inside the skin only, broken where the skin is, so from within the sides' own inner faces
 * are seen, and out through every window.
 *
 * `doorways` cuts a door's way out of one side (-1 or 1): what lies beyond the edge across it,
 * above it if `up`, else below it (see `notch`). `pieces`, each side is built of these outlines
 * instead (what is left of it round a doorway cut right through it), each opening in the piece
 * it lies in. `only` adds openings to one side alone, and
 * `middle` gives the middle an outline of its own (the same top, say, with no arches cut out of
 * its foot where the wheels are only under the sides).
 */
export function glazedShell(o: {
  outline: THREE.Shape;
  openings: THREE.Shape[];
  half: number;
  pillar: number;
  b: number;
  d: number;
  runs: GlassRun[];
  paint: THREE.Material;
  glass: () => THREE.Material;
  worn: [number, number, number];
  hollow?: Hollow;
  doorways?: { side: number; edge: THREE.Vector2[]; up: boolean }[];
  only?: Record<number, THREE.Shape[]>;
  middle?: THREE.Shape;
  pieces?: THREE.Vector2[][];
}): THREE.Group {
  const { outline, half, pillar, b, d, runs } = o;
  const shell = new THREE.Group();
  // Without the closing point where it comes back to its start.
  const points = (o.middle ?? outline)
    .getPoints(12)
    .filter((p, i, all) => p.distanceTo(all[(i + 1) % all.length]!) > 1e-6);
  const back = Math.min(...points.map((p) => p.x));
  const openings = (side: number) => [...o.openings, ...(o.only?.[side] ?? [])];

  // Its two sides, the openings through them, and any doorway...
  for (const side of [-1, 1]) {
    let rest = outlinePoints(outline);
    for (const d of o.doorways?.filter((d) => d.side === side) ?? [])
      rest = notch(rest, widen(d.edge, b, d.up), d.up).rest;
    for (const piece of o.pieces ?? [rest]) {
      const sideShape = new THREE.Shape(piece);
      sideShape.holes.push(...openings(side).filter((h) => inside(piece, h.getPoints()[0]!)));
      const geo = weather(slab(sideShape, pillar, b), 'slab', false, o.worn);
      // Its inner edge, where it meets the middle, is no edge to wear.
      const nor = geo.attributes.normal as THREE.BufferAttribute;
      const col = geo.attributes.color as THREE.BufferAttribute;
      for (let i = 0; i < nor.count; i++) if (nor.getZ(i) * side < -0.15) col.setXYZ(i, 1, 1, 1);
      put(shell, geo, o.paint, 0, 0, side * (half - pillar / 2));
    }
  }

  // ...and its middle between them, the same side but a hair lower, sunk under each run.
  const sunk: THREE.Vector2[] = [];
  /** Where each run's sunk floor starts and ends among `sunk`: where a hollow skin breaks. */
  const breaks: [number, number][] = [];
  /** The floor of each run's recess, its two ends among `sunk`: no lining follows it down. */
  const recess = new Set<number>();
  const open = o.hollow?.open;
  for (const [i, p] of points.entries()) {
    sunk.push(p);
    const q = points[(i + 1) % points.length]!;
    // Its floor broken over the well, where it runs across it.
    const floor = o.hollow?.floor ?? 0;
    if (
      open &&
      p.y < floor &&
      q.y < floor &&
      Math.min(p.x, q.x) < open[0] &&
      Math.max(p.x, q.x) > open[1]
    ) {
      const at = (x: number) => p.clone().lerp(q, (x - p.x) / (q.x - p.x));
      const ends = p.x < q.x ? open : [open[1], open[0]];
      breaks.push([sunk.length, sunk.length + 1]);
      sunk.push(at(ends[0]!), at(ends[1]!));
    }
    // Its back left open, all up it.
    if (
      o.hollow?.openTail !== undefined &&
      Math.abs(p.x - back) < 1e-4 &&
      Math.abs(q.x - back) < 1e-4 &&
      Math.abs(p.y - q.y) > 0.3
    ) {
      breaks.push([sunk.length, sunk.length + 1]);
      sunk.push(p.clone().lerp(q, 0.002), p.clone().lerp(q, 0.998));
    }
    for (const [a, c, e0, e1] of runs) {
      const along = c.clone().sub(a);
      const len = along.length();
      along.normalize();
      // On this run's straight: both ends on its line, between its rounded ends.
      const off = (v: THREE.Vector2) => Math.abs(v.clone().sub(a).cross(along));
      if (off(p) > 1e-4 || off(q) > 1e-4 || p.distanceTo(q) < len * 0.3) continue;
      const out = new THREE.Vector2(along.y, -along.x);
      const at = (t: number, depth: number) =>
        a.clone().addScaledVector(along, t).addScaledVector(out, -depth);
      breaks.push([sunk.length + 1, sunk.length + 2]);
      recess.add(sunk.length + 1).add(sunk.length + 2);
      sunk.push(at(e0, 0), at(e0, d), at(len - e1, d), at(len - e1, 0));
    }
  }
  if (o.hollow) hollowMiddle(shell, sunk, breaks, recess, half, pillar, b, o, o.hollow);
  else {
    const middle = slab(new THREE.Shape(sunk), (half - b) * 2, b - 0.002);
    put(shell, weather(middle, 'slab', false, o.worn), o.paint);
  }

  for (const [a, c, e0, e1] of runs) {
    const along = c.clone().sub(a);
    const len = along.length();
    along.normalize();
    const out = new THREE.Vector2(along.y, -along.x);
    // The floor of the recess, its ends stepping up, each step `b` into it.
    const run = len - e0 - e1 - 2 * (b - 0.002);
    const mid = a
      .clone()
      .addScaledVector(along, (e0 + len - e1) / 2)
      .addScaledVector(out, -d + b - 0.002 + 0.005);
    rbox(shell, o.glass(), mid.x, mid.y, 0, run + 0.01, 0.008, (half - pillar) * 2 + 0.05, 0.003, [
      0,
      0,
      Math.atan2(along.y, along.x),
    ]).castShadow = false;
  }
  // The side windows' glass, a little way into each opening, its edges in the frame.
  for (const side of [-1, 1])
    for (const h of openings(side)) {
      const geo = slab(h, 0.01, 0.003, 8);
      put(shell, geo, o.glass(), 0, 0, side * (half - 0.04)).castShadow = false;
    }
  return shell;
}

/** Whether `p` lies inside `outline`: whether a line from it along +x crosses it an odd number of times. */
function inside(outline: THREE.Vector2[], p: THREE.Vector2): boolean {
  let odd = false;
  for (const [i, a] of outline.entries()) {
    const c = outline[(i + 1) % outline.length]!;
    if (a.y > p.y !== c.y > p.y && p.x < a.x + ((p.y - a.y) / (c.y - a.y)) * (c.x - a.x))
      odd = !odd;
  }
  return odd;
}

/** What of `outline` lies `by` or more along `n`: on that side of the line across it. */
export function clipLine(outline: THREE.Vector2[], n: THREE.Vector2, by: number): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const over = (p: THREE.Vector2) => p.dot(n) - by;
  for (const [i, p] of outline.entries()) {
    const q = outline[(i + 1) % outline.length]!;
    if (over(p) >= 0) out.push(p.clone());
    if (over(p) >= 0 !== over(q) >= 0) out.push(p.clone().lerp(q, over(p) / (over(p) - over(q))));
  }
  return out;
}

/**
 * `outline`'s points moved `by` in from it (each along the two edges' inward normals between,
 * mitred), and up to `floor` where they would be lower.
 */
export function inset(outline: THREE.Vector2[], by: number, floor = -Infinity): THREE.Vector2[] {
  const n = outline.length;
  // Inward is to the left along a counter-clockwise outline, to the right along a clockwise one.
  const turn = Math.sign(THREE.ShapeUtils.area(outline)) || 1;
  const inward = (a: THREE.Vector2, c: THREE.Vector2) => {
    const e = c.clone().sub(a).normalize();
    return new THREE.Vector2(-e.y * turn, e.x * turn);
  };
  return outline.map((p, i) => {
    const a = inward(outline[(i + n - 1) % n]!, p);
    const c = inward(p, outline[(i + 1) % n]!);
    const mid = a.add(c);
    const len = mid.length();
    // Mitred, though no further in than twice `by` at a sharp corner.
    const q =
      len < 1e-6 ? p.clone() : p.clone().addScaledVector(mid, (by * Math.min(2, 2 / len)) / len);
    q.y = Math.max(q.y, floor);
    return q;
  });
}

/**
 * The middle of a hollow shell: the skin of `sunk`, across the shell's width less its bevels,
 * broken at each of `breaks` (where a run's glass is), in pieces each running from one break round
 * to the next; and the lining inside it, between its sides, over the top of each `recess`.
 */
function hollowMiddle(
  shell: THREE.Group,
  sunk: THREE.Vector2[],
  breaks: [number, number][],
  recess: Set<number>,
  half: number,
  pillar: number,
  b: number,
  o: { paint: THREE.Material; worn: [number, number, number] },
  hollow: Hollow,
): void {
  const n = sunk.length;
  const inner = inset(sunk, hollow.skin, hollow.floor);
  const cuts = breaks.length ? breaks : [[0, 0] as [number, number]];
  for (const [k, [, from]] of cuts.entries()) {
    const to = cuts[(k + 1) % cuts.length]![0];
    const span = (to - from + n) % n || n;
    const run = Array.from({ length: span + 1 }, (_, j) => (from + j) % n);
    const piece = new THREE.Shape([
      ...run.map((i) => sunk[i]!),
      ...run
        .slice()
        .reverse()
        .map((i) => inner[i]!),
    ]);
    const geo = slab(piece, (half - b) * 2, b - 0.002);
    put(shell, weather(geo, 'slab', false, o.worn), o.paint);
  }
  // Lined inside, a little in from the skin's bevel, seen only from within: round the cabin only,
  // between its sides, broken where the skin is, and stopping short of an open tail. It cuts
  // straight on over each run's recess, not down into it: moved in further than the recess is
  // deep, its corners would cross and fold the lining back out through the skin.
  const kept = [...sunk.keys()].filter((i) => !recess.has(i));
  const lined = inset(
    inset(
      kept.map((i) => sunk[i]!),
      hollow.skin,
      hollow.floor,
    ),
    b + 0.01,
    hollow.floor + b + 0.01,
  );
  // Broken from the edge its skin breaks at, or over a recess, from the step down into it.
  const skip = new Set(breaks.map(([i]) => kept.indexOf(recess.has(i) ? i - 1 : i)));
  const from =
    hollow.openTail === undefined ? -Infinity : Math.min(...sunk.map((p) => p.x)) + hollow.openTail;
  const geo = liningWalls(lined, skip, (half - pillar) * 2 - 0.01, from);
  put(shell, geo, hollow.lining).castShadow = false;
}

/**
 * A lining round `outline` (a closed run of points), `across` wide about z = 0, facing out of it
 * (so a back-sided material is seen from within): a strip along each of its edges but those from
 * the points at `skip` (where there is glass to see out of), and only where it lies at x `from`
 * or more.
 */
export function liningWalls(
  outline: THREE.Vector2[],
  skip: Set<number>,
  across: number,
  from = -Infinity,
): THREE.BufferGeometry {
  const n = outline.length;
  // Out of a counter-clockwise outline is to the right along it; out of a clockwise one, the left.
  const ccw = THREE.ShapeUtils.area(outline) > 0;
  const position: number[] = [];
  const uv: number[] = [];
  const [z0, z1] = [-across / 2, across / 2];
  let u = 0;
  for (let i = 0; i < n; i++) {
    let a = outline[i]!;
    let c = outline[(i + 1) % n]!;
    const len = a.distanceTo(c);
    if (!skip.has(i) && (a.x >= from || c.x >= from)) {
      if (a.x < from) a = a.clone().lerp(c, (from - a.x) / (c.x - a.x));
      if (c.x < from) c = c.clone().lerp(a, (from - c.x) / (a.x - c.x));
      if (!ccw) [a, c] = [c, a];
      const [ua, uc] = [u, u + a.distanceTo(c)];
      const quad = [
        [a, z0, ua, 0],
        [c, z0, uc, 0],
        [c, z1, uc, across],
        [a, z0, ua, 0],
        [c, z1, uc, across],
        [a, z1, ua, across],
      ] as const;
      for (const [p, z, pu, pv] of quad) {
        position.push(p.x, p.y, z);
        uv.push(pu, pv);
      }
    }
    u += len;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
