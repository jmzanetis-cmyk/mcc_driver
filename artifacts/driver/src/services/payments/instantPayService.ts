import { supabase } from '@/services/supabase/client';
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

  const instantPayEnabled = !!driver.stripe_account_id;
  const hasDebitCard = !!driver.stripe_account_id;

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
  driverId: string,
  requestedAmount?: number
): Promise<PayoutResult> {
  const balance = await getInstantPayBalance(driverId);

  if (balance.isPartnerDriver) {
    return {
      success: false,
      error: 'Instant Pay is not available for partner drivers. Your payouts are managed by your partner company.',
      errorCode: 'PARTNER_DRIVER',
    };
  }

  if (!balance.instantPayEnabled) {
    return { success: false, error: 'Set up your Stripe account to enable Instant Pay.', errorCode: 'NO_STRIPE' };
  }

  if (!balance.hasDebitCard) {
    return {
      success: false,
      error: 'Add a debit card to your account for instant payouts. Bank accounts only support standard (2-3 day) payouts.',
      errorCode: 'NO_DEBIT_CARD',
    };
  }

  if (balance.dailyCashOutCount >= balance.dailyLimit) {
    return {
      success: false,
      error: `You've reached the daily limit of ${balance.dailyLimit} instant payouts. Try again tomorrow, or wait for your free weekly payout on ${STANDARD_PAYOUT_DAY}.`,
      errorCode: 'DAILY_LIMIT',
    };
  }

  // Budget ceiling: clamp requested amount to what's actually available.
  const budgetCents = Math.round(
    (requestedAmount ? Math.min(requestedAmount, balance.available) : balance.available) * 100
  );

  // Fetch unpaid assignments sorted oldest-first for deterministic allocation.
  const { data: unpaidAssignments, error: fetchError } = await supabase
    .from('driver_assignments')
    .select('id, driver_payout_amount')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid')
    .order('completed_at', { ascending: true });

  if (fetchError) {
    return { success: false, error: 'Failed to read earnings. Please try again.', errorCode: 'DB_ERROR' };
  }

  // Select assignments that fit fully within the budget (check BEFORE adding).
  // allocatedCents tracks the exact sum of chosen assignments so the payout
  // record is always for exactly the amount being marked paid — no mismatch.
  const assignmentIdsToPay: string[] = [];
  let remaining = budgetCents;
  let allocatedCents = 0;
  for (const row of unpaidAssignments ?? []) {
    if (remaining <= 0) break;
    const rowCents = Math.round(
      ((row as unknown as { driver_payout_amount: number | null }).driver_payout_amount ?? 0) * 100
    );
    if (rowCents > 0 && rowCents <= remaining) {
      assignmentIdsToPay.push((row as unknown as { id: string }).id);
      remaining -= rowCents;
      allocatedCents += rowCents;
    }
  }

  // Use the actual allocated amount (not the requested amount) for the payout
  // record so the ledger is always consistent with what's being marked paid.
  const allocatedAmount = allocatedCents / 100;

  if (allocatedAmount < MINIMUM_CASHOUT) {
    return {
      success: false,
      error: `Minimum cash-out is $${MINIMUM_CASHOUT.toFixed(2)}. You have $${balance.available.toFixed(2)} available.`,
      errorCode: 'BELOW_MINIMUM',
    };
  }

  const fee = INSTANT_PAY_FEE;
  const netAmount = Math.round((allocatedAmount - fee) * 100) / 100;

  if (netAmount <= 0) {
    return {
      success: false,
      error: `After the $${fee.toFixed(2)} instant pay fee, there wouldn't be anything left to pay out.`,
      errorCode: 'FEE_EXCEEDS_AMOUNT',
    };
  }

  const payoutId = crypto.randomUUID();

  const { error: insertError } = await supabase.from('driver_payouts').insert({
    id: payoutId,
    driver_id: driverId,
    amount: allocatedAmount,
    net_payout: netAmount,
    platform_fee: fee,
    method: 'instant',
    status: 'processing',
    requested_at: new Date().toISOString(),
  });

  if (insertError) {
    return { success: false, error: 'Failed to process payout. Please try again.', errorCode: 'DB_ERROR' };
  }

  if (assignmentIdsToPay.length > 0) {
    const { error: updateError } = await supabase
      .from('driver_assignments')
      .update({ payout_status: 'paid', payout_id: payoutId })
      .in('id', assignmentIdsToPay)
      .eq('driver_id', driverId); // defense-in-depth: scope update to this driver

    if (updateError) {
      // The payout record was successfully written. Return success: true so the
      // driver does NOT retry (which would create a duplicate payout). Surface
      // a non-fatal warning so the UI can prompt them to contact support.
      return {
        success: true,
        amount: allocatedAmount,
        fee,
        netAmount,
        arrivalTime: 'Within minutes',
        payoutId,
        warning: 'Payout initiated. Your earnings records could not be updated automatically — please contact support to reconcile.',
      };
    }
  }

  return { success: true, amount: allocatedAmount, fee, netAmount, arrivalTime: 'Within minutes', payoutId };
}

export async function executeStandardPayout(driverId: string): Promise<PayoutResult> {
  const balance = await getInstantPayBalance(driverId);

  if (balance.isPartnerDriver) {
    return { success: false, error: 'Partner drivers are paid through their partner company.', errorCode: 'PARTNER_DRIVER' };
  }

  if (balance.available < MINIMUM_CASHOUT) {
    return { success: false, error: `Minimum payout is $${MINIMUM_CASHOUT.toFixed(2)}.`, errorCode: 'BELOW_MINIMUM' };
  }

  const payoutId = crypto.randomUUID();

  const { error: dbError } = await supabase.from('driver_payouts').insert({
    id: payoutId,
    driver_id: driverId,
    amount: balance.available,
    net_payout: balance.available,
    platform_fee: 0,
    method: 'standard',
    status: 'scheduled',
    scheduled_date: getNextPayoutDate(),
    requested_at: new Date().toISOString(),
  });

  if (dbError) {
    return { success: false, error: 'Failed to schedule payout. Please try again.', errorCode: 'DB_ERROR' };
  }

  const { error: updateError } = await supabase
    .from('driver_assignments')
    .update({ payout_status: 'paid', payout_id: payoutId })
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid');

  if (updateError) {
    // Payout record was written; return success: true so the driver does not
    // retry and create a duplicate. Surface a warning for support reconciliation.
    return {
      success: true,
      amount: balance.available,
      fee: 0,
      netAmount: balance.available,
      arrivalTime: '2-3 business days',
      payoutId,
      warning: 'Payout scheduled. Your earnings records could not be updated automatically — please contact support to reconcile.',
    };
  }

  return {
    success: true,
    amount: balance.available,
    fee: 0,
    netAmount: balance.available,
    arrivalTime: '2-3 business days',
    payoutId,
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

function getNextPayoutDate(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilWednesday = (3 - dayOfWeek + 7) % 7 || 7;
  const nextWed = new Date(now.getTime() + daysUntilWednesday * 86400000);
  return nextWed.toISOString().split('T')[0];
}
