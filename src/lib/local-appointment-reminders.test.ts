import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  identifiersToCancelOnSignOut,
  localReminderFireMs,
  localReminderIdentifier,
  localReminderNotificationContent,
  localReminderSyncPlan,
  planLocalAppointmentReminders,
  shouldScheduleLocalAppointmentReminder,
  usableReminderLabel,
} from './local-appointment-reminders.ts';

const APPOINTMENT_MS = Date.parse('2026-10-28T15:00:00+07:00');
const FIRE_24H = localReminderFireMs(APPOINTMENT_MS, 'booking_reminder_24h');
const FIRE_2H = localReminderFireMs(APPOINTMENT_MS, 'booking_reminder_2h');

const CONFIRMED = {
  id: '41',
  status: 'confirmed',
  date: '2026-10-28',
  time: '15:00',
};

test('schedules 24h and 2h reminders only when those times are still in the future', () => {
  const farAhead = FIRE_24H - 60_000;
  assert.equal(
    shouldScheduleLocalAppointmentReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT_MS,
      kind: 'booking_reminder_24h',
      nowMs: farAhead,
    }),
    true,
  );
  assert.equal(
    shouldScheduleLocalAppointmentReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT_MS,
      kind: 'booking_reminder_2h',
      nowMs: farAhead,
    }),
    true,
  );

  const between = FIRE_2H - 60_000;
  assert.equal(
    shouldScheduleLocalAppointmentReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT_MS,
      kind: 'booking_reminder_24h',
      nowMs: between,
    }),
    false,
  );
  assert.equal(
    shouldScheduleLocalAppointmentReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT_MS,
      kind: 'booking_reminder_2h',
      nowMs: between,
    }),
    true,
  );
});

test('does not schedule at the exact fire time or after the appointment start', () => {
  assert.equal(
    shouldScheduleLocalAppointmentReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT_MS,
      kind: 'booking_reminder_2h',
      nowMs: FIRE_2H,
    }),
    false,
  );
  assert.equal(
    shouldScheduleLocalAppointmentReminder({
      status: 'confirmed',
      appointmentMs: APPOINTMENT_MS,
      kind: 'booking_reminder_2h',
      nowMs: APPOINTMENT_MS,
    }),
    false,
  );
});

test('only confirmed future bookings are planned', () => {
  const nowMs = FIRE_24H - 60_000;
  const planned = planLocalAppointmentReminders(
    [
      CONFIRMED,
      { ...CONFIRMED, id: '42', status: 'pending' },
      { ...CONFIRMED, id: '43', status: 'cancelled' },
      { ...CONFIRMED, id: '44', status: 'declined' },
      { ...CONFIRMED, id: '45', status: 'completed' },
    ],
    nowMs,
  );

  assert.deepEqual(
    planned.map((item) => item.identifier),
    [
      localReminderIdentifier('41', 'booking_reminder_24h', APPOINTMENT_MS),
      localReminderIdentifier('41', 'booking_reminder_2h', APPOINTMENT_MS),
    ],
  );
});

test('reschedule cancels the old identifiers and schedules the new slot', () => {
  const nowMs = FIRE_24H - 60_000;
  const previous = planLocalAppointmentReminders([CONFIRMED], nowMs);
  const moved = planLocalAppointmentReminders(
    [{ ...CONFIRMED, date: '2026-10-29', time: '11:00' }],
    nowMs,
  );
  const nextMs = Date.parse('2026-10-29T11:00:00+07:00');
  const sync = localReminderSyncPlan(
    moved.map((item) => item.identifier),
    previous.map((item) => item.identifier),
  );

  assert.deepEqual(sync.cancel, previous.map((item) => item.identifier));
  assert.deepEqual(sync.schedule, [
    localReminderIdentifier('41', 'booking_reminder_24h', nextMs),
    localReminderIdentifier('41', 'booking_reminder_2h', nextMs),
  ]);
});

