import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, FACES, GEAR_IDS, HATS, SHIRTS } from '@sar/shared';
import type { GearId, LadderDef, Look } from '@sar/shared';
import { animateAvatar, gripPoints, makeAvatar } from './avatar.ts';
import type { Avatar, Gait } from './avatar.ts';
import { BroomView } from './broom.ts';
import { wearGear } from './gear.ts';

/*
 * Nothing on a player pokes through anything else on them, standing or in any pose: not an arm
 * through the body, a hand through the belt, a boot through the other boot, a raised arm
 * through a hat, nor the body through what it carries.
 *
 * Every closed shape on the avatar (capsule, sphere, box, cylinder, cone) is a solid. Each body
 * part (the torso, the head, each arm, each leg, with whatever is worn on them) is checked
 * against every other: no point on the surface of one may lie inside a solid of the other,
 * except near the joint they share (a shoulder, a hip, the neck), where they are meant to meet.
 */

/** How deep (m) one part may sink into another: the two only touching. */
const TOUCH = 0.004;

/** Names the shapes that meet in each clip, to track it down. */
const DEBUG = !!process.env.CLIP_DEBUG;

/** The glove, which closes round a handle: the hand, its thumb and its cuff at the wrist. */
const GRIP = /^(hand|thumb|cuff)$/;

interface Solid {
  /** Signed distance from a point in world space (negative inside). */
  sdf: (p: THREE.Vector3) => number;
  /** A ball round it: points outside are outside the shape. */
  ball: THREE.Sphere;
  mesh: THREE.Mesh;
}

const _p = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/** Signed distance (negative inside) from a point in a shape's own space to the shape. */
function localSdf(g: THREE.BufferGeometry, p: THREE.Vector3): number | null {
  if (g instanceof THREE.CapsuleGeometry) {
    const { radius, height } = g.parameters as unknown as { radius: number; height: number };
    const y = Math.max(-height / 2, Math.min(height / 2, p.y));
    return Math.hypot(p.x, p.y - y, p.z) - radius;
  }
  if (g instanceof THREE.SphereGeometry) {
    const { radius, phiLength, thetaLength } = g.parameters;
    // Only whole balls are solid; a slice of one is a shell.
    if (phiLength < Math.PI * 2 - 1e-6 || thetaLength < Math.PI - 1e-6) return null;
    return p.length() - radius;
  }
  if (g instanceof THREE.BoxGeometry) {
    const { width, height, depth } = g.parameters;
    const qx = Math.abs(p.x) - width / 2;
    const qy = Math.abs(p.y) - height / 2;
    const qz = Math.abs(p.z) - depth / 2;
    const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    return out + Math.min(Math.max(qx, qy, qz), 0);
  }
  if (g instanceof THREE.CylinderGeometry) {
    const { radiusTop, radiusBottom, height, openEnded, thetaLength } = g.parameters;
    if (openEnded || thetaLength < Math.PI * 2 - 1e-6) return null;
    const t = Math.max(0, Math.min(1, p.y / height + 0.5));
    const r = radiusBottom + (radiusTop - radiusBottom) * t;
    const radial = Math.hypot(p.x, p.z) - r;
    const axial = Math.abs(p.y) - height / 2;
    const out = Math.hypot(Math.max(radial, 0), Math.max(axial, 0));
    return out + Math.min(Math.max(radial, axial), 0);
  }
  return null;
}

/**
 * A mesh as a solid in world space, or null if it is not closed. Scaled shapes are measured in
 * their own space and the distance scaled back by the smallest scale, which never overstates
 * how deep a point is.
 */
function solidOf(m: THREE.Mesh): Solid | null {
  if (localSdf(m.geometry, new THREE.Vector3()) === null) return null;
  const inv = _inv.clone().copy(m.matrixWorld).invert();
  const s = new THREE.Vector3().setFromMatrixScale(m.matrixWorld);
  const k = Math.min(s.x, s.y, s.z);
  if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
  const ball = m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
  return { sdf: (p) => localSdf(m.geometry, _p.copy(p).applyMatrix4(inv))! * k, ball, mesh: m };
}

/** Points on a mesh's surface in its own space: its corners and the middle of each face. */
const local = new WeakMap<THREE.BufferGeometry, THREE.Vector3[]>();
function localSurface(g: THREE.BufferGeometry): THREE.Vector3[] {
  let pts = local.get(g);
  if (pts) return pts;
  const pos = g.attributes.position!;
  pts = [];
  const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  for (let i = 0; i < pos.count; i++) pts.push(v(i));
  const index = g.index;
  const tri = index ? index.count / 3 : pos.count / 3;
  for (let t = 0; t < tri; t++) {
    const [a, b, c] = [0, 1, 2].map((j) => v(index ? index.getX(t * 3 + j) : t * 3 + j));
    pts.push(a!.clone().add(b!).add(c!).divideScalar(3));
  }
  local.set(g, pts);
  return pts;
}

