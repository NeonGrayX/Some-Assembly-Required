import type { Action } from '@sar/shared';
import type { Input } from '../input.ts';

/** How far the stick's knob travels from its centre, in CSS pixels. */
const STICK_RADIUS = 52;
/** Pushed this far past the ring, the stick sprints. */
const SPRINT_PAST = 1.35;
/** A touch that moves less than this (px) and lifts within TAP_MS is a tap, not a look. */
const TAP_SLOP = 12;
const TAP_MS = 500;

/** What the game tells the controls each frame, so only the buttons that do something show. */
export interface TouchContext {
  /** Holding a brick, a build or the vacuum. */
  holding: boolean;
  /** Holding a part that flips to go on by its other hole (see `canFlip`). */
  flip: boolean;
  /** A page in your pocket. */
  page: boolean;
  /** In a room with other people, where the chat reaches someone. */
  others: boolean;
  /** Push to talk is on, so the talk button has a use. */
  talk: boolean;
}

/** What the Use button says: Place while holding something (see TouchContext.holding). */
export const useLabel = (holding: boolean): string => (holding ? 'Place' : 'Use');

export interface TouchHandlers {
  /** A tap on the game: what a left click does. */
  tap: () => void;
  read: () => void;
  show: () => void;
  chat: () => void;
  help: () => void;
  talk: (down: boolean) => void;
  fullscreen: () => void;
}

/**
 * Playing on a phone or tablet: a stick for the left thumb (it appears where the thumb lands,
 * and runs when pushed past its ring), dragging anywhere else to look, a tap to do what a
 * click does, and buttons for everything the keyboard does. Only shown while playing by touch.
 */
export class TouchControls {
  private readonly el = document.getElementById('touch')!;
  private readonly stick = this.el.querySelector<HTMLElement>('.stick')!;
  private readonly knob = this.el.querySelector<HTMLElement>('.knob')!;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly careful: HTMLButtonElement;
  /** The finger on the stick, and where it went down. */
  private stickTouch: { id: number; x: number; y: number } | null = null;
  /** Fingers looking around, with where and when they went down and where they were last. */
  private readonly looks = new Map<
    number,
    { x0: number; y0: number; x: number; y: number; at: number; moved: boolean }
  >();
  private shown = '';
  /** Buttons held down, by the finger holding them: jump and talk last as long as the hold. */
  private readonly held = new Map<number, HTMLButtonElement>();

