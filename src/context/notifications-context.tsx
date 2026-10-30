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
  fetchMyNotifications,
  markAllMyNotificationsReadRemote,
  markMyBookingNotificationsReadRemote,
  markNotificationReadRemote,
  markNotificationUnreadRemote,
  type AppNotification,
  type NotificationListMutationResult,
  type NotificationMutationResult,
} from '@/data/repositories/notifications';

type NotificationsContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | undefined;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (notificationId: string) => Promise<NotificationMutationResult>;
  markNotificationUnread: (notificationId: string) => Promise<NotificationMutationResult>;
  markAllNotificationsRead: () => Promise<NotificationListMutationResult>;
  markNotificationsForBooking: (bookingId: string) => Promise<NotificationListMutationResult>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const notificationsRef = useRef<AppNotification[]>([]);
  const refreshGeneration = useRef(0);

  const replaceNotifications = useCallback((next: AppNotification[]) => {
    notificationsRef.current = next;
    setNotifications(next);
  }, []);

  const mergeNotifications = useCallback((updates: AppNotification[]) => {
    if (updates.length === 0) {
      return;
    }

    const byId = new Map(updates.map((item) => [item.id, item]));
    const next = notificationsRef.current.map((item) => byId.get(item.id) ?? item);
    replaceNotifications(next);
  }, [replaceNotifications]);

  const clearNotifications = useCallback(() => {
    refreshGeneration.current += 1;
    replaceNotifications([]);
    setError(undefined);
  }, [replaceNotifications]);

  const refreshNotifications = useCallback(async () => {
    if (!userId) {
      return;
    }

    const generation = refreshGeneration.current + 1;
    refreshGeneration.current = generation;

    try {
      const loaded = await fetchMyNotifications();
      if (generation !== refreshGeneration.current) {
        return;
      }

      replaceNotifications(loaded);
      setError(undefined);
    } catch (caught: unknown) {
      if (generation !== refreshGeneration.current) {
        return;
      }

      setError(caught instanceof Error ? caught.message : 'Could not load notifications.');
    } finally {
      if (generation === refreshGeneration.current) {
        setIsLoading(false);
      }
    }
  }, [replaceNotifications, userId]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    clearNotifications();

    if (!userId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    void refreshNotifications();
  }, [authLoading, userId, clearNotifications, refreshNotifications]);

  const markNotificationRead = useCallback(
    async (notificationId: string): Promise<NotificationMutationResult> => {
      const existing = notificationsRef.current.find((item) => item.id === notificationId);
      if (existing?.readAt) {
        return { ok: true, notification: existing };
      }

      const result = await markNotificationReadRemote(notificationId);
      if (!result.ok) {
        return result;
      }

      mergeNotifications([result.notification]);
      return result;
    },
    [mergeNotifications],
  );

  const markNotificationUnread = useCallback(
    async (notificationId: string): Promise<NotificationMutationResult> => {
      const existing = notificationsRef.current.find((item) => item.id === notificationId);
      if (existing && existing.readAt === null) {
        return { ok: true, notification: existing };
      }

      const result = await markNotificationUnreadRemote(notificationId);
      if (!result.ok) {
        return result;
      }

      mergeNotifications([result.notification]);
      return result;
    },
    [mergeNotifications],
  );

  const markAllNotificationsRead = useCallback(async (): Promise<NotificationListMutationResult> => {
    const unread = notificationsRef.current.filter((item) => item.readAt === null);
    if (unread.length === 0) {
      return { ok: true, notifications: [] };
    }

    const result = await markAllMyNotificationsReadRemote();
    if (!result.ok) {
      return result;
    }

    mergeNotifications(result.notifications);
    return result;
  }, [mergeNotifications]);

  const markNotificationsForBooking = useCallback(
    async (bookingId: string): Promise<NotificationListMutationResult> => {
      const result = await markMyBookingNotificationsReadRemote(bookingId);
      if (!result.ok) {
        return result;
      }

      const knownIds = new Set(notificationsRef.current.map((item) => item.id));
      const hasUnknown = result.notifications.some((item) => !knownIds.has(item.id));
      if (hasUnknown || notificationsRef.current.length === 0) {
        await refreshNotifications();
      } else {
        mergeNotifications(result.notifications);
      }
      return result;
    },
    [mergeNotifications, refreshNotifications],
  );

  const unreadCount = useMemo(
    () => notifications.reduce((count, item) => (item.readAt ? count : count + 1), 0),
    [notifications],
  );

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      isLoading,
      error,
      refreshNotifications,
      markNotificationRead,
      markNotificationUnread,
      markAllNotificationsRead,
      markNotificationsForBooking,
    }),
    [
      notifications,
      unreadCount,
      isLoading,
      error,
      refreshNotifications,
      markNotificationRead,
      markNotificationUnread,
      markAllNotificationsRead,
      markNotificationsForBooking,
    ],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationsProvider');
  }

  return context;
}
