export type MapCoordinates = {
  latitude: number;
  longitude: number;
};

export function isSavedCoordinatePair(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  return isFiniteLatitude(latitude) && isFiniteLongitude(longitude);
}

export function formatMapCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

export function isFiniteLatitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isFiniteLongitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

export type MappedProvider<T extends { latitude?: number; longitude?: number }> = T & {
  latitude: number;
  longitude: number;
};

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export function providersWithMapCoordinates<T extends { latitude?: number; longitude?: number }>(
  providers: T[],
): MappedProvider<T>[] {
  const mapped: MappedProvider<T>[] = [];
  for (const provider of providers) {
    if (!isFiniteLatitude(provider.latitude) || !isFiniteLongitude(provider.longitude)) {
      continue;
    }

    mapped.push({
      ...provider,
      latitude: provider.latitude,
      longitude: provider.longitude,
    });
  }

  return mapped;
}

export function regionForMapMarkers(markers: MapCoordinates[], fallback: MapRegion): MapRegion {
  const first = markers[0];
  if (!first) {
    return fallback;
  }

  if (markers.length === 1) {
    return {
      latitude: first.latitude,
      longitude: first.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
  }

  let minLat = first.latitude;
  let maxLat = first.latitude;
  let minLng = first.longitude;
  let maxLng = first.longitude;

  for (const marker of markers) {
    minLat = Math.min(minLat, marker.latitude);
    maxLat = Math.max(maxLat, marker.latitude);
    minLng = Math.min(minLng, marker.longitude);
    maxLng = Math.max(maxLng, marker.longitude);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.02),
  };
}
