import * as THREE from 'three';
import { COLOURS, TRASH_BIN_SIZE } from '@sar/shared';
import type { BoxDef, ColourId } from '@sar/shared';
import { BIN_FRONT, streetBin } from '../carscene/street.ts';
import type { StreetBin } from '../carscene/street.ts';
import { random } from '../clock.ts';

/**
 * Chevron Street's bins: the car scene's street bin (see `streetBin`), its face tipping out to
 * take what is thrown in or emptied out of the vacuum, and swinging back up to tip it in.
 */

/** The yaw that turns a model's front (its -z) to face each side of its box (as `FACING`). */
const TURN = { '-z': 0, '+z': Math.PI, '-x': Math.PI / 2, '+x': -Math.PI / 2 } as const;

/** How long the face takes to tip out or swing shut, and what goes in takes to fall, s. */
const SWING = 0.35;
const FALL = 0.45;
/** How long a brick takes to slide off the lid's front edge, s. */
const SLIDE = 0.18;
/** How long it stays open once all is in, s. */
const HOLD = 0.4;
/** The colours of what the vacuum sucked up, tipped out of it. */
const LITTER: ColourId[] = ['red', 'yellow', 'blue', 'white', 'green', 'black', 'orange'];

/**
 * A street bin drawn into a prop's frame `g` (see `makeProp`): centred on its box, which is
 * `TRASH_BIN_SIZE.streetBin`, standing on its floor, its front toward -z.
 */
export function streetBinModel(g: THREE.Object3D, colour: number): StreetBin {
  const turn = new THREE.Group();
  // Its own front is its +x.
  turn.rotation.y = Math.PI / 2;
  const bin = streetBin(turn, colour);
  turn.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(turn);
  const middle = bounds.getCenter(new THREE.Vector3());
  turn.position.set(-middle.x, -TRASH_BIN_SIZE.streetBin.y / 2 - bounds.min.y, -middle.z);
  g.add(turn);
  return bin;
}

/**
 * Something on its way in, in the bin's axes: where it starts, the edge it slides to before it
 * drops, what it drops by on the way, and when it sets off (s).
 */
interface Piece {
  mesh: THREE.Object3D;
  from: THREE.Vector3;
  edge: THREE.Vector3;
  over: THREE.Vector3;
  /** Where it ends up in the scoop, in the scoop's axes (the bin's with the face shut). */
  rest: THREE.Vector3;
  /** How it tumbles as it drops, most halfway down. */
  spin: THREE.Euler;
  delay: number;
  t: number;
}

/** A puff of dust out of the vacuum, rising and fading. */
interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  t: number;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/** One of the map's street bins, which tips its face out when something is put in it. */
export class TippingBin {
  readonly group = new THREE.Group();
  /** The middle of its top in the level: where the simulation says what went in, went. */
  readonly top: THREE.Vector3;
  private readonly bin: StreetBin;
  /** The model's own frame (its front +x), in which the pieces' ways in are laid out. */
  private readonly frame: THREE.Object3D;
  /** How far open the face is (0 to 1), and for how much longer it stays open, s. */
  private k = 0;
  private openFor = 0;
  private pieces: Piece[] = [];
  private puffs: Puff[] = [];
  private readonly materials = new Map<number, THREE.Material>();

  constructor(box: BoxDef) {
    this.group.position.set(box.pos.x, box.pos.y, box.pos.z);
    this.group.rotation.y = TURN[box.front ?? '-z'];
    this.bin = streetBinModel(this.group, box.colour);
    this.frame = this.bin.front.parent!;
    this.top = new THREE.Vector3(box.pos.x, box.pos.y + box.size.y / 2, box.pos.z);
  }

  /**
   * Something went in (a `binned` event): a brick of `colour` off its lid, or (`emptied`)
   * `count` bricks' worth out of the vacuum.
   */
  binned(emptied: boolean, count = 1, colour?: ColourId): void {
    const delay = (1 - this.k) * SWING * 0.6;
    this.openFor = Math.max(this.openFor, (1 - this.k) * SWING + SLIDE + FALL + HOLD);
    const { rest } = BIN_FRONT;
    const jitter = () => random() - 0.5;
    const added: Piece[] = [];
    if (!emptied) {
      // Off the middle of the lid, over its front edge and down into the scoop.
      const z = jitter() * 0.1;
      added.push({
        mesh: this.brick(COLOURS[colour ?? 'red'].hex),
        from: new THREE.Vector3(0, 1.035, z),
        edge: new THREE.Vector3(0.36, 1.05, z),
        over: new THREE.Vector3(0.46, 0.85, z),
        rest: new THREE.Vector3(rest.x, rest.y, z),
        spin: new THREE.Euler(jitter(), jitter(), -2.5),
        delay,
        t: 0,
      });
    } else {
      // Tipped out of the vacuum's dust bin, held over the scoop, in a cloud of dust.
      const n = Math.max(4, Math.min(9, count));
      for (let i = 0; i < n; i++) {
        const from = new THREE.Vector3(0.46 + jitter() * 0.1, 1.2 + i * 0.02, jitter() * 0.16);
        added.push({
          mesh: this.bit(COLOURS[LITTER[(i * 3 + count) % LITTER.length]!].hex),
          from,
          edge: from,
          over: new THREE.Vector3(from.x, 0.7, from.z * 0.7),
          rest: new THREE.Vector3(rest.x + jitter() * 0.06, rest.y + i * 0.012, jitter() * 0.24),
          spin: new THREE.Euler(jitter() * 6, jitter() * 6, jitter() * 6),
          delay: delay - SLIDE + i * 0.05,
          t: 0,
        });
      }
      for (let i = 0; i < 8; i++) {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: dustTexture(),
            color: 0xcfc6b8,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        sprite.position.set(0.45 + jitter() * 0.15, 1.05, jitter() * 0.25);
        sprite.scale.setScalar(0.06);
        this.frame.add(sprite);
        const vel = new THREE.Vector3(jitter() * 0.3, 0.15 + random() * 0.25, jitter() * 0.3);
        this.puffs.push({ sprite, vel, t: -delay - i * 0.04 });
      }
    }
    for (const p of added) this.bin.scoop.add(p.mesh);
    this.pieces.push(...added);
  }

