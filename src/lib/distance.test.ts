import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  distanceKmFromOrigin,
  formatApproximateDistanceKm,
  haversineKm,
  sortProvidersByNearest,
} from './distance.ts';

test('haversine is zero for the same point', () => {
  assert.equal(haversineKm(13.7563, 100.5018, 13.7563, 100.5018), 0);
});

test('haversine is the approximate straight-line distance between Bangkok and Phuket', () => {
  const km = haversineKm(13.7563, 100.5018, 7.8804, 98.3923);
  assert.equal(km > 670 && km < 700, true);
});

test('distance is omitted when a provider has no coordinate pair', () => {
  const origin = { latitude: 13.7563, longitude: 100.5018 };
  assert.equal(distanceKmFromOrigin(origin, undefined, undefined), undefined);
  assert.equal(distanceKmFromOrigin(origin, 13.75, undefined), undefined);
  assert.equal(distanceKmFromOrigin({ latitude: 91, longitude: 100 }, 13.75, 100.5), undefined);
});

test('distance labels are approximate straight-line kilometers', () => {
  assert.equal(formatApproximateDistanceKm(0.04), 'About 0.1 km away · straight-line');
  assert.equal(formatApproximateDistanceKm(2.34), 'About 2.3 km away · straight-line');
  assert.equal(formatApproximateDistanceKm(18.6), 'About 19 km away · straight-line');
});

test('nearest sort puts known distances first and keeps unmapped providers after', () => {
  const origin = { latitude: 13.75, longitude: 100.5 };
  const ordered = sortProvidersByNearest(
    [
      { id: 'far', latitude: 13.9, longitude: 100.7 },
      { id: 'none' },
      { id: 'near', latitude: 13.76, longitude: 100.51 },
      { id: 'also-none', latitude: 13.8 },
    ],
    origin,
  );

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['near', 'far', 'none', 'also-none'],
  );
});
