import type * as THREE from 'three';
import type { HideoutKind } from '@sar/shared';
import { Toggle, gadgetsIn } from './gadgets.ts';

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
