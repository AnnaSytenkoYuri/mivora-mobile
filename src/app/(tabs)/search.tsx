import { useFocusEffect, useNavigation } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CitySelector } from '@/components/city-selector';
import { ProviderCard, ProviderCardSkeleton } from '@/components/provider-card';
import { SearchResultsMap } from '@/components/search-results-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useSelectedCity } from '@/context/selected-city-context';
import { getSearchFilterOptions, searchProviders } from '@/data/repositories/catalog';
import type { BeautyCategorySlug, Provider, ProviderKind } from '@/data/types';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { providersWithMapCoordinates } from '@/lib/business-location';
import { requestOnceCustomerLocation } from '@/lib/customer-location';
import {
  distanceKmFromOrigin,
  sortProvidersByNearest,
  type GeoPoint,
} from '@/lib/distance';
import { formatThb } from '@/lib/format';

export default function SearchScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { cityId, cityLabel, setCityId } = useSelectedCity();
  const [serviceQuery, setServiceQuery] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [categorySlug, setCategorySlug] = useState<BeautyCategorySlug | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [kind, setKind] = useState<ProviderKind | null>(null);
  const [maxPriceThb, setMaxPriceThb] = useState<number | null>(null);
  const [results, setResults] = useState<Provider[]>([]);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [searchEpoch, setSearchEpoch] = useState(0);
  const [searchError, setSearchError] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [customerOrigin, setCustomerOrigin] = useState<GeoPoint | undefined>();
  const [nearMeBusy, setNearMeBusy] = useState(false);
  const [nearMeMessage, setNearMeMessage] = useState<string | undefined>();
  const previousCityId = useRef(cityId);
  const {
    data: filterOptions,
    loading,
    error,
  } = useAsyncData(() => getSearchFilterOptions(cityId), [cityId, catalogEpoch], [cityId]);

  const activeFilterCount =
    Number(categorySlug !== null) +
    Number(area !== null) +
    Number(kind !== null) +
    Number(maxPriceThb !== null);
  const hasActiveFilters = activeFilterCount > 0;
  const hasQuery = serviceQuery.trim().length > 0 || locationQuery.trim().length > 0;
  const mappedCount = useMemo(() => providersWithMapCoordinates(results).length, [results]);
  const displayedResults = useMemo(
    () => (customerOrigin ? sortProvidersByNearest(results, customerOrigin) : results),
    [customerOrigin, results],
  );
  const nearMeActive = customerOrigin != null;

  useEffect(() => {
    if (loading || error) {
      return;
    }

    let cancelled = false;
    void searchProviders({
      serviceQuery,
      locationQuery,
      cityId,
      categorySlug,
      area,
      kind,
      maxPriceThb,
    })
      .then((next) => {
        if (cancelled) {
          return;
        }

        setResults(next);
        setSearchError(undefined);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }

        setSearchError(caught instanceof Error ? caught.message : 'Could not load catalog.');
      });

    return () => {
      cancelled = true;
    };
  }, [serviceQuery, locationQuery, cityId, categorySlug, area, kind, maxPriceThb, loading, error, searchEpoch]);

  useEffect(() => {
    if (previousCityId.current === cityId) {
      return;
    }

    previousCityId.current = cityId;
    setArea(null);
    setResults([]);
    setSearchError(undefined);
  }, [cityId]);

  useEffect(() => {
    if (!filterOptions) {
      return;
    }

    if (area && !filterOptions.areas.includes(area)) {
      setArea(null);
    }
    if (kind && !filterOptions.kinds.includes(kind)) {
      setKind(null);
    }
    if (maxPriceThb != null && !filterOptions.maxPricesThb.includes(maxPriceThb)) {
      setMaxPriceThb(null);
    }
  }, [area, filterOptions, kind, maxPriceThb]);

  function clearFilters() {
    setCategorySlug(null);
    setArea(null);
    setKind(null);
    setMaxPriceThb(null);
  }

  function closeFilters() {
    setFiltersVisible(false);
  }

  function clearSearchQueries() {
    setServiceQuery('');
    setLocationQuery('');
  }

  function resetSearch() {
    clearSearchQueries();
    setCategorySlug(null);
    setArea(null);
    setKind(null);
    setMaxPriceThb(null);
    setFiltersVisible(false);
    setSearchError(undefined);
    setViewMode('list');
    setCustomerOrigin(undefined);
    setNearMeBusy(false);
    setNearMeMessage(undefined);
  }

  async function onNearMePress() {
    if (nearMeBusy) {
      return;
    }

    if (customerOrigin) {
      setCustomerOrigin(undefined);
      setNearMeMessage(undefined);
      return;
    }

    setNearMeBusy(true);
    setNearMeMessage(undefined);
    const result = await requestOnceCustomerLocation();
    setNearMeBusy(false);

    if (!result.ok) {
      setNearMeMessage(result.message);
      return;
    }

    setCustomerOrigin(result.coordinates);
  }

  useFocusEffect(
    useCallback(() => {
      return () => {
        if (!isSearchTabSelected(navigation)) {
          resetSearch();
        }
      };
    }, [navigation]),
  );

  const filterControls = (
    <>
      <FilterRow label="Category">
        {(filterOptions?.categories ?? []).map((category) => (
          <FilterChip
            key={category.slug}
            label={category.label}
            selected={categorySlug === category.slug}
            onPress={() =>
              setCategorySlug((current) => (current === category.slug ? null : category.slug))
            }
          />
        ))}
      </FilterRow>

      {(filterOptions?.areas ?? []).length > 0 ? (
        <FilterRow label="Area">
          {filterOptions?.areas.map((areaOption) => (
            <FilterChip
              key={areaOption}
              label={areaOption}
              selected={area === areaOption}
              onPress={() => setArea((current) => (current === areaOption ? null : areaOption))}
            />
          ))}
        </FilterRow>
      ) : null}

      <FilterRow label="Type">
        {(filterOptions?.kinds ?? []).map((kindOption) => (
          <FilterChip
            key={kindOption}
            label={kindOption === 'salon' ? 'Salon' : 'Specialist'}
            selected={kind === kindOption}
            onPress={() => setKind((current) => (current === kindOption ? null : kindOption))}
          />
        ))}
      </FilterRow>

      <FilterRow label="Max price">
        {(filterOptions?.maxPricesThb ?? []).map((price) => (
          <FilterChip
            key={price}
            label={`Up to ${formatThb(price)}`}
            selected={maxPriceThb === price}
            onPress={() => setMaxPriceThb((current) => (current === price ? null : price))}
          />
        ))}
      </FilterRow>
    </>
  );

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Search</ThemedText>
          <CitySelector value={cityId} onChange={setCityId} />
          <View style={styles.searchFields}>
            <SearchField
              icon={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              value={serviceQuery}
              onChangeText={setServiceQuery}
              accessibilityLabel="Search services, specialists, and salons"
              clearAccessibilityLabel="Clear services search"
              placeholder="Services, specialists, salons..."
            />
            <SearchField
              icon={{ ios: 'location', android: 'location_on', web: 'location_on' }}
              value={locationQuery}
              onChangeText={setLocationQuery}
              accessibilityLabel="Search city, area, or address"
              clearAccessibilityLabel="Clear location search"
              placeholder="City, area, or address..."
            />
          </View>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'
              }
              onPress={() => setFiltersVisible(true)}
              style={({ pressed }) => [
                styles.filtersButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <SymbolView
                name={{ ios: 'line.3.horizontal.decrease', android: 'tune', web: 'tune' }}
                size={20}
                tintColor={theme.onPrimary}
              />
              <ThemedText type="smallBold" themeColor="onPrimary">
                Filters
              </ThemedText>
              {activeFilterCount > 0 ? (
                <View style={[styles.filterCount, { backgroundColor: theme.text }]}>
                  <ThemedText type="smallBold" style={{ color: theme.background }}>
                    {activeFilterCount}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={nearMeActive ? 'Turn off Near me' : 'Near me'}
              accessibilityState={{ selected: nearMeActive, busy: nearMeBusy, disabled: nearMeBusy }}
              disabled={nearMeBusy}
              onPress={() => {
                void onNearMePress();
              }}
              style={({ pressed }) => [
                styles.nearMeButton,
                {
                  backgroundColor: nearMeActive ? theme.backgroundSelected : theme.backgroundElement,
                },
                pressed && !nearMeBusy && styles.pressed,
              ]}>
              <View style={styles.nearMeIconSlot}>
                {nearMeBusy ? (
                  <ActivityIndicator size="small" color={theme.text} />
                ) : (
                  <SymbolView
                    name={{
                      ios: nearMeActive ? 'location.fill' : 'location',
                      android: 'my_location',
                      web: 'my_location',
                    }}
                    size={20}
                    tintColor={nearMeActive ? theme.onPrimary : theme.text}
                  />
                )}
              </View>
              <ThemedText type="smallBold" themeColor={nearMeActive ? 'onPrimary' : undefined}>
                Near me
              </ThemedText>
            </Pressable>
          </View>
          <View style={styles.modeRow}>
            <View style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
              <ViewModeChip
                label="List"
                selected={viewMode === 'list'}
                onPress={() => setViewMode('list')}
              />
              <ViewModeChip
                label="Map"
                selected={viewMode === 'map'}
                onPress={() => {
                  Keyboard.dismiss();
                  setViewMode('map');
                }}
              />
            </View>
            {!loading && !error ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.modeCount}>
                {results.length === 1 ? '1 provider' : `${results.length} providers`}
                {viewMode === 'map' ? ` · ${mappedCount} on map` : ''}
              </ThemedText>
            ) : null}
          </View>
          {nearMeBusy ? (
            <ThemedText type="small" themeColor="textSecondary">
              Finding your location once…
            </ThemedText>
          ) : nearMeMessage ? (
            <ThemedText type="small" themeColor="textSecondary">
              {nearMeMessage}
            </ThemedText>
          ) : nearMeActive ? (
            <ThemedText type="small" themeColor="textSecondary">
              Sorted by nearest · approximate straight-line distance
            </ThemedText>
          ) : null}
        </View>

        {viewMode === 'map' && !loading && !error ? (
          <SearchResultsMap
            providers={displayedResults}
            cityId={cityId}
            cityLabel={cityLabel}
            origin={customerOrigin}
          />
        ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}>
          {loading ? (
            <SearchSkeleton />
          ) : error ? (
            <View style={styles.statusBlock}>
              <ThemedText themeColor="textSecondary">{error}</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading search"
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
          ) : searchError && results.length === 0 ? (
            <View style={styles.statusBlock}>
              <ThemedText themeColor="textSecondary">{searchError}</ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading search"
                onPress={() => setSearchEpoch((current) => current + 1)}
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
          ) : results.length === 0 ? (
            <View style={styles.empty}>
              <ThemedText type="smallBold">No providers in {cityLabel}</ThemedText>
              <ThemedText themeColor="textSecondary">
                Try another search, city, or clear your filters.
              </ThemedText>
              {hasQuery ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={clearSearchQueries}
                  style={({ pressed }) => [
                    styles.actionButton,
                    { backgroundColor: theme.backgroundSelected },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" themeColor="onPrimary">
                    Clear search
                  </ThemedText>
                </Pressable>
              ) : null}
              {hasActiveFilters ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear filters"
                  onPress={clearFilters}
                  style={({ pressed }) => [
                    styles.actionButton,
                    {
                      backgroundColor: hasQuery ? theme.backgroundElement : theme.backgroundSelected,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" themeColor={hasQuery ? undefined : 'onPrimary'}>
                    Clear filters
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              {searchError ? (
                <View style={styles.statusBlock}>
                  <ThemedText themeColor="textSecondary">{searchError}</ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading search"
                    onPress={() => setSearchEpoch((current) => current + 1)}
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
              ) : null}
              {displayedResults.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  approximateDistanceKm={
                    customerOrigin
                      ? distanceKmFromOrigin(customerOrigin, provider.latitude, provider.longitude)
                      : undefined
                  }
                />
              ))}
            </>
          )}
        </ScrollView>
        )}
      </SafeAreaView>

      <Modal
        visible={filtersVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeFilters}>
        <ThemedView style={styles.modalScreen}>
          <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
            <View style={styles.modalHeader}>
              <ThemedText style={styles.modalTitle}>Filters</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {cityLabel}
                {activeFilterCount > 0
                  ? ` · ${activeFilterCount} ${activeFilterCount === 1 ? 'filter' : 'filters'} on`
                  : ''}
              </ThemedText>
            </View>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {filterControls}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear filters"
                accessibilityState={{ disabled: !hasActiveFilters }}
                disabled={!hasActiveFilters}
                onPress={clearFilters}
                style={({ pressed }) => [
                  styles.modalAction,
                  { backgroundColor: theme.backgroundElement },
                  !hasActiveFilters && styles.disabled,
                  pressed && hasActiveFilters && styles.pressed,
                ]}>
                <ThemedText type="smallBold">Clear filters</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  results.length === 1 ? 'Show 1 provider' : `Show ${results.length} providers`
                }
                onPress={closeFilters}
                style={({ pressed }) => [
                  styles.modalAction,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  {results.length === 1 ? 'Show 1 provider' : `Show ${results.length} providers`}
                </ThemedText>
              </Pressable>
            </View>
          </SafeAreaView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

type NavigationParent = {
  getState: () => { index?: number; routes: { name: string }[] } | undefined;
  getParent: () => NavigationParent | undefined;
};

function isSearchTabSelected(navigation: { getParent: () => NavigationParent | undefined }): boolean {
  let current: NavigationParent | undefined = navigation.getParent();

  while (current) {
    const state = current.getState();
    const focusedName =
      state && typeof state.index === 'number' ? state.routes[state.index]?.name : undefined;

    if (focusedName === 'search') {
      return true;
    }

    current = current.getParent();
  }

  return false;
}

function SearchField({
  icon,
  value,
  onChangeText,
  accessibilityLabel,
  clearAccessibilityLabel,
  placeholder,
}: {
  icon: Extract<SymbolViewProps['name'], { ios?: unknown }>;
  value: string;
  onChangeText: (text: string) => void;
  accessibilityLabel: string;
  clearAccessibilityLabel: string;
  placeholder: string;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.inputRow, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name={icon} size={20} tintColor={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={accessibilityLabel}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => Keyboard.dismiss()}
        style={[styles.input, { color: theme.text }]}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          onPress={() => onChangeText('')}
          hitSlop={8}
          style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
          <SymbolView
            name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
            size={20}
            tintColor={theme.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.filterBlock}>
      <ThemedText style={styles.sectionTitle}>{label}</ThemedText>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

function ViewModeChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentChip,
        { backgroundColor: selected ? theme.backgroundSelected : 'transparent' },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" themeColor={selected ? 'onPrimary' : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small" themeColor={selected ? 'onPrimary' : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SearchSkeleton() {
  return (
    <View accessibilityLabel="Loading search" style={styles.skeletonList}>
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
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
  },
  searchFields: {
    gap: Spacing.one,
  },
  inputRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  input: {
    flex: 1,
    minHeight: 44,
    fontSize: 16,
    paddingVertical: 0,
  },
  clearButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  filtersButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  nearMeButton: {
    minHeight: 44,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  nearMeIconSlot: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: Spacing.three,
    padding: Spacing.half,
    flexShrink: 0,
  },
  segmentChip: {
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three - Spacing.half,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeCount: {
    flex: 1,
  },
  filterCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: Spacing.one,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  empty: {
    gap: Spacing.two,
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
  filterBlock: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScreen: {
    flex: 1,
  },
  modalSafe: {
    flex: 1,
  },
  modalHeader: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.one,
  },
  modalTitle: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
  },
  modalContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  modalFooter: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  modalAction: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
  skeletonList: {
    gap: Spacing.three,
  },
});
