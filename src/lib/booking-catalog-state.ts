export type BookingCatalogDisplay = 'loading' | 'ready' | 'error' | 'missing';

export function bookingCatalogDisplay(input: {
  detailsLoaded: boolean;
  loading: boolean;
  error: string | undefined;
}): BookingCatalogDisplay {
  if (input.detailsLoaded) {
    return 'ready';
  }

  if (input.error) {
    return 'error';
  }

  if (input.loading) {
    return 'loading';
  }

  return 'missing';
}

export function shouldFetchBookingCatalog(input: {
  bookingFound: boolean;
  appState: string | null | undefined;
}): boolean {
  return input.bookingFound && input.appState === 'active';
}

export function shouldRestartCatalogFetch(input: {
  event: 'app_became_active' | 'screen_focused' | 'retry' | 'repeat_navigation';
  detailsLoaded: boolean;
  previousBookingKey: string | undefined;
  nextBookingKey: string | undefined;
}): boolean {
  if (input.event === 'retry') {
    return true;
  }

  if (input.event === 'repeat_navigation') {
    return input.nextBookingKey !== undefined && input.nextBookingKey !== input.previousBookingKey;
  }

  return !input.detailsLoaded;
}

export function bookingCatalogIdentityKey(input: {
  bookingId: string | undefined;
  providerId: string | undefined;
  serviceId: string | undefined;
}): string {
  return JSON.stringify([input.bookingId ?? null, input.providerId ?? null, input.serviceId ?? null]);
}

export function bookedProviderServiceQueryError(
  providerError: string | null | undefined,
  serviceError: string | null | undefined,
): string | undefined {
  const message = providerError?.trim() || serviceError?.trim();
  return message && message.length > 0 ? message : undefined;
}
