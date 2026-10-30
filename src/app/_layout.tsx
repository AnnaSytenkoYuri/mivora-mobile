import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider } from '@/context/auth-context';
import { BookingsProvider } from '@/context/bookings-context';
import { FavoritesProvider } from '@/context/favorites-context';
import { LocalReminderNotificationObserver } from '@/components/local-reminder-notification-observer';
import { LocalAppointmentRemindersProvider } from '@/context/local-appointment-reminders-context';
import { NotificationsProvider } from '@/context/notifications-context';
import { PushTokenProvider } from '@/context/push-token-context';
import { SelectedCityProvider } from '@/context/selected-city-context';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const colors = useTheme();
  const isDark = colorScheme === 'dark';
  const navigationTheme = useMemo(
    () => ({
      ...(isDark ? DarkTheme : DefaultTheme),
      colors: {
        ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.primary,
      },
    }),
    [colors, isDark],
  );

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthProvider>
        <SelectedCityProvider>
          <FavoritesProvider>
            <BookingsProvider>
              <NotificationsProvider>
                <LocalAppointmentRemindersProvider>
                  <PushTokenProvider>
                    <LocalReminderNotificationObserver />
                    <AnimatedSplashOverlay />
                    <Stack
                      screenOptions={{
                        headerShown: false,
                        // SDK 58 / iOS 26 Liquid Glass headers default to transparent when no
                        // background is set, so content draws underneath. Keep an opaque themed
                        // header so native stack inset stays below the bar (Expo Go compatible).
                        headerTransparent: false,
                        headerStyle: { backgroundColor: colors.surface },
                        headerTintColor: colors.text,
                        headerTitleStyle: { color: colors.text },
                        contentStyle: { backgroundColor: colors.background },
                      }}
                    />
                  </PushTokenProvider>
                </LocalAppointmentRemindersProvider>
              </NotificationsProvider>
            </BookingsProvider>
          </FavoritesProvider>
        </SelectedCityProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
