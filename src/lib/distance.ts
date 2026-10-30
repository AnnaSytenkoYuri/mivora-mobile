export type GeoPoint = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_KM = 6371;

function isFiniteLatitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isFiniteLongitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isFiniteGeoPoint(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  return isFiniteLatitude(latitude) && isFiniteLongitude(longitude);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineKm(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const deltaLat = toRadians(toLatitude - fromLatitude);
  const deltaLng = toRadians(toLongitude - fromLongitude);
  const fromLat = toRadians(fromLatitude);
  const toLat = toRadians(toLatitude);
  const chord =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(chord)));
}

export function distanceKmFromOrigin(
  origin: GeoPoint,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): number | undefined {
  const toLatitude = latitude;
  const toLongitude = longitude;
  if (
    !isFiniteLatitude(origin.latitude) ||
    !isFiniteLongitude(origin.longitude) ||
    !isFiniteLatitude(toLatitude) ||
    !isFiniteLongitude(toLongitude)
  ) {
    return undefined;
  }

  return haversineKm(origin.latitude, origin.longitude, toLatitude, toLongitude);
}

export function formatApproximateDistanceKm(kilometers: number): string {
  if (!Number.isFinite(kilometers) || kilometers < 0) {
    return 'Approximate straight-line distance unavailable';
  }

  const rounded = kilometers < 0.1 ? 0.1 : kilometers < 10 ? Number(kilometers.toFixed(1)) : Math.round(kilometers);
  const label = kilometers < 10 ? rounded.toFixed(1) : String(rounded);
  return `About ${label} km away · straight-line`;
}

export function sortProvidersByNearest<T extends { latitude?: number | null; longitude?: number | null }>(
  providers: T[],
  origin: GeoPoint,
): T[] {
  return [...providers].sort((left, right) => {
    const leftKm = distanceKmFromOrigin(origin, left.latitude, left.longitude);
    const rightKm = distanceKmFromOrigin(origin, right.latitude, right.longitude);
    if (leftKm == null && rightKm == null) {
      return 0;
    }
    if (leftKm == null) {
      return 1;
    }
    if (rightKm == null) {
      return -1;
    }
    return leftKm - rightKm;
  });
}
