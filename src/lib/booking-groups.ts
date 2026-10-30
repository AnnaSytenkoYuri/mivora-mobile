import type { Booking, Provider, Service } from '../data/types';

export type BookingWithDetails = {
  booking: Booking;
  provider: Provider;
  service: Service;
};

export type BookingCatalogDetails = {
  provider: Provider;
  service: Service;
};

export type GroupedBookings = {
  upcoming: BookingWithDetails[];
  past: BookingWithDetails[];
  cancelled: BookingWithDetails[];
  declined: BookingWithDetails[];
};

function sortKey(booking: Booking): string {
  return `${booking.date}T${booking.time}`;
}

function todayIso(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function bookingDetailsKey(booking: Pick<Booking, 'providerId' | 'serviceId'>): string {
  return `${booking.providerId}:${booking.serviceId}`;
}

export function groupBookings(
  bookings: Booking[],
  detailsByKey: Readonly<Record<string, BookingCatalogDetails>>,
  now: Date = new Date(),
): GroupedBookings {
  const today = todayIso(now);
  const upcoming: BookingWithDetails[] = [];
  const past: BookingWithDetails[] = [];
  const cancelled: BookingWithDetails[] = [];
  const declined: BookingWithDetails[] = [];

  for (const booking of bookings) {
    const details = detailsByKey[bookingDetailsKey(booking)];
    if (!details) {
      continue;
    }

    const resolved: BookingWithDetails = {
      booking,
      provider: details.provider,
      service: details.service,
    };

    if (booking.status === 'cancelled') {
      cancelled.push(resolved);
      continue;
    }

    if (booking.status === 'declined') {
      declined.push(resolved);
      continue;
    }

    if (booking.date < today) {
      past.push(resolved);
    } else {
      upcoming.push(resolved);
    }
  }

  upcoming.sort((a, b) => sortKey(a.booking).localeCompare(sortKey(b.booking)));
  past.sort((a, b) => sortKey(b.booking).localeCompare(sortKey(a.booking)));
  cancelled.sort((a, b) => sortKey(b.booking).localeCompare(sortKey(a.booking)));
  declined.sort((a, b) => sortKey(b.booking).localeCompare(sortKey(a.booking)));

  return { upcoming, past, cancelled, declined };
}
