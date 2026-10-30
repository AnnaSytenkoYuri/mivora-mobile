import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { CityId } from '@/constants/cities';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { Provider } from '@/data/types';
import type { GeoPoint } from '@/lib/distance';

type SearchResultsMapProps = {
  providers: Provider[];
  cityId: CityId;
  cityLabel: string;
  origin?: GeoPoint;
};

export function SearchResultsMap({ cityLabel }: SearchResultsMapProps) {
  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold">Map view is available on iOS and Android</ThemedText>
      <ThemedText themeColor="textSecondary">
        Open Search in Expo Go to see published {cityLabel} salons and specialists on the map. Use
        List on web.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
