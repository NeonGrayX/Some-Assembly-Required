import type { Action, PlayerInput } from '@sar/shared';

/** Radians per pixel of mouse movement at sensitivity 1. */
const MOUSE_SENSITIVITY = 0.0025;
const MAX_PITCH = 1.45;

/** Keyboard and mouse state, turned into a PlayerInput plus a queue of one-shot actions. */
export class Input {
  readonly state: PlayerInput = {
    forward: 0,
    right: 0,
    jump: false,
    sprint: false,
    careful: false,
    yaw: 0,
    pitch: -0.25,
    firstPerson: false,
  };
  private readonly keys = new Set<string>();
  private queue: Action[] = [];
  private closeKeyDown = false;
  /** Multiplier on the base mouse speed, from the settings menu. */
  sensitivity = 1;
  /** Set by the game: whether the player currently holds something. */
  holding = () => false;
  onToggleHelp = () => {};
  onToggleReader = () => {};
  onToggleReport = () => {};
  /** B: hold up the page in your pocket for those nearby. */
  onShow = () => {};
  /** Enter pressed while playing: open the chat box. */
  onChat = () => {};
  /**
   * Esc while playing: return true if it closed something, so the mouse stays captured. The
   * page only sees this Esc in full screen with the keyboard locked; elsewhere the browser
   * frees the mouse first and onEscapeUnlock gets the turn instead.
   */
  onEscape = () => false;
  /** The mouse was freed by something other than the game (normally Esc). */
  onEscapeUnlock = () => {};

  constructor(private readonly canvas: HTMLElement) {
    canvas.addEventListener('click', () => {
      if (!this.locked) void canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('playing', this.locked);
      if (!this.locked) {
        this.keys.clear();
        this.onEscapeUnlock();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const speed = MOUSE_SENSITIVITY * this.sensitivity;
      this.state.yaw -= e.movementX * speed;
      this.state.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, this.state.pitch - e.movementY * speed),
      );
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.queue.push({ kind: this.holding() ? 'place' : 'grab' });
      if (e.button === 2) this.queue.push({ kind: 'pull' });
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // Ctrl or Cmd went down mid-game; kept through a lost pointer lock, since closing the tab
    // may free the mouse before beforeunload runs.
    document.addEventListener('keydown', (e) => {
      if (isCloseModifier(e.code) && this.locked) this.closeKeyDown = true;
    });
    document.addEventListener('keyup', (e) => {
      if (isCloseModifier(e.code)) this.closeKeyDown = false;
    });
    // A keyup that lands in another window or a dialog never reaches us.
    window.addEventListener('blur', () => (this.closeKeyDown = false));
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      // Ctrl is careful walking: keep Ctrl+S, Ctrl+D and the like from saving or bookmarking.
      // (Ctrl+W only reaches the page in full screen, see toggleFullscreen.)
      if (e.ctrlKey) e.preventDefault();
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
        case 'KeyF':
          void toggleFullscreen();
          break;
        case 'KeyH':
          this.onToggleHelp();
          break;
        case 'KeyQ':
          this.onToggleReader();
          break;
        case 'KeyB':
          this.onShow();
          break;
        case 'KeyI':
          this.onToggleReport();
          break;
        case 'Digit1':
          this.queue.push({ kind: 'sabotage', tool: 'swap' });
          break;
        case 'Digit2':
          this.queue.push({ kind: 'sabotage', tool: 'forge' });
          break;
        case 'Digit3':
          this.queue.push({ kind: 'sabotage', tool: 'hide' });
          break;
        case 'Digit4':
          this.queue.push({ kind: 'sabotage', tool: 'clumsy' });
          break;
        case 'Digit5':
          this.queue.push({ kind: 'sabotage', tool: 'trap' });
          break;
        case 'Enter':
          this.onChat();
          break;
        case 'KeyX':
          this.queue.push({ kind: 'dropPage' });
          break;
        case 'Escape':
          if (this.onEscape()) e.preventDefault();
          break;
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  /** Captures the mouse again without a click, where the browser allows it. */
  relock(): void {
    try {
      // A promise in Chrome, nothing in Firefox; either way a refusal just leaves it free.
      void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
    } catch {
      // Refused: the next click captures it.
    }
  }

  /**
   * Whether the page closing now is most likely a slip: Ctrl (careful walking) or Cmd was
   * pressed while playing and is still held, so the close came from Ctrl+W or Cmd+W rather
   * than the close button. Reloads never match: with the mouse captured, the game swallows
   * Ctrl+R and Ctrl+F5, and the reload button cannot be clicked.
   */
  get accidentalClose(): boolean {
    return this.closeKeyDown;
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
    this.state.careful = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
  }

  drainActions(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}

function isCloseModifier(code: string): boolean {
  return code.startsWith('Control') || code.startsWith('Meta');
}

/**
 * Full screen. In Chrome and Edge it also locks the keyboard, so shortcuts such as Ctrl+W
 * (close tab) reach the game instead of the browser; leaving takes holding Esc. Other
 * browsers only go full screen.
 */
async function toggleFullscreen(): Promise<void> {
  const keyboard = (navigator as { keyboard?: { lock(): Promise<void>; unlock(): void } }).keyboard;
  if (document.fullscreenElement) {
    keyboard?.unlock();
    await document.exitFullscreen();
    return;
  }
  try {
    await document.documentElement.requestFullscreen();
    await keyboard?.lock();
  } catch {
    // Not allowed here (an embedded frame, say): play on without it.
  }
}
