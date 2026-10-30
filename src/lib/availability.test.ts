import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BOOKING_TIME_SLOTS } from '../constants/booking.ts';
import {
  listAvailableStartTimes,
  occupiedIntervalsFromBookings,
  resolveAvailabilityDay,
  weekdayFromBangkokDate,
  withoutOwnOccupiedInterval,
  type AvailabilityInput,
} from './availability.ts';

const MONDAY = '2026-10-19';
const SUNDAY = '2026-10-18';
const WEEKLY_MONDAY_NINE_TO_SIX = [{ weekday: 1 as const, opensAt: '09:00', closesAt: '18:00' }];
const FAR_FUTURE = new Date('2026-10-01T00:00:00.000Z');

function available(overrides: Partial<AvailabilityInput> = {}) {
  return listAvailableStartTimes({
    date: MONDAY,
    weeklyHours: WEEKLY_MONDAY_NINE_TO_SIX,
    exceptions: [],
    serviceDurationMinutes: 90,
    candidateStartTimes: BOOKING_TIME_SLOTS,
    occupiedIntervals: [],
    now: FAR_FUTURE,
    ...overrides,
  });
}

test('closed weekday has no slots when weekly hours are missing', () => {
  assert.equal(weekdayFromBangkokDate(SUNDAY), 0);
  assert.deepEqual(
    available({
      date: SUNDAY,
      weeklyHours: WEEKLY_MONDAY_NINE_TO_SIX,
    }),
    [],
  );
});

test('closed date exception overrides an open weekday', () => {
  assert.deepEqual(
    available({
      exceptions: [{ date: MONDAY, isClosed: true, opensAt: null, closesAt: null }],
    }),
    [],
  );
});

test('custom opening hours replace weekly hours', () => {
  assert.deepEqual(
    available({
      exceptions: [{ date: MONDAY, isClosed: false, opensAt: '10:00', closesAt: '16:00' }],
    }),
    ['10:30', '12:00', '13:30'],
  );
});

test('service must finish at or before closing time', () => {
  assert.deepEqual(available(), ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30']);
});

test('pending and confirmed bookings block their full duration', () => {
  const occupied = occupiedIntervalsFromBookings(
    [
      { date: MONDAY, startTime: '10:30', durationMinutes: 90, status: 'pending' },
      { date: MONDAY, startTime: '15:00', durationMinutes: 90, status: 'confirmed' },
      { date: MONDAY, startTime: '12:00', durationMinutes: 90, status: 'cancelled' },
      { date: MONDAY, startTime: '13:30', durationMinutes: 90, status: 'declined' },
      { date: MONDAY, startTime: '09:00', durationMinutes: 90, status: 'completed' },
    ],
    MONDAY,
  );

  assert.deepEqual(available({ occupiedIntervals: occupied }), [
    '09:00',
    '12:00',
    '13:30',
    '16:30',
  ]);
});

test('adjacent half-open bookings do not overlap', () => {
  assert.deepEqual(
    available({
      occupiedIntervals: [{ startTime: '10:30', durationMinutes: 90 }],
    }),
    ['09:00', '12:00', '13:30', '15:00', '16:30'],
  );
});

test('past start times are excluded using Asia/Bangkok, not the device timezone', () => {
  assert.equal(weekdayFromBangkokDate(SUNDAY), 0);

  const tenThirtyBangkok = new Date('2026-10-18T03:29:59.000Z');
  assert.deepEqual(
    available({
      date: SUNDAY,
      weeklyHours: [{ weekday: 0, opensAt: '09:00', closesAt: '18:00' }],
      now: tenThirtyBangkok,
    }),
    ['10:30', '12:00', '13:30', '15:00', '16:30'],
  );

  const afterMidnightBangkok = new Date('2026-10-18T17:30:00.000Z');
  assert.deepEqual(
    available({
      date: SUNDAY,
      weeklyHours: [{ weekday: 0, opensAt: '09:00', closesAt: '18:00' }],
      now: afterMidnightBangkok,
    }),
    [],
  );
});

test('own occupied interval is ignored only on that date', () => {
  const occupied = [
    { startTime: '10:30', durationMinutes: 90 },
    { startTime: '15:00', durationMinutes: 90 },
  ];

  assert.deepEqual(
    withoutOwnOccupiedInterval(occupied, { date: MONDAY, startTime: '10:30' }, MONDAY),
    [{ startTime: '15:00', durationMinutes: 90 }],
  );
  assert.deepEqual(
    withoutOwnOccupiedInterval(occupied, { date: MONDAY, startTime: '10:30' }, SUNDAY),
    occupied,
  );
});

test('missing weekly hours is unconfigured, not a closed weekday', () => {
  const base = {
    date: MONDAY,
    exceptions: [] as const,
    serviceDurationMinutes: 90,
    candidateStartTimes: BOOKING_TIME_SLOTS,
    occupiedIntervals: [] as const,
    now: FAR_FUTURE,
  };

  assert.deepEqual(resolveAvailabilityDay({ ...base, weeklyHours: [] }), { kind: 'unconfigured' });
  assert.deepEqual(
    resolveAvailabilityDay({ ...base, date: SUNDAY, weeklyHours: WEEKLY_MONDAY_NINE_TO_SIX }),
    { kind: 'closed' },
  );
});
