import * as THREE from 'three';
import { BRICK_TYPES, GEAR, MAPS, groundHeight } from '@sar/shared';
import type { BrickTypeId, LevelDef, MapDef } from '@sar/shared';
import { animateAvatar, makeAvatar } from '../render/avatar.ts';
import { brickGeometry, brickMaterial } from '../render/bricks.ts';
import { DogView } from '../render/dog.ts';
import { makeGearProp, wearGear } from '../render/gear.ts';
import { buildLevelModels } from '../render/scene.ts';
import type { LevelModels } from '../render/scene.ts';
import { VacuumView } from '../render/vacuum.ts';
import { catalogueOrder } from './brickFinder.ts';
import { brickName } from './brickViewer.ts';

/**
 * Everything the asset viewer lists: the pieces each map is furnished with, its hiding places
 * and machines, the players, the dog, the gear, the vacuum and the bricks. The map pieces are
 * the ones the game draws, taken from each map's own models (`buildLevelModels`), so a new
 * piece shows up here by itself; a kind of piece found on several maps, or in several sizes,
 * is one asset with a variant for each.
 *
 * The model gallery (models.html) shows the same models for working on them; this is the
 * players' view of them.
 */

export const ASSET_GROUPS = [
  'Furniture and props',
  'Hiding places',
  'Brick works',
  'Vehicles and buildings',
  'Outdoors',
  'Players and the dog',
  'Gear',
  'Bricks',
] as const;
export type AssetGroup = (typeof ASSET_GROUPS)[number];

export interface Shown {
  /** What the camera frames. */
  focus: THREE.Object3D[];
  /** Which way the model's front faces, as a turn about y (its front is local -z). */
  front: number;
  /** The floor's height under it. */
  floor: number;
}

export interface AssetVariant {
  /** Which one it is: the map it is from, or what it is doing. */
  label: string;
  /** Whether it has a door or lid that opens. */
  opens: boolean;
  /** For a map's piece: the map it is from, and its size, to tell it from others there. */
  map?: string;
  size?: string;
  /** Puts it on `stage`, `open` of the way open (0 to 1). */
  show(stage: THREE.Group, open: number): Shown;
}

export interface Asset {
  id: string;
  name: string;
  group: AssetGroup;
  variants: AssetVariant[];
}

/** Names and groups for the kinds of map piece; any other kind is a prop named from its id. */
const KINDS: Record<string, [string, AssetGroup]> = {
  acUnit: ['Air conditioner', 'Furniture and props'],
  lampPost: ['Street lamp', 'Outdoors'],
  lanternPost: ['Lantern post', 'Outdoors'],
  lamp: ['Ceiling lamp', 'Furniture and props'],
  board: ['Corkboard', 'Brick works'],
  bell: ['Meeting bell', 'Brick works'],
  'done button': ['Done button', 'Brick works'],
  inspector: ['Inspector', 'Brick works'],
  catapult: ['Catapult', 'Brick works'],
  silo: ['Pellet silo', 'Brick works'],
  press: ['Moulding machine', 'Brick works'],
  dispenser: ['Mould dispenser', 'Brick works'],
  printer: ['UV printer', 'Brick works'],
  'dog pole': ['Dog pole', 'Players and the dog'],
  'treat jar': ['Treat jar', 'Players and the dog'],
  panel: ['Electrical panel', 'Furniture and props'],
  caravanRoof: ['Caravan', 'Vehicles and buildings'],
  carriageRoof: ['Sleeper carriage', 'Vehicles and buildings'],
  locomotive: ['Locomotive', 'Vehicles and buildings'],
  wagon: ['Tank wagon', 'Vehicles and buildings'],
  forklift: ['Forklift', 'Vehicles and buildings'],
  hull: ['Ship', 'Vehicles and buildings'],
  storey: ['Island house', 'Vehicles and buildings'],
  canoe: ['Canoe', 'Vehicles and buildings'],
  ballast: ['Railway track', 'Outdoors'],
  portaloo: ['Portaloo', 'Hiding places'],
  skip: ['Skip', 'Hiding places'],
  rock: ['Rock', 'Outdoors'],
  boulder: ['Boulder', 'Outdoors'],
  log: ['Log', 'Outdoors'],
  stump: ['Stump', 'Outdoors'],
  pine: ['Pine tree', 'Outdoors'],
  palm: ['Palm tree', 'Outdoors'],
  fence: ['Fence', 'Outdoors'],
  ropeFence: ['Rope fence', 'Outdoors'],
  piling: ['Piling', 'Outdoors'],
  anchor: ['Anchor', 'Outdoors'],
  flagpole: ['Flagpole', 'Outdoors'],
  cannon: ['Cannon', 'Outdoors'],
  deck: ['Deck', 'Outdoors'],
  ramp: ['Ramp', 'Outdoors'],
  platform: ['Platform', 'Outdoors'],
  ladder: ['Ladder', 'Furniture and props'],
  picnicTable: ['Picnic table', 'Outdoors'],
  tent: ['Tent', 'Hiding places'],
};

