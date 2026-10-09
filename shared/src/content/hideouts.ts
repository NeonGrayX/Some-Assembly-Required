import { add, dot, IDENTITY, length, mulQuat, rotate, sub, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import { BOARD_SIZE, binPose, floorLevel, groundPieces, levelBoards } from './house.ts';
import type { HideoutDef, LevelDef } from './house.ts';

/** A box: its centre, half extents and rotation. */
export interface PartPose {
  centre: Vec3;
  half: Vec3;
  rot: Quat;
}

/** How far a drawer slides out when opened and nothing is in the way. */
export const DRAWER_TRAVEL = 0.32;
/** Depth of the tray behind a drawer's front. */
export const DRAWER_TRAY = 0.4;
/** How far doors swing when nothing is in the way (radians). */
export const SWING = 1.9;
/** How far lids lift when nothing is in the way: a little past upright (radians). */
const LID_SWING = 1.75;
export const DOOR_THICKNESS = 0.03;
/** How far a door's handle stands out of its face: a door stops swinging before it does. */
export const HANDLE_DEPTH = 0.04;
/**
 * The gap under a door: enough to swing over a rug lying in front of it, folded back or not
 * (a rug and its fold are a few centimetres thick).
 */
const DOOR_FLOOR_GAP = 0.05;

const axisQuat = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
};

/** Height of the lid on boxes that open upwards (toolbox, chest): the chest's is domed. */
export const lidHeight = (def: HideoutDef): number =>
  def.kind === 'chest' || def.kind === 'skip'
    ? def.size.y * 0.28
    : def.kind === 'tin'
      ? Math.min(0.04, def.size.y * 0.2)
      : Math.min(0.08, def.size.y * 0.3);

/** Hiding places opened by a door hinged on their left edge (a tent's rolls up instead). */
export const hasDoor = (def: HideoutDef): boolean =>
  def.kind === 'fridge' ||
  def.kind === 'locker' ||
  def.kind === 'cabinet' ||
  def.kind === 'tent' ||
  def.kind === 'portaloo' ||
  def.kind === 'safe';

/** Hiding places opened by a lid hinged at the back. */
export const hasLid = (def: HideoutDef): boolean =>
  def.kind === 'toolbox' ||
  def.kind === 'chest' ||
  def.kind === 'skip' ||
  def.kind === 'coolbox' ||
  def.kind === 'tin';

/** Soft things lying on something, tipped up to look under: a cushion, a berth's blanket. */
export const isSoft = (def: HideoutDef): boolean => def.kind === 'cushion' || def.kind === 'berth';

/** Hiding places opened by a front flap hinged at the bottom, like a letterbox's. */
export const hasFlap = (def: HideoutDef): boolean => def.kind === 'mailbox';

/**
 * How far a hiding place opens when nothing is in the way: an angle for doors and lids, a
 * distance for drawers. `openingIn` says how far it actually gets in a level.
 */
export const fullOpening = (def: HideoutDef): number =>
  def.kind === 'drawer'
    ? DRAWER_TRAVEL
    : hasFlap(def)
      ? Math.PI / 2
      : hasLid(def)
        ? LID_SWING
        : SWING;

/**
 * The part of a hiding place that moves when it is opened (door, drawer, lid, rug or cushion),
 * in the hiding place's own frame: centred on its `pos`, local -z is its front. `opening` is
 * how far it opens (see `fullOpening`). Renderers draw the part here and the simulation clicks
 * on it here, so the two always agree.
 */
export function hideoutPart(def: HideoutDef, open: boolean, opening = fullOpening(def)): PartPose {
  return hideoutPartAt(def, open ? 1 : 0, opening);
}

/**
 * The moving part partway between shut (`amount` 0) and open (1), as `hideoutPart` poses it at
 * either end. Renderers use it to animate opening and closing; the simulation only ever needs
 * the two ends.
 */
