import { NativeTabs } from 'expo-router/native-tabs';
import { DynamicColorIOS, Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function nativeTabColors(theme: ReturnType<typeof useTheme>) {
  if (Platform.OS === 'ios') {
    return {
      default: DynamicColorIOS({
        light: Colors.light.textSecondary,
        dark: Colors.dark.textSecondary,
      }),
      selected: DynamicColorIOS({
        light: Colors.light.text,
        dark: Colors.dark.text,
      }),
    };
  }

  return {
    default: theme.textSecondary,
    selected: theme.onPrimary,
  };
}

export default function AppTabs() {
  const colors = useTheme();
  const { default: defaultTabColor, selected: selectedTabColor } = nativeTabColors(colors);

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.accent}
      tintColor={selectedTabColor}
      iconColor={{ default: defaultTabColor, selected: selectedTabColor }}
      labelStyle={{
        color: defaultTabColor,
        selected: { color: selectedTabColor },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'house', selected: 'house.fill' }}
          md={{ default: 'home', selected: 'home_filled' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'magnifyingglass', selected: 'magnifyingglass' }}
          md={{ default: 'search', selected: 'search' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="favorites">
        <NativeTabs.Trigger.Label>Favorites</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'heart', selected: 'heart.fill' }}
          md={{ default: 'favorite', selected: 'favorite' }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person', selected: 'person.fill' }}
          md={{ default: 'person', selected: 'person' }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
