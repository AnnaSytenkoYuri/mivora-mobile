export const CITY_IDS = ['bangkok', 'phuket'] as const;

export type CityId = (typeof CITY_IDS)[number];

export const DEFAULT_CITY_ID: CityId = 'bangkok';

export type CityConfig = {
  id: CityId;
  label: string;
  aliases: readonly string[];
};

export type CityMapCenter = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const CITIES: Record<CityId, CityConfig> = {
  bangkok: {
    id: 'bangkok',
    label: 'Bangkok',
    aliases: ['bangkok', 'bkk', 'กรุงเทพ', 'กรุงเทพฯ', 'กรุงเทพมหานคร'],
  },
  phuket: {
    id: 'phuket',
    label: 'Phuket',
    aliases: ['phuket', 'ภูเก็ต'],
  },
};

/** Approximate city centers for the owner map picker preview only. Never auto-saved. */
export const CITY_MAP_CENTERS: Record<CityId, CityMapCenter> = {
  bangkok: {
    latitude: 13.7563,
    longitude: 100.5018,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  },
  phuket: {
    latitude: 7.8804,
    longitude: 98.3923,
    latitudeDelta: 0.08,
    longitudeDelta: 0.08,
  },
};

export const CITY_LIST: readonly CityConfig[] = CITY_IDS.map((id) => CITIES[id]);

export function parseCityId(value: string | null | undefined): CityId | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return CITY_IDS.find((id) => id === normalized || CITIES[id].aliases.includes(normalized));
}

export function cityLabel(cityId: CityId): string {
  return CITIES[cityId].label;
}

export function canonicalCityLabel(value: string | null | undefined): string | undefined {
  const cityId = parseCityId(value);
  return cityId ? CITIES[cityId].label : undefined;
}

export function providerMatchesCity(provider: { city: string }, cityId: CityId): boolean {
  return parseCityId(provider.city) === cityId;
}

export function isCityId(value: unknown): value is CityId {
  return typeof value === 'string' && CITY_IDS.includes(value as CityId);
}
