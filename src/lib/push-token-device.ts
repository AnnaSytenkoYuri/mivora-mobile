import { unregisterMyPushToken } from '@/data/repositories/push-tokens';
import { unregisterCurrentDevicePushTokenOnSignOut } from '@/lib/push-token-eligibility';

let currentDeviceToken: string | undefined;

export function setCurrentDevicePushToken(token: string | undefined): void {
  currentDeviceToken = token;
}

export function getCurrentDevicePushToken(): string | undefined {
  return currentDeviceToken;
}

export async function unregisterCurrentDevicePushTokenBestEffort(): Promise<void> {
  const token = currentDeviceToken;
  currentDeviceToken = undefined;
  await unregisterCurrentDevicePushTokenOnSignOut({
    token,
    unregister: unregisterMyPushToken,
  });
}
