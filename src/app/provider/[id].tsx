import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FavoriteButton } from '@/components/favorite-button';
import { PortfolioGallery } from '@/components/portfolio-gallery';
import { ProviderCoverImage } from '@/components/provider-cover-image';
import { ContentFadeIn, SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getProviderById } from '@/data/repositories/catalog';
import type { PortfolioItem, Provider, Review, Service } from '@/data/types';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { directionsDestination } from '@/lib/directions';
import { formatBookingDate, formatDuration, formatThb } from '@/lib/format';
import { openDirections } from '@/lib/open-directions';

const PORTFOLIO_COLUMNS = 2;

function portfolioRows(items: PortfolioItem[]): PortfolioItem[][] {
  const rows: PortfolioItem[][] = [];
  for (let index = 0; index < items.length; index += PORTFOLIO_COLUMNS) {
    rows.push(items.slice(index, index + PORTFOLIO_COLUMNS));
  }
  return rows;
}

export default function ProviderProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = typeof idParam === 'string' ? idParam : undefined;
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [refreshedProvider, setRefreshedProvider] = useState<Provider | undefined>();
  const { data, loading, error } = useAsyncData(
    () => (id ? getProviderById(id) : Promise.resolve(undefined)),
    [id, catalogEpoch],
    [id],
  );

  useEffect(() => {
    setRefreshedProvider(undefined);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        return;
      }

      let cancelled = false;
      void getProviderById(id).then((next) => {
        if (!cancelled && (next === undefined || next.id === id)) {
          setRefreshedProvider(next);
        }
      });

      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const overlay = refreshedProvider?.id === id ? refreshedProvider : undefined;
  const provider = overlay ?? data;
  const visibleProvider = provider?.id === id ? provider : undefined;
  const kindLabel = visibleProvider?.kind === 'salon' ? 'Salon' : 'Specialist';
  const destination = visibleProvider ? directionsDestination(visibleProvider) : undefined;
  const streetAddress = visibleProvider?.address?.trim() ?? '';

  function retryProvider() {
    setCatalogEpoch((current) => current + 1);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: visibleProvider?.name ?? 'Provider',
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.four },
        ]}
        showsVerticalScrollIndicator={false}>
        {loading && !visibleProvider ? (
          <ProviderDetailsSkeleton />
        ) : error && !visibleProvider ? (
          <View style={styles.statusBlock}>
            <ThemedText themeColor="textSecondary">{error}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading provider"
              onPress={retryProvider}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.actionButton}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Retry
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        ) : visibleProvider ? (
          <ContentFadeIn style={styles.details}>
            <View>
              <ProviderCoverImage imageUrl={visibleProvider.imageUrl} style={styles.image} />
              <View style={styles.favorite}>
                <FavoriteButton providerId={visibleProvider.id} />
              </View>
            </View>
            <View style={styles.intro}>
              <ThemedText style={styles.heading}>{visibleProvider.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {kindLabel} · {visibleProvider.area}, {visibleProvider.city}
              </ThemedText>
              {visibleProvider.reviewCount === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No reviews yet
                </ThemedText>
              ) : (
                <View style={styles.ratingRow}>
                  <SymbolView
                    name={{ ios: 'star.fill', android: 'star', web: 'star' }}
                    size={14}
                    tintColor={theme.textSecondary}
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    {visibleProvider.rating.toFixed(1)} ({visibleProvider.reviewCount}{' '}
                    {visibleProvider.reviewCount === 1 ? 'review' : 'reviews'})
                  </ThemedText>
                </View>
              )}
              <ThemedText style={styles.bio}>{visibleProvider.bio}</ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Location</ThemedText>
              {streetAddress.length > 0 ? (
                <ThemedText>{streetAddress}</ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {visibleProvider.area}, {visibleProvider.city}
              </ThemedText>
              {destination ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Get directions"
                  onPress={() => openDirections(destination)}
                  style={({ pressed }) => [
                    styles.directionsButton,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}>
                  <SymbolView
                    name={{
                      ios: 'arrow.triangle.turn.up.right.diamond',
                      android: 'directions',
                      web: 'directions',
                    }}
                    size={20}
                    tintColor={theme.text}
                  />
                  <ThemedText type="smallBold">Get directions</ThemedText>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Services</ThemedText>
              {visibleProvider.services.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No services listed yet.
                </ThemedText>
              ) : (
                visibleProvider.services.map((service) => (
                  <ServiceRow key={service.id} providerId={visibleProvider.id} service={service} />
                ))
              )}
            </View>

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Portfolio</ThemedText>
              <PortfolioGrid items={visibleProvider.portfolio} />
            </View>

            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Reviews</ThemedText>
              {visibleProvider.reviews.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No reviews yet.
                </ThemedText>
              ) : (
                visibleProvider.reviews.map((review) => <ReviewRow key={review.id} review={review} />)
              )}
            </View>
          </ContentFadeIn>
        ) : (
          <ThemedText themeColor="textSecondary" style={styles.status}>
            This provider was not found.
          </ThemedText>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function ProviderDetailsSkeleton() {
  const theme = useTheme();

  return (
    <View accessibilityLabel="Loading provider" style={styles.details}>
      <SkeletonBlock style={styles.skeletonCover} />
      <View style={styles.intro}>
        <SkeletonBlock style={styles.skeletonName} />
        <SkeletonBlock style={styles.skeletonLocation} />
        <SkeletonBlock style={styles.skeletonRating} />
        <SkeletonBlock style={styles.skeletonBio} />
        <SkeletonBlock style={styles.skeletonBioShort} />
      </View>
      <View style={styles.section}>
        <SkeletonBlock style={styles.skeletonSectionTitle} />
        {['a', 'b', 'c'].map((key) => (
          <ThemedView key={key} type="backgroundElement" style={styles.serviceRow}>
            <View style={styles.serviceCopy}>
              <SkeletonBlock style={styles.skeletonServiceName} />
              <SkeletonBlock style={styles.skeletonServiceMeta} />
            </View>
            <SkeletonBlock style={styles.skeletonBook} />
          </ThemedView>
        ))}
      </View>
      <View style={styles.section}>
        <SkeletonBlock style={styles.skeletonSectionTitle} />
        <View style={styles.portfolioRows}>
          {['row-a', 'row-b'].map((rowKey) => (
            <View key={rowKey} style={styles.portfolioRow}>
              {['a', 'b'].map((key) => (
                <SkeletonBlock
                  key={`${rowKey}-${key}`}
                  style={[styles.skeletonPortfolioTile, { backgroundColor: theme.backgroundElement }]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
      <View style={styles.section}>
        <SkeletonBlock style={styles.skeletonSectionTitle} />
        {['a', 'b'].map((key) => (
          <ThemedView key={key} type="backgroundElement" style={styles.reviewRow}>
            <SkeletonBlock style={styles.skeletonServiceName} />
            <SkeletonBlock style={styles.skeletonServiceMeta} />
            <SkeletonBlock style={styles.skeletonBio} />
          </ThemedView>
        ))}
      </View>
    </View>
  );
}

function PortfolioGrid({ items }: { items: PortfolioItem[] }) {
  const theme = useTheme();
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No portfolio photos yet.
      </ThemedText>
    );
  }

  return (
    <>
      <View style={styles.portfolioRows}>
        {portfolioRows(items).map((row, rowIndex) => (
          <View key={row.map((item) => item.id).join('-')} style={styles.portfolioRow}>
            {row.map((item, columnIndex) => {
              const index = rowIndex * PORTFOLIO_COLUMNS + columnIndex;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`View portfolio photo ${index + 1} of ${items.length}`}
                  onPress={() => setViewerIndex(index)}
                  style={({ pressed }) => [
                    styles.portfolioTile,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}>
                  <Image source={{ uri: item.imageUrl }} style={styles.portfolioImage} contentFit="cover" />
                </Pressable>
              );
            })}
            {row.length === 1 ? <View style={styles.portfolioSpacer} /> : null}
          </View>
        ))}
      </View>
      <PortfolioGallery
        items={items}
        initialIndex={viewerIndex ?? 0}
        visible={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
      />
    </>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.reviewRow}>
      <ThemedText type="smallBold">{review.authorName}</ThemedText>
      <View style={styles.ratingRow}>
        <SymbolView
          name={{ ios: 'star.fill', android: 'star', web: 'star' }}
          size={14}
          tintColor={theme.textSecondary}
        />
        <ThemedText type="small" themeColor="textSecondary">
          {review.rating} · {formatBookingDate(review.createdAt)}
        </ThemedText>
      </View>
      <ThemedText type="small">{review.text}</ThemedText>
    </ThemedView>
  );
}

function ServiceRow({ providerId, service }: { providerId: string; service: Service }) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.serviceRow}>
      <View style={styles.serviceCopy}>
        <ThemedText style={styles.serviceName}>{service.name}</ThemedText>
        <ThemedText style={styles.servicePrice}>{formatThb(service.priceThb)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDuration(service.durationMinutes)}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Book ${service.name}`}
        onPress={() =>
          router.push({
            pathname: '/booking/[providerId]',
            params: { providerId, serviceId: service.id },
          })
        }
        style={({ pressed }) => [
          styles.bookButton,
          { backgroundColor: theme.backgroundSelected },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="smallBold" themeColor="onPrimary">
          Book
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  details: {
    gap: Spacing.four,
  },
  image: {
    width: '100%',
    height: 240,
  },
  favorite: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
  },
  status: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  statusBlock: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.two,
  },
  actionButton: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  intro: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.one,
  },
  heading: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: 600,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  bio: {
    marginTop: Spacing.two,
  },
  section: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  directionsButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  portfolioRows: {
    width: '100%',
    gap: Spacing.two,
  },
  portfolioRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
  },
  portfolioTile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  portfolioSpacer: {
    flex: 1,
  },
  portfolioImage: {
    width: '100%',
    height: '100%',
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  reviewRow: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  serviceCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  serviceName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  servicePrice: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  bookButton: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  skeletonCover: {
    height: 240,
    width: '100%',
    borderRadius: 0,
  },
  skeletonName: {
    height: 24,
    width: '62%',
  },
  skeletonLocation: {
    height: 14,
    width: '48%',
  },
  skeletonRating: {
    height: 14,
    width: '36%',
  },
  skeletonBio: {
    height: 14,
    width: '100%',
  },
  skeletonBioShort: {
    height: 14,
    width: '78%',
  },
  skeletonSectionTitle: {
    height: 20,
    width: '32%',
  },
  skeletonServiceName: {
    height: 16,
    width: '70%',
  },
  skeletonServiceMeta: {
    height: 12,
    width: '44%',
  },
  skeletonBook: {
    height: 44,
    width: 72,
    borderRadius: Spacing.three,
  },
  skeletonPortfolioTile: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Spacing.three,
  },
});
