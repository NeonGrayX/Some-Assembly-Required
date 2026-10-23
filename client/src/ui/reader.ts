import { litAt, pageName, pageNumber, viewDir } from '@sar/shared';
import type { Beam, Player, PrintedPage, TargetBuild, Vec3 } from '@sar/shared';
import { gameNow } from '../clock.ts';
import type { Hint } from '../hints.ts';
import type { ClientGame } from '../net/game.ts';

const TOO_DARK = 'Too dark to read here. Take it outside, or get the headlamp’s beam on it.';
/** How long a page someone held up for us stays open (ms). */
const SHOWN_MS = 10000;

/** Every headlamp's beam: from its wearer's eye, the way they look. */
function beams(g: ClientGame): Beam[] {
  return [...g.sim.players.values()]
    .filter((p) => p.gear.has('headlamp'))
    .map((p) => ({ eye: g.sim.eye(p), dir: viewDir(p.input.yaw, p.input.pitch) }));
}

/** Whether a page at `at` can be read: not in a gear hunt's dark house, except in a beam. */
function canRead(g: ClientGame, at: Vec3): boolean {
  if (g.mode !== 'gear') return true;
  return litAt(g.sim.level, at, g.night, g.sim.power.on, beams(g));
}

/** What the reader shows: the page in the pocket, one held up by someone, or one lying there. */
type Reading = 'pocket' | 'shown' | `page:${number}`;

/** The page reader, a page held up close, and the page in the player's pocket in the corner. */
export class PageReader {
  /** What the reader shows, while it is open. */
  private shows: Reading | null = null;
  /** The page in the pocket, and its version, as drawn in the corner. */
  private shownPocket: string | null = null;
  /** When the page someone last held up for us was held up. */
  private shownAt = 0;

  constructor(
    readonly el: HTMLElement,
    private readonly pocketEl: HTMLElement,
    /** Art for what is printed on a page. */
    private readonly art: (printed: PrintedPage | null) => HTMLCanvasElement,
    /** This round's model, for its number of steps. */
    private readonly target: () => TargetBuild,
    private readonly notice: (text: string | Hint) => void,
  ) {}

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** Opens the reader on a page, with an optional line saying where it came from. */
  private open(art: HTMLCanvasElement, shows: Reading, caption = ''): void {
    const big = document.createElement('canvas');
    big.width = art.width;
    big.height = art.height;
    big.getContext('2d')!.drawImage(art, 0, 0);
    const label = document.createElement('div');
    label.className = 'caption';
    label.textContent = caption;
    this.el.replaceChildren(...(caption ? [label] : []), big);
    this.el.classList.remove('hidden');
    this.shows = shows;
  }

  close(): void {
    this.el.classList.add('hidden');
    this.shows = null;
  }

  /** The page art changed (the colour-blind goggles): everything is drawn again. */
  redraw(): void {
    this.shownPocket = null;
    if (this.shows) this.close();
  }

  /** Draws the pocket again next time, a new round's house or not. */
  forget(): void {
    this.shownPocket = null;
  }

  /** Q reads the page you are looking at (wherever it lies), otherwise the one in your pocket. */
  toggle(g: ClientGame | null): void {
    const me = g?.me;
    if (!g || !me || this.isOpen) return this.close();
    const hit = g.sim.sight.aim(me);
    const aimed = hit?.owner.kind === 'page' ? g.sim.pages.get(hit.owner.pageId) : undefined;
    if (aimed) {
      const at = aimed.body?.translation() ?? me.body.translation();
      if (!canRead(g, at)) return this.notice(TOO_DARK);
      this.open(this.art(aimed.printed), `page:${aimed.id}`, 'Reading it where it lies');
    } else if (me.page !== null) {
      const page = g.sim.pages.get(me.page);
      if (page) {
        if (!canRead(g, me.body.translation())) return this.notice(TOO_DARK);
        this.open(this.art(page.printed), 'pocket');
      }
    }
  }

  update(g: ClientGame): void {
    this.updateShown(g);
    const me = g.me;
    if (!me) return;
    // A page open in the reader shuts when the dark closes in (the lamp wearer walked off).
    if (this.shows && this.shows !== 'shown' && !canRead(g, me.body.translation())) {
      this.close();
      this.notice(TOO_DARK);
    }
    this.updatePocket(g, me);
  }

  /** Someone held up a page for us: show it for a while. */
  private updateShown(g: ClientGame): void {
    const s = g.shown;
    if (s && s.at !== this.shownAt) {
      this.shownAt = s.at;
      const what = pageName(s.printed);
      if (g.me && !canRead(g, g.me.body.translation())) {
        this.notice(`${g.nameOf(s.from)} shows you ${what}, but it is too dark to see it.`);
        return;
      }
      this.open(this.art(s.printed), 'shown', `${g.nameOf(s.from)} shows you ${what}`);
    }
    if (this.shows === 'shown' && s && gameNow() - s.at > SHOWN_MS) this.close();
  }

  private updatePocket(g: ClientGame, me: Player): void {
    // Redraw when the pocket changes or the page in it is reprinted (forged).
    const key = me.page === null ? null : `${me.page}:${g.sim.pages.get(me.page)?.version}`;
    if (key === this.shownPocket) return;
    this.shownPocket = key;
    const page = me.page === null ? undefined : g.sim.pages.get(me.page);
    const { pocketEl } = this;
    pocketEl.classList.toggle('hidden', !page);
    if (this.shows === 'pocket') {
      if (page) this.open(this.art(page.printed), 'pocket');
      else this.close();
    }
    if (!page) return;
    const art = this.art(page.printed);
    pocketEl.querySelector('.title')!.textContent = !page.printed
      ? 'A page (only the reader can read it)'
      : page.step < 0
        ? 'Master index'
        : `Page ${pageNumber(page.printed)} of ${this.target().steps.length}`;
    pocketEl.querySelector('canvas')!.getContext('2d')!.drawImage(art, 0, 0, 90, 126);
  }
}
