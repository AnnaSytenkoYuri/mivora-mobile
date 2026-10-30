import { BANGKOK_TIME_ZONE } from '@/lib/bangkok-date';

export function formatThb(priceThb: number): string {
  return `฿${priceThb.toLocaleString('en-US')}`;
}

export function formatDuration(minutes: number): string {
  return `${minutes} min`;
}

export function formatBookingStatus(status: string): string {
  if (status.length === 0) {
    return status;
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function formatBookingDate(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];

  if (year === undefined || month === undefined || day === undefined) {
    return isoDate;
  }

  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatNotificationCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return date.toLocaleString('en-GB', {
    timeZone: BANGKOK_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
