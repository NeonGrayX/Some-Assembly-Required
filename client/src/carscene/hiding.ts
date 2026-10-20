import type * as THREE from 'three';
import type { HideoutKind } from '@sar/shared';
import { Toggle, gadgetsIn } from './gadgets.ts';
import type { Gadget } from './gadgets.ts';

/** What each kind of the scene's doors and lids hides pages as in the game, by what a click does. */
export const HIDING: Record<string, HideoutKind> = {
  'open the cupboard': 'cabinet',
  'open the cabinet': 'cabinet',
  'open the freezer': 'cabinet',
  'open the fridge': 'fridge',
  'open the wardrobe': 'locker',
  'open the letterbox': 'mailbox',
  'open the portaloo': 'portaloo',
  'lift the manhole cover': 'rug',
};

/**
 * The scene's own doors and lids that hide pages in the game, in the order Chevron Street
 * numbers its hiding places (the first is #1), each with the kind it hides pages as.
 */
export function hidingToggles(root: THREE.Object3D): { toggle: Toggle; kind: HideoutKind }[] {
  return gadgetsIn(root).flatMap((g) => {
    const kind = g instanceof Toggle && g.handles[0] ? HIDING[g.hint()] : undefined;
    return kind ? [{ toggle: g as Toggle, kind }] : [];
  });
}

/**
 * What a click does on what the game has its own of (its bins, bell and Done button, and the
 * power cabinet, which is its electrical panel), which the scene's are not clicked in place of.
 */
const THE_GAMES = new Set([
  'open the bin',
  'ring the bell',
  'press Done',
  'open the power cabinet',
  'switch off the power',
]);

/**
 * The rest of the scene's things a click works (the lamps, the taps, the hob, the oven, the
 * screens, the crossing's buttons, the power cabinet…), in the order Chevron Street numbers
 * them (the first is #1): those with something to click, but for the hiding places and what the
 * game has its own of. Taken as the scene is built, before anything has been clicked.
 */
export function clickables(root: THREE.Object3D): Gadget[] {
  const hiding = new Set<Gadget>(hidingToggles(root).map((h) => h.toggle));
  return gadgetsIn(root).filter((g) => {
    const says = g.hint();
    return g.handles.length > 0 && says !== null && !THE_GAMES.has(says) && !hiding.has(g);
  });
}
