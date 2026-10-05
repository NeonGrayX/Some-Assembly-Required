import { add, IDENTITY, mulQuat, rotate, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import type { HideoutDef } from './house.ts';

/** A box: its centre, half extents and rotation. */
export interface PartPose {
  centre: Vec3;
  half: Vec3;
  rot: Quat;
}

/** How far a drawer slides out when opened. */
const DRAWER_TRAVEL = 0.32;
/** How far doors swing and lids lift when opened (radians). */
const SWING = 1.9;
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
export function hideoutPart(def: HideoutDef, open: boolean): PartPose {
  const { x: w, y: h, z: d } = def.size;
  if (def.kind === 'drawer') {
    return {
      centre: v3(0, 0, open ? -DRAWER_TRAVEL : 0),
      half: v3(w / 2, h / 2, d / 2),
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
    // Lifted and tipped back.
    return open
      ? {
          centre: v3(0, 0.2, d * 0.55),
          half: v3(w / 2, h / 2, d / 2),
          rot: axisQuat(v3(1, 0, 0), -0.7),
        }
      : { centre: v3(), half: v3(w / 2, h / 2, d / 2), rot: IDENTITY };
  }
  if (hasLid(def)) {
    const lidH = lidHeight(def);
    const hinge = v3(0, h / 2 - lidH, d / 2);
    const rot = axisQuat(v3(1, 0, 0), open ? SWING : 0);
    return {
      centre: add(hinge, rotate(rot, v3(0, lidH / 2, -d / 2))),
      half: v3(w / 2, lidH / 2, d / 2),
      rot,
    };
  }
  const hinge = v3(-w / 2, 0, -d / 2 + DOOR_THICKNESS / 2);
  const rot = axisQuat(v3(0, 1, 0), open ? SWING : 0);
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
export const hideoutPartInWorld = (def: HideoutDef, open: boolean): PartPose =>
  inWorld(def, hideoutPart(def, open));