/** The same points in world space. */
const surface = (m: THREE.Mesh): THREE.Vector3[] =>
  localSurface(m.geometry).map((p) => p.clone().applyMatrix4(m.matrixWorld));

interface Part {
  name: string;
  meshes: THREE.Mesh[];
}

const meshesOf = (o: THREE.Object3D, skip: THREE.Object3D[] = []): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  const walk = (x: THREE.Object3D) => {
    if (skip.includes(x) || !x.visible) return;
    if (x instanceof THREE.Mesh) out.push(x);
    for (const c of x.children) walk(c);
  };
  walk(o);
  return out;
};

/** The avatar's parts, and where each pair is joined (with how far round the joint is free). */
function partsOf(a: Avatar, held: THREE.Object3D[]): { parts: Part[]; joints: Joint[] } {
  const parts: Part[] = [
    { name: 'torso', meshes: meshesOf(a.torso) },
    { name: 'head', meshes: meshesOf(a.head) },
    { name: 'left arm', meshes: meshesOf(a.arms[0]) },
    { name: 'right arm', meshes: meshesOf(a.arms[1]) },
    { name: 'left leg', meshes: meshesOf(a.legs[0]) },
    { name: 'right leg', meshes: meshesOf(a.legs[1]) },
  ];
  for (const [i, h] of held.entries()) parts.push({ name: `held ${i}`, meshes: meshesOf(h) });
  const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const neck = at(a.head).add(
    new THREE.Vector3(0, -0.2, 0).applyQuaternion(
      a.head.getWorldQuaternion(new THREE.Quaternion()),
    ),
  );
  const joints: Joint[] = [
    { a: 'torso', b: 'head', at: neck, r: 0.13 },
    { a: 'torso', b: 'left arm', at: at(a.arms[0]), r: 0.13 },
    { a: 'torso', b: 'right arm', at: at(a.arms[1]), r: 0.13 },
    { a: 'torso', b: 'left leg', at: at(a.legs[0]), r: 0.17 },
    { a: 'torso', b: 'right leg', at: at(a.legs[1]), r: 0.17 },
    // The tops of the legs meet at the crotch, under the torso.
    { a: 'left leg', b: 'right leg', at: at(a.legs[0]).lerp(at(a.legs[1]), 0.5), r: 0.1 },
  ];
  return { parts, joints };
}

interface Joint {
  a: string;
  b: string;
  at: THREE.Vector3;
  r: number;
}

/**
 * Every part that pokes into another, and how deep (m) it goes at most, by "a into b". Held
 * things `gripped` round (a broom's handle) may go through the hands closed on them.
 */
function clips(a: Avatar, held: THREE.Object3D[] = [], gripped = false): Map<string, number> {
  a.group.updateMatrixWorld(true);
  for (const h of held) h.updateMatrixWorld(true);
  const { parts, joints } = partsOf(a, held);
  const solids = new Map(
    parts.map((p) => [p.name, p.meshes.map(solidOf).filter((s): s is Solid => s !== null)]),
  );
  // A ball round each part's solids: points outside it are clear of the whole part.
  const balls = new Map(
    [...solids].map(([name, ss]) => {
      const b = new THREE.Box3();
      for (const { ball } of ss) b.union(ball.getBoundingBox(new THREE.Box3()));
      return [name, b.getBoundingSphere(new THREE.Sphere())];
    }),
  );
  const hands = [...solids.values()].flat().filter((s) => GRIP.test(s.mesh.name));
  const label = (m: THREE.Mesh) => m.name || m.geometry.type.replace('Geometry', '');
  const found = new Map<string, number>();
  for (const pa of parts) {
    const pts = pa.meshes.map((m) => ({ m, pts: surface(m) }));
    for (const pb of parts) {
      if (pa === pb) continue;
      const joint = joints.find(
        (j) => (j.a === pa.name && j.b === pb.name) || (j.b === pa.name && j.a === pb.name),
      );
      const near = balls.get(pb.name)!;
      if (near.isEmpty()) continue;
      let worst = 0;
      let what = '';
      for (const { m, pts: ps } of pts) {
        const gripping =
          gripped &&
          (pa.name.startsWith('held') || pb.name.startsWith('held')) &&
          /arm/.test(pa.name + pb.name);
        if (gripping && GRIP.test(m.name)) continue;
        for (const p of ps) {
          if (!near.containsPoint(p)) continue;
          if (joint && p.distanceTo(joint.at) < joint.r) continue;
          // Inside a hand closed round a handle, nothing shows.
          if (gripping && hands.some(({ sdf, ball }) => ball.containsPoint(p) && sdf(p) < 0))
            continue;
          for (const { sdf, ball, mesh } of solids.get(pb.name)!) {
            if (!ball.containsPoint(p)) continue;
            if (gripping && GRIP.test(mesh.name)) continue;
            const d = sdf(p);
            if (d < worst) {
              worst = d;
              what = DEBUG ? ` (${label(m)} into ${label(mesh)})` : '';
            }
          }
        }
      }
      if (worst < -TOUCH) found.set(`${pa.name} into ${pb.name}${what}`, -worst);
    }
  }
  return found;
}

