import { BRICK_TYPES, PLATE_H, STUD } from './bricks.ts';
import type { BrickTypeId, Shape } from './bricks.ts';
import type { BrickGrid, Connection, PlacedBrick } from './grid.ts';
import { hasCentreHollow, partBounds, partCentre } from './parts.ts';
import type { MetreBox } from './parts.ts';

/*
 * Clutch power: how hard a part holds on to what it sits on, against how much of it there is
 * to shake loose. A joint holds with its contact area (the studs it grips); an impact pulls on
 * it with the mass of whatever hangs on it (its volume), and tips it over with that mass's
 * height above the joint against how wide the joint is. So a flat plate gripping on every stud
 * hardly notices a knock, and a tower of round 1x1 bricks, each held by one stud and stacked
 * high above it, falls over when its plate is just picked up.
 */

/** Impacts gentler than this (velocity change in m/s) never break anything. */
export const BREAK_MIN_SEVERITY = 0.5;
/**
 * Velocity change (m/s) that knocks off a 1x1 plate's worth of clutch power 1. Our bricks are
 * shoebox-sized, and with real clutch a build that big would crumble under its own weight
 * (mass grows with the cube of size, contact area with the square), so a piece's strength
 * grows with the square root of its volume as well: a 2x4 brick on its own takes about 110,
 * a 10-high tower of round 1x1 bricks under 1.
 */
export const CLUTCH_SEVERITY = 70;
/**
 * How much of a full stud's grip a centre hollow takes: a round part's bottom takes one stud
 * with a thin ring, not the walls and tube all round it that a square part grips with.
 */
export const CENTRE_GRIP = 0.6;

/** How much of its grid box a part's body fills, by shape (a round 1x1 is a cylinder: π/4). */
const FILL: Record<Shape, number> = {
  box: 1,
  tile: 1,
  grille: 0.9,
  slope: 0.65,
  cheese: 0.5,
  curve: 0.7,
  round: Math.PI / 4,
  cone: 0.45,
  dish: 0.5,
  window: 0.5,
  plant: 0.4,
  quarter: 0.7,
  leaf: 0.5,
  spire: 0.4,
};

/** A part's volume in grid cells (one stud by one stud by one plate). */
export function partVolume(type: BrickTypeId): number {
  const t = BRICK_TYPES[type];
  return t.studsX * t.studsZ * t.plates * FILL[t.shape ?? 'box'];
}

/** How well a part's bottom grips each stud it takes (1 for square parts). */
export function gripOf(type: BrickTypeId): number {
  return hasCentreHollow(type) ? CENTRE_GRIP : 1;
}

/** Studs a part's bottom takes when it sits squarely on a plate. */
export function bottomStuds(type: BrickTypeId): number {
  const t = BRICK_TYPES[type];
  if (t.bottom === 'first') return 1;
  if (!hasCentreHollow(type)) return t.studsX * t.studsZ;
  return t.studsX >= 2 && t.studsZ >= 2 ? t.studsX * t.studsZ : 1;
}

/**
 * How much a lever of height `h` over a joint `w` wide weakens it: not at all while the load
 * sits low over a wide joint, in proportion once it stands taller than half the joint's width.
 */
const leverage = (w: number, h: number) => (h <= 0 ? 1 : Math.min(1, w / (2 * h)));

/**
 * Clutch power of one part standing on its own on a plate: the contact area its bottom grips
 * divided by its volume, times how far its height levers that joint. 1 for any plate gripping
 * on every stud (an 8x16 plate), 1/3 for a 2x4 brick, 0.21 for a round 1x1 brick (the weakest
 * of the one-brick-high parts), and less still for tall narrow ones (0.01 for a 1x1x5 brick).
 */
export function clutchPower(type: BrickTypeId): number {
  const t = BRICK_TYPES[type];
  const contact = bottomStuds(type) * gripOf(type);
  // The joint is as wide as the narrower side of its contact: one stud for a centre hollow or
  // a part on one stud.
  const narrow = Math.min(t.studsX, t.studsZ);
  const width = ((hasCentreHollow(type) && narrow < 2) || t.bottom === 'first' ? 1 : narrow) * STUD;
  return (contact / partVolume(type)) * leverage(width, (t.plates / 2) * PLATE_H);
}

/** A piece that comes off together when every joint holding it to the rest lets go. */
export interface Piece {
  /** The parts in it. */
  bricks: number[];
  /** The joints holding it on. */
  joints: Connection[];
  /** Its clutch power: like `clutchPower`, for the whole piece on the joints holding it. */
  clutch: number;
  /** Velocity change (m/s) it takes to knock it off. */
  strength: number;
}

/** Which side of a joint plane, and where it is, for each joint. */
interface Plane {
  key: string;
  /** Axis normal to the plane. */
  axis: 'x' | 'y' | 'z';
  /** Position of the plane along it, in metres. */
  at: number;
}

/** The plane a joint lies in: the bottom of the upper part, or the back of a sideways one. */
function planeOf(upper: PlacedBrick): Plane {
  const b = partBounds(upper);
  let axis: Plane['axis'] = 'y';
  let at = b.min.y;
  if (upper.face === '+x') [axis, at] = ['x', b.min.x];
  else if (upper.face === '-x') [axis, at] = ['x', b.max.x];
  else if (upper.face === '+z') [axis, at] = ['z', b.min.z];
  else if (upper.face === '-z') [axis, at] = ['z', b.max.z];
  return { key: `${axis}${Math.round(at * 1e4)}`, axis, at };
}

/** Width of the overlap of two parts across the plane: the narrower of its two spans, in metres. */
function contactWidth(a: MetreBox, b: MetreBox, axis: Plane['axis']): number {
  const spans = (['x', 'y', 'z'] as const)
    .filter((k) => k !== axis)
    .map((k) => Math.max(0, Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k])));
  return Math.min(...spans);
}