/** The pieces that make up another (a sofa's back, a caravan's wheels), shown with it. */
const PARTS: Record<string, RegExp> = {
  sofa: /^sofaBack$/,
  stove: /^flue$/,
  inspector: /^inspector \d+ screen$/,
  caravanRoof: /^(livery|wheel|towHitch|step)$/,
  carriageRoof: /^(livery|axle|gangway)$/,
  storey: /^gableRoof$/,
  hull: /^(mast|ropeRail)$/,
  ballast: /^trackRail$/,
  wagon: /^tankSpout$/,
};
/**
 * What is built like a room (walls, floor, a roof box) rather than as one model: shown with
 * everything that stands in its footprint, its furniture included.
 */
const BUILT = /^(caravanRoof|carriageRoof|storey|hull)$/;
/** What a built thing never takes in: the ground and what spreads over the whole map. */
const NOT_BUILT = /^(ground|water|grid|trim|lamp shadows|greenery|scenery|site \d+ outline)/;
/** Parts that are nothing on their own. */
const PART_ONLY =
  /^(sofaBack|flue|livery|wheel|axle|towHitch|gangway|gableRoof|mast|ropeRail|trackRail|tankSpout|inspector \d+ screen)$/;
/** What is not a model of its own: the ground and walls, outlines, invisible colliders. */
const SKIP =
  /^(ground|water|grid|wall|box|trim|room floor|lamp shadows|greenery|collider|scenery|site \d+ outline|inspector \d+ outline)/;
/** The maps whose pieces are listed (the city map is one big model of its own, left out). */
const LISTED = (m: MapDef) => m.id !== 'chevron';
/** At most this many variants of one kind. */
const MAX_VARIANTS = 6;

