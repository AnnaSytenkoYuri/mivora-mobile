import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  canRequestRemotePushToken,
  type PushRuntimeEnvironment,
} from '@/lib/push-token-eligibility';

export function readPushRuntimeEnvironment(): PushRuntimeEnvironment {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;

  return {
    os: Platform.OS,
    isDevice: Device.isDevice,
    appOwnership: Constants.appOwnership ?? null,
    projectId: typeof projectId === 'string' && projectId.length > 0 ? projectId : undefined,
  };
}

export async function getRemoteExpoPushToken(
  env: PushRuntimeEnvironment,
): Promise<string | undefined> {
  if (!canRequestRemotePushToken(env) || env.projectId === undefined) {
    return undefined;
  }

  try {
    const result = await Notifications.getExpoPushTokenAsync({
      projectId: env.projectId,
    });
    const token = result.data;
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}
