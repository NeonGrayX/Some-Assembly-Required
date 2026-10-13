import * as THREE from 'three';
import { COLOURS, VACUUM, vacuumRestPose } from '@sar/shared';
import type { ColourId, VacuumState } from '@sar/shared';
import type { Grip } from './avatar.ts';

/**
 * How long the motor keeps running after the last pull it heard of: held, pulls come every
 * 0.4 s, so it runs on between them and winds down only once the click is let go.
 */
const RUN_ON_SECONDS = 0.6;
/** How quickly the motor winds up and runs down (time constants, s). */
const SPIN_UP = 0.15;
const SPIN_DOWN = 0.6;
/** One push and pull of the head along the floor while it runs, s. */
const STROKE_SECONDS = 0.9;
/**
 * Carried in the right hand: about where that hand is, which the handle leans toward, and
 * where the head rests when the sim says nothing of where it goes, in the avatar's own space
 * (forward is -z, the feet at -0.85).
 */
const HAND = new THREE.Vector3(0.3, 0, -0.38);
const HEAD = new THREE.Vector3(0.15, -0.85, -0.8);
/** How far up the handle from the head the hand holds it: by the grip on top. */
const HOLD = VACUUM.length - 0.075;
/** The see-through dust bin: its radius, height, and how far up the vacuum its bottom is. */
const BIN_RADIUS = 0.068;
const BIN_HEIGHT = 0.25;
const BIN_AT = 0.3;
/** Where the floor head's brush roll turns, its axis along x. */
const BRUSH_AT = new THREE.Vector3(0, 0.032, -0.072);
/** The colours of what it sucks up, shown tumbling in the dust bin. */
const LITTER: ColourId[] = ['red', 'yellow', 'blue', 'white', 'green', 'black', 'orange'];

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _away = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _flat = new THREE.Quaternion();
const _flatM = new THREE.Matrix4();
const _back = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * An upright vacuum: a floor head with a brush roll turning behind a clear hood and two
 * headlights, on a ball joint; above it the motor between two vents, a see-through cyclone bin
 * that shows the bricks it has sucked up tumbling round, a steel wand with the cord wound on
 * the back, and a D-shaped grip on top. Its origin is the middle of the head's underside, the
 * handle runs up +y, and the nozzle faces -z.
 *
 * Running (held click), the brush spins, the lights come on, the bricks swirl and whoever
 * carries it sweeps the head to and fro.
 */
export class VacuumView {
  readonly group = new THREE.Group();
  /** How fast the motor turns, 0 (off) to 1; the sounds follow it too. */
  speed = 0;
  /** Whether the dust bin is full. */
  full = false;
  /** Who carries it, and until when (performance.now() / 1000) it keeps running. */
  private heldBy: number | null = null;
  private runUntil = 0;
  /** Where the to-and-fro of the head is, radians, and how far the brush and bricks turned. */
  private stroke = 0;
  private turn = 0;
  private last = performance.now() / 1000;
  /** Everything above the head, hidden in first person where it would stand up into the view. */
  private readonly upper = new THREE.Group();
  /** The floor head, which stays flat on the floor however the handle leans. */
  private readonly head = new THREE.Group();
  private readonly brush = new THREE.Group();
  /** The bricks in the dust bin, one shown per brick inside. */
  private readonly litter = new THREE.Group();
  private readonly lamps: THREE.MeshStandardMaterial;
  private readonly led: THREE.MeshStandardMaterial;

