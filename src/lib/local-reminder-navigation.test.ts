import assert from 'node:assert/strict';
import { test } from 'node:test';

import { localReminderIdentifier } from './local-appointment-reminders.ts';
import {
  decideLocalReminderNavigation,
  localReminderTapResponseKey,
  parseBookingIdValue,
  parseLocalReminderTapBookingId,
} from './local-reminder-navigation.ts';

const APPOINTMENT_MS = Date.parse('2026-10-28T15:00:00+07:00');
const OURS = localReminderIdentifier('41', 'booking_reminder_24h', APPOINTMENT_MS);

test('parses booking ids from notification data as strings or integers', () => {
  assert.equal(parseBookingIdValue('41'), '41');
  assert.equal(parseBookingIdValue(41), '41');
  assert.equal(
    parseLocalReminderTapBookingId({
      identifier: OURS,
      data: { bookingId: '41', kind: 'booking_reminder_24h' },
    }),
    '41',
  );
  assert.equal(
    parseLocalReminderTapBookingId({
      identifier: OURS,
      data: { bookingId: 41, kind: 'booking_reminder_2h' },
    }),
    '41',
  );
});

test('falls back to the mivora.appt. identifier when data is missing', () => {
  assert.equal(parseLocalReminderTapBookingId({ identifier: OURS, data: {} }), '41');
});

test('rejects malformed booking ids and unrelated notifications', () => {
  assert.equal(parseBookingIdValue(''), undefined);
  assert.equal(parseBookingIdValue('12abc'), undefined);
  assert.equal(parseBookingIdValue('1.5'), undefined);
  assert.equal(parseBookingIdValue(-1), undefined);
  assert.equal(
    parseLocalReminderTapBookingId({
      identifier: 'other.app.reminder',
      data: { bookingId: '41', kind: 'booking_reminder_24h' },
    }),
    undefined,
  );
  assert.equal(
    parseLocalReminderTapBookingId({
      identifier: 'Expo.go.other',
      data: { url: '/bookings/41' },
    }),
    undefined,
  );
});

test('waits until auth, navigation, and bookings are ready, then opens only owned bookings', () => {
  const pending = {
    bookingId: '41' as string | undefined,
    navigationReady: false,
    authReady: false,
    signedIn: false,
    bookingsStatus: 'idle' as const,
    bookingOwned: false,
  };

  assert.deepEqual(decideLocalReminderNavigation(pending), { action: 'wait' });
  assert.deepEqual(
    decideLocalReminderNavigation({ ...pending, navigationReady: true, authReady: true }),
    { action: 'ignore' },
  );
  assert.deepEqual(
    decideLocalReminderNavigation({
      ...pending,
      navigationReady: true,
      authReady: true,
      signedIn: true,
      bookingsStatus: 'loading',
    }),
    { action: 'wait' },
  );
  assert.deepEqual(
    decideLocalReminderNavigation({
      ...pending,
      navigationReady: true,
      authReady: true,
      signedIn: true,
      bookingsStatus: 'ready',
      bookingOwned: false,
    }),
    { action: 'ignore' },
  );
  assert.deepEqual(
    decideLocalReminderNavigation({
      ...pending,
      navigationReady: true,
      authReady: true,
      signedIn: true,
      bookingsStatus: 'ready',
      bookingOwned: true,
    }),
    { action: 'open', bookingId: '41' },
  );
});

test('does not open booking details when signed out or the payload is invalid', () => {
  assert.deepEqual(
    decideLocalReminderNavigation({
      bookingId: undefined,
      navigationReady: true,
      authReady: true,
      signedIn: true,
      bookingsStatus: 'ready',
      bookingOwned: true,
    }),
    { action: 'ignore' },
  );
  assert.deepEqual(
    decideLocalReminderNavigation({
      bookingId: '41',
      navigationReady: true,
      authReady: true,
      signedIn: false,
      bookingsStatus: 'ready',
      bookingOwned: true,
    }),
    { action: 'ignore' },
  );
});

test('waits through a failed bookings fetch so Retry can load the list', () => {
  assert.deepEqual(
    decideLocalReminderNavigation({
      bookingId: '41',
      navigationReady: true,
      authReady: true,
      signedIn: true,
      bookingsStatus: 'error',
      bookingOwned: false,
    }),
    { action: 'wait' },
  );
});

test('duplicate tap events share a response key', () => {
  const first = localReminderTapResponseKey({ identifier: OURS, dateMs: 1_700_000_000_000 });
  const second = localReminderTapResponseKey({ identifier: OURS, dateMs: 1_700_000_000_000 });
  const later = localReminderTapResponseKey({ identifier: OURS, dateMs: 1_700_000_000_001 });
  assert.equal(first, second);
  assert.notEqual(first, later);
});
