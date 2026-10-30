import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CITY_LIST, type CityId } from '@/constants/cities';
import { Spacing } from '@/constants/theme';

export function CitySelector({
  value,
  onChange,
  disabled = false,
}: {
  value: CityId | undefined;
  onChange: (cityId: CityId) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      {CITY_LIST.map((city) => {
        const selected = value === city.id;
        return (
          <Pressable
            key={city.id}
            accessibilityRole="button"
            accessibilityLabel={city.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(city.id)}
            style={({ pressed }) => [
              styles.chipWrap,
              disabled && styles.disabled,
              pressed && !disabled && styles.pressed,
            ]}>
            <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
              <ThemedText type="small" themeColor={selected ? 'onPrimary' : undefined}>
                {city.label}
              </ThemedText>
            </ThemedView>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chipWrap: {
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
