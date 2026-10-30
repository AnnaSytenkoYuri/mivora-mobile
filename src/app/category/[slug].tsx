import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ProviderCard } from '@/components/provider-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useSelectedCity } from '@/context/selected-city-context';
import { getCategoryBySlug, getProvidersByCategory } from '@/data/repositories/catalog';
import { useAsyncData } from '@/hooks/use-async-data';

export default function CategoryScreen() {
  const { slug: slugParam } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof slugParam === 'string' ? slugParam : undefined;
  const { cityId, cityLabel } = useSelectedCity();
  const { data, loading, error } = useAsyncData(async () => {
    if (!slug) {
      return { category: undefined, providers: [] };
    }

    const [category, providers] = await Promise.all([
      getCategoryBySlug(slug),
      getProvidersByCategory(slug, cityId),
    ]);

    return { category, providers };
  }, [slug, cityId]);
  const category = data?.category;
  const providers = data?.providers ?? [];

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackTitle: 'Back',
          title: category?.label ?? 'Category',
        }}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ThemedText themeColor="textSecondary">Loading…</ThemedText>
        ) : error ? (
          <ThemedText themeColor="textSecondary">{error}</ThemedText>
        ) : category ? (
          <>
            <View style={styles.intro}>
              <ThemedText type="small" themeColor="textSecondary">
                {providers.length === 1
                  ? `1 provider in ${cityLabel}`
                  : `${providers.length} providers in ${cityLabel}`}
              </ThemedText>
            </View>
            {providers.length === 0 ? (
              <ThemedText themeColor="textSecondary">
                No providers in this category in {cityLabel} yet.
              </ThemedText>
            ) : (
              providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)
            )}
          </>
        ) : (
          <ThemedText themeColor="textSecondary">This category was not found.</ThemedText>
        )}
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
  intro: {
    gap: Spacing.one,
  },
});
