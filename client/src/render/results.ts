import * as THREE from 'three';
import { BRICK_TYPES, TEAM_WINNERS, errorsOf } from '@sar/shared';
import type { BrickGrid, EndReason, MatchResult, Role, TargetBuild, Winner } from '@sar/shared';

/** How a race ended, as the results screen shows it. */
export interface TeamsEnding {
  teams: { name: string; result: MatchResult; handedIn: number | null }[] | null;
  /** The viewer's team, or null. */
  team: number | null;
}
import { baseplateMarker, brickMaterial } from './bricks.ts';
import { addBrickMesh, addGhostMesh, addShell } from './pages.ts';

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
  /** A free build: no target, so the build alone fills the stage. */
  private free = false;
  private readonly nameInput: HTMLInputElement;
  private readonly exportMsg: HTMLElement;

  /** `onExport` saves the job site's build under the name typed, and says what it did. */
  constructor(parent: HTMLElement, onPlayAgain: () => void, onExport: (name: string) => string) {
    this.el = document.createElement('div');
    this.el.id = 'results';
    this.el.innerHTML = `
      <div class="sheet dialog">
        <header><span class="eyebrow">Final inspection</span><span class="meta">Round over</span></header>
        <h1></h1>
        <p class="reason"></p>
        <p class="roles"></p>
        <div class="stage"><span>Target</span><span>Your build</span></div>
        <p class="stats"></p>
        <p class="legend"><span><i class="close"></i> close</span> <span><i class="wrong"></i> wrong or extra</span> <span><i class="missing"></i> missing</span></p>
        <div class="export-row free-only">
          <label class="field">Name <input type="text" maxlength="20" spellcheck="false" /></label>
          <button type="button" class="btn export">Export build</button>
        </div>
        <p class="export-msg free-only"></p>
        <button type="button" class="btn btn-primary back">Back to the lobby</button>
      </div>`;
    this.el.querySelector('.stage')!.prepend(this.renderer.domElement);
    this.el.querySelector('.back')!.addEventListener('click', onPlayAgain);
    this.nameInput = this.el.querySelector('.export-row input')!;
    this.exportMsg = this.el.querySelector('.export-msg')!;
    this.el.querySelector('.export')!.addEventListener('click', () => {
      this.exportMsg.textContent = onExport(this.nameInput.value);
    });
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
    ending:
      | ({ winner: Winner; roles: { name: string; role: Role; home: boolean }[] } & TeamsEnding)
      | null,
    /** A free build, and the name its export gets unless another is typed. */
    free: { name: string } | null = null,
  ): void {
    this.target.clear();
    this.actual.clear();
    this.free = free !== null;
    this.el.classList.toggle('free', this.free);
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
      if (v.status === 'missing') addGhostMesh(this.actual, v.target, ghost);
      else if (v.status === 'wrong' && actual) addShell(this.actual, actual, 0xff3b30);
      else if (v.status === 'close' && actual) addShell(this.actual, actual, 0xff9f0a);
    }
    if (free) {
      // Nothing to judge against: just the build, turning, and a way to keep it.
      this.el.classList.remove('passed');
      const n = [...grid.bricks.values()].filter((b) => !BRICK_TYPES[b.type].fixture).length;
      this.el.querySelector('.eyebrow')!.textContent = 'Free build';
      this.el.querySelector('h1')!.textContent = 'Your build';
      this.el.querySelector('.reason')!.textContent =
        n === 0
          ? 'The baseplate is empty this time.'
          : `You built with ${n} ${n === 1 ? 'brick' : 'bricks'}. Export it to keep it.`;
      this.el.querySelector('.roles')!.innerHTML = '';
      this.el.querySelector('.stats')!.textContent = '';
      this.nameInput.placeholder = free.name;
      this.exportMsg.textContent = '';
      this.el.classList.add('visible');
      return;
    }
    for (const id of result.extras) addShell(this.actual, grid.bricks.get(id)!, 0xff3b30);
    this.el.querySelector('.eyebrow')!.textContent = 'Final inspection';

    const c = result.counts;
    const winner = ending?.winner ?? (result.passed ? 'builders' : 'nobody');
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (ending?.teams) {
      // A race: who won, and how each team did.
      const mine = ending.team === null ? null : TEAM_WINNERS[ending.team];
      const won = ending.teams.find((_, i) => TEAM_WINNERS[i] === winner);
      this.el.querySelector('h1')!.textContent =
        winner === 'draw' ? 'A draw!' : `The ${won?.name ?? '?'} team wins!`;
      this.el.classList.toggle('passed', mine !== null && winner === mine);
      this.el.querySelector('.reason')!.textContent =
        reason === 'time'
          ? 'The whistle blew: time is up. Builds are judged as they stand.'
          : 'The race is over: accuracy first, then speed.';
      const clock = (s: number) =>
        `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
      this.el.querySelector('.roles')!.innerHTML = ending.teams
        .map((t, i) => {
          const n = t.result.counts;
          const errors = errorsOf(t.result);
          const when =
            t.handedIn === null ? 'did not hand in' : `handed in at ${clock(t.handedIn)}`;
          return `<span class="${TEAM_WINNERS[i]}">${esc(t.name)}: ${n.correct} of ${n.total} right · ${errors} ${errors === 1 ? 'error' : 'errors'} · ${when}</span>`;
        })
        .join(' ');
    } else {
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
      this.el.querySelector('.roles')!.innerHTML = (ending?.roles ?? [])
        .map(
          (r) =>
            `<span class="${r.role}">${esc(r.name)}: ${r.role}${r.home ? ' (sent home)' : ''}</span>`,
        )
        .join(' ');
    }
    this.el.querySelector('.stats')!.textContent =
      `${c.correct} of ${c.total} bricks correct · ${c.close} close · ${c.wrong} wrong · ` +
      `${c.missing} missing · ${c.extra} extra · score ${Math.round(result.score * 100)}%`;
    this.el.classList.add('visible');
  }

  /** Only the host can start the next round; everyone else waits for them. */
  setHost(isHost: boolean): void {
    const b = this.el.querySelector<HTMLButtonElement>('.back')!;
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
    if (this.free) {
      this.target.visible = false;
      this.actual.visible = true;
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, W, H);
      this.renderer.setScissor(0, 0, W, H);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.camera.aspect !== W / 2 / H) {
      this.camera.aspect = W / 2 / H;
      this.camera.updateProjectionMatrix();
    }
    for (const [i, g] of [this.target, this.actual].entries()) {
      this.target.visible = g === this.target;
      this.actual.visible = g === this.actual;
      this.renderer.setViewport(i * (W / 2), 0, W / 2, H);
      this.renderer.setScissor(i * (W / 2), 0, W / 2, H);
      this.renderer.render(this.scene, this.camera);
    }
  }
}
