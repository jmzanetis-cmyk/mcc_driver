import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/services/supabase/client';
import { apiUrl } from '@/services/api/baseUrl';

export interface ChatMessage {
  id: string;
  senderRole: 'driver' | 'member' | 'system';
  body: string;
  createdAt: string;
}

interface RideMessageRow {
  id: string;
  sender_role: 'driver' | 'member' | 'system';
  body: string;
  created_at: string;
}

interface UseTripChatResult {
  messages: ChatMessage[];
  sending: boolean;
  sendError: string | null;
  sendMessage: (body: string) => Promise<void>;
}

export function useTripChat(rideId: string | undefined): UseTripChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Load history and subscribe to new messages
  useEffect(() => {
    if (!rideId) return;

    let cancelled = false;

    void (async () => {
      const { data } = await supabase
        .from('ride_messages')
        .select('id, sender_role, body, created_at')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });

      if (!cancelled && data) {
        setMessages((data as RideMessageRow[]).map(toMessage));
      }
    })();

    const channelKey = `trip-chat-${rideId}`;
    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` },
        (payload) => {
          const row = payload.new as RideMessageRow;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, toMessage(row)];
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [rideId]);

  const sendMessage = useCallback(async (body: string) => {
    if (!rideId || !body.trim()) return;
    setSendError(null);
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired');

      const res = await fetch(apiUrl(`/rides/${rideId}/messages`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ body: body.trim() }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [rideId]);

  return { messages, sending, sendError, sendMessage };
}

function toMessage(row: RideMessageRow): ChatMessage {
  return {
    id: row.id,
    senderRole: row.sender_role,
    body: row.body,
    createdAt: row.created_at,
  };
}
