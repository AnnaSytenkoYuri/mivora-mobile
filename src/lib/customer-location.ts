import * as Location from 'expo-location';

import { isFiniteGeoPoint, type GeoPoint } from '@/lib/distance';

export type CustomerLocationResult =
  | { ok: true; coordinates: GeoPoint }
  | { ok: false; reason: 'denied' | 'unavailable' | 'failed'; message: string };

const DENIED =
  'Location access is needed to show approximate distance. Search still works without it.';
const UNAVAILABLE =
  'Location is turned off on this device. Search still works without Near me.';
const FAILED = 'Could not get your location. Search still works without Near me.';

export async function requestOnceCustomerLocation(): Promise<CustomerLocationResult> {
  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      return { ok: false, reason: 'unavailable', message: UNAVAILABLE };
    }

    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return { ok: false, reason: 'denied', message: DENIED };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    if (!isFiniteGeoPoint(latitude, longitude)) {
      return { ok: false, reason: 'failed', message: FAILED };
    }

    return { ok: true, coordinates: { latitude, longitude } };
  } catch {
    return { ok: false, reason: 'failed', message: FAILED };
  }
}
