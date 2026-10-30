import type { PushRuntimeEnvironment } from '@/lib/push-token-eligibility';

export function readPushRuntimeEnvironment(): PushRuntimeEnvironment {
  return {
    os: 'web',
    isDevice: false,
    appOwnership: null,
    projectId: undefined,
  };
}

export async function getRemoteExpoPushToken(
  _env: PushRuntimeEnvironment,
): Promise<string | undefined> {
  return undefined;
}
