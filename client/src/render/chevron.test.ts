import { describe, expect, it } from 'vitest';
import { MAPS } from '@sar/shared';
import { DEMO_PAGE } from '../carscene/jobsite.ts';
import { buildScenery } from './chevron.ts';

const chevron = MAPS.find((m) => m.id === 'chevron')!;

describe('Chevron Street’s scenery', () => {
  it('leaves the corkboards bare for the round’s own pages', { timeout: 60000 }, () => {
    const level = chevron.layout(1);
    const view = buildScenery(level, level.scenery!);
    let pages = 0;
    view.root.traverse((o) => {
      if (o.name === DEMO_PAGE) pages++;
    });
    expect(pages).toBe(0);
  });
});
