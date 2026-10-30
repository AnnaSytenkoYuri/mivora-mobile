import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { BOOKING_TIME_SLOTS } from '@/constants/booking';
import { fetchPublishedProviderAvailability } from '@/data/repositories/availability';
import {
  resolveAvailabilityDay,
  withoutOwnOccupiedInterval,
  type AvailabilityDay,
} from '@/lib/availability';

export function useProviderDayAvailability(input: {
  providerId: string | undefined;
  date: string | null;
  serviceDurationMinutes: number | undefined;
  ignoreOccupied?: { date: string; startTime: string };
}) {
  const [availability, setAvailability] = useState<AvailabilityDay | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reloadKey, setReloadKey] = useState(0);
  const requestIdRef = useRef(0);

  const ignoreKey = input.ignoreOccupied
    ? `${input.ignoreOccupied.date}:${input.ignoreOccupied.startTime}`
    : '';

  const prepareForDateChange = useCallback(() => {
    requestIdRef.current += 1;
    setAvailability(undefined);
    setLoading(true);
    setError(undefined);
  }, []);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!input.providerId || !input.date || input.serviceDurationMinutes === undefined) {
        return;
      }

      const requestId = ++requestIdRef.current;
      const providerId = input.providerId;
      const date = input.date;
      const serviceDurationMinutes = input.serviceDurationMinutes;
      const ignoreOccupied = input.ignoreOccupied;

      setAvailability(undefined);
      setLoading(true);
      setError(undefined);

      void fetchPublishedProviderAvailability({ providerId, date })
        .then((payload) => {
          if (requestId !== requestIdRef.current) {
            return;
          }

          setAvailability(
            resolveAvailabilityDay({
              date,
              weeklyHours: payload.weeklyHours,
              exceptions: payload.exceptions,
              serviceDurationMinutes,
              candidateStartTimes: BOOKING_TIME_SLOTS,
              occupiedIntervals: withoutOwnOccupiedInterval(
                payload.occupiedIntervals,
                ignoreOccupied,
                date,
              ),
            }),
          );
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (requestId !== requestIdRef.current) {
            return;
          }

          setAvailability(undefined);
          setLoading(false);
          setError(caught instanceof Error ? caught.message : 'Could not load availability.');
        });

      return () => {
        requestIdRef.current += 1;
      };
    }, [
      ignoreKey,
      input.date,
      input.providerId,
      input.serviceDurationMinutes,
      reloadKey,
    ]),
  );

  return {
    availability,
    loading,
    error,
    reload,
    prepareForDateChange,
  };
}
