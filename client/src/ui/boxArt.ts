import { RANDOM_BUILD, buildById } from '@sar/shared';
import type { TargetBuild } from '@sar/shared';
import type { ClientGame } from '../net/game.ts';
import type { PagePrinter } from '../render/pages.ts';
import { printsVersion } from '../render/prints.ts';
import { view } from '../worldView.ts';
import { setText } from './dom.ts';

/**
 * Box art in the corner, so everyone knows what they are building. In the lobby it shows the
 * host's pick for the next round, or a question mark when the round picks one at random.
 */
export class BoxArt {
  /** The build whose art is shown (null for the question mark); undefined before the first. */
  private shown: TargetBuild | null | undefined;
  private shownGrey = false;
  private shownPrints = -1;
  private shownFree = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly printer: PagePrinter,
    /** This round's build in its design colours. */
    private readonly design: () => TargetBuild,
  ) {}

  /** Shows the art for `g` (null: no game), drawn again only when what it shows changed. */
  update(g: ClientGame | null): void {
    const { el } = this;
    const next = g?.phase === 'lobby' ? g.lobby.build : null;
    const build = next === RANDOM_BUILD ? null : (buildById(next ?? '') ?? this.design());
    // A free build has no box art: there is nothing to build but what you like.
    const free = (g?.phase === 'lobby' ? g.lobby.mode : g?.mode) === 'free';
    if (
      build === this.shown &&
      free === this.shownFree &&
      view.colourBlind === this.shownGrey &&
      printsVersion() === this.shownPrints
    )
      return;
    this.shown = build;
    this.shownFree = free;
    this.shownGrey = view.colourBlind;
    this.shownPrints = printsVersion();
    el.classList.toggle('free', free);
    if (free) {
      setText(el.querySelector('.eyebrow')!, 'Free build');
      setText(el.querySelector('.name')!, 'Build anything');
      setText(
        el.querySelector('small')!,
        'No plans and no clock. Esc, then Export build, saves it as a build file. Done twice ends the session.',
      );
      return;
    }
    setText(el.querySelector('.eyebrow')!, 'Build this');
    setText(
      el.querySelector('small')!,
      "Colours change every round: the hidden pages and the master index show this round's.",
    );
    el.querySelector('.name')!.textContent = build?.name ?? 'a surprise build';
    const ctx = el.querySelector('canvas')!.getContext('2d')!;
    ctx.clearRect(0, 0, 160, 160);
    if (build) {
      ctx.drawImage(this.printer.boxArt(build), 0, 0, 160, 160);
    } else {
      ctx.fillStyle = '#5c5f62';
      ctx.font = 'bold 110px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 80, 86);
    }
  }
}
