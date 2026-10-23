import { withoutColours } from '@sar/shared';
import type { InspectionReport, Player } from '@sar/shared';
import type { ClientGame } from '../net/game.ts';

/** The inspector's full report, shown near the inspector or when pinned with I. */
export class ReportPanel {
  /** Whether it shows wherever the player is (I). */
  pinned = false;
  private shown: InspectionReport | null = null;
  private shownKey: string | null = null;

  constructor(private readonly el: HTMLElement) {}

  /** Draws it again next time, a new round's house or not. */
  forget(): void {
    this.shown = null;
  }

  update(g: ClientGame, me: Player): void {
    const { el } = this;
    const report = g.myInspector?.report ?? null;
    const pad = g.sim.sites[g.mySite]!.inspector.pos;
    const p = me.body.translation();
    const near = Math.hypot(p.x - pad.x, p.z - pad.z) < 4.5;
    el.classList.toggle(
      'hidden',
      !report || !(near || this.pinned) || g.round?.phase !== 'building',
    );
    const reportKey = report && `${g.colourBlind}`;
    if (!report || (report === this.shown && reportKey === this.shownKey)) return;
    this.shown = report;
    this.shownKey = reportKey;
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rows = report.steps.map((s, i) => {
      const head =
        s.verdict === 'empty'
          ? `<span class="muted">not started</span>`
          : `<span class="${s.verdict}">${s.correct} of ${s.total} correct</span>`;
      const text = (t: string) => esc(g.colourBlind ? withoutColours(t) : t);
      const lines = s.lines.map((l) => `<li class="${l.kind}">${text(l.text)}</li>`).join('');
      return `<h4>Step ${i + 1} · ${head}</h4>${lines ? `<ul>${lines}</ul>` : ''}`;
    });
    if (report.extras.length) {
      rows.push(
        `<h4>Not in the plans</h4><ul>${report.extras.map((l) => `<li class="extra">${esc(g.colourBlind ? withoutColours(l.text) : l.text)}</li>`).join('')}</ul>`,
      );
    }
    el.innerHTML =
      `<h3>Inspection report: ${report.correct} of ${report.total} bricks correct</h3>` +
      `<p class="muted">Problems are marked on the build until you fix them. I: pin this list.</p>` +
      rows.join('');
  }
}
