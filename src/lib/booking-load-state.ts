export type BookingsLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export type BookingDetailsViewState = 'loading' | 'found' | 'not_found' | 'error';

export function parseRouteBookingId(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return undefined;
  }

  return raw;
}

export function bookingDetailsViewState(input: {
  routeBookingId: string | undefined;
  authReady: boolean;
  signedIn: boolean;
  bookingsStatus: BookingsLoadStatus;
  bookingFound: boolean;
}): BookingDetailsViewState {
  if (input.routeBookingId === undefined) {
    return 'not_found';
  }

  if (!input.authReady) {
    return 'loading';
  }

  if (!input.signedIn) {
    return 'not_found';
  }

  if (input.bookingFound) {
    return 'found';
  }

  if (input.bookingsStatus === 'idle' || input.bookingsStatus === 'loading') {
    return 'loading';
  }

  if (input.bookingsStatus === 'error') {
    return 'error';
  }

  return 'not_found';
}

export function shouldApplyBookingsFetch(input: {
  requestedUserId: string;
  currentUserId: string | undefined;
  requestedGeneration: number;
  currentGeneration: number;
}): boolean {
  return (
    input.currentUserId === input.requestedUserId &&
    input.currentGeneration === input.requestedGeneration
  );
}

export function shouldCoalesceBookingsFetch(input: {
  currentUserId: string;
  inFlightUserId: string | undefined;
}): boolean {
  return input.inFlightUserId === input.currentUserId;
}

export function bookingsStatusAfterUserChange(input: {
  nextUserId: string | undefined;
  readyUserId: string | undefined;
}): BookingsLoadStatus {
  if (input.nextUserId === undefined) {
    return 'idle';
  }

  if (input.readyUserId === input.nextUserId) {
    return 'ready';
  }

  return 'loading';
}
