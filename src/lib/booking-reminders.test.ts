import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bangkokAppointmentMs,
  reminderDedupKey,
  reminderFireMs,
  REMINDER_CATCH_UP_MS,
  shouldEnqueueBookingReminder,
} from './booking-reminders.ts';

const APPOINTMENT = bangkokAppointmentMs('2026-10-26', '15:00');
const CONFIRMED_EARLY = Date.parse('2026-10-20T00:00:00+07:00');

test('Bangkok appointment instant is date plus time at +07:00', () => {
  assert.equal(APPOINTMENT, Date.parse('2026-10-26T15:00:00+07:00'));
});

test('reminder fire times are 24 hours and 2 hours before the appointment', () => {
  assert.ok(APPOINTMENT);
  assert.equal(reminderFireMs(APPOINTMENT, 'booking_reminder_24h'), APPOINTMENT - 24 * 60 * 60 * 1000);
  assert.equal(reminderFireMs(APPOINTMENT, 'booking_reminder_2h'), APPOINTMENT - 2 * 60 * 60 * 1000);
});

test('due reminders enqueue only for confirmed future appointments', () => {
  assert.ok(APPOINTMENT);
  const at24h = reminderFireMs(APPOINTMENT, 'booking_reminder_24h');
  const input = {
    appointmentMs: APPOINTMENT,
    updatedAtMs: CONFIRMED_EARLY,
    nowMs: at24h,
    kind: 'booking_reminder_24h' as const,
  };

  assert.equal(shouldEnqueueBookingReminder({ ...input, status: 'confirmed' }), true);
  assert.equal(shouldEnqueueBookingReminder({ ...input, status: 'pending' }), false);
  assert.equal(shouldEnqueueBookingReminder({ ...input, status: 'cancelled' }), false);
  assert.equal(shouldEnqueueBookingReminder({ ...input, status: 'declined' }), false);
  assert.equal(shouldEnqueueBookingReminder({ ...input, status: 'completed' }), false);
});

test('does not enqueue before the fire time or after the appointment', () => {
  assert.ok(APPOINTMENT);
  const at24h = reminderFireMs(APPOINTMENT, 'booking_reminder_24h');
  const base = {
    status: 'confirmed',
    appointmentMs: APPOINTMENT,
    updatedAtMs: CONFIRMED_EARLY,
    kind: 'booking_reminder_24h' as const,
  };

  assert.equal(shouldEnqueueBookingReminder({ ...base, nowMs: at24h - 1 }), false);
  assert.equal(shouldEnqueueBookingReminder({ ...base, nowMs: at24h }), true);
  assert.equal(shouldEnqueueBookingReminder({ ...base, nowMs: APPOINTMENT }), false);
  assert.equal(shouldEnqueueBookingReminder({ ...base, nowMs: APPOINTMENT + 1 }), false);
});

test('does not send a late reminder when confirm or reschedule happens after the fire time', () => {
  assert.ok(APPOINTMENT);
  const at24h = reminderFireMs(APPOINTMENT, 'booking_reminder_24h');
  const at2h = reminderFireMs(APPOINTMENT, 'booking_reminder_2h');
  const confirmedThreeHoursBefore = APPOINTMENT - 3 * 60 * 60 * 1000;

  assert.equal(
    shouldEnqueueBookingReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT,
      updatedAtMs: confirmedThreeHoursBefore,
      nowMs: confirmedThreeHoursBefore,
      kind: 'booking_reminder_24h',
    }),
    false,
  );
  assert.equal(
    shouldEnqueueBookingReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT,
      updatedAtMs: confirmedThreeHoursBefore,
      nowMs: at2h,
      kind: 'booking_reminder_2h',
    }),
    true,
  );
  assert.equal(at24h < confirmedThreeHoursBefore, true);
});

test('does not enqueue a reminder that is more than one hour late, including existing confirmed bookings', () => {
  assert.ok(APPOINTMENT);
  const at24h = reminderFireMs(APPOINTMENT, 'booking_reminder_24h');
  const base = {
    status: 'confirmed',
    appointmentMs: APPOINTMENT,
    updatedAtMs: CONFIRMED_EARLY,
    kind: 'booking_reminder_24h' as const,
  };

  assert.equal(shouldEnqueueBookingReminder({ ...base, nowMs: at24h + REMINDER_CATCH_UP_MS - 1 }), true);
  assert.equal(shouldEnqueueBookingReminder({ ...base, nowMs: at24h + REMINDER_CATCH_UP_MS }), false);
  assert.equal(
    shouldEnqueueBookingReminder({ ...base, nowMs: at24h + 12 * 60 * 60 * 1000 }),
    false,
  );
});

test('reschedule uses a new appointment instant so an old delivered reminder does not collide', () => {
  const friday = bangkokAppointmentMs('2026-10-30', '10:00');
  const saturday = bangkokAppointmentMs('2026-10-31', '10:00');
  assert.ok(friday);
  assert.ok(saturday);
  assert.notEqual(
    reminderDedupKey('42', 'booking_reminder_24h', friday),
    reminderDedupKey('42', 'booking_reminder_24h', saturday),
  );
});

test('moving back to the original slot reuses the same dedup key and does not insert a second row', () => {
  const friday = bangkokAppointmentMs('2026-10-30', '10:00');
  assert.ok(friday);
  assert.equal(
    reminderDedupKey('42', 'booking_reminder_24h', friday),
    reminderDedupKey('42', 'booking_reminder_24h', friday),
  );
});
