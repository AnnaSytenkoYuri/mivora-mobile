import assert from 'node:assert/strict';
import { test } from 'node:test';

import { customerPastStartRpcAllows } from './booking-rpc-guards.ts';

const OWNER = 'user-1';
const START = {
  userId: OWNER,
  date: '2026-10-19',
  time: '14:00',
};
const EXACT_START = new Date('2026-10-19T07:00:00.000Z');
const BEFORE_START = new Date('2026-10-19T06:59:59.999Z');
const AFTER_START = new Date('2026-10-19T07:00:00.001Z');

test('confirmed future bookings can still be cancelled or rescheduled', () => {
  const booking = { ...START, status: 'confirmed' };
  assert.equal(customerPastStartRpcAllows(booking, OWNER, BEFORE_START), true);
});

test('confirmed bookings at exact Bangkok start cannot be cancelled or rescheduled', () => {
  const booking = { ...START, status: 'confirmed' };
  assert.equal(customerPastStartRpcAllows(booking, OWNER, EXACT_START), false);
});

test('confirmed bookings after Bangkok start cannot be cancelled or rescheduled', () => {
  const booking = { ...START, status: 'confirmed' };
  assert.equal(customerPastStartRpcAllows(booking, OWNER, AFTER_START), false);
});

test('pending bookings keep cancel and reschedule after the original start', () => {
  const booking = { ...START, status: 'pending' };
  assert.equal(customerPastStartRpcAllows(booking, OWNER, AFTER_START), true);
  assert.equal(customerPastStartRpcAllows(booking, OWNER, BEFORE_START), true);
});

test('ownership and non-manageable statuses are unchanged', () => {
  const confirmed = { ...START, status: 'confirmed' };
  assert.equal(customerPastStartRpcAllows(confirmed, null, BEFORE_START), false);
  assert.equal(customerPastStartRpcAllows(confirmed, 'other-user', BEFORE_START), false);
  assert.equal(
    customerPastStartRpcAllows({ ...START, status: 'cancelled' }, OWNER, BEFORE_START),
    false,
  );
  assert.equal(
    customerPastStartRpcAllows({ ...START, status: 'completed' }, OWNER, BEFORE_START),
    false,
  );
});
