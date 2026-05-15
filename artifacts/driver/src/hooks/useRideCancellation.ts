// ============================================================
// MCC Driver — useRideCancellation Hook
// ============================================================
// Subscribes to Supabase Realtime UPDATE events to detect
// when a ride is cancelled externally (member, admin, system).
//
// Primary path — rides table (UPDATE, filter id=eq.{rideId}):
//   Fires when the API cancel route calls updateRideViaSupabase().
//   Requires: ALTER PUBLICATION supabase_realtime ADD TABLE rides;
//   See scripts/sql/enable-rides-realtime.sql for the one-time setup.
//
// Fallback path — driver_assignments table (UPDATE, filter id=eq.{assignmentId}):
//   Fires when the API cancel route calls updateAssignmentViaSupabase().
//   driver_assignments is already in supabase_realtime — no extra setup.
//   This path works immediately and ensures reliable delivery while the
//   rides publication is pending or as belt-and-suspenders coverage.
//
// Both channels call setCancelled() + setServerCancelled(true).
// Those actions are idempotent — calling them twice is harmless.
// ============================================================

import { useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { useDispatchStore } from '@/store/dispatchStore';
import { clearRideState } from '@/services/offline/storage';
import { logger } from '@/services/telemetry/logger';

export function useRideCancellation() {
  const rideId = useDispatchStore((s) => s.rideId);
  const assignmentId = useDispatchStore((s) => s.assignmentId);
  const stage = useDispatchStore((s) => s.stage);
  const setCancelled = useDispatchStore((s) => s.setCancelled);
  const setServerCancelled = useDispatchStore((s) => s.setServerCancelled);

  useEffect(() => {
    // Only watch for cancellations once the driver has accepted a ride
    const isActive =
      stage !== 'idle' && stage !== 'offered' && stage !== 'completed' && stage !== 'cancelled';
    if (!rideId || !isActive) return;

    async function handleCancellation(sourceTable: string) {
      logger.info('ride.server_cancelled', { rideId, sourceTable });
      if (rideId) await clearRideState(rideId);
      setCancelled('This ride has been cancelled by the member or dispatcher.');
      setServerCancelled(true);
    }

    // Primary: rides table — fires once ALTER PUBLICATION rides is run in Supabase.
    // See scripts/sql/enable-rides-realtime.sql
    const ridesChannelKey = `ride-cancellation-rides-${rideId}`;
    const ridesChannel = supabase
      .channel(ridesChannelKey)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `id=eq.${rideId}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; status: string };
          if (updated.status === 'cancelled') handleCancellation('rides');
        },
      )
      .subscribe();
    realtimeManager.subscribe(ridesChannelKey, ridesChannel);

    // Fallback: driver_assignments table — already in supabase_realtime, works now.
    let assignmentsChannelKey: string | null = null;
    if (assignmentId) {
      assignmentsChannelKey = `ride-cancellation-assignments-${assignmentId}`;
      const assignmentsChannel = supabase
        .channel(assignmentsChannelKey)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'driver_assignments',
            filter: `id=eq.${assignmentId}`,
          },
          (payload) => {
            const updated = payload.new as { id: string; status: string };
            if (updated.status === 'cancelled') handleCancellation('driver_assignments');
          },
        )
        .subscribe();
      realtimeManager.subscribe(assignmentsChannelKey, assignmentsChannel);
    }

    return () => {
      realtimeManager.unsubscribe(ridesChannelKey);
      if (assignmentsChannelKey) realtimeManager.unsubscribe(assignmentsChannelKey);
    };
  }, [rideId, assignmentId, stage]);
}
