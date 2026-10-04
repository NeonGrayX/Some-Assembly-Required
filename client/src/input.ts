import type { Action, PlayerInput } from '@sar/shared';

const MOUSE_SENSITIVITY = 0.0025;
const MAX_PITCH = 1.45;

/** Keyboard and mouse state, turned into a PlayerInput plus a queue of one-shot actions. */
export class Input {
  readonly state: PlayerInput = {
    forward: 0,
    right: 0,
    jump: false,
    sprint: false,
    yaw: 0,
    pitch: -0.25,
    firstPerson: false,
  };
  private readonly keys = new Set<string>();
  private queue: Action[] = [];
  /** Set by the game: whether the player currently holds something. */
  holding = () => false;
  onToggleHelp = () => {};
  onToggleReader = () => {};
  onToggleReport = () => {};

  constructor(private readonly canvas: HTMLElement) {
    canvas.addEventListener('click', () => {
      if (!this.locked) void canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('playing', this.locked);
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.state.yaw -= e.movementX * MOUSE_SENSITIVITY;
      this.state.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, this.state.pitch - e.movementY * MOUSE_SENSITIVITY),
      );
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.queue.push({ kind: this.holding() ? 'place' : 'grab' });
      if (e.button === 2) this.queue.push({ kind: 'pull' });
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyE':
          this.queue.push({ kind: this.holding() ? 'place' : 'grab' });
          break;
        case 'KeyR':
          this.queue.push({ kind: 'rotate' });
          break;
        case 'KeyG':
          this.queue.push({ kind: 'drop' });
          break;
        case 'KeyT':
          this.queue.push({ kind: 'throw' });
          break;
        case 'KeyV':
          this.state.firstPerson = !this.state.firstPerson;
          break;
        case 'KeyH':
          this.onToggleHelp();
          break;
        case 'KeyQ':
          this.onToggleReader();
          break;
        case 'KeyI':
          this.onToggleReport();
          break;
        case 'KeyX':
          this.queue.push({ kind: 'dropPage' });
          break;
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Refreshes movement axes from held keys. Call once per frame. */
  update(): void {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    this.state.forward = k('KeyW') - k('KeyS');
    this.state.right = k('KeyD') - k('KeyA');
    this.state.jump = this.keys.has('Space');
    this.state.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  drainActions(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
