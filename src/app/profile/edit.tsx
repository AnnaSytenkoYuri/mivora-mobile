import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTheme } from '@/hooks/use-theme';

export default function EditProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, displayName, updateFullName } = useAuth();
  const [fullName, setFullName] = useState(displayName ?? '');
  const [hasEditedName, setHasEditedName] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (hasEditedName) {
      return;
    }

    setFullName(displayName ?? '');
  }, [displayName, hasEditedName]);

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  const trimmedName = fullName.trim();
  const currentName = displayName?.trim() ?? '';
  const canSave = !saving && trimmedName.length > 0 && trimmedName !== currentName;

  async function onSave() {
    if (!canSave) {
      return;
    }

    if (trimmedName.length === 0) {
      setError('Name is required.');
      return;
    }

    setSaving(true);
    setError(undefined);
    const result = await updateFullName(trimmedName);
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.back();
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Edit profile',
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <ThemedText type="smallBold">Full name</ThemedText>
          <TextInput
            accessibilityLabel="Full name"
            value={fullName}
            onChangeText={(value) => {
              setHasEditedName(true);
              setFullName(value);
            }}
            placeholder="Full name"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="name"
            editable={!saving}
            style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />
          <View style={styles.emailBlock}>
            <ThemedText type="smallBold">Email</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {user.email ?? ''}
            </ThemedText>
          </View>
          {error ? (
            <ThemedText type="small" themeColor="textSecondary">
              {error}
            </ThemedText>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save profile"
            disabled={!canSave}
            onPress={() => {
              void onSave();
            }}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.backgroundSelected },
              !canSave && styles.disabled,
              pressed && canSave && styles.pressed,
            ]}>
            <ThemedText type="smallBold" themeColor="onPrimary">
              {saving ? 'Saving…' : 'Save'}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  input: {
    minHeight: 44,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  emailBlock: {
    gap: Spacing.one,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
