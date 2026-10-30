import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Booking, BookingStatus } from '@/data/types';

const STORAGE_KEY = 'mivora.bookings';

function parseStatus(value: unknown): BookingStatus | undefined {
  if (
    value === 'pending' ||
    value === 'confirmed' ||
    value === 'declined' ||
    value === 'completed' ||
    value === 'cancelled'
  ) {
    return value;
  }

  if (value === 'requested') {
    return 'confirmed';
  }

  return undefined;
}

function parseBooking(value: unknown): Booking | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const item = value as Record<string, unknown>;
  const status = parseStatus(item.status);

  if (
    typeof item.id !== 'string' ||
    typeof item.providerId !== 'string' ||
    typeof item.serviceId !== 'string' ||
    typeof item.date !== 'string' ||
    typeof item.time !== 'string' ||
    typeof item.createdAt !== 'string' ||
    status === undefined
  ) {
    return undefined;
  }

  return {
    id: item.id,
    providerId: item.providerId,
    serviceId: item.serviceId,
    date: item.date,
    time: item.time,
    createdAt: item.createdAt,
    status,
  };
}

export async function loadBookings(): Promise<Booking[]> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      const booking = parseBooking(item);
      return booking ? [booking] : [];
    });
  } catch {
    return [];
  }
}

export async function saveBookings(bookings: Booking[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
}
