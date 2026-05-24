import { useEffect, useCallback } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { useDispatchStore } from '@/store/dispatchStore';
import { acceptRide as acceptRideEdge, declineRide as declineRideEdge } from '@/services/api/edgeFunctions';
import { SCENARIO_CONFIG, getServiceTypeFromTier, type RideScenario } from '@/services/rides';
import { logger } from '@/services/telemetry/logger';
import { onNetworkRestored } from '@/hooks/useNetworkStatus';
import type { RideRow, AssignmentRow } from '@/services/supabase/types';

function computeTandemFee(distanceMiles: number): number {
  if (distanceMiles <= 10) return 25;
  if (distanceMiles <= 25) return 40;
  if (distanceMiles <= 50) return 65;
  return 90;
}

interface ScenarioAssignmentConfig {
  role: string;
  drivesMemberVehicle: boolean;
  carriesPassenger: boolean;
}

async function hydrateOfferFromRow(
  assignment: AssignmentRow,
  ride: RideRow,
  setOffer: ReturnType<typeof useDispatchStore.getState>['setOffer'],
) {
  const config = SCENARIO_CONFIG[ride.scenario as RideScenario];
  const assignmentConfig = (config?.assignments ?? []).find(
    (a: ScenarioAssignmentConfig) => a.role === assignment.role,
  ) as ScenarioAssignmentConfig | undefined;

  const vehicleDesc = ride.member_vehicle_year && ride.member_vehicle_make
    ? `${ride.member_vehicle_year} ${ride.member_vehicle_color ?? ''} ${ride.member_vehicle_make} ${ride.member_vehicle_model ?? ''}`.trim()
    : null;

  const tandemRequired = ride.tandem_required ?? false;
  const tandemFee = tandemRequired ? computeTandemFee(ride.estimated_distance_miles) : null;
  const serviceType: 'rideshare' | 'delivery' | 'concierge' =
    ride.service_type === 'rideshare' ? 'rideshare'
      : ride.service_type === 'delivery' ? 'delivery'
        : getServiceTypeFromTier(ride.tier);

  setOffer({
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
    memberVehicleDescription: vehicleDesc,
    drivesMemberVehicle: assignmentConfig?.drivesMemberVehicle ?? false,
    carriesPassenger: assignmentConfig?.carriesPassenger ?? false,
    responseDeadline: assignment.response_deadline,
    tandemRequired,
    tandemFee,
    tandemJobId: null,
    tandemMode: null,
    tandemModeConfirmed: false,
    waypoints: (ride as { waypoints?: unknown }).waypoints as Array<{ address: string; lat: number; lng: number; label?: string }> | null ?? null,
    currentWaypointIndex: 0,
  });
}

export function useRideRequests(driverId: string | null, isOnline: boolean) {
  const dispatch = useDispatchStore();

  // Backfill: query Supabase for any pending assignment still within its
  // response deadline. Used on subscribe and on offline→online reconnect
  // because postgres_changes events do not replay missed inserts. This
  // recovers offers dispatched while the device was offline / the socket
  // was in back-off, satisfying the "delivered within ~10s of reconnect"
  // requirement.
  const backfillPendingOffer = useCallback(async () => {
    if (!driverId) return;
    // Don't clobber an in-progress active ride or visible offer.
    const current = useDispatchStore.getState();
    if (current.stage !== 'idle') return;
    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('driver_assignments')
        .select('*')
        .eq('driver_id', driverId)
        .eq('status', 'pending')
        .gt('response_deadline', nowIso)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error || !data || data.length === 0) return;
      const assignment = data[0] as unknown as AssignmentRow;
      const { data: rideData, error: rideErr } = await supabase
        .from('rides')
        .select('*')
        .eq('id', assignment.ride_id)
        .single();
      if (rideErr || !rideData) return;
      // Re-check we're still idle before hydrating (avoids race with a
      // realtime event arriving concurrently).
      if (useDispatchStore.getState().stage !== 'idle') return;
      logger.info('ride_request.backfilled', { assignmentId: assignment.id });
      await hydrateOfferFromRow(assignment, rideData as unknown as RideRow, dispatch.setOffer);
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    } catch (err) {
      logger.warn('ride_request.backfill_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [driverId, dispatch.setOffer]);

  // Push-notification wakeup: when a native "ride_offer" push arrives while
  // the app is in the foreground, the Realtime socket may be stale. The push
  // handler fires this CustomEvent so we backfill immediately rather than
  // waiting for the next network-restored edge or component remount.
  useEffect(() => {
    const handler = () => { void backfillPendingOffer(); };
    window.addEventListener("mcc:ride_offer_push", handler);
    return () => window.removeEventListener("mcc:ride_offer_push", handler);
  }, [backfillPendingOffer]);

  useEffect(() => {
    if (!driverId || !isOnline) {
      return;
    }

    // Initial backfill + reconnect backfill.
    void backfillPendingOffer();
    const offReconnect = onNetworkRestored(() => {
      void backfillPendingOffer();
    });

    const channelKey = `ride-requests-${driverId}`;
    const channel = supabase
      .channel(channelKey)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'driver_assignments',
          filter: `driver_id=eq.${driverId}`,
        },
        async (payload) => {
          const assignment = payload.new as unknown as AssignmentRow;
          if (assignment.status !== 'pending') return;

          const { data } = await supabase
            .from('rides')
            .select('*')
            .eq('id', assignment.ride_id)
            .single();

          if (!data) return;
          const ride = data as unknown as RideRow;

          // Skip if we already surfaced this assignment via backfill.
          if (useDispatchStore.getState().assignmentId === assignment.id) return;

          await hydrateOfferFromRow(assignment, ride, dispatch.setOffer);

          logger.info('ride_request.received', { rideId: ride.id, scenario: ride.scenario });

          if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
        }
      )
      .subscribe();

    realtimeManager.subscribe(channelKey, channel);

    return () => {
      realtimeManager.unsubscribe(channelKey);
      offReconnect();
    };
  }, [driverId, isOnline, backfillPendingOffer, dispatch.setOffer]);

  const acceptRide = useCallback(async () => {
    if (!dispatch.assignmentId || !dispatch.rideId) return { success: false };

    logger.info('ride_request.accepting', { assignmentId: dispatch.assignmentId });

    const result = await acceptRideEdge(dispatch.assignmentId);

    if (result.success) {
      dispatch.setStage('accepted');
      logger.info('ride_request.accepted', { rideId: dispatch.rideId });
    } else {
      // Keep the offer visible so RideRequestModal can render its inline
      // acceptError banner with retry. The user (or the response-deadline
      // countdown) will clear the dispatch — we no longer silently dismiss
      // the modal on a transient network/server failure.
      logger.error('ride_request.accept_failed', result.error);
    }

    return result;
  }, [dispatch.assignmentId, dispatch.rideId]);

  const declineRide = useCallback(async () => {
    if (!dispatch.assignmentId) return;

    logger.info('ride_request.declining', { assignmentId: dispatch.assignmentId });
    await declineRideEdge(dispatch.assignmentId);
    dispatch.clearDispatch();
  }, [dispatch.assignmentId]);

  const dismissRequest = useCallback(() => {
    dispatch.clearDispatch();
  }, []);

  return {
    incomingRequest: dispatch.stage === 'offered' ? dispatch : null,
    acceptRide,
    declineRide,
    dismissRequest,
  };
}

export type IncomingRideRequest = ReturnType<typeof useDispatchStore.getState>;
