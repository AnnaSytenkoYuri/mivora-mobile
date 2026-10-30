const LOCAL_REMINDER_ID_PREFIX = 'mivora.appt.';
const BOOKING_ID = /^\d+$/;
const LOCAL_REMINDER_KINDS = new Set(['booking_reminder_24h', 'booking_reminder_2h']);

export type LocalReminderTapPayload = {
  identifier: string;
  data: unknown;
  actionIdentifier: string;
  dateMs: number;
};

export type LocalReminderNavDecision =
  | { action: 'wait' }
  | { action: 'ignore' }
  | { action: 'open'; bookingId: string };

export function parseBookingIdValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }

  if (typeof value === 'string' && BOOKING_ID.test(value)) {
    return value;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function bookingIdFromIdentifier(identifier: string): string | undefined {
  if (!identifier.startsWith(LOCAL_REMINDER_ID_PREFIX)) {
    return undefined;
  }

  return parseBookingIdValue(identifier.slice(LOCAL_REMINDER_ID_PREFIX.length).split(':')[0]);
}

export function parseLocalReminderTapBookingId(payload: {
  identifier?: string;
  data?: unknown;
}): string | undefined {
  const identifier = payload.identifier ?? '';
  const data = asRecord(payload.data);
  const fromData = parseBookingIdValue(data?.bookingId);
  const fromIdentifier = bookingIdFromIdentifier(identifier);
  const isOurKind = typeof data?.kind === 'string' && LOCAL_REMINDER_KINDS.has(data.kind);

  if (identifier.startsWith(LOCAL_REMINDER_ID_PREFIX)) {
    return fromData ?? fromIdentifier;
  }

  if (identifier.length === 0 && isOurKind) {
    return fromData;
  }

  return undefined;
}

export function localReminderTapResponseKey(payload: {
  identifier: string;
  dateMs: number;
  data?: unknown;
}): string {
  const scheduledAt = asRecord(payload.data)?.scheduledAt;
  return `${payload.identifier}:${payload.dateMs}:${scheduledAt ?? ''}`;
}

export function decideLocalReminderNavigation(input: {
  bookingId: string | undefined;
  navigationReady: boolean;
  authReady: boolean;
  signedIn: boolean;
  bookingsStatus: 'idle' | 'loading' | 'ready' | 'error';
  bookingOwned: boolean;
}): LocalReminderNavDecision {
  if (input.bookingId === undefined) {
    return { action: 'ignore' };
  }

  if (!input.navigationReady || !input.authReady) {
    return { action: 'wait' };
  }

  if (!input.signedIn) {
    return { action: 'ignore' };
  }

  if (input.bookingOwned) {
    return { action: 'open', bookingId: input.bookingId };
  }

  if (input.bookingsStatus === 'idle' || input.bookingsStatus === 'loading') {
    return { action: 'wait' };
  }

  if (input.bookingsStatus === 'error') {
    return { action: 'wait' };
  }

  return { action: 'ignore' };
}
