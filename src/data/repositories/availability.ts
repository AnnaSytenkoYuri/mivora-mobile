import { isHourMinute } from '@/data/repositories/provider-working-hours';
import type {
  AvailabilityException,
  AvailabilityWeeklyHours,
  OccupiedInterval,
} from '@/lib/availability';
import { isDateIso } from '@/lib/bangkok-date';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type PublishedProviderAvailability = {
  weeklyHours: AvailabilityWeeklyHours[];
  exceptions: AvailabilityException[];
  occupiedIntervals: OccupiedInterval[];
};

type WorkingHoursRow = {
  weekday: number;
  opens_at: string;
  closes_at: string;
};

type ExceptionRow = {
  exception_date: string;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
};

type OccupiedRow = {
  start_time: string;
  duration_minutes: number | string;
};

const NOT_CONFIGURED = 'Availability is unavailable until Supabase is configured.';
const LOAD_FAILED = 'Could not load availability.';
const OCCUPANCY_FAILED = 'Could not load occupied times.';

export async function fetchPublishedProviderAvailability(input: {
  providerId: string;
  date: string;
}): Promise<PublishedProviderAvailability> {
  if (!isSupabaseConfigured()) {
    throw new Error(NOT_CONFIGURED);
  }

  if (!input.providerId.trim() || !isDateIso(input.date)) {
    throw new Error(LOAD_FAILED);
  }

  const [weeklyHours, exceptions, occupiedIntervals] = await Promise.all([
    loadWeeklyHours(input.providerId),
    loadExceptionForDate(input.providerId, input.date),
    loadOccupiedIntervals(input.providerId, input.date),
  ]);

  return { weeklyHours, exceptions, occupiedIntervals };
}

async function loadWeeklyHours(providerId: string): Promise<AvailabilityWeeklyHours[]> {
  const { data, error } = await supabase
    .from('provider_working_hours')
    .select('weekday, opens_at, closes_at')
    .eq('provider_id', providerId);

  if (error) {
    throw new Error(error.message || LOAD_FAILED);
  }

  const hours: AvailabilityWeeklyHours[] = [];
  for (const row of (data ?? []) as WorkingHoursRow[]) {
    const weekday = asWeekday(row.weekday);
    const opensAt = normalizeTime(row.opens_at);
    const closesAt = normalizeTime(row.closes_at);
    if (weekday === undefined || !opensAt || !closesAt) {
      continue;
    }

    hours.push({ weekday, opensAt, closesAt });
  }

  return hours;
}

async function loadExceptionForDate(
  providerId: string,
  date: string,
): Promise<AvailabilityException[]> {
  const { data, error } = await supabase
    .from('provider_schedule_exceptions')
    .select('exception_date, is_closed, opens_at, closes_at')
    .eq('provider_id', providerId)
    .eq('exception_date', date);

  if (error) {
    throw new Error(error.message || LOAD_FAILED);
  }

  const exceptions: AvailabilityException[] = [];
  for (const row of (data ?? []) as ExceptionRow[]) {
    const exceptionDate = row.exception_date?.slice(0, 10);
    if (!exceptionDate || !isDateIso(exceptionDate)) {
      continue;
    }

    if (row.is_closed) {
      exceptions.push({ date: exceptionDate, isClosed: true, opensAt: null, closesAt: null });
      continue;
    }

    const opensAt = normalizeTime(row.opens_at);
    const closesAt = normalizeTime(row.closes_at);
    if (!opensAt || !closesAt) {
      continue;
    }

    exceptions.push({ date: exceptionDate, isClosed: false, opensAt, closesAt });
  }

  return exceptions;
}

async function loadOccupiedIntervals(providerId: string, date: string): Promise<OccupiedInterval[]> {
  const { data, error } = await supabase.rpc('list_provider_occupied_intervals', {
    p_provider_id: providerId,
    p_date: date,
  });

  if (error) {
    throw new Error(error.message || OCCUPANCY_FAILED);
  }

  if (!Array.isArray(data)) {
    throw new Error(OCCUPANCY_FAILED);
  }

  const intervals: OccupiedInterval[] = [];
  for (const row of data as OccupiedRow[]) {
    const startTime = normalizeTime(row.start_time);
    const durationMinutes = asPositiveInt(row.duration_minutes);
    if (!startTime || durationMinutes === undefined) {
      throw new Error(OCCUPANCY_FAILED);
    }

    intervals.push({ startTime, durationMinutes });
  }

  return intervals;
}

function asWeekday(value: number): AvailabilityWeeklyHours['weekday'] | undefined {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6) {
    return value;
  }

  return undefined;
}

function asPositiveInt(value: number | string): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function normalizeTime(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.slice(0, 5);
  return isHourMinute(normalized) ? normalized : undefined;
}
