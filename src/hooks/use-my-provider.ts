import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  getMyProvider,
  invalidateMyProviderCache,
  peekCachedMyProvider,
  rememberMyProvider,
  type OwnedProviderProfile,
} from '@/data/repositories/provider-setup';

export function useMyProvider(userId: string | undefined): {
  provider: OwnedProviderProfile | null | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => Promise<void>;
} {
  const peek = userId ? peekCachedMyProvider(userId) : undefined;
  const [provider, setProvider] = useState<OwnedProviderProfile | null | undefined>(peek);
  const [loading, setLoading] = useState(userId !== undefined && peek === undefined);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    if (!userId) {
      invalidateMyProviderCache();
      setProvider(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }

    const cached = peekCachedMyProvider(userId);
    if (cached !== undefined) {
      setProvider(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const next = await getMyProvider({ bypassCache: true });
      const value = next ?? null;
      rememberMyProvider(userId, value);
      setProvider(value);
      setError(undefined);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not load your business profile.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { provider, loading, error, reload: load };
}
