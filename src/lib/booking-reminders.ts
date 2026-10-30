export type BookingReminderType = 'booking_reminder_24h' | 'booking_reminder_2h';

export const BOOKING_REMINDER_HOURS: Record<BookingReminderType, number> = {
  booking_reminder_24h: 24,
  booking_reminder_2h: 2,
};

/** Matches SQL: fire_at > now() - interval '1 hour' */
export const REMINDER_CATCH_UP_MS = 60 * 60 * 1000;

const BANGKOK_OFFSET = '+07:00';
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function bangkokAppointmentMs(date: string, time: string): number | undefined {
  if (!DATE_ISO.test(date) || !HOUR_MINUTE.test(time)) {
    return undefined;
  }

  const ms = Date.parse(`${date}T${time}:00${BANGKOK_OFFSET}`);
  return Number.isNaN(ms) ? undefined : ms;
}

export function reminderFireMs(appointmentMs: number, kind: BookingReminderType): number {
  return appointmentMs - BOOKING_REMINDER_HOURS[kind] * 60 * 60 * 1000;
}

export function reminderDedupKey(
  bookingId: string,
  kind: BookingReminderType,
  appointmentMs: number,
): string {
  return `${bookingId}:${kind}:${appointmentMs}`;
}

export function shouldEnqueueBookingReminder(input: {
  status: string;
  appointmentMs: number;
  updatedAtMs: number;
  nowMs: number;
  kind: BookingReminderType;
}): boolean {
  if (input.status !== 'confirmed') {
    return false;
  }

  if (!(input.appointmentMs > input.nowMs)) {
    return false;
  }

  const fireMs = reminderFireMs(input.appointmentMs, input.kind);
  if (fireMs > input.nowMs) {
    return false;
  }

  if (fireMs <= input.nowMs - REMINDER_CATCH_UP_MS) {
    return false;
  }

  if (fireMs < input.updatedAtMs) {
    return false;
  }

  return true;
}
