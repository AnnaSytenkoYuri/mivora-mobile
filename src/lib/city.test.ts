import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CITY_MAP_CENTERS,
  canonicalCityLabel,
  parseCityId,
  providerMatchesCity,
} from '../constants/cities.ts';

test('parses Bangkok and Phuket aliases without treating unknown cities as Bangkok', () => {
  assert.equal(parseCityId('Bangkok'), 'bangkok');
  assert.equal(parseCityId(' bkk '), 'bangkok');
  assert.equal(parseCityId('กรุงเทพฯ'), 'bangkok');
  assert.equal(parseCityId('Phuket'), 'phuket');
  assert.equal(parseCityId('ภูเก็ต'), 'phuket');
  assert.equal(parseCityId('Chiang Mai'), undefined);
  assert.equal(parseCityId(''), undefined);
});

test('canonical labels are stable display names', () => {
  assert.equal(canonicalCityLabel('bkk'), 'Bangkok');
  assert.equal(canonicalCityLabel('phuket'), 'Phuket');
  assert.equal(canonicalCityLabel('Pattaya'), undefined);
});

test('provider city matching is exact to the selected city id', () => {
  assert.equal(providerMatchesCity({ city: 'Bangkok' }, 'bangkok'), true);
  assert.equal(providerMatchesCity({ city: 'Bangkok' }, 'phuket'), false);
  assert.equal(providerMatchesCity({ city: 'Phuket' }, 'phuket'), true);
  assert.equal(providerMatchesCity({ city: 'Unknown' }, 'bangkok'), false);
});

test('map preview centers are distinct and not a saved business pin', () => {
  assert.notEqual(CITY_MAP_CENTERS.bangkok.latitude, CITY_MAP_CENTERS.phuket.latitude);
  assert.equal(CITY_MAP_CENTERS.bangkok.longitude > 100, true);
  assert.equal(CITY_MAP_CENTERS.phuket.longitude < 100, true);
});
