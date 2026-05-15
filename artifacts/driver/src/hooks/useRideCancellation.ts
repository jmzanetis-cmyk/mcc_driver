// ============================================================
// MCC Driver — useRideCancellation Hook
// ============================================================
// Subscribes to Supabase Realtime UPDATE events on the rides
// table for the driver's current ride. When the ride status
// changes to 'cancelled' (member, admin, or system), it sets
// the dispatch store to the 'cancelled' stage so NavigateScreen
// shows an overlay, and sets serverCancelled so ActiveRideWatcher
// auto-navigates the driver back to home.
//
// Prerequisites (one-time Supabase setup):
//   ALTER PUBLICATION supabase_realtime ADD TABLE rides;
// See scripts/sql/enable-rides-realtime.sql for the full script.
//
// Write path: The API server's cancel route writes the ride status
// change to Supabase via supabaseAdmin (HTTPS + service role key),
// which triggers this Realtime event. Local-only Drizzle writes
// do NOT trigger Realtime — the Supabase admin write is required.
// ============================================================

import { useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { useDispatchStore } from '@/store/dispatchStore';
import { clearRideState } from '@/services/offline/storage';
import { logger } from '@/services/telemetry/logger';

export function useRideCancellation() {
  const rideId = useDispatchStore((s) => s.rideId);
  const stage = useDispatchStore((s) => s.stage);
  const setCancelled = useDispatchStore((s) => s.setCancelled);
  const setServerCancelled = useDispatchStore((s) => s.setServerCancelled);

  useEffect(() => {
    // Only watch for cancellations once the driver has accepted a ride
    const isActive =
      stage !== 'idle' && stage !== 'offered' && stage !== 'completed' && stage !== 'cancelled';
    if (!rideId || !isActive) return;

    const channelKey = `ride-cancellation-${rideId}`;

    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${rideId}`,
        },
        async (payload) => {
          const updated = payload.new as { id: string; status: string };
          if (updated.status !== 'cancelled') return;

          logger.info('ride.server_cancelled', { rideId });

          // Clear persisted offline ride state
          await clearRideState(rideId);

          // Set stage to 'cancelled' so NavigateScreen shows its countdown overlay
          setCancelled('This ride has been cancelled by the member or dispatcher.');

          // Also set serverCancelled so ActiveRideWatcher can navigate home
          // when the driver is on a screen other than NavigateScreen
          setServerCancelled(true);
        }
      )
      .subscribe();

    realtimeManager.subscribe(channelKey, channel);

    return () => {
      realtimeManager.unsubscribe(channelKey);
    };
  }, [rideId, stage]);
}
