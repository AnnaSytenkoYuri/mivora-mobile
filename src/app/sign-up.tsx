import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { validateSignUp } from '@/lib/auth-validation';
import {
  finishAuthNavigation,
  parseBookingAuthReturn,
  signInHref,
  type BookingAuthSearchParams,
} from '@/lib/booking-auth-return';
import { useTheme } from '@/hooks/use-theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const { signUp } = useAuth();
  const searchParams = useLocalSearchParams<BookingAuthSearchParams>();
  const bookingReturn = parseBookingAuthReturn(searchParams);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    const validationError = validateSignUp({ name, email, password, confirmPassword });
    if (validationError) {
      setError(validationError);
      setInfo(undefined);
      return;
    }

    setSubmitting(true);
    setError(undefined);
    setInfo(undefined);
    const result = await signUp({
      name: name.trim(),
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    if (result.needsEmailConfirmation) {
      setInfo('Check your email to confirm your account, then sign in.');
      return;
    }

    finishAuthNavigation(bookingReturn);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Create account',
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          textContentType="name"
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          textContentType="newPassword"
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm password"
          placeholderTextColor={theme.textSecondary}
          secureTextEntry
          textContentType="newPassword"
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        {error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
        ) : null}
        {info ? (
          <ThemedText type="small">{info}</ThemedText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => {
            void onSubmit();
          }}
          style={({ pressed }) => [submitting && styles.disabled, pressed && !submitting && styles.pressed]}>
          <ThemedView type="backgroundSelected" style={styles.button}>
            <ThemedText type="smallBold" themeColor="onPrimary">
              {submitting ? 'Creating account…' : 'Create account'}
            </ThemedText>
          </ThemedView>
        </Pressable>
        <View style={styles.switchRow}>
          <ThemedText type="small" themeColor="textSecondary">
            Already have an account?
          </ThemedText>
          <Link href={signInHref(bookingReturn)} asChild>
            <Pressable accessibilityRole="link">
              <ThemedText type="smallBold">Sign in</ThemedText>
            </Pressable>
          </Link>
        </View>
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
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  switchRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
