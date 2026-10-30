import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBookings } from '@/context/bookings-context';
import { getBookedProviderService } from '@/data/repositories/catalog';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { formatBookingDate, formatBookingStatus, formatThb } from '@/lib/format';

export default function BookingSuccessScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { bookingId: bookingIdParam } = useLocalSearchParams<{ bookingId?: string }>();
  const bookingId = typeof bookingIdParam === 'string' ? bookingIdParam : undefined;
  const { bookings } = useBookings();
  const booking = bookingId ? bookings.find((item) => item.id === bookingId) : undefined;
  const [detailsEpoch, setDetailsEpoch] = useState(0);
  const { data: details, loading, error } = useAsyncData(
    () =>
      booking
        ? getBookedProviderService(booking.providerId, booking.serviceId)
        : Promise.resolve(undefined),
    [booking?.id, booking?.providerId, booking?.serviceId, detailsEpoch],
    [booking?.id, booking?.providerId, booking?.serviceId],
  );

  function retryDetails() {
    setDetailsEpoch((current) => current + 1);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: false,
          title: 'Request sent',
        }}
      />
      <View
        style={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.four },
        ]}>
        <View style={styles.hero} accessibilityLabel="Request sent">
          <SymbolView
            name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
            size={56}
            tintColor={Brand.dustyRose}
          />
        </View>
        <ThemedText themeColor="textSecondary">
          Your booking request was sent successfully. The business still needs to confirm or decline
          it — this appointment is not confirmed yet.
        </ThemedText>

        {booking ? (
          <ThemedView type="backgroundElement" style={styles.summary}>
            {details ? (
              <>
                <ThemedText style={styles.summaryName}>{details.provider.name}</ThemedText>
                <ThemedText style={styles.summaryService}>{details.service.name}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatThb(details.service.priceThb)}
                </ThemedText>
              </>
            ) : loading ? (
              <>
                <SkeletonBlock style={styles.skeletonName} />
                <SkeletonBlock style={styles.skeletonService} />
              </>
            ) : null}
            <ThemedText type="small">
              {formatBookingDate(booking.date)} · {booking.time}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Status: {formatBookingStatus(booking.status)}
            </ThemedText>
          </ThemedView>
        ) : (
          <ThemedText themeColor="textSecondary">This booking was not found.</ThemedText>
        )}

        {booking && error ? (
          <View style={styles.statusBlock}>
            <ThemedText themeColor="textSecondary">{error}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading booking details"
              onPress={retryDetails}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">Retry</ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.actions}>
          {bookingId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View booking"
              onPress={() =>
                router.push({
                  pathname: '/bookings/[id]',
                  params: { id: bookingId },
                })
              }
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="onPrimary">
                View booking
              </ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Home"
            onPress={() => router.dismissAll()}
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold">Back to Home</ThemedText>
          </Pressable>
        </View>
      </View>
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
  hero: {
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  summary: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  summaryName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  summaryService: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  actions: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  statusBlock: {
    gap: Spacing.two,
  },
  skeletonName: {
    height: 16,
    width: '62%',
  },
  skeletonService: {
    height: 16,
    width: '44%',
  },
  pressed: {
    opacity: 0.7,
  },
});
