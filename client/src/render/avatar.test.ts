import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, FACES, HATS, SHIRTS } from '@sar/shared';
import type { LadderDef } from '@sar/shared';
import { Ragdoll, animateAvatar, makeAvatar } from './avatar.ts';
import { makeHat } from './hats.ts';

beforeAll(async () => {
  await RAPIER.init();
});

describe('hats', () => {
  it('every hat sits on top of the head, inside its collider, and casts a shadow', () => {
    for (const { id } of HATS) {
      const hat = makeHat(id, 0x1e5bc6);
      if (id === 'none') {
        expect(hat).toBeNull();
        continue;
      }
      expect(hat, id).not.toBeNull();
      const box = new THREE.Box3().setFromObject(hat!.group);
      // Never hangs below the brow line by more than the beanie's band, never towers.
      expect(box.min.y, id).toBeGreaterThan(-0.08);
      expect(box.max.y, id).toBeLessThan(0.4);
      expect(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z), id).toBeLessThan(0.35);
      const { halfHeight, radius, y } = hat!.collider;
      expect(box.max.y, id).toBeLessThanOrEqual(y + halfHeight + 0.06);
      expect(box.min.y, id).toBeGreaterThanOrEqual(y - halfHeight - 0.06);
      expect(Math.max(box.max.x, box.max.z), id).toBeLessThanOrEqual(radius + 0.1);
      let meshes = 0;
      hat!.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          meshes++;
          expect(o.castShadow, id).toBe(true);
        }
      });
      expect(meshes, id).toBeGreaterThan(0);
      expect(hat!.spinner !== null, id).toBe(id === 'propeller');
    }
  });

  it('a bare-headed player ragdolls without a hat and gets up again', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const avatar = makeAvatar(0xc91a1a, null, { ...DEFAULT_LOOK, hat: 'none' });
    expect(avatar.hat).toBeNull();
    const bare = avatar.head.children.length;
    const ragdoll = new Ragdoll(RAPIER, world, avatar, { x: 1, y: 0, z: 0 });
    // Torso, head, two arms, two legs: nothing flies off.
    expect(ragdoll.group.children).toHaveLength(6);
    for (let i = 0; i < 30; i++) world.step();
    ragdoll.sync();
    ragdoll.standUp();
    expect(ragdoll.updateGetUp(0.3)).toBe(false);
    expect(ragdoll.updateGetUp(0.4)).toBe(true);
    ragdoll.dispose();

    const hatted = makeAvatar(0xc91a1a, null, { ...DEFAULT_LOOK, hat: 'tophat' });
    expect(hatted.head.children).toHaveLength(bare + 1);
    const r2 = new Ragdoll(RAPIER, world, hatted, { x: 1, y: 0, z: 0 });
    expect(r2.group.children).toHaveLength(7);
    r2.dispose();
  });

  it('every face and shirt dresses the avatar with shadow-casting parts in front of it', () => {
    const plain = makeAvatar(0x2c9a3a, null);
    const count = (a: ReturnType<typeof makeAvatar>) => {
      let n = 0;
      a.group.traverse((o) => {
        // (The dog biscuit in the hand is hidden until there is one to hold.)
        if (o instanceof THREE.Mesh && o.visible) {
          n++;
          expect(o.castShadow).toBe(true);
        }
      });
      return n;
    };
    const base = count(plain);
    const faces = new Set<string>();
    for (const { id } of FACES) {
      const a = makeAvatar(0x2c9a3a, null, { ...DEFAULT_LOOK, face: id });
      // The face sits on the front (-z) of the head, never inside or behind it, and no two
      // faces are made of the same parts in the same places.
      const parts: string[] = [];
      for (const part of a.head.children) {
        if (part === a.hat || part === a.head.children[0]) continue;
        expect(part.position.z, id).toBeLessThan(-0.1);
        expect(Math.abs(part.position.x), id).toBeLessThan(0.1);
        const { x, y, z } = part.position;
        parts.push(`${(part as THREE.Mesh).geometry.type}@${x},${y},${z}`);
      }
      expect(parts.length, id).toBeGreaterThan(0);
      faces.add(parts.sort().join(' '));
    }
    expect(faces.size).toBe(FACES.length);
    for (const { id } of SHIRTS) {
      const a = makeAvatar(0x2c9a3a, null, { ...DEFAULT_LOOK, shirt: id });
      expect(count(a) >= base, id).toBe(true);
      const box = new THREE.Box3().setFromObject(a.torso, true);
      // Whatever is worn stays close to the body.
      expect(box.max.x - box.min.x, id).toBeLessThan(0.7);
      expect(box.max.y, id).toBeLessThan(0.5);
    }
  });
});

