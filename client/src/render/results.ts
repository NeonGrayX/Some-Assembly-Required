import * as THREE from 'three';
import type { BrickGrid, EndReason, MatchResult, Role, TargetBuild, Winner } from '@sar/shared';
import { baseplateMarker, brickMaterial } from './bricks.ts';
import { addBrickMesh, addShell } from './pages.ts';

const W = 960;
const H = 440;
const CENTRE = new THREE.Vector3(0.8, 0.45, 0.8);

const ghost = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
});

/** End-of-round screen: target and real build side by side on turntables. */
export class ResultsView {
  readonly el: HTMLElement;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, W / 2 / H, 0.05, 50);
  private readonly target = new THREE.Group();
  private readonly actual = new THREE.Group();
  private angle = 0;

  constructor(parent: HTMLElement, onPlayAgain: () => void) {
    this.el = document.createElement('div');
    this.el.id = 'results';
    this.el.innerHTML = `
      <div class="sheet">
        <header><span class="eyebrow">Final inspection</span><span class="meta">Round over</span></header>
        <h1></h1>
        <p class="reason"></p>
        <p class="roles"></p>
        <div class="stage"><span>Target</span><span>Your build</span></div>
        <p class="stats"></p>
        <p class="legend"><span><i class="close"></i> close</span> <span><i class="wrong"></i> wrong or extra</span> <span><i class="missing"></i> missing</span></p>
        <button type="button">Back to the lobby</button>
      </div>`;
    this.el.querySelector('.stage')!.prepend(this.renderer.domElement);
    this.el.querySelector('button')!.addEventListener('click', onPlayAgain);
    parent.appendChild(this.el);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(W, H);
    this.renderer.setScissorTest(true);
    this.scene.background = new THREE.Color(0xe9e4d8);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 6, 4);
    this.scene.add(sun, this.target, this.actual);
    for (const g of [this.target, this.actual]) g.position.copy(CENTRE).negate().setY(0);
  }

  show(
    build: TargetBuild,
    grid: BrickGrid,
    result: MatchResult,
    reason: EndReason,
    ending: { winner: Winner; roles: { name: string; role: Role; home: boolean }[] } | null,
  ): void {
    this.target.clear();
    this.actual.clear();
    const plate = {
      type: 'baseplate16' as const,
      colour: 'baseplate-green' as const,
      x: 0,
      y: 0,
      z: 0,
      rot: 0 as const,
    };
    addBrickMesh(this.target, plate, brickMaterial(plate.colour));
    this.target.add(baseplateMarker());
    for (const b of build.steps.flatMap((s) => s.bricks))
      addBrickMesh(this.target, b, brickMaterial(b.colour), false, build.svgs);

    for (const b of grid.bricks.values())
      addBrickMesh(this.actual, b, brickMaterial(b.colour), false, build.svgs);
    this.actual.add(baseplateMarker());
    for (const v of result.bricks) {
      const actual = v.actualId !== undefined ? grid.bricks.get(v.actualId) : undefined;
      if (v.status === 'missing') addBrickMesh(this.actual, v.target, ghost);
      else if (v.status === 'wrong' && actual) addShell(this.actual, actual, 0xff3b30);
      else if (v.status === 'close' && actual) addShell(this.actual, actual, 0xff9f0a);
    }
    for (const id of result.extras) addShell(this.actual, grid.bricks.get(id)!, 0xff3b30);

    const c = result.counts;
    const winner = ending?.winner ?? (result.passed ? 'builders' : 'nobody');
    this.el.querySelector('h1')!.textContent =
      winner === 'builders'
        ? 'The builders win!'
        : winner === 'saboteurs'
          ? 'The saboteurs win!'
          : result.passed
            ? 'Build approved!'
            : 'Build rejected';
    this.el.classList.toggle('passed', winner === 'builders');
    const why =
      reason === 'time'
        ? 'The whistle blew: time is up.'
        : reason === 'votes'
          ? 'Two innocent builders were sent home.'
          : result.passed
            ? 'The team handed in a correct build.'
            : 'The team handed in a build that does not match the plans.';
    this.el.querySelector('.reason')!.textContent = why;
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    this.el.querySelector('.roles')!.innerHTML = (ending?.roles ?? [])
      .map(
        (r) =>
          `<span class="${r.role}">${esc(r.name)}: ${r.role}${r.home ? ' (sent home)' : ''}</span>`,
      )
      .join(' ');
    this.el.querySelector('.stats')!.textContent =
      `${c.correct} of ${c.total} bricks correct · ${c.close} close · ${c.wrong} wrong · ` +
      `${c.missing} missing · ${c.extra} extra · score ${Math.round(result.score * 100)}%`;
    this.el.classList.add('visible');
  }

  /** Only the host can start the next round; everyone else waits for them. */
  setHost(isHost: boolean): void {
    const b = this.el.querySelector('button')!;
    b.disabled = !isHost;
    b.textContent = isHost ? 'Back to the lobby' : 'Waiting for the host…';
  }

  hide(): void {
    this.el.classList.remove('visible');
  }

  get visible(): boolean {
    return this.el.classList.contains('visible');
  }

  frame(dt: number): void {
    if (!this.visible) return;
    this.angle += dt * 0.5;
    const r = 3.4;
    this.camera.position.set(Math.sin(this.angle) * r, 1.9, Math.cos(this.angle) * r);
    this.camera.lookAt(0, 0.45, 0);
    for (const [i, g] of [this.target, this.actual].entries()) {
      this.target.visible = g === this.target;
      this.actual.visible = g === this.actual;
      this.renderer.setViewport(i * (W / 2), 0, W / 2, H);
      this.renderer.setScissor(i * (W / 2), 0, W / 2, H);
      this.renderer.render(this.scene, this.camera);
    }
  }
}
