import {
  BOOKING_EVENT_TYPES,
  EXPO_MAX_MESSAGES_PER_REQUEST,
  EXPO_PUSH_SEND_URL,
  EXPO_REQUEST_TIMEOUT_MS,
  type ClaimedDelivery,
  type CompleteOutcome,
  type ExpoPushMessage,
  type ExpoSendResult,
  type ExpoTicket,
  isBookingEventType,
} from './push-delivery-types.ts';

const EXPO_TOKEN_PATTERN =
  /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export function isValidExpoPushToken(token: string): boolean {
  return EXPO_TOKEN_PATTERN.test(token);
}

export function sanitizePushErrorMessage(message: string | undefined): string | null {
  if (message === undefined) {
    return null;
  }

  const redacted = message
    .replace(/ExponentPushToken\[[^\]]*\]/g, '[token]')
    .replace(/ExpoPushToken\[[^\]]*\]/g, '[token]');
  const trimmed = redacted.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.length > 500 ? trimmed.slice(0, 500) : trimmed;
}

export function buildExpoPushMessage(row: ClaimedDelivery): ExpoPushMessage {
  return {
    to: row.expo_push_token,
    title: row.title,
    body: row.body,
    sound: 'default',
    data: {
      source: 'remote_booking',
      notificationId: String(row.notification_id),
      type: row.type,
    },
  };
}

export function chunkExpoMessages(
  messages: ExpoPushMessage[],
  size = EXPO_MAX_MESSAGES_PER_REQUEST,
): ExpoPushMessage[][] {
  const chunks: ExpoPushMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}

export function parseExpoTicket(value: unknown): ExpoTicket | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.status !== 'ok' && record.status !== 'error') {
    return undefined;
  }

  if (record.id !== undefined && typeof record.id !== 'string') {
    return undefined;
  }

  if (record.message !== undefined && typeof record.message !== 'string') {
    return undefined;
  }

  let details: { error?: string } | undefined;
  if (record.details !== undefined) {
    if (record.details === null || typeof record.details !== 'object' || Array.isArray(record.details)) {
      return undefined;
    }

    const error = (record.details as { error?: unknown }).error;
    if (error !== undefined && typeof error !== 'string') {
      return undefined;
    }

    if (typeof error === 'string') {
      details = { error };
    }
  }

  const ticket: ExpoTicket = { status: record.status };
  if (typeof record.id === 'string' && record.id.length > 0) {
    ticket.id = record.id;
  }
  if (typeof record.message === 'string') {
    ticket.message = record.message;
  }
  if (details !== undefined) {
    ticket.details = details;
  }

  return ticket;
}

export function classifyTicket(ticket: ExpoTicket | undefined): {
  outcome: CompleteOutcome;
  ticketId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
} {
  if (ticket === undefined) {
    return {
      outcome: 'retryable',
      ticketId: null,
      errorCode: 'ticket_missing',
      errorMessage: 'Expo ticket missing from batch response.',
    };
  }

  if (ticket.status === 'ok' && ticket.id !== undefined && ticket.id.length > 0) {
    return {
      outcome: 'sent',
      ticketId: ticket.id,
      errorCode: null,
      errorMessage: null,
    };
  }

  const errorCode = ticket.details?.error ?? 'ticket_error';
  const outcome: CompleteOutcome =
    errorCode === 'DeviceNotRegistered' || errorCode === 'MessageTooBig'
      ? 'permanent'
      : 'retryable';

  return {
    outcome,
    ticketId: null,
    errorCode,
    errorMessage: sanitizePushErrorMessage(ticket.message),
  };
}

export function classifyExpoHttpFailure(status: number): {
  outcome: CompleteOutcome;
  errorCode: string;
} {
  if (status === 429 || status >= 500 || status === 0) {
    return { outcome: 'retryable', errorCode: status === 429 ? 'TOO_MANY_REQUESTS' : 'expo_http' };
  }

  return { outcome: 'retryable', errorCode: 'expo_http' };
}

export function parseExpoTickets(payload: unknown): ExpoTicket[] | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  const data = (payload as { data?: unknown }).data;
  if (Array.isArray(data)) {
    const tickets: ExpoTicket[] = [];
    for (const item of data) {
      const ticket = parseExpoTicket(item);
      if (ticket === undefined) {
        return undefined;
      }
      tickets.push(ticket);
    }
    return tickets;
  }

  const single = parseExpoTicket(data);
  return single === undefined ? undefined : [single];
}

export function supportedBookingEventTypes(): readonly string[] {
  return BOOKING_EVENT_TYPES;
}

export function deliveryIsSendable(row: ClaimedDelivery):
  | { ok: true }
  | { ok: false; outcome: 'skipped'; errorCode: string; errorMessage: string } {
  if (!isBookingEventType(row.type)) {
    return {
      ok: false,
      outcome: 'skipped',
      errorCode: 'unsupported_type',
      errorMessage: 'Remote push sends booking events only.',
    };
  }

  if (!isValidExpoPushToken(row.expo_push_token)) {
    return {
      ok: false,
      outcome: 'skipped',
      errorCode: 'invalid_token',
      errorMessage: 'Expo push token is missing or malformed.',
    };
  }

  if (row.claim_nonce.length === 0 || !Number.isFinite(row.delivery_id)) {
    return {
      ok: false,
      outcome: 'skipped',
      errorCode: 'invalid_claim',
      errorMessage: 'Claimed delivery is missing lease identity.',
    };
  }

  return { ok: true };
}

export async function postExpoPushMessages(input: {
  messages: ExpoPushMessage[];
  accessToken: string | undefined;
  fetchImpl: typeof fetch;
}): Promise<ExpoSendResult> {
  if (input.messages.length === 0) {
    return { kind: 'tickets', tickets: [] };
  }

  if (input.messages.length > EXPO_MAX_MESSAGES_PER_REQUEST) {
    return { kind: 'http_failure', status: 400, errorCode: 'PUSH_TOO_MANY_NOTIFICATIONS' };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (input.accessToken !== undefined && input.accessToken.length > 0) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPO_REQUEST_TIMEOUT_MS);

  try {
    const response = await input.fetchImpl(EXPO_PUSH_SEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(input.messages),
      signal: controller.signal,
    });

    if (response.status !== 200) {
      const classified = classifyExpoHttpFailure(response.status);
      return { kind: 'http_failure', status: response.status, errorCode: classified.errorCode };
    }

    const payload: unknown = await response.json();
    const tickets = parseExpoTickets(payload);
    if (tickets === undefined) {
      return { kind: 'http_failure', status: 200, errorCode: 'ticket_parse' };
    }

    return { kind: 'tickets', tickets };
  } catch {
    return { kind: 'http_failure', status: 0, errorCode: 'expo_network' };
  } finally {
    clearTimeout(timer);
  }
}
