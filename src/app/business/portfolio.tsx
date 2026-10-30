import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import {
  addMyPortfolioPhoto,
  deleteMyPortfolioPhoto,
  getMyPortfolio,
  moveMyPortfolioPhoto,
  MAX_PORTFOLIO_PHOTOS,
} from '@/data/repositories/provider-portfolio';
import type { PortfolioItem } from '@/data/types';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { canMovePortfolioPhoto, type PortfolioOrderDirection } from '@/lib/portfolio-order';

const ICON_HIT = 44;

export default function ManagePortfolioScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const { data, loading, error: loadError } = useAsyncData(() => getMyPortfolio(), []);

  useEffect(() => {
    if (data) {
      setItems(data);
    }
  }, [data]);

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  const mutating = uploading || deletingId !== null || movingId !== null;
  const orderedItems = items.map((item, index) => ({
    id: item.id,
    sortOrder: index + 1,
  }));
  const atLimit = items.length >= MAX_PORTFOLIO_PHOTOS;

  async function onAddPhoto() {
    if (mutating || atLimit) {
      return;
    }

    setError(undefined);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library access is required to add portfolio photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    const asset = result.assets[0];
    setUploading(true);
    const uploaded = await addMyPortfolioPhoto({
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
    });
    setUploading(false);

    if (!uploaded.ok) {
      setError(uploaded.message);
      return;
    }

    setItems(uploaded.items);
    if (uploaded.warning) {
      setError(uploaded.warning);
    }
  }

  function confirmDelete(item: PortfolioItem) {
    if (mutating) {
      return;
    }

    Alert.alert('Delete this photo?', 'It will be removed from your public profile.', [
      { text: 'Keep photo', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void onDelete(item.id);
        },
      },
    ]);
  }

  async function onDelete(itemId: string) {
    setDeletingId(itemId);
    setError(undefined);
    const result = await deleteMyPortfolioPhoto(itemId);
    setDeletingId(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setItems(result.items);
    if (result.warning) {
      setError(result.warning);
    }
  }

  async function onMove(itemId: string, direction: PortfolioOrderDirection) {
    if (mutating) {
      return;
    }

    setMovingId(itemId);
    setError(undefined);
    const result = await moveMyPortfolioPhoto(itemId, direction);
    setMovingId(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setItems(result.items);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Portfolio',
        }}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading && data === undefined ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : loadError && data === undefined ? (
          <ThemedText themeColor="textSecondary">{loadError}</ThemedText>
        ) : (
          <>
            <View style={styles.block}>
              <ThemedText type="small" themeColor="textSecondary">
                Add photos of your work. They appear on your public profile in this order. You can
                add up to {MAX_PORTFOLIO_PHOTOS} photos.
              </ThemedText>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={mutating || atLimit}
              onPress={() => {
                void onAddPhoto();
              }}
              style={({ pressed }) => [
                (mutating || atLimit) && styles.disabled,
                pressed && !mutating && !atLimit && styles.pressed,
              ]}>
              <ThemedView type="backgroundSelected" style={styles.button}>
                {uploading ? (
                  <View style={styles.buttonStatus}>
                    <ActivityIndicator color={theme.onPrimary} />
                    <ThemedText type="smallBold" themeColor="onPrimary">
                      Uploading…
                    </ThemedText>
                  </View>
                ) : (
                  <ThemedText type="smallBold" themeColor="onPrimary">
                    {atLimit ? 'Photo limit reached' : 'Add photo'}
                  </ThemedText>
                )}
              </ThemedView>
            </Pressable>

            {error ? (
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            ) : null}

            <View style={styles.block}>
              <ThemedText type="smallBold">
                Your photos ({items.length}/{MAX_PORTFOLIO_PHOTOS})
              </ThemedText>
              {items.length === 0 ? (
                <ThemedText themeColor="textSecondary">No portfolio photos yet.</ThemedText>
              ) : (
                <View style={styles.grid}>
                  {items.map((item) => {
                    const canLeft = canMovePortfolioPhoto(orderedItems, item.id, 'left');
                    const canRight = canMovePortfolioPhoto(orderedItems, item.id, 'right');
                    const busy = movingId === item.id || deletingId === item.id;

                    return (
                      <View key={item.id} style={[styles.card, busy && styles.busyCard]}>
                        <View style={[styles.imageWrap, { backgroundColor: theme.backgroundElement }]}>
                          <Image
                            source={{ uri: item.imageUrl }}
                            style={styles.tileImage}
                            contentFit="cover"
                          />
                          {busy ? (
                            <View style={styles.busyOverlay} pointerEvents="none">
                              <ActivityIndicator color={theme.text} />
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.actions}>
                          <PortfolioIconButton
                            accessibilityLabel="Move photo left"
                            disabled={mutating || !canLeft}
                            tintColor={theme.text}
                            ios="chevron.left"
                            android="chevron_left"
                            onPress={() => {
                              void onMove(item.id, 'left');
                            }}
                          />
                          <PortfolioIconButton
                            accessibilityLabel="Move photo right"
                            disabled={mutating || !canRight}
                            tintColor={theme.text}
                            ios="chevron.right"
                            android="chevron_right"
                            onPress={() => {
                              void onMove(item.id, 'right');
                            }}
                          />
                          <PortfolioIconButton
                            accessibilityLabel="Delete photo"
                            disabled={mutating}
                            tintColor={theme.danger}
                            ios="trash"
                            android="delete"
                            onPress={() => confirmDelete(item)}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function PortfolioIconButton({
  accessibilityLabel,
  disabled,
  tintColor,
  ios,
  android,
  onPress,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  tintColor: string;
  ios: 'chevron.left' | 'chevron.right' | 'trash';
  android: 'chevron_left' | 'chevron_right' | 'delete';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <SymbolView
        name={{ ios, android, web: android }}
        size={22}
        tintColor={tintColor}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  block: {
    gap: Spacing.two,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  buttonStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.two,
    rowGap: Spacing.four,
  },
  card: {
    width: '48%',
    maxWidth: '48%',
    minWidth: 0,
    gap: Spacing.one,
  },
  busyCard: {
    opacity: 0.55,
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  busyOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    flex: 1,
    height: ICON_HIT,
    minHeight: ICON_HIT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.7,
  },
});