  constructor(
    private readonly input: Input,
    private readonly handlers: TouchHandlers,
  ) {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-touch]')) {
      this.buttons.set(b.dataset.touch!, b);
    }
    this.careful = this.buttons.get('careful')!;
    if (!document.fullscreenEnabled) this.buttons.get('fullscreen')!.parentElement!.remove();
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', (e) => this.up(e, false));
    this.el.addEventListener('pointercancel', (e) => this.up(e, true));
    // A tap sends a click once the finger lifts, aimed at whatever is under it by then: the
    // page Read just opened (which a tap closes), or the game behind How to play or the chat
    // (which a tap resumes). The button acted when it went down, so no click follows it.
    this.el.addEventListener(
      'touchend',
      (e) => {
        if ((e.target as HTMLElement).closest('button[data-touch]')) e.preventDefault();
      },
      { passive: false },
    );
    input.onTouchStop = () => this.reset();
    // No long-press menus, text selection or page zoom on the controls.
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    // The saboteur's tools and the gear list: tap a row for its number key.
    document.getElementById('tools')!.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-key]');
      if (row && this.input.locked) this.input.onDigit(Number(row.dataset.key));
    });
  }

  /** Shows the buttons that fit what the player is doing. Call once per frame. */
  update(ctx: TouchContext): void {
    const key = JSON.stringify(ctx);
    if (key === this.shown) return;
    this.shown = key;
    const show = (name: string, on: boolean) => {
      const b = this.buttons.get(name);
      if (b) b.hidden = !on;
    };
    this.buttons.get('use')!.textContent = useLabel(ctx.holding);
    show('pull', !ctx.holding);
    show('rotate', ctx.holding);
    show('flip', ctx.flip);
    show('drop', ctx.holding);
    show('throw', ctx.holding);
    show('show', ctx.page);
    show('dropPage', ctx.page);
    show('chat', ctx.others);
    show('talk', ctx.talk);
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && !this.input.touch) return;
    e.preventDefault();
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-touch]');
    if (button) return this.press(button, e);
    this.el.setPointerCapture(e.pointerId);
    // The left part of the screen is the stick's, the rest is for looking.
    if (!this.stickTouch && e.clientX < this.el.clientWidth * 0.42) {
      this.stickTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.stick.classList.add('active');
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.moveStick(0, 0);
      return;
    }
    this.looks.set(e.pointerId, {
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      // When the finger went down, not when a busy frame got round to it.
      at: e.timeStamp,
      moved: false,
    });
  }

  private move(e: PointerEvent): void {
    if (this.input.driven) return;
    if (this.stickTouch?.id === e.pointerId) {
      this.moveStick(e.clientX - this.stickTouch.x, e.clientY - this.stickTouch.y);
      return;
    }
    const look = this.looks.get(e.pointerId);
    if (!look) return;
    if (Math.hypot(e.clientX - look.x0, e.clientY - look.y0) > TAP_SLOP) look.moved = true;
    this.input.look(e.clientX - look.x, e.clientY - look.y);
    look.x = e.clientX;
    look.y = e.clientY;
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    const button = this.held.get(e.pointerId);
    if (button) {
      this.held.delete(e.pointerId);
      this.release(button);
      return;
    }
    if (this.stickTouch?.id === e.pointerId) {
      this.stickTouch = null;
      this.stick.classList.remove('active', 'sprint');
      this.stick.style.left = '';
      this.stick.style.top = '';
      this.knob.style.transform = '';
      Object.assign(this.input.pad, { forward: 0, right: 0, sprint: false });
      return;
    }
    const look = this.looks.get(e.pointerId);
    if (!look) return;
    this.looks.delete(e.pointerId);
    if (!cancelled && !look.moved && e.timeStamp - look.at < TAP_MS) this.handlers.tap();
  }

  /** Moves the knob by the finger's offset from where it went down, and walks that way. */
  private moveStick(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    const k = dist > STICK_RADIUS ? STICK_RADIUS / dist : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const sprint = dist > STICK_RADIUS * SPRINT_PAST;
    this.stick.classList.toggle('sprint', sprint);
    Object.assign(this.input.pad, {
      forward: (-dy * k) / STICK_RADIUS,
      right: (dx * k) / STICK_RADIUS,
      sprint,
    });
  }

  private press(button: HTMLButtonElement, e: PointerEvent): void {
    if (this.input.driven) return;
    const name = button.dataset.touch!;
    button.classList.add('down');
    this.held.set(e.pointerId, button);
    this.el.setPointerCapture(e.pointerId);
    const act = (action: Action) => this.input.act(action);
    switch (name) {
      case 'jump':
        this.input.pad.jump = true;
        break;
      case 'talk':
        this.handlers.talk(true);
        break;
      case 'use':
        act({ kind: this.input.holding() ? 'place' : 'grab' });
        this.input.pressUse();
        break;
      case 'pull':
        act({ kind: 'pull' });
        break;
      case 'rotate':
        act({ kind: 'rotate' });
        break;
      case 'flip':
        act({ kind: 'flip' });
        break;
      case 'drop':
        act({ kind: 'drop' });
        break;
      case 'throw':
        act({ kind: 'throw' });
        break;
      case 'dropPage':
        act({ kind: 'dropPage' });
        break;
      case 'careful': {
        const on = !this.input.pad.careful;
        this.input.pad.careful = on;
        this.careful.setAttribute('aria-pressed', String(on));
        break;
      }
      case 'view':
        this.input.state.firstPerson = !this.input.state.firstPerson;
        break;
      case 'read':
        this.handlers.read();
        break;
      case 'show':
        this.handlers.show();
        break;
      case 'chat':
        this.handlers.chat();
        break;
      case 'help':
        this.handlers.help();
        break;
      case 'fullscreen':
        this.handlers.fullscreen();
        break;
    }
  }

  private release(button: HTMLButtonElement): void {
    button.classList.remove('down');
    const name = button.dataset.touch;
    if (name === 'jump') this.input.pad.jump = false;
    if (name === 'use') this.input.pad.use = false;
    if (name === 'talk') this.handlers.talk(false);
  }

  /** Lets go of everything, as when play stops for a menu. */
  reset(): void {
    for (const b of this.held.values()) this.release(b);
    this.held.clear();
    this.looks.clear();
    if (this.stickTouch) {
      this.stickTouch = null;
      this.stick.classList.remove('active', 'sprint');
      this.knob.style.transform = '';
    }
  }
}
