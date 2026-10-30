import { router, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import {
  decideLocalReminderNavigation,
  localReminderTapResponseKey,
  parseLocalReminderTapBookingId,
  type LocalReminderTapPayload,
} from '@/lib/local-reminder-navigation';
import {
  clearLastLocalReminderTap,
  getLastLocalReminderTap,
  subscribeLocalReminderTaps,
} from '@/lib/local-reminder-taps';

const DUPLICATE_TAP_MS = 2000;

export function useLocalReminderNotificationNavigation() {
  const navigationState = useRootNavigationState();
  const { user, isLoading: authLoading } = useAuth();
  const { bookings, bookingsStatus, refreshBookings } = useBookings();
  const [pending, setPending] = useState<LocalReminderTapPayload | null>(null);
  const recentTap = useRef<{ key: string; at: number } | null>(null);
  const errorRetried = useRef(new Set<string>());
  const navigationReady = navigationState?.key != null;
  const authReady = !authLoading;
  const signedIn = user !== null;

  useEffect(() => {
    let cancelled = false;

    function enqueue(payload: LocalReminderTapPayload) {
      const key = localReminderTapResponseKey(payload);
      const recent = recentTap.current;
      if (recent !== null && recent.key === key && Date.now() - recent.at < DUPLICATE_TAP_MS) {
        return;
      }

      if (parseLocalReminderTapBookingId(payload) === undefined) {
        recentTap.current = { key, at: Date.now() };
        void clearLastLocalReminderTap();
        return;
      }

      recentTap.current = { key, at: Date.now() };
      setPending(payload);
    }

    void getLastLocalReminderTap().then((payload) => {
      if (!cancelled && payload) {
        enqueue(payload);
      }
    });

    const unsubscribe = subscribeLocalReminderTaps((payload) => {
      if (!cancelled) {
        enqueue(payload);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (pending === null) {
      return;
    }

    const bookingId = parseLocalReminderTapBookingId(pending);
    const key = localReminderTapResponseKey(pending);
    const bookingOwned = bookingId !== undefined && bookings.some((item) => item.id === bookingId);
    const decision = decideLocalReminderNavigation({
      bookingId,
      navigationReady,
      authReady,
      signedIn,
      bookingsStatus,
      bookingOwned,
    });

    if (decision.action === 'ignore') {
      setPending(null);
      void clearLastLocalReminderTap();
      return;
    }

    if (decision.action === 'open') {
      setPending(null);
      void clearLastLocalReminderTap();
      router.push({
        pathname: '/bookings/[id]',
        params: { id: decision.bookingId },
      });
      return;
    }

    if (!signedIn || !authReady || !navigationReady || bookingId === undefined) {
      return;
    }

    if (bookingsStatus !== 'error') {
      return;
    }

    if (!errorRetried.current.has(key)) {
      errorRetried.current.add(key);
      void refreshBookings();
      return;
    }

    setPending(null);
    void clearLastLocalReminderTap();
    router.push({
      pathname: '/bookings/[id]',
      params: { id: bookingId },
    });
  }, [
    authReady,
    bookings,
    bookingsStatus,
    navigationReady,
    pending,
    refreshBookings,
    signedIn,
  ]);
}
