// ============================================================
// MCC Driver — Reconnect Recovery
// ============================================================
// When the app comes back online, reconcile local state
// with the server truth.
// ============================================================

import { supabase } from '@/services/supabase/client';
import { useDispatchStore } from '@/store/dispatchStore';
import { drainOfflineActions } from './storage';
import { logger } from '@/services/telemetry/logger';

/**
 * Fetch the current ride state from the server and
 * update the dispatch store to match.
 */
export async function recoverRideState(driverId: string): Promise<void> {
  logger.info('recovery.start', { driverId });

  const { data: assignments } = await supabase
    .from('driver_assignments')
    .select(`
      id, ride_id, role, status, drives_member_vehicle, carries_passenger,
      rides (
        id, scenario, tier, pickup_address, pickup_lat, pickup_lng,
        dropoff_address, dropoff_lat, dropoff_lng, estimated_fare,
        estimated_distance_miles, started_at
      )
    `)
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'en_route', 'arrived', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1) as any;

  const store = useDispatchStore.getState();

  if (!assignments || assignments.length === 0) {
    // No active ride on server — clear local state if stale
    if (store.stage !== 'idle') {
      logger.warn('recovery.clearing_stale_dispatch');
      store.clearDispatch();
    }
    return;
  }

  const assignment = assignments[0];
  const ride = (assignment as any).rides;

  if (!ride) return;

  const stageMap: Record<string, 'accepted' | 'navigating' | 'arrived' | 'in_progress'> = {
    accepted: 'accepted',
    en_route: 'navigating',
    arrived: 'arrived',
    in_progress: 'in_progress',
  };

  const serverStage = stageMap[assignment.status] || 'accepted';

  // Only update if server state differs from local
  if (store.rideId !== ride.id || store.stage !== serverStage) {
    logger.info('recovery.reconciling', {
      local: { rideId: store.rideId, stage: store.stage },
      server: { rideId: ride.id, stage: serverStage },
    });

    store.setStage(serverStage, {
      rideId: ride.id,
      assignmentId: assignment.id,
      role: assignment.role,
      scenario: ride.scenario,
      tier: ride.tier,
      pickupAddress: ride.pickup_address,
      pickupLat: ride.pickup_lat,
      pickupLng: ride.pickup_lng,
      dropoffAddress: ride.dropoff_address,
      dropoffLat: ride.dropoff_lat,
      dropoffLng: ride.dropoff_lng,
      estimatedFare: ride.estimated_fare,
      estimatedDistance: ride.estimated_distance_miles,
      drivesMemberVehicle: assignment.drives_member_vehicle,
      carriesPassenger: assignment.carries_passenger,
      startedAt: ride.started_at,
    });
  }
}

/**
 * Replay any actions that were queued while offline
 */
export async function replayOfflineActions(): Promise<void> {
  const actions = await drainOfflineActions();
  if (actions.length === 0) return;

  logger.info('recovery.replaying_actions', { count: actions.length });

  for (const { action, payload } of actions) {
    try {
      // Route to the appropriate Edge Function
      await supabase.functions.invoke(action, { body: payload as Record<string, unknown> });
      logger.info('recovery.action_replayed', { action });
    } catch (err) {
      logger.error('recovery.action_replay_failed', { action, err });
    }
  }
}
