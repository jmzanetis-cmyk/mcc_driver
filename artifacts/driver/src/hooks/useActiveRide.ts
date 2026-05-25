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
import { enqueue } from '@/services/offlineQueue';
import { getNetworkStatus } from '@/hooks/useNetworkStatus';

export function useActiveRide() {
  const dispatch = useDispatchStore();

  const startNavigating = useCallback(async () => {
    if (!dispatch.rideId || !dispatch.assignmentId) return;

    try {
      const result = await updateRideStage(dispatch.rideId, dispatch.assignmentId, 'en_route');
      if (result.success) {
        dispatch.setStage('navigating');
        await saveRideState(dispatch.rideId, { ...dispatch, stage: 'navigating' });
        logger.info('ride.navigating', { rideId: dispatch.rideId });
      }
    } catch {
      if (!getNetworkStatus().online) {
        const rideId = dispatch.rideId;
        const assignmentId = dispatch.assignmentId;
        dispatch.setStage('navigating');
        enqueue(async () => { await updateRideStage(rideId, assignmentId, 'en_route'); }, 'Start navigating');
      }
    }
  }, [dispatch.rideId, dispatch.assignmentId]);

  const markArrived = useCallback(async () => {
    if (!dispatch.rideId || !dispatch.assignmentId) return;

    try {
      const result = await updateRideStage(dispatch.rideId, dispatch.assignmentId, 'arrived');
      if (result.success) {
        dispatch.setStage('arrived');
        await saveRideState(dispatch.rideId, { stage: 'arrived' });
        logger.info('ride.arrived', { rideId: dispatch.rideId });
      }
    } catch {
      if (!getNetworkStatus().online) {
        const rideId = dispatch.rideId;
        const assignmentId = dispatch.assignmentId;
        dispatch.setStage('arrived');
        enqueue(async () => { await updateRideStage(rideId, assignmentId, 'arrived'); }, 'Mark arrived');
      }
    }
  }, [dispatch.rideId, dispatch.assignmentId]);

  const startRide = useCallback(async () => {
    if (!dispatch.rideId || !dispatch.assignmentId) return;

    try {
      const result = await updateRideStage(dispatch.rideId, dispatch.assignmentId, 'in_progress');
      if (result.success) {
        dispatch.setStage('in_progress', { startedAt: new Date().toISOString() });
        await saveRideState(dispatch.rideId, { stage: 'in_progress' });
        logger.info('ride.started', { rideId: dispatch.rideId });
      }
    } catch {
      if (!getNetworkStatus().online) {
        const rideId = dispatch.rideId;
        const assignmentId = dispatch.assignmentId;
        dispatch.setStage('in_progress', { startedAt: new Date().toISOString() });
        enqueue(async () => { await updateRideStage(rideId, assignmentId, 'in_progress'); }, 'Start ride');
      }
    }
  }, [dispatch.rideId, dispatch.assignmentId]);

  const completeRide = useCallback(async (actualDistanceMiles: number) => {
    // Read current store state at call time to avoid stale closure on startedAt,
    // which is set after ride creation (when ride transitions to in_progress).
    const store = useDispatchStore.getState();
    if (!store.rideId || !store.assignmentId) return { success: false };

    store.setStage('completing');

    // Compute actual ride duration from when the ride entered in_progress.
    // This feeds the perMinute fare component for rideshare/delivery.
    const actualDurationMinutes = store.startedAt
      ? Math.round((Date.now() - new Date(store.startedAt).getTime()) / 60000)
      : undefined;

    logger.info('ride.completing', { rideId: store.rideId, distance: actualDistanceMiles, durationMinutes: actualDurationMinutes });

    try {
      const result = await completeRideEdge(
        store.rideId,
        store.assignmentId,
        actualDistanceMiles,
        actualDurationMinutes
      );

      if (result.success) {
        const completedRideId = store.rideId;
        await clearRideState(completedRideId);
        store.clearDispatch();
        logger.info('ride.completed', { rideId: completedRideId });
        return { success: true, rideId: completedRideId };
      }

      store.setStage('in_progress');
      return { success: false };
    } catch {
      if (!getNetworkStatus().online) {
        const capturedRideId = store.rideId;
        const capturedAssignmentId = store.assignmentId;
        enqueue(async () => {
          const r = await completeRideEdge(capturedRideId, capturedAssignmentId, actualDistanceMiles, actualDurationMinutes);
          if (r.success) {
            await clearRideState(capturedRideId);
            useDispatchStore.getState().clearDispatch();
            logger.info('ride.completed.queued', { rideId: capturedRideId });
          }
        }, 'Complete ride');
        store.setStage('in_progress');
        logger.info('ride.complete.queued', { rideId: store.rideId });
        return { success: false, queued: true as const };
      }
      store.setStage('in_progress');
      return { success: false };
    }
  }, []);

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
      serviceType: dispatch.serviceType,
      packageDescription: dispatch.packageDescription,
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
      waypoints: dispatch.waypoints,
      currentWaypointIndex: dispatch.currentWaypointIndex,
    } : null,

    // Actions (all through Edge Functions)
    startNavigating,
    markArrived,
    startRide,
    completeRide,
    cancelRide,
    advanceWaypoint: dispatch.advanceWaypoint,
  };
}

export type ActiveRideStage = Exclude<DispatchStage, 'idle' | 'offered'>;
