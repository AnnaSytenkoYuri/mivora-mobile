import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_CITY_ID, isCityId, type CityId } from '@/constants/cities';

const STORAGE_KEY = 'mivora.selectedCityId';

export async function loadSelectedCityId(): Promise<CityId> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  return isCityId(value) ? value : DEFAULT_CITY_ID;
}

export async function saveSelectedCityId(cityId: CityId): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, cityId);
}
