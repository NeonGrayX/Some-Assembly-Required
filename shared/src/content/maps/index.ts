import { HOUSE } from '../house.ts';
import type { LevelDef } from '../house.ts';
import { houseLayout } from '../layout.ts';
import { campLayout } from './camp.ts';
import { merchantLayout } from './merchant.ts';
import { stationLayout } from './station.ts';

/** A map the host can pick: its id and name, and how it is laid out for a round's seed. */
export interface MapDef {
  id: MapId;
  name: string;
  /** One line for the lobby. */
  blurb: string;
  layout: (seed: number) => LevelDef;
  /** The map with no seed (the lobby before any round): the plain, hand-made version. */
  plain: LevelDef;
}

export const MAP_IDS = ['house', 'merchant', 'station', 'camp'] as const;
export type MapId = (typeof MAP_IDS)[number];
export const DEFAULT_MAP: MapId = 'house';

const cache = new Map<string, LevelDef>();
/** Layouts are deterministic per map and seed, and the server and every client ask for the same ones. */
function cached(id: MapId, layout: (seed: number) => LevelDef): (seed: number) => LevelDef {
  return (seed) => {
    const key = `${id}:${seed >>> 0}`;
    let level = cache.get(key);
    if (!level) {
      level = layout(seed >>> 0);
      if (cache.size > 24) cache.delete(cache.keys().next().value!);
      cache.set(key, level);
    }
    return level;
  };
}

export const MAPS: MapDef[] = [
  {
    id: 'house',
    name: 'The house and yard',
    blurb: 'A house with a yard, furnished anew every round',
    layout: houseLayout,
    plain: HOUSE,
  },
  {
    id: 'merchant',
    name: 'Brick & Mortar',
    blurb: "A builders' merchant: the aisles change every round",
    layout: cached('merchant', merchantLayout),
    plain: merchantLayout(1),
  },
  {
    id: 'station',
    name: 'Platform 9',
    blurb: 'A country station: the sleeper train stands in a new order every round',
    layout: cached('station', stationLayout),
    plain: stationLayout(1),
  },
  {
    id: 'camp',
    name: 'Lakeside Camp',
    blurb: 'A campsite by a lake: the pitches and the jetty change every round',
    layout: cached('camp', campLayout),
    plain: campLayout(1),
  },
];

export const isMapId = (x: unknown): x is MapId => MAP_IDS.includes(x as MapId);
export const mapById = (id: MapId): MapDef => MAPS.find((m) => m.id === id) ?? MAPS[0]!;

/** The level for a map and the round's layout seed (the plain map when there is no seed). */
export function levelFor(id: MapId, seed: number | null): LevelDef {
  const map = mapById(id);
  return seed === null ? map.plain : map.layout(seed);
}
