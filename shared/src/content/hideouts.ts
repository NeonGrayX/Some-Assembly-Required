import { add, conj, IDENTITY, length, mulQuat, rotate, sub, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import { BIN_SIZE, BOARD_SIZE } from './house.ts';
import type { HideoutDef, LevelDef } from './house.ts';

/** A box: its centre, half extents and rotation. */
export interface PartPose {
  centre: Vec3;
  half: Vec3;
  rot: Quat;
}

/** How far a drawer slides out when opened. */
const DRAWER_TRAVEL = 0.32;
/** Depth of the tray behind a drawer's front. */
export const DRAWER_TRAY = 0.4;
/** How far doors swing and lids lift when nothing is in the way (radians). */
export const SWING = 1.9;
const DOOR_THICKNESS = 0.03;

const axisQuat = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
};

/** Height of the lid on boxes that open upwards (toolbox, chest, mailbox). */
export const lidHeight = (def: HideoutDef): number => Math.min(0.08, def.size.y * 0.3);

/** Hiding places opened by a door hinged on their left edge. */
export const hasDoor = (def: HideoutDef): boolean =>
  def.kind === 'fridge' || def.kind === 'locker' || def.kind === 'cabinet';

/** Hiding places opened by a lid hinged at the back. */
export const hasLid = (def: HideoutDef): boolean =>
  def.kind === 'toolbox' || def.kind === 'chest' || def.kind === 'mailbox';

/**
 * The part of a hiding place that moves when it is opened (door, drawer, lid, rug or cushion),
 * in the hiding place's own frame: centred on its `pos`, local -z is its front. Renderers draw
 * the part here and the simulation clicks on it here, so the two always agree.
 */
