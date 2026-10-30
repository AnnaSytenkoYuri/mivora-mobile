import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { useBookings } from '@/context/bookings-context';
import type { Booking } from '@/data/types';
import { bookingDetailsKey, loadBookingDetails } from '@/lib/booking-list';
import {
  bangkokAppointmentMs,
  planLocalAppointmentReminders,
  usableReminderLabel,
  type LocalReminderBooking,
} from '@/lib/local-appointment-reminders';
import {
  cancelAccountLocalAppointmentReminders,
  getLocalNotificationPermission,
  requestLocalNotificationPermission,
  syncLocalAppointmentReminders,
  type LocalNotificationPermission,
} from '@/lib/local-notifications';

type LocalAppointmentRemindersContextValue = {
  permission: LocalNotificationPermission;
  enabling: boolean;
  enableReminders: () => Promise<LocalNotificationPermission>;
};

const LocalAppointmentRemindersContext =
  createContext<LocalAppointmentRemindersContextValue | null>(null);

export function LocalAppointmentRemindersProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const { bookings } = useBookings();
  const [permission, setPermission] = useState<LocalNotificationPermission>('undetermined');
  const [enabling, setEnabling] = useState(false);
  const syncGeneration = useRef(0);
  const userId = user?.id;

  const refreshPermission = useCallback(async () => {
    const next = await getLocalNotificationPermission();
    setPermission(next);
    return next;
  }, []);

  const runSync = useCallback(
    async (status: LocalNotificationPermission) => {
      const generation = syncGeneration.current + 1;
      syncGeneration.current = generation;

      if (!userId || status !== 'granted') {
        await cancelAccountLocalAppointmentReminders();
        return;
      }

      const desired = planLocalAppointmentReminders(
        await reminderBookingsWithCatalogNames(bookings),
        Date.now(),
      );
      await syncLocalAppointmentReminders(desired);
      if (generation !== syncGeneration.current) {
        return;
      }
    },
    [bookings, userId],
  );

  useEffect(() => {
    if (authLoading) {
      return;
    }

    let cancelled = false;

    async function syncFromPermission() {
      const next = await refreshPermission();
      if (cancelled) {
        return;
      }
      await runSync(next);
    }

    void syncFromPermission();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncFromPermission();
      }
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [authLoading, refreshPermission, runSync, userId]);

  const enableReminders = useCallback(async () => {
    setEnabling(true);
    try {
      const next = await requestLocalNotificationPermission();
      setPermission(next);
      await runSync(next);
      return next;
    } finally {
      setEnabling(false);
    }
  }, [runSync]);

  const value = useMemo(
    () => ({
      permission,
      enabling,
      enableReminders,
    }),
    [enableReminders, enabling, permission],
  );

  return (
    <LocalAppointmentRemindersContext.Provider value={value}>
      {children}
    </LocalAppointmentRemindersContext.Provider>
  );
}

async function reminderBookingsWithCatalogNames(
  bookings: Booking[],
): Promise<LocalReminderBooking[]> {
  const upcomingConfirmed = bookings.filter((booking) => {
    if (booking.status !== 'confirmed') {
      return false;
    }

    const appointmentMs = bangkokAppointmentMs(booking.date, booking.time);
    return appointmentMs !== undefined && appointmentMs > Date.now();
  });
  if (upcomingConfirmed.length === 0) {
    return bookings;
  }

  try {
    const detailsByKey = await loadBookingDetails(upcomingConfirmed);
    return bookings.map((booking) => {
      const details = detailsByKey[bookingDetailsKey(booking)];
      return {
        ...booking,
        providerName: usableReminderLabel(details?.provider.name),
        serviceName: usableReminderLabel(details?.service.name),
      };
    });
  } catch {
    return bookings;
  }
}

export function useLocalAppointmentReminders(): LocalAppointmentRemindersContextValue {
  const context = useContext(LocalAppointmentRemindersContext);
  if (!context) {
    throw new Error(
      'useLocalAppointmentReminders must be used within LocalAppointmentRemindersProvider',
    );
  }

  return context;
}
