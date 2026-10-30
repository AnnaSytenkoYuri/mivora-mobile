import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bookedProviderServiceQueryError,
  bookingCatalogDisplay,
  bookingCatalogIdentityKey,
  shouldFetchBookingCatalog,
  shouldRestartCatalogFetch,
} from './booking-catalog-state.ts';

test('background notification taps wait until the app is active before fetching catalog', () => {
  assert.equal(
    shouldFetchBookingCatalog({ bookingFound: true, appState: 'background' }),
    false,
  );
  assert.equal(
    shouldFetchBookingCatalog({ bookingFound: true, appState: 'inactive' }),
    false,
  );
  assert.equal(shouldFetchBookingCatalog({ bookingFound: true, appState: 'active' }), true);
  assert.equal(shouldFetchBookingCatalog({ bookingFound: false, appState: 'active' }), false);
});

test('returning from background restarts a catalog fetch that never produced details', () => {
  assert.equal(
    shouldRestartCatalogFetch({
      event: 'app_became_active',
      detailsLoaded: false,
      previousBookingKey: '41',
      nextBookingKey: '41',
    }),
    true,
  );
  assert.equal(
    shouldRestartCatalogFetch({
      event: 'screen_focused',
      detailsLoaded: false,
      previousBookingKey: '41',
      nextBookingKey: '41',
    }),
    true,
  );
  assert.equal(
    shouldRestartCatalogFetch({
      event: 'app_became_active',
      detailsLoaded: true,
      previousBookingKey: '41',
      nextBookingKey: '41',
    }),
    false,
  );
});

test('incomplete catalog data is missing, not an infinite skeleton', () => {
  assert.equal(
    bookingCatalogDisplay({ detailsLoaded: false, loading: true, error: undefined }),
    'loading',
  );
  assert.equal(
    bookingCatalogDisplay({ detailsLoaded: true, loading: true, error: undefined }),
    'ready',
  );
  assert.equal(
    bookingCatalogDisplay({ detailsLoaded: false, loading: false, error: undefined }),
    'missing',
  );
});

test('failed catalog fetches are errors with a retry path', () => {
  assert.equal(
    bookingCatalogDisplay({
      detailsLoaded: false,
      loading: false,
      error: 'Network request failed',
    }),
    'error',
  );
  assert.equal(bookedProviderServiceQueryError('JWT expired', null), 'JWT expired');
  assert.equal(bookedProviderServiceQueryError(null, 'timeout'), 'timeout');
  assert.equal(bookedProviderServiceQueryError(null, null), undefined);
  assert.equal(
    shouldRestartCatalogFetch({
      event: 'retry',
      detailsLoaded: false,
      previousBookingKey: '41',
      nextBookingKey: '41',
    }),
    true,
  );
});

test('repeated navigation to another booking uses a new catalog identity', () => {
  const first = bookingCatalogIdentityKey({
    bookingId: '41',
    providerId: 'prov-a',
    serviceId: 'svc-a',
  });
  const repeatSame = bookingCatalogIdentityKey({
    bookingId: '41',
    providerId: 'prov-a',
    serviceId: 'svc-a',
  });
  const nextBooking = bookingCatalogIdentityKey({
    bookingId: '42',
    providerId: 'prov-b',
    serviceId: 'svc-b',
  });
  assert.equal(first, repeatSame);
  assert.notEqual(first, nextBooking);
  assert.equal(
    shouldRestartCatalogFetch({
      event: 'repeat_navigation',
      detailsLoaded: true,
      previousBookingKey: '41',
      nextBookingKey: '42',
    }),
    true,
  );
  assert.equal(
    shouldRestartCatalogFetch({
      event: 'repeat_navigation',
      detailsLoaded: true,
      previousBookingKey: '41',
      nextBookingKey: '41',
    }),
    false,
  );
});