export function hideoutPart(def: HideoutDef, open: boolean, swing = SWING): PartPose {
  const { x: w, y: h, z: d } = def.size;
  if (def.kind === 'drawer') {
    // The front and the tray behind it, which slides out with it.
    return {
      centre: v3(0, 0, (open ? -DRAWER_TRAVEL : 0) + DRAWER_TRAY / 2),
      half: v3(w / 2, h / 2, (d + DRAWER_TRAY) / 2),
      rot: IDENTITY,
    };
  }
  if (def.kind === 'rug') {
    // Folded back to a bit under half its depth, showing the floor underneath.
    return open
      ? { centre: v3(0, 0.02, d * 0.55), half: v3(w / 2, h / 2, d * 0.225), rot: IDENTITY }
      : { centre: v3(), half: v3(w / 2, h / 2, d / 2), rot: IDENTITY };
  }
  if (def.kind === 'cushion') {
    if (!open) return { centre: v3(), half: v3(w / 2, h / 2, d / 2), rot: IDENTITY };
    // Stood up on its back edge, leaning back a little, inside the space it lay in: it stays
    // clear of the seat below and the backrest behind.
    const lean = 0.2;
    const [c, s] = [Math.cos(lean), Math.sin(lean)];
    return {
      centre: v3(
        0,
        -h / 2 + (d / 2) * c + (h / 2) * s + 0.01,
        d / 2 - (d / 2) * s - (h / 2) * c - 0.01,
      ),
      half: v3(w / 2, h / 2, d / 2),
      rot: axisQuat(v3(1, 0, 0), -(Math.PI / 2 - lean)),
    };
  }
  if (hasLid(def)) {
    const lidH = lidHeight(def);
    const hinge = v3(0, h / 2 - lidH, d / 2);
    const rot = axisQuat(v3(1, 0, 0), open ? swing : 0);
    return {
      centre: add(hinge, rotate(rot, v3(0, lidH / 2, -d / 2))),
      half: v3(w / 2, lidH / 2, d / 2),
      rot,
    };
  }
  const hinge = v3(-w / 2, 0, -d / 2 + DOOR_THICKNESS / 2);
  const rot = axisQuat(v3(0, 1, 0), open ? swing : 0);
  return {
    centre: add(hinge, rotate(rot, v3(w / 2, 0, 0))),
    half: v3(w / 2, h * 0.49, DOOR_THICKNESS / 2),
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
  if (hasDoor(def))
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
export const hideoutPartInWorld = (def: HideoutDef, open: boolean, swing = SWING): PartPose =>
  inWorld(def, hideoutPart(def, open, swing));

/** Whether `p` is inside `box`, by more than a few millimetres. */
function inside(p: Vec3, box: PartPose): boolean {
  const l = rotate(conj(box.rot), sub(p, box.centre));
  const e = 0.005;
  return (
    Math.abs(l.x) < box.half.x - e &&
    Math.abs(l.y) < box.half.y - e &&
    Math.abs(l.z) < box.half.z - e
  );
}

/** Everything in the level that never moves, apart from `def` itself. */
function fixedBoxes(level: LevelDef, def: HideoutDef): PartPose[] {
  const boxes: PartPose[] = [
    {
      centre: v3(0, -0.5, 0),
      half: v3(level.floorSize / 2, 0.5, level.floorSize / 2),
      rot: IDENTITY,
    },
    ...level.boxes.map((b) => ({
      centre: b.pos,
      half: v3(b.size.x / 2, b.size.y / 2, b.size.z / 2),
      rot: axisQuat(v3(1, 0, 0), b.tiltX ?? 0),
    })),
    ...level.bins.map((b) => ({
      centre: add(b.pos, v3(0, BIN_SIZE.y / 2, 0)),
      half: v3(BIN_SIZE.x / 2, BIN_SIZE.y / 2, BIN_SIZE.z / 2),
      rot: IDENTITY,
    })),
    {
      centre: level.board.pos,
      half: v3(BOARD_SIZE.x / 2, BOARD_SIZE.y / 2, BOARD_SIZE.z / 2),
      rot: yawQuat(level.board.facing),
    },
  ];
  for (const other of level.hideouts) {
    if (other.id === def.id) continue;
    const body = hideoutBody(other);
    if (body) boxes.push(inWorld(other, body));
    boxes.push(hideoutPartInWorld(other, false));
  }
  return boxes;
}

/** Points spread over a box's surface, about `spacing` apart. */
function surfacePoints(box: PartPose, spacing: number): Vec3[] {
  const steps = (half: number) => Math.max(1, Math.ceil((2 * half) / spacing));
  const [nx, ny, nz] = [steps(box.half.x), steps(box.half.y), steps(box.half.z)];
  const points: Vec3[] = [];
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= ny; j++)
      for (let k = 0; k <= nz; k++) {
        const onFace = i === 0 || i === nx || j === 0 || j === ny || k === 0 || k === nz;
        if (!onFace) continue;
        const local = v3(
          box.half.x * ((2 * i) / nx - 1),
          box.half.y * ((2 * j) / ny - 1),
          box.half.z * ((2 * k) / nz - 1),
        );
        points.push(add(box.centre, rotate(box.rot, local)));
      }
  return points;
}

/**
 * How far a door or lid can open before it would run into a wall or anything else that never
 * moves. Worked out from the level alone, so the server, every client and the renderer agree.
 */
export function openSwing(level: LevelDef, def: HideoutDef): number {
  let swings = swingCache.get(level);
  if (!swings) swingCache.set(level, (swings = new Map()));
  let swing = swings.get(def.id);
  if (swing === undefined) swings.set(def.id, (swing = findSwing(level, def)));
  return swing;
}

/** Levels never change, so each door's swing is only worked out once. */
const swingCache = new WeakMap<LevelDef, Map<number, number>>();

function findSwing(level: LevelDef, def: HideoutDef): number {
  if (!hasDoor(def) && !hasLid(def)) return SWING;
  const reach = length(def.size) + 0.1;
  const near = fixedBoxes(level, def).filter(
    (b) => length(sub(b.centre, def.pos)) < reach + length(b.half),
  );
  const STEP = 0.04;
  for (let a = STEP; a <= SWING + 1e-9; a += STEP) {
    const points = surfacePoints(hideoutPartInWorld(def, true, a), 0.08);
    if (points.some((p) => near.some((b) => inside(p, b)))) return Math.max(0, a - STEP);
  }
  return SWING;
}
