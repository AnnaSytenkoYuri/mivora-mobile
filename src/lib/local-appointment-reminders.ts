export type LocalAppointmentReminderKind = 'booking_reminder_24h' | 'booking_reminder_2h';

export const LOCAL_REMINDER_ID_PREFIX = 'mivora.appt.';

export const LOCAL_REMINDER_HOURS: Record<LocalAppointmentReminderKind, number> = {
  booking_reminder_24h: 24,
  booking_reminder_2h: 2,
};

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const BANGKOK_OFFSET = '+07:00';
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MINUTE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_REMINDER_KINDS: LocalAppointmentReminderKind[] = [
  'booking_reminder_24h',
  'booking_reminder_2h',
];

export type LocalReminderBooking = {
  id: string;
  status: string;
  date: string;
  time: string;
  providerName?: string;
  serviceName?: string;
};

export type PlannedLocalReminder = {
  identifier: string;
  bookingId: string;
  kind: LocalAppointmentReminderKind;
  fireAtMs: number;
  title: string;
  body: string;
};

export function isMivoraLocalReminderIdentifier(identifier: string): boolean {
  return identifier.startsWith(LOCAL_REMINDER_ID_PREFIX);
}

export function localReminderIdentifier(
  bookingId: string,
  kind: LocalAppointmentReminderKind,
  appointmentMs: number,
): string {
  return `${LOCAL_REMINDER_ID_PREFIX}${bookingId}:${kind}:${appointmentMs}`;
}

export function localReminderFireMs(
  appointmentMs: number,
  kind: LocalAppointmentReminderKind,
): number {
  return appointmentMs - LOCAL_REMINDER_HOURS[kind] * 60 * 60 * 1000;
}

export function bangkokAppointmentMs(date: string, time: string): number | undefined {
  if (!DATE_ISO.test(date) || !HOUR_MINUTE.test(time)) {
    return undefined;
  }

  const ms = Date.parse(`${date}T${time}:00${BANGKOK_OFFSET}`);
  return Number.isNaN(ms) ? undefined : ms;
}

export function shouldScheduleLocalAppointmentReminder(input: {
  status: string;
  appointmentMs: number;
  kind: LocalAppointmentReminderKind;
  nowMs: number;
}): boolean {
  if (input.status !== 'confirmed') {
    return false;
  }

  if (!(input.appointmentMs > input.nowMs)) {
    return false;
  }

  return localReminderFireMs(input.appointmentMs, input.kind) > input.nowMs;
}

export function planLocalAppointmentReminders(
  bookings: LocalReminderBooking[],
  nowMs: number,
): PlannedLocalReminder[] {
  const planned: PlannedLocalReminder[] = [];

  for (const booking of bookings) {
    const appointmentMs = bangkokAppointmentMs(booking.date, booking.time);
    if (appointmentMs === undefined) {
      continue;
    }

    for (const kind of LOCAL_REMINDER_KINDS) {
      if (
        !shouldScheduleLocalAppointmentReminder({
          status: booking.status,
          appointmentMs,
          kind,
          nowMs,
        })
      ) {
        continue;
      }

      const content = localReminderNotificationContent({
        kind,
        date: booking.date,
        time: booking.time,
        providerName: booking.providerName,
        serviceName: booking.serviceName,
      });

      planned.push({
        identifier: localReminderIdentifier(booking.id, kind, appointmentMs),
        bookingId: booking.id,
        kind,
        fireAtMs: localReminderFireMs(appointmentMs, kind),
        title: content.title,
        body: content.body,
      });
    }
  }

  return planned;
}

export function localReminderSyncPlan(
  desiredIdentifiers: string[],
  scheduledIdentifiers: string[],
): { cancel: string[]; schedule: string[] } {
  const desired = new Set(desiredIdentifiers);
  const ours = scheduledIdentifiers.filter(isMivoraLocalReminderIdentifier);
  const scheduled = new Set(ours);

  return {
    cancel: ours.filter((identifier) => !desired.has(identifier)),
    schedule: desiredIdentifiers.filter((identifier) => !scheduled.has(identifier)),
  };
}

export function identifiersToCancelOnSignOut(scheduledIdentifiers: string[]): string[] {
  return scheduledIdentifiers.filter(isMivoraLocalReminderIdentifier);
}

export function usableReminderLabel(value: string | undefined): string | undefined {
  const name = value?.trim();
  if (!name) {
    return undefined;
  }

  if (
    name === 'This provider is no longer available' ||
    name === 'This service is no longer available'
  ) {
    return undefined;
  }

  return name;
}

export function localReminderNotificationContent(input: {
  kind: LocalAppointmentReminderKind;
  date: string;
  time: string;
  providerName?: string;
  serviceName?: string;
}): { title: string; body: string } {
  const time = formatReminderTime(input.time);
  const when = formatReminderWhen(input.date, input.time);
  const dateLabel = formatReminderDateLabel(input.date, input.time);
  const providerName = usableReminderLabel(input.providerName);
  const serviceName = usableReminderLabel(input.serviceName);
  const names = formatReminderNames(providerName, serviceName);
  const isDayBefore = input.kind === 'booking_reminder_24h';

  return {
    title: isDayBefore ? `Tomorrow · ${time}` : `In 2 hours · ${time}`,
    body:
      names && dateLabel
        ? `${names} · ${dateLabel}`
        : (names ?? when ?? (isDayBefore ? 'Your Mivora booking is tomorrow.' : 'Your Mivora booking starts in 2 hours.')),
  };
}

function formatReminderTime(time: string): string {
  return time.length >= 5 ? time.slice(0, 5) : time;
}

function formatReminderDateLabel(date: string, time: string): string | undefined {
  const ms = bangkokAppointmentMs(date, time);
  if (ms === undefined) {
    return date.length > 0 ? date : undefined;
  }

  return new Date(ms).toLocaleDateString('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatReminderWhen(date: string, time: string): string | undefined {
  const dateLabel = formatReminderDateLabel(date, time);
  const clock = formatReminderTime(time);
  if (dateLabel && clock) {
    return `${dateLabel} · ${clock}`;
  }

  return dateLabel ?? (clock.length > 0 ? clock : undefined);
}

function formatReminderNames(
  providerName: string | undefined,
  serviceName: string | undefined,
): string | undefined {
  if (serviceName && providerName) {
    return `${serviceName} at ${providerName}`;
  }

  return serviceName ?? providerName;
}
