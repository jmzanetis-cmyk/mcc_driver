import { supabase } from '@/services/supabase/client';
import { apiUrl } from '@/services/api/baseUrl';
import type { DriverRow, PayoutRow } from '@/services/supabase/types';

export interface InstantPayBalance {
  available: number;
  pending: number;
  lastPayoutAt?: string;
  instantPayEnabled: boolean;
  hasDebitCard: boolean;
  isPartnerDriver: boolean;
  dailyCashOutCount: number;
  dailyLimit: number;
}

export interface PayoutResult {
  success: boolean;
  amount?: number;
  fee?: number;
  netAmount?: number;
  arrivalTime?: string;
  payoutId?: string;
  error?: string;
  errorCode?: string;
  /** Non-fatal warning: payout was initiated but a secondary step had an issue. */
  warning?: string;
}

export interface PayoutHistoryItem {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  method: 'instant' | 'standard';
  status: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';
  initiatedAt: string;
  arrivalDate?: string;
  cardLast4?: string;
  bankLast4?: string;
  failureReason?: string;
}

export const INSTANT_PAY_FEE = 0.50;
export const MINIMUM_CASHOUT = 5.00;
export const MAX_DAILY_CASHOUTS = 5;
export const STANDARD_PAYOUT_DAY = 'wednesday';

export async function getInstantPayBalance(driverId: string): Promise<InstantPayBalance> {
  const { data: driverData } = await supabase
    .from('drivers')
    .select('partner_id, stripe_account_id')
    .eq('id', driverId)
    .single();

  if (!driverData) throw new Error('Driver not found');
  const driver = driverData as unknown as Pick<DriverRow, 'partner_id' | 'stripe_account_id'>;

  const isPartnerDriver = !!driver.partner_id;

  if (isPartnerDriver) {
    return {
      available: 0,
      pending: 0,
      instantPayEnabled: false,
      hasDebitCard: false,
      isPartnerDriver: true,
      dailyCashOutCount: 0,
      dailyLimit: 0,
    };
  }

  if (!driver.stripe_account_id) {
    return {
      available: 0,
      pending: 0,
      instantPayEnabled: false,
      hasDebitCard: false,
      isPartnerDriver: false,
      dailyCashOutCount: 0,
      dailyLimit: MAX_DAILY_CASHOUTS,
    };
  }

  const { data: unpaidRides } = await supabase
    .from('driver_assignments')
    .select('driver_payout_amount, status, completed_at')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid');

  const { data: pendingRides } = await supabase
    .from('driver_assignments')
    .select('driver_payout_amount, status')
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'en_route', 'arrived', 'in_progress']);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todayCashouts } = await supabase
    .from('driver_payouts')
    .select('id')
    .eq('driver_id', driverId)
    .eq('method', 'instant')
    .gte('created_at', todayStart.toISOString());

  const { data: lastPayoutData } = await supabase
    .from('driver_payouts')
    .select('completed_at')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);

  const lastPayout = (lastPayoutData ?? []) as unknown as Array<Pick<PayoutRow, 'completed_at'>>;

  interface PartialAssignment { driver_payout_amount: number | null }
  const available = (unpaidRides ?? []).reduce(
    (sum, r) => sum + ((r as unknown as PartialAssignment).driver_payout_amount ?? 0), 0
  );
  const pending = (pendingRides ?? []).reduce(
    (sum, r) => sum + ((r as unknown as PartialAssignment).driver_payout_amount ?? 0), 0
  );

  // Ask the server for real capability state — stripe.accounts.retrieve()
  // is the only reliable way to know if a debit card is actually attached.
  let instantPayEnabled = false;
  let hasDebitCard = false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token) {
      const capRes = await fetch(apiUrl('/stripe/connect/status'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (capRes.ok) {
        const caps = await capRes.json() as { payoutsEnabled: boolean; hasDebitCard: boolean };
        hasDebitCard = caps.hasDebitCard;
        instantPayEnabled = caps.payoutsEnabled && caps.hasDebitCard;
      }
    }
  } catch {
    // Network failure — leave both false so instant pay is conservatively
    // disabled rather than showing an incorrect enabled state.
  }

  return {
    available: Math.round(available * 100) / 100,
    pending: Math.round(pending * 100) / 100,
    lastPayoutAt: lastPayout[0]?.completed_at ?? undefined,
    instantPayEnabled,
    hasDebitCard,
    isPartnerDriver: false,
    dailyCashOutCount: todayCashouts?.length ?? 0,
    dailyLimit: MAX_DAILY_CASHOUTS,
  };
}

export async function executeInstantPayout(
  _driverId: string,
  requestedAmount?: number
): Promise<PayoutResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    return { success: false, error: 'Not authenticated. Please sign in again.', errorCode: 'UNAUTHENTICATED' };
  }

  const body: Record<string, unknown> = {};
  if (requestedAmount !== undefined) body.amount = requestedAmount;

  let res: Response;
  try {
    res = await fetch(apiUrl('/payouts/instant'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      success: false,
      error: 'Network error. Check your connection and try again.',
      errorCode: 'NETWORK_ERROR',
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { success: false, error: 'Unexpected server response.', errorCode: 'PARSE_ERROR' };
  }

  if (!res.ok) {
    const err = data as { error?: string; code?: string };
    return {
      success: false,
      error: err.error ?? 'Payout failed. Please try again.',
      errorCode: err.code,
    };
  }

  const { payout } = data as {
    payout: { id: string; gross: number; fee: number; net: number; assignmentCount: number };
  };
  return {
    success: true,
    amount: payout.gross,
    fee: payout.fee,
    netAmount: payout.net,
    arrivalTime: 'Within minutes',
    payoutId: payout.id,
  };
}

export async function executeStandardPayout(
  _driverId: string,
): Promise<PayoutResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    return { success: false, error: 'Not authenticated. Please sign in again.', errorCode: 'UNAUTHENTICATED' };
  }

  let res: Response;
  try {
    res = await fetch(apiUrl('/payouts/standard'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return {
      success: false,
      error: 'Network error. Check your connection and try again.',
      errorCode: 'NETWORK_ERROR',
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { success: false, error: 'Unexpected server response.', errorCode: 'PARSE_ERROR' };
  }

  if (!res.ok) {
    const err = data as { error?: string; code?: string };
    return {
      success: false,
      error: err.error ?? 'Payout failed. Please try again.',
      errorCode: err.code,
    };
  }

  const { payout } = data as {
    payout: { id: string; amount: number; arrivalDate: string };
  };
  return {
    success: true,
    amount: payout.amount,
    fee: 0,
    netAmount: payout.amount,
    arrivalTime: '2-3 business days',
    payoutId: payout.id,
  };
}

export async function getPayoutHistory(driverId: string, limit = 20): Promise<PayoutHistoryItem[]> {
  const { data } = await supabase
    .from('driver_payouts')
    .select('*')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as PayoutRow[];
  return rows.map((p) => ({
    id: p.id,
    amount: p.amount ?? 0,
    fee: p.platform_fee ?? 0,
    netAmount: p.net_payout ?? 0,
    method: p.method,
    status: p.status as PayoutHistoryItem['status'],
    initiatedAt: p.requested_at ?? p.created_at,
    arrivalDate: p.completed_at ?? p.scheduled_date ?? undefined,
    cardLast4: p.card_last4 ?? undefined,
    bankLast4: p.bank_last4 ?? undefined,
    failureReason: p.failed_reason ?? undefined,
  }));
}
