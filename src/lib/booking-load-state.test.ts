import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bookingDetailsViewState,
  bookingsStatusAfterUserChange,
  parseRouteBookingId,
  shouldApplyBookingsFetch,
  shouldCoalesceBookingsFetch,
} from './booking-load-state.ts';
import { localReminderTapResponseKey } from './local-reminder-navigation.ts';

test('empty or loading bookings are not treated as not found', () => {
  const base = {
    routeBookingId: '41',
    authReady: true,
    signedIn: true,
    bookingFound: false,
  };

  assert.equal(bookingDetailsViewState({ ...base, bookingsStatus: 'idle' }), 'loading');
  assert.equal(bookingDetailsViewState({ ...base, bookingsStatus: 'loading' }), 'loading');
  assert.equal(bookingDetailsViewState({ ...base, bookingsStatus: 'ready' }), 'not_found');
  assert.equal(
    bookingDetailsViewState({ ...base, bookingsStatus: 'loading', bookingFound: true }),
    'found',
  );
});

test('auth loading stays on the skeleton; signed-out is not found', () => {
  assert.equal(
    bookingDetailsViewState({
      routeBookingId: '41',
      authReady: false,
      signedIn: false,
      bookingsStatus: 'idle',
      bookingFound: false,
    }),
    'loading',
  );
  assert.equal(
    bookingDetailsViewState({
      routeBookingId: '41',
      authReady: true,
      signedIn: false,
      bookingsStatus: 'ready',
      bookingFound: false,
    }),
    'not_found',
  );
});

test('failed fetches are errors until Retry completes, not not-found', () => {
  assert.equal(
    bookingDetailsViewState({
      routeBookingId: '41',
      authReady: true,
      signedIn: true,
      bookingsStatus: 'error',
      bookingFound: false,
    }),
    'error',
  );
  assert.equal(
    bookingDetailsViewState({
      routeBookingId: '41',
      authReady: true,
      signedIn: true,
      bookingsStatus: 'error',
      bookingFound: true,
    }),
    'found',
  );
});

test('route ids accept a string or Expo Router array and reject junk', () => {
  assert.equal(parseRouteBookingId('41'), '41');
  assert.equal(parseRouteBookingId(['41']), '41');
  assert.equal(parseRouteBookingId(['12abc']), undefined);
  assert.equal(parseRouteBookingId(undefined), undefined);
});

test('stale fetches from a previous user or generation are dropped', () => {
  assert.equal(
    shouldApplyBookingsFetch({
      requestedUserId: 'user-a',
      currentUserId: 'user-a',
      requestedGeneration: 2,
      currentGeneration: 2,
    }),
    true,
  );
  assert.equal(
    shouldApplyBookingsFetch({
      requestedUserId: 'user-a',
      currentUserId: 'user-b',
      requestedGeneration: 2,
      currentGeneration: 2,
    }),
    false,
  );
  assert.equal(
    shouldApplyBookingsFetch({
      requestedUserId: 'user-a',
      currentUserId: 'user-a',
      requestedGeneration: 2,
      currentGeneration: 3,
    }),
    false,
  );
});

test('account switching clears ready state until the new user loads', () => {
  assert.equal(
    bookingsStatusAfterUserChange({ nextUserId: undefined, readyUserId: 'user-a' }),
    'idle',
  );
  assert.equal(
    bookingsStatusAfterUserChange({ nextUserId: 'user-b', readyUserId: 'user-a' }),
    'loading',
  );
  assert.equal(
    bookingsStatusAfterUserChange({ nextUserId: 'user-a', readyUserId: 'user-a' }),
    'ready',
  );
});

test('in-flight fetches for the same user are coalesced', () => {
  assert.equal(
    shouldCoalesceBookingsFetch({ currentUserId: 'user-a', inFlightUserId: 'user-a' }),
    true,
  );
  assert.equal(
    shouldCoalesceBookingsFetch({ currentUserId: 'user-a', inFlightUserId: 'user-b' }),
    false,
  );
  assert.equal(
    shouldCoalesceBookingsFetch({ currentUserId: 'user-a', inFlightUserId: undefined }),
    false,
  );
});

test('repeated taps with a new scheduledAt are not treated as the same event', () => {
  const first = localReminderTapResponseKey({
    identifier: 'mivora.appt.41:booking_reminder_2h:1',
    dateMs: 0,
    data: { scheduledAt: 100 },
  });
  const duplicate = localReminderTapResponseKey({
    identifier: 'mivora.appt.41:booking_reminder_2h:1',
    dateMs: 0,
    data: { scheduledAt: 100 },
  });
  const nextTap = localReminderTapResponseKey({
    identifier: 'mivora.appt.41:booking_reminder_2h:1',
    dateMs: 0,
    data: { scheduledAt: 200 },
  });
  assert.equal(first, duplicate);
  assert.notEqual(first, nextTap);
});
