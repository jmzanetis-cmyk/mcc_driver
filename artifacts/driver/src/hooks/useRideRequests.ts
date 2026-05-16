import { useEffect, useCallback } from 'react';
import { supabase } from '@/services/supabase/client';
import { realtimeManager } from '@/services/realtime/realtimeManager';
import { useDispatchStore } from '@/store/dispatchStore';
import { acceptRide as acceptRideEdge, declineRide as declineRideEdge } from '@/services/api/edgeFunctions';
import { SCENARIO_CONFIG, getServiceTypeFromTier, type RideScenario } from '@/services/rides';
import { logger } from '@/services/telemetry/logger';
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

export function useRideRequests(driverId: string | null, isOnline: boolean) {
  const dispatch = useDispatchStore();

  useEffect(() => {
    if (!driverId || !isOnline) {
      return;
    }

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

          const config = SCENARIO_CONFIG[ride.scenario as RideScenario];
          const assignmentConfig = (config?.assignments ?? []).find(
            (a: ScenarioAssignmentConfig) => a.role === assignment.role
          ) as ScenarioAssignmentConfig | undefined;

          const vehicleDesc = ride.member_vehicle_year && ride.member_vehicle_make
            ? `${ride.member_vehicle_year} ${ride.member_vehicle_color ?? ''} ${ride.member_vehicle_make} ${ride.member_vehicle_model ?? ''}`.trim()
            : null;

          const tandemRequired = ride.tandem_required ?? false;
          const tandemFee = tandemRequired ? computeTandemFee(ride.estimated_distance_miles) : null;
          // Prefer the persisted service_type from the DB; fall back to tier-derived value.
          const serviceType: 'rideshare' | 'delivery' | 'concierge' =
            ride.service_type === 'rideshare' ? 'rideshare'
              : ride.service_type === 'delivery' ? 'delivery'
              : getServiceTypeFromTier(ride.tier);

          dispatch.setOffer({
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
          });

          logger.info('ride_request.received', { rideId: ride.id, scenario: ride.scenario });

          if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
        }
      )
      .subscribe();

    realtimeManager.subscribe(channelKey, channel);

    return () => {
      realtimeManager.unsubscribe(channelKey);
    };
  }, [driverId, isOnline]);

  const acceptRide = useCallback(async () => {
    if (!dispatch.assignmentId || !dispatch.rideId) return { success: false };

    logger.info('ride_request.accepting', { assignmentId: dispatch.assignmentId });

    const result = await acceptRideEdge(dispatch.assignmentId);

    if (result.success) {
      dispatch.setStage('accepted');
      logger.info('ride_request.accepted', { rideId: dispatch.rideId });
    } else {
      logger.error('ride_request.accept_failed', result.error);
      dispatch.clearDispatch();
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