// ------------------------------------------------------------------ the poses

const dt = 1 / 60;
const still: Gait = { limping: false, carrying: false, careful: false };

/** Runs `frames` frames moving at `v` (m/s, in the avatar's own frame), checking every `every`th. */
function run(
  a: Avatar,
  frames: number,
  v: THREE.Vector3,
  gait: (i: number) => Gait,
  check: () => void,
  every = 3,
): void {
  for (let i = 0; i < frames; i++) {
    a.group.position.addScaledVector(v, dt);
    animateAvatar(a, gait(i), dt);
    if (i % every === 0) check();
  }
}

const STUD = 0.1;
const PLATE = 0.04;

/** A box standing in for a held brick or build, `w` across, `d` deep, `h` high. */
const block = (w: number, h: number, d: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  const g = new THREE.Group();
  g.add(m);
  return g;
};

interface Pose {
  name: string;
  /**
   * Poses the avatar, calling `check` at every frame worth checking, with what it holds and
   * whether the hands close round it.
   */
  play(a: Avatar, check: (held?: THREE.Object3D[], gripped?: boolean) => void): void;
}

const ladder: LadderDef = { pos: { x: 0, y: 0, z: -0.42 }, width: 0.8, height: 4, facing: 0 };

const walking = (name: string, v: THREE.Vector3, gait: Partial<Gait> = {}): Pose => ({
  name,
  play: (a, check) =>
    run(
      a,
      150,
      v,
      () => ({ ...still, ...gait }),
      () => check(),
      2,
    ),
});

/** Holding a loose brick `studsX` by `studsZ` (`plates` high) the way the sim holds one. */
const brick = (studsX: number, studsZ: number, plates = 3): Pose => ({
  name: `holding a ${studsX}x${studsZ} brick`,
  play(a, check) {
    const d = studsZ * STUD;
    const b = block(studsX * STUD, plates * PLATE, d);
    b.position.set(0, 0.15, -(0.27 + d / 2));
    a.group.add(b);
    for (let i = 0; i < 40; i++) {
      animateAvatar(a, { ...still, carrying: true, grip: gripPoints(a, b, false) }, dt);
    }
    check([b]);
    // And walking with it.
    run(
      a,
      90,
      new THREE.Vector3(0, 0, -3),
      () => ({ ...still, carrying: true, grip: gripPoints(a, b, false) }),
      () => check([b]),
      5,
    );
    b.removeFromParent();
  },
});

/** Carrying a build like a tray, its near side `0.36` m out, as the sim holds one. */
const build = (w: number, h: number, d: number): Pose => ({
  name: `carrying a ${w}x${h}x${d} build`,
  play(a, check) {
    const b = block(w, h, d);
    b.position.set(0, 0, -(0.36 + d / 2));
    a.group.add(b);
    for (let i = 0; i < 40; i++) {
      animateAvatar(a, { ...still, carrying: true, grip: gripPoints(a, b, true) }, dt);
    }
    check([b]);
    b.removeFromParent();
  },
});

