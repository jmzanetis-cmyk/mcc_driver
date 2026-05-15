// ============================================================
// MCC Driver — useRideCancellation Hook
// ============================================================
// Subscribes to Supabase Realtime UPDATE events on the
// driver_assignments table (not rides) for the driver's
// current assignment. When the assignment status changes to
// 'cancelled', it means the ride was cancelled externally
// (by the member, admin, or system).
//
// Architecture note: The API server's cancel route writes
// ride mutations to LOCAL Postgres via Drizzle, which cannot
// trigger Supabase Realtime events. However it also calls
// updateAssignmentViaSupabase() which writes the assignment
// status change to Supabase via HTTPS (service role key) —
// this IS visible to Supabase Realtime. So we subscribe to
// driver_assignments, which is already in the supabase_realtime
// publication, rather than rides (which is not wired to Supabase).
// ============================================================

import { useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { useDispatchStore } from '@/store/dispatchStore';
import { clearRideState } from '@/services/offline/storage';
import { logger } from '@/services/telemetry/logger';

export function useRideCancellation() {
  const assignmentId = useDispatchStore((s) => s.assignmentId);
  const rideId = useDispatchStore((s) => s.rideId);
  const stage = useDispatchStore((s) => s.stage);
  const setCancelled = useDispatchStore((s) => s.setCancelled);
  const setServerCancelled = useDispatchStore((s) => s.setServerCancelled);

  useEffect(() => {
    // Only watch for cancellations once the driver has accepted a ride
    const isActive =
      stage !== 'idle' && stage !== 'offered' && stage !== 'completed' && stage !== 'cancelled';
    if (!assignmentId || !isActive) return;

    const channelKey = `assignment-cancellation-${assignmentId}`;

    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'driver_assignments',
          filter: `id=eq.${assignmentId}`,
        },
        async (payload) => {
          const updated = payload.new as { id: string; status: string };
          if (updated.status !== 'cancelled') return;

          logger.info('ride.server_cancelled', { assignmentId, rideId });

          // Clear persisted offline ride state
          if (rideId) await clearRideState(rideId);

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
  }, [assignmentId, stage]);
}
