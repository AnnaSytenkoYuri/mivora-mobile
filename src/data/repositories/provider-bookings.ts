import type { BookingStatus } from '@/data/types';
import { toIsoDate } from '@/lib/booking-dates';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type OwnedProviderBooking = {
  id: string;
  providerId: string;
  serviceId: string;
  serviceName: string;
  date: string;
  time: string;
  createdAt: string;
  status: BookingStatus;
  customerName: string;
};

export type GroupedOwnedProviderBookings = {
  upcoming: OwnedProviderBooking[];
  past: OwnedProviderBooking[];
  cancelled: OwnedProviderBooking[];
  declined: OwnedProviderBooking[];
};

export type OwnedBookingActionResult =
  | { ok: true }
  | { ok: false; message: string; stale?: boolean };

type OwnedProviderBookingRow = {
  id: number | string;
  created_at: string;
  provider_id: string;
  service_id: string;
  booking_date: string;
  booking_time: string;
  status: string;
  updated_at: string | null;
  customer_full_name?: string | null;
};

type OwnedBookingMutationRow = {
  id: number | string;
  created_at: string;
  provider_id: string;
  service_id: string;
  booking_date: string;
  booking_time: string;
  status: string;
  updated_at: string | null;
};

const NOT_CONFIGURED = 'Bookings are unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to view customer bookings.';
const LOAD_FAILED = 'Could not load customer bookings.';
const ACTION_FAILED = 'Could not update this booking.';
const STALE_STATUS = 'This booking was already updated. The list has been refreshed.';
const MISSING_SERVICE = 'This service is no longer available';
const CUSTOMER_FALLBACK = 'Customer';
const BANGKOK_OFFSET = '+07:00';

export async function fetchOwnedProviderBookings(): Promise<OwnedProviderBooking[]> {
  if (!isSupabaseConfigured()) {
    throw new Error(NOT_CONFIGURED);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error(SIGN_IN_REQUIRED);
  }

  const { data, error } = await supabase.rpc('list_owned_provider_bookings');
  if (error) {
    throw new Error(error.message || LOAD_FAILED);
  }

  const rows = (data ?? []) as OwnedProviderBookingRow[];
  const serviceNames = await loadServiceNames(
    rows.map((row) => row.service_id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  return rows.flatMap((row) => {
    const booking = mapOwnedProviderBookingRow(row, serviceNames);
    return booking ? [booking] : [];
  });
}

export async function confirmOwnedBooking(bookingId: string): Promise<OwnedBookingActionResult> {
  return mutateOwnedBooking('confirm_owned_booking', bookingId);
}

export async function declineOwnedBooking(bookingId: string): Promise<OwnedBookingActionResult> {
  return mutateOwnedBooking('decline_owned_booking', bookingId);
}

export async function completeOwnedBooking(bookingId: string): Promise<OwnedBookingActionResult> {
  return mutateOwnedBooking('complete_owned_booking', bookingId);
}

export function groupOwnedProviderBookings(
  bookings: OwnedProviderBooking[],
  now: Date = new Date(),
): GroupedOwnedProviderBookings {
  const todayIso = toIsoDate(now);
  const upcoming: OwnedProviderBooking[] = [];
  const past: OwnedProviderBooking[] = [];
  const cancelled: OwnedProviderBooking[] = [];
  const declined: OwnedProviderBooking[] = [];

  for (const booking of bookings) {
    if (booking.status === 'cancelled') {
      cancelled.push(booking);
      continue;
    }

    if (booking.status === 'declined') {
      declined.push(booking);
      continue;
    }

    if (booking.date < todayIso) {
      past.push(booking);
    } else {
      upcoming.push(booking);
    }
  }

  upcoming.sort(byDateTimeAscending);
  past.sort(byDateTimeDescending);
  cancelled.sort(byDateTimeDescending);
  declined.sort(byDateTimeDescending);

  return { upcoming, past, cancelled, declined };
}

export function isOwnedBookingCompletable(
  booking: OwnedProviderBooking,
  now: Date = new Date(),
): boolean {
  return booking.status === 'confirmed' && !isBangkokAppointmentInFuture(booking.date, booking.time, now);
}

function isBangkokAppointmentInFuture(date: string, time: string, now: Date): boolean {
  const normalizedTime = normalizeTime(time);
  const instant = Date.parse(`${date}T${normalizedTime}:00${BANGKOK_OFFSET}`);
  if (Number.isNaN(instant)) {
    return true;
  }

  return instant > now.getTime();
}

async function mutateOwnedBooking(
  rpcName: 'confirm_owned_booking' | 'decline_owned_booking' | 'complete_owned_booking',
  bookingId: string,
): Promise<OwnedBookingActionResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const numericId = parseBookingId(bookingId);
  if (numericId === undefined) {
    return { ok: false, message: 'Invalid booking ID.' };
  }

  const { data, error } = await supabase.rpc(rpcName, { p_booking_id: numericId });
  if (error) {
    return { ok: false, message: error.message || ACTION_FAILED };
  }

  const row = (data?.[0] ?? undefined) as OwnedBookingMutationRow | undefined;
  if (!row || parseStatus(row.status) === undefined) {
    return { ok: false, message: STALE_STATUS, stale: true };
  }

  return { ok: true };
}

async function loadServiceNames(serviceIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(serviceIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase.from('services').select('id, name').in('id', uniqueIds);
  if (error || !data) {
    return new Map();
  }

  const names = new Map<string, string>();
  for (const row of data as { id: string; name: string | null }[]) {
    const name = row.name?.trim();
    if (row.id && name) {
      names.set(row.id, name);
    }
  }

  return names;
}

function mapOwnedProviderBookingRow(
  row: OwnedProviderBookingRow,
  serviceNames: Map<string, string>,
): OwnedProviderBooking | undefined {
  const status = parseStatus(row.status);
  if (status === undefined || !row.provider_id || !row.service_id || !row.booking_date) {
    return undefined;
  }

  const customerName = row.customer_full_name?.trim();

  return {
    id: String(row.id),
    providerId: row.provider_id,
    serviceId: row.service_id,
    serviceName: serviceNames.get(row.service_id) ?? MISSING_SERVICE,
    date: row.booking_date.slice(0, 10),
    time: normalizeTime(row.booking_time),
    createdAt: row.created_at,
    status,
    customerName: customerName && customerName.length > 0 ? customerName : CUSTOMER_FALLBACK,
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

function parseBookingId(bookingId: string): number | undefined {
  if (!/^\d+$/.test(bookingId)) {
    return undefined;
  }

  const numericId = Number(bookingId);
  return Number.isSafeInteger(numericId) ? numericId : undefined;
}

function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

function byDateTimeAscending(a: OwnedProviderBooking, b: OwnedProviderBooking): number {
  return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
}

function byDateTimeDescending(a: OwnedProviderBooking, b: OwnedProviderBooking): number {
  return byDateTimeAscending(b, a);
}
