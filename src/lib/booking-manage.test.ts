import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isUpcomingManageable } from './bangkok-date.ts';

function booking(overrides: { status?: string; date?: string; time?: string }) {
  return {
    status: 'confirmed',
    date: '2026-10-19',
    time: '14:00',
    ...overrides,
  };
}

test('confirmed future appointment can be rescheduled or cancelled', () => {
  const now = new Date('2026-10-19T06:59:59.999Z');
  assert.equal(isUpcomingManageable(booking({ date: '2026-10-19', time: '14:00' }), now), true);
  assert.equal(isUpcomingManageable(booking({ date: '2026-10-20', time: '09:00' }), now), true);
});

test('confirmed appointment at exact Bangkok start time cannot be managed', () => {
  const now = new Date('2026-10-19T07:00:00.000Z');
  assert.equal(isUpcomingManageable(booking({ date: '2026-10-19', time: '14:00' }), now), false);
});

test('confirmed appointment after Bangkok start time cannot be managed', () => {
  const now = new Date('2026-10-19T07:00:00.001Z');
  assert.equal(isUpcomingManageable(booking({ date: '2026-10-19', time: '14:00' }), now), false);
  assert.equal(isUpcomingManageable(booking({ date: '2026-10-19', time: '10:00' }), now), false);
});

test('pending booking stays manageable on the Bangkok calendar day', () => {
  const now = new Date('2026-10-19T07:00:00.001Z');
  assert.equal(isUpcomingManageable(booking({ status: 'pending', date: '2026-10-19', time: '10:00' }), now), true);
  assert.equal(isUpcomingManageable(booking({ status: 'pending', date: '2026-10-18', time: '23:00' }), now), false);
});

test('cancelled and completed bookings are not manageable', () => {
  const now = new Date('2026-10-19T00:00:00.000Z');
  assert.equal(isUpcomingManageable(booking({ status: 'cancelled', date: '2026-10-20' }), now), false);
  assert.equal(isUpcomingManageable(booking({ status: 'completed', date: '2026-10-20' }), now), false);
});
