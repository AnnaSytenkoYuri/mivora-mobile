/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform, StyleSheet, type ViewStyle } from 'react-native';

export const Brand = {
  ivory: '#FAF6F3',
  blush: '#E7C8C2',
  dustyRose: '#B97975',
  espresso: '#463A3A',
  white: '#FFFFFF',
} as const;

export const Colors = {
  light: {
    text: Brand.espresso,
    background: Brand.ivory,
    backgroundElement: Brand.white,
    backgroundSelected: Brand.blush,
    textSecondary: '#6B5F5F',
    primary: Brand.dustyRose,
    onPrimary: Brand.espresso,
    accent: Brand.blush,
    surface: Brand.white,
    border: '#E5D6D2',
    danger: '#8C4F4C',
  },
  dark: {
    text: '#F5F0ED',
    background: '#1C1B1D',
    backgroundElement: '#29272A',
    backgroundSelected: '#E7C8C2',
    textSecondary: '#B9AFAD',
    primary: '#E7C8C2',
    onPrimary: '#1C1B1D',
    accent: '#E7C8C2',
    surface: '#29272A',
    border: '#403B3E',
    danger: '#D4A09C',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

export function cardElevationStyle(isDark: boolean): ViewStyle {
  if (isDark) {
    return {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: Colors.dark.border,
      ...Platform.select({
        android: { elevation: 0 },
        default: {
          shadowColor: 'transparent',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0,
          shadowRadius: 0,
        },
      }),
    };
  }

  return (
    Platform.select<ViewStyle>({
      ios: {
        shadowColor: Brand.espresso,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
      },
      android: {
        elevation: 2,
        shadowColor: Brand.espresso,
      },
      default: {
        shadowColor: Brand.espresso,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.07,
        shadowRadius: 14,
      },
    }) ?? {}
  );
}
