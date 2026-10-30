import { parseAppNotificationType, type AppNotificationType } from '@/lib/notification-types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type { AppNotificationType };

export type AppNotification = {
  id: string;
  bookingId: string;
  type: AppNotificationType;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationMutationResult =
  | { ok: true; notification: AppNotification }
  | { ok: false; message: string };

type NotificationRow = {
  id: number | string;
  booking_id: number | string;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

const NOT_CONFIGURED = 'Notifications are unavailable until Supabase is configured.';
const SIGN_IN_REQUIRED = 'Sign in to view notifications.';
const LOAD_FAILED = 'Could not load notifications.';
const MARK_READ_FAILED = 'Could not mark this notification as read.';
const MARK_UNREAD_FAILED = 'Could not mark this notification as unread.';
const MARK_ALL_FAILED = 'Could not mark notifications as read.';

export type NotificationListMutationResult =
  | { ok: true; notifications: AppNotification[] }
  | { ok: false; message: string };

export async function fetchMyNotifications(): Promise<AppNotification[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('id, booking_id, type, title, body, read_at, created_at')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    throw new Error(error.message || LOAD_FAILED);
  }

  return (data ?? []).flatMap((row) => {
    const notification = mapNotificationRow(row as NotificationRow);
    return notification ? [notification] : [];
  });
}

export async function markNotificationReadRemote(
  notificationId: string,
): Promise<NotificationMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const numericId = parseNotificationId(notificationId);
  if (numericId === undefined) {
    return { ok: false, message: 'Invalid notification ID.' };
  }

  const { data, error } = await supabase.rpc('mark_my_notification_read', {
    p_notification_id: numericId,
  });

  if (error) {
    return { ok: false, message: error.message || MARK_READ_FAILED };
  }

  const row = data?.[0] as NotificationRow | undefined;
  const notification = row ? mapNotificationRow(row) : undefined;
  if (!notification) {
    return { ok: false, message: MARK_READ_FAILED };
  }

  return { ok: true, notification };
}

export async function markNotificationUnreadRemote(
  notificationId: string,
): Promise<NotificationMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const numericId = parseNotificationId(notificationId);
  if (numericId === undefined) {
    return { ok: false, message: 'Invalid notification ID.' };
  }

  const { data, error } = await supabase.rpc('mark_my_notification_unread', {
    p_notification_id: numericId,
  });

  if (error) {
    return { ok: false, message: error.message || MARK_UNREAD_FAILED };
  }

  const row = data?.[0] as NotificationRow | undefined;
  const notification = row ? mapNotificationRow(row) : undefined;
  if (!notification) {
    return { ok: false, message: MARK_UNREAD_FAILED };
  }

  return { ok: true, notification };
}

export async function markAllMyNotificationsReadRemote(): Promise<NotificationListMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const { data, error } = await supabase.rpc('mark_my_notifications_read');

  if (error) {
    return { ok: false, message: error.message || MARK_ALL_FAILED };
  }

  return { ok: true, notifications: mapNotificationRows(data) };
}

export async function markMyBookingNotificationsReadRemote(
  bookingId: string,
): Promise<NotificationListMutationResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: NOT_CONFIGURED };
  }

  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return { ok: false, message: SIGN_IN_REQUIRED };
  }

  const numericId = parseNotificationId(bookingId);
  if (numericId === undefined) {
    return { ok: false, message: 'Invalid booking ID.' };
  }

  const { data, error } = await supabase.rpc('mark_my_booking_notifications_read', {
    p_booking_id: numericId,
  });

  if (error) {
    return { ok: false, message: error.message || MARK_ALL_FAILED };
  }

  return { ok: true, notifications: mapNotificationRows(data) };
}

function mapNotificationRows(data: unknown): AppNotification[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.flatMap((row) => {
    const notification = mapNotificationRow(row as NotificationRow);
    return notification ? [notification] : [];
  });
}

function mapNotificationRow(row: NotificationRow): AppNotification | undefined {
  const type = parseNotificationType(row.type);
  const id = stringifyId(row.id);
  const bookingId = stringifyId(row.booking_id);
  const title = row.title?.trim();
  const body = row.body?.trim();
  const createdAt = row.created_at?.trim();

  if (!type || !id || !bookingId || !title || !body || !createdAt) {
    return undefined;
  }

  const readAt = row.read_at?.trim() ? row.read_at : null;

  return {
    id,
    bookingId,
    type,
    title,
    body,
    readAt,
    createdAt,
  };
}

function parseNotificationType(value: string): AppNotificationType | undefined {
  return parseAppNotificationType(value);
}

function parseNotificationId(notificationId: string): number | undefined {
  if (!/^\d+$/.test(notificationId)) {
    return undefined;
  }

  const numericId = Number(notificationId);
  return Number.isSafeInteger(numericId) ? numericId : undefined;
}

function stringifyId(value: number | string): string | undefined {
  const id = String(value);
  return /^\d+$/.test(id) ? id : undefined;
}

async function getAuthenticatedUserId(): Promise<string | undefined> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return undefined;
  }

  return data.user.id;
}
