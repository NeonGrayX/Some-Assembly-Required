import * as THREE from 'three';
import type { LevelDef } from '@sar/shared';
import { PANEL_LED } from './props.ts';

const GREEN = 0x3ad35a;
const RED = 0xff3b2f;
const AMBER = 0xffb02e;
/** Sparks alive at once, at most. */
const SPARKS = 40;
/** How long a spark flies, in seconds. */
const SPARK_LIFE = 0.45;

/**
 * The electrical panel's look in the basement: its status light shows green while the power
 * is on, blinks red while it is out (with sparks spitting from the door now and then) and
 * shows amber while someone is fixing it.
 */
export class PanelView {
  private readonly led: THREE.Mesh | null;
  private readonly sparks: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly origin: THREE.Vector3 | null = null;
  /** Which way the panel's front looks. */
  private readonly out = new THREE.Vector3();
  private clock = 0;
  private nextBurst = 0;

  constructor(root: THREE.Object3D, level: LevelDef) {
    const led = root.getObjectByName(PANEL_LED);
    this.led = led instanceof THREE.Mesh ? led : null;
    const box = level.boxes.find((b) => b.model === 'panel');
    if (box) {
      const facing = { '-z': 0, '-x': Math.PI / 2, '+z': Math.PI, '+x': -Math.PI / 2 }[
        box.front ?? '-z'
      ];
      this.out.set(-Math.sin(facing), 0, -Math.cos(facing));
      const depth = box.front === '-x' || box.front === '+x' ? box.size.x : box.size.z;
      this.origin = new THREE.Vector3(box.pos.x, box.pos.y, box.pos.z).addScaledVector(
        this.out,
        depth / 2,
      );
    }
    this.pos = new Float32Array(SPARKS * 3);
    this.vel = new Float32Array(SPARKS * 3);
    this.life = new Float32Array(SPARKS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.sparks = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xfff1b8,
        size: 0.045,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    root.add(this.sparks);
  }

  /** Moves the light and the sparks on by `dt` seconds. */
  update(dt: number, on: boolean, fixing: boolean): void {
    this.clock += dt;
    const led = this.led?.material as THREE.MeshBasicMaterial | undefined;
    if (led) {
      const blink = Math.floor(this.clock * 2.5) % 2 === 0;
      led.color.setHex(on ? GREEN : fixing ? AMBER : blink ? RED : 0x401010);
    }
    if (!this.origin) return;
    // A burst of sparks every second or two while it is broken and nobody is at it.
    if (!on && !fixing && this.clock >= this.nextBurst) {
      this.burst(6 + Math.floor(Math.random() * 10));
      this.nextBurst = this.clock + 0.6 + Math.random() * 1.6;
    }
    let alive = 0;
    for (let i = 0; i < SPARKS; i++) {
      if (this.life[i]! <= 0) {
        // Out of sight until it flies again.
        this.pos[i * 3 + 1] = -1000;
        continue;
      }
      alive++;
      this.life[i] = this.life[i]! - dt;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! - 9.8 * dt;
      for (let k = 0; k < 3; k++)
        this.pos[i * 3 + k] = this.pos[i * 3 + k]! + this.vel[i * 3 + k]! * dt;
    }
    this.sparks.visible = alive > 0;
    this.sparks.geometry.attributes.position!.needsUpdate = true;
  }

  private burst(n: number): void {
    const o = this.origin!;
    for (let i = 0; i < SPARKS && n > 0; i++) {
      if (this.life[i]! > 0) continue;
      n--;
      this.life[i] = SPARK_LIFE * (0.5 + Math.random());
      // From the gap round the door, flying out and up.
      this.pos.set(
        [o.x + (Math.random() - 0.5) * 0.4, o.y + (Math.random() - 0.3) * 0.5, o.z],
        i * 3,
      );
      const speed = 0.8 + Math.random() * 1.6;
      const side = new THREE.Vector3(this.out.z, 0, -this.out.x).multiplyScalar(
        (Math.random() - 0.5) * 1.6,
      );
      this.vel.set(
        [
          (this.out.x + side.x) * speed,
          (0.4 + Math.random()) * speed,
          (this.out.z + side.z) * speed,
        ],
        i * 3,
      );
    }
  }
}
