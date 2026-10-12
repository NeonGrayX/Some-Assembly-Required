import { COLOURS, PRINT_SIDES, shapeName } from '@sar/shared';
import type { Action, BrickTypeId, ColourId, PrintJob } from '@sar/shared';
import { freeMouse } from '../input.ts';
import { drawnHex } from '../render/bricks.ts';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

/**
 * The brick works' choices that are too many for clicks in the world: which colour of pellets
 * the silo fills a bucket with, and which picture the UV printer prints on the part on its bed.
 * A dialog of big buttons, so a finger picks as easily as the mouse; picking queues the action
 * and goes back into the game, Esc or Cancel just goes back.
 */
export class MachinePicker {
  private readonly root = document.getElementById('picker')!;
  private readonly title = this.root.querySelector('h2')!;
  private readonly sub = this.root.querySelector<HTMLElement>('.sub')!;
  private readonly choices = this.root.querySelector<HTMLElement>('.choices')!;

  constructor(
    private readonly act: (a: Action) => void,
    private readonly relock: () => void,
  ) {
    this.root.querySelector('.cancel')!.addEventListener('click', () => this.close(true));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close(true);
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /**
   * The silo's colours. Without the colour goggles (a gear hunt) the swatches are all the one
   * grey and go by number, as the bricks do.
   */
  openColours(colours: ColourId[], colourBlind: boolean): void {
    this.show(
      'Pellet silo',
      'Pick a colour: your bucket fills with its pellets. Pour them into a moulding machine.',
    );
    colours.forEach((colour, i) => {
      const name = colourBlind ? `Pellets ${i + 1}` : colour.replaceAll('-', ' ');
      const swatch = el('span', 'swatch');
      swatch.style.background = `#${drawnHex(colour).toString(16).padStart(6, '0')}`;
      if (COLOURS[colour].alpha && !colourBlind) swatch.classList.add('clear');
      this.choice([swatch, el('span', 'name', name)], name, { kind: 'fill', colour });
    });
  }

  /**
   * The UV printer's pictures for the part on its bed: the printed parts of this round's model
   * of the same type, each with its pictures side by side; or take the part out as it is.
   */
  openPrints(
    type: BrickTypeId,
    jobs: { job: PrintJob; index: number }[],
    svgs: Record<string, string>,
  ): void {
    const part = shapeName(type);
    this.show(
      'UV printer',
      jobs.length
        ? `Pick a print for the ${part} on the bed. It prints, then comes out into your hands.`
        : `Nothing in this model is printed on a ${part}. Take it out as it is.`,
    );
    for (const { job, index } of jobs) {
      const parts: HTMLElement[] = [];
      for (const side of PRINT_SIDES) {
        const name = job.prints[side];
        const svg = name ? svgs[name] : undefined;
        if (!name || !svg) continue;
        const figure = el('span', 'print');
        const img = document.createElement('img');
        img.alt = name;
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        figure.append(img, el('span', 'side', side));
        parts.push(figure);
      }
      const label = `Print ${PRINT_SIDES.filter((s) => job.prints[s])
        .map((s) => `${job.prints[s]} on the ${s}`)
        .join(', ')}`;
      this.choice(parts, label, { kind: 'print', job: index });
    }
    this.choice([el('span', 'name', 'Take it out unprinted')], 'Take it out unprinted', {
      kind: 'print',
      job: -1,
    });
  }

  close(relock: boolean): void {
    if (!this.isOpen) return;
    this.root.classList.add('hidden');
    this.choices.replaceChildren();
    if (relock) this.relock();
  }

  private show(title: string, sub: string): void {
    freeMouse();
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.choices.replaceChildren();
    this.root.classList.remove('hidden');
  }

  private choice(content: HTMLElement[], label: string, action: Action): void {
    const button = el('button', 'btn choice');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(...content);
    button.addEventListener('click', () => {
      this.act(action);
      this.close(true);
    });
    this.choices.append(button);
  }
}
