import { router, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookingCard } from '@/components/booking-card';
import { SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, cardElevationStyle, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import { useLocalAppointmentReminders } from '@/context/local-appointment-reminders-context';
import type { LocalNotificationPermission } from '@/lib/local-notifications';
import { useNotifications } from '@/context/notifications-context';
import type { OwnedProviderProfile } from '@/data/repositories/provider-setup';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyProvider } from '@/hooks/use-my-provider';
import { useTheme } from '@/hooks/use-theme';
import {
  bookingDetailsKey,
  groupBookings,
  loadBookingDetails,
  type BookingCatalogDetails,
} from '@/lib/booking-list';

export default function ProfileScreen() {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const { user, displayName, signOut } = useAuth();
  const { bookings, refreshBookings } = useBookings();
  const { unreadCount } = useNotifications();
  const {
    permission: reminderPermission,
    enabling: enablingReminders,
    enableReminders,
  } = useLocalAppointmentReminders();

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return;
      }

      void refreshBookings();
    }, [user, refreshBookings]),
  );
  const [detailsEpoch, setDetailsEpoch] = useState(0);
  const [detailsByKey, setDetailsByKey] = useState<Record<string, BookingCatalogDetails>>({});
  const [detailsError, setDetailsError] = useState<string | undefined>();
  const detailsByKeyRef = useRef(detailsByKey);
  detailsByKeyRef.current = detailsByKey;

  useEffect(() => {
    const missing = bookings.filter((booking) => !detailsByKeyRef.current[bookingDetailsKey(booking)]);
    if (missing.length === 0) {
      setDetailsError(undefined);
      return;
    }

    let cancelled = false;
    void loadBookingDetails(missing)
      .then((loaded) => {
        if (cancelled) {
          return;
        }

        setDetailsByKey((current) => ({ ...current, ...loaded }));
        setDetailsError(undefined);
      })
      .catch((caught: unknown) => {
        if (cancelled) {
          return;
        }

        setDetailsError(caught instanceof Error ? caught.message : 'Could not load bookings.');
      });

    return () => {
      cancelled = true;
    };
  }, [bookings, detailsEpoch]);

  const grouped = useMemo(() => groupBookings(bookings, detailsByKey), [bookings, detailsByKey]);
  const upcoming = grouped.upcoming;
  const past = grouped.past;
  const cancelled = grouped.cancelled;
  const declined = grouped.declined;
  const hasBookings =
    upcoming.length > 0 || past.length > 0 || cancelled.length > 0 || declined.length > 0;
  const waitingForDetails = bookings.length > 0 && !hasBookings && detailsError === undefined;
  const [signingOut, setSigningOut] = useState(false);
  const isSignedIn = user !== null;
  const name = displayName ?? 'Guest';
  const initial = name.charAt(0).toUpperCase();
  const {
    provider: myProvider,
    loading: providerLoading,
    error: providerError,
    reload: reloadMyProvider,
  } = useMyProvider(user?.id);

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText style={styles.title}>Profile</ThemedText>

          <View style={styles.identity}>
            <ThemedView type="backgroundElement" style={styles.avatar}>
              <ThemedText type="smallBold">{initial}</ThemedText>
            </ThemedView>
            <View style={styles.identityCopy}>
              <ThemedText style={styles.displayName}>{isSignedIn ? name : 'Guest'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {isSignedIn ? (user.email ?? '') : 'Your Mivora profile'}
              </ThemedText>
            </View>
          </View>

          {isSignedIn ? (
            <View style={styles.authActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                onPress={() => router.push('/profile/edit')}
                style={({ pressed }) => [
                  styles.authButton,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Edit profile
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                disabled={signingOut}
                onPress={() => {
                  void onSignOut();
                }}
                style={({ pressed }) => [
                  styles.authButton,
                  { backgroundColor: theme.backgroundElement },
                  signingOut && styles.disabled,
                  pressed && !signingOut && styles.pressed,
                ]}>
                <ThemedText type="smallBold">{signingOut ? 'Signing out…' : 'Sign out'}</ThemedText>
              </Pressable>
            </View>
          ) : (
            <View style={styles.authActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign in"
                onPress={() => router.push('/sign-in')}
                style={({ pressed }) => [
                  styles.authButton,
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
                onPress={() => router.push('/sign-up')}
                style={({ pressed }) => [
                  styles.authButton,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold">Create account</ThemedText>
              </Pressable>
            </View>
          )}
          
          {isSignedIn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                unreadCount > 0
                  ? `Notifications, ${unreadCount > 99 ? '99+' : unreadCount} unread`
                  : 'Notifications'
              }
              onPress={() => router.push('/notifications' as Href)}
              style={({ pressed }) => [
                styles.notificationsRow,
                { backgroundColor: theme.backgroundElement },
                cardElevationStyle(isDark),
                pressed && styles.pressed,
              ]}>
              <SymbolView
                name={{ ios: 'bell', android: 'notifications', web: 'notifications' }}
                size={22}
                tintColor={theme.text}
              />
              <View style={styles.notificationsCopy}>
                <ThemedText type="smallBold">Notifications</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Booking updates
                </ThemedText>
              </View>
              {unreadCount > 0 ? (
                <View style={[styles.unreadBadge, { backgroundColor: theme.text }]}>
                  <ThemedText
                    type="smallBold"
                    style={[styles.unreadBadgeText, { color: theme.background }]}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          {isSignedIn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={appointmentRemindersLabel(reminderPermission, enablingReminders)}
              disabled={
                enablingReminders ||
                reminderPermission === 'granted' ||
                reminderPermission === 'unsupported'
              }
              onPress={() => {
                if (reminderPermission === 'denied') {
                  void Linking.openSettings();
                  return;
                }
                void enableReminders();
              }}
              style={({ pressed }) => [
                styles.notificationsRow,
                { backgroundColor: theme.backgroundElement },
                cardElevationStyle(isDark),
                enablingReminders && styles.disabled,
                pressed && !enablingReminders && reminderPermission === 'undetermined' && styles.pressed,
              ]}>
              <SymbolView
                name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                size={22}
                tintColor={theme.text}
              />
              <View style={styles.notificationsCopy}>
                <ThemedText type="smallBold">Appointment reminders</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {appointmentRemindersCopy(reminderPermission, enablingReminders)}
                </ThemedText>
              </View>
            </Pressable>
          ) : null}

          {isSignedIn ? (
            <BusinessEntry
              provider={myProvider}
              loading={providerLoading}
              error={providerError}
              onRetry={() => {
                void reloadMyProvider();
              }}
            />
          ) : null}

          <ThemedText style={styles.sectionTitle}>My bookings</ThemedText>

          {waitingForDetails ? (
            <BookingsSkeleton />
          ) : (
            <>
              {detailsError ? (
                <View style={styles.statusBlock}>
                  <ThemedText themeColor="textSecondary">{detailsError}</ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading bookings"
                    onPress={() => setDetailsEpoch((current) => current + 1)}
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
              ) : null}
              {hasBookings ? (
                <>
                  {upcoming.length > 0 ? (
                    <View style={styles.section}>
                      <ThemedText style={styles.groupTitle}>Upcoming</ThemedText>
                      {upcoming.map((item) => (
                        <BookingCard key={item.booking.id} item={item} />
                      ))}
                    </View>
                  ) : null}
                  {declined.length > 0 ? (
                    <View style={styles.section}>
                      <ThemedText style={styles.groupTitle}>Declined</ThemedText>
                      {declined.map((item) => (
                        <BookingCard key={item.booking.id} item={item} />
                      ))}
                    </View>
                  ) : null}
                  {cancelled.length > 0 ? (
                    <View style={styles.section}>
                      <ThemedText style={styles.groupTitle}>Cancelled</ThemedText>
                      {cancelled.map((item) => (
                        <BookingCard key={item.booking.id} item={item} />
                      ))}
                    </View>
                  ) : null}
                  {past.length > 0 ? (
                    <View style={styles.section}>
                      <ThemedText style={styles.groupTitle}>Past</ThemedText>
                      {past.map((item) => (
                        <BookingCard key={item.booking.id} item={item} />
                      ))}
                    </View>
                  ) : null}
                </>
              ) : detailsError ? null : (
                <View style={styles.empty}>
                  <ThemedText type="smallBold">
                    {isSignedIn ? 'No bookings yet' : 'Your bookings, all in one place'}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary">
                    {isSignedIn
                      ? 'Your upcoming appointments will appear here.'
                      : 'Create an account to book appointments and manage them here.'}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={isSignedIn ? 'Find a specialist' : 'Create account'}
                    onPress={() => router.push(isSignedIn ? '/search' : '/sign-up')}
                    style={({ pressed }) => [
                      styles.findButton,
                      { backgroundColor: theme.backgroundSelected },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" themeColor="onPrimary">
                      {isSignedIn ? 'Find a specialist' : 'Create account'}
                    </ThemedText>
                  </Pressable>
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function appointmentRemindersCopy(
  permission: LocalNotificationPermission,
  enabling: boolean,
): string {
  if (enabling) {
    return 'Asking for permission…';
  }
  if (permission === 'granted') {
    return 'On · 24 hours and 2 hours before confirmed bookings';
  }
  if (permission === 'denied') {
    return 'Notifications are off. Enable them in Settings.';
  }
  if (permission === 'unsupported') {
    return 'Available on iOS and Android';
  }
  return '24 hours and 2 hours before confirmed bookings';
}

function appointmentRemindersLabel(
  permission: LocalNotificationPermission,
  enabling: boolean,
): string {
  if (enabling) {
    return 'Appointment reminders, asking for permission';
  }
  if (permission === 'granted') {
    return 'Appointment reminders on';
  }
  if (permission === 'denied') {
    return 'Appointment reminders off, open Settings';
  }
  if (permission === 'unsupported') {
    return 'Appointment reminders available on iOS and Android';
  }
  return 'Enable appointment reminders';
}

function BookingsSkeleton() {
  const isDark = useColorScheme() === 'dark';

  return (
    <View accessibilityLabel="Loading bookings" style={styles.section}>
      {['a', 'b'].map((key) => (
        <ThemedView
          key={key}
          type="backgroundElement"
          style={[styles.skeletonCard, cardElevationStyle(isDark)]}>
          <SkeletonBlock style={styles.skeletonName} />
          <SkeletonBlock style={styles.skeletonService} />
          <SkeletonBlock style={styles.skeletonMeta} />
        </ThemedView>
      ))}
    </View>
  );
}

function BusinessEntry({
  provider,
  loading,
  error,
  onRetry,
}: {
  provider: OwnedProviderProfile | null | undefined;
  loading: boolean;
  error: string | undefined;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';

  if (provider) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="My Business"
        onPress={() => router.push('/business')}
        style={({ pressed }) => [
          styles.entryRow,
          { backgroundColor: theme.backgroundElement },
          cardElevationStyle(isDark),
          pressed && styles.pressed,
        ]}>
        <View style={styles.entryCopy}>
          <ThemedText type="smallBold">My Business</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {provider.name}
          </ThemedText>
        </View>
      </Pressable>
    );
  }

  if (error) {
    return (
      <View style={styles.statusBlock}>
        <ThemedText type="smallBold">Business</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {error}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading business"
          onPress={onRetry}
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
    );
  }

  if (loading || provider === undefined) {
    return (
      <View style={[styles.entryRow, { backgroundColor: theme.backgroundElement }, cardElevationStyle(isDark)]}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary">
          Loading business…
        </ThemedText>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Become a provider"
      onPress={() => router.push('/provider-setup')}
      style={({ pressed }) => [
        styles.entryRow,
        { backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
      ]}>
      <View style={styles.entryCopy}>
        <ThemedText type="smallBold" themeColor="onPrimary">
          Become a Provider
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Create your specialist or salon profile
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  notificationsRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  notificationsCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: Spacing.one,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  entryRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  entryCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  displayName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  authActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  authButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.three,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  groupTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  section: {
    gap: Spacing.three,
  },
  empty: {
    gap: Spacing.two,
  },
  findButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: Spacing.two,
    borderRadius: Spacing.three,
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
  skeletonCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  skeletonName: {
    height: 16,
    width: '58%',
  },
  skeletonService: {
    height: 16,
    width: '42%',
  },
  skeletonMeta: {
    height: 12,
    width: '36%',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
