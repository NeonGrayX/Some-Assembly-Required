type Tab = 'lobby' | 'demo' | 'help';

const TABS: readonly Tab[] = ['lobby', 'demo', 'help'];
/** Whether How to play was folded away; the key it had as a panel of its own. */
const HELP_FOLDED_KEY = 'sar.helpHidden';

/**
 * The one place a game's panels open: on the left under the box art, a tab for each one there
 * is (the lobby, or the demo's choices, and How to play), and a button that folds the dock to
 * its tabs. It shows while the mouse is free; while playing, H pins How to play on screen.
 * The lobby and demo panels say themselves whether they are up (their `hidden` class).
 */
export class Dock {
  private readonly el = document.getElementById('dock')!;
  private readonly fold = this.el.querySelector<HTMLButtonElement>('.fold')!;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private selected: Tab = 'help';
  private folded = false;
  private pinned = false;
  /** The tabs there were when last looked at. */
  private offered = '';

  constructor() {
    for (const tab of TABS) {
      const btn = this.el.querySelector<HTMLButtonElement>(`[data-tab='${tab}']`)!;
      this.tabs.set(tab, btn);
      this.panes.set(tab, document.getElementById(btn.getAttribute('aria-controls')!)!);
      btn.addEventListener('click', () => this.open(tab));
    }
    this.fold.addEventListener('click', () => {
      this.folded = !this.folded;
      if (this.selected === 'help') saveHelpFolded(this.folded);
      this.show();
    });
    // Arrow keys move along the tabs, as in Settings.
    this.el.querySelector('.dock-tabs')!.addEventListener('keydown', (e) => {
      const key = (e as KeyboardEvent).key;
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      const open = this.available();
      const at = open.indexOf(this.selected);
      const next = open[(at + (key === 'ArrowRight' ? 1 : open.length - 1)) % open.length]!;
      this.open(next);
      this.tabs.get(next)!.focus();
    });
  }

  /** Opens a tab (unfolding the dock). */
  open(tab: Tab): void {
    this.selected = tab;
    this.folded = false;
    if (tab === 'help') saveHelpFolded(false);
    this.show();
  }

  /** H while playing: How to play stays on screen, or goes again. */
  togglePinned(): void {
    this.pinned = !this.pinned;
    this.show();
  }

  unpin(): void {
    this.pinned = false;
    this.show();
  }

  /** The tabs there are now: lobby or demo first (when up), then How to play. */
  private available(): Tab[] {
    const up = (tab: Tab) => !this.panes.get(tab)!.classList.contains('hidden');
    const demo = document.body.classList.contains('demo');
    return TABS.filter((t) => t === 'help' || (t === 'demo' ? up(t) : up(t) && !demo));
  }

  /** Called every frame: follows the lobby and demo panels coming and going. */
  update(): void {
    const open = this.available();
    const key = open.join();
    if (key === this.offered) return;
    this.offered = key;
    // Something new to show (the lobby after a round, say): it opens on the first tab, and
    // the lobby or the demo's choices always unfold, since they hold the way to start.
    this.selected = open[0]!;
    this.folded = this.selected === 'help' && helpFoldedBefore();
    for (const tab of TABS) this.tabs.get(tab)!.hidden = !open.includes(tab);
    this.show();
  }

  private show(): void {
    const tab = this.pinned ? 'help' : this.selected;
    const folded = this.folded && !this.pinned;
    this.el.classList.toggle('hidden', false);
    this.el.classList.toggle('folded', folded);
    this.el.classList.toggle('pinned', this.pinned);
    for (const t of TABS) {
      const on = t === tab;
      const btn = this.tabs.get(t)!;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      this.panes.get(t)!.hidden = !on;
    }
    this.fold.setAttribute('aria-expanded', String(!folded));
    const label = folded ? 'Show the panel' : 'Hide the panel';
    this.fold.setAttribute('aria-label', label);
    this.fold.title = label;
  }
}

function saveHelpFolded(folded: boolean): void {
  try {
    localStorage.setItem(HELP_FOLDED_KEY, folded ? '1' : '');
  } catch {
    // Storage can be blocked; it just is not remembered then.
  }
}

/**
 * Whether How to play was folded away on an earlier visit. On a phone it would cover much of
 * the screen, so there it starts folded, a tap on its tab away.
 */
function helpFoldedBefore(): boolean {
  const small = matchMedia('(max-width: 600px), (max-height: 500px)').matches;
  try {
    const saved = localStorage.getItem(HELP_FOLDED_KEY);
    return saved === null ? small : saved === '1';
  } catch {
    return small;
  }
}
