import { BOOKING_DAY_COUNT } from '@/constants/booking';
import { addCalendarDaysToIso, bangkokTodayIso } from '@/lib/bangkok-date';

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getBookableDates(from: Date = new Date()): string[] {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const dates: string[] = [];

  for (let offset = 0; offset < BOOKING_DAY_COUNT; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    dates.push(toIsoDate(date));
  }

  return dates;
}

export function getBookableBangkokDates(from: Date = new Date()): string[] {
  const start = bangkokTodayIso(from);
  const dates: string[] = [];

  for (let offset = 0; offset < BOOKING_DAY_COUNT; offset += 1) {
    dates.push(addCalendarDaysToIso(start, offset));
  }

  return dates;
}
