import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canRequestRemotePushToken,
  isExpoGoRuntime,
  registerRemotePushTokenIfEligible,
  remotePushPlatform,
  shouldApplyPushTokenRegistration,
  shouldRegisterRemotePushToken,
  shouldSkipDuplicatePushRegistration,
  unregisterCurrentDevicePushTokenOnSignOut,
  type PushRuntimeEnvironment,
} from './push-token-eligibility.ts';

const DEVICE: PushRuntimeEnvironment = {
  os: 'ios',
  isDevice: true,
  appOwnership: null,
  projectId: 'f4c39036-5d44-4bd2-b1d6-d51d9868be2e',
};

const TOKEN = 'ExponentPushToken[abc123]';

test('detects Expo Go and never treats it as remote-push capable', () => {
  assert.equal(isExpoGoRuntime({ appOwnership: 'expo' }), true);
  assert.equal(isExpoGoRuntime({ appOwnership: null }), false);
  assert.equal(
    canRequestRemotePushToken({
      ...DEVICE,
      appOwnership: 'expo',
    }),
    false,
  );
});

test('web, simulators, and missing projectId cannot request an Expo push token', () => {
  assert.equal(canRequestRemotePushToken({ ...DEVICE, os: 'web' }), false);
  assert.equal(canRequestRemotePushToken({ ...DEVICE, isDevice: false }), false);
  assert.equal(canRequestRemotePushToken({ ...DEVICE, projectId: undefined }), false);
  assert.equal(canRequestRemotePushToken(DEVICE), true);
  assert.equal(remotePushPlatform('web'), undefined);
  assert.equal(remotePushPlatform('ios'), 'ios');
});

test('registers only when signed in, permission is granted, and the runtime supports push', () => {
  assert.equal(
    shouldRegisterRemotePushToken({
      userId: 'user-a',
      permission: 'granted',
      env: DEVICE,
    }),
    true,
  );
  assert.equal(
    shouldRegisterRemotePushToken({
      userId: undefined,
      permission: 'granted',
      env: DEVICE,
    }),
    false,
  );
  assert.equal(
    shouldRegisterRemotePushToken({
      userId: 'user-a',
      permission: 'undetermined',
      env: DEVICE,
    }),
    false,
  );
  assert.equal(
    shouldRegisterRemotePushToken({
      userId: 'user-a',
      permission: 'granted',
      env: { ...DEVICE, appOwnership: 'expo' },
    }),
    false,
  );
});

test('does not call getToken or register when ineligible', async () => {
  let gotToken = false;
  let registered = false;
  const result = await registerRemotePushTokenIfEligible({
    userId: 'user-a',
    permission: 'granted',
    env: { ...DEVICE, appOwnership: 'expo' },
    platform: 'ios',
    lastUserId: undefined,
    lastToken: undefined,
    requestedGeneration: 1,
    currentGeneration: () => 1,
    currentUserId: () => 'user-a',
    getToken: async () => {
      gotToken = true;
      return TOKEN;
    },
    register: async () => {
      registered = true;
      return { ok: true };
    },
  });
  assert.equal(result, undefined);
  assert.equal(gotToken, false);
  assert.equal(registered, false);
});

test('skips a duplicate RPC for the same user and token', async () => {
  let registered = 0;
  const result = await registerRemotePushTokenIfEligible({
    userId: 'user-a',
    permission: 'granted',
    env: DEVICE,
    platform: 'ios',
    lastUserId: 'user-a',
    lastToken: TOKEN,
    requestedGeneration: 1,
    currentGeneration: () => 1,
    currentUserId: () => 'user-a',
    getToken: async () => TOKEN,
    register: async () => {
      registered += 1;
      return { ok: true };
    },
  });
  assert.deepEqual(result, { token: TOKEN });
  assert.equal(registered, 0);
  assert.equal(
    shouldSkipDuplicatePushRegistration({
      userId: 'user-a',
      token: TOKEN,
      lastUserId: 'user-a',
      lastToken: TOKEN,
    }),
    true,
  );
});

