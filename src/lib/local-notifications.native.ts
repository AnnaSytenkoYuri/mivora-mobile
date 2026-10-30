import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  identifiersToCancelOnSignOut,
  isMivoraLocalReminderIdentifier,
  localReminderSyncPlan,
  type PlannedLocalReminder,
} from '@/lib/local-appointment-reminders';

export type LocalNotificationPermission = 'unsupported' | 'undetermined' | 'denied' | 'granted';

const ANDROID_CHANNEL_ID = 'mivora-appointments';

let handlerReady = false;
let androidChannelReady = false;

function ensureForegroundHandler() {
  if (handlerReady) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  handlerReady = true;
}

function mapPermission(
  response: Notifications.NotificationPermissionsStatus,
): LocalNotificationPermission {
  if (Platform.OS === 'ios') {
    const iosStatus = response.ios?.status;
    if (iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED) {
      return 'granted';
    }
    if (iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return 'granted';
    }
    if (iosStatus === Notifications.IosAuthorizationStatus.DENIED) {
      return 'denied';
    }
    return 'undetermined';
  }

  if (response.status === 'granted') {
    return 'granted';
  }
  if (response.status === 'denied') {
    return 'denied';
  }
  return 'undetermined';
}

export async function getLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    return mapPermission(existing);
  } catch {
    return 'denied';
  }
}

export async function requestLocalNotificationPermission(): Promise<LocalNotificationPermission> {
  ensureForegroundHandler();

  try {
    const existing = await Notifications.getPermissionsAsync();
    const current = mapPermission(existing);
    if (current === 'granted' || current === 'denied') {
      if (current === 'granted') {
        await ensureAndroidChannel();
      }
      return current;
    }

    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });
    const next = mapPermission(requested);
    if (next === 'granted') {
      await ensureAndroidChannel();
    }
    return next;
  } catch {
    return 'denied';
  }
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android' || androidChannelReady) {
    return;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Appointment reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  androidChannelReady = true;
}

async function scheduledMivoraIdentifiers(): Promise<string[]> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled
    .map((item) => item.identifier)
    .filter(isMivoraLocalReminderIdentifier);
}

export async function syncLocalAppointmentReminders(
  desired: PlannedLocalReminder[],
): Promise<void> {
  ensureForegroundHandler();

  const permission = await getLocalNotificationPermission();
  if (permission !== 'granted') {
    await cancelAccountLocalAppointmentReminders();
    return;
  }

  await ensureAndroidChannel();

  const plannedById = new Map(desired.map((item) => [item.identifier, item]));
  const sync = localReminderSyncPlan(desired.map((item) => item.identifier), await scheduledMivoraIdentifiers());

  await Promise.all(
    sync.cancel.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)),
  );

  await Promise.all(
    sync.schedule.map(async (identifier) => {
      const item = plannedById.get(identifier);
      if (!item) {
        return;
      }

      await Notifications.scheduleNotificationAsync({
        identifier: item.identifier,
        content: {
          title: item.title,
          body: item.body,
          data: {
            bookingId: item.bookingId,
            kind: item.kind,
          },
          sound: true,
        },
        trigger:
          Platform.OS === 'android'
            ? {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: new Date(item.fireAtMs),
                channelId: ANDROID_CHANNEL_ID,
              }
            : {
                type: Notifications.SchedulableTriggerInputTypes.DATE,
                date: new Date(item.fireAtMs),
              },
      });
    }),
  );
}

export async function cancelAccountLocalAppointmentReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const identifiers = identifiersToCancelOnSignOut(scheduled.map((item) => item.identifier));
  await Promise.all(
    identifiers.map((identifier) => Notifications.cancelScheduledNotificationAsync(identifier)),
  );
}
