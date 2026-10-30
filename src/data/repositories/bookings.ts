import type { Booking, BookingStatus } from '@/data/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type BookingMutationResult =
  | { ok: true; booking: Booking }
  | { ok: false; message: string };

type BookingRow = {
  id: number;
  created_at: string;
  user_id: string;
  provider_id: string;
  service_id: string;
  booking_date: string;
  booking_time: string;
  status: string;
  updated_at: string;
  duration_minutes?: number | string | null;
};

const SIGN_IN_TO_BOOK = 'Sign in to request a booking.';
const SIGN_IN_REQUIRED = 'Sign in to manage this booking.';
const NOT_CONFIGURED = 'Bookings are unavailable until Supabase is configured.';

export async function fetchMyBookings(): Promise<Booking[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from('bookings')
    .select(
      'id, created_at, user_id, provider_id, service_id, booking_date, booking_time, status, updated_at, duration_minutes',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message || 'Could not load bookings.');
  }

  return (data ?? []).flatMap((row) => {
    const booking = mapBookingRow(row as BookingRow);
    return booking ? [booking] : [];
  });
}

export async function createBooking(input: {
  providerId: string;
  serviceId: string;
  date: string;
  time: string;
}): Promise<BookingMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, message: SIGN_IN_TO_BOOK };
  }

  const { data, error } = await supabase.rpc('create_my_booking', {
    p_provider_id: input.providerId,
    p_service_id: input.serviceId,
    p_date: input.date,
    p_time: normalizeTime(input.time),
  });

  if (error) {
    return { ok: false, message: mapBookingSlotError(error, SIGN_IN_TO_BOOK, 'Could not create this booking.') };
  }

  const row = data?.[0] as BookingRow | undefined;
  if (!row) {
    return { ok: false, message: 'Could not create this booking.' };
  }

  const booking = mapBookingRow(row);
  if (!booking) {
    return { ok: false, message: 'Could not create this booking.' };
  }

  return { ok: true, booking };
}


export async function cancelBookingRemote(
  bookingId: string,
): Promise<BookingMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const numericId = parseBookingId(bookingId);
  if (numericId === undefined) {
    return { ok: false, message: 'Invalid booking ID.' };
  }

  const { data, error } = await supabase
    .rpc('cancel_my_booking', {
      p_booking_id: numericId,
    });

  if (error) {
    return { ok: false, message: error.message };
  }

  const row = data?.[0] as BookingRow | undefined;

  if (!row) {
    return {
      ok: false,
      message: 'Booking not found or cannot be cancelled.',
    };
  }

  const booking = mapBookingRow(row);

  if (!booking) {
    return { ok: false, message: 'Invalid booking data.' };
  }

  return { ok: true, booking };
}

export async function rescheduleBookingRemote(
  bookingId: string,
  date: string,
  time: string,
): Promise<BookingMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const numericId = parseBookingId(bookingId);
  if (numericId === undefined) {
    return { ok: false, message: 'Invalid booking ID.' };
  }

  const { data, error } = await supabase.rpc(
    'reschedule_my_booking',
    {
      p_booking_id: numericId,
      p_date: date,
      p_time: normalizeTime(time),
    },
  );

  if (error) {
    return {
      ok: false,
      message: mapBookingSlotError(error, SIGN_IN_REQUIRED, 'Could not reschedule this booking.'),
    };
  }

  const row = data?.[0] as BookingRow | undefined;

  if (!row) {
    return {
      ok: false,
      message: 'Booking not found or cannot be rescheduled.',
    };
  }

  const booking = mapBookingRow(row);

  if (!booking) {
    return { ok: false, message: 'Invalid booking data.' };
  }

  return { ok: true, booking };
}

async function getAuthenticatedUserId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return undefined;
  }

  return data.user.id;
}

function parseBookingId(bookingId: string): number | undefined {
  if (!/^\d+$/.test(bookingId)) {
    return undefined;
  }

  const numericId = Number(bookingId);
  return Number.isSafeInteger(numericId) ? numericId : undefined;
}

function mapBookingRow(row: BookingRow): Booking | undefined {
  const status = parseStatus(row.status);
  if (status === undefined) {
    return undefined;
  }

  const durationMinutes = asPositiveInt(row.duration_minutes);

  return {
    id: String(row.id),
    providerId: row.provider_id,
    serviceId: row.service_id,
    date: row.booking_date,
    time: normalizeTime(row.booking_time),
    createdAt: row.created_at,
    status,
    ...(durationMinutes !== undefined ? { durationMinutes } : {}),
  };
}
function parseStatus(value: string): BookingStatus | undefined {
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

function mapBookingSlotError(
  error: { message?: string; code?: string },
  signInMessage: string,
  fallback: string,
): string {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (code === '23P01' || /no longer available/i.test(message)) {
    return 'This time is no longer available. Choose another slot.';
  }

  if (code === '42501' || /sign in required/i.test(message)) {
    return signInMessage;
  }

  if (
    code === '23514' ||
    /slot is not bookable|not published|does not belong|duration is missing/i.test(message)
  ) {
    return 'This time is not available. Choose another date or time.';
  }

  if (code === '22023') {
    return 'Choose a valid date and time.';
  }

  return message || fallback;
}

function asPositiveInt(value: number | string | null | undefined): number | undefined {
  if (value == null) {
    return undefined;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function normalizeTime(value: string): string {
  return value.slice(0, 5);
}
