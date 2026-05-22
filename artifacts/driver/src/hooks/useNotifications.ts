import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/services/supabase/client';
import { apiUrl } from '@/services/api/baseUrl';
import { useAuth } from '@/hooks/useAuth';

export interface DriverNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

interface NotifRow {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export function useNotifications() {
  const { driver } = useAuth();
  const [notifications, setNotifications] = useState<DriverNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(apiUrl('/notifications?limit=50'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const json = await res.json() as { notifications: NotifRow[]; unreadCount: number };
      setNotifications(json.notifications.map(toNotif));
      setUnreadCount(json.unreadCount);
    } finally {
      setLoading(false);
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read: true } : n),
    );
    setUnreadCount((c) => Math.max(0, c - 1));

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(apiUrl(`/notifications/${id}/read`), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(apiUrl('/notifications/read-all'), {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
  }, []);

  // Initial load
  useEffect(() => {
    if (driver?.id) void fetchNotifications();
  }, [driver?.id, fetchNotifications]);

  // Realtime: subscribe to new notifications for this driver
  useEffect(() => {
    if (!driver?.id) return;

    const channel = supabase
      .channel(`driver-notifications-${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'driver_notifications',
          filter: `driver_id=eq.${driver.id}`,
        },
        (payload) => {
          const row = payload.new as NotifRow;
          setNotifications((prev) => [toNotif(row), ...prev]);
          setUnreadCount((c) => c + 1);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [driver?.id]);

  return { notifications, unreadCount, loading, fetchNotifications, markRead, markAllRead };
}

function toNotif(row: NotifRow): DriverNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data,
    read: row.read,
    createdAt: row.created_at,
  };
}
