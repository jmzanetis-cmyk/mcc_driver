// ============================================================
// MCC Driver — Tandem Broadcast Subscription Hook
// ============================================================
// Maintains a live list of open tandem broadcasts the ride-along
// driver is eligible for. The list is sourced from an authenticated
// server endpoint that applies all eligibility filters (verified,
// distance, busy-overlap, decline exclusion) so the client only ever
// sees jobs it could actually accept. Supabase Realtime postgres_changes
// on `tandem_jobs` are used purely to invalidate the list and trigger
// a re-fetch.
//
// Prerequisite: tandem_jobs must be in the supabase_realtime publication
// — see scripts/sql/enable-tandem-jobs-realtime.sql.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export interface TandemBroadcastRow {
  id: string;
  rideId: string;
  providerId: string;
  tandemMode: string;
  matchStatus: string;
  matchDeadline: string | null;
  rideAlongFee: string | number | null;
  matchedRideAlongDriverId: string | null;
}

interface UseTandemBroadcastsResult {
  broadcasts: TandemBroadcastRow[];
  isConnected: boolean;
  refresh: () => Promise<void>;
}

/**
 * Live, server-filtered list of tandem broadcasts the caller is eligible for.
 */
export function useTandemBroadcasts(enabled: boolean): UseTandemBroadcastsResult {
  const [broadcasts, setBroadcasts] = useState<TandemBroadcastRow[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setBroadcasts([]);
        return;
      }
      const res = await fetch(`${BASE}/api/ride-along/eligible-broadcasts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.error('[useTandemBroadcasts] fetch failed', res.status);
        return;
      }
      const data = await res.json() as { broadcasts: TandemBroadcastRow[] };
      setBroadcasts(data.broadcasts ?? []);
    } catch (e) {
      console.error('[useTandemBroadcasts] fetch error', e);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      realtimeManager.unsubscribe('tandem-broadcasts');
      setBroadcasts([]);
      setIsConnected(false);
      return;
    }

    void refresh();

    // Use Realtime purely as a cheap change signal — re-fetch the
    // server-filtered list on any tandem_jobs INSERT/UPDATE so the
    // client never bypasses the eligibility checks.
    const channel = supabase
      .channel('tandem-broadcasts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tandem_jobs' },
        () => { void refresh(); },
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    realtimeManager.subscribe('tandem-broadcasts', channel);

    return () => {
      realtimeManager.unsubscribe('tandem-broadcasts');
    };
  }, [enabled, refresh]);

  return { broadcasts, isConnected, refresh };
}
