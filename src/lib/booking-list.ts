import { getBookedProviderService } from '@/data/repositories/catalog';
import type { Booking } from '@/data/types';
import {
  bookingDetailsKey,
  type BookingCatalogDetails,
} from '@/lib/booking-groups';
import { toIsoDate } from '@/lib/booking-dates';

export { isUpcomingManageable } from '@/lib/bangkok-date';

export {
  bookingDetailsKey,
  groupBookings,
  type BookingCatalogDetails,
  type BookingWithDetails,
  type GroupedBookings,
} from '@/lib/booking-groups';

export function isUpcomingConfirmed(booking: Booking, now: Date = new Date()): boolean {
  return booking.status === 'confirmed' && booking.date >= toIsoDate(now);
}

export function isPastConfirmed(booking: Booking, now: Date = new Date()): boolean {
  return booking.status === 'confirmed' && booking.date < toIsoDate(now);
}

export async function loadBookingDetails(
  bookings: Booking[],
): Promise<Record<string, BookingCatalogDetails>> {
  const unique = new Map<string, Booking>();
  for (const booking of bookings) {
    unique.set(bookingDetailsKey(booking), booking);
  }

  const resolved = await Promise.all(
    [...unique.values()].map(async (booking) => {
      const details = await getBookedProviderService(booking.providerId, booking.serviceId);
      return [
        bookingDetailsKey(booking),
        { provider: details.provider, service: details.service },
      ] as const;
    }),
  );

  return Object.fromEntries(resolved);
}
