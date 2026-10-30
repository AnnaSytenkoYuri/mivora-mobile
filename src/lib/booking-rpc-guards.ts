const BANGKOK_OFFSET = '+07:00';

/** Matches SQL: ((booking_date + booking_time) AT TIME ZONE 'Asia/Bangkok') > now() */
export function originalBangkokAppointmentIsFuture(
  date: string,
  time: string,
  now: Date,
): boolean {
  const ms = Date.parse(`${date}T${time}:00${BANGKOK_OFFSET}`);
  return !Number.isNaN(ms) && ms > now.getTime();
}

type RpcBooking = {
  userId: string;
  status: string;
  date: string;
  time: string;
};

/** Mirrors cancel_my_booking / reschedule_my_booking row-match rules after 20261026140000. */
export function customerPastStartRpcAllows(
  booking: RpcBooking,
  actorId: string | null,
  now: Date,
): boolean {
  if (actorId === null) {
    return false;
  }

  if (booking.userId !== actorId) {
    return false;
  }

  if (booking.status === 'pending') {
    return true;
  }

  if (booking.status === 'confirmed') {
    return originalBangkokAppointmentIsFuture(booking.date, booking.time, now);
  }

  return false;
}
