/** Which screen the app is on: the main menu, a game (lobby, round or demo), or the editor. */
export type Screen = 'menu' | 'game' | 'editor';

const HELP_KEY = 'sar.helpHidden';
/** How long "Leave the room?" waits for the second click, in ms. */
const ARM_MS = 3000;

/** What the way back to the main menu leaves: a room or a game asks first, the rest does not. */
export type Leaving = 'room' | 'game' | null;

/**
 * The bar in the top right corner, the same on every screen: where you are, Settings, and the
 * way back to the main menu. In a game it also resumes play and shows or hides How to play.
 * While the game has the mouse it shrinks to a reminder that Esc brings it back, or on a touch
 * screen to a Menu button.
 */
export class AppBar {
  private readonly el = document.getElementById('appbar')!;
  private readonly where = this.el.querySelector<HTMLElement>('.where')!;
  private readonly leaveBtn = this.el.querySelector<HTMLButtonElement>('.leave')!;
  private readonly helpBtn = this.el.querySelector<HTMLButtonElement>('.help-toggle')!;
  private readonly help = document.getElementById('help')!;
  private screen: Screen = 'menu';
  private armedUntil = 0;
  /** What leaving would leave, if it needs a second click (in a game). */
  private leaving: Leaving = null;

  constructor(handlers: { resume: () => void; pause: () => void; leave: () => void }) {
    this.el.querySelector('.resume')!.addEventListener('click', handlers.resume);
    // On a touch screen there is no Esc: this stops play and brings the bar back.
    this.el.querySelector('.pause')!.addEventListener('click', handlers.pause);
    this.helpBtn.addEventListener('click', () => this.setHelp(this.helpHidden));
    this.leaveBtn.addEventListener('click', () => {
      // Leaving a game loses the round, so the first click only asks. Whether it asked goes by
      // what the button shows, so a click on "Leave the game?" always leaves.
      // `set` runs every frame, so the button goes back to "Main menu" once the time is up.
      if (this.leaving && !this.leaveBtn.classList.contains('armed')) {
        this.armedUntil = performance.now() + ARM_MS;
        this.showLeave();
        return;
      }
      this.armedUntil = 0;
      this.showLeave();
      handlers.leave();
    });
    this.setHelp(!helpHiddenBefore());
    this.set('menu', '');
  }

  /**
   * Moves the bar to a screen, with a short label of where you are and what leaving it would
   * leave. Called every frame.
   */
  set(screen: Screen, where: string, leaving: Leaving = null): void {
    if (screen !== this.screen) this.armedUntil = 0;
    this.screen = screen;
    this.leaving = leaving;
    if (document.body.dataset.screen !== screen) document.body.dataset.screen = screen;
    if (this.where.textContent !== where) this.where.textContent = where;
    if (this.where.hidden !== !where) this.where.hidden = !where;
    this.showLeave();
  }

  private get armed(): boolean {
    return performance.now() < this.armedUntil;
  }

  private showLeave(): void {
    const label = this.armed && this.leaving ? `Leave the ${this.leaving}?` : 'Main menu';
    if (this.leaveBtn.textContent !== label) this.leaveBtn.textContent = label;
    this.leaveBtn.classList.toggle('armed', this.armed);
  }

  /**
   * How to play has two switches: shown or hidden while the mouse is free (the How to play
   * button; remembered), and pinned on screen while playing too (H).
   */
  toggleHelpPinned(): void {
    this.help.classList.toggle('pinned');
  }

  unpinHelp(): void {
    this.help.classList.remove('pinned');
  }

  /** Puts How to play away until it is asked for again, with H or the How to play button. */
  closeHelp(): void {
    this.unpinHelp();
    this.setHelp(false);
  }

  get helpHidden(): boolean {
    return document.body.classList.contains('help-hidden');
  }

  /** Shows or hides How to play while the mouse is free; remembered on this device. */
  setHelp(shown: boolean): void {
    document.body.classList.toggle('help-hidden', !shown);
    this.helpBtn.setAttribute('aria-pressed', String(shown));
    try {
      localStorage.setItem(HELP_KEY, shown ? '' : '1');
    } catch {
      // Storage can be blocked; it just is not remembered then.
    }
  }
}

/**
 * Whether How to play was hidden on an earlier visit. On a phone it would cover the whole
 * screen, so there it starts hidden, a tap on How to play away.
 */
function helpHiddenBefore(): boolean {
  const small = matchMedia('(max-width: 600px), (max-height: 500px)').matches;
  try {
    const saved = localStorage.getItem(HELP_KEY);
    return saved === null ? small : saved === '1';
  } catch {
    return small;
  }
}