export function hideoutPartAt(
  def: HideoutDef,
  amount: number,
  opening = fullOpening(def),
): PartPose {
  const { x: w, y: h, z: d } = def.size;
  const t = Math.min(1, Math.max(0, amount));
  if (def.kind === 'drawer') {
    // The front and the tray behind it, which slides out with it.
    return {
      centre: v3(0, 0, -opening * t + DRAWER_TRAY / 2),
      half: v3(w / 2, h / 2, (d + DRAWER_TRAY) / 2),
      rot: IDENTITY,
    };
  }
  if (def.kind === 'rug') {
    // Folded back to a bit under half its depth, showing the floor underneath: the front edge
    // moves back while the folded part bunches up behind it.
    return {
      centre: v3(0, 0.02 * t, d * 0.55 * t),
      half: v3(w / 2, h / 2, (d / 2) * (1 - t) + d * 0.225 * t),
      rot: IDENTITY,
    };
  }
  if (isSoft(def)) {
    // Stood up on its back edge, leaning back a little, inside the space it lay in: on the way
    // it tips up with its bottom on the seat below and its back against the backrest behind,
    // and stays clear of both.
    const tip = (Math.PI / 2 - 0.2) * t;
    const [c, s] = [Math.cos(tip), Math.sin(tip)];
    const gap = 0.01 * t;
    return {
      centre: v3(
        0,
        -h / 2 + (h / 2) * c + (d / 2) * s + gap,
        d / 2 - (d / 2) * c - (h / 2) * s - gap,
      ),
      half: v3(w / 2, h / 2, d / 2),
      rot: axisQuat(v3(1, 0, 0), -tip),
    };
  }
  if (hasFlap(def)) {
    // Hinged on its inner bottom edge, where the tunnel behind it starts: it folds down and
    // forward until it lies flat, still joined to the box.
    const hinge = v3(0, -h / 2, -d / 2 + DOOR_THICKNESS);
    const rot = axisQuat(v3(1, 0, 0), -opening * t);
    return {
      centre: add(hinge, rotate(rot, v3(0, h / 2, -DOOR_THICKNESS / 2))),
      half: v3(w / 2, h / 2, DOOR_THICKNESS / 2),
      rot,
    };
  }
  if (hasLid(def)) {
    // Hinged on its bottom back edge, where it meets the box's rim: it lifts to upright
    // behind the box and leans back a little, and never cuts into the box below.
    const lidH = lidHeight(def);
    const hinge = v3(0, h / 2 - lidH, d / 2);
    const rot = axisQuat(v3(1, 0, 0), opening * t);
    return {
      centre: add(hinge, rotate(rot, v3(0, lidH / 2, -d / 2))),
      half: v3(w / 2, lidH / 2, d / 2),
      rot,
    };
  }
  // Hinged on its back outer edge, where it meets the front corner of the body: it swings
  // out past the side and never cuts into the body, and its back stays against that corner.
  // It stops a little short of the top and clears the floor by more, to swing over rugs.
  // A tent's flap does not swing: it unzips down the middle and its halves roll up to the
  // sides (drawn by the renderer), so the panel stays in the doorway, open to click on.
  const top = h / 2 - h * 0.01;
  const bottom = -h / 2 + Math.min(DOOR_FLOOR_GAP, h * 0.1);
  const hinge = v3(-w / 2, (top + bottom) / 2, -d / 2 + DOOR_THICKNESS);
  const rot = axisQuat(v3(0, 1, 0), def.kind === 'tent' ? 0 : opening * t);
  return {
    centre: add(hinge, rotate(rot, v3(w / 2, 0, -DOOR_THICKNESS / 2))),
    half: v3(w / 2, (top - bottom) / 2, DOOR_THICKNESS / 2),
    rot,
  };
}

/**
 * The part of a hiding place that stays put (the fridge's cabinet, the chest's box), in the
 * same frame as `hideoutPart`. Drawers, rugs and cushions have none: they sit in or on
 * something that is part of the house.
 */
export function hideoutBody(def: HideoutDef): PartPose | null {
  const { x: w, y: h, z: d } = def.size;
  if (hasDoor(def) || hasFlap(def))
    return { centre: v3(), half: v3(w / 2, h / 2, (d - DOOR_THICKNESS) / 2), rot: IDENTITY };
  if (hasLid(def)) {
    const lidH = lidHeight(def);
    return { centre: v3(0, -lidH / 2, 0), half: v3(w / 2, (h - lidH) / 2, d / 2), rot: IDENTITY };
  }
  return null;
}

