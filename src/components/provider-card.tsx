import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { FavoriteButton } from '@/components/favorite-button';
import { ProviderCoverImage } from '@/components/provider-cover-image';
import { SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { cardElevationStyle, Spacing } from '@/constants/theme';
import type { Provider } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatApproximateDistanceKm } from '@/lib/distance';
import { formatThb } from '@/lib/format';

type ProviderCardProps = {
  provider: Provider;
  approximateDistanceKm?: number;
};

export function ProviderCard({ provider, approximateDistanceKm }: ProviderCardProps) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const kindLabel = provider.kind === 'salon' ? 'Salon' : 'Specialist';
  const distanceLabel =
    approximateDistanceKm == null ? undefined : formatApproximateDistanceKm(approximateDistanceKm);

  return (
    <View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={provider.name}
        onPress={() =>
          router.push({
            pathname: '/provider/[id]',
            params: { id: provider.id },
          })
        }
        style={({ pressed }) => [
          styles.cardLift,
          cardElevationStyle(isDark),
          pressed && styles.pressed,
        ]}>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ProviderCoverImage imageUrl={provider.imageUrl} style={styles.image} />
          <View style={styles.body}>
            <ThemedText style={styles.name}>{provider.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {kindLabel} · {provider.area}
            </ThemedText>
            {distanceLabel ? (
              <ThemedText type="small" themeColor="textSecondary">
                {distanceLabel}
              </ThemedText>
            ) : null}
            <View style={styles.ratingRow}>
              <SymbolView
                name={{ ios: 'star.fill', android: 'star', web: 'star' }}
                size={14}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {provider.rating.toFixed(1)} ({provider.reviewCount}) · from{' '}
                {formatThb(provider.startingPriceThb)}
              </ThemedText>
            </View>
          </View>
        </View>
      </Pressable>
      <View pointerEvents="box-none" style={styles.favorite}>
        <FavoriteButton providerId={provider.id} />
      </View>
    </View>
  );
}

export function ProviderCardSkeleton() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';

  return (
    <View style={[styles.cardLift, cardElevationStyle(isDark)]}>
      <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        <SkeletonBlock style={styles.skeletonImage} />
        <View style={styles.body}>
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={styles.skeletonLineShort} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  cardLift: {
    borderRadius: Spacing.three,
  },
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: 160,
  },
  body: {
    gap: Spacing.half,
    padding: Spacing.three,
  },
  name: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  favorite: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
  },
  skeletonImage: {
    height: 160,
    width: '100%',
    borderRadius: 0,
  },
  skeletonLine: {
    height: 16,
    width: '58%',
  },
  skeletonLineShort: {
    height: 12,
    width: '42%',
  },
});
