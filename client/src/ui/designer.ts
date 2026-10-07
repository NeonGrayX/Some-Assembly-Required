import * as THREE from 'three';
import { DEFAULT_LOOK, FACES, HATS, SHIRTS, faceName, hatName, shirtName } from '@sar/shared';
import type { Look } from '@sar/shared';
import { animateAvatar, makeAvatar } from '../render/avatar.ts';
import type { Avatar } from '../render/avatar.ts';

const WIDTH = 132;
const HEIGHT = 176;

/**
 * The character designer in the lobby: your builder on a little turntable, in your colour,
 * with previous/next buttons for the hat, the face and the shirt. Locked once you are ready
 * (and while the round runs), since the look is part of how everyone knows you.
 */
export class Designer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, WIDTH / HEIGHT, 0.1, 20);
  private avatar: Avatar | null = null;
  private shown: { look: Look; colour: number } | null = null;
  private locked = false;
  private readonly labels: Record<keyof Look, HTMLElement>;
  private readonly buttons: HTMLButtonElement[];
  private readonly note: HTMLElement;
  private last = performance.now();
  private sway = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly onChange: (look: Look) => void,
  ) {
    this.canvas = el.querySelector('canvas')!;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(2, 3, 2.5);
    this.scene.add(sun);
    this.camera.position.set(0, 0.1, 3.2);
    this.camera.lookAt(0, 0.05, 0);
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
    this.labels = { hat: q('.pick-hat'), face: q('.pick-face'), shirt: q('.pick-shirt') };
    this.note = q('.note');
    this.buttons = [...el.querySelectorAll<HTMLButtonElement>('button')];
    for (const b of this.buttons) {
      b.addEventListener('click', () => {
        if (this.locked || !this.shown) return;
        const look = { ...this.shown.look };
        if (b.dataset.shuffle !== undefined) {
          const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]!;
          look.hat = pick(HATS).id;
          look.face = pick(FACES).id;
          look.shirt = pick(SHIRTS).id;
        } else {
          const dir = b.dataset.next !== undefined ? 1 : -1;
          const which = (b.dataset.next ?? b.dataset.prev) as keyof Look;
          if (which === 'hat') look.hat = step(HATS, look.hat, dir);
          if (which === 'face') look.face = step(FACES, look.face, dir);
          if (which === 'shirt') look.shirt = step(SHIRTS, look.shirt, dir);
        }
        this.onChange(look);
      });
    }
  }

  /**
   * Shows `look` in `colour` (rebuilding the figure only when they change), and locks or
   * frees the buttons. Call every frame while the lobby is up; it draws the turntable.
   */
  update(look: Look, colour: number, locked: boolean): void {
    if (
      !this.shown ||
      this.shown.colour !== colour ||
      this.shown.look.hat !== look.hat ||
      this.shown.look.face !== look.face ||
      this.shown.look.shirt !== look.shirt
    ) {
      this.rebuild(look, colour);
      this.labels.hat.textContent = hatName(look.hat);
      this.labels.face.textContent = faceName(look.face);
      this.labels.shirt.textContent = shirtName(look.shirt);
    }
    if (locked !== this.locked) {
      this.locked = locked;
      this.el.classList.toggle('locked', locked);
      for (const b of this.buttons) b.disabled = locked;
      this.note.textContent = locked ? 'Press Not ready to change your look.' : '';
    }
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.sway += dt;
    if (!this.avatar) return;
    // Faces the camera, turning a little each way so the sides and the hat show too.
    this.avatar.group.rotation.y = Math.PI + Math.sin(this.sway * 0.7) * 0.8;
    animateAvatar(this.avatar, { limping: false, carrying: false, careful: false }, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private rebuild(look: Look, colour: number): void {
    if (this.avatar) {
      this.scene.remove(this.avatar.group);
      this.avatar.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    this.avatar = makeAvatar(colour, null, look);
    this.avatar.group.position.y = 0.05;
    this.scene.add(this.avatar.group);
    this.shown = { look: { ...look }, colour };
  }
}

/** The entry `dir` steps along from `id` in `list`, wrapping round. */
function step<T extends { id: string }>(list: readonly T[], id: string, dir: 1 | -1): T['id'] {
  const i = list.findIndex((x) => x.id === id);
  const n = list.length;
  return list[(i + dir + n) % n]!.id;
}

export { DEFAULT_LOOK };
