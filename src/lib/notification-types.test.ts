import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isCustomerInboxNotification,
  isProviderInboxNotification,
  parseAppNotificationType,
} from './notification-types.ts';

test('parses booking reminder types and rejects unknown types', () => {
  assert.equal(parseAppNotificationType('booking_reminder_24h'), 'booking_reminder_24h');
  assert.equal(parseAppNotificationType('booking_reminder_2h'), 'booking_reminder_2h');
  assert.equal(parseAppNotificationType('booking_confirmed'), 'booking_confirmed');
  assert.equal(parseAppNotificationType('booking_reminder_1h'), undefined);
  assert.equal(parseAppNotificationType(''), undefined);
});

test('reminder taps are customer navigation, not provider dashboard', () => {
  assert.equal(isProviderInboxNotification('booking_reminder_24h'), false);
  assert.equal(isProviderInboxNotification('booking_reminder_2h'), false);
  assert.equal(isCustomerInboxNotification('booking_reminder_24h'), true);
  assert.equal(isCustomerInboxNotification('booking_reminder_2h'), true);
  assert.equal(isCustomerInboxNotification('booking_confirmed'), true);
  assert.equal(isProviderInboxNotification('booking_created'), true);
  assert.equal(isProviderInboxNotification('booking_cancelled'), true);
  assert.equal(isProviderInboxNotification('booking_rescheduled'), true);
});
