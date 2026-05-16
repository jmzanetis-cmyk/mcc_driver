import { supabase } from '@/services/supabase/client';
import { useDispatchStore } from '@/store/dispatchStore';
import { drainOfflineActions } from './storage';
import { logger } from '@/services/telemetry/logger';
import type { AssignmentRow, RideRow } from '@/services/supabase/types';

interface AssignmentWithRide extends AssignmentRow {
  rides: RideRow | null;
}

export async function recoverRideState(driverId: string): Promise<void> {
  logger.info('recovery.start', { driverId });

  const { data: assignments } = await supabase
    .from('driver_assignments')
    .select(`
      id, ride_id, role, status, drives_member_vehicle, carries_passenger,
      member_vehicle_description, member_vehicle_plate,
      rides (
        id, scenario, tier, service_type, package_description,
        pickup_address, pickup_lat, pickup_lng,
        dropoff_address, dropoff_lat, dropoff_lng, estimated_fare,
        estimated_distance_miles, started_at
      )
    `)
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'en_route', 'arrived', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1);

  const store = useDispatchStore.getState();

  if (!assignments || assignments.length === 0) {
    if (store.stage !== 'idle') {
      logger.warn('recovery.clearing_stale_dispatch');
      store.clearDispatch();
    }
    return;
  }

  const rows = assignments as unknown as AssignmentWithRide[];
  const assignment = rows[0];
  const ride = assignment.rides;

  if (!ride) return;

  const stageMap: Record<string, 'accepted' | 'navigating' | 'arrived' | 'in_progress'> = {
    accepted: 'accepted',
    en_route: 'navigating',
    arrived: 'arrived',
    in_progress: 'in_progress',
  };

  const serverStage = stageMap[assignment.status] ?? 'accepted';

  if (store.rideId !== ride.id || store.stage !== serverStage) {
    logger.info('recovery.reconciling', {
      local: { rideId: store.rideId, stage: store.stage },
      server: { rideId: ride.id, stage: serverStage },
    });

    // Prefer the persisted service_type from the DB; fall back to tier-derived value
    // so service-specific UI (labels, navigation steps) is correct after app restart.
    const serviceType: 'rideshare' | 'delivery' | 'concierge' =
      ride.service_type === 'rideshare' ? 'rideshare'
        : ride.service_type === 'delivery' ? 'delivery'
        : 'concierge';

    store.setStage(serverStage, {
      rideId: ride.id,
      assignmentId: assignment.id,
      role: (assignment.role === 'primary' || assignment.role === 'chase') ? assignment.role : null,
      scenario: ride.scenario,
      tier: ride.tier,
      serviceType,
      packageDescription: ride.package_description ?? null,
      pickupAddress: ride.pickup_address,
      pickupLat: ride.pickup_lat,
      pickupLng: ride.pickup_lng,
      dropoffAddress: ride.dropoff_address,
      dropoffLat: ride.dropoff_lat,
      dropoffLng: ride.dropoff_lng,
      estimatedFare: ride.estimated_fare,
      estimatedDistance: ride.estimated_distance_miles,
      memberVehicleDescription: assignment.member_vehicle_description ?? null,
      drivesMemberVehicle: assignment.drives_member_vehicle,
      carriesPassenger: assignment.carries_passenger,
      startedAt: ride.started_at ?? undefined,
    });
  }
}

export async function replayOfflineActions(): Promise<void> {
  const actions = await drainOfflineActions();
  if (actions.length === 0) return;

  logger.info('recovery.replaying_actions', { count: actions.length });

  for (const { action, payload } of actions) {
    try {
      await supabase.functions.invoke(action, { body: payload as Record<string, unknown> });
      logger.info('recovery.action_replayed', { action });
    } catch (err) {
      logger.error('recovery.action_replay_failed', { action, err });
    }
  }
}
