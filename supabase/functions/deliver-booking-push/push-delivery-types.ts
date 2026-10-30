export const BOOKING_EVENT_TYPES = [
  'booking_created',
  'booking_confirmed',
  'booking_declined',
  'booking_cancelled',
  'booking_rescheduled',
] as const;

export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

export const PUSH_LIVE_DELIVERY_ENABLED_ENV = 'PUSH_LIVE_DELIVERY_ENABLED';
export const PUSH_RECEIPTS_ENABLED_ENV = 'PUSH_RECEIPTS_ENABLED';
export const EXPO_ACCESS_TOKEN_ENV = 'EXPO_ACCESS_TOKEN';
export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const EXPO_MAX_MESSAGES_PER_REQUEST = 100;
export const EXPO_MAX_RECEIPT_IDS_PER_REQUEST = 1000;
export const EXPO_REQUEST_TIMEOUT_MS = 20_000;

export type CompleteOutcome = 'sent' | 'retryable' | 'permanent' | 'skipped';

export type ClaimedDelivery = {
  delivery_id: number;
  notification_id: number;
  push_token_id: string;
  expo_push_token: string;
  platform: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string;
  attempt_count: number;
  claim_nonce: string;
  claimed_until: string;
};

export type CompleteClaimedPushDeliveryArgs = {
  p_delivery_id: number;
  p_claim_nonce: string;
  p_outcome: CompleteOutcome;
  p_expo_ticket_id: string | null;
  p_error_code: string | null;
  p_error_message: string | null;
};

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data: {
    source: 'remote_booking';
    notificationId: string;
    type: string;
  };
};

export type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export type ExpoSendResult =
  | { kind: 'tickets'; tickets: ExpoTicket[] }
  | { kind: 'http_failure'; status: number; errorCode: string };

export type AwaitingReceipt = {
  delivery_id: number;
  expo_ticket_id: string;
  push_token_id: string | null;
};

export type RecordPushDeliveryReceiptArgs = {
  p_delivery_id: number;
  p_expo_ticket_id: string;
  p_receipt_status: 'ok' | 'error';
  p_error_code: string | null;
};

export type ForgetUnregisteredPushTokenArgs = {
  p_delivery_id: number;
  p_push_token_id: string;
  p_expo_ticket_id: string;
};

export type ExpoReceipt = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

export type ExpoReceiptsResult =
  | { kind: 'receipts'; receipts: Record<string, ExpoReceipt> }
  | { kind: 'http_failure'; status: number; errorCode: string };

export function isLiveDeliveryEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function isReceiptsEnabled(value: string | undefined): boolean {
  return value === 'true';
}

export function isBookingEventType(value: string): value is BookingEventType {
  return (BOOKING_EVENT_TYPES as readonly string[]).includes(value);
}
