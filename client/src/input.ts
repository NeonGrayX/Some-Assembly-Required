import type { Action, PlayerInput } from '@sar/shared';

/** Radians per pixel of mouse movement at sensitivity 1. */
const MOUSE_SENSITIVITY = 0.0025;
/** Radians per pixel a finger drags across the screen at sensitivity 1. */
const TOUCH_SENSITIVITY = 0.0055;
const MAX_PITCH = 1.45;

/**
 * Whether to play by touch: a phone or tablet, whose main pointer is a finger. A laptop with a
 * touch screen keeps the mouse. `?touch` in the address forces it, to try it on a desktop.
 */
export function isTouchDevice(): boolean {
  if (new URLSearchParams(location.search).has('touch')) return true;
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** Stops playing by touch; set by the Input. */
let stopTouch = () => {};

/**
 * Frees the mouse (or, on a touch screen, stops playing) so the buttons on screen can be used:
 * for the chat, settings, meetings and results.
 */
export function freeMouse(): void {
  document.exitPointerLock();
  stopTouch();
}

/**
 * Keyboard and mouse state, turned into a PlayerInput plus a queue of one-shot actions. On a
 * touch screen the on-screen controls (ui/touch.ts) feed the same state through `pad`, `look`
 * and `act`, and "playing" is a mode the game switches rather than a captured mouse.
 */
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
  /** Playing by touch, see isTouchDevice. */
  readonly touch = isTouchDevice();
  /** The on-screen stick (-1 to 1 on each axis) and the movement buttons held on screen. */
  readonly pad = { forward: 0, right: 0, jump: false, sprint: false, careful: false };
  private touchPlaying = false;
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
  /** A number key (1 to 9): a saboteur tool, or in a gear hunt the gear to take off. */
  onDigit: (n: number) => void = () => {};
  /**
   * Esc while playing: return true if it closed something, so the mouse stays captured. The
   * page only sees this Esc in full screen with the keyboard locked; elsewhere the browser
   * frees the mouse first and onEscapeUnlock gets the turn instead.
   */
  onEscape = () => false;
  /** The mouse was freed by something other than the game (normally Esc). */
  onEscapeUnlock = () => {};
  /** Playing by touch stopped: the on-screen controls let go of every finger on them. */
  onTouchStop = () => {};

  constructor(private readonly canvas: HTMLElement) {
    stopTouch = () => this.setTouchPlaying(false);
    document.body.classList.toggle('touch', this.touch);
    canvas.addEventListener('click', () => {
      if (!this.locked) this.relock();
    });
    document.addEventListener('pointerlockchange', () => {
      document.body.classList.toggle('playing', this.locked);
      if (!this.locked) {
        this.keys.clear();
        this.onEscapeUnlock();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.touchPlaying) return;
      this.turn(e.movementX * MOUSE_SENSITIVITY, e.movementY * MOUSE_SENSITIVITY);
    });
    document.addEventListener('mousedown', (e) => {
      // A tap also sends a mouse click; the touch controls have already handled it.
      if (!this.locked || this.touchPlaying) return;
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
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
        case 'Digit5':
        case 'Digit6':
        case 'Digit7':
        case 'Digit8':
        case 'Digit9':
          this.onDigit(Number(e.code.slice('Digit'.length)));
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

  /** Turns the view by a finger's drag across the screen, in pixels. */
  look(dx: number, dy: number): void {
    this.turn(dx * TOUCH_SENSITIVITY, dy * TOUCH_SENSITIVITY);
  }

  private turn(yaw: number, pitch: number): void {
    this.state.yaw -= yaw * this.sensitivity;
    this.state.pitch = Math.max(
      -MAX_PITCH,
      Math.min(MAX_PITCH, this.state.pitch - pitch * this.sensitivity),
    );
  }

  /**
   * Playing by touch: the on-screen controls show and take the screen, as a captured mouse
   * would. Stopping frees the screen for buttons, as Esc frees the mouse.
   */
  setTouchPlaying(on: boolean): void {
    if (!this.touch || on === this.touchPlaying) return;
    this.touchPlaying = on;
    document.body.classList.toggle('playing', on);
    if (on) return;
    this.keys.clear();
    Object.assign(this.pad, { forward: 0, right: 0, jump: false, sprint: false });
    this.onTouchStop();
    this.onEscapeUnlock();
  }

  /** Captures the mouse again without a click, where the browser allows it. */
  relock(): void {
    if (this.touch) return this.setTouchPlaying(true);
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
    return document.pointerLockElement === this.canvas || this.touchPlaying;
  }

  /** Refreshes movement axes from held keys. Call once per frame. */
  update(): void {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const axis = (v: number) => Math.max(-1, Math.min(1, v));
    const pad = this.pad;
    this.state.forward = axis(k('KeyW') - k('KeyS') + pad.forward);
    this.state.right = axis(k('KeyD') - k('KeyA') + pad.right);
    this.state.jump = this.keys.has('Space') || pad.jump;
    this.state.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || pad.sprint;
    this.state.careful =
      this.keys.has('ControlLeft') || this.keys.has('ControlRight') || pad.careful;
  }

  /** Queues an action as if a key had been pressed. */
  act(action: Action): void {
    this.queue.push(action);
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
export async function toggleFullscreen(): Promise<void> {
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
