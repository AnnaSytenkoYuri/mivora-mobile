export type PushNotificationPermission = 'unsupported' | 'undetermined' | 'denied' | 'granted';

export type PushRuntimeEnvironment = {
  os: string;
  isDevice: boolean;
  appOwnership: string | null | undefined;
  projectId: string | undefined;
};

export function isExpoGoRuntime(env: Pick<PushRuntimeEnvironment, 'appOwnership'>): boolean {
  return env.appOwnership === 'expo';
}

export function remotePushPlatform(
  os: string,
): 'ios' | 'android' | undefined {
  if (os === 'ios' || os === 'android') {
    return os;
  }

  return undefined;
}

export function canRequestRemotePushToken(env: PushRuntimeEnvironment): boolean {
  if (isExpoGoRuntime(env)) {
    return false;
  }

  if (!env.isDevice) {
    return false;
  }

  if (remotePushPlatform(env.os) === undefined) {
    return false;
  }

  if (env.projectId === undefined || env.projectId.length === 0) {
    return false;
  }

  return true;
}

export function shouldRegisterRemotePushToken(input: {
  userId: string | undefined;
  permission: PushNotificationPermission;
  env: PushRuntimeEnvironment;
}): boolean {
  return (
    input.userId !== undefined &&
    input.permission === 'granted' &&
    canRequestRemotePushToken(input.env)
  );
}

export function shouldSkipDuplicatePushRegistration(input: {
  userId: string;
  token: string;
  lastUserId: string | undefined;
  lastToken: string | undefined;
}): boolean {
  return input.lastUserId === input.userId && input.lastToken === input.token;
}

export function shouldApplyPushTokenRegistration(input: {
  requestedUserId: string;
  currentUserId: string | undefined;
  requestedGeneration: number;
  currentGeneration: number;
}): boolean {
  return (
    input.currentUserId === input.requestedUserId &&
    input.currentGeneration === input.requestedGeneration
  );
}

export const PUSH_TOKEN_SIGN_OUT_TIMEOUT_MS = 4000;

export type PushTokenRegisterResult = { ok: true } | { ok: false; message: string };

export async function registerRemotePushTokenIfEligible(input: {
  userId: string | undefined;
  permission: PushNotificationPermission;
  env: PushRuntimeEnvironment;
  platform: 'ios' | 'android' | undefined;
  lastUserId: string | undefined;
  lastToken: string | undefined;
  requestedGeneration: number;
  currentGeneration: () => number;
  currentUserId: () => string | undefined;
  getToken: () => Promise<string | undefined>;
  register: (token: string, platform: 'ios' | 'android') => Promise<PushTokenRegisterResult>;
}): Promise<{ token: string } | undefined> {
  if (
    input.userId === undefined ||
    input.platform === undefined ||
    !shouldRegisterRemotePushToken({
      userId: input.userId,
      permission: input.permission,
      env: input.env,
    })
  ) {
    return undefined;
  }

  let token: string | undefined;
  try {
    token = await input.getToken();
  } catch {
    return undefined;
  }

  if (
    token === undefined ||
    token.length === 0 ||
    !shouldApplyPushTokenRegistration({
      requestedUserId: input.userId,
      currentUserId: input.currentUserId(),
      requestedGeneration: input.requestedGeneration,
      currentGeneration: input.currentGeneration(),
    })
  ) {
    return undefined;
  }

  if (
    shouldSkipDuplicatePushRegistration({
      userId: input.userId,
      token,
      lastUserId: input.lastUserId,
      lastToken: input.lastToken,
    })
  ) {
    return { token };
  }

  const result = await input.register(token, input.platform);
  if (
    !result.ok ||
    !shouldApplyPushTokenRegistration({
      requestedUserId: input.userId,
      currentUserId: input.currentUserId(),
      requestedGeneration: input.requestedGeneration,
      currentGeneration: input.currentGeneration(),
    })
  ) {
    return undefined;
  }

  return { token };
}

export async function unregisterCurrentDevicePushTokenOnSignOut(input: {
  token: string | undefined;
  unregister: (token: string) => Promise<void>;
  timeoutMs?: number;
}): Promise<void> {
  if (input.token === undefined || input.token.length === 0) {
    return;
  }

  const timeoutMs = input.timeoutMs ?? PUSH_TOKEN_SIGN_OUT_TIMEOUT_MS;
  try {
    await Promise.race([
      input.unregister(input.token),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // Sign-out must continue even if unregister fails.
  }
}