describe('climbing', () => {
  // A ladder leaning west against a wall: climbed from its east side, facing west.
  const ladder: LadderDef = {
    pos: { x: 4, y: 0, z: -2 },
    width: 0.8,
    height: 3,
    facing: Math.PI / 2,
  };
  const gait = { limping: false, carrying: false, careful: false };
  const dt = 1 / 60;
  /** A frame as the view runs one: the sim's pose first, then the animation. */
  const frame = (a: ReturnType<typeof makeAvatar>, y: number, climb: boolean) => {
    a.group.position.set(ladder.pos.x, y, ladder.pos.z);
    a.group.rotation.y = 0;
    animateAvatar(a, { ...gait, climb: climb ? ladder : null }, dt);
    a.group.updateMatrixWorld(true);
  };
  const handAt = (a: ReturnType<typeof makeAvatar>, i: 0 | 1) =>
    (a.arms[i].children[0]!.children[0] as THREE.Mesh).getWorldPosition(new THREE.Vector3());

  it('turns to the ladder, steps back off it and goes up hand over hand', () => {
    const a = makeAvatar(0xc91a1a, null);
    let y = 0.85;
    const lead: number[] = [];
    for (let i = 0; i < 90; i++) {
      frame(a, y, true);
      y += 2.4 * dt;
      if (i >= 30) lead.push(a.arms[0].rotation.x - a.arms[1].rotation.x);
    }
    // Facing the wall (west), a step east of the ladder's plane, between its rails.
    expect(a.group.rotation.y).toBeCloseTo(Math.PI / 2, 2);
    expect(a.group.position.x).toBeCloseTo(4.42, 2);
    expect(a.group.position.z).toBeCloseTo(-2, 2);
    // Both hands up on the rungs: at the ladder's plane, between the rails, above the hips.
    for (const i of [0, 1] as const) {
      expect(a.arms[i].rotation.x).toBeGreaterThan(1.2);
      const hand = handAt(a, i);
      expect(Math.abs(hand.x - ladder.pos.x)).toBeLessThan(0.1);
      expect(Math.abs(hand.z - ladder.pos.z)).toBeLessThan(ladder.width / 2);
      expect(hand.y).toBeGreaterThan(y);
    }
    // One hand leads, then the other.
    expect(Math.max(...lead)).toBeGreaterThan(0.3);
    expect(Math.min(...lead)).toBeLessThan(-0.3);
    // Knees up, looking up.
    expect(Math.max(a.legs[0].rotation.x, a.legs[1].rotation.x)).toBeGreaterThan(0.3);
    expect(Math.min(a.legs[0].rotation.x, a.legs[1].rotation.x)).toBeGreaterThan(0);
    expect(a.head.rotation.x).toBeGreaterThan(0.2);

    // Letting go: back to where the sim has the player, standing easy.
    for (let i = 0; i < 90; i++) frame(a, y, false);
    expect(a.climb).toBe(0);
    expect(a.group.rotation.y).toBe(0);
    expect(a.group.position.x).toBe(ladder.pos.x);
    expect(Math.abs(a.arms[0].rotation.x)).toBeLessThan(0.05);
    expect(Math.abs(a.legs[1].rotation.x)).toBeLessThan(0.05);
    expect(a.head.rotation.x).toBeCloseTo(0, 6);
  });

  it('hangs on with both hands when stopped, and keeps its hands on what it carries', () => {
    const a = makeAvatar(0xc91a1a, null);
    for (let i = 0; i < 90; i++) frame(a, 2, true);
    expect(a.arms[0].rotation.x).toBeCloseTo(a.arms[1].rotation.x, 3);
    expect(a.arms[0].rotation.x).toBeGreaterThan(1.2);

    const b = makeAvatar(0xc91a1a, null);
    for (let i = 0; i < 90; i++) {
      b.group.position.set(ladder.pos.x, 2, ladder.pos.z);
      animateAvatar(b, { ...gait, carrying: true, climb: ladder }, dt);
    }
    // Arms as when carrying anything, legs on the rungs all the same.
    expect(b.arms[0].rotation.x).toBeCloseTo(1.35, 3);
    expect(b.legs[0].rotation.x).toBeGreaterThan(0.3);
  });
});

