import { Redirect, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookingStatusChip } from '@/components/booking-card';
import { ContentFadeIn, SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import { useNotifications } from '@/context/notifications-context';
import type { BookingStatus } from '@/data/types';
import {
  completeOwnedBooking,
  confirmOwnedBooking,
  declineOwnedBooking,
  fetchOwnedProviderBookings,
  groupOwnedProviderBookings,
  isOwnedBookingCompletable,
  type OwnedBookingActionResult,
  type OwnedProviderBooking,
} from '@/data/repositories/provider-bookings';
import { useTheme } from '@/hooks/use-theme';
import { formatBookingDate } from '@/lib/format';

export default function ProviderBookingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { applyCustomerBookingStatus, refreshBookings } = useBookings();
  const { markNotificationsForBooking } = useNotifications();
  const [bookings, setBookings] = useState<OwnedProviderBooking[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [actingId, setActingId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const bookingsRef = useRef<OwnedProviderBooking[] | undefined>(undefined);
  bookingsRef.current = bookings;

  const refreshList = useCallback(async () => {
    const next = await fetchOwnedProviderBookings();
    bookingsRef.current = next;
    setBookings(next);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setLoading(false);
        return;
      }

      let cancelled = false;
      const isInitialLoad = bookingsRef.current === undefined;
      if (isInitialLoad) {
        setLoading(true);
      }

      void fetchOwnedProviderBookings()
        .then((next) => {
          if (cancelled) {
            return;
          }

          bookingsRef.current = next;
          setBookings(next);
          setError(undefined);
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (cancelled) {
            return;
          }

          setLoading(false);
          setError(caught instanceof Error ? caught.message : 'Could not load customer bookings.');
        });

      return () => {
        cancelled = true;
      };
    }, [reloadKey, user]),
  );

  async function runAction(
    bookingId: string,
    nextStatus: BookingStatus,
    action: () => Promise<OwnedBookingActionResult>,
  ) {
    if (actingId !== null) {
      return;
    }

    setActingId(bookingId);
    setActionError(undefined);

    const result = await action();
    if (!result.ok) {
      setActionError(result.message);
      if (result.stale) {
        try {
          await refreshList();
        } catch (caught: unknown) {
          setError(caught instanceof Error ? caught.message : 'Could not load customer bookings.');
        }
      }
      setActingId(null);
      return;
    }

    applyCustomerBookingStatus(bookingId, nextStatus);
    void refreshBookings();

    try {
      await refreshList();
      setActionError(undefined);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not load customer bookings.');
    }

    setActingId(null);
  }

  function onSeen(booking: OwnedProviderBooking) {
    void markNotificationsForBooking(booking.id);
  }

  function onConfirm(booking: OwnedProviderBooking) {
    onSeen(booking);
    void runAction(booking.id, 'confirmed', () => confirmOwnedBooking(booking.id));
  }

  function onDecline(booking: OwnedProviderBooking) {
    Alert.alert(
      'Decline this booking?',
      'The customer will see this booking as declined. You cannot undo this.',
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => {
            onSeen(booking);
            void runAction(booking.id, 'declined', () => declineOwnedBooking(booking.id));
          },
        },
      ],
    );
  }

  function onComplete(booking: OwnedProviderBooking) {
    Alert.alert(
      'Mark this booking as completed?',
      'Only use this after the appointment has finished.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Complete',
          onPress: () => {
            onSeen(booking);
            void runAction(booking.id, 'completed', () => completeOwnedBooking(booking.id));
          },
        },
      ],
    );
  }

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  const grouped = bookings ? groupOwnedProviderBookings(bookings) : undefined;
  const pendingUpcoming = grouped?.upcoming.filter((booking) => booking.status === 'pending') ?? [];
  const remainingUpcoming = grouped?.upcoming.filter((booking) => booking.status !== 'pending') ?? [];
  const hasBookings =
    grouped !== undefined &&
    (grouped.upcoming.length > 0 ||
      grouped.past.length > 0 ||
      grouped.cancelled.length > 0 ||
      grouped.declined.length > 0);
  const busy = actingId !== null;

  function retryLoad() {
    setReloadKey((current) => current + 1);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Customer bookings',
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        {loading && bookings === undefined && !error ? (
          <CustomerBookingsSkeleton />
        ) : (
          <ContentFadeIn>
            {error && !hasBookings ? (
              <View style={styles.block}>
                <ThemedText themeColor="textSecondary">{error}</ThemedText>
                <RetryButton onPress={retryLoad} theme={theme} />
              </View>
            ) : hasBookings && grouped ? (
              <>
                {error || actionError ? (
                  <View style={styles.block}>
                    <ThemedText themeColor="textSecondary">{error ?? actionError}</ThemedText>
                    {error ? <RetryButton onPress={retryLoad} theme={theme} /> : null}
                  </View>
                ) : null}
                <BookingSection
                  title="Needs response"
                  items={pendingUpcoming}
                  actingId={actingId}
                  busy={busy}
                  onSeen={onSeen}
                  onConfirm={onConfirm}
                  onDecline={onDecline}
                  onComplete={onComplete}
                />
                <BookingSection
                  title="Upcoming"
                  items={remainingUpcoming}
                  actingId={actingId}
                  busy={busy}
                  onSeen={onSeen}
                  onConfirm={onConfirm}
                  onDecline={onDecline}
                  onComplete={onComplete}
                />
                <BookingSection
                  title="Declined"
                  items={grouped.declined}
                  actingId={actingId}
                  busy={busy}
                  onSeen={onSeen}
                />
                <BookingSection
                  title="Cancelled"
                  items={grouped.cancelled}
                  actingId={actingId}
                  busy={busy}
                  onSeen={onSeen}
                />
                <BookingSection
                  title="Past"
                  items={grouped.past}
                  actingId={actingId}
                  busy={busy}
                  onSeen={onSeen}
                  onConfirm={onConfirm}
                  onDecline={onDecline}
                  onComplete={onComplete}
                />
              </>
            ) : (
              <View style={styles.block}>
                <ThemedText type="smallBold">No customer bookings yet</ThemedText>
                <ThemedText themeColor="textSecondary">
                  When a customer books one of your services, it will appear here. Draft and Published
                  businesses both keep this list.
                </ThemedText>
              </View>
            )}
          </ContentFadeIn>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function RetryButton({
  onPress,
  theme,
}: {
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Retry loading customer bookings"
      onPress={onPress}
      style={({ pressed }) => [
        styles.retry,
        { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="smallBold" themeColor="onPrimary">
        Try again
      </ThemedText>
    </Pressable>
  );
}

function CustomerBookingsSkeleton() {
  return (
    <View accessibilityLabel="Loading customer bookings" style={styles.block}>
      <SkeletonBlock style={styles.skeletonSection} />
      {['a', 'b', 'c'].map((key) => (
        <ThemedView key={key} type="backgroundElement" style={styles.card}>
          <SkeletonBlock style={styles.skeletonName} />
          <SkeletonBlock style={styles.skeletonService} />
          <SkeletonBlock style={styles.skeletonMeta} />
          <SkeletonBlock style={styles.skeletonStatus} />
        </ThemedView>
      ))}
    </View>
  );
}

function BookingSection({
  title,
  items,
  actingId,
  busy,
  onSeen,
  onConfirm,
  onDecline,
  onComplete,
}: {
  title: string;
  items: OwnedProviderBooking[];
  actingId: string | null;
  busy: boolean;
  onSeen: (booking: OwnedProviderBooking) => void;
  onConfirm?: (booking: OwnedProviderBooking) => void;
  onDecline?: (booking: OwnedProviderBooking) => void;
  onComplete?: (booking: OwnedProviderBooking) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <View style={styles.block}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {items.map((booking) => (
        <IncomingBookingRow
          key={booking.id}
          booking={booking}
          acting={actingId === booking.id}
          busy={busy}
          onSeen={onSeen}
          onConfirm={onConfirm}
          onDecline={onDecline}
          onComplete={onComplete}
        />
      ))}
    </View>
  );
}

function IncomingBookingRow({
  booking,
  acting,
  busy,
  onSeen,
  onConfirm,
  onDecline,
  onComplete,
}: {
  booking: OwnedProviderBooking;
  acting: boolean;
  busy: boolean;
  onSeen: (booking: OwnedProviderBooking) => void;
  onConfirm?: (booking: OwnedProviderBooking) => void;
  onDecline?: (booking: OwnedProviderBooking) => void;
  onComplete?: (booking: OwnedProviderBooking) => void;
}) {
  const theme = useTheme();
  const canDecide = booking.status === 'pending' && onConfirm && onDecline;
  const canComplete = onComplete !== undefined && isOwnedBookingCompletable(booking);
  const showCompleteHint = booking.status === 'confirmed' && !canComplete && onComplete !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${booking.customerName}, ${booking.serviceName}`}
      accessibilityHint="Marks related notifications as read. Confirm, decline, or complete with the action buttons."
      onPress={() => onSeen(booking)}
      style={({ pressed }) => [styles.cardPressable, pressed && styles.pressed]}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.cardHeader}>
          <ThemedText style={styles.customerName}>{booking.customerName}</ThemedText>
          <BookingStatusChip status={booking.status} surface="card" />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {booking.serviceName}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatBookingDate(booking.date)} · {booking.time}
        </ThemedText>
        {canDecide ? (
          acting ? (
            <View style={styles.actionSlot} accessibilityLabel="Updating">
              <ThemedText type="small" themeColor="textSecondary">
                Updating…
              </ThemedText>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm booking"
                disabled={busy}
                onPress={() => onConfirm(booking)}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: theme.backgroundSelected },
                  busy && styles.disabled,
                  pressed && !busy && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Confirm
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Decline booking"
                disabled={busy}
                onPress={() => onDecline(booking)}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: theme.background },
                  busy && styles.disabled,
                  pressed && !busy && styles.pressed,
                ]}>
                <ThemedText type="smallBold">Decline</ThemedText>
              </Pressable>
            </View>
          )
        ) : canComplete ? (
          acting ? (
            <View style={styles.actionSlot} accessibilityLabel="Updating">
              <ThemedText type="small" themeColor="textSecondary">
                Updating…
              </ThemedText>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Complete booking"
              disabled={busy}
              onPress={() => onComplete(booking)}
              style={({ pressed }) => [
                styles.completeButton,
                { backgroundColor: theme.backgroundSelected },
                busy && styles.disabled,
                pressed && !busy && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="onPrimary">
                Complete
              </ThemedText>
            </Pressable>
          )
        ) : showCompleteHint ? (
          <ThemedText type="small" themeColor="textSecondary">
            Complete after the appointment.
          </ThemedText>
        ) : acting ? (
          <View style={styles.actionSlot} accessibilityLabel="Updating">
            <ThemedText type="small" themeColor="textSecondary">
              Updating…
            </ThemedText>
          </View>
        ) : null}
      </ThemedView>
    </Pressable>
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
  block: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  cardPressable: {
    alignSelf: 'stretch',
  },
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  customerName: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actionSlot: {
    minHeight: 44,
    justifyContent: 'center',
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  completeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  retry: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
  skeletonSection: {
    height: 20,
    width: '42%',
  },
  skeletonName: {
    height: 16,
    width: '46%',
  },
  skeletonService: {
    height: 14,
    width: '68%',
  },
  skeletonMeta: {
    height: 14,
    width: '52%',
  },
  skeletonStatus: {
    height: 24,
    width: '28%',
  },
});