  constructor() {
    const shell = new THREE.MeshStandardMaterial({ color: 0xe0482f, roughness: 0.35 });
    const body = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.55 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.9 });
    const satin = new THREE.MeshStandardMaterial({
      color: 0x8c939c,
      roughness: 0.4,
      metalness: 0.3,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0xc9cfd6,
      roughness: 0.3,
      metalness: 0.25,
    });
    const bristle = new THREE.MeshStandardMaterial({ color: 0xf2b134, roughness: 0.8 });
    const cord = new THREE.MeshStandardMaterial({ color: 0x6e7480, roughness: 0.7 });
    const clear = new THREE.MeshStandardMaterial({
      color: 0xd2e6f0,
      roughness: 0.08,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lamps = new THREE.MeshStandardMaterial({
      color: 0xfff4d6,
      emissive: 0xfff0c2,
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    this.led = new THREE.MeshStandardMaterial({
      color: 0x1d2a22,
      emissive: 0x3ddc84,
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      return m;
    };
    /** A cylinder lying along x. */
    const alongX = (
      r: number,
      len: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const m = mesh(new THREE.CylinderGeometry(r, r, len, 20), mat, x, y, z);
      m.rotation.z = Math.PI / 2;
      return m;
    };
    const w = VACUUM.width;

    // ---- the floor head
    const head = this.head;
    // A wedge behind the brush, low at the front and rising to the ball joint, rounded off.
    const profile = new THREE.Shape();
    const pts: [number, number][] = [
      [-0.04, 0.012],
      [0.06, 0.012],
      [0.075, 0.03],
      [0.075, 0.062],
      [0.05, 0.082],
      [-0.02, 0.082],
      [-0.04, 0.066],
    ];
    // Drawn with x = -z, so that turned a quarter about y it lies the right way round.
    profile.moveTo(-pts[0]![0], pts[0]![1]);
    for (const [z, y] of pts.slice(1)) profile.lineTo(-z, y);
    profile.closePath();
    const wedgeWidth = w - 0.06;
    const wedgeGeo = new THREE.ExtrudeGeometry(profile, {
      depth: wedgeWidth,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.008,
      bevelSegments: 3,
      curveSegments: 4,
    });
    wedgeGeo.rotateY(Math.PI / 2);
    wedgeGeo.translate(-wedgeWidth / 2, 0, 0);
    const wedge = mesh(wedgeGeo, shell);
    // The brush roll: a core with four spiral rows of bristles.
    this.brush.position.copy(BRUSH_AT);
    const core = alongX(0.016, w - 0.07, body, 0, 0, 0);
    this.brush.add(core);
    const tuft = new THREE.BoxGeometry(0.012, 0.011, 0.009);
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 11; i++) {
        const x = -0.13 + i * 0.026;
        const a = (row * Math.PI) / 2 + i * 0.32;
        const t = mesh(tuft, bristle, x, Math.sin(a) * 0.02, Math.cos(a) * 0.02);
        t.rotation.x = -a;
        this.brush.add(t);
      }
    // The clear hood over it, and the end plates holding it.
    const hood = mesh(
      new THREE.CylinderGeometry(
        0.048,
        0.048,
        w - 0.05,
        24,
        1,
        true,
        Math.PI * 0.95,
        Math.PI * 1.1,
      ),
      clear,
      BRUSH_AT.x,
      BRUSH_AT.y,
      BRUSH_AT.z,
    );
    hood.rotation.z = Math.PI / 2;
    hood.renderOrder = 1;
    const ends = [-1, 1].map((s) =>
      alongX(0.05, 0.014, shell, s * (w / 2 - 0.018), BRUSH_AT.y, BRUSH_AT.z),
    );
    // The rubber lip along the front, and the headlights on the end plates.
    const lip = mesh(new THREE.BoxGeometry(w - 0.05, 0.012, 0.01), rubber, 0, 0.008, -0.113);
    const lights = [-1, 1].map((s) => {
      const l = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), this.lamps);
      l.rotation.x = Math.PI / 2;
      l.position.set(s * (w / 2 - 0.018), 0.05, -0.118);
      return l;
    });
    // Big wheels at the back, with grey hubs.
    const wheels = [-1, 1].flatMap((s) => [
      alongX(0.045, 0.026, rubber, s * (w / 2 + 0.01), 0.045, 0.035),
      alongX(0.025, 0.03, satin, s * (w / 2 + 0.01), 0.045, 0.035),
    ]);
    // The ball joint the rest of it turns on.
    const ball = mesh(new THREE.SphereGeometry(0.046, 20, 14), body, 0, 0.09, 0.025);
    const ring = mesh(new THREE.TorusGeometry(0.044, 0.007, 8, 24), shell, 0, 0.09, 0.025);
    ring.rotation.y = Math.PI / 2;
    head.add(wedge, this.brush, hood, ...ends, lip, ...lights, ...wheels, ball, ring);

    // ---- the motor, between two vents
    const motor = alongX(0.066, 0.17, body, 0, 0.165, 0.035);
    const caps = [-1, 1].flatMap((s) => {
      const vent = mesh(
        new THREE.TorusGeometry(0.052, 0.008, 8, 24),
        shell,
        s * 0.086,
        0.165,
        0.035,
      );
      vent.rotation.y = Math.PI / 2;
      return [vent];
    });
    const hub = alongX(0.046, 0.178, satin, 0, 0.165, 0.035);

    // ---- the spine up the back, the dust bin in front of it
    const spine = mesh(new THREE.BoxGeometry(0.05, 0.52, 0.034), body, 0, 0.48, 0.07);
    const bin = mesh(
      new THREE.CylinderGeometry(BIN_RADIUS, BIN_RADIUS, BIN_HEIGHT, 28, 1, true),
      clear,
      0,
      BIN_AT + BIN_HEIGHT / 2,
      -0.004,
    );
    bin.renderOrder = 1;
    const binBase = mesh(
      new THREE.CylinderGeometry(0.073, 0.07, 0.03, 28),
      shell,
      0,
      BIN_AT,
      -0.004,
    );
    const release = mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.02, 12),
      body,
      0,
      BIN_AT,
      -0.081,
    );
    release.rotation.x = Math.PI / 2;
    const binTop = mesh(
      new THREE.CylinderGeometry(0.07, 0.073, 0.034, 28),
      body,
      0,
      BIN_AT + BIN_HEIGHT,
      -0.004,
    );
    const shroud = mesh(
      new THREE.CylinderGeometry(0.02, 0.026, BIN_HEIGHT - 0.03, 16),
      satin,
      0,
      BIN_AT + BIN_HEIGHT / 2,
      -0.004,
    );
    // A crown of little cyclones on the lid, under a red cap.
    const cyclones = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return mesh(
        new THREE.CylinderGeometry(0.008, 0.013, 0.036, 12),
        satin,
        Math.sin(a) * 0.048,
        BIN_AT + BIN_HEIGHT + 0.033,
        -0.004 + Math.cos(a) * 0.048,
      );
    });
    const crown = mesh(
      new THREE.CylinderGeometry(0.03, 0.058, 0.026, 28),
      shell,
      0,
      BIN_AT + BIN_HEIGHT + 0.06,
      -0.004,
    );
    const status = mesh(
      new THREE.SphereGeometry(0.0075, 12, 8),
      this.led,
      0,
      BIN_AT + BIN_HEIGHT,
      -0.074,
    );
    this.litter.position.set(0, BIN_AT + 0.016, -0.004);
    for (let i = 0; i < 12; i++) {
      const colour = COLOURS[LITTER[(i * 5) % LITTER.length]!].hex;
      const b = mesh(
        new THREE.BoxGeometry(0.031, 0.021, 0.044),
        new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35 }),
      );
      b.visible = false;
      this.litter.add(b);
    }

    // ---- the wand, the cord wound on the back, and the grip
    const wandFrom = BIN_AT + BIN_HEIGHT + 0.07;
    const wandTo = VACUUM.length - 0.09;
    const wand = mesh(
      new THREE.CylinderGeometry(0.015, 0.015, wandTo - wandFrom, 14),
      steel,
      0,
      (wandFrom + wandTo) / 2,
      0,
    );
    const collar = mesh(
      new THREE.CylinderGeometry(0.022, 0.026, 0.04, 16),
      body,
      0,
      wandFrom + 0.01,
      0,
    );
    const hooks = [0.4, 0.69].map((y) =>
      mesh(new THREE.BoxGeometry(0.06, 0.016, 0.03), body, 0, y, 0.098),
    );
    const loops = [0, 1, 2].map((i) => {
      const x = 0.022 + i * 0.006;
      const z = 0.096 + i * 0.002;
      const curve = new THREE.CatmullRomCurve3(
        [
          [x, 0.4],
          [x * 0.7, 0.385],
          [-x * 0.7, 0.385],
          [-x, 0.4],
          [-x, 0.69],
          [-x * 0.7, 0.705],
          [x * 0.7, 0.705],
          [x, 0.69],
        ].map(([cx, cy]) => new THREE.Vector3(cx, cy, z)),
        true,
        'catmullrom',
        0.2,
      );
      return mesh(new THREE.TubeGeometry(curve, 48, 0.0055, 6, true), cord);
    });
    const gripY = VACUUM.length - 0.075;
    const loop = mesh(new THREE.TorusGeometry(0.052, 0.013, 10, 24, Math.PI), rubber, 0, gripY, 0);
    const bar = alongX(0.013, 0.104, body, 0, gripY, 0);
    const trigger = mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.024, 10),
      shell,
      0,
      gripY - 0.012,
      -0.016,
    );
    trigger.rotation.x = Math.PI / 2;

    this.upper.add(
      motor,
      ...caps,
      hub,
      spine,
      bin,
      binBase,
      release,
      binTop,
      shroud,
      ...cyclones,
      crown,
      status,
      this.litter,
      wand,
      collar,
      ...hooks,
      ...loops,
      loop,
      bar,
      trigger,
    );
    this.group.add(head, this.upper);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material !== clear) o.castShadow = true;
    });
  }

  /** Someone just pulled with it: the motor runs (on) for a moment. */
  sucked(playerId: number): void {
    this.runUntil = performance.now() / 1000 + RUN_ON_SECONDS;
    this.heldBy ??= playerId;
  }

  /** Shows `load` bricks in the dust bin, out of `capacity`. */
  setLoad(load: number, capacity: number): void {
    this.full = load >= capacity;
    const shown = Math.round((Math.min(load, capacity) / capacity) * this.litter.children.length);
    this.litter.children.forEach((b, i) => (b.visible = i < shown));
  }

  /**
   * Who carries it (null: nobody); call every frame. Winds the motor up or down and turns the
   * brush, the bricks in the bin and the lights to match.
   */
  update(heldBy: number | null): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    if (heldBy !== this.heldBy) this.runUntil = 0;
    this.heldBy = heldBy;
    const on = heldBy !== null && now < this.runUntil;
    const tau = on ? SPIN_UP : SPIN_DOWN;
    this.speed += ((on ? 1 : 0) - this.speed) * (1 - Math.exp(-dt / tau));
    if (this.speed < 0.002) this.speed = 0;
    this.stroke += (dt * this.speed * Math.PI * 2) / STROKE_SECONDS;
    this.turn += dt * this.speed;
    this.brush.rotation.x = -this.turn * 60;
    this.lamps.emissiveIntensity = Math.min(1, this.speed * 3) * 1.8;
    // Green while it runs; blinking red once full.
    this.led.emissive.setHex(this.full ? 0xff3b30 : 0x3ddc84);
    this.led.emissiveIntensity = this.full
      ? heldBy !== null && Math.floor(now * 3) % 2 === 0
        ? 2
        : 0.2
      : this.speed * 2;
    // The bricks inside tumble round the cyclone while it runs.
    this.litter.rotation.y = this.turn * 9;
    this.litter.children.forEach((b, i) => {
      const a = i * 2.4;
      const layer = Math.floor(i / 4);
      const lift = this.speed * (0.03 + 0.05 * ((Math.sin(now * 7 + i * 1.7) + 1) / 2));
      b.position.set(
        Math.sin(a) * 0.043,
        0.012 + layer * 0.023 + (i % 3) * 0.003 + lift,
        Math.cos(a) * 0.043,
      );
      b.rotation.set(0.3 * (i % 2) + this.speed * now * (2 + (i % 3)), a + 0.4, 0.2 * (i % 3));
    });
  }

  /** Puts the vacuum where it leans or lies while nobody carries it. */
  rest(b: VacuumState): void {
    this.upper.visible = true;
    this.head.quaternion.identity();
    const { pos, rot } = vacuumRestPose(b);
    // The rest pose is of the vacuum's middle; this group's origin is the head's underside.
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const down = new THREE.Vector3(0, -VACUUM.length / 2, 0).applyQuaternion(q);
    this.group.position.set(pos.x + down.x, pos.y + down.y, pos.z + down.z);
    this.group.quaternion.copy(q);
  }

  /**
   * Puts the vacuum in the right hand of the avatar drawn by `avatar` (already placed and
   * turned), its head resting on the floor at `head` (world space; where the player's crosshair
   * meets the floor), swept to and fro a little while it runs, and returns where the hands go:
   * the left hangs free. Seen through the carrier's own eyes only its head shows.
   */
  carry(avatar: THREE.Object3D, head: THREE.Vector3 | null, firstPerson: boolean): Grip {
    this.upper.visible = !firstPerson;
    avatar.updateMatrixWorld(true);
    if (head) avatar.worldToLocal(_head.copy(head));
    else _head.copy(HEAD);
    // Pointing away from the player, the way the nozzle faces.
    _away.set(_head.x - HAND.x, 0, _head.z - HAND.z);
    if (_away.lengthSq() < 1e-6) _away.set(0, 0, -1);
    _away.normalize();
    // Pushed out along the floor and drawn back while it runs.
    const push = ((1 - Math.cos(this.stroke)) / 2) * this.speed;
    _head.addScaledVector(_away, push * 0.12);
    _dir.copy(HAND).sub(_head);
    _dir.normalize();
    // Up the handle is +y; the nozzle (-z) faces away, square to the handle.
    _z.copy(_away).addScaledVector(_dir, -_away.dot(_dir)).normalize().negate();
    _m.makeBasis(_x.crossVectors(_dir, _z), _dir, _z);
    _q.setFromRotationMatrix(_m);
    // The head turns on its ball joint to lie flat, its nozzle facing away.
    _back.copy(_away).negate();
    _flat.setFromRotationMatrix(_flatM.makeBasis(_x.crossVectors(UP, _back), UP, _back));
    this.head.quaternion.copy(_q).invert().multiply(_flat);
    _m.setPosition(_head).premultiply(avatar.matrixWorld);
    _m.decompose(this.group.position, this.group.quaternion, this.group.scale);
    return [null, _head.clone().addScaledVector(_dir, HOLD)];
  }
}
