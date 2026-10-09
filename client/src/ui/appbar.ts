/** Which screen the app is on: the main menu, a game (lobby, round or demo), or the editor. */
export type Screen = 'menu' | 'game' | 'editor';

const HELP_KEY = 'sar.helpHidden';
/** How long "Leave the room?" waits for the second click, in ms. */
const ARM_MS = 3000;

/**
 * The bar in the top right corner, the same on every screen: where you are, Settings, and the
 * way back to the main menu. In a game it also resumes play and shows or hides How to play.
 * While the game has the mouse it shrinks to a reminder that Esc brings it back.
 */
export class AppBar {
  private readonly el = document.getElementById('appbar')!;
  private readonly where = this.el.querySelector<HTMLElement>('.where')!;
  private readonly leaveBtn = this.el.querySelector<HTMLButtonElement>('.leave')!;
  private readonly helpBtn = this.el.querySelector<HTMLButtonElement>('.help-toggle')!;
  private screen: Screen = 'menu';
  private armedUntil = 0;
  /** Whether leaving needs a second click: set while in a game. */
  private confirmLeave = false;

  constructor(handlers: { resume: () => void; leave: () => void }) {
    this.el.querySelector('.resume')!.addEventListener('click', handlers.resume);
    this.helpBtn.addEventListener('click', () => this.setHelp(this.helpHidden));
    this.leaveBtn.addEventListener('click', () => {
      // Leaving a game loses the round, so the first click only asks. Whether it asked goes by
      // what the button shows, so a click on "Leave the game?" always leaves.
      if (this.confirmLeave && !this.leaveBtn.classList.contains('armed')) {
        this.armedUntil = performance.now() + ARM_MS;
        this.showLeave();
        setTimeout(() => this.showLeave(), ARM_MS + 50);
        return;
      }
      this.armedUntil = 0;
      this.showLeave();
      handlers.leave();
    });
    this.setHelp(!helpHiddenBefore());
    this.set('menu', '');
  }

  /** Moves the bar to a screen, with a short label of where you are. */
  set(screen: Screen, where: string, confirmLeave = false): void {
    if (screen !== this.screen) this.armedUntil = 0;
    this.screen = screen;
    this.confirmLeave = confirmLeave;
    document.body.dataset.screen = screen;
    if (this.where.textContent !== where) this.where.textContent = where;
    this.where.hidden = !where;
    this.showLeave();
  }

  private get armed(): boolean {
    return performance.now() < this.armedUntil;
  }

  private showLeave(): void {
    const label = this.armed
      ? this.where.textContent?.startsWith('Room')
        ? 'Leave the room?'
        : 'Leave the game?'
      : 'Main menu';
    if (this.leaveBtn.textContent !== label) this.leaveBtn.textContent = label;
    this.leaveBtn.classList.toggle('armed', this.armed);
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

/** Whether How to play was hidden on an earlier visit. */
function helpHiddenBefore(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return false;
  }
}
