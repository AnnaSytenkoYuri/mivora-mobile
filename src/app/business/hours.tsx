import { Redirect, router, Stack, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import {
  fetchMyWorkingHours,
  saveMyWorkingHours,
  validateWorkingHoursDraft,
  type WeekdayHoursDraft,
} from '@/data/repositories/provider-working-hours';
import { useTheme } from '@/hooks/use-theme';

export default function WorkingHoursScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [days, setDays] = useState<WeekdayHoursDraft[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [reloadKey, setReloadKey] = useState(0);
  const dirtyRef = useRef(false);
  const daysRef = useRef(days);
  daysRef.current = days;

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setLoading(false);
        return;
      }

      if (dirtyRef.current) {
        return;
      }

      let cancelled = false;
      const isInitialLoad = daysRef.current === undefined;
      if (isInitialLoad) {
        setLoading(true);
        setLoadError(undefined);
      }

      void fetchMyWorkingHours()
        .then((next) => {
          if (cancelled || dirtyRef.current) {
            return;
          }

          setDays(next);
          setLoadError(undefined);
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (cancelled) {
            return;
          }

          setLoading(false);
          if (daysRef.current === undefined) {
            setLoadError(caught instanceof Error ? caught.message : 'Could not load working hours.');
          }
        });

      return () => {
        cancelled = true;
      };
    }, [reloadKey, user]),
  );

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  function updateDay(weekday: WeekdayHoursDraft['weekday'], patch: Partial<WeekdayHoursDraft>) {
    dirtyRef.current = true;
    setSuccess(undefined);
    setDays((current) =>
      current?.map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)),
    );
  }

  async function onSave() {
    if (saving || days === undefined) {
      return;
    }

    const validationError = validateWorkingHoursDraft(days);
    if (validationError) {
      setError(validationError);
      setSuccess(undefined);
      return;
    }

    setSaving(true);
    setError(undefined);
    setSuccess(undefined);
    const result = await saveMyWorkingHours(days);
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    dirtyRef.current = false;
    setSuccess('Working hours saved. Times are in Bangkok (ICT).');
  }

  function onRetry() {
    dirtyRef.current = false;
    setDays(undefined);
    setError(undefined);
    setSuccess(undefined);
    setReloadKey((current) => current + 1);
  }

  const showInitialLoading = loading && days === undefined;
  const showLoadError = loadError !== undefined && days === undefined;

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Working hours',
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, (showInitialLoading || showLoadError) && styles.centered]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {showInitialLoading ? (
          <View style={styles.status}>
            <ActivityIndicator />
            <ThemedText type="small" themeColor="textSecondary">
              Loading working hours...
            </ThemedText>
          </View>
        ) : showLoadError ? (
          <View style={styles.status}>
            <ThemedText themeColor="textSecondary">{loadError}</ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundSelected" style={styles.retry}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  Retry
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        ) : days ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Set the days and hours customers can request bookings. Times are Asia/Bangkok (ICT), not
              your phone’s time zone. Closed days have no hours saved.
            </ThemedText>

            {error ? (
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            ) : null}

            {success ? <ThemedText type="small">{success}</ThemedText> : null}

            {days.map((day) => (
              <ThemedView key={day.weekday} type="backgroundElement" style={styles.card}>
                <ThemedText type="smallBold">{day.label}</ThemedText>
                <View style={styles.toggleRow}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => updateDay(day.weekday, { isOpen: true })}
                    style={({ pressed }) => [styles.toggleWrap, pressed && styles.pressed]}>
                    <ThemedView type={day.isOpen ? 'backgroundSelected' : 'background'} style={styles.toggle}>
                      <ThemedText type="smallBold" themeColor={day.isOpen ? 'onPrimary' : undefined}>
                        Open
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => updateDay(day.weekday, { isOpen: false })}
                    style={({ pressed }) => [styles.toggleWrap, pressed && styles.pressed]}>
                    <ThemedView type={!day.isOpen ? 'backgroundSelected' : 'background'} style={styles.toggle}>
                      <ThemedText type="smallBold" themeColor={!day.isOpen ? 'onPrimary' : undefined}>
                        Closed
                      </ThemedText>
                    </ThemedView>
                  </Pressable>
                </View>
                {day.isOpen ? (
                  <View style={styles.timeRow}>
                    <View style={styles.timeField}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Opens
                      </ThemedText>
                      <TextInput
                        value={day.opensAt}
                        onChangeText={(opensAt) => updateDay(day.weekday, { opensAt })}
                        placeholder="09:00"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="numbers-and-punctuation"
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={5}
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.backgroundElement,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.timeField}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Closes
                      </ThemedText>
                      <TextInput
                        value={day.closesAt}
                        onChangeText={(closesAt) => updateDay(day.weekday, { closesAt })}
                        placeholder="18:00"
                        placeholderTextColor={theme.textSecondary}
                        keyboardType="numbers-and-punctuation"
                        autoCapitalize="none"
                        autoCorrect={false}
                        maxLength={5}
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.backgroundElement,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                      />
                    </View>
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    Closed
                  </ThemedText>
                )}
              </ThemedView>
            ))}

            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => {
                void onSave();
              }}
              style={({ pressed }) => [saving && styles.disabled, pressed && !saving && styles.pressed]}>
              <ThemedView type="backgroundSelected" style={styles.save}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  {saving ? 'Saving…' : 'Save hours'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Days Off & Special Hours</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Close a specific date or set custom hours. These override your weekly schedule for
                that Bangkok calendar date.
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/business/exceptions' as Href)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundSelected" style={styles.save}>
                  <ThemedText type="smallBold" themeColor="onPrimary">
                    Manage days off
                  </ThemedText>
                </ThemedView>
              </Pressable>
            </ThemedView>
          </>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  centered: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  status: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  toggleWrap: {
    flex: 1,
  },
  toggle: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  timeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  timeField: {
    flex: 1,
    gap: Spacing.one,
  },
  input: {
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  save: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  retry: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
