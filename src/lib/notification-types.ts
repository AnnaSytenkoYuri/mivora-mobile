export const APP_NOTIFICATION_TYPES = [
  'booking_created',
  'booking_confirmed',
  'booking_declined',
  'booking_cancelled',
  'booking_rescheduled',
  'booking_reminder_24h',
  'booking_reminder_2h',
] as const;

export type AppNotificationType = (typeof APP_NOTIFICATION_TYPES)[number];

const TYPE_SET = new Set<string>(APP_NOTIFICATION_TYPES);

export function parseAppNotificationType(value: string): AppNotificationType | undefined {
  return TYPE_SET.has(value) ? (value as AppNotificationType) : undefined;
}

export function isProviderInboxNotification(type: AppNotificationType): boolean {
  return type === 'booking_created' || type === 'booking_cancelled' || type === 'booking_rescheduled';
}

export function isCustomerInboxNotification(type: AppNotificationType): boolean {
  return !isProviderInboxNotification(type);
}
