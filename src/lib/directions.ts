export type DirectionsDestination =
  | { kind: 'coordinates'; latitude: number; longitude: number }
  | { kind: 'address'; query: string };

function isFiniteLatitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isFiniteLongitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function directionsDestination(input: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  area?: string | null;
  city?: string | null;
}): DirectionsDestination | undefined {
  const latitude = input.latitude;
  const longitude = input.longitude;
  if (isFiniteLatitude(latitude) && isFiniteLongitude(longitude)) {
    return { kind: 'coordinates', latitude, longitude };
  }

  const address = trimmed(input.address);
  const area = trimmed(input.area);
  const city = trimmed(input.city);
  if (address.length === 0 || area.length === 0 || city.length === 0) {
    return undefined;
  }

  return { kind: 'address', query: `${address}, ${area}, ${city}` };
}

function destinationQuery(destination: DirectionsDestination): string {
  if (destination.kind === 'coordinates') {
    return `${destination.latitude},${destination.longitude}`;
  }

  return destination.query;
}

export function appleMapsDirectionsUrl(destination: DirectionsDestination): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(destinationQuery(destination))}`;
}

export function googleMapsDirectionsUrl(destination: DirectionsDestination): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationQuery(destination))}`;
}
