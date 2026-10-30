import { useEffect, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PULSE_MIN = 0.45;
const PULSE_MAX = 0.85;
const FADE_MS = 200;

export function SkeletonBlock({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const opacity = useSharedValue(PULSE_MIN);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(PULSE_MAX, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(opacity);
    };
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      accessible={false}
      style={[
        styles.block,
        { backgroundColor: theme.backgroundSelected },
        animatedStyle,
        style,
      ]}
    />
  );
}

export function ContentFadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View entering={FadeIn.duration(FADE_MS).easing(Easing.out(Easing.quad))} style={style}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: {
    height: 12,
    borderRadius: Spacing.two,
  },
});