describe('walking', () => {
  const gait = { limping: false, carrying: false, careful: false };
  const dt = 1 / 60;
  /** Walks for two seconds at `speed` along (`right`, `back`) in the avatar's own frame. */
  const walk = (limping: boolean, right: number, back: number, speed = 3.5) => {
    const a = makeAvatar(0xc91a1a, null);
    a.group.rotation.y = 0.7;
    const frames: { legX: [number, number]; legZ: [number, number]; list: number }[] = [];
    const d = new THREE.Vector3(right, 0, back).normalize().multiplyScalar(speed * dt);
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), a.group.rotation.y);
    for (let i = 0; i < 120; i++) {
      a.group.position.add(d);
      animateAvatar(a, { ...gait, limping }, dt);
      if (i >= 60) {
        frames.push({
          legX: [a.legs[0].rotation.x, a.legs[1].rotation.x],
          legZ: [a.legs[0].rotation.z, a.legs[1].rotation.z],
          list: a.torso.rotation.z,
        });
      }
    }
    const most = (f: (x: (typeof frames)[number]) => number) => Math.max(...frames.map(f));
    return { a, frames, most };
  };

  it('swings the legs ahead and back when walking forward, without side steps', () => {
    const { most } = walk(false, 0, -1);
    expect(most((f) => f.legX[0])).toBeGreaterThan(0.3);
    expect(most((f) => Math.abs(f.legZ[0]) + Math.abs(f.legZ[1]))).toBeLessThan(0.01);
  });

  it('side-steps when strafing, the leading leg opening out', () => {
    for (const dir of [-1, 1]) {
      const { a, frames, most } = walk(false, dir, 0);
      expect(Math.sign(a.side)).toBe(dir);
      expect(most((f) => Math.abs(f.legX[0]))).toBeLessThan(0.01);
      // Each leg only ever opens outward, and both open in turn.
      expect(most((f) => -f.legZ[0])).toBeGreaterThan(0.1);
      expect(most((f) => f.legZ[1])).toBeGreaterThan(0.1);
      expect(most((f) => f.legZ[0])).toBeLessThanOrEqual(0);
      expect(most((f) => -f.legZ[1])).toBeLessThanOrEqual(0);
      // The leading leg is out first: the right one going right, the left one going left.
      // At its widest, the other is still opening.
      const [lead, trail] = dir < 0 ? [0, 1] : [1, 0];
      const open = frames.map((f) => Math.abs(f.legZ[lead]!));
      const peak = open.indexOf(Math.max(...open.slice(0, -1)));
      expect(Math.abs(frames[peak + 1]!.legZ[trail]!)).toBeGreaterThan(
        Math.abs(frames[peak]!.legZ[trail]!),
      );
    }
  });

  it('limps on the right leg, leaning over it as it takes the weight', () => {
    const sound = walk(false, 0, -1, 1.6);
    const sore = walk(true, 0, -1, 1.6);
    // The sore leg hardly swings next to the good one.
    expect(sore.most((f) => Math.abs(f.legX[1]))).toBeLessThan(
      sore.most((f) => Math.abs(f.legX[0])) * 0.5,
    );
    // Leaning right (-z) every other step, never left; a sound walk stays upright.
    expect(sore.most((f) => -f.list)).toBeGreaterThan(0.1);
    expect(sore.most((f) => f.list)).toBeLessThanOrEqual(0);
    expect(sound.most((f) => Math.abs(f.list))).toBe(0);
  });
});
