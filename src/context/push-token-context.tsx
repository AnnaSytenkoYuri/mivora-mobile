import { useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { useLocalAppointmentReminders } from '@/context/local-appointment-reminders-context';
import { registerMyPushToken } from '@/data/repositories/push-tokens';
import { setCurrentDevicePushToken } from '@/lib/push-token-device';
import {
  registerRemotePushTokenIfEligible,
  remotePushPlatform,
  type PushRuntimeEnvironment,
} from '@/lib/push-token-eligibility';
import {
  getRemoteExpoPushToken,
  readPushRuntimeEnvironment,
} from '@/lib/remote-push-token';

export function PushTokenProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const { permission } = useLocalAppointmentReminders();
  const generation = useRef(0);
  const userIdRef = useRef<string | undefined>(user?.id);
  const lastUserId = useRef<string | undefined>(undefined);
  const lastToken = useRef<string | undefined>(undefined);
  userIdRef.current = user?.id;

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const requestedGeneration = generation.current + 1;
    generation.current = requestedGeneration;
    const userId = user?.id;

    if (!userId) {
      lastUserId.current = undefined;
      lastToken.current = undefined;
      setCurrentDevicePushToken(undefined);
      return;
    }

    let cancelled = false;

    async function register(env: PushRuntimeEnvironment) {
      try {
        const registered = await registerRemotePushTokenIfEligible({
          userId,
          permission,
          env,
          platform: remotePushPlatform(env.os),
          lastUserId: lastUserId.current,
          lastToken: lastToken.current,
          requestedGeneration,
          currentGeneration: () => generation.current,
          currentUserId: () => userIdRef.current,
          getToken: () => getRemoteExpoPushToken(env),
          register: registerMyPushToken,
        });
        if (cancelled || registered === undefined) {
          return;
        }

        lastUserId.current = userId;
        lastToken.current = registered.token;
        setCurrentDevicePushToken(registered.token);
      } catch {
        // Leave lastToken unset so a later resume can retry once.
      }
    }

    void register(readPushRuntimeEnvironment());

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !cancelled) {
        void register(readPushRuntimeEnvironment());
      }
    });

    return () => {
      cancelled = true;
      generation.current += 1;
      subscription.remove();
    };
  }, [authLoading, permission, user?.id]);

  return children;
}
