import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  bangkokTodayIso,
  calendarDateFromIso,
  formatBangkokDate,
  isoFromCalendarDate,
} from '@/lib/bangkok-date';

type BangkokDatePickerProps = {
  value: string;
  onChange: (isoDate: string) => void;
  disabled?: boolean;
};

export function BangkokDatePicker({ value, onChange, disabled = false }: BangkokDatePickerProps) {
  const scheme = useColorScheme();
  const [open, setOpen] = useState(false);
  const selected = calendarDateFromIso(value);
  const minimumDate = calendarDateFromIso(bangkokTodayIso());

  function handleValueChange(_event: DateTimePickerChangeEvent, date: Date) {
    if (Platform.OS === 'android') {
      setOpen(false);
    }

    onChange(isoFromCalendarDate(date));
  }

  function handleDismiss() {
    setOpen(false);
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
        <ThemedView type="background" style={styles.button}>
          <ThemedText type="smallBold">{formatBangkokDate(value)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Bangkok calendar date
          </ThemedText>
        </ThemedView>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={selected}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={minimumDate}
          onValueChange={handleValueChange}
          onDismiss={handleDismiss}
          themeVariant={scheme === 'dark' ? 'dark' : 'light'}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.two,
  },
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
