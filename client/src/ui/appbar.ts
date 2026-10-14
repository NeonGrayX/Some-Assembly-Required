/**
 * Which screen the app is on: the main menu's cover, a page off it (the room list, shared
 * builds, the benchmark's pages), a game (lobby, round or demo), or the editor.
 */
export type Screen = 'menu' | 'page' | 'game' | 'editor';

/** How long a button that asks first ("Leave the room?") waits for the second click, in ms. */
const ARM_MS = 3000;

/** What the way back to the main menu leaves: a room or a game asks first, the rest does not. */
export type Leaving = 'room' | 'game' | null;

/**
 * The bar in the top right corner, the same on every screen: where you are, Settings, and in
 * the corner itself the way back, always in the same place: Back on a page off the main menu,
 * Main menu in a game or the editor. In a game it also resumes play, and lets the host end the
 * round for everyone. While the game has the mouse it shrinks to a reminder that Esc brings it
 * back, or on a touch screen to a Menu button.
 */
export class AppBar {
  private readonly el = document.getElementById('appbar')!;
  private readonly where = this.el.querySelector<HTMLElement>('.where')!;
  private readonly leaveBtn = this.el.querySelector<HTMLButtonElement>('.leave')!;
  private readonly endBtn = this.el.querySelector<HTMLButtonElement>('.end-round')!;
  private screen: Screen = 'menu';
  /** The button waiting for its second click, until `armedUntil`. */
  private armedBtn: HTMLButtonElement | null = null;
  private armedUntil = 0;
  /** What leaving would leave, if it needs a second click (in a game). */
  private leaving: Leaving = null;

  constructor(handlers: {
    resume: () => void;
    pause: () => void;
    leave: () => void;
    /** Back from a page off the main menu. */
    back: () => void;
    /** The host ends the round, for everyone. */
    endRound: () => void;
  }) {
    this.el.querySelector('.resume')!.addEventListener('click', handlers.resume);
    // On a touch screen there is no Esc: this stops play and brings the bar back.
    this.el.querySelector('.pause')!.addEventListener('click', handlers.pause);
    this.leaveBtn.addEventListener('click', () => {
      if (this.screen === 'page') return handlers.back();
      // Leaving a game loses the round, so the first click only asks.
      if (this.leaving && !this.askFirst(this.leaveBtn)) return;
      handlers.leave();
    });
    this.endBtn.addEventListener('click', () => {
      if (this.askFirst(this.endBtn)) handlers.endRound();
    });
    this.set('menu', '');
  }

  /**
   * Moves the bar to a screen, with a short label of where you are and what leaving it would
   * leave, and whether End round is offered. Called every frame.
   */
  set(screen: Screen, where: string, leaving: Leaving = null, canEnd = false): void {
    if (screen !== this.screen) this.armedUntil = 0;
    this.screen = screen;
    this.leaving = leaving;
    if (document.body.dataset.screen !== screen) document.body.dataset.screen = screen;
    if (this.where.textContent !== where) this.where.textContent = where;
    if (this.where.hidden !== !where) this.where.hidden = !where;
    if (this.endBtn.classList.contains('hidden') === canEnd) {
      this.endBtn.classList.toggle('hidden', !canEnd);
      if (!canEnd && this.armedBtn === this.endBtn) this.armedUntil = 0;
    }
    this.label(this.leaveBtn, screen === 'page' ? 'Back' : 'Main menu', `Leave the ${leaving}?`);
    this.label(this.endBtn, 'End round', 'End it for everyone?');
  }

  /**
   * Whether a click on a button that asks first goes ahead: the first click only arms it (its
   * label asks), and a click while it asks goes ahead. Whether it asked goes by what the
   * button shows, so a click on the question always counts.
   */
  private askFirst(btn: HTMLButtonElement): boolean {
    if (btn.classList.contains('armed')) {
      this.armedUntil = 0;
      this.label(btn, '', '');
      return true;
    }
    this.armedBtn = btn;
    this.armedUntil = performance.now() + ARM_MS;
    return false;
  }

  /** Shows a button's label, or its question while it is armed. */
  private label(btn: HTMLButtonElement, plain: string, question: string): void {
    const armed = this.armedBtn === btn && performance.now() < this.armedUntil;
    const text = armed ? question : plain;
    if (text && btn.textContent !== text) btn.textContent = text;
    btn.classList.toggle('armed', armed);
  }
}
