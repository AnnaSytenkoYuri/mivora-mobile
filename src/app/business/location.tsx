import { Redirect, router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CITY_MAP_CENTERS, DEFAULT_CITY_ID, parseCityId } from '@/constants/cities';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { updateMyProviderLocation } from '@/data/repositories/provider-setup';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyProvider } from '@/hooks/use-my-provider';
import { useTheme } from '@/hooks/use-theme';
import { formatMapCoordinates, isFiniteLatitude, isFiniteLongitude } from '@/lib/business-location';

export default function BusinessLocationPickerScreen() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { provider, loading, error: loadError } = useMyProvider(user?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [region, setRegion] = useState<Region | undefined>();

  const start = useMemo(() => {
    const cityId = parseCityId(provider?.city) ?? DEFAULT_CITY_ID;
    const preview = CITY_MAP_CENTERS[cityId];
    const latitude = provider?.latitude;
    const longitude = provider?.longitude;
    if (isFiniteLatitude(latitude) && isFiniteLongitude(longitude)) {
      return {
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
        fromSavedLocation: true,
      };
    }

    return { ...preview, fromSavedLocation: false };
  }, [provider?.city, provider?.latitude, provider?.longitude]);

  const displayed: Region = region ?? {
    latitude: start.latitude,
    longitude: start.longitude,
    latitudeDelta: start.latitudeDelta,
    longitudeDelta: start.longitudeDelta,
  };

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  async function onConfirm() {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(undefined);
    const result = await updateMyProviderLocation({
      latitude: displayed.latitude,
      longitude: displayed.longitude,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.back();
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Set location',
        }}
      />
      {loading && !provider ? (
        <View style={styles.status}>
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        </View>
      ) : loadError && !provider ? (
        <View style={styles.status}>
          <ThemedText themeColor="textSecondary">{loadError}</ThemedText>
        </View>
      ) : !provider ? (
        <View style={styles.status}>
          <ThemedText type="smallBold">No business profile yet</ThemedText>
          <ThemedText themeColor="textSecondary">
            Create a provider profile before setting a map location.
          </ThemedText>
        </View>
      ) : (
        <>
          <View style={styles.mapWrap}>
            <MapView
              style={styles.map}
              initialRegion={{
                latitude: start.latitude,
                longitude: start.longitude,
                latitudeDelta: start.latitudeDelta,
                longitudeDelta: start.longitudeDelta,
              }}
              onRegionChangeComplete={setRegion}
              showsUserLocation={false}
              showsMyLocationButton={false}
              toolbarEnabled={false}
              userInterfaceStyle={scheme === 'dark' ? 'dark' : 'light'}
            />
            <View pointerEvents="none" style={styles.pinLayer}>
              <SymbolView
                name={{ ios: 'mappin', android: 'location_on', web: 'location_on' }}
                size={36}
                tintColor={theme.primary}
              />
            </View>
          </View>
          <ThemedView
            type="surface"
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
            <ThemedText type="smallBold">
              {start.fromSavedLocation ? 'Saved business location' : 'No business location saved yet'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {start.fromSavedLocation
                ? 'Move the map so the pin sits on your salon, then confirm.'
                : `The map starts at the ${provider.city || 'city'} center for preview only. Move the pin to your salon, then confirm. Nothing is saved until you confirm.`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatMapCoordinates(displayed.latitude, displayed.longitude)}
            </ThemedText>
            {error ? (
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm location"
              disabled={saving}
              onPress={() => {
                void onConfirm();
              }}
              style={({ pressed }) => [
                styles.confirm,
                { backgroundColor: theme.backgroundSelected },
                saving && styles.disabled,
                pressed && !saving && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="onPrimary">
                {saving ? 'Saving…' : 'Confirm location'}
              </ThemedText>
            </Pressable>
          </ThemedView>
        </>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  status: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  mapWrap: {
    flex: 1,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  pinLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
  },
  sheet: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  confirm: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
    marginTop: Spacing.one,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
