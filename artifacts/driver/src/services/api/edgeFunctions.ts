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
  method: 'POST' | 'PATCH' | 'GET' | 'DELETE' = 'POST',
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
 * Cancel an active ride via the API server.
 * Updates ride status to cancelled and notifies assigned drivers via Realtime.
 */
export async function cancelRide(
  rideId: string,
  reason?: string
): Promise<ApiResult> {
  return callApi(`/rides/${rideId}/cancel`, 'POST', { reason, cancelledBy: 'driver' });
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
  actualDistanceMiles: number,
  actualDurationMinutes?: number
): Promise<ApiResult<{ finalFare: number; driverPayout: number }>> {
  return callApi<{ finalFare: number; driverPayout: number }>(
    `/rides/${rideId}/complete`,
    'POST',
    { assignmentId, actualDistanceMiles, actualDurationMinutes }
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

/**
 * Create (or retrieve) a Stripe Connect Express account for the driver and
 * return a one-time onboarding link URL.
 */
export async function initiateStripeConnect(): Promise<ApiResult<{ url: string; accountId: string }>> {
  return callApi<{ url: string; accountId: string }>('/stripe/connect/onboard');
}

/**
 * Get the current Stripe Connect account status for the authenticated driver.
 * Called when the driver returns from the Stripe onboarding flow.
 */
export async function getStripeConnectStatus(): Promise<ApiResult<{
  accountId: string | null;
  onboardingComplete: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  hasDebitCard: boolean;
}>> {
  return callApi<{
    accountId: string | null;
    onboardingComplete: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    hasDebitCard: boolean;
  }>('/stripe/connect/status', 'GET');
}

/**
 * Refresh an expired Stripe Connect onboarding link.
 * Called when Stripe redirects back to the app via the refresh_url.
 */
export async function refreshStripeConnectLink(): Promise<ApiResult<{ url: string; accountId: string }>> {
  return callApi<{ url: string; accountId: string }>('/stripe/connect/refresh');
}

// ── Tandem job API calls ──────────────────────────────────────────────────────

export interface TandemJobRecord {
  id: string;
  rideId: string;
  providerId: string;
  tandemMode: string;
  rideAlongDriverId: string | null;
  matchStatus: string;
  memberApproved: boolean | null;
  rideAlongFee: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PartnerLookupResult {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  verified: boolean;
  status: string;
  rating: number;
  totalJobs: number;
  profilePhotoPath: string | null;
  eligible: boolean;
}

/**
 * Create a tandem job for an accepted ride, setting the tandem mode (A, B, or C).
 */
export async function createTandemJob(
  rideId: string,
  tandemMode: 'A' | 'B' | 'C'
): Promise<ApiResult<TandemJobRecord>> {
  return callApi<TandemJobRecord>('/tandem-jobs', 'POST', { rideId, tandemMode });
}

/**
 * Update the tandem mode on an existing tandem job record.
 */
export async function updateTandemJobMode(
  tandemJobId: string,
  tandemMode: 'A' | 'B' | 'C'
): Promise<ApiResult<TandemJobRecord>> {
  return callApi<TandemJobRecord>(`/tandem-jobs/${tandemJobId}/mode`, 'PATCH', { tandemMode });
}

/**
 * Validate and link a known partner (Mode A) to a tandem job.
 * Accepts the partner's email address or MCC ride-along driver ID.
 * The partner must have a verified, active ride-along driver record.
 */
export async function setKnownPartner(
  tandemJobId: string,
  partnerEmailOrId: string,
): Promise<ApiResult<TandemJobRecord & { partner: PartnerLookupResult }>> {
  return callApi(`/tandem-jobs/${tandemJobId}/known-partner`, 'POST', { partnerEmailOrId });
}

/**
 * Remove the known partner link from a tandem job.
 */
export async function removeKnownPartner(tandemJobId: string): Promise<ApiResult<TandemJobRecord>> {
  return callApi<TandemJobRecord>(`/tandem-jobs/${tandemJobId}/known-partner`, 'DELETE');
}

/**
 * Look up a potential tandem partner by email address or MCC ride-along driver ID.
 * Does not modify any records.
 */
export async function lookupTandemPartner(emailOrId: string): Promise<ApiResult<PartnerLookupResult>> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const param = UUID_RE.test(emailOrId) ? `id=${encodeURIComponent(emailOrId)}` : `email=${encodeURIComponent(emailOrId)}`;
  return callApi<PartnerLookupResult>(`/tandem-jobs/lookup-partner?${param}`, 'GET');
}

// ── Driver preferred-partner persistence ─────────────────────────────────────

/**
 * Fetch the driver's server-persisted preferred tandem partner.
 */
export async function getPreferredPartner(): Promise<ApiResult<PartnerLookupResult>> {
  return callApi<PartnerLookupResult>('/drivers/me/preferred-partner', 'GET');
}

/**
 * Validate a partner and save as the driver's preferred tandem partner on the server.
 */
export async function savePreferredPartner(partnerEmailOrId: string): Promise<ApiResult<PartnerLookupResult>> {
  return callApi<PartnerLookupResult>('/drivers/me/preferred-partner', 'POST', { partnerEmailOrId });
}

/**
 * Remove the driver's preferred tandem partner from their profile.
 */
export async function clearPreferredPartner(): Promise<ApiResult<{ ok: boolean }>> {
  return callApi<{ ok: boolean }>('/drivers/me/preferred-partner', 'DELETE');
}

// ── Tandem matching (Mode B platform-match) ───────────────────────────────────

export interface TandemBroadcastDriverSummary {
  id: string;
  firstName: string;
  lastName: string;
  rating: number;
  totalJobs: number;
  distanceMiles: number | null;
  priorJobsWithProvider: number;
}

export interface TandemBroadcastResult {
  tandemJob: TandemJobRecord;
  eligibleCount: number;
  eligibleDrivers: TandemBroadcastDriverSummary[];
}

/**
 * Ride-along driver accepts a broadcast tandem job. First responder wins;
 * subsequent callers receive 409.
 */
export async function acceptTandemMatch(
  tandemJobId: string,
): Promise<ApiResult<TandemJobRecord>> {
  return callApi<TandemJobRecord>(`/tandem-jobs/${tandemJobId}/ridealong-accept`);
}

/**
 * Ride-along driver declines a broadcast tandem job. Records the decline so
 * the driver is excluded from re-broadcasts of the same job.
 */
export async function declineTandemMatch(
  tandemJobId: string,
  reason?: string,
): Promise<ApiResult<{ ok: boolean }>> {
  return callApi<{ ok: boolean }>(
    `/tandem-jobs/${tandemJobId}/ridealong-decline`,
    'POST',
    reason ? { reason } : undefined,
  );
}

/**
 * Member approves the matched ride-along driver. Marks the job as confirmed.
 */
export async function memberApproveTandemMatch(
  tandemJobId: string,
): Promise<ApiResult<TandemJobRecord>> {
  return callApi<TandemJobRecord>(
    `/tandem-jobs/${tandemJobId}/member-approve`,
    'PATCH',
  );
}

/**
 * Member declines the matched ride-along driver. Re-broadcasts to remaining
 * eligible drivers.
 */
export async function memberDeclineTandemMatch(
  tandemJobId: string,
  reason?: string,
): Promise<ApiResult<TandemBroadcastResult>> {
  return callApi<TandemBroadcastResult>(
    `/tandem-jobs/${tandemJobId}/member-decline`,
    'PATCH',
    reason ? { reason } : undefined,
  );
}

/**
 * Provider confirms the matched ride-along driver, transitioning the job
 * from `matched` to `member_pending`. The member then approves separately.
 */
export async function providerAcceptTandemMatch(
  tandemJobId: string,
): Promise<ApiResult<TandemJobRecord>> {
  return callApi<TandemJobRecord>(
    `/tandem-jobs/${tandemJobId}/provider-accept`,
    'PATCH',
  );
}

/**
 * Provider asks for a different ride-along driver match. Re-broadcasts to
 * remaining eligible drivers.
 */
export async function requestTandemRematch(
  tandemJobId: string,
  reason?: string,
): Promise<ApiResult<TandemBroadcastResult>> {
  return callApi<TandemBroadcastResult>(
    `/tandem-jobs/${tandemJobId}/request-rematch`,
    'PATCH',
    reason ? { reason } : undefined,
  );
}

// ── Driver self-service account deletion ──────────────────────────────────────

export interface DeleteAccountSuccess {
  success: true;
  anonymized: boolean;
  authDeleted: boolean;
  warning?: string;
}

export interface DeleteAccountBlocked {
  reason: 'active_ride' | 'pending_payout' | 'unpaid_balance';
  message: string;
  activeAssignmentCount?: number;
  pendingPayoutCount?: number;
  pendingPayoutAmount?: number;
  unpaidRideCount?: number;
  unpaidBalance?: number;
}

/**
 * Permanently delete the signed-in driver's account.
 *
 * Server-side this anonymizes the local `drivers` row (preserving FK integrity
 * for rides + payouts), deletes the Supabase auth user (revoking sessions),
 * and writes a `driver_audit_log` `self_delete` entry.
 *
 * Returns:
 *   - { success: true, ... } on success
 *   - { success: false, blocked: { reason: 'active_ride' | 'pending_payout' | 'unpaid_balance', ... } }
 *     when a preflight check fails (UI shows targeted copy)
 *   - { success: false, error: string } for everything else
 */
export async function deleteMyAccount(): Promise<
  | { success: true; data: DeleteAccountSuccess }
  | { success: false; blocked: DeleteAccountBlocked }
  | { success: false; error: string }
> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`/api/drivers/me`, { method: 'DELETE', headers });
    const json = (await res.json()) as Record<string, unknown>;

    // 200 = full success, 207 = local row anonymized but auth-user delete
    // failed (server has surfaced a `warning` field for the UI). Validate
    // the response shape rather than blind-casting so a malformed payload
    // can't trick the client into thinking deletion succeeded.
    if (res.ok || res.status === 207) {
      const success = json['success'] === true;
      const anonymized = typeof json['anonymized'] === 'boolean' ? (json['anonymized'] as boolean) : false;
      const authDeleted = typeof json['authDeleted'] === 'boolean' ? (json['authDeleted'] as boolean) : false;
      const warning = typeof json['warning'] === 'string' ? (json['warning'] as string) : undefined;
      if (!success) {
        logger.error('account.delete.malformed_success', { status: res.status });
        return { success: false, error: 'Server returned an unexpected response. Please try again.' };
      }
      const data: DeleteAccountSuccess = { success: true, anonymized, authDeleted, ...(warning ? { warning } : {}) };
      return { success: true, data };
    }

    const reason = json['reason'];
    if (reason === 'active_ride' || reason === 'pending_payout' || reason === 'unpaid_balance') {
      return {
        success: false,
        blocked: {
          reason,
          message: typeof json['message'] === 'string' ? (json['message'] as string) : 'Account deletion blocked.',
          activeAssignmentCount: typeof json['activeAssignmentCount'] === 'number' ? (json['activeAssignmentCount'] as number) : undefined,
          pendingPayoutCount: typeof json['pendingPayoutCount'] === 'number' ? (json['pendingPayoutCount'] as number) : undefined,
          pendingPayoutAmount: typeof json['pendingPayoutAmount'] === 'number' ? (json['pendingPayoutAmount'] as number) : undefined,
          unpaidRideCount: typeof json['unpaidRideCount'] === 'number' ? (json['unpaidRideCount'] as number) : undefined,
          unpaidBalance: typeof json['unpaidBalance'] === 'number' ? (json['unpaidBalance'] as number) : undefined,
        },
      };
    }

    const errMsg = typeof json['error'] === 'string' ? (json['error'] as string) : `HTTP ${res.status}`;
    logger.error('account.delete.error', { status: res.status, error: errMsg });
    return { success: false, error: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    logger.error('account.delete.network_error', { error: message });
    return { success: false, error: message };
  }
}

// ── Driver service capabilities ───────────────────────────────────────────────

/**
 * Update the driver's rideshare and delivery service capabilities.
 */
export async function updateDriverServices(
  services: { canDoRideshare?: boolean; canDoDelivery?: boolean }
): Promise<ApiResult<{ id: string; canDoRideshare: boolean; canDoDelivery: boolean }>> {
  return callApi<{ id: string; canDoRideshare: boolean; canDoDelivery: boolean }>(
    '/drivers/me/services',
    'PATCH',
    services as Record<string, unknown>
  );
}
