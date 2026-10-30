import { getMyProfile } from '@/data/repositories/profiles';
import type { Booking, BookingStatus, Review } from '@/data/types';
import { getUserDisplayName } from '@/lib/auth';
import { toIsoDate } from '@/lib/booking-dates';
import { isPastConfirmed } from '@/lib/booking-list';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type ReviewMutationResult =
  | { ok: true; review: Review }
  | { ok: false; message: string };

type ReviewRow = {
  id: number | string;
  provider_id: string;
  author_name: string;
  rating: number | string;
  text: string;
  review_date: string;
  user_id: string | null;
  booking_id: number | string | null;
};

type BookingRow = {
  id: number;
  user_id: string;
  provider_id: string;
  service_id: string;
  booking_date: string;
  booking_time: string;
  status: string;
  created_at: string;
};

const NOT_CONFIGURED = 'Reviews are unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to leave a review.';
const NOT_ELIGIBLE = 'This booking cannot be reviewed.';
const ALREADY_REVIEWED = 'A review has already been submitted for this booking.';

export async function getReviewForBooking(bookingId: string): Promise<Review | undefined> {
  if (!isSupabaseConfigured()) {
    return undefined;
  }

  const numericId = parseBookingId(bookingId);
  if (numericId === undefined) {
    return undefined;
  }

  const { data, error } = await supabase
    .from('reviews')
    .select('id, provider_id, author_name, rating, text, review_date, user_id, booking_id')
    .eq('booking_id', numericId)
    .maybeSingle();

  if (error || !data) {
    return undefined;
  }

  return mapReviewRow(data as ReviewRow);
}

export async function createReview(input: {
  bookingId: string;
  rating: number;
  text: string;
}): Promise<ReviewMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, message: 'Choose a rating from 1 to 5.' };
  }

  const trimmed = input.text.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: 'Write a short review before submitting.' };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const numericId = parseBookingId(input.bookingId);
  if (numericId === undefined) {
    return { ok: false, message: NOT_ELIGIBLE };
  }

  const { data: bookingRow, error: bookingError } = await supabase
    .from('bookings')
    .select('id, user_id, provider_id, service_id, booking_date, booking_time, status, created_at')
    .eq('id', numericId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (bookingError || !bookingRow) {
    return { ok: false, message: NOT_ELIGIBLE };
  }

  const booking = mapBookingRow(bookingRow as BookingRow);
  if (!booking || !isPastConfirmed(booking)) {
    return { ok: false, message: NOT_ELIGIBLE };
  }

  const existing = await getReviewForBooking(booking.id);
  if (existing) {
    return { ok: false, message: ALREADY_REVIEWED };
  }

  const profile = await getMyProfile();
  const authorName = resolveAuthorName(user.user_metadata, user.email, profile?.fullName);

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      provider_id: booking.providerId,
      author_name: authorName,
      rating: input.rating,
      text: trimmed,
      review_date: toIsoDate(new Date()),
      user_id: user.id,
      booking_id: numericId,
    })
    .select('id, provider_id, author_name, rating, text, review_date, user_id, booking_id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, message: ALREADY_REVIEWED };
    }

    return { ok: false, message: error?.message ?? 'Could not submit this review.' };
  }

  const review = mapReviewRow(data as ReviewRow);
  if (!review) {
    return { ok: false, message: 'Could not submit this review.' };
  }

  return { ok: true, review };
}

function resolveAuthorName(
  metadata: Record<string, unknown> | undefined,
  email: string | undefined,
  profileName: string | undefined,
): string {
  const fromProfile = profileName?.trim();
  if (fromProfile) {
    return fromProfile;
  }

  const fullName = typeof metadata?.full_name === 'string' ? metadata.full_name.trim() : '';
  if (fullName.length > 0) {
    return fullName;
  }

  const fromMetadata = getUserDisplayName(metadata);
  if (fromMetadata) {
    return fromMetadata;
  }

  const emailPrefix = email?.split('@')[0]?.trim();
  if (emailPrefix) {
    return emailPrefix;
  }

  return 'Mivora user';
}

function mapReviewRow(row: ReviewRow): Review | undefined {
  const rating = typeof row.rating === 'number' ? row.rating : Number(row.rating);
  if (!Number.isFinite(rating)) {
    return undefined;
  }

  return {
    id: String(row.id),
    authorName: row.author_name,
    rating,
    text: row.text,
    createdAt: row.review_date,
  };
}

function mapBookingRow(row: BookingRow): Booking | undefined {
  const status = parseStatus(row.status);
  if (status === undefined) {
    return undefined;
  }

  return {
    id: String(row.id),
    providerId: row.provider_id,
    serviceId: row.service_id,
    date: row.booking_date,
    time: row.booking_time.slice(0, 5),
    createdAt: row.created_at,
    status,
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
