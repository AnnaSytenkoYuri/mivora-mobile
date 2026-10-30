import * as Notifications from 'expo-notifications';

import type { LocalReminderTapPayload } from '@/lib/local-reminder-navigation';

function toPayload(response: Notifications.NotificationResponse): LocalReminderTapPayload | null {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
    return null;
  }

  return {
    identifier: response.notification.request.identifier,
    data: response.notification.request.content.data,
    actionIdentifier: response.actionIdentifier,
    dateMs: Number(response.notification.date),
  };
}

export async function getLastLocalReminderTap(): Promise<LocalReminderTapPayload | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  return response ? toPayload(response) : null;
}

export function subscribeLocalReminderTaps(
  listener: (payload: LocalReminderTapPayload) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const payload = toPayload(response);
    if (payload) {
      listener(payload);
    }
  });

  return () => {
    subscription.remove();
  };
}

export async function clearLastLocalReminderTap(): Promise<void> {
  await Notifications.clearLastNotificationResponseAsync();
}
