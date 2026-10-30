import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Booking, Provider, Service } from '../data/types.ts';
import { bookingDetailsKey, groupBookings } from './booking-groups.ts';

const NOW = new Date(2026, 9, 19, 12, 0, 0);
const PROVIDER: Provider = {
  id: 'p1',
  kind: 'salon',
  name: 'Glow Studio',
  bio: 'Nails',
  categories: ['nails'],
  area: 'Sukhumvit',
  city: 'Bangkok',
  rating: 4.8,
  reviewCount: 12,
  startingPriceThb: 500,
  imageUrl: '',
  featured: false,
  services: [],
  portfolio: [],
  reviews: [],
};
const SERVICE: Service = {
  id: 's1',
  name: 'Gel manicure',
  category: 'nails',
  durationMinutes: 60,
  priceThb: 800,
};
const DETAILS = {
  [bookingDetailsKey({ providerId: 'p1', serviceId: 's1' })]: {
    provider: PROVIDER,
    service: SERVICE,
  },
};

function booking(overrides: Partial<Booking>): Booking {
  return {
    id: 'b1',
    providerId: 'p1',
    serviceId: 's1',
    date: '2026-10-20',
    time: '10:00',
    createdAt: '2026-10-01T00:00:00.000Z',
    status: 'confirmed',
    ...overrides,
  };
}

test('groups upcoming, past, cancelled, and declined without mixing buckets', () => {
  const grouped = groupBookings(
    [
      booking({ id: 'upcoming', date: '2026-10-19', time: '15:00', status: 'pending' }),
      booking({ id: 'past', date: '2026-10-18', time: '11:00', status: 'completed' }),
      booking({ id: 'cancelled', date: '2026-10-22', time: '09:00', status: 'cancelled' }),
      booking({ id: 'declined', date: '2026-10-21', time: '13:00', status: 'declined' }),
    ],
    DETAILS,
    NOW,
  );

  assert.deepEqual(
    grouped.upcoming.map((item) => item.booking.id),
    ['upcoming'],
  );
  assert.deepEqual(
    grouped.past.map((item) => item.booking.id),
    ['past'],
  );
  assert.deepEqual(
    grouped.cancelled.map((item) => item.booking.id),
    ['cancelled'],
  );
  assert.deepEqual(
    grouped.declined.map((item) => item.booking.id),
    ['declined'],
  );
});

test('sorts upcoming soonest first and other sections newest first', () => {
  const grouped = groupBookings(
    [
      booking({ id: 'u-late', date: '2026-10-22', time: '09:00' }),
      booking({ id: 'u-soon', date: '2026-10-20', time: '11:00' }),
      booking({ id: 'p-old', date: '2026-10-10', time: '10:00', status: 'completed' }),
      booking({ id: 'p-new', date: '2026-10-18', time: '10:00', status: 'completed' }),
      booking({ id: 'c-old', date: '2026-10-11', time: '10:00', status: 'cancelled' }),
      booking({ id: 'c-new', date: '2026-10-17', time: '10:00', status: 'cancelled' }),
    ],
    DETAILS,
    NOW,
  );

  assert.deepEqual(
    grouped.upcoming.map((item) => item.booking.id),
    ['u-soon', 'u-late'],
  );
  assert.deepEqual(
    grouped.past.map((item) => item.booking.id),
    ['p-new', 'p-old'],
  );
  assert.deepEqual(
    grouped.cancelled.map((item) => item.booking.id),
    ['c-new', 'c-old'],
  );
});

test('omits bookings until catalog details are available', () => {
  const grouped = groupBookings(
    [booking({ id: 'ready' }), booking({ id: 'pending-details', providerId: 'p2', serviceId: 's2' })],
    DETAILS,
    NOW,
  );

  assert.deepEqual(
    grouped.upcoming.map((item) => item.booking.id),
    ['ready'],
  );
});
