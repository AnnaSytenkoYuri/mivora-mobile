import { Redirect, router, Stack, useFocusEffect, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContentFadeIn, SkeletonBlock } from '@/components/skeleton-block';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import { useNotifications } from '@/context/notifications-context';
import { fetchMyBookings } from '@/data/repositories/bookings';
import type { AppNotification } from '@/data/repositories/notifications';
import { useTheme } from '@/hooks/use-theme';
import { formatNotificationCreatedAt } from '@/lib/format';
import {
  isProviderInboxNotification,
  type AppNotificationType,
} from '@/lib/notification-types';

type NotificationFilter = 'all' | 'unread';

export default function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { refreshBookings } = useBookings();
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    refreshNotifications,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
  } = useNotifications();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return;
      }

      void refreshNotifications();
    }, [user, refreshNotifications]),
  );

  const visibleNotifications = useMemo(
    () =>
      filter === 'unread' ? notifications.filter((item) => item.readAt === null) : notifications,
    [filter, notifications],
  );

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  async function onOpenNotification(notification: AppNotification) {
    if (openingId || markingAll) {
      return;
    }

    setOpeningId(notification.id);
    setActionError(undefined);
    const markResult = await markNotificationRead(notification.id);
    if (!markResult.ok) {
      setActionError(markResult.message);
    }

    try {
      if (isProviderInboxNotification(notification.type)) {
        router.push('/business/bookings' as Href);
        return;
      }

      await refreshBookings();
      let exists = false;
      try {
        const mine = await fetchMyBookings();
        exists = mine.some((booking) => booking.id === notification.bookingId);
      } catch {
        exists = false;
      }

      if (!exists) {
        Alert.alert('Booking unavailable', 'This booking is no longer available.');
        return;
      }

      router.push({
        pathname: '/bookings/[id]',
        params: { id: notification.bookingId },
      });
    } finally {
      setOpeningId(null);
    }
  }

  async function onMarkUnread(notification: AppNotification) {
    if (mutatingId || markingAll) {
      return;
    }

    setMutatingId(notification.id);
    setActionError(undefined);
    const result = await markNotificationUnread(notification.id);
    setMutatingId(null);
    if (!result.ok) {
      setActionError(result.message);
    }
  }

  async function onMarkRead(notification: AppNotification) {
    if (mutatingId || markingAll) {
      return;
    }

    setMutatingId(notification.id);
    setActionError(undefined);
    const result = await markNotificationRead(notification.id);
    setMutatingId(null);
    if (!result.ok) {
      setActionError(result.message);
    }
  }

  async function onMarkAllRead() {
    if (markingAll || unreadCount === 0) {
      return;
    }

    setMarkingAll(true);
    setActionError(undefined);
    const result = await markAllNotificationsRead();
    setMarkingAll(false);
    if (!result.ok) {
      setActionError(result.message);
    }
  }

  function showNotificationActions(notification: AppNotification) {
    const unread = notification.readAt === null;
    Alert.alert(notification.title, notification.body, [
      {
        text: 'Open',
        onPress: () => {
          void onOpenNotification(notification);
        },
      },
      unread
        ? {
            text: 'Mark as read',
            onPress: () => {
              void onMarkRead(notification);
            },
          }
        : {
            text: 'Mark as unread',
            onPress: () => {
              void onMarkUnread(notification);
            },
          },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const loadError = error;
  const visibleError = loadError ?? actionError;

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Notifications',
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        {isLoading && notifications.length === 0 && !error ? (
          <NotificationsSkeleton />
        ) : (
          <ContentFadeIn>
            {error && notifications.length === 0 ? (
              <View style={styles.statusBlock}>
                <ThemedText type="smallBold">Could not load notifications</ThemedText>
                <ThemedText themeColor="textSecondary">{error}</ThemedText>
                <RetryButton onPress={() => void refreshNotifications()} theme={theme} />
              </View>
            ) : notifications.length === 0 ? (
              <View style={styles.statusBlock}>
                <ThemedText type="smallBold">No notifications yet</ThemedText>
                <ThemedText themeColor="textSecondary">
                  Booking updates will appear here.
                </ThemedText>
              </View>
            ) : (
              <View style={styles.list}>
                <View style={styles.filterRow}>
                  <FilterChip
                    label="All"
                    selected={filter === 'all'}
                    onPress={() => setFilter('all')}
                  />
                  <FilterChip
                    label={unreadCount === 0 ? 'Unread' : `Unread ${unreadCount}`}
                    selected={filter === 'unread'}
                    onPress={() => setFilter('unread')}
                  />
                </View>
                {unreadCount > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Mark all as read"
                    accessibilityState={{ busy: markingAll, disabled: markingAll }}
                    disabled={markingAll}
                    onPress={() => {
                      void onMarkAllRead();
                    }}
                    style={({ pressed }) => [
                      styles.markAll,
                      { backgroundColor: theme.backgroundElement },
                      markingAll && styles.disabled,
                      pressed && !markingAll && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold">
                      {markingAll ? 'Marking as read…' : 'Mark all as read'}
                    </ThemedText>
                  </Pressable>
                ) : null}
                {visibleError ? (
                  <View style={styles.statusBlock}>
                    <ThemedText themeColor="textSecondary">{visibleError}</ThemedText>
                    {loadError ? (
                      <RetryButton onPress={() => void refreshNotifications()} theme={theme} />
                    ) : null}
                  </View>
                ) : null}
                {visibleNotifications.length === 0 ? (
                  <View style={styles.statusBlock}>
                    <ThemedText type="smallBold">No unread notifications</ThemedText>
                    <ThemedText themeColor="textSecondary">
                      You are up to date. Switch to All to see earlier updates.
                    </ThemedText>
                  </View>
                ) : (
                  visibleNotifications.map((notification) => {
                    const unread = notification.readAt === null;
                    const opening = openingId === notification.id;
                    const mutating = mutatingId === notification.id;
                    const timestamp = formatNotificationCreatedAt(notification.createdAt);
                    return (
                      <Pressable
                        key={notification.id}
                        accessibilityRole="button"
                        accessibilityLabel={`${notification.title}, ${notification.body}, ${timestamp}, ${unread ? 'Unread' : 'Read'}`}
                        accessibilityHint="Opens the related booking. Use the more button for read actions."
                        accessibilityState={{ selected: unread, busy: opening || mutating }}
                        onPress={() => {
                          void onOpenNotification(notification);
                        }}
                        onLongPress={() => showNotificationActions(notification)}
                        delayLongPress={350}
                        style={({ pressed }) => [
                          styles.row,
                          { backgroundColor: theme.backgroundElement },
                          pressed && styles.pressed,
                        ]}>
                        <SymbolView
                          name={notificationIcon(notification.type)}
                          size={20}
                          weight="regular"
                          tintColor={unread ? Brand.dustyRose : theme.textSecondary}
                        />
                        <View style={styles.rowCopy}>
                          <ThemedText
                            style={[styles.title, unread ? styles.titleUnread : styles.titleRead]}>
                            {notification.title}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {notification.body}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {timestamp}
                          </ThemedText>
                          {opening || mutating ? (
                            <ThemedText type="small" themeColor="textSecondary">
                              {opening ? 'Opening...' : 'Updating...'}
                            </ThemedText>
                          ) : null}
                        </View>
                        {unread ? (
                          <View
                            accessibilityLabel="Unread"
                            style={[styles.unreadDot, { backgroundColor: Brand.dustyRose }]}
                          />
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Notification actions"
                          hitSlop={8}
                          onPress={() => showNotificationActions(notification)}
                          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
                          <SymbolView
                            name={{ ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' }}
                            size={22}
                            tintColor={theme.textSecondary}
                          />
                        </Pressable>
                      </Pressable>
                    );
                  })
                )}
              </View>
            )}
          </ContentFadeIn>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small" themeColor={selected ? 'onPrimary' : undefined}>
        {label}
      </ThemedText>
    </Pressable>
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
      accessibilityLabel="Retry loading notifications"
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

function NotificationsSkeleton() {
  return (
    <View accessibilityLabel="Loading notifications" style={styles.list}>
      {['a', 'b', 'c', 'd'].map((key) => (
        <ThemedView key={key} type="backgroundElement" style={styles.row}>
          <View style={styles.rowCopy}>
            <SkeletonBlock style={styles.skeletonTitle} />
            <SkeletonBlock style={styles.skeletonBody} />
            <SkeletonBlock style={styles.skeletonMeta} />
          </View>
        </ThemedView>
      ))}
    </View>
  );
}

function notificationIcon(type: AppNotificationType) {
  switch (type) {
    case 'booking_confirmed':
      return { ios: 'checkmark.circle' as const, android: 'check_circle' as const, web: 'check_circle' as const };
    case 'booking_cancelled':
      return { ios: 'xmark.circle' as const, android: 'cancel' as const, web: 'cancel' as const };
    case 'booking_rescheduled':
      return { ios: 'calendar.badge.clock' as const, android: 'event_repeat' as const, web: 'event_repeat' as const };
    case 'booking_created':
      return { ios: 'calendar.badge.plus' as const, android: 'event_available' as const, web: 'event_available' as const };
    case 'booking_declined':
      return { ios: 'minus.circle' as const, android: 'block' as const, web: 'block' as const };
    case 'booking_reminder_24h':
    case 'booking_reminder_2h':
      return { ios: 'alarm' as const, android: 'alarm' as const, web: 'alarm' as const };
  }
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
  statusBlock: {
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.three,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  filterChip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markAll: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    minHeight: 44,
  },
  rowCopy: {
    flex: 1,
    gap: Spacing.half,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
  },
  titleUnread: {
    fontWeight: 700,
  },
  titleRead: {
    fontWeight: 500,
  },
  moreButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  skeletonTitle: {
    height: 16,
    width: '52%',
  },
  skeletonBody: {
    height: 14,
    width: '88%',
  },
  skeletonMeta: {
    height: 14,
    width: '38%',
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
});
