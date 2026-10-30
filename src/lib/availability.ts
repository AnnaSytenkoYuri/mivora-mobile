/**
 * Pure Bangkok-local availability. Occupancy must be anonymous intervals
 * (start + duration only). Do not load public.bookings in the customer client.
 */
export type AvailabilityWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type AvailabilityBookingStatus =
  | 'pending'
  | 'confirmed'
  | 'declined'
  | 'completed'
  | 'cancelled';

export type AvailabilityWeeklyHours = {
  weekday: AvailabilityWeekday;
  opensAt: string;
  closesAt: string;
};

export type AvailabilityException = {
  date: string;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

export type OccupiedInterval = {
  startTime: string;
  durationMinutes: number;
};

export type OccupancyBooking = {
  date: string;
  startTime: string;
  durationMinutes: number;
  status: AvailabilityBookingStatus;
};

export type AvailabilityInput = {
  date: string;
  weeklyHours: readonly AvailabilityWeeklyHours[];
  exceptions: readonly AvailabilityException[];
  serviceDurationMinutes: number;
  candidateStartTimes: readonly string[];
  occupiedIntervals: readonly OccupiedInterval[];
  now?: Date;
};

export type AvailabilityDay =
  | { kind: 'unconfigured' }
  | { kind: 'closed' }
  | { kind: 'open'; startTimes: string[] };

export const AVAILABILITY_BLOCKING_STATUSES: readonly AvailabilityBookingStatus[] = [
  'pending',
  'confirmed',
];

const BANGKOK_OFFSET = '+07:00';
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function resolveAvailabilityDay(input: AvailabilityInput): AvailabilityDay {
  const window = resolveOpenWindow(input.date, input.weeklyHours, input.exceptions);
  if (window.kind === 'unconfigured' || window.kind === 'closed') {
    return { kind: window.kind };
  }

  return {
    kind: 'open',
    startTimes: listAvailableStartTimes(input),
  };
}

export function listAvailableStartTimes(input: AvailabilityInput): string[] {
  const duration = input.serviceDurationMinutes;
  if (!Number.isInteger(duration) || duration <= 0) {
    return [];
  }

  const resolved = resolveOpenWindow(input.date, input.weeklyHours, input.exceptions);
  if (resolved.kind !== 'open') {
    return [];
  }

  const occupied = input.occupiedIntervals.flatMap(toMinuteInterval);
  const nowMs = (input.now ?? new Date()).getTime();
  const hours = resolved.window;

  return input.candidateStartTimes.filter((startTime) => {
    const start = timeToMinutes(startTime);
    if (start === undefined) {
      return false;
    }

    const end = start + duration;
    if (start < hours.opens || end > hours.closes) {
      return false;
    }

    const startMs = bangkokDateTimeMs(input.date, startTime);
    if (startMs === undefined || startMs <= nowMs) {
      return false;
    }

    return occupied.every((interval) => !overlapsHalfOpen(start, end, interval.start, interval.end));
  });
}

export function withoutOwnOccupiedInterval(
  intervals: readonly OccupiedInterval[],
  own: { date: string; startTime: string } | undefined,
  onDate: string,
): OccupiedInterval[] {
  if (!own || own.date !== onDate) {
    return [...intervals];
  }

  const index = intervals.findIndex((item) => item.startTime === own.startTime);
  if (index === -1) {
    return [...intervals];
  }

  return intervals.filter((_, itemIndex) => itemIndex !== index);
}

export function occupiedIntervalsFromBookings(
  bookings: readonly OccupancyBooking[],
  onDate: string,
): OccupiedInterval[] {
  return bookings
    .filter(
      (booking) =>
        booking.date === onDate && AVAILABILITY_BLOCKING_STATUSES.includes(booking.status),
    )
    .map((booking) => ({
      startTime: booking.startTime,
      durationMinutes: booking.durationMinutes,
    }));
}

export function weekdayFromBangkokDate(date: string): AvailabilityWeekday | undefined {
  const match = DATE_ISO.exec(date);
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const parsed = new Date(utc);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }

  const weekday = parsed.getUTCDay();
  if (
    weekday === 0 ||
    weekday === 1 ||
    weekday === 2 ||
    weekday === 3 ||
    weekday === 4 ||
    weekday === 5 ||
    weekday === 6
  ) {
    return weekday;
  }

  return undefined;
}

function resolveOpenWindow(
  date: string,
  weeklyHours: readonly AvailabilityWeeklyHours[],
  exceptions: readonly AvailabilityException[],
):
  | { kind: 'unconfigured' }
  | { kind: 'closed' }
  | { kind: 'open'; window: { opens: number; closes: number } } {
  const exception = exceptions.find((item) => item.date === date);
  if (exception) {
    if (exception.isClosed) {
      return { kind: 'closed' };
    }

    const custom = minuteWindow(exception.opensAt, exception.closesAt);
    return custom ? { kind: 'open', window: custom } : { kind: 'closed' };
  }

  if (weeklyHours.length === 0) {
    return { kind: 'unconfigured' };
  }

  const weekday = weekdayFromBangkokDate(date);
  if (weekday === undefined) {
    return { kind: 'closed' };
  }

  const weekly = weeklyHours.find((item) => item.weekday === weekday);
  if (!weekly) {
    return { kind: 'closed' };
  }

  const window = minuteWindow(weekly.opensAt, weekly.closesAt);
  return window ? { kind: 'open', window } : { kind: 'closed' };
}

function minuteWindow(
  opensAt: string | null,
  closesAt: string | null,
): { opens: number; closes: number } | undefined {
  if (!opensAt || !closesAt) {
    return undefined;
  }

  const opens = timeToMinutes(opensAt);
  const closes = timeToMinutes(closesAt);
  if (opens === undefined || closes === undefined || opens >= closes) {
    return undefined;
  }

  return { opens, closes };
}

function toMinuteInterval(
  interval: OccupiedInterval,
): { start: number; end: number }[] {
  const start = timeToMinutes(interval.startTime);
  if (start === undefined || !Number.isInteger(interval.durationMinutes) || interval.durationMinutes <= 0) {
    return [];
  }

  return [{ start, end: start + interval.durationMinutes }];
}

function overlapsHalfOpen(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

function timeToMinutes(value: string): number | undefined {
  if (!HOUR_MINUTE.test(value)) {
    return undefined;
  }

  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  return hours * 60 + minutes;
}

function bangkokDateTimeMs(date: string, time: string): number | undefined {
  if (!DATE_ISO.test(date) || !HOUR_MINUTE.test(time)) {
    return undefined;
  }

  const ms = Date.parse(`${date}T${time}:00${BANGKOK_OFFSET}`);
  return Number.isNaN(ms) ? undefined : ms;
}
