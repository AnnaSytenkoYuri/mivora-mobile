import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAuth } from '@/context/auth-context';
import { addFavorite, fetchMyFavoriteProviderIds, removeFavorite } from '@/data/repositories/favorites';
import { loadFavoriteIds, saveFavoriteIds } from '@/lib/favorite-storage';

type FavoritesContextValue = {
  favoriteIds: string[];
  hydrated: boolean;
  isFavorite: (providerId: string) => boolean;
  toggleFavorite: (providerId: string) => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function uniqueProviderIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const idsRef = useRef<string[]>([]);
  const signedIn = user !== null;
  const accountId = user?.id ?? 'guest';
  const [trackedAccountId, setTrackedAccountId] = useState(accountId);

  if (trackedAccountId !== accountId) {
    setTrackedAccountId(accountId);
    idsRef.current = [];
    setFavoriteIds([]);
    setHydrated(false);
  }

  useEffect(() => {
    idsRef.current = favoriteIds;
  }, [favoriteIds]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;
    idsRef.current = [];
    setFavoriteIds([]);
    setHydrated(false);

    const load = signedIn ? fetchMyFavoriteProviderIds() : loadFavoriteIds();

    void load.then((ids) => {
      if (cancelled) {
        return;
      }

      const next = uniqueProviderIds(ids);
      idsRef.current = next;
      setFavoriteIds(next);
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, signedIn, user?.id]);

  useEffect(() => {
    if (!hydrated || signedIn) {
      return;
    }

    void saveFavoriteIds(favoriteIds);
  }, [favoriteIds, hydrated, signedIn]);

  const isFavorite = useCallback(
    (providerId: string) => favoriteIds.includes(providerId),
    [favoriteIds],
  );

  const toggleFavorite = useCallback(
    (providerId: string) => {
      const exists = idsRef.current.includes(providerId);
      const next = exists
        ? idsRef.current.filter((id) => id !== providerId)
        : uniqueProviderIds([...idsRef.current, providerId]);

      idsRef.current = next;
      setFavoriteIds(next);

      if (!signedIn) {
        return;
      }

      if (exists) {
        void removeFavorite(providerId);
      } else {
        void addFavorite(providerId);
      }
    },
    [signedIn],
  );

  const value = useMemo(
    () => ({ favoriteIds, hydrated, isFavorite, toggleFavorite }),
    [favoriteIds, hydrated, isFavorite, toggleFavorite],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used within FavoritesProvider');
  }

  return context;
}
