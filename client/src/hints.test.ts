import { describe, expect, it } from 'vitest';
import { KEY_LABELS, sayHint, touchLabels } from './hints.ts';
import type { Hint } from './hints.ts';

describe('sayHint', () => {
  const held: Hint = [
    { control: 'use', text: 'snap' },
    { control: 'rotate', text: 'rotate' },
    { control: 'drop', text: 'drop' },
    { control: 'throw', text: 'throw' },
  ];

  it('names keys and mouse buttons at a computer', () => {
    expect(sayHint(held, KEY_LABELS)).toBe('Click: snap · R: rotate · G: drop · T: throw');
  });

  it('names the buttons on a touch screen, once when the button says it all', () => {
    expect(sayHint(held, touchLabels('Place'))).toBe('Place: snap · Rotate · Drop · Throw');
  });

  it('puts a control into a sentence', () => {
    const hint: Hint = [
      { before: 'Rubbish bin: ', control: 'click', after: ' it with a brick in hand' },
      'plain words',
      { before: 'You put on the leash. ', control: { gear: 3 }, after: ': take it off' },
    ];
    expect(sayHint(hint, KEY_LABELS)).toBe(
      'Rubbish bin: click it with a brick in hand · plain words · You put on the leash. 3: take it off',
    );
    expect(sayHint(hint, touchLabels('Use'))).toBe(
      'Rubbish bin: tap it with a brick in hand · plain words · You put on the leash. Gear 3: take it off',
    );
  });

  it('says the tamper tool and the careful lift on a touch screen', () => {
    const hint: Hint = [
      'Electrical panel',
      { control: 'tamper', text: 'tamper with it' },
      { control: 'carefulUse', text: 'lift the heavy build' },
    ];
    expect(sayHint(hint, KEY_LABELS)).toBe(
      'Electrical panel · 5: tamper with it · Hold Ctrl and click: lift the heavy build',
    );
    expect(sayHint(hint, touchLabels('Use'))).toBe(
      'Electrical panel · Tool 5: tamper with it · Turn on Careful, then Use: lift the heavy build',
    );
  });
});
