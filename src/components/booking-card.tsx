import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { cardElevationStyle, Spacing } from '@/constants/theme';
import type { BookingStatus } from '@/data/types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import type { BookingWithDetails } from '@/lib/booking-list';
import { formatBookingDate, formatBookingStatus, formatDuration, formatThb } from '@/lib/format';

type BookingCardProps = {
  item: BookingWithDetails;
};

export function BookingStatusChip({
  status,
  surface = 'page',
}: {
  status: BookingStatus;
  surface?: 'card' | 'page';
}) {
  const theme = useTheme();
  const emphasized = status === 'pending' || status === 'confirmed';
  const backgroundColor = emphasized
    ? theme.backgroundSelected
    : surface === 'card'
      ? theme.background
      : theme.backgroundElement;

  return (
    <View style={[styles.chip, { backgroundColor }]}>
      <ThemedText type="small" themeColor={emphasized ? 'onPrimary' : undefined}>
        {formatBookingStatus(status)}
      </ThemedText>
    </View>
  );
}

export function BookingCard({ item }: BookingCardProps) {
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const { booking, provider, service } = item;
  const statusLabel = formatBookingStatus(booking.status);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${provider.name}, ${service.name}, ${formatBookingDate(booking.date)} ${booking.time}, ${statusLabel}`}
      onPress={() =>
        router.push({
          pathname: '/bookings/[id]',
          params: { id: booking.id },
        })
      }
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement },
        cardElevationStyle(isDark),
        pressed && styles.pressed,
      ]}>
      <View style={styles.header}>
        <ThemedText style={styles.providerName}>{provider.name}</ThemedText>
        <BookingStatusChip status={booking.status} surface="card" />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {service.name}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatThb(service.priceThb)}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatBookingDate(booking.date)} · {booking.time}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {formatDuration(service.durationMinutes)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  providerName: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 600,
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
