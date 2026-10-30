import { Redirect, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BangkokDatePicker } from '@/components/bangkok-date-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import {
  createEmptyExceptionDraft,
  deleteMyScheduleException,
  draftFromException,
  fetchMyUpcomingScheduleExceptions,
  saveMyScheduleException,
  validateExceptionDraft,
  type ScheduleException,
  type ScheduleExceptionDraft,
} from '@/data/repositories/provider-schedule-exceptions';
import { useTheme } from '@/hooks/use-theme';
import { formatBangkokDate } from '@/lib/bangkok-date';

export default function ScheduleExceptionsScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [exceptions, setExceptions] = useState<ScheduleException[] | undefined>();
  const [draft, setDraft] = useState<ScheduleExceptionDraft>(createEmptyExceptionDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [reloadKey, setReloadKey] = useState(0);
  const dirtyRef = useRef(false);
  const exceptionsRef = useRef(exceptions);
  exceptionsRef.current = exceptions;

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
      const isInitialLoad = exceptionsRef.current === undefined;
      if (isInitialLoad) {
        setLoading(true);
        setLoadError(undefined);
      }

      void fetchMyUpcomingScheduleExceptions()
        .then((next) => {
          if (cancelled || dirtyRef.current) {
            return;
          }

          setExceptions(next);
          setLoadError(undefined);
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (cancelled) {
            return;
          }

          setLoading(false);
          if (exceptionsRef.current === undefined) {
            setLoadError(caught instanceof Error ? caught.message : 'Could not load days off.');
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

  const mutating = saving || deletingId !== null;
  const showInitialLoading = loading && exceptions === undefined;
  const showLoadError = loadError !== undefined && exceptions === undefined;

  function markDirty(next: ScheduleExceptionDraft) {
    dirtyRef.current = true;
    setSuccess(undefined);
    setDraft(next);
  }

  function resetForm() {
    dirtyRef.current = false;
    setDraft(createEmptyExceptionDraft());
    setError(undefined);
  }

  async function onSave() {
    if (mutating || exceptions === undefined) {
      return;
    }

    const validationError = validateExceptionDraft(draft, exceptions);
    if (validationError) {
      setError(validationError);
      setSuccess(undefined);
      return;
    }

    setSaving(true);
    setError(undefined);
    setSuccess(undefined);
    const result = await saveMyScheduleException(draft, exceptions);
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    dirtyRef.current = false;
    setExceptions(result.exceptions);
    setDraft(createEmptyExceptionDraft());
    setSuccess(draft.id ? 'Exception updated.' : 'Exception saved.');
  }

  function onEdit(exception: ScheduleException) {
    dirtyRef.current = true;
    setError(undefined);
    setSuccess(undefined);
    setDraft(draftFromException(exception));
  }

  function confirmDelete(exception: ScheduleException) {
    if (mutating) {
      return;
    }

    Alert.alert(
      'Delete this exception?',
      `${formatBangkokDate(exception.date)} will follow your weekly hours again.`,
      [
        { text: 'Keep exception', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void onDelete(exception.id);
          },
        },
      ],
    );
  }

  async function onDelete(exceptionId: string) {
    if (mutating) {
      return;
    }

    setDeletingId(exceptionId);
    setError(undefined);
    setSuccess(undefined);
    const result = await deleteMyScheduleException(exceptionId);
    setDeletingId(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setExceptions(result.exceptions);
    if (draft.id === exceptionId) {
      resetForm();
    }
    setSuccess('Exception deleted.');
  }

  function onRetry() {
    dirtyRef.current = false;
    setExceptions(undefined);
    setError(undefined);
    setSuccess(undefined);
    setReloadKey((current) => current + 1);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Days off',
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
              Loading days off...
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
        ) : exceptions ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Override a specific Bangkok calendar date. Closed all day or custom hours replace that
              day’s weekly schedule. Times are Asia/Bangkok (ICT).
            </ThemedText>

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">{draft.id ? 'Edit exception' : 'Add exception'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Date
              </ThemedText>
              <BangkokDatePicker
                value={draft.date}
                disabled={mutating}
                onChange={(date) => markDirty({ ...draft, date })}
              />
              <View style={styles.toggleRow}>
                <Pressable
                  accessibilityRole="button"
                  disabled={mutating}
                  onPress={() => markDirty({ ...draft, isClosed: true })}
                  style={({ pressed }) => [styles.toggleWrap, pressed && !mutating && styles.pressed]}>
                  <ThemedView type={draft.isClosed ? 'backgroundSelected' : 'background'} style={styles.toggle}>
                    <ThemedText type="smallBold" themeColor={draft.isClosed ? 'onPrimary' : undefined}>
                      Closed all day
                    </ThemedText>
                  </ThemedView>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={mutating}
                  onPress={() => markDirty({ ...draft, isClosed: false })}
                  style={({ pressed }) => [styles.toggleWrap, pressed && !mutating && styles.pressed]}>
                  <ThemedView type={!draft.isClosed ? 'backgroundSelected' : 'background'} style={styles.toggle}>
                    <ThemedText type="smallBold" themeColor={!draft.isClosed ? 'onPrimary' : undefined}>
                      Custom hours
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </View>
              {!draft.isClosed ? (
                <View style={styles.timeRow}>
                  <View style={styles.timeField}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Opens
                    </ThemedText>
                    <TextInput
                      value={draft.opensAt}
                      onChangeText={(opensAt) => markDirty({ ...draft, opensAt })}
                      placeholder="09:00"
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="numbers-and-punctuation"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!mutating}
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
                      value={draft.closesAt}
                      onChangeText={(closesAt) => markDirty({ ...draft, closesAt })}
                      placeholder="18:00"
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="numbers-and-punctuation"
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!mutating}
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
              ) : null}

              {error ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {error}
                </ThemedText>
              ) : null}
              {success ? <ThemedText type="small">{success}</ThemedText> : null}

              <Pressable
                accessibilityRole="button"
                disabled={mutating}
                onPress={() => {
                  void onSave();
                }}
                style={({ pressed }) => [mutating && styles.disabled, pressed && !mutating && styles.pressed]}>
                <ThemedView type="backgroundSelected" style={styles.action}>
                  <ThemedText type="smallBold" themeColor="onPrimary">
                    {saving ? 'Saving…' : draft.id ? 'Save exception' : 'Add exception'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {draft.id ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={mutating}
                  onPress={resetForm}
                  style={({ pressed }) => [mutating && styles.disabled, pressed && !mutating && styles.pressed]}>
                  <ThemedView type="background" style={styles.action}>
                    <ThemedText type="smallBold">Cancel edit</ThemedText>
                  </ThemedView>
                </Pressable>
              ) : null}
            </ThemedView>

            <ThemedText type="smallBold">Upcoming</ThemedText>
            {exceptions.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No upcoming days off or special hours.
              </ThemedText>
            ) : (
              exceptions.map((exception) => (
                <ThemedView key={exception.id} type="backgroundElement" style={styles.card}>
                  <ThemedText type="smallBold">{formatBangkokDate(exception.date)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {exception.isClosed
                      ? 'Closed all day'
                      : `${exception.opensAt}–${exception.closesAt}`}
                  </ThemedText>
                  <View style={styles.toggleRow}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={mutating}
                      onPress={() => onEdit(exception)}
                      style={({ pressed }) => [styles.toggleWrap, pressed && !mutating && styles.pressed]}>
                      <ThemedView type="background" style={styles.toggle}>
                        <ThemedText type="smallBold">Edit</ThemedText>
                      </ThemedView>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={mutating}
                      onPress={() => confirmDelete(exception)}
                      style={({ pressed }) => [styles.toggleWrap, pressed && !mutating && styles.pressed]}>
                      <ThemedView type="background" style={styles.toggle}>
                        <ThemedText type="smallBold">
                          {deletingId === exception.id ? 'Deleting…' : 'Delete'}
                        </ThemedText>
                      </ThemedView>
                    </Pressable>
                  </View>
                </ThemedView>
              ))
            )}
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
  action: {
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
