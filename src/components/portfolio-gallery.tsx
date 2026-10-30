import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { PortfolioItem } from '@/data/types';

type PortfolioGalleryProps = {
  items: PortfolioItem[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
};

export function PortfolioGallery({ items, initialIndex, visible, onClose }: PortfolioGalleryProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const startIndex = Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0));

  useEffect(() => {
    if (visible) {
      setIndex(startIndex);
    }
  }, [visible, startIndex]);

  if (items.length === 0) {
    return null;
  }

  function onScrollEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next >= 0 && next < items.length) {
      setIndex(next);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}>
      <View style={styles.root}>
        <FlatList
          key={`${visible ? 'open' : 'closed'}-${startIndex}-${width}`}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={startIndex}
          getItemLayout={(_, itemIndex) => ({
            length: width,
            offset: width * itemIndex,
            index: itemIndex,
          })}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          renderItem={({ item, index: itemIndex }) => (
            <View style={{ width, height }}>
              <Image
                source={{ uri: item.imageUrl }}
                style={styles.image}
                contentFit="contain"
                recyclingKey={item.id}
                transition={200}
                accessibilityLabel={`Portfolio photo ${itemIndex + 1} of ${items.length}`}
              />
            </View>
          )}
        />
        <View
          pointerEvents="box-none"
          style={[
            styles.chrome,
            {
              paddingTop: insets.top + Spacing.two,
              paddingBottom: insets.bottom + Spacing.two,
              paddingLeft: Math.max(insets.left, Spacing.three),
              paddingRight: Math.max(insets.right, Spacing.three),
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <ThemedText type="smallBold" style={styles.chromeText}>
              Close
            </ThemedText>
          </Pressable>
          <ThemedText type="smallBold" style={styles.chromeText}>
            {index + 1} / {items.length}
          </ThemedText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  chrome: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  chromeText: {
    color: '#ffffff',
  },
  pressed: {
    opacity: 0.7,
  },
});
