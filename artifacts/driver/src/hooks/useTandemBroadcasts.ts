// ============================================================
// MCC Driver — Tandem Broadcast Subscription Hook
// ============================================================
// Subscribes to Supabase Realtime postgres_changes on tandem_jobs and
// maintains a live list of open broadcast jobs the ride-along driver
// can accept. Mirrors the pattern in useRideRequests.ts.
//
// Prerequisite: tandem_jobs must be in the supabase_realtime publication
// — see scripts/sql/enable-tandem-jobs-realtime.sql.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';

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

function mapRow(raw: Record<string, unknown>): TandemBroadcastRow {
  return {
    id: String(raw.id),
    rideId: String(raw.ride_id ?? ''),
    providerId: String(raw.provider_id ?? ''),
    tandemMode: String(raw.tandem_mode ?? ''),
    matchStatus: String(raw.match_status ?? ''),
    matchDeadline: (raw.match_deadline as string | null) ?? null,
    rideAlongFee: (raw.ride_along_fee as string | number | null) ?? null,
    matchedRideAlongDriverId:
      (raw.matched_ride_along_driver_id as string | null) ?? null,
  };
}

interface UseTandemBroadcastsResult {
  broadcasts: TandemBroadcastRow[];
  isConnected: boolean;
  refresh: () => Promise<void>;
}

/**
 * Live list of open tandem broadcast jobs visible to this ride-along driver.
 * The hook seeds from a one-time fetch and then keeps the list in sync via
 * postgres_changes events. Enabled-flag gates the subscription so the
 * dashboard can opt out (e.g. when the driver is offline).
 */
export function useTandemBroadcasts(enabled: boolean): UseTandemBroadcastsResult {
  const [broadcasts, setBroadcasts] = useState<TandemBroadcastRow[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('tandem_jobs')
      .select(
        'id, ride_id, provider_id, tandem_mode, match_status, match_deadline, ride_along_fee, matched_ride_along_driver_id',
      )
      .eq('match_status', 'broadcast')
      .order('match_deadline', { ascending: true });

    if (error) {
      console.error('[useTandemBroadcasts] initial fetch failed', error);
      return;
    }

    setBroadcasts((data ?? []).map((r) => mapRow(r as Record<string, unknown>)));
  }, []);

  useEffect(() => {
    if (!enabled) {
      realtimeManager.unsubscribe('tandem-broadcasts');
      setBroadcasts([]);
      setIsConnected(false);
      return;
    }

    void refresh();

    const channel = supabase
      .channel('tandem-broadcasts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tandem_jobs' },
        (payload) => {
          const row = mapRow(payload.new as Record<string, unknown>);
          if (row.matchStatus !== 'broadcast') return;
          setBroadcasts((prev) =>
            prev.some((b) => b.id === row.id) ? prev : [...prev, row],
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tandem_jobs' },
        (payload) => {
          const row = mapRow(payload.new as Record<string, unknown>);
          setBroadcasts((prev) => {
            const without = prev.filter((b) => b.id !== row.id);
            return row.matchStatus === 'broadcast' ? [...without, row] : without;
          });
        },
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
