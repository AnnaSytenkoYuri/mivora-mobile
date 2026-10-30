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

import { useAuth } from '@/context/auth-context';
import {
  cancelBookingRemote,
  createBooking,
  fetchMyBookings,
  rescheduleBookingRemote,
  type BookingMutationResult,
} from '@/data/repositories/bookings';
import type { Booking, BookingStatus } from '@/data/types';
import {
  bookingsStatusAfterUserChange,
  shouldApplyBookingsFetch,
  shouldCoalesceBookingsFetch,
  type BookingsLoadStatus,
} from '@/lib/booking-load-state';

type NewBookingInput = {
  providerId: string;
  serviceId: string;
  date: string;
  time: string;
};

type BookingsContextValue = {
  bookings: Booking[];
  bookingsStatus: BookingsLoadStatus;
  bookingsError: string | undefined;
  refreshBookings: () => Promise<void>;
  applyCustomerBookingStatus: (bookingId: string, status: BookingStatus) => void;
  getBookingById: (bookingId: string) => Booking | undefined;
  addBooking: (input: NewBookingInput) => Promise<BookingMutationResult>;
  cancelBooking: (bookingId: string) => Promise<BookingMutationResult>;
  rescheduleBooking: (
    bookingId: string,
    date: string,
    time: string,
  ) => Promise<BookingMutationResult>;
};

const BookingsContext = createContext<BookingsContextValue | null>(null);

export function BookingsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsStatus, setBookingsStatus] = useState<BookingsLoadStatus>('idle');
  const [bookingsError, setBookingsError] = useState<string | undefined>();
  const bookingsRef = useRef<Booking[]>([]);
  const userIdRef = useRef<string | undefined>(user?.id);
  const readyUserIdRef = useRef<string | undefined>(undefined);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const inFlightUserIdRef = useRef<string | undefined>(undefined);
  const refreshGeneration = useRef(0);
  userIdRef.current = user?.id;

  const refreshBookings = useCallback(async () => {
    const currentUserId = userIdRef.current;
    if (!currentUserId) {
      return;
    }

    if (
      inFlightRef.current &&
      shouldCoalesceBookingsFetch({
        currentUserId,
        inFlightUserId: inFlightUserIdRef.current,
      })
    ) {
      await inFlightRef.current;
      return;
    }

    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;
    const requestedUserId = currentUserId;
    inFlightUserIdRef.current = requestedUserId;

    if (readyUserIdRef.current !== requestedUserId) {
      setBookingsStatus('loading');
    }

    const run = (async () => {
      try {
        const loaded = await fetchMyBookings();
        if (
          !shouldApplyBookingsFetch({
            requestedUserId,
            currentUserId: userIdRef.current,
            requestedGeneration: generation,
            currentGeneration: refreshGeneration.current,
          })
        ) {
          return;
        }

        bookingsRef.current = loaded;
        readyUserIdRef.current = requestedUserId;
        setBookings(loaded);
        setBookingsError(undefined);
        setBookingsStatus('ready');
      } catch (caught: unknown) {
        if (
          !shouldApplyBookingsFetch({
            requestedUserId,
            currentUserId: userIdRef.current,
            requestedGeneration: generation,
            currentGeneration: refreshGeneration.current,
          })
        ) {
          return;
        }

        const message = caught instanceof Error ? caught.message : 'Could not load bookings.';
        setBookingsError(message);
        if (readyUserIdRef.current !== requestedUserId) {
          setBookingsStatus('error');
        }
      } finally {
        if (inFlightUserIdRef.current === requestedUserId) {
          inFlightRef.current = null;
          inFlightUserIdRef.current = undefined;
        }
      }
    })();

    inFlightRef.current = run;
    await run;
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const nextStatus = bookingsStatusAfterUserChange({
      nextUserId: user?.id,
      readyUserId: readyUserIdRef.current,
    });

    if (!user) {
      refreshGeneration.current += 1;
      inFlightRef.current = null;
      inFlightUserIdRef.current = undefined;
      readyUserIdRef.current = undefined;
      bookingsRef.current = [];
      setBookings([]);
      setBookingsError(undefined);
      setBookingsStatus('idle');
      return;
    }

    if (readyUserIdRef.current !== user.id) {
      refreshGeneration.current += 1;
      inFlightRef.current = null;
      inFlightUserIdRef.current = undefined;
      bookingsRef.current = [];
      setBookings([]);
      setBookingsError(undefined);
      setBookingsStatus(nextStatus);
    }

    void refreshBookings();
  }, [authLoading, user?.id, refreshBookings]);

  const replaceBooking = useCallback((updated: Booking): Booking => {
    const next = bookingsRef.current.map((booking) =>
      booking.id === updated.id ? updated : booking,
    );
    bookingsRef.current = next;
    setBookings(next);
    return updated;
  }, []);

  const applyCustomerBookingStatus = useCallback(
    (bookingId: string, status: BookingStatus) => {
      const existing = bookingsRef.current.find((booking) => booking.id === bookingId);
      if (!existing || existing.status === status) {
        return;
      }

      replaceBooking({ ...existing, status });
    },
    [replaceBooking],
  );

  const getBookingById = useCallback((bookingId: string) => {
    return bookingsRef.current.find((booking) => booking.id === bookingId);
  }, []);

  const addBooking = useCallback(async (input: NewBookingInput): Promise<BookingMutationResult> => {
    const result = await createBooking(input);
    if (!result.ok) {
      return result;
    }

    const next = [...bookingsRef.current, result.booking];
    bookingsRef.current = next;
    setBookings(next);
    if (user?.id) {
      readyUserIdRef.current = user.id;
      setBookingsStatus('ready');
      setBookingsError(undefined);
    }
    return result;
  }, [user?.id]);

  const cancelBooking = useCallback(
    async (bookingId: string): Promise<BookingMutationResult> => {
      const existing = bookingsRef.current.find((booking) => booking.id === bookingId);
      if (!existing || (existing.status !== 'pending' && existing.status !== 'confirmed')) {
        return { ok: false, message: 'This booking cannot be cancelled.' };
      }

      const result = await cancelBookingRemote(bookingId);
      if (!result.ok) {
        return result;
      }

      replaceBooking(result.booking);
      return result;
    },
    [replaceBooking],
  );

  const rescheduleBooking = useCallback(
    async (bookingId: string, date: string, time: string): Promise<BookingMutationResult> => {
      const existing = bookingsRef.current.find((booking) => booking.id === bookingId);
      if (!existing || (existing.status !== 'pending' && existing.status !== 'confirmed')) {
        return { ok: false, message: 'This booking cannot be rescheduled.' };
      }

      const result = await rescheduleBookingRemote(bookingId, date, time);
      if (!result.ok) {
        return result;
      }

      replaceBooking(result.booking);
      return result;
    },
    [replaceBooking],
  );

  const value = useMemo(
    () => ({
      bookings,
      bookingsStatus,
      bookingsError,
      refreshBookings,
      applyCustomerBookingStatus,
      getBookingById,
      addBooking,
      cancelBooking,
      rescheduleBooking,
    }),
    [
      bookings,
      bookingsStatus,
      bookingsError,
      refreshBookings,
      applyCustomerBookingStatus,
      getBookingById,
      addBooking,
      cancelBooking,
      rescheduleBooking,
    ],
  );

  return <BookingsContext.Provider value={value}>{children}</BookingsContext.Provider>;
}

export function useBookings(): BookingsContextValue {
  const context = useContext(BookingsContext);
  if (!context) {
    throw new Error('useBookings must be used within BookingsProvider');
  }

  return context;
}
