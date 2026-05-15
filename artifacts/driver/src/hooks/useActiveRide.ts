// ============================================================
// MCC Driver — useActiveRide Hook (Refactored)
// ============================================================
// Uses Zustand dispatch store for state + Edge Functions for
// all mutations + TanStack Query for ride data + offline persistence.
// ============================================================

import { useCallback } from 'react';
import { useDispatchStore, type DispatchStage } from '@/store/dispatchStore';
import { updateRideStage, completeRide as completeRideEdge, cancelRide as cancelRideEdge } from '@/services/api/edgeFunctions';
import { saveRideState, clearRideState } from '@/services/offline/storage';
import { logger } from '@/services/telemetry/logger';

export function useActiveRide() {
  const dispatch = useDispatchStore();

  const startNavigating = useCallback(async () => {
    if (!dispatch.rideId || !dispatch.assignmentId) return;

    const result = await updateRideStage(dispatch.rideId, dispatch.assignmentId, 'en_route');
    if (result.success) {
      dispatch.setStage('navigating');
      await saveRideState(dispatch.rideId, { ...dispatch, stage: 'navigating' });
      logger.info('ride.navigating', { rideId: dispatch.rideId });
    }
  }, [dispatch.rideId, dispatch.assignmentId]);

  const markArrived = useCallback(async () => {
    if (!dispatch.rideId || !dispatch.assignmentId) return;

    const result = await updateRideStage(dispatch.rideId, dispatch.assignmentId, 'arrived');
    if (result.success) {
      dispatch.setStage('arrived');
      await saveRideState(dispatch.rideId, { stage: 'arrived' });
      logger.info('ride.arrived', { rideId: dispatch.rideId });
    }
  }, [dispatch.rideId, dispatch.assignmentId]);

  const startRide = useCallback(async () => {
    if (!dispatch.rideId || !dispatch.assignmentId) return;

    const result = await updateRideStage(dispatch.rideId, dispatch.assignmentId, 'in_progress');
    if (result.success) {
      dispatch.setStage('in_progress', { startedAt: new Date().toISOString() });
      await saveRideState(dispatch.rideId, { stage: 'in_progress' });
      logger.info('ride.started', { rideId: dispatch.rideId });
    }
  }, [dispatch.rideId, dispatch.assignmentId]);

  const completeRide = useCallback(async (actualDistanceMiles: number) => {
    if (!dispatch.rideId || !dispatch.assignmentId) return { success: false };

    dispatch.setStage('completing');
    logger.info('ride.completing', { rideId: dispatch.rideId, distance: actualDistanceMiles });

    const result = await completeRideEdge(
      dispatch.rideId,
      dispatch.assignmentId,
      actualDistanceMiles
    );

    if (result.success) {
      const completedRideId = dispatch.rideId;
      await clearRideState(completedRideId);
      dispatch.clearDispatch();
      logger.info('ride.completed', { rideId: completedRideId });
      return { success: true, rideId: completedRideId };
    }

    dispatch.setStage('in_progress');
    return { success: false };
  }, [dispatch.rideId, dispatch.assignmentId]);

  const cancelRide = useCallback(async (reason?: string) => {
    if (!dispatch.rideId) return;

    logger.info('ride.cancelling', { rideId: dispatch.rideId, reason });
    await cancelRideEdge(dispatch.rideId, reason);

    if (dispatch.rideId) await clearRideState(dispatch.rideId);
    dispatch.clearDispatch();
  }, [dispatch.rideId]);

  // Helper to determine if we have an active ride
  // Includes 'cancelled' so NavigateScreen can show the cancellation overlay
  const hasActiveRide = dispatch.stage !== 'idle' && dispatch.stage !== 'offered';

  return {
    // State from Zustand (no local useState needed)
    activeRide: hasActiveRide ? {
      rideId: dispatch.rideId!,
      assignmentId: dispatch.assignmentId!,
      stage: dispatch.stage as Exclude<DispatchStage, 'idle' | 'offered'>,
      role: dispatch.role!,
      scenario: dispatch.scenario!,
      tier: dispatch.tier!,
      pickupAddress: dispatch.pickupAddress!,
      pickupLat: dispatch.pickupLat!,
      pickupLng: dispatch.pickupLng!,
      dropoffAddress: dispatch.dropoffAddress!,
      dropoffLat: dispatch.dropoffLat!,
      dropoffLng: dispatch.dropoffLng!,
      estimatedFare: dispatch.estimatedFare!,
      estimatedDistance: dispatch.estimatedDistance!,
      memberVehicleDescription: dispatch.memberVehicleDescription,
      drivesMemberVehicle: dispatch.drivesMemberVehicle,
      carriesPassenger: dispatch.carriesPassenger,
      startedAt: dispatch.startedAt,
      cancellationReason: dispatch.cancellationReason,
    } : null,

    // Actions (all through Edge Functions)
    startNavigating,
    markArrived,
    startRide,
    completeRide,
    cancelRide,
  };
}

export type ActiveRideStage = Exclude<DispatchStage, 'idle' | 'offered'>;
