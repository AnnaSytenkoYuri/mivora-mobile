import type { LocalReminderTapPayload } from '@/lib/local-reminder-navigation';

export async function getLastLocalReminderTap(): Promise<LocalReminderTapPayload | null> {
  return null;
}

export function subscribeLocalReminderTaps(
  _listener: (payload: LocalReminderTapPayload) => void,
): () => void {
  return () => {};
}

export async function clearLastLocalReminderTap(): Promise<void> {}
