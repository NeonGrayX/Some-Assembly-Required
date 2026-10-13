import { HOUSE } from '@sar/shared';
import { View } from './render/view.ts';

/**
 * The one view of the world, with its renderer and graphics settings: the game draws its level
 * in it, and the build editor its own map (`View.showStudio`).
 */
export const view = new View(document.getElementById('game')!, HOUSE);
