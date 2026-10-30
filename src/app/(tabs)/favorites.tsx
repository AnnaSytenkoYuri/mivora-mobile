import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProviderCard, ProviderCardSkeleton } from '@/components/provider-card';
import { ContentFadeIn } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useFavorites } from '@/context/favorites-context';
import { getProvidersByIds } from '@/data/repositories/catalog';
import type { Provider } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

export default function FavoritesScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { favoriteIds, hydrated } = useFavorites();
  const accountKey = user?.id ?? 'guest';
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [providersById, setProvidersById] = useState<Record<string, Provider>>({});
  const [resolvedIds, setResolvedIds] = useState<Record<string, true>>({});
  const [cacheAccount, setCacheAccount] = useState(accountKey);
  const [error, setError] = useState<string | undefined>();
  const scopedProviders = cacheAccount === accountKey ? providersById : {};
  const scopedResolved = cacheAccount === accountKey ? resolvedIds : {};
  const providersByIdRef = useRef(scopedProviders);
  const resolvedIdsRef = useRef(scopedResolved);
  providersByIdRef.current = scopedProviders;
  resolvedIdsRef.current = scopedResolved;

  useEffect(() => {
    setCacheAccount(accountKey);
    setProvidersById({});
    setResolvedIds({});
    setError(undefined);
  }, [accountKey]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    const missing = favoriteIds.filter(
      (id) => !providersByIdRef.current[id] && !resolvedIdsRef.current[id],
    );
    if (missing.length === 0) {
      setError(undefined);
      return;
    }

    let cancelled = false;
    void getProvidersByIds(missing)
      .then((loaded) => {
        if (cancelled) {
          return;
        }

        setProvidersById((current) => {
          const next = { ...current };
          for (const provider of loaded) {
            next[provider.id] = provider;
          }
          return next;
        });
        setResolvedIds((current) => {
          const next = { ...current };
          for (const id of missing) {
            next[id] = true;
          }
          return next;
        });
        setError(undefined);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }

        const canRender = favoriteIds.some((id) => providersByIdRef.current[id]);
        if (!canRender) {
          setError(caught instanceof Error ? caught.message : 'Could not load catalog.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accountKey, catalogEpoch, favoriteIds, hydrated]);

  const visible = favoriteIds
    .map((id) => scopedProviders[id])
    .filter((provider): provider is Provider => provider !== undefined);
  const pending = favoriteIds.some((id) => scopedProviders[id] === undefined && !scopedResolved[id]);
  const showSkeleton = !hydrated || (visible.length === 0 && pending && error === undefined);
  const savedLabel =
    favoriteIds.length === 1 ? '1 saved' : `${favoriteIds.length} saved`;

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            visible.length === 0 && !showSkeleton && error === undefined && styles.contentFill,
          ]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText style={styles.title}>Favorites</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {hydrated && favoriteIds.length > 0 ? savedLabel : 'Saved specialists and salons'}
            </ThemedText>
          </View>
          {showSkeleton ? (
            <FavoritesSkeleton />
          ) : error && visible.length === 0 ? (
            <View style={styles.statusBlock}>
              <ThemedText themeColor="textSecondary">{error}</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading favorites"
                onPress={() => setCatalogEpoch((current) => current + 1)}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Retry
                </ThemedText>
              </Pressable>
            </View>
          ) : visible.length === 0 ? (
            <View style={styles.empty}>
              <SymbolView
                name={{ ios: 'heart', android: 'favorite_border', web: 'favorite_border' }}
                size={48}
                tintColor={Brand.dustyRose}
              />
              <ThemedText style={styles.emptyTitle}>No favorites yet</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.emptyCopy}>
                Save your favorite beauty spots to find them here.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Explore services"
                onPress={() => router.push('/search')}
                style={({ pressed }) => [
                  styles.emptyButton,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Explore services
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <ContentFadeIn style={styles.list}>
              {visible.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} />
              ))}
            </ContentFadeIn>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function FavoritesSkeleton() {
  return (
    <View accessibilityLabel="Loading favorites" style={styles.list}>
      {['a', 'b'].map((key) => (
        <ProviderCardSkeleton key={key} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  contentFill: {
    flexGrow: 1,
  },
  header: {
    gap: Spacing.one,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
  },
  empty: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
    textAlign: 'center',
  },
  emptyCopy: {
    textAlign: 'center',
    maxWidth: 280,
  },
  emptyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 200,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
  statusBlock: {
    gap: Spacing.two,
  },
  actionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  list: {
    gap: Spacing.three,
  },
});
