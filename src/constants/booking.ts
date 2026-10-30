export const BOOKING_DAY_COUNT = 14;

export const BOOKING_TIME_SLOTS = [
  '09:00',
  '10:30',
  '12:00',
  '13:30',
  '15:00',
  '16:30',
  '18:00',
] as const;

export type BookingTimeSlot = (typeof BOOKING_TIME_SLOTS)[number];
