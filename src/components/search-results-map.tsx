import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker, type MapPressEvent, type Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-screens/experimental';

import { ThemedText } from '@/components/themed-text';
import { CITY_MAP_CENTERS, type CityId } from '@/constants/cities';
import { MaxContentWidth, Spacing, cardElevationStyle } from '@/constants/theme';
import type { Provider } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { providersWithMapCoordinates, regionForMapMarkers } from '@/lib/business-location';
import {
  distanceKmFromOrigin,
  formatApproximateDistanceKm,
  type GeoPoint,
} from '@/lib/distance';
import { formatThb } from '@/lib/format';

type SearchResultsMapProps = {
  providers: Provider[];
  cityId: CityId;
  cityLabel: string;
  origin?: GeoPoint;
};

export function SearchResultsMap({ providers, cityId, cityLabel, origin }: SearchResultsMapProps) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const mapRef = useRef<MapView>(null);
  const ignoreMapPressUntil = useRef(0);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const mapped = useMemo(() => providersWithMapCoordinates(providers), [providers]);
  const mappedIds = useMemo(() => mapped.map((provider) => provider.id).join(','), [mapped]);
  const fallback = CITY_MAP_CENTERS[cityId];
  const region = useMemo(() => regionForMapMarkers(mapped, fallback), [mapped, fallback]);
  const selected = mapped.find((provider) => provider.id === selectedId);
  const kindLabel = selected?.kind === 'salon' ? 'Salon' : 'Specialist';
  const selectedDistanceKm =
    origin && selected
      ? distanceKmFromOrigin(origin, selected.latitude, selected.longitude)
      : undefined;
  const selectedDistanceLabel =
    selectedDistanceKm == null ? undefined : formatApproximateDistanceKm(selectedDistanceKm);

  useEffect(() => {
    setSelectedId(undefined);
  }, [cityId, mappedIds]);

  useEffect(() => {
    mapRef.current?.animateToRegion(region as Region, 350);
  }, [cityId, region]);

  const selectProvider = (id: string) => {
    ignoreMapPressUntil.current = Date.now() + 400;
    setSelectedId(id);
  };

  const dismissPreviewIfMapTap = (event?: MapPressEvent) => {
    if (Date.now() < ignoreMapPressUntil.current) {
      return;
    }
    const action = event?.nativeEvent?.action;
    if (action === 'marker-press') {
      return;
    }
    setSelectedId(undefined);
  };

  const openProvider = (id: string) => {
    router.push({
      pathname: '/provider/[id]',
      params: { id },
    });
  };

  return (
    <SafeAreaView edges={{ bottom: true }} style={styles.wrap}>
      <View style={styles.mapLayer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region as Region}
          onPress={dismissPreviewIfMapTap}
          showsUserLocation={false}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          userInterfaceStyle={isDark ? 'dark' : 'light'}>
          {mapped.map((provider) => (
            <Marker
              key={provider.id}
              identifier={provider.id}
              coordinate={{ latitude: provider.latitude, longitude: provider.longitude }}
              pinColor={provider.kind === 'salon' ? theme.primary : theme.text}
              onPress={(event) => {
                event.stopPropagation?.();
                selectProvider(provider.id);
              }}
              tracksViewChanges={false}
            />
          ))}
        </MapView>

        {mapped.length === 0 ? (
          <View
            pointerEvents="box-none"
            style={[styles.emptyCard, { backgroundColor: theme.backgroundElement }, cardElevationStyle(isDark)]}>
            <ThemedText type="smallBold">
              {providers.length === 0 ? `No providers in ${cityLabel}` : 'Nothing on the map yet'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {providers.length === 0
                ? 'Try another search, city, or clear your filters.'
                : 'Matching businesses are still in List view. They appear here after a location pin is saved.'}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {selected ? (
        <View pointerEvents="box-none" style={styles.previewDock}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${selected.name}`}
            pointerEvents="auto"
            onPress={() => openProvider(selected.id)}
            style={({ pressed }) => [
              styles.preview,
              { backgroundColor: theme.backgroundElement },
              cardElevationStyle(isDark),
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.previewName}>{selected.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {kindLabel} · {selected.area}
            </ThemedText>
            {selectedDistanceLabel ? (
              <ThemedText type="small" themeColor="textSecondary">
                {selectedDistanceLabel}
              </ThemedText>
            ) : null}
            {selected.startingPriceThb > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                from {formatThb(selected.startingPriceThb)}
              </ThemedText>
            ) : null}
            <ThemedText type="smallBold" themeColor="textSecondary">
              View profile
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  mapLayer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  emptyCard: {
    position: 'absolute',
    left: Spacing.four,
    right: Spacing.four,
    top: Spacing.three,
    zIndex: 2,
    elevation: 4,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  previewDock: {
    zIndex: 20,
    elevation: 20,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  preview: {
    zIndex: 21,
    elevation: 21,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  previewName: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: 600,
  },
  pressed: {
    opacity: 0.7,
  },
});