/** A box from `hideoutPart` or `hideoutBody` placed in the world. */
export function inWorld(def: HideoutDef, part: PartPose): PartPose {
  const facing = yawQuat(def.facing);
  return {
    centre: add(def.pos, rotate(facing, part.centre)),
    half: part.half,
    rot: mulQuat(facing, part.rot),
  };
}

/** `hideoutPart` placed in the world. */
export const hideoutPartInWorld = (
  def: HideoutDef,
  open: boolean,
  opening = fullOpening(def),
): PartPose => inWorld(def, hideoutPart(def, open, opening));

const AXES = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];

const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/**
 * Whether two boxes overlap by more than a few millimetres (boxes that only touch do not
 * count). The separating axis test, so thin things like ladder rails are never missed.
 */
export function boxesOverlap(a: PartPose, b: PartPose, margin = 0.005): boolean {
  // Boxes farther apart than their corners reach never touch: most pairs end here.
  if (length(sub(b.centre, a.centre)) > length(a.half) + length(b.half)) return false;
  const ax = AXES.map((u) => rotate(a.rot, u));
  const bx = AXES.map((u) => rotate(b.rot, u));
  const ah = [a.half.x, a.half.y, a.half.z];
  const bh = [b.half.x, b.half.y, b.half.z];
  const t = sub(b.centre, a.centre);
  const axes = [...ax, ...bx];
  for (const u of ax) for (const v of bx) axes.push(cross(u, v));
  for (const l of axes) {
    const len = length(l);
    if (len < 1e-6) continue;
    let ra = 0;
    let rb = 0;
    for (let i = 0; i < 3; i++) {
      ra += Math.abs(dot(ax[i]!, l)) * ah[i]!;
      rb += Math.abs(dot(bx[i]!, l)) * bh[i]!;
    }
    if (Math.abs(dot(t, l)) > ra + rb - margin * len) return false;
  }
  return true;
}

/** Everything in the level that never moves, apart from `def` itself. */
function fixedBoxes(level: LevelDef, def: HideoutDef): PartPose[] {
  const boxes: PartPose[] = [
    ...groundPieces(level).map((q) => ({
      centre: v3((q.x0 + q.x1) / 2, -0.5, (q.z0 + q.z1) / 2),
      half: v3((q.x1 - q.x0) / 2, 0.5, (q.z1 - q.z0) / 2),
      rot: IDENTITY,
    })),
    ...level.boxes.map((b) => ({
      centre: b.pos,
      half: v3(b.size.x / 2, b.size.y / 2, b.size.z / 2),
      rot: axisQuat(v3(1, 0, 0), b.tiltX ?? 0),
    })),
    ...level.bins.map((b) => {
      const { centre, half, rot } = binPose(b);
      return { centre, half, rot };
    }),
    ...levelBoards(level).map((b) => ({
      centre: b.pos,
      half: v3(BOARD_SIZE.x / 2, BOARD_SIZE.y / 2, BOARD_SIZE.z / 2),
      rot: yawQuat(b.facing),
    })),
    // Ladders have no collider (climbing goes by position), but a door still should not
    // swing through one.
    ...level.ladders.map((l) => ({
      centre: add(l.pos, v3(0, l.height / 2, 0)),
      half: v3(l.width / 2 + 0.03, l.height / 2, 0.03),
      rot: yawQuat(l.facing),
    })),
  ];
  for (const other of level.hideouts) {
    if (other.id === def.id) continue;
    const body = hideoutBody(other);
    if (body) boxes.push(inWorld(other, body));
    boxes.push(hideoutPartInWorld(other, false));
  }
  return boxes;
}

/**
 * How far a hiding place opens in a level: a door or lid swings, and a drawer slides out,
 * until it would run into a wall or anything else that never moves, wherever it stands.
 * Worked out from the level alone, so the server, every client and the renderer agree.
 */
export function openingIn(level: LevelDef, def: HideoutDef): number {
  let openings = cache.get(level);
  if (!openings) cache.set(level, (openings = new Map()));
  let opening = openings.get(def.id);
  if (opening === undefined) openings.set(def.id, (opening = findOpening(level, def)));
  return opening;
}

