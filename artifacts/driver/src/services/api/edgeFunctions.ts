// ============================================================
// MCC Driver — Edge Function API Calls
// ============================================================
// CRITICAL: Ride state mutations go through Edge Functions,
// NOT direct table updates. This prevents race conditions
// where two drivers accept the same ride simultaneously.
//
// Each function calls a Supabase Edge Function that:
// 1. Validates the current state
// 2. Applies the transition atomically
// 3. Returns the result
// ============================================================

import { supabase } from '@/services/supabase/client';
import { logger } from '@/services/telemetry/logger';

interface EdgeFunctionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>
): Promise<EdgeFunctionResult<T>> {
  logger.info(`edge_function.invoke`, { name, body });

  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    logger.error(`edge_function.error`, { name, error: error.message });
    return { success: false, error: error.message };
  }

  return { success: true, data: data as T };
}

/**
 * Accept a ride assignment. The Edge Function:
 * - Checks assignment still has status='pending'
 * - Checks response_deadline hasn't passed
 * - Updates assignment to 'accepted' atomically
 * - For multi-driver rides, checks if all roles are filled
 * - Updates ride status to 'driver_accepted' if all drivers accepted
 */
export async function acceptRide(assignmentId: string): Promise<EdgeFunctionResult> {
  return invokeEdgeFunction('accept-ride', { assignmentId });
}

/**
 * Decline a ride assignment. The Edge Function:
 * - Marks assignment as 'rejected'
 * - Triggers dispatch cascade to next available driver
 */
export async function declineRide(assignmentId: string): Promise<EdgeFunctionResult> {
  return invokeEdgeFunction('accept-ride', { assignmentId, action: 'decline' });
}

/**
 * Cancel an active ride. The Edge Function:
 * - Validates cancellation is allowed for current status
 * - Applies cancellation fee if applicable
 * - Updates ride and all assignments
 * - Notifies member
 */
export async function cancelRide(
  rideId: string,
  reason?: string
): Promise<EdgeFunctionResult> {
  return invokeEdgeFunction('cancel-ride', { rideId, reason });
}

/**
 * Complete a ride. The Edge Function:
 * - Validates all required photos uploaded (Tiers 2-4)
 * - Recalculates fare with actual distance
 * - Captures Stripe payment
 * - Splits payment 85/15
 * - Updates driver stats
 * - Creates payout record
 */
export async function completeRide(
  rideId: string,
  assignmentId: string,
  actualDistanceMiles: number
): Promise<EdgeFunctionResult<{ finalFare: number; driverPayout: number }>> {
  return invokeEdgeFunction('complete-ride', {
    rideId,
    assignmentId,
    actualDistanceMiles,
  });
}

/**
 * Update ride stage (en_route, arrived, in_progress).
 * These are less critical than accept/complete so they CAN
 * be direct updates, but we route through Edge Functions
 * for consistency and audit logging.
 */
export async function updateRideStage(
  rideId: string,
  assignmentId: string,
  stage: 'en_route' | 'arrived' | 'in_progress'
): Promise<EdgeFunctionResult> {
  return invokeEdgeFunction('accept-ride', {
    assignmentId,
    action: `update_${stage}`,
    rideId,
  });
}

/**
 * Request instant or standard payout. The Edge Function:
 * - Validates available balance
 * - Checks daily limits for instant
 * - Creates Stripe payout
 * - Records in driver_payouts
 */
export async function requestPayout(
  method: 'instant' | 'standard',
  amount?: number
): Promise<EdgeFunctionResult<{ payoutId: string; netAmount: number; arrivalTime: string }>> {
  return invokeEdgeFunction('request-payout', { method, amount });
}
