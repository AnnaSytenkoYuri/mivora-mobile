import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatMapCoordinates,
  isSavedCoordinatePair,
  providersWithMapCoordinates,
  regionForMapMarkers,
} from './business-location.ts';

test('missing coordinates are not treated as a saved business location', () => {
  assert.equal(isSavedCoordinatePair(undefined, undefined), false);
  assert.equal(isSavedCoordinatePair(13.7563, undefined), false);
  assert.equal(isSavedCoordinatePair(undefined, 100.5018), false);
  assert.equal(isSavedCoordinatePair(13.75, 100.5), true);
});

test('coordinates format to six decimal places', () => {
  assert.equal(formatMapCoordinates(13.7563, 100.5018), '13.756300, 100.501800');
});

test('map markers keep only providers with a valid coordinate pair', () => {
  const mapped = providersWithMapCoordinates([
    { id: 'a', latitude: 13.75, longitude: 100.5 },
    { id: 'b', latitude: 13.8 },
    { id: 'c' },
    { id: 'd', latitude: 7.88, longitude: 98.39 },
  ]);
  assert.deepEqual(
    mapped.map((item) => item.id),
    ['a', 'd'],
  );
});

test('map region falls back when there are no markers and fits when there are', () => {
  const fallback = { latitude: 13.7563, longitude: 100.5018, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  assert.deepEqual(regionForMapMarkers([], fallback), fallback);

  const one = regionForMapMarkers([{ latitude: 13.73, longitude: 100.54 }], fallback);
  assert.equal(one.latitude, 13.73);
  assert.equal(one.longitude, 100.54);

  const fitted = regionForMapMarkers(
    [
      { latitude: 13.7, longitude: 100.5 },
      { latitude: 13.8, longitude: 100.6 },
    ],
    fallback,
  );
  assert.equal(fitted.latitude, 13.75);
  assert.equal(fitted.longitude, 100.55);
});
