import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookingStatusChip } from '@/components/booking-card';
import { SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import { useNotifications } from '@/context/notifications-context';
import { getBookedProviderService } from '@/data/repositories/catalog';
import { getReviewForBooking } from '@/data/repositories/reviews';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import {
  bookingCatalogDisplay,
  shouldFetchBookingCatalog,
  shouldRestartCatalogFetch,
} from '@/lib/booking-catalog-state';
import { bookingDetailsViewState, parseRouteBookingId } from '@/lib/booking-load-state';
import { isPastConfirmed, isUpcomingManageable } from '@/lib/booking-list';
import { formatBookingDate, formatDuration, formatThb } from '@/lib/format';

export default function BookingDetailsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const { user, isLoading: authLoading } = useAuth();
  const { bookings, bookingsStatus, bookingsError, cancelBooking, refreshBookings } = useBookings();
  const { markNotificationsForBooking } = useNotifications();
  const [focusKey, setFocusKey] = useState(0);
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [appState, setAppState] = useState(AppState.currentState);
  const bookingId = parseRouteBookingId(id);
  const booking = bookingId ? bookings.find((item) => item.id === bookingId) : undefined;
  const detailsRef = useRef(false);
  const viewState = bookingDetailsViewState({
    routeBookingId: bookingId,
    authReady: !authLoading,
    signedIn: user !== null,
    bookingsStatus,
    bookingFound: booking !== undefined,
  });
  const fetchCatalog = shouldFetchBookingCatalog({
    bookingFound: booking !== undefined,
    appState,
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
      if (
        shouldRestartCatalogFetch({
          event: 'app_became_active',
          detailsLoaded: detailsRef.current,
          previousBookingKey: bookingId,
          nextBookingKey: bookingId,
        }) &&
        nextState === 'active'
      ) {
        setCatalogEpoch((current) => current + 1);
      }
    });
    return () => {
      subscription.remove();
    };
  }, [bookingId]);

  useFocusEffect(
    useCallback(() => {
      setFocusKey((current) => current + 1);
      if (
        shouldRestartCatalogFetch({
          event: 'screen_focused',
          detailsLoaded: detailsRef.current,
          previousBookingKey: bookingId,
          nextBookingKey: bookingId,
        })
      ) {
        setCatalogEpoch((current) => current + 1);
      }
      if (user) {
        void refreshBookings();
      }
      if (user && bookingId) {
        void markNotificationsForBooking(bookingId);
      }
    }, [user, bookingId, refreshBookings, markNotificationsForBooking]),
  );

  const { data: details, loading, error } = useAsyncData(
    () => {
      if (!booking) {
        return Promise.reject(new Error('Could not load provider details.'));
      }

      return getBookedProviderService(booking.providerId, booking.serviceId);
    },
    [booking?.id, booking?.providerId, booking?.serviceId, catalogEpoch, appState],
    [booking?.id, booking?.providerId, booking?.serviceId],
    { enabled: fetchCatalog },
  );
  detailsRef.current = details !== undefined;
  const catalogDisplay = bookingCatalogDisplay({
    detailsLoaded: details !== undefined,
    loading,
    error,
  });
  const { data: existingReview, loading: reviewLoading } = useAsyncData(
    () =>
      user && bookingId ? getReviewForBooking(bookingId) : Promise.resolve(undefined),
    [user?.id, bookingId, focusKey],
    [user?.id, bookingId],
  );
  const canManage = booking ? isUpcomingManageable(booking) : false;
  const canReview =
    user !== null && booking !== undefined && isPastConfirmed(booking) && !reviewLoading && !existingReview;
  const reviewSubmitted =
    user !== null && booking !== undefined && isPastConfirmed(booking) && existingReview !== undefined;
  const durationMinutes = details?.service.durationMinutes ?? booking?.durationMinutes;

  function confirmCancel() {
    if (!bookingId) {
      return;
    }

    Alert.alert(
      'Cancel this booking?',
      'The appointment will be cancelled. It will still appear in My bookings.',
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: () => {
            void cancelBooking(bookingId).then((result) => {
              if (!result.ok) {
                Alert.alert('Could not cancel', result.message);
              }
            });
          },
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Booking',
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.four },
        ]}
        showsVerticalScrollIndicator={false}>
        {viewState === 'loading' ? (
          <ThemedView
            type="backgroundElement"
            accessibilityLabel="Loading booking"
            style={styles.summary}>
            <SkeletonBlock style={styles.skeletonName} />
            <SkeletonBlock style={styles.skeletonService} />
            <SkeletonBlock style={styles.skeletonMeta} />
          </ThemedView>
        ) : viewState === 'error' ? (
          <View style={styles.statusBlock}>
            <ThemedText themeColor="textSecondary">
              {bookingsError ?? 'Could not load this booking.'}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading booking"
              onPress={() => {
                void refreshBookings();
              }}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">Retry</ThemedText>
            </Pressable>
          </View>
        ) : viewState === 'not_found' ? (
          <ThemedText themeColor="textSecondary">This booking was not found.</ThemedText>
        ) : booking ? (
          <>
            <ThemedView type="backgroundElement" style={styles.summary}>
              {catalogDisplay === 'ready' && details ? (
                <ThemedText style={styles.heading}>{details.provider.name}</ThemedText>
              ) : catalogDisplay === 'loading' ? (
                <SkeletonBlock style={styles.skeletonName} />
              ) : (
                <ThemedText style={styles.heading}>Provider details unavailable</ThemedText>
              )}
              {catalogDisplay === 'ready' && details ? (
                <ThemedText style={styles.serviceName}>{details.service.name}</ThemedText>
              ) : catalogDisplay === 'loading' ? (
                <SkeletonBlock style={styles.skeletonService} />
              ) : (
                <ThemedText style={styles.serviceName}>Service details unavailable</ThemedText>
              )}
              {catalogDisplay === 'ready' && details ? (
                <ThemedText style={styles.price}>{formatThb(details.service.priceThb)}</ThemedText>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                {formatBookingDate(booking.date)} · {booking.time}
              </ThemedText>
              {durationMinutes !== undefined ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDuration(durationMinutes)}
                </ThemedText>
              ) : null}
              <BookingStatusChip status={booking.status} surface="card" />
            </ThemedView>

            {catalogDisplay === 'error' || catalogDisplay === 'missing' ? (
              <View style={styles.statusBlock}>
                <ThemedText themeColor="textSecondary">
                  {error ?? 'Could not load provider and service details.'}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading booking details"
                  onPress={() => {
                    setCatalogEpoch((current) => current + 1);
                  }}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold">Retry</ThemedText>
                </Pressable>
              </View>
            ) : null}

            {canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reschedule booking"
                onPress={() =>
                  router.push({
                    pathname: '/bookings/reschedule/[id]',
                    params: { id: booking.id },
                  })
                }
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Reschedule
                </ThemedText>
              </Pressable>
            ) : null}

            {details?.canViewPublicProfile ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View provider"
                onPress={() =>
                  router.push({
                    pathname: '/provider/[id]',
                    params: { id: details.provider.id },
                  })
                }
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold">View provider</ThemedText>
              </Pressable>
            ) : null}

            {canReview ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Leave a review"
                onPress={() =>
                  router.push({
                    pathname: '/reviews/create/[bookingId]',
                    params: { bookingId: booking.id },
                  })
                }
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Leave a review
                </ThemedText>
              </Pressable>
            ) : null}

            {reviewSubmitted ? (
              <ThemedText type="small" themeColor="textSecondary">
                Review submitted
              </ThemedText>
            ) : null}

            {canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel booking"
                onPress={confirmCancel}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Cancel booking
                </ThemedText>
              </Pressable>
            ) : null}
          </>
        ) : (
          <ThemedText themeColor="textSecondary">This booking was not found.</ThemedText>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  heading: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: 600,
  },
  serviceName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  price: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  summary: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  statusBlock: {
    gap: Spacing.two,
  },
  skeletonName: {
    height: 24,
    width: '62%',
  },
  skeletonService: {
    height: 16,
    width: '44%',
  },
  skeletonMeta: {
    height: 12,
    width: '36%',
  },
  pressed: {
    opacity: 0.7,
  },
});
