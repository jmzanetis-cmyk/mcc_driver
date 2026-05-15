// ============================================================
// MCC Driver — useRideCancellation Hook
// ============================================================
// Subscribes to Supabase Realtime UPDATE events on the
// driver_assignments table for the driver's current assignment.
// When the assignment status changes to 'cancelled' (triggered
// by a member or admin cancelling the ride), the dispatch store
// is set to the 'cancelled' stage so NavigateScreen can show
// an appropriate overlay.
// ============================================================

import { useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { useDispatchStore } from '@/store/dispatchStore';
import { clearRideState } from '@/services/offline/storage';
import { logger } from '@/services/telemetry/logger';

export function useRideCancellation(assignmentId: string | null) {
  const dispatch = useDispatchStore();

  useEffect(() => {
    // Only watch when there's an active assignment to watch
    if (!assignmentId) return;

    const channelKey = `ride-cancellation-${assignmentId}`;

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
        (payload) => {
          const updated = payload.new as { status?: string };
          if (updated.status !== 'cancelled') return;

          logger.info('ride.cancelled_externally', { assignmentId });

          // Clear any offline ride state before updating the store
          const rideId = useDispatchStore.getState().rideId;
          if (rideId) {
            clearRideState(rideId).catch(() => {});
          }

          dispatch.setCancelled('Member or admin cancelled this ride');
        },
      )
      .subscribe();

    realtimeManager.subscribe(channelKey, channel);

    return () => {
      realtimeManager.unsubscribe(channelKey);
    };
  }, [assignmentId]);
}
