import type { PlannedLocalReminder } from '@/lib/local-appointment-reminders';

export type LocalNotificationPermission = 'unsupported' | 'undetermined' | 'denied' | 'granted';

export async function getLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  return 'unsupported';
}

export async function requestLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  return 'unsupported';
}

export async function syncLocalAppointmentReminders(
  _desired: PlannedLocalReminder[],
): Promise<void> {}

export async function cancelAccountLocalAppointmentReminders(): Promise<void> {}
