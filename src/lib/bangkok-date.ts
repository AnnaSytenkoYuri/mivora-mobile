export const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

const BANGKOK_OFFSET = '+07:00';
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateIso(value: string): boolean {
  if (!DATE_ISO.test(value)) {
    return false;
  }

  const date = calendarDateFromIso(value);
  return isoFromCalendarDate(date) === value;
}

export function bangkokTodayIso(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: BANGKOK_TIME_ZONE });
}

export function bangkokAppointmentMs(date: string, time: string): number | undefined {
  const normalized = time.length >= 5 ? time.slice(0, 5) : time;
  if (!DATE_ISO.test(date) || !HOUR_MINUTE.test(normalized)) {
    return undefined;
  }

  const ms = Date.parse(`${date}T${normalized}:00${BANGKOK_OFFSET}`);
  return Number.isNaN(ms) ? undefined : ms;
}

/** True when the Asia/Bangkok appointment instant is strictly after `now`. */
export function isBangkokAppointmentInFuture(
  date: string,
  time: string,
  now: Date = new Date(),
): boolean {
  const ms = bangkokAppointmentMs(date, time);
  return ms !== undefined && ms > now.getTime();
}

export function isUpcomingManageable(
  booking: { status: string; date: string; time: string },
  now: Date = new Date(),
): boolean {
  if (booking.status === 'pending') {
    return booking.date >= bangkokTodayIso(now);
  }

  if (booking.status === 'confirmed') {
    return isBangkokAppointmentInFuture(booking.date, booking.time, now);
  }

  return false;
}

export function addCalendarDaysToIso(iso: string, days: number): string {
  const match = DATE_ISO.exec(iso);
  if (!match) {
    return iso;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = utc.getUTCFullYear();
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(utc.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function isoFromCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calendarDateFromIso(iso: string): Date {
  const match = DATE_ISO.exec(iso);
  if (!match) {
    return calendarDateFromIso(bangkokTodayIso());
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day);
}

export function formatBangkokDate(iso: string): string {
  if (!isDateIso(iso)) {
    return iso;
  }

  return calendarDateFromIso(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
