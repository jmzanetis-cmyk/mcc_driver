// ============================================================
// MCC Driver — API Server Calls
// ============================================================
// Ride state mutations go through the API server, which applies
// transitions atomically and prevents race conditions
// (e.g. two drivers accepting the same ride simultaneously).
//
// cancelRide and requestPayout still use Supabase Edge Functions
// which handle Stripe payment logic and complex rollback.
// ============================================================

import { supabase } from '@/services/supabase/client';
import { logger } from '@/services/telemetry/logger';

interface ApiResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── API server calls ──────────────────────────────────────────────────────────

async function callApi<T = unknown>(
  path: string,
  method: 'POST' | 'PATCH' | 'GET' = 'POST',
  body?: Record<string, unknown>
): Promise<ApiResult<T>> {
  logger.info('api.call', { path, method });

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json()) as T & { error?: string };

    if (!res.ok) {
      const errorMsg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      logger.error('api.error', { path, status: res.status, error: errorMsg });
      return { success: false, error: errorMsg };
    }

    return { success: true, data: json };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    logger.error('api.network_error', { path, error: message });
    return { success: false, error: message };
  }
}

// ── Supabase Edge Function calls ──────────────────────────────────────────────

async function invokeEdgeFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>
): Promise<ApiResult<T>> {
  logger.info('edge_function.invoke', { name, body });

  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    logger.error('edge_function.error', { name, error: error.message });
    return { success: false, error: error.message };
  }

  return { success: true, data: data as T };
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Accept a ride assignment via the API server.
 * - Checks assignment still has status='pending'
 * - Checks response_deadline hasn't passed
 * - Updates assignment to 'accepted' atomically
 * - Updates ride status to 'driver_accepted' if all drivers accepted
 */
export async function acceptRide(assignmentId: string): Promise<ApiResult> {
  return callApi(`/rides/assignments/${assignmentId}/accept`);
}

/**
 * Decline a ride assignment via the API server.
 * - Marks assignment as 'rejected'
 */
export async function declineRide(assignmentId: string): Promise<ApiResult> {
  return callApi(`/rides/assignments/${assignmentId}/decline`);
}

/**
 * Cancel an active ride via Supabase Edge Function.
 * The Edge Function handles cancellation fees, Stripe rollback, and member notification.
 */
export async function cancelRide(
  rideId: string,
  reason?: string
): Promise<ApiResult> {
  return invokeEdgeFunction('cancel-ride', { rideId, reason });
}

/**
 * Complete a ride via the API server.
 * - Recalculates fare with actual distance
 * - Creates payout record
 * - Updates driver stats
 */
export async function completeRide(
  rideId: string,
  assignmentId: string,
  actualDistanceMiles: number
): Promise<ApiResult<{ finalFare: number; driverPayout: number }>> {
  return callApi<{ finalFare: number; driverPayout: number }>(
    `/rides/${rideId}/complete`,
    'POST',
    { assignmentId, actualDistanceMiles }
  );
}

/**
 * Update ride stage (en_route, arrived, in_progress) via the API server.
 */
export async function updateRideStage(
  _rideId: string,
  assignmentId: string,
  stage: 'en_route' | 'arrived' | 'in_progress'
): Promise<ApiResult> {
  return callApi(`/rides/assignments/${assignmentId}/stage`, 'PATCH', { stage });
}

/**
 * Request instant or standard payout via Supabase Edge Function.
 * The Edge Function validates limits, creates the Stripe transfer, and records the payout.
 */
export async function requestPayout(
  method: 'instant' | 'standard',
  amount?: number
): Promise<ApiResult<{ payoutId: string; netAmount: number; arrivalTime: string }>> {
  return invokeEdgeFunction<{ payoutId: string; netAmount: number; arrivalTime: string }>(
    'request-payout',
    { method, amount }
  );
}
