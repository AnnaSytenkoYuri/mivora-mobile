import {
  UNPUBLISH_TO_CLEAR_HOURS,
  canClearWeeklyHoursWhilePublished,
  mapPublishedIntegrityError,
} from '@/lib/published-integrity';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WeekdayHoursDraft = {
  weekday: Weekday;
  label: string;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
};

export type WorkingHoursMutationResult =
  | { ok: true }
  | { ok: false; message: string };

type WorkingHoursRow = {
  provider_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
};

const NOT_CONFIGURED = 'Working hours are unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to manage working hours.';
const NOT_OWNER = 'Create a provider profile before managing working hours.';
const DEFAULT_OPENS_AT = '09:00';
const DEFAULT_CLOSES_AT = '18:00';

export const WEEKDAY_ORDER: { weekday: Weekday; label: string }[] = [
  { weekday: 1, label: 'Monday' },
  { weekday: 2, label: 'Tuesday' },
  { weekday: 3, label: 'Wednesday' },
  { weekday: 4, label: 'Thursday' },
  { weekday: 5, label: 'Friday' },
  { weekday: 6, label: 'Saturday' },
  { weekday: 0, label: 'Sunday' },
];

export function createEmptyWorkingHoursDraft(): WeekdayHoursDraft[] {
  return WEEKDAY_ORDER.map((day) => ({
    weekday: day.weekday,
    label: day.label,
    isOpen: false,
    opensAt: DEFAULT_OPENS_AT,
    closesAt: DEFAULT_CLOSES_AT,
  }));
}

export function validateWorkingHoursDraft(days: WeekdayHoursDraft[]): string | undefined {
  for (const day of days) {
    if (!day.isOpen) {
      continue;
    }

    if (!isHourMinute(day.opensAt) || !isHourMinute(day.closesAt)) {
      return `${day.label}: use 24-hour times like 09:00.`;
    }

    if (day.opensAt >= day.closesAt) {
      return `${day.label}: opening time must be earlier than closing time. Overnight hours are not allowed.`;
    }
  }

  return undefined;
}

export async function fetchMyWorkingHours(): Promise<WeekdayHoursDraft[]> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    throw new Error(owned.message);
  }

  const { data, error } = await supabase
    .from('provider_working_hours')
    .select('provider_id, weekday, opens_at, closes_at')
    .eq('provider_id', owned.providerId);

  if (error) {
    throw new Error(error.message || 'Could not load working hours.');
  }

  const byWeekday = new Map<Weekday, WorkingHoursRow>();
  for (const row of (data ?? []) as WorkingHoursRow[]) {
    const weekday = asWeekday(row.weekday);
    if (weekday === undefined) {
      continue;
    }

    byWeekday.set(weekday, row);
  }

  return WEEKDAY_ORDER.map((day) => {
    const row = byWeekday.get(day.weekday);
    if (!row) {
      return {
        weekday: day.weekday,
        label: day.label,
        isOpen: false,
        opensAt: DEFAULT_OPENS_AT,
        closesAt: DEFAULT_CLOSES_AT,
      };
    }

    return {
      weekday: day.weekday,
      label: day.label,
      isOpen: true,
      opensAt: normalizeTime(row.opens_at),
      closesAt: normalizeTime(row.closes_at),
    };
  });
}

export async function saveMyWorkingHours(days: WeekdayHoursDraft[]): Promise<WorkingHoursMutationResult> {
  const validationError = validateWorkingHoursDraft(days);
  if (validationError) {
    return { ok: false, message: validationError };
  }

  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    return owned;
  }

  const openDays = days.filter((day) => day.isOpen);
  const closedWeekdays = days.filter((day) => !day.isOpen).map((day) => day.weekday);

  const { data: providerRow, error: publishedError } = await supabase
    .from('providers')
    .select('published')
    .eq('id', owned.providerId)
    .maybeSingle();

  if (publishedError) {
    return { ok: false, message: publishedError.message || 'Could not save working hours.' };
  }

  if (!canClearWeeklyHoursWhilePublished(providerRow?.published === true, openDays.length)) {
    return { ok: false, message: UNPUBLISH_TO_CLEAR_HOURS };
  }

  if (openDays.length > 0) {
    const { error: upsertError } = await supabase.from('provider_working_hours').upsert(
      openDays.map((day) => ({
        provider_id: owned.providerId,
        weekday: day.weekday,
        opens_at: day.opensAt,
        closes_at: day.closesAt,
      })),
      { onConflict: 'provider_id,weekday' },
    );

    if (upsertError) {
      return {
        ok: false,
        message:
          mapPublishedIntegrityError(upsertError.message) ??
          upsertError.message ??
          'Could not save working hours.',
      };
    }
  }

  if (closedWeekdays.length > 0) {
    const { error: deleteError } = await supabase
      .from('provider_working_hours')
      .delete()
      .eq('provider_id', owned.providerId)
      .in('weekday', closedWeekdays);

    if (deleteError) {
      return {
        ok: false,
        message:
          mapPublishedIntegrityError(deleteError.message) ??
          deleteError.message ??
          'Could not save working hours.',
      };
    }
  }

  return { ok: true };
}

async function requireOwnedProvider(): Promise<
  { ok: true; providerId: string } | { ok: false; message: string }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const { data, error } = await supabase
    .from('providers')
    .select('id')
    .eq('owner_id', user.id)
    .order('name')
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, message: error.message || NOT_OWNER };
  }

  if (!data?.id) {
    return { ok: false, message: NOT_OWNER };
  }

  return { ok: true, providerId: data.id as string };
}

function asWeekday(value: number): Weekday | undefined {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6) {
    return value;
  }

  return undefined;
}

export function isHourMinute(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeTime(value: string): string {
  const normalized = value.slice(0, 5);
  return isHourMinute(normalized) ? normalized : DEFAULT_OPENS_AT;
}
