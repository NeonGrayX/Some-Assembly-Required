/**
 * How a player looks: a hat, a face and a shirt, each picked from a short list on the start
 * menu or in the lobby and shown to everyone on the avatar. The lists here are just ids and
 * names; the shapes live in the client (`render/hats.ts`, `render/avatar.ts`), keyed by id.
 */

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

export const FACES = [
  { id: 'smile', name: 'Smile' },
  { id: 'grin', name: 'Grin' },
  { id: 'calm', name: 'Calm' },
  { id: 'wink', name: 'Wink' },
  { id: 'surprised', name: 'Surprised' },
  { id: 'glasses', name: 'Glasses' },
  { id: 'moustache', name: 'Moustache' },
  { id: 'beard', name: 'Beard' },
] as const satisfies readonly { id: string; name: string }[];

export const SHIRTS = [
  { id: 'plain', name: 'Plain shirt' },
  { id: 'stripes', name: 'Striped shirt' },
  { id: 'hivis', name: 'Hi-vis vest' },
  { id: 'bowtie', name: 'Bow tie' },
  { id: 'scarf', name: 'Scarf' },
] as const satisfies readonly { id: string; name: string }[];

export type HatId = (typeof HATS)[number]['id'];
export type FaceId = (typeof FACES)[number]['id'];
export type ShirtId = (typeof SHIRTS)[number]['id'];

export interface Look {
  hat: HatId;
  face: FaceId;
  shirt: ShirtId;
}

export const DEFAULT_HAT: HatId = 'hardhat';
export const DEFAULT_LOOK: Look = { hat: 'hardhat', face: 'smile', shirt: 'plain' };

export function isHatId(x: unknown): x is HatId {
  return typeof x === 'string' && HATS.some((h) => h.id === x);
}
export function isFaceId(x: unknown): x is FaceId {
  return typeof x === 'string' && FACES.some((f) => f.id === x);
}
export function isShirtId(x: unknown): x is ShirtId {
  return typeof x === 'string' && SHIRTS.some((s) => s.id === x);
}

/** The hat `x` names, or the default when it names none (an old client, a typo in storage). */
export function hatOr(x: unknown): HatId {
  return isHatId(x) ? x : DEFAULT_LOOK.hat;
}
export function faceOr(x: unknown): FaceId {
  return isFaceId(x) ? x : DEFAULT_LOOK.face;
}
export function shirtOr(x: unknown): ShirtId {
  return isShirtId(x) ? x : DEFAULT_LOOK.shirt;
}

/** A whole look from whatever came over the wire or out of storage, defaults filling gaps. */
export function lookOr(x: unknown): Look {
  const r = x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
  return { hat: hatOr(r.hat), face: faceOr(r.face), shirt: shirtOr(r.shirt) };
}

export function hatName(id: HatId): string {
  return HATS.find((h) => h.id === id)?.name ?? id;
}
export function faceName(id: FaceId): string {
  return FACES.find((f) => f.id === id)?.name ?? id;
}
export function shirtName(id: ShirtId): string {
  return SHIRTS.find((s) => s.id === id)?.name ?? id;
}