  /** How many things are on their way in, or lying in its scoop while it is open. */
  get load(): number {
    return this.pieces.length;
  }

  /** Moves it all on by `dt` seconds. */
  update(dt: number): void {
    if (this.k === 0 && this.openFor <= 0 && !this.pieces.length && !this.puffs.length) return;
    this.openFor -= dt;
    const opening = this.openFor > 0;
    this.k = opening ? Math.min(1, this.k + dt / SWING) : Math.max(0, this.k - dt / SWING);
    this.bin.tip(THREE.MathUtils.smootherstep(this.k, 0, 1));
    const angle = this.bin.front.rotation.z;
    const { hinge } = BIN_FRONT;
    _p.set(hinge.x, hinge.y, 0);
    for (const p of this.pieces) {
      p.t += dt;
      const s = p.t - p.delay;
      const slid = Math.min(1, Math.max(0, s / SLIDE));
      const u = Math.min(1, Math.max(0, (s - SLIDE) / FALL));
      if (u === 0) _q.copy(p.from).lerp(p.edge, slid * slid);
      else {
        // Dropping, in the bin's axes, to where its resting place in the scoop now is.
        const fall = u * u;
        const a = 1 - fall;
        _q.copy(p.rest).sub(_p).applyAxisAngle(Z, angle).add(_p);
        _q.multiplyScalar(fall * fall)
          .addScaledVector(p.over, 2 * a * fall)
          .addScaledVector(p.edge, a * a);
      }
      // What is tipped out of the vacuum shows as it drops; a brick lies on the lid till then.
      p.mesh.visible = p.edge !== p.from || s >= SLIDE;
      // Put in the scoop's axes.
      p.mesh.position.copy(_q.sub(_p).applyAxisAngle(Z, -angle).add(_p));
      const k = Math.sin(Math.PI * u);
      p.mesh.rotation.set(p.spin.x * k, p.spin.y * k, p.spin.z * k - angle * (1 - u));
    }
    // In and shut: gone.
    if (this.k === 0 && !opening) {
      for (const p of this.pieces) p.mesh.removeFromParent();
      this.pieces = [];
    }
    this.puffs = this.puffs.filter((f) => {
      f.t += dt;
      if (f.t < 0) return true;
      const life = f.t / 0.9;
      if (life >= 1) {
        f.sprite.removeFromParent();
        f.sprite.material.dispose();
        return false;
      }
      f.sprite.position.addScaledVector(f.vel, dt);
      f.sprite.scale.setScalar(0.08 + life * 0.3);
      f.sprite.material.opacity = 0.8 * (1 - life) * Math.min(1, life * 6);
      return true;
    });
  }

  private material(colour: number): THREE.Material {
    let m = this.materials.get(colour);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35 });
      this.materials.set(colour, m);
    }
    return m;
  }

  /** A loose brick, two studs by four. */
  private brick(colour: number): THREE.Object3D {
    const g = new THREE.Group();
    const m = this.material(colour);
    g.add(new THREE.Mesh(BRICK, m));
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++) {
        const stud = new THREE.Mesh(STUD, m);
        stud.position.set(-0.048 + i * 0.032, 0.0365, -0.016 + j * 0.032);
        g.add(stud);
      }
    g.traverse((o) => (o.castShadow = true));
    return g;
  }

  /** A little brick out of the vacuum. */
  private bit(colour: number): THREE.Object3D {
    const m = new THREE.Mesh(BIT, this.material(colour));
    m.castShadow = true;
    return m;
  }
}

const Z = new THREE.Vector3(0, 0, 1);

let dust: THREE.DataTexture | null = null;

/** A soft round puff, white, fading out to its edge. */
function dustTexture(): THREE.DataTexture {
  if (dust) return dust;
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const i = (y * n + x) * 4;
      data.fill(255, i, i + 3);
      data[i + 3] = Math.round(255 * Math.max(0, 1 - r) ** 1.6);
    }
  dust = new THREE.DataTexture(data, n, n);
  dust.magFilter = dust.minFilter = THREE.LinearFilter;
  dust.needsUpdate = true;
  return dust;
}
const BRICK = new THREE.BoxGeometry(0.128, 0.058, 0.064);
const STUD = new THREE.CylinderGeometry(0.0095, 0.0095, 0.015, 12);
const BIT = new THREE.BoxGeometry(0.031, 0.021, 0.044);

/** The tipping bins of a level drawn with a scene, and what goes in them. */
export class TippingBins {
  readonly bins: TippingBin[];

  constructor(boxes: BoxDef[], parent: THREE.Object3D) {
    this.bins = boxes.map((b) => new TippingBin(b));
    for (const b of this.bins) parent.add(b.group);
  }

  /** Something went in the bin whose top's middle is at `at` (see `TippingBin.binned`). */
  binned(at: { x: number; y: number; z: number }, emptied: boolean, count = 1, colour?: ColourId) {
    let best: TippingBin | null = null;
    let near = 0.5;
    for (const b of this.bins) {
      const d = Math.hypot(b.top.x - at.x, b.top.z - at.z) + Math.abs(b.top.y - at.y);
      if (d < near) [best, near] = [b, d];
    }
    best?.binned(emptied, count, colour);
  }

  update(dt: number): void {
    for (const b of this.bins) b.update(dt);
  }
}
