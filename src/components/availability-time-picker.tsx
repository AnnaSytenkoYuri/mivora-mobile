import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AvailabilityDay } from '@/lib/availability';

export function AvailabilityTimePicker({
  date,
  availability,
  loading,
  error,
  selectedTime,
  onSelectTime,
  onRetry,
}: {
  date: string | null;
  availability: AvailabilityDay | undefined;
  loading: boolean;
  error: string | undefined;
  selectedTime: string | null;
  onSelectTime: (time: string) => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const availableTimes = availability?.kind === 'open' ? availability.startTimes : [];

  return (
    <View style={styles.block}>
      <ThemedText style={styles.sectionTitle}>Time</ThemedText>
      {date == null ? (
        <ThemedText type="small" themeColor="textSecondary">
          Select a date to see available times.
        </ThemedText>
      ) : loading || (availability === undefined && !error) ? (
        <View style={styles.statusRow}>
          <ActivityIndicator />
          <ThemedText type="small" themeColor="textSecondary">
            Loading available times…
          </ThemedText>
        </View>
      ) : error ? (
        <View style={styles.statusBlock}>
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading times"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retry,
              { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" themeColor="onPrimary">
              Retry
            </ThemedText>
          </Pressable>
        </View>
      ) : availability?.kind === 'unconfigured' ? (
        <ThemedText type="small" themeColor="textSecondary">
          This business has not set working hours yet.
        </ThemedText>
      ) : availability?.kind === 'closed' ? (
        <ThemedText type="small" themeColor="textSecondary">
          This business is closed on this date.
        </ThemedText>
      ) : availableTimes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No available times for this date.
        </ThemedText>
      ) : (
        <View style={styles.chipRow}>
          {availableTimes.map((slot) => {
            const selected = selectedTime === slot;
            return (
              <Pressable
                key={slot}
                accessibilityRole="button"
                accessibilityLabel={slot}
                accessibilityState={{ selected }}
                onPress={() => onSelectTime(slot)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                  },
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="small" themeColor={selected ? 'onPrimary' : undefined}>
                  {slot}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 600,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  statusBlock: {
    gap: Spacing.two,
  },
  retry: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
});
