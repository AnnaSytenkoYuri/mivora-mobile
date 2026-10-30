import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvailabilityTimePicker } from '@/components/availability-time-picker';
import { SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useBookings } from '@/context/bookings-context';
import { getBookedProviderService } from '@/data/repositories/catalog';
import { useAsyncData } from '@/hooks/use-async-data';
import { useProviderDayAvailability } from '@/hooks/use-provider-day-availability';
import { useTheme } from '@/hooks/use-theme';
import { getBookableBangkokDates } from '@/lib/booking-dates';
import { isUpcomingManageable } from '@/lib/booking-list';
import { formatBookingDate, formatDuration, formatThb } from '@/lib/format';

function formatCompactBookingDate(isoDate: string): string {
  return formatBookingDate(isoDate).replace(/,/g, '');
}

export default function RescheduleBookingScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { bookings, rescheduleBooking } = useBookings();
  const booking = id ? bookings.find((item) => item.id === id) : undefined;
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const { data: details, loading, error: catalogError } = useAsyncData(
    () =>
      booking
        ? getBookedProviderService(booking.providerId, booking.serviceId)
        : Promise.resolve(undefined),
    [booking?.id, booking?.providerId, booking?.serviceId, catalogEpoch],
    [booking?.id, booking?.providerId, booking?.serviceId],
  );
  const dates = useMemo(() => getBookableBangkokDates(), []);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [footerHeight, setFooterHeight] = useState(120);

  const durationMinutes = booking?.durationMinutes ?? details?.service.durationMinutes;
  const availability = useProviderDayAvailability({
    providerId: booking?.providerId,
    date,
    serviceDurationMinutes: durationMinutes,
    ignoreOccupied: booking
      ? { date: booking.date, startTime: booking.time }
      : undefined,
  });

  useEffect(() => {
    if (!booking) {
      return;
    }

    setDate(dates.includes(booking.date) ? booking.date : null);
    setTime(booking.time);
  }, [booking?.date, booking?.id, booking?.time, dates]);

  useEffect(() => {
    if (time !== null && availability.availability?.kind === 'open' && !availability.availability.startTimes.includes(time)) {
      setTime(null);
    }
  }, [availability.availability, time]);

  const canManage = booking ? isUpcomingManageable(booking) : false;
  const hasChanged = booking !== undefined && (date !== booking.date || time !== booking.time);
  const canConfirm =
    canManage &&
    date !== null &&
    time !== null &&
    hasChanged &&
    !submitting &&
    details !== undefined &&
    durationMinutes !== undefined &&
    !availability.loading &&
    availability.error === undefined &&
    availability.availability?.kind === 'open' &&
    availability.availability.startTimes.includes(time);

  const showForm = booking !== undefined && details !== undefined && canManage;

  function onSelectDate(nextDate: string) {
    if (nextDate !== date) {
      availability.prepareForDateChange();
    }
    setDate(nextDate);
    setTime(null);
    setError(undefined);
  }

  async function confirmReschedule() {
    if (!id || !date || !time || !canConfirm) {
      return;
    }

    setSubmitting(true);
    setError(undefined);
    const result = await rescheduleBooking(id, date, time);
    if (!result.ok) {
      setError(result.message);
      setSubmitting(false);
      if (/no longer available|not available/i.test(result.message)) {
        setTime(null);
        availability.reload();
      }
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
          title: 'Reschedule',
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          showForm
            ? { paddingBottom: footerHeight + Spacing.four }
            : { paddingBottom: Spacing.four + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}>
        {loading ? (
          <RescheduleSkeleton />
        ) : catalogError ? (
          <View style={styles.statusBlock}>
            <ThemedText themeColor="textSecondary">{catalogError}</ThemedText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading booking"
              onPress={() => setCatalogEpoch((current) => current + 1)}
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
        ) : !booking ? (
          <ThemedText themeColor="textSecondary">This booking was not found.</ThemedText>
        ) : !canManage ? (
          <ThemedText themeColor="textSecondary">This booking cannot be rescheduled.</ThemedText>
        ) : details ? (
          <>
            <View style={styles.block}>
              <ThemedText style={styles.heading}>{details.provider.name}</ThemedText>
              <ThemedText style={styles.serviceName}>{details.service.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Current: {formatBookingDate(booking.date)} · {booking.time}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(durationMinutes ?? details.service.durationMinutes)} ·{' '}
                {formatThb(details.service.priceThb)}
              </ThemedText>
            </View>

            <View style={styles.block}>
              <ThemedText style={styles.sectionTitle}>Date</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Dates are Asia/Bangkok (ICT). Choose a different date or time.
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
              onSelectTime={(slot) => {
                setTime(slot);
                setError(undefined);
              }}
              onRetry={availability.reload}
            />
          </>
        ) : (
          <ThemedText themeColor="textSecondary">This booking cannot be rescheduled.</ThemedText>
        )}
      </ScrollView>
      {showForm ? (
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
              Choose a different date or time to continue.
            </ThemedText>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={submitting ? 'Saving reschedule' : 'Confirm reschedule'}
            accessibilityState={{ disabled: !canConfirm, busy: submitting }}
            disabled={!canConfirm}
            onPress={() => {
              void confirmReschedule();
            }}
            style={({ pressed }) => [
              styles.confirmButton,
              { backgroundColor: theme.backgroundSelected },
              !canConfirm && styles.confirmDisabled,
              pressed && canConfirm && styles.pressed,
            ]}>
            <ThemedText type="smallBold" themeColor="onPrimary">
              {submitting ? 'Saving…' : 'Confirm reschedule'}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </ThemedView>
  );
}

function RescheduleSkeleton() {
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
    width: '48%',
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
