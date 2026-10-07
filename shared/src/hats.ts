/**
 * The hats a player can wear. Every player wears one (the hard hat by default); it is picked
 * on the start menu or in the lobby, shown on the avatar and flies off when they are knocked
 * over. The shapes themselves live in the client (`render/hats.ts`), keyed by id.
 */
export interface Hat {
  id: HatId;
  name: string;
}

export const HATS = [
  { id: 'hardhat', name: 'Hard hat' },
  { id: 'cap', name: 'Flat cap' },
  { id: 'beanie', name: 'Beanie' },
  { id: 'tophat', name: 'Top hat' },
  { id: 'cowboy', name: 'Cowboy hat' },
  { id: 'party', name: 'Party hat' },
  { id: 'crown', name: 'Crown' },
  { id: 'chef', name: "Chef's hat" },
  { id: 'cone', name: 'Traffic cone' },
  { id: 'propeller', name: 'Propeller beanie' },
  { id: 'brick', name: '2×2 brick' },
  { id: 'none', name: 'No hat' },
] as const satisfies readonly { id: string; name: string }[];

export type HatId = (typeof HATS)[number]['id'];

export const DEFAULT_HAT: HatId = 'hardhat';

export function isHatId(x: unknown): x is HatId {
  return typeof x === 'string' && HATS.some((h) => h.id === x);
}

/** The hat `x` names, or the default when it names none (an old client, a typo in storage). */
export function hatOr(x: unknown): HatId {
  return isHatId(x) ? x : DEFAULT_HAT;
}

export function hatName(id: HatId): string {
  return HATS.find((h) => h.id === id)?.name ?? id;
}
