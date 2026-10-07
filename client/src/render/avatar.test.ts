import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, FACES, HATS, SHIRTS } from '@sar/shared';
import { Ragdoll, makeAvatar } from './avatar.ts';
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
