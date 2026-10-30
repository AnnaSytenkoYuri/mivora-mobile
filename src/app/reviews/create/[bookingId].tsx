import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import { getBookedProviderService, invalidateCatalogCache } from '@/data/repositories/catalog';
import { createReview, getReviewForBooking } from '@/data/repositories/reviews';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { isPastConfirmed } from '@/lib/booking-list';

const RATINGS = [1, 2, 3, 4, 5] as const;

export default function CreateReviewScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const { getBookingById } = useBookings();
  const { bookingId: bookingIdParam } = useLocalSearchParams<{ bookingId?: string }>();
  const bookingId = typeof bookingIdParam === 'string' ? bookingIdParam : undefined;
  const booking = bookingId ? getBookingById(bookingId) : undefined;
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const { data, loading, error: loadError } = useAsyncData(async () => {
    if (!booking) {
      return undefined;
    }

    const [details, existingReview] = await Promise.all([
      getBookedProviderService(booking.providerId, booking.serviceId),
      getReviewForBooking(booking.id),
    ]);

    if (!details) {
      return undefined;
    }

    return { details, existingReview, eligible: isPastConfirmed(booking) && !existingReview };
  }, [booking?.id, booking?.providerId, booking?.serviceId, booking?.date, booking?.status]);

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  const canSubmit =
    rating !== null && text.trim().length > 0 && !submitting && data?.eligible === true;

  async function onSubmit() {
    if (!bookingId || rating === null || submitting || !data?.eligible) {
      return;
    }

    setSubmitting(true);
    setError(undefined);
    const result = await createReview({
      bookingId,
      rating,
      text,
    });

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      return;
    }

    invalidateCatalogCache();
    router.back();
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Leave a review',
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {loading ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : loadError ? (
          <ThemedText themeColor="textSecondary">{loadError}</ThemedText>
        ) : data?.eligible && data.details ? (
          <>
            <View style={styles.block}>
              <ThemedText style={styles.heading}>{data.details.provider.name}</ThemedText>
              <ThemedText>{data.details.service.name}</ThemedText>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Rating</ThemedText>
              <View style={styles.stars}>
                {RATINGS.map((value) => {
                  const selected = rating !== null && value <= rating;
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
                      disabled={submitting}
                      onPress={() => setRating(value)}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <ThemedText style={[styles.star, !selected && styles.starIdle]}>★</ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Review</ThemedText>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="How was your appointment?"
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
                editable={!submitting}
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
                void onSubmit();
              }}
              style={({ pressed }) => [
                !canSubmit && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}>
              <ThemedView type="backgroundSelected" style={styles.button}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  {submitting ? 'Submitting…' : 'Submit'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </>
        ) : data?.existingReview ? (
          <ThemedText themeColor="textSecondary">A review has already been submitted for this booking.</ThemedText>
        ) : (
          <ThemedText themeColor="textSecondary">This booking cannot be reviewed.</ThemedText>
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
    paddingVertical: Spacing.four,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  heading: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
  },
  block: {
    gap: Spacing.two,
  },
  stars: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  star: {
    fontSize: 32,
    lineHeight: 38,
  },
  starIdle: {
    opacity: 0.35,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  textarea: {
    minHeight: 140,
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
