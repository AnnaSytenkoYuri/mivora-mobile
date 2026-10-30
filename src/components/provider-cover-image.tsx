import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type ProviderCoverImageProps = {
  imageUrl: string | undefined;
  style: StyleProp<ViewStyle>;
};

export function ProviderCoverImage({ imageUrl, style }: ProviderCoverImageProps) {
  const uri = imageUrl?.trim() ?? '';

  if (!uri) {
    return (
      <ThemedView type="backgroundElement" style={[style, styles.placeholder]}>
        <ThemedText type="small" themeColor="textSecondary">
          No cover photo
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <View style={style}>
      <Image source={{ uri }} style={styles.image} contentFit="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
