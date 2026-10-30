import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mivora.favoriteProviderIds';

export async function loadFavoriteIds(): Promise<string[]> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export async function saveFavoriteIds(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