test('does not apply a stale registration after account switch', async () => {
  let registered = 0;
  const result = await registerRemotePushTokenIfEligible({
    userId: 'user-a',
    permission: 'granted',
    env: DEVICE,
    platform: 'ios',
    lastUserId: undefined,
    lastToken: undefined,
    requestedGeneration: 1,
    currentGeneration: () => 2,
    currentUserId: () => 'user-b',
    getToken: async () => TOKEN,
    register: async () => {
      registered += 1;
      return { ok: true };
    },
  });
  assert.equal(result, undefined);
  assert.equal(registered, 0);
  assert.equal(
    shouldApplyPushTokenRegistration({
      requestedUserId: 'user-a',
      currentUserId: 'user-b',
      requestedGeneration: 1,
      currentGeneration: 2,
    }),
    false,
  );
});

test('account switch registers the same device token for the new user', async () => {
  const calls: { token: string; platform: string }[] = [];
  const result = await registerRemotePushTokenIfEligible({
    userId: 'user-b',
    permission: 'granted',
    env: DEVICE,
    platform: 'android',
    lastUserId: 'user-a',
    lastToken: TOKEN,
    requestedGeneration: 2,
    currentGeneration: () => 2,
    currentUserId: () => 'user-b',
    getToken: async () => TOKEN,
    register: async (token, platform) => {
      calls.push({ token, platform });
      return { ok: true };
    },
  });
  assert.deepEqual(result, { token: TOKEN });
  assert.deepEqual(calls, [{ token: TOKEN, platform: 'android' }]);
});

test('does not keep a token when register fails', async () => {
  const result = await registerRemotePushTokenIfEligible({
    userId: 'user-a',
    permission: 'granted',
    env: DEVICE,
    platform: 'ios',
    lastUserId: undefined,
    lastToken: undefined,
    requestedGeneration: 1,
    currentGeneration: () => 1,
    currentUserId: () => 'user-a',
    getToken: async () => TOKEN,
    register: async () => ({ ok: false, message: 'network' }),
  });
  assert.equal(result, undefined);
});

test('drops a successful RPC if the user signed out before it landed', async () => {
  let current: string | undefined = 'user-a';
  const result = await registerRemotePushTokenIfEligible({
    userId: 'user-a',
    permission: 'granted',
    env: DEVICE,
    platform: 'ios',
    lastUserId: undefined,
    lastToken: undefined,
    requestedGeneration: 1,
    currentGeneration: () => 1,
    currentUserId: () => current,
    getToken: async () => TOKEN,
    register: async () => {
      current = undefined;
      return { ok: true };
    },
  });
  assert.equal(result, undefined);
});

test('sign-out unregisters only the current device token and ignores failures', async () => {
  const removed: string[] = [];
  await unregisterCurrentDevicePushTokenOnSignOut({
    token: TOKEN,
    unregister: async (token) => {
      removed.push(token);
    },
  });
  assert.deepEqual(removed, [TOKEN]);

  await unregisterCurrentDevicePushTokenOnSignOut({
    token: undefined,
    unregister: async (token) => {
      removed.push(token);
    },
  });
  assert.deepEqual(removed, [TOKEN]);

  await unregisterCurrentDevicePushTokenOnSignOut({
    token: TOKEN,
    unregister: async () => {
      throw new Error('offline');
    },
  });
});

test('getToken failures do not throw or retry inside the registrar', async () => {
  const result = await registerRemotePushTokenIfEligible({
    userId: 'user-a',
    permission: 'granted',
    env: DEVICE,
    platform: 'ios',
    lastUserId: undefined,
    lastToken: undefined,
    requestedGeneration: 1,
    currentGeneration: () => 1,
    currentUserId: () => 'user-a',
    getToken: async () => {
      throw new Error('network');
    },
    register: async () => ({ ok: true }),
  });
  assert.equal(result, undefined);
});

test('sign-out does not wait forever when unregister hangs', async () => {
  const started = Date.now();
  await unregisterCurrentDevicePushTokenOnSignOut({
    token: TOKEN,
    timeoutMs: 20,
    unregister: () => new Promise(() => {}),
  });
  assert.ok(Date.now() - started < 1000);
});