test('cancelled declined and completed bookings drop their scheduled reminders', () => {
  const nowMs = FIRE_24H - 60_000;
  const previous = planLocalAppointmentReminders([CONFIRMED], nowMs);
  for (const status of ['cancelled', 'declined', 'completed']) {
    const next = planLocalAppointmentReminders([{ ...CONFIRMED, status }], nowMs);
    const sync = localReminderSyncPlan(
      next.map((item) => item.identifier),
      previous.map((item) => item.identifier),
    );
    assert.deepEqual(sync.cancel, previous.map((item) => item.identifier));
    assert.deepEqual(sync.schedule, []);
  }
});

test('sign-out cancels only Mivora appointment reminders', () => {
  const ours = localReminderIdentifier('41', 'booking_reminder_2h', APPOINTMENT_MS);
  assert.deepEqual(identifiersToCancelOnSignOut([ours, 'other.app.reminder', 'Expo.go.other']), [
    ours,
  ]);
});

test('already scheduled identifiers are not duplicated', () => {
  const id = localReminderIdentifier('41', 'booking_reminder_24h', APPOINTMENT_MS);
  assert.deepEqual(localReminderSyncPlan([id], [id]), { cancel: [], schedule: [] });
});

test('24h and 2h copy includes provider, service, and Bangkok date/time', () => {
  assert.deepEqual(
    localReminderNotificationContent({
      kind: 'booking_reminder_24h',
      date: '2026-10-28',
      time: '15:00',
      providerName: 'Lina Nails',
      serviceName: 'Gel manicure',
    }),
    {
      title: 'Tomorrow · 15:00',
      body: 'Gel manicure at Lina Nails · Wed 28 Oct',
    },
  );
  assert.deepEqual(
    localReminderNotificationContent({
      kind: 'booking_reminder_2h',
      date: '2026-10-28',
      time: '15:00',
      providerName: 'Lina Nails',
      serviceName: 'Gel manicure',
    }),
    {
      title: 'In 2 hours · 15:00',
      body: 'Gel manicure at Lina Nails · Wed 28 Oct',
    },
  );
});

test('notification copy falls back when provider or service names are missing', () => {
  assert.deepEqual(
    localReminderNotificationContent({
      kind: 'booking_reminder_24h',
      date: '2026-10-28',
      time: '15:00',
    }),
    {
      title: 'Tomorrow · 15:00',
      body: 'Wed 28 Oct · 15:00',
    },
  );
  assert.deepEqual(
    localReminderNotificationContent({
      kind: 'booking_reminder_2h',
      date: '2026-10-28',
      time: '09:30',
      providerName: '  ',
      serviceName: 'This service is no longer available',
    }),
    {
      title: 'In 2 hours · 09:30',
      body: 'Wed 28 Oct · 09:30',
    },
  );
  assert.deepEqual(
    localReminderNotificationContent({
      kind: 'booking_reminder_2h',
      date: '2026-10-28',
      time: '15:00',
      providerName: 'Lina Nails',
    }),
    {
      title: 'In 2 hours · 15:00',
      body: 'Lina Nails · Wed 28 Oct',
    },
  );
  assert.equal(usableReminderLabel(undefined), undefined);
  assert.equal(usableReminderLabel('This provider is no longer available'), undefined);
});

test('planned reminders keep identifiers and use catalog names in copy', () => {
  const planned = planLocalAppointmentReminders(
    [
      {
        ...CONFIRMED,
        providerName: 'Lina Nails',
        serviceName: 'Gel manicure',
      },
    ],
    FIRE_24H - 60_000,
  );

  assert.deepEqual(
    planned.map((item) => ({
      identifier: item.identifier,
      bookingId: item.bookingId,
      kind: item.kind,
      title: item.title,
      body: item.body,
    })),
    [
      {
        identifier: localReminderIdentifier('41', 'booking_reminder_24h', APPOINTMENT_MS),
        bookingId: '41',
        kind: 'booking_reminder_24h',
        title: 'Tomorrow · 15:00',
        body: 'Gel manicure at Lina Nails · Wed 28 Oct',
      },
      {
        identifier: localReminderIdentifier('41', 'booking_reminder_2h', APPOINTMENT_MS),
        bookingId: '41',
        kind: 'booking_reminder_2h',
        title: 'In 2 hours · 15:00',
        body: 'Gel manicure at Lina Nails · Wed 28 Oct',
      },
    ],
  );
});
