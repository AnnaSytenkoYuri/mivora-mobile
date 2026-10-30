import { isHourMinute } from '@/data/repositories/provider-working-hours';
import { bangkokTodayIso, isDateIso } from '@/lib/bangkok-date';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type ScheduleException = {
  id: string;
  date: string;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

export type ScheduleExceptionDraft = {
  id?: string;
  date: string;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
};

export type ScheduleExceptionMutationResult =
  | { ok: true; exceptions: ScheduleException[] }
  | { ok: false; message: string };

type ExceptionRow = {
  id: number | string;
  provider_id: string;
  exception_date: string;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
};

const NOT_CONFIGURED = 'Schedule exceptions are unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to manage days off.';
const NOT_OWNER = 'Create a provider profile before managing days off.';
const DEFAULT_OPENS_AT = '09:00';
const DEFAULT_CLOSES_AT = '18:00';
const DUPLICATE_DATE = 'An exception already exists for this date.';

export function createEmptyExceptionDraft(now: Date = new Date()): ScheduleExceptionDraft {
  return {
    date: bangkokTodayIso(now),
    isClosed: true,
    opensAt: DEFAULT_OPENS_AT,
    closesAt: DEFAULT_CLOSES_AT,
  };
}

export function draftFromException(exception: ScheduleException): ScheduleExceptionDraft {
  return {
    id: exception.id,
    date: exception.date,
    isClosed: exception.isClosed,
    opensAt: exception.opensAt ?? DEFAULT_OPENS_AT,
    closesAt: exception.closesAt ?? DEFAULT_CLOSES_AT,
  };
}

export function validateExceptionDraft(
  draft: ScheduleExceptionDraft,
  existing: ScheduleException[],
): string | undefined {
  if (!isDateIso(draft.date)) {
    return 'Choose a valid date.';
  }

  const duplicate = existing.some((item) => item.date === draft.date && item.id !== draft.id);
  if (duplicate) {
    return DUPLICATE_DATE;
  }

  if (draft.isClosed) {
    return undefined;
  }

  if (!isHourMinute(draft.opensAt) || !isHourMinute(draft.closesAt)) {
    return 'Use 24-hour times like 09:00.';
  }

  if (draft.opensAt >= draft.closesAt) {
    return 'Opening time must be earlier than closing time. Overnight hours are not allowed.';
  }

  return undefined;
}

export async function fetchMyUpcomingScheduleExceptions(): Promise<ScheduleException[]> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    throw new Error(owned.message);
  }

  return loadUpcomingExceptions(owned.providerId);
}

export async function saveMyScheduleException(
  draft: ScheduleExceptionDraft,
  existing: ScheduleException[],
): Promise<ScheduleExceptionMutationResult> {
  const validationError = validateExceptionDraft(draft, existing);
  if (validationError) {
    return { ok: false, message: validationError };
  }

  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    return owned;
  }

  const payload: {
    provider_id: string;
    exception_date: string;
    is_closed: boolean;
    opens_at: string | null;
    closes_at: string | null;
  } = draft.isClosed
    ? {
        provider_id: owned.providerId,
        exception_date: draft.date,
        is_closed: true,
        opens_at: null,
        closes_at: null,
      }
    : {
        provider_id: owned.providerId,
        exception_date: draft.date,
        is_closed: false,
        opens_at: draft.opensAt,
        closes_at: draft.closesAt,
      };

  if (draft.id) {
    const { error } = await supabase
      .from('provider_schedule_exceptions')
      .update({
        exception_date: payload.exception_date,
        is_closed: payload.is_closed,
        opens_at: payload.opens_at,
        closes_at: payload.closes_at,
      })
      .eq('id', draft.id)
      .eq('provider_id', owned.providerId);

    if (error) {
      return { ok: false, message: mutationErrorMessage(error, 'Could not update this exception.') };
    }
  } else {
    const { error } = await supabase.from('provider_schedule_exceptions').insert(payload);

    if (error) {
      return { ok: false, message: mutationErrorMessage(error, 'Could not save this exception.') };
    }
  }

  return reloadExceptions(owned.providerId);
}

export async function deleteMyScheduleException(exceptionId: string): Promise<ScheduleExceptionMutationResult> {
  const owned = await requireOwnedProvider();
  if (!owned.ok) {
    return owned;
  }

  const { error } = await supabase
    .from('provider_schedule_exceptions')
    .delete()
    .eq('id', exceptionId)
    .eq('provider_id', owned.providerId);

  if (error) {
    return { ok: false, message: error.message || 'Could not delete this exception.' };
  }

  return reloadExceptions(owned.providerId);
}

async function reloadExceptions(providerId: string): Promise<ScheduleExceptionMutationResult> {
  try {
    return { ok: true, exceptions: await loadUpcomingExceptions(providerId) };
  } catch (caught: unknown) {
    return {
      ok: false,
      message: caught instanceof Error ? caught.message : 'Could not load days off.',
    };
  }
}

async function loadUpcomingExceptions(providerId: string): Promise<ScheduleException[]> {
  const { data, error } = await supabase
    .from('provider_schedule_exceptions')
    .select('id, provider_id, exception_date, is_closed, opens_at, closes_at')
    .eq('provider_id', providerId)
    .gte('exception_date', bangkokTodayIso())
    .order('exception_date', { ascending: true });

  if (error) {
    throw new Error(error.message || 'Could not load days off.');
  }

  return ((data ?? []) as ExceptionRow[])
    .map(mapExceptionRow)
    .filter((row): row is ScheduleException => row !== undefined);
}

function mapExceptionRow(row: ExceptionRow): ScheduleException | undefined {
  const date = row.exception_date?.slice(0, 10);
  if (!date || !isDateIso(date) || row.id === undefined || row.id === null) {
    return undefined;
  }

  if (row.is_closed) {
    return {
      id: String(row.id),
      date,
      isClosed: true,
      opensAt: null,
      closesAt: null,
    };
  }

  const opensAt = normalizeTime(row.opens_at);
  const closesAt = normalizeTime(row.closes_at);
  if (!opensAt || !closesAt) {
    return undefined;
  }

  return {
    id: String(row.id),
    date,
    isClosed: false,
    opensAt,
    closesAt,
  };
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

function mutationErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === '23505') {
    return DUPLICATE_DATE;
  }

  return error.message || fallback;
}

function normalizeTime(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.slice(0, 5);
  return isHourMinute(normalized) ? normalized : undefined;
}
