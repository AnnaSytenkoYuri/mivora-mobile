import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CitySelector } from '@/components/city-selector';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DEFAULT_CITY_ID, cityLabel, type CityId } from '@/constants/cities';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { createMyProvider } from '@/data/repositories/provider-setup';
import type { ProviderKind } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';

export default function ProviderSetupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [kind, setKind] = useState<ProviderKind>('specialist');
  const [name, setName] = useState('');
  const [cityId, setCityId] = useState<CityId>(DEFAULT_CITY_ID);
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [createdName, setCreatedName] = useState<string | undefined>();

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  const canSubmit =
    name.trim().length > 0 &&
    cityId !== undefined &&
    area.trim().length > 0 &&
    bio.trim().length > 0 &&
    !submitting;

  async function onSubmit() {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    setError(undefined);
    const result = await createMyProvider({
      kind,
      name,
      city: cityLabel(cityId),
      area,
      address,
      bio,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setCreatedName(result.provider.name);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Become a Provider',
        }}
      />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}
        automaticallyAdjustKeyboardInsets
        automaticallyAdjustContentInsets={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
        {createdName ? (
          <View style={styles.block}>
            <ThemedText style={styles.heading}>Profile created</ThemedText>
            <ThemedText>
              {createdName} is saved. It will not appear in Search or Featured until services are added
              and the profile is ready to publish.
            </ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.block}>
              <ThemedText type="small" themeColor="textSecondary">
                Create your specialist or salon profile.
              </ThemedText>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Provider type</ThemedText>
              <View style={styles.chipRow}>
                <KindChip
                  label="Specialist"
                  selected={kind === 'specialist'}
                  disabled={submitting}
                  onPress={() => setKind('specialist')}
                />
                <KindChip
                  label="Salon"
                  selected={kind === 'salon'}
                  disabled={submitting}
                  onPress={() => setKind('salon')}
                />
              </View>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Business name</ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Business name"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                editable={!submitting}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">City</ThemedText>
              <CitySelector value={cityId} onChange={setCityId} disabled={submitting} />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Area</ThemedText>
              <TextInput
                value={area}
                onChangeText={setArea}
                placeholder="Thonglor"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                editable={!submitting}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Street address</ThemedText>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder="Optional, e.g. 123 Sukhumvit Rd"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                editable={!submitting}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Bio</ThemedText>
              <TextInput
                value={bio}
                onChangeText={setBio}
                placeholder="Tell clients about your work"
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
                editable={!submitting}
                style={[
                  styles.input,
                  styles.textarea,
                  { backgroundColor: theme.backgroundElement, color: theme.text },
                ]}
              />
            </View>

            {error ? (
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={() => {
                void onSubmit();
              }}
              style={({ pressed }) => [
                !canSubmit && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}>
              <ThemedView type="backgroundSelected" style={styles.button}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  {submitting ? 'Saving…' : 'Create profile'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function KindChip({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && !disabled && styles.pressed]}>
      <ThemedView type={selected ? 'backgroundSelected' : 'backgroundElement'} style={styles.chip}>
        <ThemedText type="small" themeColor={selected ? 'onPrimary' : undefined}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
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
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  heading: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: 600,
  },
  block: {
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  input: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  textarea: {
    minHeight: 120,
  },
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
