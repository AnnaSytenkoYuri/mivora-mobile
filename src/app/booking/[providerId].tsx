import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvailabilityTimePicker } from '@/components/availability-time-picker';
import { SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import { getProviderService } from '@/data/repositories/catalog';
import { useAsyncData } from '@/hooks/use-async-data';
import { useProviderDayAvailability } from '@/hooks/use-provider-day-availability';
import { useTheme } from '@/hooks/use-theme';
import {
  firstSearchParam,
  parseRestoredBookingSelection,
  signInHref,
  signUpHref,
} from '@/lib/booking-auth-return';
import { getBookableBangkokDates } from '@/lib/booking-dates';
import { formatBookingDate, formatDuration, formatThb } from '@/lib/format';

function formatCompactBookingDate(isoDate: string): string {
  return formatBookingDate(isoDate).replace(/,/g, '');
}

export default function BookingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const {
    providerId: providerIdParam,
    serviceId: serviceIdParam,
    date: dateParam,
    time: timeParam,
  } = useLocalSearchParams<{
    providerId?: string | string[];
    serviceId?: string | string[];
    date?: string | string[];
    time?: string | string[];
  }>();
  const providerId = firstSearchParam(providerIdParam);
  const serviceId = firstSearchParam(serviceIdParam);
  const { user } = useAuth();
  const { addBooking } = useBookings();
  const dates = useMemo(() => getBookableBangkokDates(), []);
  const restored = parseRestoredBookingSelection({ date: dateParam, time: timeParam });
  const restoredDate = restored.date && dates.includes(restored.date) ? restored.date : null;
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [footerHeight, setFooterHeight] = useState(120);
  const [date, setDate] = useState<string | null>(restoredDate);
  const [time, setTime] = useState<string | null>(restored.time);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  useEffect(() => {
    if (restoredDate) {
      setDate(restoredDate);
    }
    if (restored.time) {
      setTime(restored.time);
    }
  }, [restoredDate, restored.time]);

  const {
    data: selection,
    loading,
    error: catalogError,
  } = useAsyncData(
    () =>
      providerId && serviceId
        ? getProviderService(providerId, serviceId)
        : Promise.resolve(undefined),
    [providerId, serviceId, catalogEpoch],
    [providerId, serviceId],
  );

  const availability = useProviderDayAvailability({
    providerId,
    date,
    serviceDurationMinutes: selection?.service.durationMinutes,
  });

  const availableTimes = availability.availability?.kind === 'open' ? availability.availability.startTimes : [];
  const hasValidSelection =
    date !== null &&
    time !== null &&
    availability.availability?.kind === 'open' &&
    availableTimes.includes(time);

  useEffect(() => {
    if (
      time !== null &&
      availability.availability?.kind === 'open' &&
      !availability.availability.startTimes.includes(time)
    ) {
      setTime(null);
    }
  }, [availability.availability, time]);

  const canConfirm =
    date !== null &&
    time !== null &&
    !submitting &&
    selection !== undefined &&
    !availability.loading &&
    availability.error === undefined &&
    availability.availability?.kind === 'open' &&
    availability.availability.startTimes.includes(time);

  function onSelectDate(nextDate: string) {
    if (nextDate !== date) {
      availability.prepareForDateChange();
    }
    setDate(nextDate);
    setTime(null);
    setError(undefined);
  }

  function retryCatalog() {
    setCatalogEpoch((current) => current + 1);
  }

  function openAuth(path: 'sign-in' | 'sign-up') {
    if (!selection || !date || !time) {
      return;
    }

    const returnTo = {
      providerId: selection.provider.id,
      serviceId: selection.service.id,
      date,
      time,
    };

    setAuthPromptVisible(false);
    router.push(path === 'sign-in' ? signInHref(returnTo) : signUpHref(returnTo));
  }

  async function confirmBooking() {
    if (!selection || !date || !time || submitting || !canConfirm) {
      return;
    }

    if (!user) {
      setAuthPromptVisible(true);
      return;
    }

    setSubmitting(true);
    setError(undefined);
    const result = await addBooking({
      providerId: selection.provider.id,
      serviceId: selection.service.id,
      date,
      time,
    });

    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      if (/no longer available|not available/i.test(result.message)) {
        setTime(null);
        availability.reload();
      }
      return;
    }

    router.replace({
      pathname: '/booking/success',
      params: { bookingId: result.booking.id },
    });
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Book',
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          selection ? { paddingBottom: footerHeight + Spacing.four } : null,
        ]}
        showsVerticalScrollIndicator={false}>
        {loading ? (
          <BookingSkeleton />
        ) : catalogError ? (
          <View style={styles.statusBlock}>
            <ThemedText themeColor="textSecondary">{catalogError}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading booking"
              onPress={retryCatalog}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="onPrimary">
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : selection ? (
          <>
            <View style={styles.block}>
              <ThemedText style={styles.heading}>{selection.provider.name}</ThemedText>
              <ThemedText style={styles.serviceName}>{selection.service.name}</ThemedText>
              <ThemedText style={styles.servicePrice}>{formatThb(selection.service.priceThb)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(selection.service.durationMinutes)}
              </ThemedText>
            </View>

            <View style={styles.block}>
              <ThemedText style={styles.sectionTitle}>Date</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Times are shown in Bangkok time (ICT).
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dateRow}>
                {dates.map((isoDate) => {
                  const selected = date === isoDate;
                  return (
                    <Pressable
                      key={isoDate}
                      accessibilityRole="button"
                      accessibilityLabel={formatBookingDate(isoDate)}
                      accessibilityState={{ selected }}
                      onPress={() => onSelectDate(isoDate)}
                      style={({ pressed }) => [
                        styles.dateChip,
                        {
                          backgroundColor: selected
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                        },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="small" themeColor={selected ? 'onPrimary' : undefined}>
                        {formatCompactBookingDate(isoDate)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <AvailabilityTimePicker
              date={date}
              availability={availability.availability}
              loading={availability.loading}
              error={availability.error}
              selectedTime={time}
              onSelectTime={setTime}
              onRetry={availability.reload}
            />

            {hasValidSelection ? (
              <ThemedView type="backgroundElement" style={styles.summary}>
                <ThemedText type="small">
                  {formatBookingDate(date)} · {time}
                </ThemedText>
              </ThemedView>
            ) : null}
          </>
        ) : (
          <ThemedText themeColor="textSecondary">This booking could not be started.</ThemedText>
        )}
      </ScrollView>
      {selection ? (
        <View
          onLayout={(event) => {
            const nextHeight = Math.round(event.nativeEvent.layout.height);
            setFooterHeight((current) => (current === nextHeight ? current : nextHeight));
          }}
          style={[
            styles.footer,
            {
              backgroundColor: theme.background,
              paddingBottom: Math.max(insets.bottom, Spacing.three),
            },
          ]}>
          {error ? <ThemedText>{error}</ThemedText> : null}
          {!canConfirm && !submitting ? (
            <ThemedText type="small" themeColor="textSecondary">
              Select a date and time to continue.
            </ThemedText>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={submitting ? 'Sending booking request' : 'Request booking'}
            accessibilityState={{ disabled: !canConfirm, busy: submitting }}
            disabled={!canConfirm}
            onPress={() => {
              void confirmBooking();
            }}
            style={({ pressed }) => [
              styles.confirmButton,
              { backgroundColor: theme.backgroundSelected },
              !canConfirm && styles.confirmDisabled,
              pressed && canConfirm && styles.pressed,
            ]}>
            <ThemedText type="smallBold" themeColor="onPrimary">
              {submitting ? 'Sending...' : 'Request booking'}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      <Modal
        visible={authPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAuthPromptVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            onPress={() => setAuthPromptVisible(false)}
            style={styles.modalBackdrop}
          />
          <ThemedView type="backgroundElement" style={styles.modalCard}>
            <ThemedText type="smallBold">Sign in required</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Sign in or create an account to request this booking. The business will confirm it.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in"
              onPress={() => openAuth('sign-in')}
              style={({ pressed }) => [
                styles.modalButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="onPrimary">
                Sign in
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create account"
              onPress={() => openAuth('sign-up')}
              style={({ pressed }) => [
                styles.modalButton,
                { backgroundColor: theme.background },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="smallBold">Create account</ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

function BookingSkeleton() {
  return (
    <View accessibilityLabel="Loading booking" style={styles.skeleton}>
      <SkeletonBlock style={styles.skeletonName} />
      <SkeletonBlock style={styles.skeletonService} />
      <SkeletonBlock style={styles.skeletonMeta} />
      <SkeletonBlock style={styles.skeletonSectionTitle} />
      <View style={styles.dateRow}>
        {['a', 'b', 'c', 'd'].map((key) => (
          <SkeletonBlock key={key} style={styles.skeletonDateChip} />
        ))}
      </View>
      <SkeletonBlock style={styles.skeletonSectionTitle} />
      <View style={styles.timeSkeletonRow}>
        {['a', 'b', 'c'].map((key) => (
          <SkeletonBlock key={key} style={styles.skeletonTimeChip} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
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
  servicePrice: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  block: {
    gap: Spacing.two,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dateChip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  confirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  confirmDisabled: {
    opacity: 0.4,
  },
  retryButton: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  statusBlock: {
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  modalCard: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  modalButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  skeleton: {
    gap: Spacing.two,
  },
  skeletonName: {
    height: 24,
    width: '58%',
  },
  skeletonService: {
    height: 16,
    width: '42%',
  },
  skeletonMeta: {
    height: 14,
    width: '28%',
  },
  skeletonSectionTitle: {
    height: 20,
    width: '24%',
    marginTop: Spacing.two,
  },
  skeletonDateChip: {
    height: 44,
    width: 88,
    borderRadius: Spacing.three,
  },
  skeletonTimeChip: {
    height: 44,
    width: 72,
    borderRadius: Spacing.three,
  },
  timeSkeletonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
});