/** Levels never change, so each hiding place's opening is only worked out once. */
const cache = new WeakMap<LevelDef, Map<number, number>>();

/** The moving part's box at `opening` that has to stay clear of everything else. */
function sweptBox(def: HideoutDef, opening: number): PartPose {
  if (hasDoor(def)) {
    // With the handle on its face: it must not end up in a wall either.
    const part = hideoutPartInWorld(def, true, opening);
    const out = rotate(part.rot, v3(0, 0, -HANDLE_DEPTH / 2));
    return {
      centre: add(part.centre, out),
      half: v3(part.half.x, part.half.y, part.half.z + HANDLE_DEPTH / 2),
      rot: part.rot,
    };
  }
  if (def.kind !== 'drawer') return hideoutPartInWorld(def, true, opening);
  // A drawer's tray slides out of its housing by design: only its front has to get past.
  const { x: w, y: h, z: d } = def.size;
  return inWorld(def, { centre: v3(0, 0, -opening), half: v3(w / 2, h / 2, d / 2), rot: IDENTITY });
}

function findOpening(level: LevelDef, def: HideoutDef): number {
  const full = fullOpening(def);
  if (!hasDoor(def) && !hasLid(def) && !hasFlap(def) && def.kind !== 'drawer') return full;
  // A tent's door rolls up in its own doorway, so nothing round it is ever in the way.
  if (def.kind === 'tent') return full;
  const reach = length(def.size) + full + 0.1;
  // Whatever the shut door itself touches is its housing. Its handle, which stands out of its
  // face, is not part of that: a pillar just in front of it still stops the handle.
  const shut = hasDoor(def) ? hideoutPartInWorld(def, false) : sweptBox(def, 0);
  const near = fixedBoxes(level, def).filter(
    (b) =>
      length(sub(b.centre, def.pos)) < reach + length(b.half) &&
      // Whatever it already sits in when shut is its housing, not in the way.
      !boxesOverlap(shut, b),
  );
  const steps = def.kind === 'drawer' ? 32 : 96;
  for (let i = 1; i <= steps; i++) {
    const at = (full * i) / steps;
    const swept = sweptBox(def, at);
    if (near.some((b) => boxesOverlap(swept, b))) return (full * (i - 1)) / steps;
  }
  return full;
}

/**
 * Where things hidden in a hiding place come out when it is opened: on the floor in front of
 * it, clear of the open door or drawer and of anything else, so they can be picked up.
 * Rugs and cushions leave them where they lay.
 */
export function dropSpot(level: LevelDef, def: HideoutDef): Vec3 {
  if (def.kind === 'rug' || def.kind === 'cushion') return add(def.pos, v3(0, def.size.y / 2, 0));
  const opening = openingIn(level, def);
  const frontFace = def.size.z / 2 + (def.kind === 'drawer' ? opening : 0);
  const facing = yawQuat(def.facing);
  // Spots are tried no farther than this from it, so only what is that close can be in the way.
  const near = length(def.size) + opening + 1.5;
  const blockers = [
    ...fixedBoxes(level, def).filter((b) => length(sub(b.centre, def.pos)) < near + length(b.half)),
    hideoutPartInWorld(def, true, opening),
  ];
  const body = hideoutBody(def);
  if (body) blockers.push(inWorld(def, body));
  // On the floor it stands on, downstairs or up.
  const floor = floorLevel(def.pos.y);
  const lift = def.kind === 'mailbox' ? 0 : Math.max(floor, def.pos.y - def.size.y / 2);
  let first: Vec3 | null = null;
  for (const ahead of [0.3, 0.45, 0.65, 0.9])
    for (const aside of [0, 0.35, -0.35, 0.7, -0.7]) {
      const out = add(def.pos, rotate(facing, v3(aside, 0, -(frontFace + ahead))));
      const spot = v3(out.x, lift, out.z);
      first ??= spot;
      // A page's footprint, from the floor up to where it is let go.
      const page = {
        centre: v3(out.x, (floor + lift + 0.06) / 2, out.z),
        half: v3(0.24, (lift + 0.06 - floor) / 2, 0.24),
        rot: facing,
      };
      if (!blockers.some((b) => boxesOverlap(page, b))) return spot;
    }
  return first!;
}