/** "treat jar at 1.00,0.90,2.00" is a treat jar, "fridge #1" a fridge, "bell 0" a bell. */
const kindOf = (owner: string) => owner.replace(/ at .*| #\d+| \d+$/, '');

/** A readable name for an id: "wheelieBin" is a "Wheelie bin". */
export function readable(id: string): string {
  const words = id.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const solid = (o: THREE.Object3D, box: THREE.Box3) => {
  // Framed on what is solid: a lamp's glow on the floor spreads far wider than the lamp.
  o.traverse((m) => {
    if (m instanceof THREE.Mesh && m.visible && !(m.material as THREE.Material).transparent)
      box.expandByObject(m);
  });
};

/** The box round what is solid of `objs`, or round all of them if nothing is. */
export function solidBox(objs: THREE.Object3D[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const o of objs) o.updateMatrixWorld(true);
  for (const o of objs) solid(o, box);
  if (box.isEmpty()) for (const o of objs) box.expandByObject(o);
  return box;
}

/** A model made once, the first time it is shown, and shown on its own. */
function alone(label: string, make: () => THREE.Object3D): AssetVariant {
  let o: THREE.Object3D | null = null;
  return {
    label,
    opens: false,
    show(stage) {
      o ??= make();
      stage.add(o);
      return { focus: [o], front: 0, floor: solidBox([o]).min.y };
    },
  };
}

/** The players, the dog, the gear, the vacuum and the bricks: the same on every map. */
function standalone(): Asset[] {
  const blue = 0x2e86de;
  const assets: Asset[] = [
    {
      id: 'player',
      name: 'Player',
      group: 'Players and the dog',
      variants: [
        ...(
          [
            ['Red', 0xd9443a],
            ['Blue', blue],
            ['Green', 0x27ae60],
            ['Yellow', 0xf1c40f],
          ] as const
        ).map(([label, c]) => alone(label, () => makeAvatar(c, null).group)),
        alone('Carrying the vacuum', () => {
          const a = makeAvatar(blue, null);
          const v = new VacuumView();
          const both = new THREE.Group();
          both.add(a.group, v.group);
          for (let i = 0; i < 40; i++) {
            const head = a.group.localToWorld(new THREE.Vector3(0.25, -0.85, -0.85));
            const grip = v.carry(a.group, head, false);
            animateAvatar(a, { limping: false, carrying: true, careful: false, grip }, 1 / 60);
          }
          return both;
        }),
        alone('Fixing with the wrench', () => {
          const a = makeAvatar(blue, null);
          // Mid-pull on a bolt in a machine's front, as the brick works have them.
          const work = new THREE.Vector3(0, 0.05, -0.62);
          for (let i = 0; i < 50; i++) {
            const gait = { limping: false, carrying: false, careful: false, work, wrench: true };
            animateAvatar(a, gait, 1 / 60);
          }
          return a.group;
        }),
      ],
    },
    {
      id: 'dog',
      name: 'Dog',
      group: 'Players and the dog',
      variants: [alone('Standing', () => new DogView().group)],
    },
    {
      id: 'vacuum',
      name: 'Vacuum',
      group: 'Brick works',
      variants: [
        alone('Standing', () => new VacuumView().group),
        alone('Running, half full', () => {
          const v = new VacuumView();
          v.setLoad(5, 10);
          v.update(1, 0);
          v.sucked();
          v.speed = 1;
          v.update(1, 0);
          return v.group;
        }),
      ],
    },
  ];
  for (const g of GEAR)
    assets.push({
      id: `gear:${g.id}`,
      name: g.name,
      group: 'Gear',
      variants: [
        alone('Lying about', () => makeGearProp(g.id)),
        alone('Worn', () => {
          const a = makeAvatar(blue, null);
          wearGear(a, g.id);
          return a.group;
        }),
      ],
    });
  for (const t of catalogueOrder() as BrickTypeId[])
    assets.push({
      id: `brick:${t}`,
      name: brickName(t),
      group: 'Bricks',
      variants: [
        alone(BRICK_TYPES[t].fixture ? 'Fixture' : 'Red', () => {
          const m = new THREE.Mesh(brickGeometry(t), brickMaterial('red'));
          m.castShadow = m.receiveShadow = true;
          return m;
        }),
      ],
    });
  return assets;
}

/** A map's pieces, as variants by kind, added to `byKind`. */
function addMapPieces(
  map: MapDef,
  byKind: Map<string, { sizes: Set<string>; variants: AssetVariant[] }>,
): void {
  const def: LevelDef = map.id === 'house' ? map.plain : map.layout(1);
  let lm: LevelModels | null = buildLevelModels(def);
  const models = () => (lm ??= buildLevelModels(def));
  const owners = new Map<string, THREE.Object3D[]>();
  for (const o of lm.root.children) {
    const n = lm.owner(o);
    if (!owners.has(n)) owners.set(n, []);
    owners.get(n)!.push(o);
  }
  const boxOf = (objs: THREE.Object3D[]) => {
    const b = new THREE.Box3();
    for (const o of objs) b.expandByObject(o);
    return b;
  };
  const taken = new Set<string>();
  for (const [owner, objs] of owners) {
    const kind = kindOf(owner);
    if (SKIP.test(owner) || PART_ONLY.test(kind)) continue;
    // With its parts: whatever of theirs touches it.
    const box = boxOf(objs).expandByScalar(0.05);
    const parts: string[] = [];
    const partOf = PARTS[kind.replace(/ \d+$/, '')];
    if (partOf)
      for (const [other, its] of owners)
        if (!taken.has(other) && partOf.test(kindOf(other)) && boxOf(its).intersectsBox(box)) {
          parts.push(other);
          taken.add(other);
        }
    if (BUILT.test(kind)) {
      const centre = new THREE.Vector3();
      for (const [other, its] of owners) {
        if (other === owner || parts.includes(other) || NOT_BUILT.test(other)) continue;
        boxOf(its).getCenter(centre);
        const inside =
          centre.x > box.min.x &&
          centre.x < box.max.x &&
          centre.z > box.min.z &&
          centre.z < box.max.z &&
          centre.y < box.max.y &&
          centre.y > box.min.y - 4;
        if (inside) parts.push(other);
      }
    }
    const size = boxOf([...objs, ...parts.flatMap((p) => owners.get(p)!)]).getSize(
      new THREE.Vector3(),
    );
    const key = kind.replace(/ \d+$/, '');
    const entry = byKind.get(key) ?? { sizes: new Set<string>(), variants: [] };
    byKind.set(key, entry);
    const sized = `${size.x.toFixed(1)} ${size.y.toFixed(1)} ${size.z.toFixed(1)}`;
    if (entry.sizes.has(sized) || entry.variants.length >= MAX_VARIANTS) continue;
    entry.sizes.add(sized);
    const hideout = def.hideouts.find(
      (h) => owner.endsWith(` #${h.id}`) && owner.startsWith(h.kind),
    );
    const shown = new Set([owner, ...parts]);
    const m = (n: number) => (n < 1 ? `${Math.round(n * 100)} cm` : `${n.toFixed(1)} m`);
    entry.variants.push({
      label: map.name,
      map: map.name,
      size: `${m(size.x)} × ${m(size.y)} × ${m(size.z)}`,
      opens: !!hideout,
      show(stage, open) {
        const lm = models();
        lm.open(open);
        stage.add(lm.root);
        const focus: THREE.Object3D[] = [];
        for (const o of lm.root.children) {
          o.visible = shown.has(lm.owner(o));
          if (o.visible) focus.push(o);
        }
        lm.root.updateMatrixWorld(true);
        const box = solidBox(focus);
        const centre = box.getCenter(new THREE.Vector3());
        // On hills, no lower than the ground under it (a palm's foot is sunk in it).
        const ground = def.terrain?.length ? groundHeight(def, centre.x, centre.z) : -1e9;
        const front = hideout ? hideout.facing : (focus[0]?.rotation.y ?? 0);
        return { focus, front, floor: Math.max(box.min.y, ground) };
      },
    });
  }
  // Built again when first shown: until then only the list needs it.
  lm = null;
}

/**
 * Makes the catalogue: the assets that are the same everywhere at once, then each map's
 * pieces one map at a time, between frames, `onChange` called with the list as it grows.
 */
export async function loadCatalogue(onChange: (assets: Asset[]) => void): Promise<Asset[]> {
  const fixed = standalone();
  onChange(fixed);
  const byKind = new Map<string, { sizes: Set<string>; variants: AssetVariant[] }>();
  const pieces = (): Asset[] =>
    [...byKind]
      .filter(([, e]) => e.variants.length)
      .map(([kind, e]) => {
        // Several from one map are told apart by their size.
        for (const v of e.variants) {
          const alike = e.variants.filter((o) => o.map === v.map).length;
          if (alike > 1) v.label = `${v.map} · ${v.size}`;
        }
        const hideout = e.variants.some((v) => v.opens);
        const [name, group] = KINDS[kind] ?? [
          readable(kind),
          hideout ? 'Hiding places' : 'Furniture and props',
        ];
        return { id: `piece:${kind}`, name, group, variants: e.variants };
      });
  const all = () => [...pieces(), ...fixed];
  for (const map of MAPS.filter(LISTED)) {
    await new Promise((r) => setTimeout(r, 0));
    addMapPieces(map, byKind);
    onChange(all());
  }
  return all();
}
