import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Category, Provider } from '../data/types.ts';
import { filterProviders } from './provider-search.ts';

const CATEGORIES: Category[] = [
  { slug: 'nails', label: 'Nails' },
  { slug: 'hair', label: 'Hair' },
];

function provider(overrides: Partial<Provider> & Pick<Provider, 'id' | 'name'>): Provider {
  return {
    kind: 'salon',
    bio: '',
    categories: ['nails'],
    area: 'Thonglor',
    city: 'Bangkok',
    rating: 4.8,
    reviewCount: 10,
    startingPriceThb: 890,
    imageUrl: '',
    featured: false,
    services: [{ id: `${overrides.id}-gel`, name: 'Gel manicure', category: 'nails', durationMinutes: 60, priceThb: 890 }],
    portfolio: [],
    reviews: [],
    ...overrides,
  };
}

const VELVET = provider({ id: 'velvet', name: 'Velvet Nails Thonglor', kind: 'salon' });
const MIRA = provider({
  id: 'mira',
  name: 'Mira Nail Studio',
  kind: 'specialist',
  area: 'Ari',
  address: '12 Phahonyothin Rd',
  startingPriceThb: 750,
  services: [{ id: 'mira-soft', name: 'Soft gel set', category: 'nails', durationMinutes: 90, priceThb: 950 }],
});
const ATELIER = provider({
  id: 'atelier',
  name: 'Atelier Hair Silom',
  categories: ['hair'],
  area: 'Silom',
  startingPriceThb: 1200,
  services: [{ id: 'ah-cut', name: "Women's cut & blowout", category: 'hair', durationMinutes: 75, priceThb: 1200 }],
});
const RAWAI = provider({
  id: 'rawai',
  name: 'Rawai Glow',
  area: 'Rawai',
  city: 'Phuket',
  startingPriceThb: 600,
});

const CATALOG = [VELVET, MIRA, ATELIER, RAWAI];

function ids(filters: Parameters<typeof filterProviders>[2]): string[] {
  return filterProviders(CATALOG, CATEGORIES, filters).map((item) => item.id);
}

test('service query matches name, service names, and category labels but not area or city', () => {
  assert.deepEqual(ids({ serviceQuery: 'velvet' }), ['velvet']);
  assert.deepEqual(ids({ serviceQuery: 'blowout' }), ['atelier']);
  assert.deepEqual(ids({ serviceQuery: 'hair' }), ['atelier']);
  assert.deepEqual(ids({ serviceQuery: 'ari' }), []);
  assert.deepEqual(ids({ serviceQuery: 'bangkok' }), []);
  assert.deepEqual(ids({ serviceQuery: 'phuket' }), []);
});

test('location query matches area, city, and street address but not service names', () => {
  assert.deepEqual(ids({ locationQuery: 'ari' }), ['mira']);
  assert.deepEqual(ids({ locationQuery: 'bangkok' }), ['velvet', 'mira', 'atelier']);
  assert.deepEqual(ids({ locationQuery: 'phahonyothin' }), ['mira']);
  assert.deepEqual(ids({ locationQuery: 'gel' }), []);
  assert.deepEqual(ids({ locationQuery: 'nails' }), []);
});

test('service query does not match street address; null address still works', () => {
  assert.deepEqual(ids({ serviceQuery: 'phahonyothin' }), []);
  assert.deepEqual(ids({ locationQuery: 'sukhumvit' }), []);
});

test('service and location queries combine with AND logic', () => {
  assert.deepEqual(ids({ serviceQuery: 'gel', locationQuery: 'ari' }), ['mira']);
  assert.deepEqual(ids({ serviceQuery: 'gel', locationQuery: 'phahonyothin' }), ['mira']);
  assert.deepEqual(ids({ serviceQuery: 'gel', locationQuery: 'silom' }), []);
  assert.deepEqual(ids({ serviceQuery: 'nails', locationQuery: 'thonglor' }), ['velvet']);
});

test('selected city remains the primary city scope', () => {
  assert.deepEqual(ids({ cityId: 'bangkok', locationQuery: 'phuket' }), []);
  assert.deepEqual(ids({ cityId: 'phuket', locationQuery: 'rawai' }), ['rawai']);
  assert.deepEqual(ids({ cityId: 'bangkok', serviceQuery: 'gel' }), ['velvet', 'mira']);
});

test('category, area, kind, and max price filters still apply with text queries', () => {
  assert.deepEqual(
    ids({
      cityId: 'bangkok',
      serviceQuery: 'gel',
      categorySlug: 'nails',
      area: 'Ari',
      kind: 'specialist',
      maxPriceThb: 800,
    }),
    ['mira'],
  );
  assert.deepEqual(
    ids({
      cityId: 'bangkok',
      serviceQuery: 'gel',
      kind: 'salon',
      maxPriceThb: 800,
    }),
    [],
  );
});
