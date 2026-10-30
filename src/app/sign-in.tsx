import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { validateSignIn } from '@/lib/auth-validation';
import {
  finishAuthNavigation,
  parseBookingAuthReturn,
  signUpHref,
  type BookingAuthSearchParams,
} from '@/lib/booking-auth-return';
import { useTheme } from '@/hooks/use-theme';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();
  const searchParams = useLocalSearchParams<BookingAuthSearchParams>();
  const bookingReturn = parseBookingAuthReturn(searchParams);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    const validationError = validateSignIn({ email, password });
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(undefined);
    const result = await signIn({
      email: email.trim(),
      password,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
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
          title: 'Sign in',
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <ThemedText style={styles.heading}>Welcome back</ThemedText>
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
          textContentType="password"
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
        />
        {error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {error}
          </ThemedText>
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
              {submitting ? 'Signing in…' : 'Sign in'}
            </ThemedText>
          </ThemedView>
        </Pressable>
        <View style={styles.switchRow}>
          <ThemedText type="small" themeColor="textSecondary">
            New to Mivora?
          </ThemedText>
          <Link href={signUpHref(bookingReturn)} asChild>
            <Pressable accessibilityRole="link">
              <ThemedText type="smallBold">Create account</ThemedText>
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
  heading: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
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
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
