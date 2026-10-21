import { partBounds, placedReach } from '../parts.ts';
import type { TargetBrick, TargetBuild } from './types.ts';

/** The way the manual's camera looks from, before a page's turn (as the page printer shoots). */
const CAMERA = { x: 1, y: 0.9, z: 1.25 };

/** The direction toward the camera for a page turned `turn` quarter turns, normalised. */
function towardCamera(turn: number): { x: number; y: number; z: number } {
  const a = (-turn * Math.PI) / 2;
  const x = CAMERA.x * Math.cos(a) + CAMERA.z * Math.sin(a);
  const z = -CAMERA.x * Math.sin(a) + CAMERA.z * Math.cos(a);
  const n = Math.hypot(x, CAMERA.y, z);
  return { x: x / n, y: CAMERA.y / n, z: z / n };
}

type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

/** Whether the ray from `o` along `d` passes through the box. */
function hits(o: { x: number; y: number; z: number }, d: typeof o, box: Box): boolean {
  let near = 0;
  let far = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] <= box.min[k] || o[k] >= box.max[k]) return false;
      continue;
    }
    const t0 = (box.min[k] - o[k]) / d[k];
    const t1 = (box.max[k] - o[k]) / d[k];
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  return near < far - 1e-9 && far > 1e-9;
}

/** Points spread over the sides of a part's box that face the camera. */
function facingPoints(box: Box, d: { x: number; y: number; z: number }) {
  const out: { x: number; y: number; z: number }[] = [];
  const f = [0.15, 0.5, 0.85];
  const lerp = (k: 'x' | 'y' | 'z', t: number) => box.min[k] + (box.max[k] - box.min[k]) * t;
  const e = 1e-6;
  for (const u of f)
    for (const v of f) {
      if (d.y > 0) out.push({ x: lerp('x', u), y: box.max.y + e, z: lerp('z', v) });
      out.push({ x: d.x > 0 ? box.max.x + e : box.min.x - e, y: lerp('y', u), z: lerp('z', v) });
      out.push({ x: lerp('x', u), y: lerp('y', v), z: d.z > 0 ? box.max.z + e : box.min.z - e });
    }
  return out;
}

/**
 * Parts a page adds that its picture does not show: every bit of them that faces the camera is
 * behind other parts, so a builder can't see where they go. Parts are taken as their boxes, so
 * this errs toward calling a part hidden. As "page N, brick M".
 */
export function pageHides(build: TargetBuild): string[] {
  const out: string[] = [];
  const placed: TargetBrick[] = [];
  build.steps.forEach((step, p) => {
    placed.push(...step.bricks);
    const boxes = placed.map((b) => (b.frame ? placedReach(b) : partBounds(b)));
    const d = towardCamera(build.pages?.[p]?.view?.turn ?? 0);
    const first = placed.length - step.bricks.length;
    step.bricks.forEach((_, i) => {
      const self = first + i;
      const seen = facingPoints(boxes[self]!, d).some((o) =>
        boxes.every((box, j) => j === self || !hits(o, d, box)),
      );
      if (!seen) out.push(`page ${p + 1}, brick ${i + 1}`);
    });
  });
  return out;
}
