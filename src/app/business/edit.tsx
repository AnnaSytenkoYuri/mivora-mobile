import * as ImagePicker from 'expo-image-picker';
import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CitySelector } from '@/components/city-selector';
import { ProviderCoverImage } from '@/components/provider-cover-image';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cityLabel, parseCityId, type CityId } from '@/constants/cities';
import { formatMapCoordinates } from '@/lib/business-location';
import { UNPUBLISH_TO_REMOVE_COVER } from '@/lib/published-integrity';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import {
  removeMyProviderCoverPhoto,
  updateMyProvider,
  uploadMyProviderCoverPhoto,
} from '@/data/repositories/provider-setup';
import type { ProviderKind } from '@/data/types';
import { useMyProvider } from '@/hooks/use-my-provider';
import { useTheme } from '@/hooks/use-theme';

export default function EditBusinessProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { provider, loading, error: loadError } = useMyProvider(user?.id);
  const [kind, setKind] = useState<ProviderKind>('specialist');
  const [name, setName] = useState('');
  const [cityId, setCityId] = useState<CityId | undefined>();
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [bio, setBio] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [coverUrl, setCoverUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (!provider || hydrated) {
      return;
    }

    setKind(provider.kind);
    setName(provider.name);
    setCity(provider.city);
    setCityId(parseCityId(provider.city));
    setArea(provider.area);
    setAddress(provider.address);
    setBio(provider.bio);
    setCoverUrl(provider.imageUrl);
    setHydrated(true);
  }, [provider, hydrated]);

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  const canSubmit =
    hydrated &&
    name.trim().length > 0 &&
    city.trim().length > 0 &&
    area.trim().length > 0 &&
    bio.trim().length > 0 &&
    !saving &&
    !photoBusy;

  async function onSave() {
    if (saving || photoBusy) {
      return;
    }

    setSaving(true);
    setError(undefined);
    const result = await updateMyProvider({
      kind,
      name,
      city,
      area,
      address,
      bio,
    });
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.back();
  }

  async function onPickCover() {
    if (photoBusy || saving) {
      return;
    }

    setPhotoError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError('Photo library access is required to choose a cover photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    setPhotoBusy(true);
    const uploaded = await uploadMyProviderCoverPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
    });
    setPhotoBusy(false);

    if (!uploaded.ok) {
      setPhotoError(uploaded.message);
      return;
    }

    setCoverUrl(uploaded.provider.imageUrl);
    if (uploaded.warning) {
      setPhotoError(uploaded.warning);
    }
  }

  async function onRemoveCover() {
    if (photoBusy || saving) {
      return;
    }

    setPhotoError(undefined);
    setPhotoBusy(true);
    const removed = await removeMyProviderCoverPhoto();
    setPhotoBusy(false);

    if (!removed.ok) {
      setPhotoError(removed.message);
      return;
    }

    setCoverUrl(removed.provider.imageUrl);
    if (removed.warning) {
      setPhotoError(removed.warning);
    }
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Edit business',
        }}
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        automaticallyAdjustKeyboardInsets
        automaticallyAdjustContentInsets={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
        {loading && !provider ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : loadError && !provider ? (
          <ThemedText themeColor="textSecondary">{loadError}</ThemedText>
        ) : !provider ? (
          <View style={styles.block}>
            <ThemedText type="smallBold">No business profile yet</ThemedText>
            <ThemedText themeColor="textSecondary">
              Create a provider profile from Profile before editing.
            </ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.block}>
              <ThemedText type="small" themeColor="textSecondary">
                Update how clients see your specialist or salon.
              </ThemedText>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Cover photo</ThemedText>
              <ProviderCoverImage imageUrl={coverUrl} style={styles.cover} />
              {photoBusy ? (
                <View style={styles.photoStatus}>
                  <ActivityIndicator />
                  <ThemedText type="small" themeColor="textSecondary">
                    Updating photo…
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.photoActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={photoBusy || saving}
                  onPress={() => {
                    void onPickCover();
                  }}
                  style={({ pressed }) => [
                    (photoBusy || saving) && styles.disabled,
                    pressed && !photoBusy && !saving && styles.pressed,
                  ]}>
                  <ThemedView type="backgroundSelected" style={styles.photoButton}>
                    <ThemedText type="smallBold" themeColor="onPrimary">
                      {coverUrl.length > 0 ? 'Replace photo' : 'Upload photo'}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
                {coverUrl.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={photoBusy || saving || provider.published}
                    onPress={() => {
                      void onRemoveCover();
                    }}
                    style={({ pressed }) => [
                      (photoBusy || saving || provider.published) && styles.disabled,
                      pressed && !photoBusy && !saving && !provider.published && styles.pressed,
                    ]}>
                    <ThemedView type="backgroundElement" style={styles.photoButton}>
                      <ThemedText type="smallBold">Remove photo</ThemedText>
                    </ThemedView>
                  </Pressable>
                ) : null}
              </View>
              {provider.published && coverUrl.length > 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {UNPUBLISH_TO_REMOVE_COVER}
                </ThemedText>
              ) : null}
              {photoError ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {photoError}
                </ThemedText>
              ) : null}
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Provider type</ThemedText>
              <View style={styles.chipRow}>
                <KindChip
                  label="Specialist"
                  selected={kind === 'specialist'}
                  disabled={saving}
                  onPress={() => setKind('specialist')}
                />
                <KindChip
                  label="Salon"
                  selected={kind === 'salon'}
                  disabled={saving}
                  onPress={() => setKind('salon')}
                />
              </View>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Business name</ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Business name"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                editable={!saving}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">City</ThemedText>
              <CitySelector
                value={cityId}
                disabled={saving}
                onChange={(next) => {
                  setCityId(next);
                  setCity(cityLabel(next));
                }}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Area</ThemedText>
              <TextInput
                value={area}
                onChangeText={setArea}
                placeholder="Thonglor"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                editable={!saving}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Street address</ThemedText>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="Optional, e.g. 123 Sukhumvit Rd"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                editable={!saving}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Map location</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {provider.latitude != null && provider.longitude != null
                  ? `Saved pin: ${formatMapCoordinates(provider.latitude, provider.longitude)}`
                  : 'No business location saved yet. City center is only a preview until you confirm a pin.'}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Set location on map"
                disabled={saving || photoBusy}
                onPress={() => router.push('/business/location')}
                style={({ pressed }) => [
                  (saving || photoBusy) && styles.disabled,
                  pressed && !saving && !photoBusy && styles.pressed,
                ]}>
                <ThemedView type="backgroundElement" style={styles.button}>
                  <ThemedText type="smallBold">Set location on map</ThemedText>
                </ThemedView>
              </Pressable>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Bio</ThemedText>
              <TextInput
                value={bio}
                onChangeText={setBio}
                placeholder="Tell clients about your work"
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
                editable={!saving}
                style={[
                  styles.input,
                  styles.textarea,
                  { backgroundColor: theme.backgroundElement, color: theme.text },
                ]}
              />
            </View>

            {error ? (
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={() => {
                void onSave();
              }}
              style={({ pressed }) => [
                !canSubmit && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}>
              <ThemedView type="backgroundSelected" style={styles.button}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  {saving ? 'Saving…' : 'Save changes'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function KindChip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && !disabled && styles.pressed]}>
      <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
        <ThemedText type="small" themeColor={selected ? 'onPrimary' : undefined}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  block: {
    gap: Spacing.two,
  },
  cover: {
    width: '100%',
    height: 180,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  photoStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  photoButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  textarea: {
    minHeight: 120,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