const POSES: Pose[] = [
  { name: 'standing', play: (a, check) => (animateAvatar(a, still, dt), check()) },
  walking('walking', new THREE.Vector3(0, 0, -3.5)),
  walking('running', new THREE.Vector3(0, 0, -7)),
  walking('walking backwards', new THREE.Vector3(0, 0, 3)),
  walking('side-stepping right', new THREE.Vector3(3.5, 0, 0)),
  walking('side-stepping left', new THREE.Vector3(-3.5, 0, 0)),
  walking('going diagonally', new THREE.Vector3(2.5, 0, -2.5)),
  walking('limping', new THREE.Vector3(0, 0, -1.6), { limping: true }),
  walking('walking carefully', new THREE.Vector3(0, 0, -1.5), { careful: true }),
  {
    name: 'holding a dog treat',
    play(a, check) {
      a.treat.visible = true;
      run(a, 120, new THREE.Vector3(0, 0, -3), () => ({ ...still, carrying: true }), check);
      a.treat.visible = false;
    },
  },
  brick(1, 1),
  brick(2, 1),
  brick(2, 2),
  brick(4, 2),
  brick(8, 1),
  brick(2, 2, 1),
  brick(6, 6, 1),
  build(0.6, 0.3, 0.4),
  build(1.6, 0.04, 1.6),
  build(0.3, 0.8, 0.3),
  {
    name: 'sweeping with the broom',
    play(a, check) {
      const broom = new BroomView();
      for (let i = 0; i < 40; i++) {
        const grip = broom.carry(a.group, 1, false);
        animateAvatar(a, { ...still, carrying: true, grip }, dt);
      }
      check([broom.group], true);
    },
  },
  {
    name: 'jumping and landing',
    play(a, check) {
      let y = 0;
      let vy = 5;
      for (let i = 0; i < 70; i++) {
        vy -= 15 * dt;
        y = Math.max(0, y + vy * dt);
        if (y === 0) vy = 0;
        a.group.position.y = y;
        a.group.position.z -= 4 * dt;
        animateAvatar(a, { ...still, airborne: y > 0 }, dt);
        if (i % 2 === 0) check();
      }
    },
  },
  {
    name: 'patting the dog',
    play(a, check) {
      for (const side of [-1, 1]) {
        // The top of a dog's head, in front and a little to one side, as `DogView.headTop` has it.
        const pat = new THREE.Vector3(side * 0.25, -0.38, -0.55);
        for (let i = 0; i < 80; i++) {
          animateAvatar(a, { ...still, pat }, dt);
          if (i > 30 && i % 4 === 0) check();
        }
        for (let i = 0; i < 40; i++) animateAvatar(a, still, dt);
      }
    },
  },
  {
    name: 'climbing a ladder',
    play(a, check) {
      let y = 0;
      for (let i = 0; i < 120; i++) {
        a.group.position.set(0, y, 0);
        a.group.rotation.y = 0;
        animateAvatar(a, { ...still, climb: ladder }, dt);
        y += 2.4 * dt;
        if (i > 20 && i % 4 === 0) check();
      }
    },
  },
  {
    name: 'climbing with something in hand',
    play(a, check) {
      for (let i = 0; i < 60; i++) {
        a.group.position.set(0, i * 0.03, 0);
        a.group.rotation.y = 0;
        animateAvatar(a, { ...still, carrying: true, climb: ladder }, dt);
        if (i > 20 && i % 3 === 0) check();
      }
    },
  },
];

/** Every clip in every pose, for an avatar dressed as `look` with `gear` on. */
function survey(look: Look, gear: GearId[] = [], poses = POSES): string[] {
  const out = new Map<string, number>();
  for (const pose of poses) {
    const a = makeAvatar(0x2e86de, null, look);
    for (const g of gear) wearGear(a, g);
    for (let i = 0; i < 30; i++) animateAvatar(a, still, dt);
    pose.play(a, (held = [], gripped = false) => {
      for (const [c, d] of clips(a, held, gripped)) {
        const key = `${pose.name}: ${c}`;
        out.set(key, Math.max(d, out.get(key) ?? 0));
      }
    });
  }
  return [...out].map(([c, d]) => `${c} by ${(d * 100).toFixed(1)} cm`);
}

/** The poses that bring the arms up by the head, or the head down by the body. */
const NEAR_HEAD = /standing|jumping|climbing a|patting|limping/;

describe('nothing on a player pokes through anything else', { timeout: 120_000 }, () => {
  it.each(SHIRTS.map((s) => s.id))('in every pose, wearing the %s shirt', (shirt) => {
    expect(survey({ ...DEFAULT_LOOK, shirt }).join('\n')).toBe('');
  });

  it.each(HATS.map((h) => h.id))('with the %s hat on', (hat) => {
    const poses = POSES.filter((p) => NEAR_HEAD.test(p.name));
    expect(survey({ hat, face: 'glasses', shirt: 'scarf' }, [], poses).join('\n')).toBe('');
  });

  it('with every face over every shirt', () => {
    // Only the head and what is worn at the neck meet here.
    const poses = POSES.filter((p) => /standing|patting|limping/.test(p.name));
    const found = FACES.flatMap(({ id: face }) =>
      SHIRTS.flatMap(({ id: shirt }) =>
        survey({ ...DEFAULT_LOOK, face, shirt }, [], poses).map((c) => `${face}/${shirt}: ${c}`),
      ),
    );
    expect(found.join('\n')).toBe('');
  });

  it.each(GEAR_IDS)('wearing the %s', (gear) => {
    // Over the hi-vis vest, the shirt that stands out furthest from the body.
    const found = survey({ ...DEFAULT_LOOK, shirt: 'hivis', face: 'beard' }, [gear]);
    expect(found.join('\n')).toBe('');
  });

  it('wearing every piece of gear at once', () => {
    const found = survey({ ...DEFAULT_LOOK, shirt: 'stripes', face: 'glasses' }, [...GEAR_IDS]);
    expect(found.join('\n')).toBe('');
  });
});
