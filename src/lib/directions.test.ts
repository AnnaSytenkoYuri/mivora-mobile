import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appleMapsDirectionsUrl,
  directionsDestination,
  googleMapsDirectionsUrl,
} from './directions.ts';

test('prefers exact coordinates over a street address', () => {
  const destination = directionsDestination({
    latitude: 13.73,
    longitude: 100.54,
    address: '12 Phahonyothin Rd',
    area: 'Ari',
    city: 'Bangkok',
  });
  assert.deepEqual(destination, { kind: 'coordinates', latitude: 13.73, longitude: 100.54 });
});

test('falls back to street address, area, and city when coordinates are missing', () => {
  const destination = directionsDestination({
    address: ' 12 Phahonyothin Rd ',
    area: 'Ari',
    city: 'Bangkok',
  });
  assert.deepEqual(destination, {
    kind: 'address',
    query: '12 Phahonyothin Rd, Ari, Bangkok',
  });
});

test('does not create a destination from area and city alone', () => {
  assert.equal(
    directionsDestination({
      area: 'Thonglor',
      city: 'Bangkok',
    }),
    undefined,
  );
  assert.equal(
    directionsDestination({
      address: '   ',
      area: 'Thonglor',
      city: 'Bangkok',
    }),
    undefined,
  );
});

test('incomplete address fallbacks are rejected', () => {
  assert.equal(
    directionsDestination({
      address: '12 Phahonyothin Rd',
      area: 'Ari',
    }),
    undefined,
  );
  assert.equal(
    directionsDestination({
      address: '12 Phahonyothin Rd',
      city: 'Bangkok',
    }),
    undefined,
  );
});

test('a partial coordinate pair falls back to a complete street address', () => {
  const destination = directionsDestination({
    latitude: 13.73,
    address: '88 Sukhumvit Rd',
    area: 'Thonglor',
    city: 'Bangkok',
  });
  assert.deepEqual(destination, {
    kind: 'address',
    query: '88 Sukhumvit Rd, Thonglor, Bangkok',
  });
});

test('invalid coordinates without a street address hide directions', () => {
  assert.equal(
    directionsDestination({
      latitude: 91,
      longitude: 100.5,
      area: 'Rawai',
      city: 'Phuket',
    }),
    undefined,
  );
});

test('Apple and Google URLs encode coordinates and address queries', () => {
  const coords = { kind: 'coordinates' as const, latitude: 7.8804, longitude: 98.3923 };
  assert.equal(
    appleMapsDirectionsUrl(coords),
    'https://maps.apple.com/?daddr=7.8804%2C98.3923',
  );
  assert.equal(
    googleMapsDirectionsUrl(coords),
    'https://www.google.com/maps/dir/?api=1&destination=7.8804%2C98.3923',
  );

  const address = { kind: 'address' as const, query: '12 Phahonyothin Rd, Ari, Bangkok' };
  assert.equal(
    appleMapsDirectionsUrl(address),
    `https://maps.apple.com/?daddr=${encodeURIComponent(address.query)}`,
  );
  assert.equal(
    googleMapsDirectionsUrl(address),
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address.query)}`,
  );
});
