import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CitySelector } from '@/components/city-selector';
import { ProviderCard, ProviderCardSkeleton } from '@/components/provider-card';
import { SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CATEGORY_ICON_SIZE, categoryIcons } from '@/constants/category-icons';
import { BottomTabInset, cardElevationStyle, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSelectedCity } from '@/context/selected-city-context';
import { getCategories, getHomeProviders } from '@/data/repositories/catalog';
import type { Category } from '@/data/types';
import { useAsyncData } from '@/hooks/use-async-data';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

const CATEGORY_COLUMNS = 3;

function categoryRows(categories: Category[]): Category[][] {
  const rows: Category[][] = [];
  for (let index = 0; index < categories.length; index += CATEGORY_COLUMNS) {
    rows.push(categories.slice(index, index + CATEGORY_COLUMNS));
  }
  return rows;
}

export default function HomeScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const { cityId, cityLabel, setCityId } = useSelectedCity();
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const { data, loading, error } = useAsyncData(
    () =>
      Promise.all([getCategories(), getHomeProviders(cityId)]).then(([categories, homeProviders]) => ({
        categories,
        homeProviders,
      })),
    [cityId, catalogEpoch],
    [cityId],
  );
  const lastCatalogRef = useRef(data);
  if (data) {
    lastCatalogRef.current = data;
  }
  const catalog = data ?? lastCatalogRef.current;
  const categories = catalog?.categories ?? [];
  const homeProviders = catalog?.homeProviders.providers ?? [];
  const featuredOnly = catalog?.homeProviders.featuredOnly ?? false;
  const isInitialLoad = loading && catalog === undefined;
  const isCityRefreshing = loading && catalog !== undefined;

  function retryCatalog() {
    setCatalogEpoch((current) => current + 1);
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText style={styles.logo}>Mivora</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Beauty specialists and salons in {cityLabel}
            </ThemedText>
            <CitySelector value={cityId} onChange={setCityId} />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search providers"
            onPress={() => router.push('/search')}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundElement" style={styles.searchField}>
              <SymbolView
                name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                size={20}
                tintColor={theme.textSecondary}
              />
              <ThemedText themeColor="textSecondary">Search nails, hair, lashes…</ThemedText>
            </ThemedView>
          </Pressable>

          {isInitialLoad ? (
            <HomeCatalogSkeleton />
          ) : error && catalog === undefined ? (
            <View style={styles.statusBlock}>
              <ThemedText themeColor="textSecondary">{error}</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading catalog"
                onPress={retryCatalog}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.actionButton}>
                  <ThemedText type="smallBold" themeColor="onPrimary">
                    Retry
                  </ThemedText>
                </ThemedView>
              </Pressable>
            </View>
          ) : (
            <View style={styles.catalog}>
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>Categories</ThemedText>
                <View style={styles.categoryRows}>
                  {categoryRows(categories).map((row) => (
                    <View key={row.map((category) => category.slug).join('-')} style={styles.categoryRow}>
                      {row.map((category) => (
                        <Pressable
                          key={category.slug}
                          accessibilityRole="button"
                          accessibilityLabel={category.label}
                          onPress={() =>
                            router.push({
                              pathname: '/category/[slug]',
                              params: { slug: category.slug },
                            })
                          }
                          style={({ pressed }) => [
                            styles.categoryCard,
                            { backgroundColor: theme.backgroundElement },
                            cardElevationStyle(isDark),
                            pressed && styles.pressed,
                          ]}>
                          <SymbolView
                            name={categoryIcons[category.slug]}
                            size={CATEGORY_ICON_SIZE}
                            weight="regular"
                            tintColor={theme.textSecondary}
                          />
                          <ThemedText numberOfLines={2} style={styles.categoryLabel}>
                            {category.label}
                          </ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>
                  {featuredOnly ? `Featured in ${cityLabel}` : `In ${cityLabel}`}
                </ThemedText>
                {error ? (
                  <View style={styles.statusBlock}>
                    <ThemedText themeColor="textSecondary">{error}</ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading catalog"
                      onPress={retryCatalog}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView type="backgroundSelected" style={styles.actionButton}>
                        <ThemedText type="smallBold" themeColor="onPrimary">
                          Retry
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  </View>
                ) : isCityRefreshing ? (
                  <View
                    accessibilityLabel={`Loading providers in ${cityLabel}`}
                    style={styles.providerList}>
                    {['a', 'b'].map((key) => (
                      <ProviderCardSkeleton key={key} />
                    ))}
                  </View>
                ) : homeProviders.length === 0 ? (
                  <View style={styles.statusBlock}>
                    <ThemedText type="small" themeColor="textSecondary">
                      No providers in {cityLabel} yet. Try another city or search.
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Search providers in ${cityLabel}`}
                      onPress={() => router.push('/search')}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedView type="backgroundSelected" style={styles.actionButton}>
                        <ThemedText type="smallBold" themeColor="onPrimary">
                          Search in {cityLabel}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  </View>
                ) : (
                  homeProviders.map((provider) => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function HomeCatalogSkeleton() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';

  return (
    <View accessibilityLabel="Loading catalog" style={styles.catalog}>
      <View style={styles.section}>
        <SkeletonBlock style={styles.skeletonSectionTitle} />
        <View style={styles.categoryRows}>
          {['row-a', 'row-b', 'row-c'].map((rowKey) => (
            <View key={rowKey} style={styles.categoryRow}>
              {['a', 'b', 'c'].map((key) => (
                <SkeletonBlock
                  key={`${rowKey}-${key}`}
                  style={[
                    styles.skeletonCategoryCard,
                    { backgroundColor: theme.backgroundElement },
                    cardElevationStyle(isDark),
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <SkeletonBlock style={styles.skeletonSectionTitle} />
        {['a', 'b'].map((key) => (
          <ProviderCardSkeleton key={key} />
        ))}
      </View>
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
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  logo: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 48,
  },
  pressed: {
    opacity: 0.7,
  },
  catalog: {
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.three,
  },
  providerList: {
    gap: Spacing.three,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  categoryRows: {
    width: '100%',
    gap: 8,
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  categoryCard: {
    flex: 1,
    minHeight: 68,
    height: 72,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  categoryLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: 500,
    textAlign: 'center',
  },
  statusBlock: {
    gap: Spacing.two,
  },
  actionButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  skeletonSectionTitle: {
    height: 20,
    width: '42%',
  },
  skeletonCategoryCard: {
    flex: 1,
    height: 72,
    borderRadius: 16,
  },
});
