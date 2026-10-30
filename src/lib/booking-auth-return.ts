import { router, type Href } from 'expo-router';

import { BOOKING_TIME_SLOTS } from '@/constants/booking';

export type BookingAuthReturn = {
  providerId: string;
  serviceId: string;
  date: string;
  time: string;
};

export type BookingAuthSearchParams = {
  returnProviderId?: string | string[];
  returnServiceId?: string | string[];
  returnDate?: string | string[];
  returnTime?: string | string[];
};

export function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return undefined;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isBookingTime(value: string): boolean {
  return (BOOKING_TIME_SLOTS as readonly string[]).includes(value);
}

export function parseBookingAuthReturn(
  params: BookingAuthSearchParams,
): BookingAuthReturn | undefined {
  const providerId = firstSearchParam(params.returnProviderId);
  const serviceId = firstSearchParam(params.returnServiceId);
  const date = firstSearchParam(params.returnDate);
  const time = firstSearchParam(params.returnTime);

  if (!providerId || !serviceId || !date || !time) {
    return undefined;
  }

  if (!isIsoDate(date) || !isBookingTime(time)) {
    return undefined;
  }

  return { providerId, serviceId, date, time };
}

export function bookingAuthParams(selection: BookingAuthReturn) {
  return {
    returnProviderId: selection.providerId,
    returnServiceId: selection.serviceId,
    returnDate: selection.date,
    returnTime: selection.time,
  };
}

export function signInHref(returnTo?: BookingAuthReturn): Href {
  if (!returnTo) {
    return '/sign-in';
  }

  return {
    pathname: '/sign-in',
    params: bookingAuthParams(returnTo),
  };
}

export function signUpHref(returnTo?: BookingAuthReturn): Href {
  if (!returnTo) {
    return '/sign-up';
  }

  return {
    pathname: '/sign-up',
    params: bookingAuthParams(returnTo),
  };
}

export function restoreBookingHref(returnTo: BookingAuthReturn): Href {
  return {
    pathname: '/booking/[providerId]',
    params: {
      providerId: returnTo.providerId,
      serviceId: returnTo.serviceId,
      date: returnTo.date,
      time: returnTo.time,
    },
  };
}

export function finishAuthNavigation(returnTo: BookingAuthReturn | undefined): void {
  if (returnTo) {
    router.navigate(restoreBookingHref(returnTo));
    return;
  }

  router.dismissAll();
}

export function parseRestoredBookingSelection(params: {
  date?: string | string[];
  time?: string | string[];
}): { date: string | null; time: string | null } {
  const dateValue = firstSearchParam(params.date);
  const timeValue = firstSearchParam(params.time);

  return {
    date: dateValue && isIsoDate(dateValue) ? dateValue : null,
    time: timeValue && isBookingTime(timeValue) ? timeValue : null,
  };
}