const cache = new WeakMap<BrickGrid, { version: number; byMain: Map<number, Piece[]> }>();

/**
 * Every piece that can break off the grid, with how hard a knock it takes. For each plane that
 * joints lie in, cutting all of them there splits off the parts beyond it from the main part of
 * the grid (the one with part `main`, else the baseplate, else the biggest); each such piece is
 * held by its own joints in that plane. Its clutch power is their grip (studs gripped) over its
 * volume, weakened by how high its centre of mass stands over how wide the joints spread.
 */
export function breakablePieces(grid: BrickGrid, main?: number): Piece[] {
  let hit = cache.get(grid);
  if (!hit || hit.version !== grid.version) {
    hit = { version: grid.version, byMain: new Map() };
    cache.set(grid, hit);
  }
  const key = main ?? -1;
  let pieces = hit.byMain.get(key);
  if (!pieces) {
    pieces = findPieces(grid, main);
    hit.byMain.set(key, pieces);
  }
  return pieces;
}

function findPieces(grid: BrickGrid, mainId?: number): Piece[] {
  if (grid.size < 2) return [];
  const all = grid.connections();
  const ids = [...grid.bricks.keys()];
  const volume = new Map(ids.map((id) => [id, partVolume(grid.bricks.get(id)!.type)]));
  const centre = new Map(ids.map((id) => [id, partCentre(grid.bricks.get(id)!)]));
  const bounds = new Map(ids.map((id) => [id, partBounds(grid.bricks.get(id)!)]));
  const fixture =
    mainId !== undefined && grid.bricks.has(mainId)
      ? mainId
      : ids.find((id) => BRICK_TYPES[grid.bricks.get(id)!.type].fixture);

  const planes = new Map<string, { plane: Plane; joints: Connection[] }>();
  for (const c of all) {
    const plane = planeOf(grid.bricks.get(c.upper)!);
    const entry = planes.get(plane.key) ?? { plane, joints: [] };
    entry.joints.push(c);
    planes.set(plane.key, entry);
  }

  const out: Piece[] = [];
  for (const { plane, joints } of planes.values()) {
    // Groups with every joint in this plane cut (union-find).
    const cut = new Set(joints);
    const parent = new Map(ids.map((id) => [id, id]));
    const find = (id: number): number => {
      let r = id;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(id, r);
      return r;
    };
    for (const c of all) if (!cut.has(c)) parent.set(find(c.lower), find(c.upper));
    const groups = new Map<number, number[]>();
    for (const id of ids) {
      const r = find(id);
      const g = groups.get(r);
      if (g) g.push(id);
      else groups.set(r, [id]);
    }
    if (groups.size < 2) continue;
    const vol = (g: number[]) => g.reduce((s, id) => s + volume.get(id)!, 0);
    let main: number;
    if (fixture !== undefined) main = find(fixture);
    else {
      main = -1;
      let best = -1;
      for (const [r, g] of groups) {
        const v = vol(g);
        if (v > best) [main, best] = [r, v];
      }
    }
    for (const [r, bricks] of groups) {
      if (r === main) continue;
      const held = joints.filter((c) => find(c.lower) === r || find(c.upper) === r);
      if (!held.length) continue;
      const v = vol(bricks);
      const com =
        bricks.reduce((s, id) => s + centre.get(id)![plane.axis] * volume.get(id)!, 0) / v;
      // The joints' spread across the plane: their overlaps' bounding box, its narrower side.
      let contact = 0;
      const span = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
      let widest = 0;
      for (const c of held) {
        contact += c.studs * gripOf(grid.bricks.get(c.upper)!.type);
        const a = bounds.get(c.lower)!;
        const b = bounds.get(c.upper)!;
        widest = Math.max(widest, contactWidth(a, b, plane.axis));
        for (const k of ['x', 'y', 'z'] as const) {
          span[k][0] = Math.min(span[k][0]!, Math.max(a.min[k], b.min[k]));
          span[k][1] = Math.max(span[k][1]!, Math.min(a.max[k], b.max[k]));
        }
      }
      const spread = Math.min(
        ...(['x', 'y', 'z'] as const)
          .filter((k) => k !== plane.axis)
          .map((k) => span[k][1]! - span[k][0]!),
      );
      // A centre hollow on a single stud holds over a stud's width, whatever its body's size.
      const width = Math.max(spread, widest, STUD);
      const clutch = (contact / v) * leverage(width, Math.abs(com - plane.at));
      const strength = CLUTCH_SEVERITY * clutch * Math.sqrt(v);
      out.push({ bricks: bricks.sort((a, b) => a - b), joints: held, clutch, strength });
    }
  }
  return out.sort((a, b) => a.strength - b.strength);
}

/**
 * Decides which connections snap during an impact of the given severity (velocity change,
 * m/s): every joint holding a piece that is weaker than the knock. `rng` adds some luck so the
 * same knock does not always break off the same piece. A knock that comes in through one part
 * (`main`, the one picked up) shakes off the pieces around it.
 */
export function planBreaks(
  grid: BrickGrid,
  severity: number,
  rng: () => number,
  main?: number,
): Connection[] {
  if (severity < BREAK_MIN_SEVERITY || grid.size < 2) return [];
  const broken = new Set<Connection>();
  for (const p of breakablePieces(grid, main)) {
    // Sorted weakest first: past the knock's best case, nothing else can go.
    if (p.strength >= severity * 1.2) break;
    if (p.strength < severity * (0.8 + 0.4 * rng())) for (const c of p.joints) broken.add(c);
  }
  return [...broken];
}
