import { Redirect, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { getCategoryOptions, type CategoryOption } from '@/data/repositories/catalog';
import {
  createMyService,
  deleteMyService,
  getMyManagedServices,
  updateMyService,
  type ManagedService,
} from '@/data/repositories/provider-services';
import { useAsyncData } from '@/hooks/use-async-data';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, formatThb } from '@/lib/format';

export default function ManageServicesScreen() {
  const theme = useTheme();
  const { user } = useAuth();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [services, setServices] = useState<ManagedService[]>([]);

  const { data, loading, error: loadError } = useAsyncData(async () => {
    const [loadedServices, categories] = await Promise.all([
      getMyManagedServices(),
      getCategoryOptions(),
    ]);
    return { services: loadedServices, categories };
  }, []);

  useEffect(() => {
    if (data) {
      setServices(data.services);
    }
  }, [data]);

  const categories = data?.categories ?? [];
  const mutating = saving || deletingId !== null;
  const canSubmit = useMemo(() => {
    return (
      name.trim().length > 0 &&
      categoryId !== null &&
      parsePositiveInt(price) !== undefined &&
      parsePositiveInt(duration) !== undefined &&
      !mutating
    );
  }, [name, categoryId, price, duration, mutating]);

  if (!user) {
    return <Redirect href="/sign-in" />;
  }

  function fillForm(service: ManagedService) {
    setEditingId(service.id);
    setName(service.name);
    setCategoryId(service.categoryId);
    setPrice(String(service.priceThb));
    setDuration(String(service.durationMinutes));
    setError(undefined);
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setCategoryId(null);
    setPrice('');
    setDuration('');
    setError(undefined);
  }

  async function onSave() {
    if (saving) {
      return;
    }

    const priceThb = parsePositiveInt(price);
    const durationMinutes = parsePositiveInt(duration);
    if (!categoryId || priceThb === undefined || durationMinutes === undefined) {
      setError('Fill in name, category, price, and duration.');
      return;
    }

    setSaving(true);
    setError(undefined);
    const result = editingId
      ? await updateMyService({
          serviceId: editingId,
          name,
          categoryId,
          priceThb,
          durationMinutes,
        })
      : await createMyService({
          name,
          categoryId,
          priceThb,
          durationMinutes,
        });
    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    resetForm();
    setServices(result.services);
  }

  function confirmDelete(service: ManagedService) {
    Alert.alert('Delete this service?', `${service.name} will be removed from your profile.`, [
      { text: 'Keep service', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void onDelete(service.id);
        },
      },
    ]);
  }

  async function onDelete(serviceId: string) {
    setDeletingId(serviceId);
    setError(undefined);
    const result = await deleteMyService(serviceId);
    setDeletingId(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    if (editingId === serviceId) {
      resetForm();
    }

    setServices(result.services);
  }

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: 'Manage services',
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        {loading && data === undefined ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : loadError && data === undefined ? (
          <ThemedText themeColor="textSecondary">{loadError}</ThemedText>
        ) : (
          <>
            <View style={styles.block}>
              <ThemedText style={styles.heading}>{editingId ? 'Edit service' : 'Add a service'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                These services appear on your public profile once they are saved.
              </ThemedText>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Service name</ThemedText>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Gel manicure"
                placeholderTextColor={theme.textSecondary}
                editable={!mutating}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Category</ThemedText>
              <View style={styles.chipRow}>
                {categories.map((category) => (
                  <CategoryChip
                    key={category.id}
                    category={category}
                    selected={categoryId === category.id}
                    disabled={mutating}
                    onPress={() => setCategoryId(category.id)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Price (THB)</ThemedText>
              <TextInput
                value={price}
                onChangeText={setPrice}
                placeholder="890"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                editable={!mutating}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
              />
            </View>

            <View style={styles.block}>
              <ThemedText type="smallBold">Duration (minutes)</ThemedText>
              <TextInput
                value={duration}
                onChangeText={setDuration}
                placeholder="60"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                editable={!mutating}
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
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
                void onSave();
              }}
              style={({ pressed }) => [
                !canSubmit && styles.disabled,
                pressed && canSubmit && styles.pressed,
              ]}>
              <ThemedView type="backgroundSelected" style={styles.button}>
                <ThemedText type="smallBold" themeColor="onPrimary">
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add service'}
                </ThemedText>
              </ThemedView>
            </Pressable>

            {editingId ? (
              <Pressable
                accessibilityRole="button"
                disabled={mutating}
                onPress={resetForm}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="backgroundElement" style={styles.button}>
                  <ThemedText type="smallBold">Cancel edit</ThemedText>
                </ThemedView>
              </Pressable>
            ) : null}

            <View style={styles.block}>
              <ThemedText type="smallBold">Your services</ThemedText>
              {services.length === 0 ? (
                <ThemedText themeColor="textSecondary">No services yet. Add your first offering above.</ThemedText>
              ) : (
                services.map((service) => (
                  <ThemedView key={service.id} type="backgroundElement" style={styles.serviceCard}>
                    <ThemedText type="smallBold">{service.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {service.categoryLabel} · {formatDuration(service.durationMinutes)} ·{' '}
                      {formatThb(service.priceThb)}
                    </ThemedText>
                    <View style={styles.serviceActions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={mutating}
                        onPress={() => fillForm(service)}
                        style={({ pressed }) => pressed && styles.pressed}>
                        <ThemedText type="smallBold">Edit</ThemedText>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={mutating}
                        onPress={() => confirmDelete(service)}
                        style={({ pressed }) => pressed && styles.pressed}>
                        <ThemedText type="smallBold">
                          {deletingId === service.id ? 'Deleting…' : 'Delete'}
                        </ThemedText>
                      </Pressable>
                    </View>
                  </ThemedView>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function CategoryChip({
  category,
  selected,
  disabled,
  onPress,
}: {
  category: CategoryOption;
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
          {category.label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function parsePositiveInt(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
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
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  serviceCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  serviceActions: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
